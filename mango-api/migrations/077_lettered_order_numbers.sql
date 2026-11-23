-- Lettered order numbers (the owner, 18 Nov 2026): every new order, pre-order, gift and bulk order gets a
-- letter and 9 scrambled digits, stored as S743406080 and shown as S-743 406 080 (src/order-number.js):
--   S a normal shop order, P a pre-order for yourself, G anything sent as a gift, B a bulk order.
-- S, P and B each draw from their own sequence. G has ONE sequence for every table that stores a G
-- number (orders, gift_orders, preorders, preorder_groups), so one G number never names two things.
-- The digits are the sequence value x FACTOR9 mod 1e9, so the sequences start at 1 like any other.
--
-- Existing numbers (7434060801, ORD-1024, PRE-1035, PGR-1001, GFT-12, BLK-0007) are not touched and keep
-- working. The number columns are TEXT with only a UNIQUE index (no CHECK, no width), so nothing to widen.
-- The old sequences (order_seq, preorder_seq, preorder_group_seq, gift_order_seq, bulk_enquiry_seq) stay:
-- the previous release keeps numbering from them while this one deploys, and its numbers can't collide
-- with lettered ones (different shapes). After a restore, ops/bump-sequences.js moves the new sequences
-- past every lettered number already stored (src/restore.js).
--
-- Expand-only: four new sequences, nothing else.
-- locks: CREATE SEQUENCE takes no lock on any existing table.

CREATE SEQUENCE IF NOT EXISTS order_number_s_seq START 1;
CREATE SEQUENCE IF NOT EXISTS order_number_p_seq START 1;
CREATE SEQUENCE IF NOT EXISTS order_number_g_seq START 1;
CREATE SEQUENCE IF NOT EXISTS order_number_b_seq START 1;
