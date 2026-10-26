-- Audit leftovers A (24 Oct 2026 audit: DB-03, DB-07, DB-08). Expand-only:
-- indexes, and checks that the previous release already satisfies on every
-- write, so old and new code both keep working while they serve together.
--
-- locks: each CREATE INDEX blocks writes on its table while it builds. The
-- largest is batch_ledger (one row per stock movement: tens of thousands in a
-- season, 200k in the audit's load data, where the build took well under a
-- second); the rest have one row per order, claim, rating, login code or quote.
-- The checks are NOT VALID, so they only take a brief lock and check new rows;
-- old rows are left to a later VALIDATE (see docs/audit-2026-10-24-status-A.md).

-- DB-03: the ledger audit (inventory.js auditLedger, run by Needs attention and
-- the hourly audit) sums delta per batch, SKU and event type. With this index
-- it reads the index alone instead of every ledger row ever written.
CREATE INDEX IF NOT EXISTS batch_ledger_audit_idx ON batch_ledger (batch_id, sku, event_type) INCLUDE (delta);

-- DB-07: money columns are never negative, and refund_status holds only the
-- states the code writes (payments.js, admin/recovery.js).
ALTER TABLE orders ADD CONSTRAINT orders_money_not_negative
  CHECK (subtotal >= 0 AND total >= 0 AND (payment_amount IS NULL OR payment_amount >= 0)) NOT VALID;
ALTER TABLE orders ADD CONSTRAINT orders_refund_status_known
  CHECK (refund_status IS NULL OR refund_status IN ('pending', 'processed', 'failed', 'manual')) NOT VALID;
ALTER TABLE preorders ADD CONSTRAINT preorders_refund_status_known
  CHECK (refund_status IS NULL OR refund_status IN ('pending', 'processed', 'failed', 'manual')) NOT VALID;
ALTER TABLE duplicate_payments ADD CONSTRAINT duplicate_payments_refund_status_known
  CHECK (refund_status IS NULL OR refund_status IN ('pending', 'processed', 'failed', 'manual')) NOT VALID;

-- DB-08: the once-a-minute cleanup deletes by these columns (maintenance.js
-- cleanupExpired), and these foreign keys are looked up or checked when a
-- claim is filed, an order is replaced, a preorder converts or an account is
-- erased. Without an index each is a scan of the whole table.
CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx ON idempotency_keys (created_at);
CREATE INDEX IF NOT EXISTS processed_webhooks_created_idx ON processed_webhooks (created_at);
CREATE INDEX IF NOT EXISTS quotes_expires_idx ON quotes (expires_at);
CREATE INDEX IF NOT EXISTS otps_expires_idx ON otps (expires_at);
CREATE INDEX IF NOT EXISTS claims_order_idx ON claims (order_id);
CREATE INDEX IF NOT EXISTS claims_replacement_order_idx ON claims (replacement_order_id) WHERE replacement_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_replacement_for_idx ON orders (replacement_for) WHERE replacement_for IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_preorder_idx ON orders (preorder_id) WHERE preorder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_stock_alert_idx ON notifications (stock_alert_id) WHERE stock_alert_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS order_ratings_customer_idx ON order_ratings (customer_id);
CREATE INDEX IF NOT EXISTS claim_photos_customer_idx ON claim_photos (customer_id);
