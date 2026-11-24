-- Backorders (mango-api/README.md, Checkout → Backorders): a customer can order a box that has no stock on
-- the day they pick. The order is placed for a day at least BACKORDER_LEAD_DAYS out, its short lines are
-- marked backordered, and it stays at-risk until the hourly rebalance finds stock for it. orders.backorder
-- tells staff (and the at-risk alarms) that the shortfall is expected, not a problem.
--
-- Expand-only: two new columns with constant defaults (no table rewrite on Postgres 11+) and a partial
-- index. The previous release never reads them; the orders it creates get false.
-- locks: ADD COLUMN with a constant default is a catalogue change under a brief ACCESS EXCLUSIVE lock;
-- the partial index on orders covers only rows with backorder true, none of which exist yet, but the
-- build still reads orders once and blocks its writes for that read (a few thousand rows, sub-second).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS backorder BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS backordered BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS orders_backorder_idx ON orders (backorder) WHERE backorder;
