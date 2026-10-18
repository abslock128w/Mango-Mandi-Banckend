-- Fixes from the architecture reviews (see deploy/VERCEL.md and the fix list).

-- Maintenance takes a lease row instead of holding a transaction open on the
-- pooler for the whole run. A run that dies (function timeout) loses the
-- lease when it expires.
CREATE TABLE job_leases (
  name       TEXT PRIMARY KEY,
  holder     TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Where a long pass (re-checking every open order) stopped when it ran out
-- of time; the next run carries on from there.
ALTER TABLE maintenance_runs ADD COLUMN cursor TEXT;

-- Rate limits shared by every serverless instance, and the daily SMS budget.
CREATE TABLE rate_limits (
  key      TEXT PRIMARY KEY,
  hits     INTEGER NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX rate_limits_reset_idx ON rate_limits (reset_at);

-- Missed deliveries: after the limit the order is not rescheduled again.
ALTER TABLE orders ADD COLUMN delivery_failures INTEGER NOT NULL DEFAULT 0;

-- A second payment captured on an order that was already paid (a double
-- charge). Each one is refunded; the order itself is not.
CREATE TABLE duplicate_payments (
  payment_id    TEXT PRIMARY KEY,
  order_id      TEXT REFERENCES orders(id),
  preorder_id   TEXT REFERENCES preorders(id),
  amount        INTEGER,
  found_at      TIMESTAMPTZ NOT NULL,
  attempted_at  TIMESTAMPTZ,
  refund_id     TEXT,
  refunded_at   TIMESTAMPTZ,
  last_error    TEXT
);
CREATE INDEX duplicate_payments_due_idx ON duplicate_payments (found_at) WHERE refunded_at IS NULL;

-- Account deletion removes delivery photos too. The row stays (the delivery
-- record points at it) but the image is gone.
ALTER TABLE delivery_photos ADD COLUMN removed_at TIMESTAMPTZ;
ALTER TABLE delivery_photos DROP CONSTRAINT delivery_photos_stored;
ALTER TABLE delivery_photos ADD CONSTRAINT delivery_photos_stored CHECK (bytes IS NOT NULL OR blob_path IS NOT NULL OR removed_at IS NOT NULL);
