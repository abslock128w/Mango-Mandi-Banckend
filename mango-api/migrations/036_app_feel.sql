-- App feel (roadmap step 3, docs/app-feel.md): browser push subscriptions and
-- their outbox, and customers' favourite boxes. Live tracking needs no schema
-- (it reads the rider's run from orders); its minutes per stop is a selling
-- rule in app_config.
--
-- locks: new tables only, so nothing that already exists is locked, scanned or
-- rewritten. Expand-only: the previous release never reads these tables and
-- keeps working while both versions serve.

-- One row per browser that said yes to notifications on the Account page. The
-- endpoint is the push service's URL for that browser (a capability URL: never
-- logged in full); p256dh and auth are the browser's keys for encrypting the
-- message (RFC 8291). A browser belongs to whoever signed in on it last.
CREATE TABLE push_subscriptions (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT NOT NULL REFERENCES customers (id),
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL,
  last_sent_at TIMESTAMPTZ,
  -- Refusals in a row (not 404/410, which remove the row at once); reset by a success.
  failures     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_customer_idx ON push_subscriptions (customer_id);

-- The push outbox, written in the same transaction as the order step (like
-- notifications for WhatsApp), so a rolled-back step pushes nothing. One row
-- per order update; the maintenance loop sends it to every subscription the
-- customer has. The text is fixed per kind and holds nothing personal.
CREATE TABLE push_messages (
  id              TEXT PRIMARY KEY,
  customer_id     TEXT NOT NULL REFERENCES customers (id),
  order_id        TEXT REFERENCES orders (id),
  event_id        TEXT NOT NULL,
  kind            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL,
  sent_at         TIMESTAMPTZ,
  -- How many of the customer's browsers took it.
  delivered       INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  UNIQUE (event_id, kind)
);
CREATE INDEX push_messages_due_idx ON push_messages (next_attempt_at) WHERE status = 'PENDING';
CREATE INDEX push_messages_customer_idx ON push_messages (customer_id);
-- Pruning finished messages after 30 days (maintenance cleanup).
CREATE INDEX push_messages_done_idx ON push_messages (created_at) WHERE status <> 'PENDING';

-- Boxes a signed-in customer hearted. A box taken off sale stays (the list says
-- so); a product deleted outright takes its hearts with it.
CREATE TABLE customer_favourites (
  customer_id TEXT NOT NULL REFERENCES customers (id),
  sku         TEXT NOT NULL REFERENCES products (sku) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (customer_id, sku)
);
