-- 089 added the preorder_groups kind check NOT VALID (no scan under its lock); this checks the rows already there.
-- locks: VALIDATE CONSTRAINT reads preorder_groups under SHARE UPDATE EXCLUSIVE (reads and writes keep working while it runs).

ALTER TABLE preorder_groups VALIDATE CONSTRAINT preorder_groups_kind_check;
