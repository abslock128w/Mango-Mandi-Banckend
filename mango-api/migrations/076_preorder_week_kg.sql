-- The weekly pre-order limit counts KILOGRAMS (the owner, 18 Nov 2026: "each batch is 1000 kg; that is a day,
-- 7000 kg a week; when 7000 kg is pre-ordered the next customers get the second week"), and supply varies:
-- managers set the mangoes expected per day for pre-orders (a week is 7 of them) and, for any week, its own
-- expected kg. Migration 074 counted one per booking; from here a booking takes its weight: boxes x the box's
-- kg (src/preorders.js weekLoad), and a week takes up to its own expected kg, else daily x 7 (weekLimit).
--
-- 1. preorders.load_kg: what a booking takes from its week, fixed when it is booked, so a box size edited later
--    can't make a release give back a different weight than was taken. Backfilled for every booking from its
--    box size ("3kg" -> 3, read like the API's parseFloat: the leading number).
-- 2. preorder_week_kg: each week's kg counter, numeric (a box may weigh 2.5 kg), taken with the same
--    conditional INSERT ... ON CONFLICT DO UPDATE as 074's counter, and the week's own expected kg (limit_kg,
--    null: the default). Backfilled from the bookings that hold room (PAYMENT_PENDING, BOOKED and CONVERTED,
--    as 074). It sits apart from 074's preorder_weeks so the previous release never sees kg in its counter.
--    074's preorder_weeks (one per booking) is NOT recounted in kg: the previous release still books by it
--    while this one deploys. The new release keeps it up to date (one per booking, never refusing on it), so
--    a rollback finds it right.
-- 3. The rule: a new key, preorderDayKg (default 1000 kg a day, so 7000 kg a week), so the previous release
--    keeps reading its own preorderWeekLimit (orders) unchanged during the deploy. When the live rules have no
--    preorderDayKg, a new version is added copied from the live one with preorderDayKg 1000 (everything else
--    kept, the old key too, for the previous release). Nothing on a fresh database (no rules yet: the default applies),
--    when already set, or when run again.
--
-- The deploy window: bookings the previous release makes after this runs count in preorder_weeks only (it
-- does not know load_kg or this table). The INV-06 check (Needs attention, "all boxes") then shows the
-- week's kg off by those bookings, and a manager's recount fixes it; the new release reads their weight
-- from their box when load_kg is empty.
--
-- Expand-only: a nullable column, a new table, a new rules version with a new key.
-- locks: ADD COLUMN without a default is a catalogue change (no rewrite) under a brief ACCESS EXCLUSIVE lock
-- on preorders, then one UPDATE of its rows (a few hundred at most); app_config is locked in EXCLUSIVE mode,
-- as saveConfig does, so a manager's save can't take the same version number.

ALTER TABLE preorders ADD COLUMN IF NOT EXISTS load_kg NUMERIC(12, 3) CHECK (load_kg >= 0);

UPDATE preorders p
   SET load_kg = p.qty * COALESCE(substring(pr.box_size from '^\s*([0-9]+(?:\.[0-9]+)?)')::numeric, 0)
  FROM products pr
 WHERE pr.sku = p.sku AND p.load_kg IS NULL;

CREATE TABLE IF NOT EXISTS preorder_week_kg (
  week_start  DATE PRIMARY KEY CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  reserved_kg NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (reserved_kg >= 0),
  limit_kg    NUMERIC(12, 3) CHECK (limit_kg >= 0)
);

INSERT INTO preorder_week_kg (week_start, reserved_kg)
SELECT week_start, SUM(COALESCE(load_kg, 0))
  FROM preorders
 WHERE status IN ('PAYMENT_PENDING', 'BOOKED', 'CONVERTED')
 GROUP BY week_start
ON CONFLICT (week_start) DO UPDATE SET reserved_kg = EXCLUDED.reserved_kg;

LOCK TABLE app_config IN EXCLUSIVE MODE;

INSERT INTO app_config (version, value, changed_by)
SELECT live.version + 1, live.value || '{"preorderDayKg": 1000}'::jsonb, 'system'
  FROM (SELECT version, value FROM app_config ORDER BY version DESC LIMIT 1) live
 WHERE NOT (live.value ? 'preorderDayKg');
