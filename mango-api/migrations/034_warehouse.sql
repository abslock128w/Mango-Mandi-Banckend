-- Warehouse and box traceability (docs/warehouse/). Add-only: new tables, new
-- nullable or defaulted columns, and a wider reason-code check on the ledger.
-- Nothing here changes how today's stock flow behaves: every product starts
-- with box tracking off, and the routes stay hidden until WAREHOUSE_V2=true.
--
-- locks: products, admin_users and warehouses are small tables (tens of rows); the
-- column checks and the foreign key on them scan a few rows under a brief lock.

-- ---------------------------------------------------------------- products
-- Per-product warehouse rules. A product's stock switches from counted boxes
-- to labelled boxes only when box_tracking_enabled is turned on (after its
-- existing stock is labelled and reconciled: docs/warehouse/ROLLOUT.md).
ALTER TABLE products ADD COLUMN box_tracking_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN nominal_weight_g INTEGER CHECK (nominal_weight_g IS NULL OR nominal_weight_g BETWEEN 1 AND 100000);
ALTER TABLE products ADD COLUMN weight_tolerance_pct NUMERIC(5,2) NOT NULL DEFAULT 3 CHECK (weight_tolerance_pct BETWEEN 0 AND 50);
ALTER TABLE products ADD COLUMN requires_qc BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE products ADD COLUMN restockable_returns BOOLEAN NOT NULL DEFAULT FALSE;
-- Days from the plucked (or packed) date a box may be sold; NULL: the shop's maxSellableAge rule.
ALTER TABLE products ADD COLUMN shelf_life_days INTEGER CHECK (shelf_life_days IS NULL OR shelf_life_days BETWEEN 1 AND 365);
-- The reasons a QC inspector can pick for this product.
ALTER TABLE products ADD COLUMN qc_checklist JSONB NOT NULL
  DEFAULT '["BRUISED", "UNDER_RIPE", "OVER_RIPE", "PEST_DAMAGE", "MOULD", "UNDERWEIGHT", "WRONG_COUNT", "OTHER"]'::jsonb;

