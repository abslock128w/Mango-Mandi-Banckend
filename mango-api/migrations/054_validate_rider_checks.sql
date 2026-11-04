-- Validates the notifications kind check that 053 added NOT VALID (the delivery
-- code's own WhatsApp message). Every row already holds a listed kind, so this
-- only scans; it takes a SHARE UPDATE EXCLUSIVE lock, which lets reads and
-- writes go on.
--
-- locks: VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE only (no writes blocked).
ALTER TABLE notifications VALIDATE CONSTRAINT notifications_kind_check;
