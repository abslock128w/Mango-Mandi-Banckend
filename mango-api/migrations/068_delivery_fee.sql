-- Delivery charge on regular orders (src/delivery-fee.js): how far the address was from the
-- nearest warehouse when the order was quoted, so "why was I charged this" has an answer.
-- The charge itself needs no column: an order's total is its goods less the promo plus the charge.
--
-- Additive only: a nullable column, so the previous release keeps running (n-minus-1).
-- Rollback: the previous release ignores it.
--
-- locks: a nullable column with no default (a catalogue change, no rewrite).
ALTER TABLE orders ADD COLUMN delivery_km NUMERIC(6, 1) CHECK (delivery_km >= 0);
