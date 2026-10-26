-- Warehouse, next steps (docs/warehouse/STOCKTAKE.md, REPACK.md): stocktake
-- (cycle count) and repack sessions, their review and lineage records.
-- Add-only: two operation types on the existing check, new tables, one index.
-- The previous release never starts these session types and never reads the
-- new tables, so it runs unchanged on this schema.
--
-- locks: wh_operations is a small table (a few hundred sessions a day); the
-- partial unique index on it builds in well under a second. The widened type
-- check is added NOT VALID (every existing row already passes it).

-- ---------------------------------------------------------------- session types
ALTER TABLE wh_operations DROP CONSTRAINT wh_operations_type_check;
ALTER TABLE wh_operations ADD CONSTRAINT wh_operations_type_check
  CHECK (type IN ('receive', 'move', 'qc', 'pick', 'unpick', 'pack', 'dispatch', 'return', 'stocktake', 'repack')) NOT VALID;

-- One open count per location: two people counting the same shelf would each
-- see the other's boxes as missing.
CREATE UNIQUE INDEX wh_operations_one_open_stocktake ON wh_operations (location_id)
  WHERE type = 'stocktake' AND status IN ('open', 'finalizing');

-- ---------------------------------------------------------------- stocktake
-- What a finalized count found, one row per box that needs saying something
-- about. Kinds:
--   not_found            in stock here, not scanned: proposed missing (a supervisor decides)
--   not_found_allocated  on an order (or returned) and recorded here, not scanned: an exception to look into
--   found_elsewhere      scanned here, recorded elsewhere: location corrected at finalize
--   found_missing        scanned here, recorded missing: back in stock here at finalize
--   found_gone           scanned here, recorded dispatched, disposed, voided, repacked or never received: investigation hold at finalize
--   moved_after_snapshot changed by someone else after the count started: ignored
CREATE TABLE wh_stocktake_lines (
  operation_id         TEXT NOT NULL REFERENCES wh_operations (id) ON DELETE RESTRICT,
  box_id               UUID NOT NULL REFERENCES boxes (id) ON DELETE RESTRICT,
  kind                 TEXT NOT NULL CHECK (kind IN ('not_found', 'not_found_allocated', 'found_elsewhere', 'found_missing', 'found_gone',
                                                     'moved_after_snapshot')),
  -- proposed: waiting for review; pending_approval: marked missing, waiting for a second person (D8);
  -- missing: applied; kept: reviewed, left as recorded; rejected: the second person said no;
  -- superseded: the box changed before the review applied; applied / ignored: done at finalize.
  status               TEXT NOT NULL CHECK (status IN ('proposed', 'pending_approval', 'missing', 'kept', 'rejected', 'superseded', 'applied', 'ignored')),
  recorded_location_id TEXT REFERENCES wh_locations (id) ON DELETE RESTRICT,
  recorded_lifecycle   TEXT NOT NULL,
  -- The box's version when the count finalized: a review applies only if nothing changed since.
  box_version          INTEGER NOT NULL,
  review_id            TEXT,
  decided_by           TEXT,
  decided_at           TIMESTAMPTZ,
  PRIMARY KEY (operation_id, box_id)
);
CREATE INDEX wh_stocktake_lines_open ON wh_stocktake_lines (status) WHERE status IN ('proposed', 'pending_approval');
CREATE INDEX wh_stocktake_lines_box ON wh_stocktake_lines (box_id);

-- A supervisor's review of one count. Marking more than the D8 limit missing
-- waits for a second person with adjust.approve; nobody approves their own.
CREATE TABLE wh_stocktake_reviews (
  id            TEXT PRIMARY KEY,
  operation_id  TEXT NOT NULL UNIQUE REFERENCES wh_operations (id) ON DELETE RESTRICT,
  warehouse_id  TEXT NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
  missing_count INTEGER NOT NULL CHECK (missing_count >= 0),
  missing_grams INTEGER NOT NULL CHECK (missing_grams >= 0),
  kept_count    INTEGER NOT NULL CHECK (kept_count >= 0),
  note          TEXT CHECK (length(note) <= 300),
  status        TEXT NOT NULL CHECK (status IN ('pending_approval', 'applied', 'rejected')),
  reviewed_by   TEXT NOT NULL,
  reviewed_at   TIMESTAMPTZ NOT NULL,
  decided_by    TEXT,
  decided_at    TIMESTAMPTZ,
  CHECK (decided_by IS NULL OR decided_by <> reviewed_by)
);
CREATE INDEX wh_stocktake_reviews_pending ON wh_stocktake_reviews (warehouse_id, reviewed_at) WHERE status = 'pending_approval';

-- ---------------------------------------------------------------- repack
-- One finalized repack, split or merge: the boxes that went in (now repacked)
-- and the new boxes that came out, with what was taken out.
CREATE TABLE wh_repacks (
  operation_id   TEXT PRIMARY KEY REFERENCES wh_operations (id) ON DELETE RESTRICT,
  warehouse_id   TEXT NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
  kind           TEXT NOT NULL CHECK (kind IN ('repack', 'split', 'merge')),
  source_box_ids UUID[] NOT NULL CHECK (cardinality(source_box_ids) BETWEEN 1 AND 50),
  output_box_ids UUID[] NOT NULL CHECK (cardinality(output_box_ids) BETWEEN 1 AND 20),
  fruit_removed  INTEGER NOT NULL CHECK (fruit_removed >= 0),
  weight_lost_g  INTEGER NOT NULL CHECK (weight_lost_g >= 0),
  reason_code    TEXT NOT NULL CHECK (reason_code IN ('spoiled_fruit', 'damaged_box', 'merge_partials', 'split', 'other')),
  reason         TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX wh_repacks_created ON wh_repacks (warehouse_id, created_at DESC);

-- Every lot (and batch) a repacked box's fruit came from, its own included:
-- a merged box links all of them, so a recall of any one finds it. Parent
-- boxes themselves are in boxes.parent_box_ids.
CREATE TABLE box_origins (
  box_id   UUID NOT NULL REFERENCES boxes (id) ON DELETE RESTRICT,
  lot_id   TEXT NOT NULL REFERENCES box_lots (id) ON DELETE RESTRICT,
  batch_id TEXT NOT NULL REFERENCES batches (id) ON DELETE RESTRICT,
  PRIMARY KEY (box_id, lot_id)
);
CREATE INDEX box_origins_lot ON box_origins (lot_id);
