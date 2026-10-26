-- Customer care (docs/care.md): the help centre's requests and their message
-- threads (HELP_CENTRE), and mango season subscriptions with one row per
-- delivery cycle (SUBSCRIPTIONS). Both switches are off unless set; with them
-- off nothing writes to these tables.
--
-- locks: four new tables (nothing existing is scanned or rewritten), two new
-- nullable columns on notifications and one on push_messages (no default, so no
-- rewrite: a brief lock each). The notifications checks are dropped and re-added
-- NOT VALID, so they do not scan the outbox under that lock; every existing row
-- already holds one of the older kinds and targets. The two partial indexes on
-- notifications block its writes while they build: a read of the outbox (kept
-- 180 days, a few rows per order) that took well under a second for 038's
-- index of the same kind; every row is skipped (the new columns are NULL).
-- Expand-only: the previous
-- release never reads these tables or columns and keeps working while both serve.
--
-- customer_id is ON DELETE CASCADE, as in 036: the only hard delete of a
-- customer is the account join (POST /v1/me/phone/verify), which moves these
-- rows to the joined account first.

-- ---------------------------------------------------------------- help centre

CREATE SEQUENCE help_ticket_seq START 1001;

-- One help request: a topic from a fixed list, optionally about one of the
-- customer's orders. OPEN waits on the shop, WAITING_CUSTOMER on the customer
-- (staff replied), RESOLVED is closed (either side can reopen it by writing).
CREATE TABLE help_tickets (
  id               TEXT PRIMARY KEY,
  number           TEXT NOT NULL UNIQUE,
  customer_id      TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  order_id         TEXT REFERENCES orders (id),
  topic            TEXT NOT NULL CHECK (topic IN ('DELIVERY', 'PAYMENT', 'CHANGE_ORDER', 'SUBSCRIPTION', 'ACCOUNT', 'OTHER')),
  status           TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'WAITING_CUSTOMER', 'RESOLVED')),
  created_at       TIMESTAMPTZ NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL,
  last_customer_at TIMESTAMPTZ,
  last_staff_at    TIMESTAMPTZ,
  resolved_at      TIMESTAMPTZ,
  resolved_by      TEXT
);
CREATE INDEX help_tickets_customer_idx ON help_tickets (customer_id, created_at DESC);
CREATE INDEX help_tickets_inbox_idx ON help_tickets (status, updated_at DESC);
CREATE INDEX help_tickets_order_idx ON help_tickets (order_id) WHERE order_id IS NOT NULL;

-- The thread. A staff message keeps who wrote it (staff_id); the customer sees "MandiMangoes".
CREATE TABLE help_messages (
  id         TEXT PRIMARY KEY,
  ticket_id  TEXT NOT NULL REFERENCES help_tickets (id) ON DELETE CASCADE,
  author     TEXT NOT NULL CHECK (author IN ('CUSTOMER', 'STAFF')),
  staff_id   TEXT,
  body       TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX help_messages_ticket_idx ON help_messages (ticket_id, created_at);

-- ---------------------------------------------------------------- subscriptions

CREATE SEQUENCE subscription_seq START 1001;

-- A standing order: one box (product, ripeness, count) every week or fortnight
-- on a weekday, in a slot, to an address copied from the customer's saved ones,
-- until end_date (never past SUBSCRIPTION_SEASON_END). No money is taken here:
-- each cycle becomes an ordinary unpaid order when the customer taps Pay.
-- active_from: the first nominal date the scheduler may use (the start, or the
-- day it was resumed), so dates passed while paused are not counted as missed.
CREATE TABLE subscriptions (
  id               TEXT PRIMARY KEY,
  number           TEXT NOT NULL UNIQUE,
  customer_id      TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  sku              TEXT NOT NULL,
  stage            TEXT NOT NULL CHECK (stage IN ('RAW', 'SEMI_RIPE', 'RIPE')),
  qty              INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 20),
  frequency        TEXT NOT NULL CHECK (frequency IN ('WEEKLY', 'FORTNIGHTLY')),
  first_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  active_from      DATE NOT NULL,
  slot_id          TEXT REFERENCES delivery_slots (id),
  customer_name    TEXT,
  delivery_address TEXT NOT NULL,
  pincode          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'CANCELLED')),
  created_at       TIMESTAMPTZ NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL,
  paused_at        TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  CHECK (end_date >= first_date)
);
CREATE INDEX subscriptions_customer_idx ON subscriptions (customer_id, created_at DESC);
CREATE INDEX subscriptions_active_idx ON subscriptions (status) WHERE status = 'ACTIVE';

