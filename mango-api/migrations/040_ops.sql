-- Staff operations (docs/ops.md): farm and purchase records (PURCHASE_RECORDS)
-- and managers' overrides of the safe customer-facing switches
-- (PANEL_FEATURE_SWITCHES). The stock forecast (STOCK_FORECAST) only reads
-- existing tables and needs none. Money is integer paise.

-- A manager's override of one allowlisted switch (src/feature-switches.js).
-- No row: the environment's value. The environment's 'false' always wins.
CREATE TABLE feature_switches (
  key        TEXT PRIMARY KEY CHECK (key ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  enabled    BOOLEAN NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- Farms and suppliers the shop buys from.
CREATE TABLE farms (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  place        TEXT,
  contact_name TEXT,
  -- Ten digits; the API only ever sends it masked.
  phone        TEXT CHECK (phone IS NULL OR phone ~ '^[6-9][0-9]{9}$'),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX idx_farms_name ON farms (lower(name));

-- What a batch cost: one or more purchases (a batch can come from two farms).
-- The API refuses purchases whose boxes add up to more than the batch received.
CREATE TABLE batch_purchases (
  id             TEXT PRIMARY KEY,
  batch_id       TEXT NOT NULL REFERENCES batches (id),
  farm_id        TEXT NOT NULL REFERENCES farms (id),
  purchased_on   DATE NOT NULL,
  crates         INTEGER NOT NULL CHECK (crates > 0),
  boxes          INTEGER NOT NULL CHECK (boxes > 0),
  cost_per_crate INTEGER NOT NULL CHECK (cost_per_crate > 0),
  transport_cost INTEGER NOT NULL DEFAULT 0 CHECK (transport_cost >= 0),
  other_cost     INTEGER NOT NULL DEFAULT 0 CHECK (other_cost >= 0),
  note           TEXT,
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL,
  updated_by     TEXT,
  updated_at     TIMESTAMPTZ
);
CREATE INDEX idx_batch_purchases_batch ON batch_purchases (batch_id);
CREATE INDEX idx_batch_purchases_farm ON batch_purchases (farm_id, purchased_on DESC);
CREATE INDEX idx_batch_purchases_date ON batch_purchases (purchased_on);
