-- Payment fixes from the 2026-10-19 audit.
-- locks: the three indexes lock writes on orders, preorders and notifications while
-- they build. This ships before launch, when those tables are small (seconds at most).

-- How each refund ended at Razorpay: 'pending' when it is created,
-- 'processed' or 'failed' from Razorpay's refund webhooks. A failed refund is
-- reopened (refunded_at cleared) so the maintenance loop sends a new one.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_status TEXT;
ALTER TABLE preorders ADD COLUMN IF NOT EXISTS refund_status TEXT;
ALTER TABLE duplicate_payments ADD COLUMN IF NOT EXISTS refund_status TEXT;

-- When the reconcile loop last asked Razorpay about an unpaid order, so
-- abandoned checkouts are polled with a back-off and can't crowd out new ones.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reconcile_checked_at TIMESTAMPTZ;
ALTER TABLE preorders ADD COLUMN IF NOT EXISTS reconcile_checked_at TIMESTAMPTZ;

-- A Razorpay payment pays for one order or one booking, never two.
CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_id_key ON orders (payment_id) WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS preorders_payment_id_key ON preorders (payment_id) WHERE payment_id IS NOT NULL;

-- Meta's delivery reports (delivered, read, failed) for messages we sent.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivery_status TEXT;
CREATE INDEX IF NOT EXISTS notifications_provider_id_idx ON notifications (provider_id) WHERE provider_id IS NOT NULL;
