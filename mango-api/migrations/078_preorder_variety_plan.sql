-- The pre-order plan per VARIETY (the owner, 18 Nov 2026: "expected kg per day per variety in Planning; whoever
-- ordered first is delivered first"). Until 077 every box shared one weekly limit in kg (preorderDayKg x 7, or a
-- week's own kg in preorder_week_kg). From here each variety (products.variety: Alphonso, Kesar, ..., and "Mixed Box",
-- its own line because the products data does not say which varieties are in it) has its own expected kg a day,
-- and a week takes 7 days of it for that variety's boxes, or the week's own expected kg for that variety.
--
-- 1. preorders.variety: the variety a booking counts against, fixed when booked (as load_kg), so a product whose
--    variety is edited later can't make a release give the kg back to another variety. Backfilled from the box.
-- 2. preorder_variety_week_kg (week_start, variety): each week's kg counter per variety (reserved_kg) and the week's
--    own expected kg for that variety (limit_kg; null: the variety's daily kg x 7). Backfilled from the bookings that
--    hold room (PAYMENT_PENDING, BOOKED, CONVERTED: stock-watch.js CAPACITY_STATUSES). A week's own kg for all boxes
--    (preorder_week_kg.limit_kg) is split evenly over the varieties on sale, as placeholders.
-- 3. The rule: preorderVarietyDayKg { variety: kg a day } and preorderOtherVarietyDayKg (varieties not listed): 20 kg a
--    day for EACH variety on sale and for the others (the owner, 18 Nov 2026: a small placeholder he replaces with real
--    numbers, and with which he can try out delays himself). A new rules version copied from the live one, everything
--    else kept, preorderDayKg too (the previous release limits by it). Nothing on a fresh database (no rules or no
--    products yet: the defaults, also 20, apply), when already set, or when run again. No booking is moved by this:
--    a week that now holds more than 140 kg of a variety shows as over on the Pre-order plan, and the manager decides
--    (Recalculate, after its preview).
--
-- The deploy window (this runs before the new release takes traffic, and the previous one keeps serving until then):
-- the previous release books against preorder_week_kg (one limit for all boxes) and never writes this table or
-- preorders.variety. Bookings it makes after this ran are missing from the variety counters, so a variety's week can
-- look up to that many kg roomier than it is, and the shop could book it slightly over. The new release reads a
-- missing preorders.variety from the box, its INV-06 check (Needs attention) shows each variety week that disagrees
-- with its bookings, and both the recount and "Recalculate now" (Pre-order plan) rebuild the counters from the
-- bookings themselves. The new release still keeps preorder_week_kg (the sum over varieties, never refusing on it),
-- preorder_weeks and preorder_capacity up to date, so a rollback to the previous release finds its counters right.
--
-- Expand-only: a nullable column, a new table, a new rules version with new keys.
-- locks: ADD COLUMN without a default is a catalogue change under a brief ACCESS EXCLUSIVE lock on preorders, then
-- one UPDATE of its rows (a few hundred today); app_config is locked in EXCLUSIVE mode, as saveConfig does, so a
-- manager's save can't take the same version number.

ALTER TABLE preorders ADD COLUMN IF NOT EXISTS variety TEXT;

UPDATE preorders p SET variety = pr.variety FROM products pr WHERE pr.sku = p.sku AND p.variety IS NULL;

CREATE TABLE IF NOT EXISTS preorder_variety_week_kg (
  week_start  DATE NOT NULL CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  variety     TEXT NOT NULL,
  reserved_kg NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (reserved_kg >= 0),
  limit_kg    NUMERIC(12, 3) CHECK (limit_kg >= 0),
  PRIMARY KEY (week_start, variety)
);

INSERT INTO preorder_variety_week_kg (week_start, variety, reserved_kg)
SELECT p.week_start, COALESCE(p.variety, p.sku),
       SUM(COALESCE(p.load_kg, p.qty * COALESCE(substring(pr.box_size from '^\s*([0-9]+(?:\.[0-9]+)?)')::numeric, 0)))
  FROM preorders p LEFT JOIN products pr ON pr.sku = p.sku
 WHERE p.status IN ('PAYMENT_PENDING', 'BOOKED', 'CONVERTED')
 GROUP BY 1, 2
ON CONFLICT (week_start, variety) DO UPDATE SET reserved_kg = EXCLUDED.reserved_kg;

-- A week's own kg for every box, split evenly over the varieties on sale (placeholders).
INSERT INTO preorder_variety_week_kg (week_start, variety, reserved_kg, limit_kg)
SELECT k.week_start, v.variety, 0, ROUND(k.limit_kg / v.n, 3)
  FROM preorder_week_kg k
 CROSS JOIN (SELECT variety, COUNT(*) OVER () AS n FROM (SELECT DISTINCT variety FROM products WHERE active) d) v
 WHERE k.limit_kg IS NOT NULL
ON CONFLICT (week_start, variety) DO UPDATE SET limit_kg = COALESCE(preorder_variety_week_kg.limit_kg, EXCLUDED.limit_kg);

LOCK TABLE app_config IN EXCLUSIVE MODE;

INSERT INTO app_config (version, value, changed_by)
SELECT live.version + 1,
       live.value || jsonb_build_object(
         'preorderVarietyDayKg', (SELECT jsonb_object_agg(variety, 20) FROM (SELECT DISTINCT variety FROM products WHERE active) v),
         'preorderOtherVarietyDayKg', 20),
       'system'
  FROM (SELECT version, value FROM app_config ORDER BY version DESC LIMIT 1) live
 WHERE NOT (live.value ? 'preorderVarietyDayKg')
   AND EXISTS (SELECT 1 FROM products WHERE active);
