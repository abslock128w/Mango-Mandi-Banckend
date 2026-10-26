-- Bulk and corporate gifting (MULTI_GIFT, docs/gifting.md): one gift order, many
-- recipients, one payment. Each recipient is its own delivery order (orders row)
-- linked to the parent here, so packing, riders, proof and claims work unchanged.
-- Expand-only: a new table, new nullable columns and indexes.
--
-- locks: ADD COLUMN of a nullable column without a default only takes a brief
-- ACCESS EXCLUSIVE lock (no table rewrite); the foreign keys are on new, all-NULL
-- columns, so checking them reads nothing. The partial indexes cover only gift
-- rows, which are none when this runs, so they build at once.

CREATE SEQUENCE IF NOT EXISTS gift_order_seq START 1001;

CREATE TABLE gift_orders (
  id                   TEXT PRIMARY KEY,
  -- GFT-1001: what the buyer and staff see; the Razorpay receipt.
  number               TEXT NOT NULL UNIQUE,
  customer_id          TEXT NOT NULL REFERENCES customers(id),
  -- PAYMENT_PENDING until paid (PAID); CANCELLED when the buyer cancels it before paying
  -- or its payment could not be started. A hold that ran out leaves it PAYMENT_PENDING with
  -- its deliveries cancelled: a late payment is still honoured, as for any order.
  status               TEXT NOT NULL CHECK (status IN ('PAYMENT_PENDING', 'PAID', 'CANCELLED')),
  delivery_date        DATE NOT NULL,
  slot_id              TEXT,
  recipient_count      INTEGER NOT NULL CHECK (recipient_count >= 1),
  boxes                INTEGER NOT NULL CHECK (boxes >= 1),
  subtotal             INTEGER NOT NULL CHECK (subtotal >= 0),
  discount             INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total                INTEGER NOT NULL CHECK (total >= 0),
  promo_code           TEXT,
  -- A business buying: printed on the one bill for the whole order (BILLS_ENABLED).
  buyer_business_name  TEXT,
  buyer_gstin          TEXT,
  razorpay_order_id    TEXT UNIQUE,
  payment_status       TEXT NOT NULL CHECK (payment_status IN ('INITIATED', 'SUCCEEDED', 'CANCELLED', 'FAILED')),
  payment_id           TEXT UNIQUE,
  payment_method       TEXT,
  payment_amount       INTEGER,
  hold_expires_at      TIMESTAMPTZ,
  reconcile_checked_at TIMESTAMPTZ,
  placed_at            TIMESTAMPTZ NOT NULL,
  paid_at              TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ
);
CREATE INDEX gift_orders_customer_idx ON gift_orders (customer_id, placed_at DESC);
CREATE INDEX gift_orders_pending_idx ON gift_orders (placed_at) WHERE payment_status = 'INITIATED';

-- Each delivery of a gift order: its parent and its place in the buyer's list (1, 2, ...).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_order_id TEXT REFERENCES gift_orders(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_position INTEGER;
CREATE INDEX IF NOT EXISTS orders_gift_order_idx ON orders (gift_order_id, gift_position) WHERE gift_order_id IS NOT NULL;

-- The one bill of a gift order. It hangs off the first delivery (bills.order_id), and
-- gift_order_id says it covers the whole order, so one delivery's cancel never cancels it.
ALTER TABLE bills ADD COLUMN IF NOT EXISTS gift_order_id TEXT REFERENCES gift_orders(id);
CREATE UNIQUE INDEX IF NOT EXISTS bills_gift_order_key ON bills (gift_order_id) WHERE gift_order_id IS NOT NULL;
