-- Managers add, rename and remove products from the panel.

-- A removed product that has been sold or stocked before is hidden, not
-- deleted: past orders and batches still need its name. Hidden products are
-- left out of the shop, WhatsApp ordering, preorders and new batches.
ALTER TABLE products ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;
-- The order products are shown in, lowest first (then by name).
ALTER TABLE products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE products ADD COLUMN updated_at TIMESTAMPTZ;

-- Databases made before product descriptions existed get the starter text
-- once. New databases get it from the seed.
UPDATE products SET description = 'Alphonso (Hapus): saffron flesh, rich and sweet, with almost no fibre.'
 WHERE sku IN ('ALP-3', 'ALP-5') AND description = '';
UPDATE products SET description = 'Badami, Karnataka''s Alphonso: sweet and juicy, a little lighter, at a friendlier price.'
 WHERE sku IN ('BAD-3', 'BAD-5') AND description = '';
