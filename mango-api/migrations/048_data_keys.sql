-- Data keys and migration checksums (architecture review, TD-13 and missing keys).
-- Expand-only: one nullable column, and checks and foreign keys that every write
-- of this release and of the previous one already satisfies. 049 validates them.
--
-- locks: schema_migrations is a few dozen rows and only the migration runner
-- touches it. Every constraint below is added NOT VALID, so nothing is scanned:
-- ADD CHECK takes a brief ACCESS EXCLUSIVE lock on its table, and ADD FOREIGN KEY
-- a brief SHARE ROW EXCLUSIVE lock on both tables (orders, preorders and
-- bulk_listings stop taking writes for the moment it takes, not for a scan).

-- TD-13: the sha256 of each migration file as it was applied (src/migrate.js).
-- The runner fills it for files applied before this one, and refuses to start
-- when an applied file has changed since. NULL means "not recorded yet".
ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT;

-- Chargebacks point at the order or booking they are about (payments.js
-- handleDisputeEvent looks both up by payment id before it writes them), and hold
-- only the statuses Razorpay sends: the dispute entity's status, or the event's
-- last word (payment.dispute.created, .under_review, .action_required, .won,
-- .lost, .closed). Orders and bookings are never deleted, only anonymised.
ALTER TABLE payment_disputes ADD CONSTRAINT payment_disputes_order_fk
  FOREIGN KEY (order_id) REFERENCES orders (id) NOT VALID;
ALTER TABLE payment_disputes ADD CONSTRAINT payment_disputes_preorder_fk
  FOREIGN KEY (preorder_id) REFERENCES preorders (id) NOT VALID;
ALTER TABLE payment_disputes ADD CONSTRAINT payment_disputes_status_known
  CHECK (status IN ('open', 'created', 'under_review', 'action_required', 'won', 'lost', 'closed')) NOT VALID;

-- A second payment is never a negative amount. (It may have no order or booking:
-- a payment that matched nothing is refunded from this table too, recovery.js and
-- replay-payments, so there is no "order or booking" check.)
ALTER TABLE duplicate_payments ADD CONSTRAINT duplicate_payments_amount_not_negative
  CHECK (amount IS NULL OR amount >= 0) NOT VALID;

-- Order lines are never priced below zero (a free replacement is 0), and a bulk
-- line points at a listing that exists. Listings are archived, never deleted
-- (admin/bulk.js), so the key never stops a write.
ALTER TABLE order_items ADD CONSTRAINT order_items_price_not_negative
  CHECK (unit_price >= 0 AND line_price >= 0) NOT VALID;
ALTER TABLE order_items ADD CONSTRAINT order_items_listing_fk
  FOREIGN KEY (listing_id) REFERENCES bulk_listings (id) NOT VALID;
