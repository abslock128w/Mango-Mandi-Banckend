-- Bulk enquiries (docs/bulk-enquiries.md): the shop's "send your bulk enquiry" form for orders above
-- 100 kg. Every enquiry lands here, staff price it on the panel (the requested boxes plus extra costs
-- such as special packaging) and send the quote back on WhatsApp; the customer sees it on the shop's
-- Account page and accepts or declines it there.
--
-- Expand-only: a new sequence, two new tables, two new nullable columns on notifications (no default,
-- so no rewrite) and the notifications checks widened NOT VALID (every existing row already passes
-- them; 061 validates them). The previous release never reads any of this.
-- locks: new tables only, plus a brief lock on notifications to add the columns, the NOT VALID checks
-- and a partial index whose rows are all NULL (as 058 did).

CREATE SEQUENCE bulk_enquiry_seq START 1;

CREATE TABLE bulk_enquiries (
  id               TEXT PRIMARY KEY,
  -- BLK-0001: shown to the customer and staff, said on the phone.
  number           TEXT NOT NULL UNIQUE,
  -- Set when the sender was signed in; an anonymous enquiry is found by its phone number once they sign in.
  customer_id      TEXT REFERENCES customers (id) ON DELETE SET NULL,
  name             TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  business         TEXT CHECK (business IS NULL OR length(business) <= 120),
  email            TEXT CHECK (email IS NULL OR length(email) <= 200),
  phone            TEXT NOT NULL CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  city             TEXT NOT NULL CHECK (length(city) BETWEEN 1 AND 100),
  notes            TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  -- The bulk list as sent: [{sku, stage, boxes, kg}]. Empty when they typed a quantity instead.
  lines            JSONB NOT NULL DEFAULT '[]'::jsonb,
  quantity_kg      INTEGER NOT NULL CHECK (quantity_kg > 0),
  ripeness         TEXT CHECK (ripeness IS NULL OR length(ripeness) <= 40),
  status           TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'QUOTED', 'ACCEPTED', 'DECLINED', 'CLOSED')),
  -- The latest quote, in paise: {lines:[{label, sku?, stage?, qty, unitPrice}], extras:[{label, amount}],
  -- note, validUntil, subtotal, extrasTotal, total}. A new quote replaces it (the old one stays in the events).
  quote            JSONB,
  quoted_at        TIMESTAMPTZ,
  quoted_by        TEXT REFERENCES admin_users (id) ON DELETE SET NULL,
  -- When the customer first opened the latest quote in the shop (cleared by a new quote).
  quote_seen_at    TIMESTAMPTZ,
  responded_at     TIMESTAMPTZ,
  customer_message TEXT CHECK (customer_message IS NULL OR length(customer_message) <= 1000),
  closed_at        TIMESTAMPTZ,
  -- The form's Idempotency-Key: a double tap or a retry is one enquiry.
  idempotency_key  TEXT UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL
);
CREATE INDEX bulk_enquiries_status_idx ON bulk_enquiries (status, created_at DESC);
CREATE INDEX bulk_enquiries_created_idx ON bulk_enquiries (created_at DESC, id);
CREATE INDEX bulk_enquiries_customer_idx ON bulk_enquiries (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX bulk_enquiries_phone_idx ON bulk_enquiries (phone);

-- What happened to an enquiry and who did it: received, quoted, seen, accepted, declined, noted, closed.
CREATE TABLE bulk_enquiry_events (
  id         TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL REFERENCES bulk_enquiries (id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('customer', 'staff', 'system')),
  actor_id   TEXT,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX bulk_enquiry_events_enquiry_idx ON bulk_enquiry_events (enquiry_id, created_at);

-- ---------------------------------------------------------------- messages

-- The outbox carries "we got your enquiry" and "your quote is ready" (WHATSAPP_BULK_UPDATES).
ALTER TABLE notifications ADD COLUMN bulk_enquiry_id TEXT REFERENCES bulk_enquiries (id) ON DELETE CASCADE;
-- The template's words, fixed when queued (name, number, and for a quote its total, summary and link).
ALTER TABLE notifications ADD COLUMN bulk_params JSONB;
-- Both checks keep everything 058 (Partner Network) allowed.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_target;
ALTER TABLE notifications ADD CONSTRAINT notifications_target CHECK (
  order_id IS NOT NULL OR preorder_id IS NOT NULL OR stock_alert_id IS NOT NULL
  OR referral_reward_id IS NOT NULL OR manager_summary_id IS NOT NULL
  OR help_ticket_id IS NOT NULL OR subscription_cycle_id IS NOT NULL OR partner_enquiry_id IS NOT NULL
  OR bulk_enquiry_id IS NOT NULL) NOT VALID;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'ORDER_CONFIRMED','REPLACEMENT_CONFIRMED','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','CANCELLED','REFUNDED',
  'PREORDER_BOOKED','PREORDER_SPOT_OPEN','PREORDER_MOVED','DATE_MOVED','GIFT_OUT_FOR_DELIVERY',
  'RIPENESS_GUIDE','BACK_IN_STOCK','REORDER_REMINDER','REVIEW_REQUEST',
  'CLAIM_RECEIVED','CLAIM_REJECTED','REFERRAL_REWARD','MANAGER_DAILY_SUMMARY','HELP_REPLY','SUBSCRIPTION_DUE',
  'DELIVERY_CODE','GIFT_DELIVERY_CODE',
  'PARTNER_ENQUIRY_RECEIVED','PARTNER_TEAM_ALERT',
  'BULK_ENQUIRY_RECEIVED','BULK_QUOTE')) NOT VALID;
CREATE INDEX notifications_bulk_idx ON notifications (bulk_enquiry_id) WHERE bulk_enquiry_id IS NOT NULL;
