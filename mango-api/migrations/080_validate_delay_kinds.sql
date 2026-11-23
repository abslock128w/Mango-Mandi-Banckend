-- 079 re-added the notifications kind check NOT VALID (no scan under its lock); this checks the rows already there.
-- locks: VALIDATE CONSTRAINT reads notifications under SHARE UPDATE EXCLUSIVE (writes keep working while it runs).

ALTER TABLE notifications VALIDATE CONSTRAINT notifications_kind_check;
