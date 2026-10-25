-- Rollback of migration 034_warehouse.sql (docs/warehouse/ROLLOUT.md, "Rolling back").
--
-- Run only after WAREHOUSE_V2 is off and the previous API release is live, and
-- only by a human with CTO sign-off: it deletes every box, label, scan and
-- box event. Take a backup first (ops/backup.sh). If any product had box
-- tracking on, its batch_lines.on_hand already equals its sellable boxes, so
-- stock counts stay right after the boxes are gone; packed units of open
-- orders stay packed (order_stock is untouched).
--
-- The old reason-code check is restored NOT VALID: ledger rows written with
-- BOX_* codes stay readable; new rows can only use the old codes.
BEGIN;
ALTER TABLE batch_ledger DROP CONSTRAINT batch_ledger_reason_code_check;
ALTER TABLE batch_ledger ADD CONSTRAINT batch_ledger_reason_code_check
  CHECK (reason_code IS NULL OR reason_code IN ('CORRECTION', 'COUNT', 'RECEIVED', 'DAMAGED', 'THEFT_LOSS', 'RETURN_RESTOCK', 'OTHER')) NOT VALID;

DROP TABLE wh_recalls;
DROP TABLE wh_writeoffs;
DROP FUNCTION box_pickable(UUID, DATE);
DROP FUNCTION box_shelf_sellable(UUID);
DROP TABLE box_events;
DROP FUNCTION box_events_append_only();
DROP TABLE wh_staged;
DROP TABLE wh_scans;
DROP TABLE wh_operations;
DROP FUNCTION wh_operations_fixed_context();
DROP TABLE box_holds;
DROP TABLE box_labels;
DROP TABLE boxes;
DROP TABLE box_lots;
DROP TABLE wh_locations;
ALTER TABLE admin_users DROP COLUMN warehouse_id;
DROP TABLE warehouses;
ALTER TABLE products DROP COLUMN qc_checklist, DROP COLUMN shelf_life_days, DROP COLUMN restockable_returns,
  DROP COLUMN requires_qc, DROP COLUMN weight_tolerance_pct, DROP COLUMN nominal_weight_g, DROP COLUMN box_tracking_enabled;
DELETE FROM schema_migrations WHERE version = '034_warehouse.sql';
COMMIT;
