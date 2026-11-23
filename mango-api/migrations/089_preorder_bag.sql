-- The pre-order bag (browser audit 23 Nov 2026, P1: "each variety is paid separately and the bag stays empty"): before the
-- season a customer pre-orders several boxes for themselves in ONE checkout and ONE payment, each line keeping its own
-- delivery week. It reuses 071's preorder_groups ("a gift for several people"): the group holds the one hold, the one
-- payment link (copied onto every booking, so the webhook, reconcile and dev pay routes find a booking and pay the
-- group) and the payment id; each line is an ordinary pre-order booking with its own week (assignWeek). `kind` says
-- which of the two a group is:
--   GIFT  a gift for several people (071): one booking per recipient, each with its own address and recipient.
--   BAG   the customer's own pre-order bag (POST /v1/preorders/confirm): one booking per box line, one address, P numbers.
-- recipient_count is the group's number of bookings (people for a gift, lines for a bag).
--
-- The deploy window: the previous release never reads kind; it shows a bag as a gift group of N "people" and pays and
-- cancels it exactly as this release does. Expand-only. Rollback: the previous release ignores the column.
-- locks: ADD COLUMN with a constant default is a catalogue change under a brief ACCESS EXCLUSIVE lock (no rewrite); the
-- check is added NOT VALID (no scan) and validated in 090.

ALTER TABLE preorder_groups ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'GIFT';
ALTER TABLE preorder_groups DROP CONSTRAINT IF EXISTS preorder_groups_kind_check;
ALTER TABLE preorder_groups ADD CONSTRAINT preorder_groups_kind_check CHECK (kind IN ('GIFT', 'BAG')) NOT VALID;
