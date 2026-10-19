-- Customer experience: product descriptions, saved addresses and ratings.

-- A line or two about the fruit, shown on the shop's product card.
ALTER TABLE products ADD COLUMN description TEXT NOT NULL DEFAULT '';

-- Addresses a customer has delivered to, offered again at checkout. Saved
-- when an order is placed; the customer can remove them on the account page.
CREATE TABLE customer_addresses (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  name         TEXT,
  address      TEXT NOT NULL,
  pincode      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX customer_addresses_customer_idx ON customer_addresses (customer_id, last_used_at DESC);

-- How the customer rated a delivered order (1 to 5 stars and a note).
CREATE TABLE order_ratings (
  order_id    TEXT PRIMARY KEY REFERENCES orders(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  stars       INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX order_ratings_created_idx ON order_ratings (created_at);
