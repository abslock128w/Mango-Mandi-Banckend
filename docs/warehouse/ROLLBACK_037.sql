-- Rollback of migration 037_warehouse_next.sql (stocktake, repack, lineage).
--
-- Run only after WAREHOUSE_STOCKTAKE and WAREHOUSE_REPACK are off and the
-- previous API release is live, by a human with CTO sign-off, after a backup
-- (ops/backup.sh). It deletes the stocktake review records, the repack
-- records and the lot lineage of repacked boxes (box_origins). Boxes and
-- their events stay: a repacked box keeps parent_box_ids and its REPACKED /
-- REPACK_CREATED events, a box marked missing stays missing, so stock counts
-- stay right. Open stocktake and repack sessions are cancelled first (their
-- staged boxes dropped: nothing had changed for them). Finished sessions of
-- the two types stay as history; the type check is restored NOT VALID so
-- those rows remain readable while no new ones can be started.
BEGIN;
DELETE FROM wh_staged WHERE operation_id IN (SELECT id FROM wh_operations WHERE type IN ('stocktake', 'repack') AND status IN ('open', 'finalizing'));
UPDATE wh_operations SET status = 'cancelled', finished_at = now()
 WHERE type IN ('stocktake', 'repack') AND status IN ('open', 'finalizing');

DROP TABLE box_origins;
DROP TABLE wh_repacks;
DROP TABLE wh_stocktake_reviews;
DROP TABLE wh_stocktake_lines;
DROP INDEX wh_operations_one_open_stocktake;

ALTER TABLE wh_operations DROP CONSTRAINT wh_operations_type_check;
ALTER TABLE wh_operations ADD CONSTRAINT wh_operations_type_check
  CHECK (type IN ('receive', 'move', 'qc', 'pick', 'unpick', 'pack', 'dispatch', 'return')) NOT VALID;

DELETE FROM schema_migrations WHERE version = '037_warehouse_next.sql';
COMMIT;
