-- Stock integrity (audit INV-7). Add-only: a trigger, constraints added
-- NOT VALID and validated separately, and a unique index backing a new FK.

-- The ledger is the record every stock counter is audited against: rows are
-- only ever added. Refuse UPDATE, DELETE and TRUNCATE at the database, not
-- just by convention.
CREATE OR REPLACE FUNCTION batch_ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'batch_ledger is append-only: % is not allowed', TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER batch_ledger_no_update_delete
  BEFORE UPDATE OR DELETE ON batch_ledger
  FOR EACH ROW EXECUTE FUNCTION batch_ledger_append_only();

CREATE TRIGGER batch_ledger_no_truncate
  BEFORE TRUNCATE ON batch_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION batch_ledger_append_only();

-- Only the movements the stock engine writes.
ALTER TABLE batch_ledger ADD CONSTRAINT batch_ledger_event_type_check
  CHECK (event_type IN ('INTAKE', 'ADJUST', 'ADJUST_BUFFER', 'HOLD', 'COMMIT', 'RELEASE', 'PACK', 'RESTOCK', 'CONDEMN', 'RETIRE', 'STATUS'))
  NOT VALID;
ALTER TABLE batch_ledger VALIDATE CONSTRAINT batch_ledger_event_type_check;

-- An order_stock row's batch and SKU must be those of its line.
CREATE UNIQUE INDEX IF NOT EXISTS batch_lines_id_batch_sku ON batch_lines (id, batch_id, sku);
ALTER TABLE order_stock ADD CONSTRAINT order_stock_line_matches
  FOREIGN KEY (line_id, batch_id, sku) REFERENCES batch_lines (id, batch_id, sku)
  NOT VALID;
ALTER TABLE order_stock VALIDATE CONSTRAINT order_stock_line_matches;
