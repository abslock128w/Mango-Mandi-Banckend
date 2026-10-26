-- Trust pack (26 Oct 2026): a numbered bill for every paid order, and the
-- business details a buyer may give at checkout to have printed on it.
-- (The customer profile and the CSV exports read existing tables and the
-- staff_audit trail; they need no schema.)
--
-- locks: three new tables, plus two nullable columns with no default on orders
-- (a brief lock, no rewrite, no scan). Expand-only: the previous release never
-- reads or writes any of this and keeps working while both versions serve.

-- Optional, from checkout: the buyer's business name and GSTIN (format and
-- checksum checked by the API), printed on the bill.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_business_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_gstin TEXT;

-- One gapless sequence per Indian financial year (April to March), e.g. '2026-27'.
-- The row is locked by the UPDATE that takes the next number and stays locked
-- until the paying transaction commits, so two payments can never take the
-- same number, and a rolled-back payment gives its number back.
CREATE TABLE bill_counters (
  fy       TEXT PRIMARY KEY CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  last_no  INTEGER NOT NULL CHECK (last_no >= 0)
);

-- When bills were first switched on (one row, written by the first maintenance
-- run with BILLS_ENABLED on). The catch-up step bills every paid order since
-- then (less a week), however long a bill has been failing, so a paid order
-- never ages out of it unbilled and unreported.
CREATE TABLE bills_started (
  singleton   BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  started_at  TIMESTAMPTZ NOT NULL
);

-- An issued bill. Everything printed on it is copied here when the number is
-- assigned (snapshot), so later edits to the order, the product, the promo or
-- the seller settings never change a bill already issued. The trigger below
-- refuses any change to it except: marking it cancelled (once), and removing
-- the consumer's name and address (account deletion or the retention window).
CREATE TABLE bills (
  id                TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL UNIQUE REFERENCES orders(id),
  fy                TEXT NOT NULL,
  seq               INTEGER NOT NULL CHECK (seq >= 1),
  -- e.g. MM/26-27/000001: at most 16 characters, letters, digits, '/' and '-' (CGST rules 46(b) and 49(b)).
  number            TEXT NOT NULL UNIQUE CHECK (char_length(number) <= 16 AND number ~ '^[A-Za-z0-9/-]+$'),
  kind              TEXT NOT NULL CHECK (kind IN ('RECEIPT', 'BILL_OF_SUPPLY', 'TAX_INVOICE', 'INVOICE_CUM_BILL_OF_SUPPLY')),
  issued_at         TIMESTAMPTZ NOT NULL,
  -- The bill's date: the IST calendar day it was issued (decides the financial year).
  bill_date         DATE NOT NULL,
  total             INTEGER NOT NULL CHECK (total >= 0),
  snapshot          JSONB NOT NULL,
  -- The buyer as they were when the bill was issued; removable for privacy (the rest stays for the books).
  buyer_name        TEXT,
  buyer_address     TEXT,
  buyer_removed_at  TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  cancel_reason     TEXT,
  UNIQUE (fy, seq)
);
CREATE INDEX bills_issued_idx ON bills (issued_at);

CREATE FUNCTION bills_keep_issued() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'an issued bill is never deleted (bill %)', OLD.number USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.fy IS DISTINCT FROM OLD.fy
     OR NEW.seq IS DISTINCT FROM OLD.seq OR NEW.number IS DISTINCT FROM OLD.number OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at OR NEW.bill_date IS DISTINCT FROM OLD.bill_date
     OR NEW.total IS DISTINCT FROM OLD.total OR NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
    RAISE EXCEPTION 'an issued bill cannot be changed (bill %)', OLD.number USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.cancelled_at IS NOT NULL AND (NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason) THEN
    RAISE EXCEPTION 'a cancelled bill stays cancelled (bill %)', OLD.number USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.buyer_name IS NOT NULL AND NEW.buyer_name IS DISTINCT FROM OLD.buyer_name)
     OR (NEW.buyer_address IS NOT NULL AND NEW.buyer_address IS DISTINCT FROM OLD.buyer_address) THEN
    RAISE EXCEPTION 'the buyer on an issued bill can only be removed, not changed (bill %)', OLD.number USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bills_keep_issued BEFORE UPDATE OR DELETE ON bills FOR EACH ROW EXECUTE FUNCTION bills_keep_issued();

-- Row triggers do not fire on TRUNCATE, so it is refused on its own: TRUNCATE
-- bills (or of orders CASCADE) would wipe every issued bill, and of the
-- counters would restart a year's numbering.
CREATE FUNCTION bills_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'issued bills and their numbering are never wiped: TRUNCATE % is not allowed', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER bills_no_truncate BEFORE TRUNCATE ON bills FOR EACH STATEMENT EXECUTE FUNCTION bills_no_truncate();
CREATE TRIGGER bill_counters_no_truncate BEFORE TRUNCATE ON bill_counters FOR EACH STATEMENT EXECUTE FUNCTION bills_no_truncate();
