-- PAY-02: when the refund's outcome was last asked of Razorpay, so the
-- maintenance job polls each pending refund about once an hour instead of
-- relying on the refund webhook alone.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_checked_at TIMESTAMPTZ;
ALTER TABLE preorders ADD COLUMN IF NOT EXISTS refund_checked_at TIMESTAMPTZ;
ALTER TABLE duplicate_payments ADD COLUMN IF NOT EXISTS refund_checked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS orders_refund_pending ON orders (refund_checked_at) WHERE refund_status = 'pending';
CREATE INDEX IF NOT EXISTS preorders_refund_pending ON preorders (refund_checked_at) WHERE refund_status = 'pending';
