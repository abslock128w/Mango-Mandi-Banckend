-- The receipt-worthy facts of an order's payment, from the Razorpay payment it was paid with: method,
-- payment id, UPI reference (RRN), masked UPI ID, card network and last four, bank or wallet, time.
-- Printed on the bill and shown on the shop's order page. Null for orders paid before this.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_details JSONB;