-- One delivery of a subscription. UNIQUE (subscription_id, scheduled_for) is
-- what makes the scheduler create a cycle exactly once, however often it runs.
-- scheduled_for is the nominal date (first_date + n periods); delivery_date the
-- day it was booked for (later when that day was full or had no stock).
-- DUE: waiting for the customer to pay. ORDERED: Pay made order_id (its status
-- says whether it was paid). SKIPPED: the customer skipped it. MISSED: no day
-- with stock and room before the next cycle. CANCELLED: the subscription ended.
CREATE TABLE subscription_cycles (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  scheduled_for   DATE NOT NULL,
  delivery_date   DATE,
  slot_id         TEXT REFERENCES delivery_slots (id),
  status          TEXT NOT NULL CHECK (status IN ('DUE', 'ORDERED', 'SKIPPED', 'MISSED', 'CANCELLED')),
  order_id        TEXT REFERENCES orders (id),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL,
  UNIQUE (subscription_id, scheduled_for)
);
CREATE INDEX subscription_cycles_date_idx ON subscription_cycles (delivery_date) WHERE status IN ('DUE', 'ORDERED');
CREATE INDEX subscription_cycles_order_idx ON subscription_cycles (order_id) WHERE order_id IS NOT NULL;

-- What happened to a subscription and who did it: the customer's skips, pauses
-- and cancels, the scheduler's cycles, and staff pauses and cancels with the
-- reason they gave (also in staff_audit).
CREATE TABLE subscription_events (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  cycle_id        TEXT,
  action          TEXT NOT NULL,
  reason          TEXT,
  actor           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX subscription_events_sub_idx ON subscription_events (subscription_id, created_at);

-- ---------------------------------------------------------------- messages

-- The outbox also carries "we replied to your help request" and "pay for this
-- week's box" (both templates need Meta approval: WHATSAPP_CARE_UPDATES).
ALTER TABLE notifications ADD COLUMN help_ticket_id TEXT REFERENCES help_tickets (id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN subscription_cycle_id TEXT REFERENCES subscription_cycles (id) ON DELETE CASCADE;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_target;
ALTER TABLE notifications ADD CONSTRAINT notifications_target CHECK (
  order_id IS NOT NULL OR preorder_id IS NOT NULL OR stock_alert_id IS NOT NULL OR help_ticket_id IS NOT NULL OR subscription_cycle_id IS NOT NULL) NOT VALID;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'ORDER_CONFIRMED','REPLACEMENT_CONFIRMED','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','CANCELLED','REFUNDED',
  'PREORDER_BOOKED','PREORDER_SPOT_OPEN','PREORDER_MOVED','DATE_MOVED','GIFT_OUT_FOR_DELIVERY',
  'RIPENESS_GUIDE','BACK_IN_STOCK','REORDER_REMINDER','REVIEW_REQUEST',
  'CLAIM_RECEIVED','CLAIM_REJECTED','HELP_REPLY','SUBSCRIPTION_DUE')) NOT VALID;
CREATE INDEX notifications_help_idx ON notifications (help_ticket_id) WHERE help_ticket_id IS NOT NULL;
CREATE INDEX notifications_cycle_idx ON notifications (subscription_cycle_id) WHERE subscription_cycle_id IS NOT NULL;

-- A browser notification that is not about an order says where it opens
-- (/help/requests/<id>, /account/subscriptions/<id>).
ALTER TABLE push_messages ADD COLUMN link TEXT;
