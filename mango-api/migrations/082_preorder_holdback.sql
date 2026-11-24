-- Fruit held back for pre-orders (src/holdback.js, the owner: "a normal shopper can never take fruit that is owed to
-- pre-orders"). The hold is not stored: every catalogue read, quote and regular checkout counts the paid bookings
-- not yet turned into delivery orders whose week has come into reach (status BOOKED, week_start up to the hold
-- cut-off), per box and ripeness. This partial index keeps that GROUP BY to the few BOOKED rows, read on every page.
--
-- The deploy window: the previous release never reads it and keeps selling as before (without the hold) for the
-- few minutes both run; the allocator of either release converts bookings oldest first. Expand-only.
-- locks: CREATE INDEX on preorders (a few hundred rows a season) blocks writes to it only for the moment it takes
-- to build.

CREATE INDEX IF NOT EXISTS preorders_booked_week_idx ON preorders (week_start, sku, stage) WHERE status = 'BOOKED';
