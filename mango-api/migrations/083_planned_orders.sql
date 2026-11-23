-- Regular orders booked against the pre-order plan (src/plan-orders.js, the owner: "if a variety is fully booked for
-- this week, tell them it will be delivered next week and let them choose the dates next week").
--
-- 1. preorder_variety_week_kg.planned_kg: the kg of such orders in that week and variety. One weekly budget, so room for
--    new pre-orders and for new planned orders is limit - reserved_kg - planned_kg. It is its own column: reserved_kg
--    keeps meaning "pre-orders only", so the INV-06 check, its recount and a rollback are untouched.
-- 2. orders: planned (booked against the plan), plan_week (the Monday whose budget it holds; NULL once given back by a
--    cancel), delayed_at / delayed_from_date / delay_count / delay_cancelled_at (we moved it later: the customer may
--    cancel for a full refund until it is packed).
-- 3. order_items: plan_kg and plan_variety, fixed when ordered, so a box size edited later can't change what is given back.
--
-- The deploy window: the previous release never reads these columns and offers no planned dates. While both run its
-- pre-order bookings do not see planned_kg (a few minutes; the recalculation settles any excess, planned orders first),
-- and its rebalance would treat a just-placed planned order as short of stock (flagged at risk until the new release's
-- next rebalance clears it). Expand-only.
-- locks: ADD COLUMN with constant defaults or none are catalogue changes under a brief ACCESS EXCLUSIVE lock; the CHECK
-- on preorder_variety_week_kg (a few rows per week and variety) scans that small table; the partial index on orders
-- covers no row yet but reads the table once, blocking its writes for that moment, as migration 062's did.

ALTER TABLE preorder_variety_week_kg ADD COLUMN IF NOT EXISTS planned_kg NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (planned_kg >= 0);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS planned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS plan_week DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delayed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delayed_from_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delay_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delay_cancelled_at TIMESTAMPTZ;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS plan_kg NUMERIC(12, 3);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS plan_variety TEXT;

CREATE INDEX IF NOT EXISTS orders_planned_idx ON orders (delivery_date, placed_at) WHERE planned;
