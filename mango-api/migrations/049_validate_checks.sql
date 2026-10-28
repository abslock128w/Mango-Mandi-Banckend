-- Validate the checks and keys that were added NOT VALID (architecture review,
-- TD-07): the ones from 034, 037, 038, 041 and 043, and the ones 048 just added.
-- Until now they held for new rows only; from here on every row is known to pass.
-- Names are those of the latest file that (re)defines each constraint.
--
-- locks: VALIDATE CONSTRAINT reads the whole table but holds only a SHARE UPDATE
-- EXCLUSIVE lock (reads and writes go on; only other schema changes wait), and a
-- foreign key's check takes ROW SHARE on the table it points at. The biggest
-- tables here are batch_ledger and notifications (tens of thousands of rows in a
-- season), a sub-second read each.
--
-- One old row that breaks a check fails this file, and so the whole deploy (the
-- old release keeps serving). Run it on a Neon branch copy of production first:
-- deploy/RELEASE.md "Before a release that validates constraints" has the query
-- that lists any such rows.

-- 034 (redefined from 028): stock adjustment reason codes.
ALTER TABLE batch_ledger VALIDATE CONSTRAINT batch_ledger_reason_code_check;
-- 037 (widened from 034): warehouse session types.
ALTER TABLE wh_operations VALIDATE CONSTRAINT wh_operations_type_check;
-- 038: money never negative, refund states the code writes.
ALTER TABLE orders VALIDATE CONSTRAINT orders_money_not_negative;
ALTER TABLE orders VALIDATE CONSTRAINT orders_refund_status_known;
ALTER TABLE preorders VALIDATE CONSTRAINT preorders_refund_status_known;
ALTER TABLE duplicate_payments VALIDATE CONSTRAINT duplicate_payments_refund_status_known;
-- 041 (redefined from 030 and 039): the outbox's kinds and targets.
ALTER TABLE notifications VALIDATE CONSTRAINT notifications_kind_check;
ALTER TABLE notifications VALIDATE CONSTRAINT notifications_target;
-- 043: the shop language a customer chose.
ALTER TABLE customers VALIDATE CONSTRAINT customers_language_check;
-- 048: chargebacks, second payments and order lines.
ALTER TABLE payment_disputes VALIDATE CONSTRAINT payment_disputes_order_fk;
ALTER TABLE payment_disputes VALIDATE CONSTRAINT payment_disputes_preorder_fk;
ALTER TABLE payment_disputes VALIDATE CONSTRAINT payment_disputes_status_known;
ALTER TABLE duplicate_payments VALIDATE CONSTRAINT duplicate_payments_amount_not_negative;
ALTER TABLE order_items VALIDATE CONSTRAINT order_items_price_not_negative;
ALTER TABLE order_items VALIDATE CONSTRAINT order_items_listing_fk;
