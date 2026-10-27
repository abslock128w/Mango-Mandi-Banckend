-- Growth (docs/growth.md): refer a friend (REFERRALS), the shop's anonymous
-- funnel (FUNNEL_ANALYTICS) and the managers' evening WhatsApp summary
-- (MANAGER_DAILY_SUMMARY). Each switch is off unless set; with it off nothing
-- writes these tables.
--
-- locks: new tables, and on existing tables only nullable columns without a
-- default (or a constant default, which Postgres stores without a rewrite).
-- The two notifications checks are re-added NOT VALID, so they do not scan the
-- table under the lock; every existing row already passes the wider checks.
-- Expand-only: the previous release never reads the new tables or columns.

-- ---------------------------------------------------------------- referrals

-- Each customer's own code, made the first time the Account page asks for it
-- and never changed afterwards (the share link stays the same).
CREATE TABLE referral_codes (
  customer_id TEXT PRIMARY KEY REFERENCES customers (id) ON DELETE CASCADE,
  code        TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{6,12}$'),
  created_at  TIMESTAMPTZ NOT NULL
);

-- One per new customer (friend): who referred them, and where it stands.
-- PENDING until the friend's first paid order ends; then REWARDED (both got a
-- one-time code, or the friend did and the referrer was over the monthly cap)
-- or VOID with the reason (cancelled, too small, same address as the referrer…).
CREATE TABLE referrals (
  id                 TEXT PRIMARY KEY,
  referrer_id        TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  friend_id          TEXT NOT NULL UNIQUE REFERENCES customers (id) ON DELETE CASCADE,
  code               TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'REWARDED', 'VOID')),
  void_reason        TEXT,
  -- The friend's first paid order, once there is one.
  order_id           TEXT REFERENCES orders (id),
  -- The referrer's thank-you was not given: they had reached REFERRAL_MAX_PER_MONTH.
  referrer_capped    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL,
  settled_at         TIMESTAMPTZ,
  CHECK (referrer_id <> friend_id)
);
CREATE INDEX referrals_referrer_idx ON referrals (referrer_id, created_at DESC);
CREATE INDEX referrals_pending_idx ON referrals (created_at) WHERE status = 'PENDING';

-- The one-time promo codes a referral gave, one per side. UNIQUE (referral_id,
-- role) is what makes a reward exactly once, whatever retries.
CREATE TABLE referral_rewards (
  id          TEXT PRIMARY KEY,
  referral_id TEXT NOT NULL REFERENCES referrals (id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('REFERRER', 'FRIEND')),
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  promo_code  TEXT NOT NULL UNIQUE REFERENCES promo_codes (code),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ NOT NULL,
  UNIQUE (referral_id, role)
);
CREATE INDEX referral_rewards_customer_idx ON referral_rewards (customer_id, created_at);

-- A promo code only its owner may use (a referral thank-you). NULL: anyone, as before.
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS owner_customer_id TEXT;

-- ---------------------------------------------------------------- funnel

-- One row per browser, step and IST day: the shop's random per-browser id
-- (crypto.randomUUID, kept in that browser only) and nothing else about the
-- person. Deleted after 90 days (retention.js), once rolled up into funnel_daily.
CREATE TABLE funnel_events (
  day        DATE NOT NULL,
  browser_id TEXT NOT NULL CHECK (browser_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  step       TEXT NOT NULL CHECK (step IN ('visit', 'product_view', 'add_to_cart', 'checkout_start', 'paid')),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (day, step, browser_id)
);

-- Which browser started the checkout of an unpaid order, so the server can
-- record "paid" for it when the payment is captured. Deleted at that moment, or
-- after a day if the order is never paid.
CREATE TABLE funnel_checkouts (
  order_id   TEXT PRIMARY KEY REFERENCES orders (id) ON DELETE CASCADE,
  browser_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

-- Browsers per step per day: kept after the events are gone.
CREATE TABLE funnel_daily (
  day        DATE NOT NULL,
  step       TEXT NOT NULL,
  browsers   INTEGER NOT NULL CHECK (browsers >= 0),
  rolled_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (day, step)
);

-- ---------------------------------------------------------------- manager daily summary

-- A manager who wants the evening summary on WhatsApp, and where to send it.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS daily_summary_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS daily_summary_phone TEXT;

-- One per manager per IST day: the numbers as they stood when it was made.
-- The primary key is what makes it exactly once a day.
CREATE TABLE manager_summaries (
  id         TEXT NOT NULL UNIQUE,
  day        DATE NOT NULL,
  admin_id   TEXT NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  numbers    JSONB NOT NULL,
  params     JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (day, admin_id)
);

-- ---------------------------------------------------------------- messages

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS referral_reward_id TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS manager_summary_id TEXT;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_target;
ALTER TABLE notifications ADD CONSTRAINT notifications_target CHECK (
  order_id IS NOT NULL OR preorder_id IS NOT NULL OR stock_alert_id IS NOT NULL
  OR referral_reward_id IS NOT NULL OR manager_summary_id IS NOT NULL) NOT VALID;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'ORDER_CONFIRMED','REPLACEMENT_CONFIRMED','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','CANCELLED','REFUNDED',
  'PREORDER_BOOKED','PREORDER_SPOT_OPEN','PREORDER_MOVED','DATE_MOVED','GIFT_OUT_FOR_DELIVERY',
  'RIPENESS_GUIDE','BACK_IN_STOCK','REORDER_REMINDER','REVIEW_REQUEST',
  'CLAIM_RECEIVED','CLAIM_REJECTED','REFERRAL_REWARD','MANAGER_DAILY_SUMMARY')) NOT VALID;
