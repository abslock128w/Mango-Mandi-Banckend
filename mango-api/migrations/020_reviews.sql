-- Customer reviews: verified-purchase star ratings, comments and photos on a
-- delivered order line, held for staff moderation before anything is public.
-- Reviews only read orders and batches; they never touch stock, payments,
-- refunds or claims.

CREATE TABLE reviews (
  id                TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES orders(id),
  -- One review per order line (a SKU at one ripeness).
  order_item_id     TEXT NOT NULL UNIQUE REFERENCES order_items(id),
  customer_id       TEXT NOT NULL REFERENCES customers(id),
  sku               TEXT NOT NULL REFERENCES products(sku),
  -- Copied when the review is written, so renaming a product keeps them right.
  variety           TEXT NOT NULL,
  stage             TEXT CHECK (stage IN ('RAW','SEMI_RIPE','RIPE')),
  rating            SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  taste             SMALLINT CHECK (taste BETWEEN 1 AND 5),
  ripeness_accuracy SMALLINT CHECK (ripeness_accuracy BETWEEN 1 AND 5),
  packaging         SMALLINT CHECK (packaging BETWEEN 1 AND 5),
  delivery          SMALLINT CHECK (delivery BETWEEN 1 AND 5),
  comment           TEXT CHECK (char_length(comment) <= 1000),
  anonymous         BOOLEAN NOT NULL DEFAULT FALSE,
  -- "Ravi K." or "Anonymous": worked out once, so the public list never reads customers.
  display_name      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','HIDDEN','DELETED')),
  -- Text that looks like a link, phone number, email or profanity: still pending, shown first to staff.
  flagged           BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reasons      TEXT[] NOT NULL DEFAULT '{}',
  delivered_at      TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL,
  editable_until    TIMESTAMPTZ NOT NULL,
  moderated_by      TEXT,
  moderated_at      TIMESTAMPTZ,
  moderation_reason TEXT,
  -- Set when the customer deleted their account: name, text and photos are gone, the stars stay.
  scrubbed_at       TIMESTAMPTZ
);
-- The public list: approved reviews for a product or a variety, newest first.
CREATE INDEX reviews_public_sku_idx ON reviews (sku, created_at DESC, id DESC) WHERE status = 'APPROVED';
CREATE INDEX reviews_public_variety_idx ON reviews (variety, created_at DESC, id DESC) WHERE status = 'APPROVED';
-- The moderation queue.
CREATE INDEX reviews_queue_idx ON reviews (status, flagged, created_at);
CREATE INDEX reviews_customer_idx ON reviews (customer_id, created_at DESC);
CREATE INDEX reviews_order_idx ON reviews (order_id);

-- Photos are uploaded first, then attached when the review is sent. A photo
-- is public only when staff approved it and its review is approved.
CREATE TABLE review_photos (
  id          TEXT PRIMARY KEY,
  review_id   TEXT REFERENCES reviews(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  mime        TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  width       INTEGER,
  height      INTEGER,
  bytes       BYTEA,
  blob_path   TEXT,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  created_at  TIMESTAMPTZ NOT NULL,
  removed_at  TIMESTAMPTZ,
  CONSTRAINT review_photos_stored CHECK (bytes IS NOT NULL OR blob_path IS NOT NULL OR removed_at IS NOT NULL)
);
CREATE INDEX review_photos_review_idx ON review_photos (review_id);
CREATE INDEX review_photos_loose_idx ON review_photos (created_at) WHERE review_id IS NULL;
CREATE INDEX review_photos_customer_idx ON review_photos (customer_id);

-- One public reply from the brand per review.
CREATE TABLE review_replies (
  review_id  TEXT PRIMARY KEY REFERENCES reviews(id),
  body       TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  admin_id   TEXT,
  admin_email TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- Every status change: who, when and why.
CREATE TABLE review_events (
  id          TEXT PRIMARY KEY,
  review_id   TEXT NOT NULL REFERENCES reviews(id),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor       TEXT NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX review_events_review_idx ON review_events (review_id, created_at);

-- Which batches filled the reviewed line (from order_stock, at the time of
-- the review), so ripeness accuracy can be read per batch and variety.
CREATE TABLE review_batches (
  review_id TEXT NOT NULL REFERENCES reviews(id),
  batch_id  TEXT NOT NULL REFERENCES batches(id),
  quantity  INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (review_id, batch_id)
);
CREATE INDEX review_batches_batch_idx ON review_batches (batch_id);

-- Totals of APPROVED reviews per SKU and per variety, kept in step in the
-- same transaction as every change, so the shop never adds them up on the fly.
CREATE TABLE review_stats (
  scope       TEXT NOT NULL CHECK (scope IN ('SKU','VARIETY')),
  key         TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  rating_sum  INTEGER NOT NULL DEFAULT 0 CHECK (rating_sum >= 0),
  stars_1     INTEGER NOT NULL DEFAULT 0 CHECK (stars_1 >= 0),
  stars_2     INTEGER NOT NULL DEFAULT 0 CHECK (stars_2 >= 0),
  stars_3     INTEGER NOT NULL DEFAULT 0 CHECK (stars_3 >= 0),
  stars_4     INTEGER NOT NULL DEFAULT 0 CHECK (stars_4 >= 0),
  stars_5     INTEGER NOT NULL DEFAULT 0 CHECK (stars_5 >= 0),
  with_photos INTEGER NOT NULL DEFAULT 0 CHECK (with_photos >= 0),
  updated_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, key)
);

-- idempotency_keys.request_hash (018_launch_review) refuses a reused
-- Idempotency-Key with a different body; review sends use it too.

-- "How were your mangoes?" about a day after delivery (template mandi_review_request).
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'ORDER_CONFIRMED','REPLACEMENT_CONFIRMED','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','CANCELLED','REFUNDED',
  'PREORDER_BOOKED','PREORDER_SPOT_OPEN','PREORDER_MOVED','DATE_MOVED','GIFT_OUT_FOR_DELIVERY',
  'RIPENESS_GUIDE','BACK_IN_STOCK','REORDER_REMINDER','REVIEW_REQUEST'));

-- The review-request job looks up deliveries from a day or two ago.
CREATE INDEX order_events_delivered_idx ON order_events (created_at) WHERE status = 'DELIVERED';
