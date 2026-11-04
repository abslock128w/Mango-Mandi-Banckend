-- Rider app (rider-app/, docs/rider-app/): pickup and door photos with GPS and a
-- mango check, hashed delivery codes, rider sign-in by phone on a bound device,
-- rider positions for the panel, and the delivery code as its own WhatsApp
-- authentication message.
--
-- Additive only: new columns (nullable or with a default), new tables and a
-- wider kind check, so the previous release keeps running on this schema
-- (n-minus-1). The plaintext orders.delivery_code is no longer written by this
-- release; it is dropped by migrations-pending/056_drop_delivery_code.sql in the
-- release after this one. Rollback: the previous release ignores the new columns.
--
-- locks: delivery_photos and admin_users are small; the new orders columns are
-- nullable without a default (a catalogue change, no rewrite); the notifications
-- kind check is added NOT VALID and validated in a later file.

-- Each photo says which step of the delivery it proves, where and when it was taken
-- (the phone's GPS and clock at the shutter), and for the open box the mango check.
ALTER TABLE delivery_photos ADD COLUMN step TEXT CHECK (step IN ('pickup', 'door', 'open_box', 'attempt'));
ALTER TABLE delivery_photos ADD COLUMN lat NUMERIC(9, 6) CHECK (lat BETWEEN -90 AND 90);
ALTER TABLE delivery_photos ADD COLUMN lng NUMERIC(9, 6) CHECK (lng BETWEEN -180 AND 180);
ALTER TABLE delivery_photos ADD COLUMN accuracy NUMERIC(8, 1) CHECK (accuracy >= 0);
ALTER TABLE delivery_photos ADD COLUMN taken_at TIMESTAMPTZ;
-- The delivery attempt the photo belongs to (orders.delivery_failures + 1 when taken).
ALTER TABLE delivery_photos ADD COLUMN attempt INT CHECK (attempt >= 1);
-- The phone's own id for the photo: a resend after a lost answer is the same photo.
ALTER TABLE delivery_photos ADD COLUMN client_id TEXT CHECK (client_id ~ '^[A-Za-z0-9_-]{8,64}$');
-- The model's answer (src/mango-check.js), whether it passed, and whether a person must look.
ALTER TABLE delivery_photos ADD COLUMN verdict JSONB;
ALTER TABLE delivery_photos ADD COLUMN check_passed BOOLEAN;
ALTER TABLE delivery_photos ADD COLUMN checked_at TIMESTAMPTZ;
ALTER TABLE delivery_photos ADD COLUMN needs_review BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX delivery_photos_client_uq ON delivery_photos (order_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX delivery_photos_step_idx ON delivery_photos (order_id, step, created_at);
CREATE INDEX delivery_photos_created_idx ON delivery_photos (created_at) WHERE removed_at IS NULL;

-- The delivery code, hashed. The 4 digits are derived from the nonce with the
-- server's pepper (src/delivery-code.js), so the shop page and the WhatsApp message
-- can still show them, and a copy of the database alone reveals none.
ALTER TABLE orders ADD COLUMN delivery_code_hash TEXT;
ALTER TABLE orders ADD COLUMN delivery_code_nonce TEXT;
-- Leave at the door or with someone (a photo and who took it, no code): only after a
-- manager allows it for this order, saying why (or the customer said yes on WhatsApp).
ALTER TABLE orders ADD COLUMN handover_override_by TEXT;
ALTER TABLE orders ADD COLUMN handover_override_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN handover_override_reason TEXT CHECK (length(handover_override_reason) <= 300);

-- Riders sign in on their phone with their number (a login code), then a PIN.
ALTER TABLE admin_users ADD COLUMN phone TEXT CHECK (phone ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE admin_users ADD COLUMN display_name TEXT CHECK (length(display_name) BETWEEN 1 AND 80);
CREATE UNIQUE INDEX admin_users_phone_uq ON admin_users (phone) WHERE phone IS NOT NULL;

-- Login codes for riders, kept apart from customers' (otps): a rider's number may
-- also be a customer's, and neither sign-in may use the other's code.
CREATE TABLE rider_otps (
  phone      TEXT PRIMARY KEY CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  code_hash  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL
);

-- A rider's phone. Its refresh token and PIN are stored hashed; a manager revokes
-- a lost phone from Staff, which ends its sessions.
CREATE TABLE rider_devices (
  id             TEXT PRIMARY KEY,
  rider_id       TEXT NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  device_id      TEXT NOT NULL CHECK (device_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  label          TEXT CHECK (length(label) <= 120),
  pin_hash       TEXT,
  pin_failures   INT NOT NULL DEFAULT 0 CHECK (pin_failures >= 0),
  refresh_hash   TEXT,
  unlocked_until TIMESTAMPTZ,
  last_seen_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  revoked_by     TEXT
);
CREATE UNIQUE INDEX rider_devices_live_uq ON rider_devices (rider_id, device_id) WHERE revoked_at IS NULL;

-- Where riders were while a run was on (at most one row per rider per 20 seconds).
-- The panel shows the last one; the cleanup step deletes rows older than 30 days.
CREATE TABLE rider_locations (
  id       TEXT PRIMARY KEY,
  rider_id TEXT NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  lat      NUMERIC(9, 6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng      NUMERIC(9, 6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy NUMERIC(8, 1) CHECK (accuracy >= 0),
  at       TIMESTAMPTZ NOT NULL
);
CREATE INDEX rider_locations_rider_idx ON rider_locations (rider_id, at DESC);

-- The delivery code goes in its own authentication template (Meta forbids codes in utility ones).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'ORDER_CONFIRMED','REPLACEMENT_CONFIRMED','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','CANCELLED','REFUNDED',
  'PREORDER_BOOKED','PREORDER_SPOT_OPEN','PREORDER_MOVED','DATE_MOVED','GIFT_OUT_FOR_DELIVERY',
  'RIPENESS_GUIDE','BACK_IN_STOCK','REORDER_REMINDER','REVIEW_REQUEST',
  'CLAIM_RECEIVED','CLAIM_REJECTED','REFERRAL_REWARD','MANAGER_DAILY_SUMMARY','HELP_REPLY','SUBSCRIPTION_DUE',
  'DELIVERY_CODE','GIFT_DELIVERY_CODE')) NOT VALID;
