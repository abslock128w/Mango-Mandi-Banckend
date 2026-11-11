-- 066: validates the two notifications checks that 065 re-added NOT VALID (with the
-- Farm Experience kinds), as 061 did after 060. Every existing row already passes them.
-- A separate migration so 065's brief lock on notifications stays brief.
--
-- locks: VALIDATE CONSTRAINT reads notifications under SHARE UPDATE EXCLUSIVE
-- (writes keep working while it runs).

ALTER TABLE notifications VALIDATE CONSTRAINT notifications_kind_check;
ALTER TABLE notifications VALIDATE CONSTRAINT notifications_target;
