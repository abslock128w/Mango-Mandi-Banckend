-- Bulk Deals (25 Oct 2026): listings for large orders, with their own text,
-- photos and quantity-based prices, sold from the same products, stock, holds,
-- checkout and order lifecycle as everything else. A listing points at one
-- product (box); bulk is a pricing and catalogue layer, not a second stock.
--
-- locks: new tables only, plus nullable columns with no default on order_items
-- (a brief lock, no rewrite, no scan). Expand-only: older code never reads any
-- of this and keeps working while both versions serve.

CREATE TABLE bulk_listings (
  id           TEXT PRIMARY KEY,
  sku          TEXT NOT NULL REFERENCES products(sku),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  origin       TEXT NOT NULL DEFAULT '',
  -- The ripeness choices offered; one price whatever the ripeness (owner's rule).
  stages       TEXT[] NOT NULL,
  min_qty      INTEGER NOT NULL CHECK (min_qty >= 1),
  qty_step     INTEGER NOT NULL DEFAULT 1 CHECK (qty_step >= 1),
  max_qty      INTEGER CHECK (max_qty IS NULL OR max_qty >= min_qty),
  -- [{ "minQty": 10, "unitPrice": 159900 }, ...], ascending; each tier runs up to
  -- the next tier's minQty - 1, the last one has no upper end. Paise per box.
  tiers        JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED')),
  -- Optional sale window: outside it the listing is not shown or sold.
  starts_at    TIMESTAMPTZ,
  ends_at      TIMESTAMPTZ CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  -- Goes up on every change; a quote remembers it, and order items keep it.
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL,
  created_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL,
  updated_by   TEXT,
  published_at TIMESTAMPTZ
);
CREATE INDEX bulk_listings_shop_idx ON bulk_listings (sort_order, created_at) WHERE status = 'PUBLISHED';

-- Gallery: the lowest position is the main photo. Stored like product photos:
-- in Vercel Blob when it is set up, else in the row. Public once the listing is.
CREATE TABLE bulk_listing_photos (
  id         TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES bulk_listings(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  mime       TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes      BYTEA,
  blob_path  TEXT,
  width      INTEGER,
  height     INTEGER,
  size_bytes INTEGER,
  created_at TIMESTAMPTZ NOT NULL,
  created_by TEXT,
  CHECK (bytes IS NOT NULL OR blob_path IS NOT NULL)
);
CREATE INDEX bulk_listing_photos_listing_idx ON bulk_listing_photos (listing_id, position);

-- Who changed what and when: text, prices, photos and publishing.
CREATE TABLE bulk_listing_events (
  id         TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES bulk_listings(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  version    INTEGER NOT NULL,
  changes    JSONB NOT NULL DEFAULT '{}',
  actor_id   TEXT,
  actor_name TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX bulk_listing_events_listing_idx ON bulk_listing_events (listing_id, created_at DESC);

-- Bulk lines in a customer's cart, beside the regular cart lines (carts).
CREATE TABLE bulk_cart_lines (
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  listing_id  TEXT NOT NULL REFERENCES bulk_listings(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL CHECK (stage IN ('RAW', 'SEMI_RIPE', 'RIPE')),
  qty         INTEGER NOT NULL CHECK (qty > 0),
  updated_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (customer_id, listing_id, stage)
);

-- What a bulk line was sold at, so later edits to the listing never rewrite
-- an order: the listing, its version, the tier and the price at confirmation.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS listing_id TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS pricing JSONB;
