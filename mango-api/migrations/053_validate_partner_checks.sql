-- Validate the two outbox checks 052 (Partner Network) widened NOT VALID, as 049
-- did for 041's. Every existing row already holds one of the older kinds and
-- targets, which the widened checks still allow.
--
-- locks: VALIDATE CONSTRAINT reads notifications under SHARE UPDATE EXCLUSIVE
-- (reads and writes go on; only other schema changes wait), a sub-second read.

ALTER TABLE notifications VALIDATE CONSTRAINT notifications_kind_check;
ALTER TABLE notifications VALIDATE CONSTRAINT notifications_target;
