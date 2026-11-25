-- Gifting for one person, many boxes, and a Landmark on the address (change request 02, CR2-06 and CR2-07, 25 Nov 2026:
-- "a gift order is sent to only one person, but we can add as many varieties of mangoes as possible", and "add
-- landmark field"). docs/gifting.md, "One person, many boxes".
--
-- What:
--   - orders.delivery_landmark, preorders.delivery_landmark: an optional landmark ("near Sai Baba temple, opposite bus
--     stop", at most 100 characters, checked by the API), kept apart from the address so the panel, the printed run,
--     the rider app and the recipient's order show it on its own line. NULL for every row so far and for every order
--     whose buyer gave none.
--   - preorder_groups.one_delivery: a gift for one person booked before the season with several box lines (one booking
--     per line, as a pre-order bag): every booking takes the SAME delivery week (the latest any line needs), and the
--     allocator turns them into ONE delivery order with a line per box. false for every group so far (each booking
--     its own week and order, as before).
--   In season nothing new is needed: one recipient is one delivery order, and an order already has many lines.
-- Why expand-only is safe: three new columns, nullable or with a constant default. The previous release never reads
-- or writes them: it books and converts groups as before, and the landmark is simply not shown by it.
-- locks: ADD COLUMN with no default (the landmarks) or a constant default (one_delivery) is a catalogue-only change
-- under a brief ACCESS EXCLUSIVE lock on each table (no rewrite, no scan). No constraint is added: nothing to validate.
-- rollback: the previous release works against this schema. A one_delivery group paid before a rollback is converted
-- by the previous release booking by booking (several orders to the same address in the same week, still delivered).
-- To undo by hand once no unconverted one_delivery group is left:
--   ALTER TABLE preorder_groups DROP COLUMN one_delivery; ALTER TABLE preorders DROP COLUMN delivery_landmark;
--   ALTER TABLE orders DROP COLUMN delivery_landmark;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_landmark TEXT;
ALTER TABLE preorders ADD COLUMN IF NOT EXISTS delivery_landmark TEXT;
ALTER TABLE preorder_groups ADD COLUMN IF NOT EXISTS one_delivery BOOLEAN NOT NULL DEFAULT false;
