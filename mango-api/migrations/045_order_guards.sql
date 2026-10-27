-- Order guards (docs/order-states.md).
--
-- Part 1: the database refuses an order status change the order engine does
-- not allow. order_status_transitions holds every allowed move; it was
-- generated from ORDER_TRANSITIONS in src/orders.js, and
-- test/order-guards.test.js fails when the two differ, so a change to one
-- needs a migration that changes the other. A new order starts as
-- PAYMENT_PENDING (checkout, chat, gifts, subscriptions) or CONFIRMED (a
-- preorder turned into an order, a free replacement).
-- A repair by hand (or a test putting an order straight into a state) lifts
-- the guard for one transaction only:
--   BEGIN; SET LOCAL mango.order_status_override = 'on'; UPDATE orders ...; COMMIT;
--
-- locks: the new tables are empty. CREATE TRIGGER on orders takes a SHARE ROW
-- EXCLUSIVE lock for a moment (writes wait, reads go on) and scans nothing.
-- The two new nullable columns on orders, preorders and duplicate_payments
-- (part 3) have no default, so nothing is rewritten.
-- Expand-only: the previous release never writes a status move outside this
-- table (its warehouse reopen, PACKED to PROCESSING, is in it).

-- ---------------------------------------------------------------- part 1: order status moves

CREATE TABLE IF NOT EXISTS order_status_transitions (
  from_status TEXT NOT NULL,
  to_status   TEXT NOT NULL,
  PRIMARY KEY (from_status, to_status)
);

INSERT INTO order_status_transitions (from_status, to_status) VALUES
  ('PAYMENT_PENDING', 'CONFIRMED'),
  ('PAYMENT_PENDING', 'CANCELLED'),
  ('CONFIRMED', 'PROCESSING'),
  ('CONFIRMED', 'CANCELLED'),
  ('PROCESSING', 'PACKED'),
  ('PROCESSING', 'CANCELLED'),
  ('PACKED', 'SHIPPED'),
  ('PACKED', 'CANCELLED'),
  ('PACKED', 'PROCESSING'),
  ('SHIPPED', 'OUT_FOR_DELIVERY'),
  ('SHIPPED', 'CANCELLED'),
  ('OUT_FOR_DELIVERY', 'DELIVERED'),
  ('OUT_FOR_DELIVERY', 'DELIVERY_FAILED'),
  ('OUT_FOR_DELIVERY', 'CANCELLED'),
  ('DELIVERY_FAILED', 'OUT_FOR_DELIVERY'),
  ('DELIVERY_FAILED', 'RTO'),
  ('DELIVERY_FAILED', 'CANCELLED'),
  ('RTO', 'CANCELLED'),
  ('CANCELLED', 'CONFIRMED')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION orders_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('mango.order_status_override', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('PAYMENT_PENDING', 'CONFIRMED') THEN
      RAISE EXCEPTION 'A new order starts as PAYMENT_PENDING or CONFIRMED, not %', NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'orders_status_transition', TABLE = 'orders', COLUMN = 'status';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status
    AND NOT EXISTS (SELECT 1 FROM order_status_transitions WHERE from_status = OLD.status AND to_status = NEW.status) THEN
    RAISE EXCEPTION 'An order cannot go from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'orders_status_transition', TABLE = 'orders', COLUMN = 'status';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER orders_status_guard
  BEFORE INSERT OR UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_status_guard();

-- ---------------------------------------------------------------- part 2: webhook intake

-- A signed webhook as received, stored in its own insert before it is
-- processed (src/webhook-events.js). processed_at is set in the processing
-- transaction. Maintenance replays rows still unprocessed after 5 minutes
-- (attempts counts the replays) and gives up after 5, listing the event in
-- Needs attention. Rows are deleted after 30 days (WhatsApp after 7, as
-- wa_inbound). The old dedupe (processed_webhooks, wa_inbound) stays.
CREATE TABLE IF NOT EXISTS webhook_events (
  id               TEXT PRIMARY KEY,
  provider         TEXT NOT NULL CHECK (provider IN ('razorpay', 'whatsapp')),
  -- Razorpay's x-razorpay-event-id, or 'sha256:<hash of the body>' without one.
  dedupe_key       TEXT NOT NULL,
  event_id         TEXT,
  body             BYTEA NOT NULL,
  -- When the sender says it happened (Razorpay's created_at); the lag metric is measured from it.
  event_created_at TIMESTAMPTZ,
  received_at      TIMESTAMPTZ NOT NULL,
  processed_at     TIMESTAMPTZ,
  attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempt_at  TIMESTAMPTZ NOT NULL,
  last_error       TEXT,
  gave_up_at       TIMESTAMPTZ,
  UNIQUE (provider, dedupe_key)
);
CREATE INDEX IF NOT EXISTS webhook_events_unprocessed ON webhook_events (received_at) WHERE processed_at IS NULL AND gave_up_at IS NULL;
CREATE INDEX IF NOT EXISTS webhook_events_received ON webhook_events (provider, received_at);
