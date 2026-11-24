-- A gift for several people as pre-orders (docs/gifting.md, "Before the season"): before the season the
-- shop's "Send as a gift" books one gift pre-order per recipient (each with its own box, week, address
-- and recipient, migration 070), all made in one transaction and paid by ONE payment link. The group
-- holds that payment: its total, its link (also copied onto every booking, so the existing webhook,
-- reconcile and dev pay routes find a booking and pay the whole group), and the payment id. As for a
-- gift order's deliveries, a booking in a group keeps payment_id NULL (preorders.payment_id is unique)
-- and records its own paid_amount; a staff refund of one booking refunds that amount from the group's
-- payment. From then on each booking is an ordinary pre-order: allocator, staff cancel, refunds.
--
-- Expand-only: a new sequence and table, two nullable columns and a partial index. The previous release
-- never reads them; it would treat a group's bookings as separate unpaid bookings sharing one link.
-- Rollback: the previous release ignores them.
--
-- locks: ADD COLUMN without a default is a catalogue change under a brief ACCESS EXCLUSIVE lock on
-- preorders (no rewrite); the foreign key is on a new, all-NULL column, so checking it reads nothing.
-- The partial index covers only grouped bookings, which are none when this runs, so it builds at once.

CREATE SEQUENCE IF NOT EXISTS preorder_group_seq START 1001;

CREATE TABLE preorder_groups (
  id                 TEXT PRIMARY KEY,
  -- PGR-1001: what the buyer sees for the whole gift; the payment link's reference.
  number             TEXT NOT NULL UNIQUE,
  customer_id        TEXT NOT NULL REFERENCES customers(id),
  -- PAYMENT_PENDING until paid (PAID); CANCELLED when the buyer cancels it before paying, or its
  -- payment link could not be made. A hold that ran out leaves it PAYMENT_PENDING with every booking
  -- cancelled (shown as cancelled): a late payment is still honoured, as for one pre-order.
  status             TEXT NOT NULL CHECK (status IN ('PAYMENT_PENDING', 'PAID', 'CANCELLED')),
  recipient_count    INTEGER NOT NULL CHECK (recipient_count >= 1),
  boxes              INTEGER NOT NULL CHECK (boxes >= 1),
  total              INTEGER NOT NULL CHECK (total >= 0),
  payment_status     TEXT NOT NULL CHECK (payment_status IN ('INITIATED', 'SUCCEEDED', 'CANCELLED')),
  payment_link_id    TEXT,
  payment_link_url   TEXT,
  payment_id         TEXT UNIQUE,
  payment_method     TEXT,
  paid_amount        INTEGER,
  hold_expires_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL,
  paid_at            TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ
);
CREATE INDEX preorder_groups_customer_idx ON preorder_groups (customer_id, created_at DESC);

-- Each booking of a group: its group and its place in the buyer's list (1, 2, ...).
ALTER TABLE preorders ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES preorder_groups(id);
ALTER TABLE preorders ADD COLUMN IF NOT EXISTS group_position INTEGER;
CREATE INDEX IF NOT EXISTS preorders_group_idx ON preorders (group_id, group_position) WHERE group_id IS NOT NULL;
