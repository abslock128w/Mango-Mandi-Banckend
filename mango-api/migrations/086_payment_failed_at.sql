-- "Payment failed: try payment again" (the owner, 23 Nov 2026: "unpaid orders can have a button where after the payment
-- fails we tell them to retry"). When a payment attempt fails (Razorpay's payment.failed, the test-mode Fail button) the
-- order, pre-order or gift order stays unpaid and can be paid again until its hold ends; payment_failed_at records that the
-- last attempt failed, so Your orders, the order page and the pre-order sheet can say "Payment failed" with "Try payment
-- again". A booking of a several-people gift (preorder_groups) is marked on each of its bookings.
-- Nothing reads it but the customer's views; a previous release never writes it (the tag is then simply not shown).
-- Expand-only.
-- locks: ADD COLUMN with no default is a catalogue change under a brief ACCESS EXCLUSIVE lock on each table; no rewrite, no scan.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMPTZ;
ALTER TABLE preorders ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMPTZ;
ALTER TABLE gift_orders ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMPTZ;
