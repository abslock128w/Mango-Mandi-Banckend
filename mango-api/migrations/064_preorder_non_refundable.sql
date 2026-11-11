-- Pre-orders are non-refundable once paid (mango-api/README.md, Preorders): a customer can't cancel a
-- paid booking, or the order it became, for a refund. Bookings made before this release were sold as
-- "cancel any time before packing for a full refund", so they keep that promise: existing rows get
-- false, and bookPreorder inserts true from now on. A manager's cancel (a week we can't fill) still
-- refunds in full, whatever this says.
--
-- The season dates that decide when the shop takes pre-orders (seasonStartsOn, preorderOpensOn) are
-- rules in app_config with null defaults, so no new rules version is needed: an existing database
-- stays in season until a manager sets them on the Planning page.
--
-- Expand-only: one new column with a constant default (no table rewrite on Postgres 11+). The previous
-- release never reads it; the bookings it makes get false (cancellable, as that release promises).
-- locks: ADD COLUMN with a constant default is a catalogue change under a brief ACCESS EXCLUSIVE lock.

ALTER TABLE preorders ADD COLUMN IF NOT EXISTS non_refundable BOOLEAN NOT NULL DEFAULT false;