-- ---------------------------------------------------------------- warehouses
CREATE TABLE warehouses (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO warehouses (id, name) VALUES ('wh_main', 'Main warehouse');

-- Every staff member works in one warehouse (D9: one today).
ALTER TABLE admin_users ADD COLUMN warehouse_id TEXT NOT NULL DEFAULT 'wh_main' REFERENCES warehouses (id);

CREATE TABLE wh_locations (
  id           TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
  zone         TEXT NOT NULL DEFAULT '' CHECK (length(zone) <= 40),
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  type         TEXT NOT NULL CHECK (type IN ('receiving', 'ripening', 'cold_storage', 'storage', 'qc_hold', 'pick_staging',
                                             'packing', 'dispatch_bay', 'returns', 'disposal')),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  -- What the location's QR label encodes (MML1:<token>).
  label_token  TEXT NOT NULL UNIQUE CHECK (label_token ~ '^[0-9A-HJKMNP-TV-Z]{26,40}$'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  UNIQUE (warehouse_id, zone, name)
);
CREATE INDEX wh_locations_warehouse ON wh_locations (warehouse_id, type) WHERE active;

-- Starter locations, one of each type. Tokens: 128+ random bits from two UUIDs
-- (hex digits are valid Crockford Base32). Staff rename them in the panel.
INSERT INTO wh_locations (id, warehouse_id, zone, name, type, label_token)
SELECT 'loc_' || substr(md5(t.name), 1, 16), 'wh_main', '', t.name, t.type,
       upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 32) || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  FROM (VALUES ('Receiving', 'receiving'), ('Storage A', 'storage'), ('Cold room', 'cold_storage'), ('Ripening room', 'ripening'),
               ('QC hold', 'qc_hold'), ('Pick staging', 'pick_staging'), ('Packing', 'packing'), ('Dispatch bay', 'dispatch_bay'),
               ('Returns', 'returns'), ('Disposal', 'disposal')) AS t (name, type);

-- ---------------------------------------------------------------- lots
-- One box intake: one batch line (one product of one delivery). The line keeps
-- the stock counters; the lot keeps the labelling and receiving counts.
CREATE TABLE box_lots (
  id               TEXT PRIMARY KEY,
  line_id          TEXT NOT NULL UNIQUE REFERENCES batch_lines (id) ON DELETE RESTRICT,
  batch_id         TEXT NOT NULL REFERENCES batches (id) ON DELETE RESTRICT,
  sku              TEXT NOT NULL REFERENCES products (sku) ON DELETE RESTRICT,
  warehouse_id     TEXT NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
  -- Human batch code printed on every label, e.g. L2610-ALP3-7K.
  code             TEXT NOT NULL UNIQUE,
  supplier         TEXT,
  -- Boxes the supplier said were coming; target_count is how many labels exist
  -- or will (expected, plus any added on arrival).
  expected_count   INTEGER NOT NULL CHECK (expected_count BETWEEN 1 AND 20000),
  target_count     INTEGER NOT NULL CHECK (target_count BETWEEN 1 AND 20000),
  generated_count  INTEGER NOT NULL DEFAULT 0 CHECK (generated_count >= 0),
  verified_count   INTEGER NOT NULL DEFAULT 0 CHECK (verified_count >= 0),
  voided_count     INTEGER NOT NULL DEFAULT 0 CHECK (voided_count >= 0),
  nominal_weight_g INTEGER NOT NULL CHECK (nominal_weight_g BETWEEN 1 AND 100000),
  harvested_on     DATE,
  received_on      DATE NOT NULL,
  best_before      DATE NOT NULL CHECK (best_before > received_on),
  qc_notes         TEXT CHECK (length(qc_notes) <= 1000),
  status           TEXT NOT NULL CHECK (status IN ('generating', 'receiving', 'received', 'closed', 'voided')),
  is_legacy        BOOLEAN NOT NULL DEFAULT FALSE,
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL,
  updated_at       TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,
  CHECK (generated_count <= target_count),
  CHECK (verified_count + voided_count <= generated_count),
  CHECK (harvested_on IS NULL OR harvested_on <= received_on)
);
CREATE INDEX box_lots_status ON box_lots (warehouse_id, status, created_at DESC);
CREATE INDEX box_lots_batch ON box_lots (batch_id);

-- ---------------------------------------------------------------- boxes
-- One physical, labelled box. Lifecycle, quality and holds are separate:
-- releasing one restriction never releases another (docs/warehouse/MODEL.md).
CREATE TABLE boxes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human box code: 8 Crockford Base32 symbols and a check symbol (XXXX-XXXX-C shown).
  code              TEXT NOT NULL UNIQUE CHECK (code ~ '^[0-9A-HJKMNP-TV-Z]{9}$'),
  -- What the QR encodes now (MMB1:<token>); every token ever issued is in box_labels.
  label_token       TEXT NOT NULL UNIQUE,
  lot_id            TEXT NOT NULL REFERENCES box_lots (id) ON DELETE RESTRICT,
  line_id           TEXT NOT NULL REFERENCES batch_lines (id) ON DELETE RESTRICT,
  batch_id          TEXT NOT NULL REFERENCES batches (id) ON DELETE RESTRICT,
  sku               TEXT NOT NULL REFERENCES products (sku) ON DELETE RESTRICT,
  -- Snapshot at intake, for the label and history; the product row stays the source of truth.
  sku_name          TEXT NOT NULL,
  seq               INTEGER NOT NULL CHECK (seq > 0),
  warehouse_id      TEXT NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
  location_id       TEXT REFERENCES wh_locations (id) ON DELETE RESTRICT,
  lifecycle         TEXT NOT NULL CHECK (lifecycle IN ('generated', 'in_stock', 'picked', 'packed', 'dispatched', 'returned', 'missing',
                                                       'voided', 'disposed', 'repacked')),
  quality           TEXT NOT NULL CHECK (quality IN ('pending', 'passed', 'failed', 'needs_review')),
  verification      TEXT CHECK (verification IN ('scanned', 'count_confirmed', 'legacy')),
  nominal_weight_g  INTEGER NOT NULL CHECK (nominal_weight_g > 0),
  measured_weight_g INTEGER CHECK (measured_weight_g > 0),
  fruit_count       INTEGER CHECK (fruit_count > 0),
  best_before       DATE NOT NULL,
  order_id          TEXT REFERENCES orders (id) ON DELETE RESTRICT,
  order_item_id     TEXT REFERENCES order_items (id) ON DELETE RESTRICT,
  -- Set on boxes made by a repack (several parents when boxes were merged).
  parent_box_ids    UUID[] NOT NULL DEFAULT '{}',
  reprint_count     INTEGER NOT NULL DEFAULT 0 CHECK (reprint_count >= 0),
  version           INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at        TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL,
  UNIQUE (lot_id, seq),
  -- A box is bound to an order exactly while it is picked, packed or dispatched.
  CONSTRAINT boxes_allocation_matches_lifecycle CHECK ((order_id IS NOT NULL) = (lifecycle IN ('picked', 'packed', 'dispatched'))),
  CONSTRAINT boxes_item_with_order CHECK ((order_item_id IS NULL) = (order_id IS NULL)),
  -- A box on the floor has a place; one not yet received or gone for good may not.
  CONSTRAINT boxes_location_when_present CHECK (location_id IS NOT NULL OR lifecycle IN ('generated', 'voided', 'disposed', 'repacked', 'dispatched', 'missing'))
);
CREATE INDEX boxes_line_state ON boxes (line_id, lifecycle, quality);
CREATE INDEX boxes_sku_state ON boxes (sku, lifecycle, quality);
CREATE INDEX boxes_location ON boxes (location_id) WHERE location_id IS NOT NULL;
CREATE INDEX boxes_order ON boxes (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX boxes_best_before ON boxes (best_before) WHERE lifecycle = 'in_stock';
CREATE INDEX boxes_batch ON boxes (batch_id);
CREATE INDEX boxes_parents ON boxes USING gin (parent_box_ids) WHERE parent_box_ids <> '{}';

-- Every label token ever printed for a box. A reissue revokes the old one, so
-- an old label scanned later is recognised (LABEL_REVOKED) instead of unknown.
CREATE TABLE box_labels (
  token        TEXT PRIMARY KEY CHECK (token ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  box_id       UUID NOT NULL REFERENCES boxes (id) ON DELETE RESTRICT,
  issued_at    TIMESTAMPTZ NOT NULL,
  issued_by    TEXT NOT NULL,
  revoked_at   TIMESTAMPTZ,
  revoked_by   TEXT,
  revoke_reason TEXT CHECK (length(revoke_reason) <= 300)
);
CREATE INDEX box_labels_box ON box_labels (box_id);
CREATE UNIQUE INDEX box_labels_one_live ON box_labels (box_id) WHERE revoked_at IS NULL;

CREATE TABLE box_holds (
  id             TEXT PRIMARY KEY,
  box_id         UUID NOT NULL REFERENCES boxes (id) ON DELETE RESTRICT,
  kind           TEXT NOT NULL CHECK (kind IN ('qc_hold', 'recall_hold', 'damage_hold', 'investigation_hold', 'return_hold')),
  reason         TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  added_by       TEXT NOT NULL,
  added_at       TIMESTAMPTZ NOT NULL,
  recall_id      TEXT,
  released_by    TEXT,
  released_at    TIMESTAMPTZ,
  release_reason TEXT CHECK (length(release_reason) <= 300),
  CHECK ((released_at IS NULL) = (released_by IS NULL))
);
-- One active hold of each kind per box.
CREATE UNIQUE INDEX box_holds_active ON box_holds (box_id, kind) WHERE released_at IS NULL;
CREATE INDEX box_holds_open ON box_holds (kind) WHERE released_at IS NULL;

-- ---------------------------------------------------------------- operations and scans
CREATE TABLE wh_operations (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL CHECK (type IN ('receive', 'move', 'qc', 'pick', 'unpick', 'pack', 'dispatch', 'return')),
  -- immediate: each accepted scan commits; staged: nothing changes until finalize.
  class            TEXT NOT NULL CHECK (class IN ('immediate', 'staged')),
  warehouse_id     TEXT NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
  -- Fixed when the operation starts (destination, order, lot, QC result); a new context is a new operation.
  context          JSONB NOT NULL DEFAULT '{}'::jsonb,
  location_id      TEXT REFERENCES wh_locations (id) ON DELETE RESTRICT,
  order_id         TEXT REFERENCES orders (id) ON DELETE RESTRICT,
  lot_id           TEXT REFERENCES box_lots (id) ON DELETE RESTRICT,
  status           TEXT NOT NULL CHECK (status IN ('open', 'finalizing', 'completed', 'cancelled', 'expired', 'failed')),
  owner_id         TEXT NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL,
  finished_at      TIMESTAMPTZ,
  accepted_count   INTEGER NOT NULL DEFAULT 0,
  rejected_count   INTEGER NOT NULL DEFAULT 0,
  duplicate_count  INTEGER NOT NULL DEFAULT 0,
  result           JSONB
);
CREATE INDEX wh_operations_open ON wh_operations (warehouse_id, status, last_activity_at) WHERE status IN ('open', 'finalizing');
CREATE INDEX wh_operations_owner ON wh_operations (owner_id, started_at DESC);
CREATE INDEX wh_operations_order ON wh_operations (order_id) WHERE order_id IS NOT NULL;

-- The context, type, owner and warehouse never change after the operation starts.
CREATE OR REPLACE FUNCTION wh_operations_fixed_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.context IS DISTINCT FROM OLD.context OR NEW.type <> OLD.type OR NEW.owner_id <> OLD.owner_id
     OR NEW.warehouse_id <> OLD.warehouse_id OR NEW.location_id IS DISTINCT FROM OLD.location_id
     OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.lot_id IS DISTINCT FROM OLD.lot_id THEN
    RAISE EXCEPTION 'an operation''s context cannot change; start a new operation' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wh_operations_fixed_context BEFORE UPDATE ON wh_operations FOR EACH ROW EXECUTE FUNCTION wh_operations_fixed_context();

-- One row per scan attempt. scan_id is made by the client before sending, so a
-- retry of the same physical scan replays the stored result.
CREATE TABLE wh_scans (
  id                TEXT PRIMARY KEY,
  scan_id           UUID NOT NULL UNIQUE,
  operation_id      TEXT NOT NULL REFERENCES wh_operations (id) ON DELETE RESTRICT,
  seq               INTEGER NOT NULL,
  input             TEXT NOT NULL CHECK (length(input) <= 128),
  box_id            UUID REFERENCES boxes (id) ON DELETE RESTRICT,
  result            TEXT NOT NULL CHECK (result IN ('accepted', 'warning', 'rejected', 'duplicate', 'undone')),
  code              TEXT NOT NULL,
  message           TEXT NOT NULL,
  detail            JSONB,
  received_at       TIMESTAMPTZ NOT NULL,
  -- From the device, for display only; never used to order anything.
  client_scanned_at TIMESTAMPTZ,
  attempts          INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX wh_scans_operation ON wh_scans (operation_id, seq);
-- A box is accepted at most once per operation.
CREATE UNIQUE INDEX wh_scans_accepted_once ON wh_scans (operation_id, box_id) WHERE result = 'accepted' AND box_id IS NOT NULL;
CREATE INDEX wh_scans_box ON wh_scans (box_id) WHERE box_id IS NOT NULL;

-- Boxes staged on an all-or-nothing operation (pack, dispatch) until it finalizes.
CREATE TABLE wh_staged (
  operation_id TEXT NOT NULL REFERENCES wh_operations (id) ON DELETE RESTRICT,
  box_id       UUID NOT NULL REFERENCES boxes (id) ON DELETE RESTRICT,
  scan_id      UUID NOT NULL,
  staged_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (operation_id, box_id)
);
CREATE INDEX wh_staged_box ON wh_staged (box_id);

-- ---------------------------------------------------------------- events
-- Append-only history of every box change. Corrections are new events.
-- Events carry the order id only, never a customer's name, phone or address.
CREATE TABLE box_events (
  id             TEXT PRIMARY KEY,
  box_id         UUID NOT NULL REFERENCES boxes (id) ON DELETE RESTRICT,
  type           TEXT NOT NULL,
  operation_id   TEXT REFERENCES wh_operations (id) ON DELETE RESTRICT,
  scan_id        UUID,
  actor_id       TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL,
  from_lifecycle TEXT,
  to_lifecycle   TEXT,
  from_location  TEXT,
  to_location    TEXT,
  from_quality   TEXT,
  to_quality     TEXT,
  hold_added     TEXT,
  hold_released  TEXT,
  order_id       TEXT,
  reason_code    TEXT,
  reason         TEXT CHECK (length(reason) <= 500),
  meta           JSONB
);
CREATE INDEX box_events_box ON box_events (box_id, created_at, id);
CREATE INDEX box_events_operation ON box_events (operation_id) WHERE operation_id IS NOT NULL;
CREATE INDEX box_events_created ON box_events (created_at DESC);

CREATE OR REPLACE FUNCTION box_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'box_events is append-only: % is not allowed', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER box_events_no_update_delete BEFORE UPDATE OR DELETE ON box_events FOR EACH ROW EXECUTE FUNCTION box_events_append_only();
CREATE TRIGGER box_events_no_truncate BEFORE TRUNCATE ON box_events FOR EACH STATEMENT EXECUTE FUNCTION box_events_append_only();

-- ---------------------------------------------------------------- the pickable rule
-- One implementation, used by stock counting, pick checks and reports.
-- Shelf-sellable: in stock, QC passed, no active hold, in an active location
-- whose type is pickable, in an active warehouse, from a batch still in service. For a product with box
-- tracking on, batch_lines.on_hand equals the line's shelf-sellable boxes.
CREATE OR REPLACE FUNCTION box_shelf_sellable(p_box UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM boxes b
      JOIN wh_locations l ON l.id = b.location_id
      JOIN warehouses w ON w.id = b.warehouse_id
      JOIN batches bt ON bt.id = b.batch_id
     WHERE b.id = p_box AND b.lifecycle = 'in_stock' AND b.quality = 'passed'
       AND bt.status NOT IN ('EXHAUSTED', 'CONDEMNED')
       AND l.active AND w.active AND l.warehouse_id = b.warehouse_id
       AND l.type IN ('storage', 'cold_storage', 'ripening')
       AND NOT EXISTS (SELECT 1 FROM box_holds h WHERE h.box_id = b.id AND h.released_at IS NULL)
  )
$$;

-- Pickable on an IST calendar day: shelf-sellable, not past its best-before
-- date, and its product has box tracking on. Expiry is read here, at query
-- time, so stock stops being pickable at midnight IST with no job running.
CREATE OR REPLACE FUNCTION box_pickable(p_box UUID, p_today DATE) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT box_shelf_sellable(p_box) AND EXISTS (
    SELECT 1 FROM boxes b JOIN products p ON p.sku = b.sku
     WHERE b.id = p_box AND b.best_before >= p_today AND p.box_tracking_enabled
  )
$$;

-- ---------------------------------------------------------------- write-offs and recalls
-- A write-off of more boxes than the approval limit waits for a second person (D8).
CREATE TABLE wh_writeoffs (
  id           TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
  box_ids      UUID[] NOT NULL CHECK (cardinality(box_ids) BETWEEN 1 AND 500),
  reason_code  TEXT NOT NULL CHECK (reason_code IN ('spoiled', 'damaged', 'expired', 'recall', 'sample', 'other')),
  reason       TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  status       TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'rejected')),
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  decided_by   TEXT,
  decided_at   TIMESTAMPTZ,
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE INDEX wh_writeoffs_pending ON wh_writeoffs (warehouse_id, requested_at) WHERE status = 'pending';

-- A recall puts recall_hold on every box of the chosen lots and their repack
-- descendants that has not left. Big recalls run in chunks; held_count says how far.
CREATE TABLE wh_recalls (
  id           TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
  lot_ids      TEXT[] NOT NULL CHECK (cardinality(lot_ids) BETWEEN 1 AND 50),
  reason       TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  status       TEXT NOT NULL CHECK (status IN ('running', 'done', 'released')),
  held_count   INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL,
  finished_at  TIMESTAMPTZ,
  released_by  TEXT,
  released_at  TIMESTAMPTZ,
  release_reason TEXT
);

-- ---------------------------------------------------------------- ledger reasons
-- Box tracking keeps batch_lines.on_hand equal to the boxes that can be sold,
-- so it writes ADJUST rows with these reason codes (docs/warehouse/INVENTORY.md).
ALTER TABLE batch_ledger DROP CONSTRAINT batch_ledger_reason_code_check;
ALTER TABLE batch_ledger ADD CONSTRAINT batch_ledger_reason_code_check
  CHECK (reason_code IS NULL OR reason_code IN ('CORRECTION', 'COUNT', 'RECEIVED', 'DAMAGED', 'THEFT_LOSS', 'RETURN_RESTOCK', 'OTHER',
                                                 'BOX_RECEIVED', 'BOX_AVAILABLE', 'BOX_UNAVAILABLE', 'BOX_WRITE_OFF', 'BOX_PICK', 'BOX_UNPICK'))
  NOT VALID;
