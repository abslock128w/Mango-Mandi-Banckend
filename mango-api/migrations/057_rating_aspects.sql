-- The shop's review pop-up after delivery asks three things beside the overall stars:
-- how the box was packed, the condition the mangoes arrived in, and how sweet they were
-- (each 1 to 5). Null for ratings given before this, and for a rating with stars only.
--
-- Additive only: nullable columns, so the previous release keeps running (n-minus-1).
-- Rollback: the previous release ignores them.
--
-- locks: order_ratings is a small table; nullable columns with no default are a catalogue
-- change (no rewrite), and their checks pass at once on rows where they are null.
ALTER TABLE order_ratings ADD COLUMN IF NOT EXISTS packaging INTEGER CHECK (packaging BETWEEN 1 AND 5);
ALTER TABLE order_ratings ADD COLUMN IF NOT EXISTS condition INTEGER CHECK (condition BETWEEN 1 AND 5);
ALTER TABLE order_ratings ADD COLUMN IF NOT EXISTS sweetness INTEGER CHECK (sweetness BETWEEN 1 AND 5);
