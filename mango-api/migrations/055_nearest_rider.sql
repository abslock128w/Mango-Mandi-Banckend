-- Nearest rider and pickup warehouse (docs/rider-app/README.md, "Who gets which stop"):
-- where each delivery pincode and warehouse is, and which warehouse a rider picks a
-- stop up from. Addresses are free text, so a stop is placed at its pincode's centre
-- until addresses carry coordinates.
--
-- Additive only: nullable columns, so the previous release keeps running (n-minus-1).
-- Rollback: the previous release ignores them.
--
-- locks: pincodes and warehouses are small tables; the orders column is nullable with
-- no default and no key (a catalogue change, no rewrite).
ALTER TABLE pincodes ADD COLUMN lat NUMERIC(9, 6) CHECK (lat BETWEEN -90 AND 90);
ALTER TABLE pincodes ADD COLUMN lng NUMERIC(9, 6) CHECK (lng BETWEEN -180 AND 180);

ALTER TABLE warehouses ADD COLUMN lat NUMERIC(9, 6) CHECK (lat BETWEEN -90 AND 90);
ALTER TABLE warehouses ADD COLUMN lng NUMERIC(9, 6) CHECK (lng BETWEEN -180 AND 180);
ALTER TABLE warehouses ADD COLUMN address TEXT CHECK (length(address) <= 300);

-- The warehouse the rider collects this order from (set when it is assigned by distance).
ALTER TABLE orders ADD COLUMN pickup_warehouse_id TEXT;
