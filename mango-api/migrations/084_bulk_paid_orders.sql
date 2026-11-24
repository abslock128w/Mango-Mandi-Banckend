-- Bulk orders paid at once, bulk prices, enquiries from 250 kg and farm visits from 100 kg (mango-api/README.md,
-- Bulk orders; docs/farm-experience.md).
--
-- 1. products.bulk_price: a manager's own bulk price for a box, in paise (NULL: the shop price less the default
--    bulk discount, the rule bulkDiscountPct, 25 unless changed). The 10 kg bulk box is two of the 5 kg box's fruit,
--    so it costs twice the 5 kg box's bulk price (src/bulk-price.js).
-- 2. bulk_enquiries: a bulk ORDER (kind ORDER) is now paid when it is placed, by a Razorpay payment link, as a
--    pre-order is: the delivery address, the priced lines' totals (worked out on the server), the payment, its
--    refund (the same lease and back-off columns as orders and preorders) and the order's own steps. New statuses
--    for it: PAYMENT_PENDING (30 minutes to pay), PAID, CONFIRMED (our team called), DISPATCHED, DELIVERED and
--    CANCELLED. Enquiries keep NEW, QUOTED, ACCEPTED, DECLINED and CLOSED, and so do the direct orders placed
--    before payment came in (they stay NEW until staff close them).
-- 3. duplicate_payments.bulk_enquiry_id: a second payment on a bulk order's link, refunded like any duplicate.
-- 4. notifications: the BULK_ORDER_PAID message ("bulk order received and paid").
-- 5. farm_bookings: the farm visit minimum is 100 kg now (farm/settings.js MIN_KG), not 250.
--
-- The deploy window: the previous release never reads the new columns. While both run, its shop route still takes
-- an unpaid direct order (status NEW, as before) and refuses enquiries; its panel lists the new statuses by name
-- and its maintenance never expires or refunds a bulk order (the new release does, a minute later). Expand-only:
-- every check here is widened (dropped and made again under the same name, NOT VALID), and 085 validates them.
-- locks: ADD COLUMN with no default or a constant one is a catalogue change under a brief ACCESS EXCLUSIVE lock; the
-- inline CHECKs and the REFERENCES on new, empty columns read bulk_enquiries, products and duplicate_payments once
-- (all small: a few hundred rows at most); the indexes on bulk_enquiries (small) are partial and cover no row yet.

ALTER TABLE products ADD COLUMN IF NOT EXISTS bulk_price INTEGER CHECK (bulk_price IS NULL OR bulk_price > 0);

ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS delivery_address TEXT CHECK (delivery_address IS NULL OR length(delivery_address) <= 500);
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS pincode TEXT CHECK (pincode IS NULL OR pincode ~ '^[0-9]{6}$');
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS shop_value INTEGER CHECK (shop_value IS NULL OR shop_value >= 0);
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS subtotal INTEGER CHECK (subtotal IS NULL OR subtotal >= 0);
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS delivery_fee INTEGER CHECK (delivery_fee IS NULL OR delivery_fee >= 0);
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS total INTEGER CHECK (total IS NULL OR total > 0);
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS payment_status TEXT CHECK (payment_status IS NULL OR payment_status IN ('INITIATED', 'SUCCEEDED', 'REFUNDED', 'CANCELLED'));
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS payment_link_id TEXT;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS payment_link_url TEXT;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS payment_started_at TIMESTAMPTZ;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS reconcile_checked_at TIMESTAMPTZ;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS payment_id TEXT;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS payment_details JSONB;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS paid_amount INTEGER;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS refund_requested_at TIMESTAMPTZ;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS refund_id TEXT;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS refund_status TEXT;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS refund_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS refund_attempted_at TIMESTAMPTZ;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS refund_next_attempt_at TIMESTAMPTZ;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS refund_gave_up_at TIMESTAMPTZ;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS refund_checked_at TIMESTAMPTZ;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS customer_cancelled_at TIMESTAMPTZ;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS staff_cancelled_at TIMESTAMPTZ;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS cancel_reason TEXT CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 500);
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

ALTER TABLE bulk_enquiries DROP CONSTRAINT IF EXISTS bulk_enquiries_status_check;
ALTER TABLE bulk_enquiries ADD CONSTRAINT bulk_enquiries_status_check CHECK (status IN (
  'NEW', 'QUOTED', 'ACCEPTED', 'DECLINED', 'CLOSED',
  'PAYMENT_PENDING', 'PAID', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'CANCELLED')) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS bulk_enquiries_link_idx ON bulk_enquiries (payment_link_id) WHERE payment_link_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bulk_enquiries_payment_idx ON bulk_enquiries (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bulk_enquiries_unpaid_idx ON bulk_enquiries (hold_expires_at) WHERE status = 'PAYMENT_PENDING';
CREATE INDEX IF NOT EXISTS bulk_enquiries_refund_due_idx ON bulk_enquiries (refund_requested_at) WHERE refund_requested_at IS NOT NULL AND refunded_at IS NULL;

ALTER TABLE duplicate_payments ADD COLUMN IF NOT EXISTS bulk_enquiry_id TEXT REFERENCES bulk_enquiries (id);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'ORDER_CONFIRMED','REPLACEMENT_CONFIRMED','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','CANCELLED','REFUNDED',
  'PREORDER_BOOKED','PREORDER_SPOT_OPEN','PREORDER_MOVED','DATE_MOVED','GIFT_OUT_FOR_DELIVERY',
  'RIPENESS_GUIDE','BACK_IN_STOCK','REORDER_REMINDER','REVIEW_REQUEST',
  'CLAIM_RECEIVED','CLAIM_REJECTED','REFERRAL_REWARD','MANAGER_DAILY_SUMMARY','HELP_REPLY','SUBSCRIPTION_DUE',
  'DELIVERY_CODE','GIFT_DELIVERY_CODE',
  'PARTNER_ENQUIRY_RECEIVED','PARTNER_TEAM_ALERT',
  'BULK_ENQUIRY_RECEIVED','BULK_QUOTE','BULK_ORDER_PAID',
  'FARM_BOOKING_UPDATE','FARM_TEAM_ALERT',
  'PREORDER_DELAYED','PREORDER_EARLIER','ORDER_DELAYED')) NOT VALID;

ALTER TABLE farm_bookings DROP CONSTRAINT IF EXISTS farm_bookings_kg_check;
ALTER TABLE farm_bookings ADD CONSTRAINT farm_bookings_kg_check CHECK (kg >= 100) NOT VALID;
