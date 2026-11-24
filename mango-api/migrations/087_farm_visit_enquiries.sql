-- Farm visit enquiries (mango-api/README.md, Bulk orders and enquiries; the owner, 23 Nov 2026: "for the farm tour the
-- person still sends an ENQUIRY, and it should show up properly in the admin panel").
--
-- A farm visit enquiry is a bulk_enquiries row of kind FARM_VISIT (numbered B… like every bulk record, labelled
-- "Farm visit" wherever it shows): who is asking, about how many kg (quantity_kg, 100 or more), which mango (or not
-- sure yet), a preferred visit date or "flexible", how many people, and later the date our team agreed with them.
-- Its own steps: NEW → CONTACTED (team called) → VISIT_PLANNED (with the agreed date) → VISITED, or CLOSED (with a
-- reason). The full Farm Experience booking (065) is untouched.
--
-- The deploy window: the previous release never reads the new columns; its panel lists a farm visit enquiry as a plain
-- enquiry and its status names as they are, and its routes never write FARM_VISIT. Expand-only: both checks on
-- bulk_enquiries are widened (dropped and made again under the same name) and validated here; the notifications kind
-- check is widened NOT VALID and validated in 088.
-- locks: ADD COLUMN with no default or a constant one is a catalogue change under a brief ACCESS EXCLUSIVE lock; the
-- inline CHECKs on the new, empty columns and the two VALIDATEs read bulk_enquiries (a few hundred rows at most) under
-- that lock; the partial index covers no row yet.

ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS farm_variety TEXT CHECK (farm_variety IS NULL OR length(farm_variety) BETWEEN 1 AND 80);
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS visit_date DATE;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS visit_flexible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS people INTEGER CHECK (people IS NULL OR people BETWEEN 1 AND 500);
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS planned_visit_date DATE;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS visit_planned_at TIMESTAMPTZ;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS visited_at TIMESTAMPTZ;
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS close_reason TEXT CHECK (close_reason IS NULL OR length(close_reason) <= 500);

ALTER TABLE bulk_enquiries DROP CONSTRAINT IF EXISTS bulk_enquiries_kind_check;
ALTER TABLE bulk_enquiries ADD CONSTRAINT bulk_enquiries_kind_check CHECK (kind IN ('ENQUIRY', 'ORDER', 'FARM_VISIT')) NOT VALID;
ALTER TABLE bulk_enquiries VALIDATE CONSTRAINT bulk_enquiries_kind_check;

ALTER TABLE bulk_enquiries DROP CONSTRAINT IF EXISTS bulk_enquiries_status_check;
ALTER TABLE bulk_enquiries ADD CONSTRAINT bulk_enquiries_status_check CHECK (status IN (
  'NEW', 'QUOTED', 'ACCEPTED', 'DECLINED', 'CLOSED',
  'PAYMENT_PENDING', 'PAID', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'CANCELLED',
  'CONTACTED', 'VISIT_PLANNED', 'VISITED')) NOT VALID;
ALTER TABLE bulk_enquiries VALIDATE CONSTRAINT bulk_enquiries_status_check;

CREATE INDEX IF NOT EXISTS bulk_enquiries_farm_new_idx ON bulk_enquiries (created_at) WHERE kind = 'FARM_VISIT' AND status = 'NEW';

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'ORDER_CONFIRMED','REPLACEMENT_CONFIRMED','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','CANCELLED','REFUNDED',
  'PREORDER_BOOKED','PREORDER_SPOT_OPEN','PREORDER_MOVED','DATE_MOVED','GIFT_OUT_FOR_DELIVERY',
  'RIPENESS_GUIDE','BACK_IN_STOCK','REORDER_REMINDER','REVIEW_REQUEST',
  'CLAIM_RECEIVED','CLAIM_REJECTED','REFERRAL_REWARD','MANAGER_DAILY_SUMMARY','HELP_REPLY','SUBSCRIPTION_DUE',
  'DELIVERY_CODE','GIFT_DELIVERY_CODE',
  'PARTNER_ENQUIRY_RECEIVED','PARTNER_TEAM_ALERT',
  'BULK_ENQUIRY_RECEIVED','BULK_QUOTE','BULK_ORDER_PAID','FARM_VISIT_ENQUIRY_RECEIVED',
  'FARM_BOOKING_UPDATE','FARM_TEAM_ALERT',
  'PREORDER_DELAYED','PREORDER_EARLIER','ORDER_DELAYED')) NOT VALID;
