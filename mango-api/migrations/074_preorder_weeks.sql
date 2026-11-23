-- One weekly limit for pre-orders across every box (the owner, 18 Nov 2026: "1000 orders is one batch; when a
-- week is full, the next customers get the next week"). Delivery weeks now exist by themselves (src/preorders.js
-- deliveryWeeks: Mondays from the season's first week to its end), each takes up to preorderWeekLimit pre-orders
-- (a rule in app_config, default 1000), and a booking gets the earliest week with room. This table is each week's
-- counter: `reserved` is what its live bookings take (preorders.js weekLoad: one per booking today, so a gift for
-- several people counts once per person), taken with a conditional INSERT ... ON CONFLICT DO UPDATE so two
-- bookings at once can't take a week past its limit.
--
-- Backfill: every booking that holds room today (PAYMENT_PENDING, BOOKED and CONVERTED, the statuses the INV-06
-- check counts, stock-watch.js CAPACITY_STATUSES) keeps its week and counts towards that week's counter, one per
-- booking (WEEK_LOAD_SQL; change both together if the count moves to boxes or kg). It is a few hundred rows at most.
--
-- preorder_capacity (per box and week, set by staff) is kept but decides nothing any more: the API stops reading its
-- `capacity` for availability; its `reserved` is still kept per box, for the panel and the INV-06 check.
--
-- Expand-only: a new table. The previous release never reads it and books by preorder_capacity as before; bookings
-- it makes after a rollback are not counted here, which the INV-06 check (Needs attention, "all boxes") shows and a
-- manager's recount fixes.
-- locks: a new table, written from preorders in one statement; preorders is only read (no lock beyond ACCESS SHARE).

CREATE TABLE IF NOT EXISTS preorder_weeks (
  week_start DATE PRIMARY KEY CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  reserved   INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0)
);

INSERT INTO preorder_weeks (week_start, reserved)
SELECT week_start, COUNT(*)::int
  FROM preorders
 WHERE status IN ('PAYMENT_PENDING', 'BOOKED', 'CONVERTED')
 GROUP BY week_start
ON CONFLICT (week_start) DO UPDATE SET reserved = EXCLUDED.reserved;
