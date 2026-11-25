-- The mixed box is called "Mixed Variety Mangoes" wherever a customer sees it (change request 01, CR-08, 25 Nov 2026:
-- "make it mixed variety mango box"). The shop, the bag, orders, bills and WhatsApp messages print a product's name and
-- description from this table, so the mixed box's products ("Mixed Box 3kg Box", "Mixed Box 5kg Box") are renamed
-- here: "Mixed Variety Mangoes 3kg Box", and "Mixed Variety Mangoes: four favourites in one box, …".
--
-- What: UPDATE products SET name, description (replace "Mixed Box" with "Mixed Variety Mangoes") on every row that
-- still says "Mixed Box" in either. Data only; no schema change. The sku (MIX-3, MIX-5) and the variety stay:
-- products.variety is a key (the pre-order plan's preorder_variety_week_kg and preorders.variety, batches.variety, the
-- rule preorderVarietyDayKg, order_items.plan_variety all hold "Mixed Box", and admin/products.js keeps a variety fixed
-- once a batch holds it), so customers are shown the new name by products.js shownVariety and the shop's catalog.js.
-- Bags, orders, pre-orders and bills refer to the sku, so they all still open; a past order keeps the name it was
-- placed with (order_items.name), as with any rename on the panel's Products page. A name a manager has already
-- changed away from "Mixed Box" is left alone.
-- Why expand-only is safe: nothing is dropped or narrowed, and the previous release reads name and description as
-- plain text, as it does after a rename on the Products page (its shop shows the variety, which is unchanged).
-- locks: row locks on the matching products rows (two in the demo catalogue; none in production unless a manager added
-- the mixed box), no table lock beyond ROW EXCLUSIVE. Run again, it changes nothing.
-- rollback: the previous release works with either name. To undo by hand:
-- UPDATE products SET name = replace(name, 'Mixed Variety Mangoes', 'Mixed Box'),
--   description = replace(description, 'Mixed Variety Mangoes', 'Mixed Box'), updated_at = now()
--   WHERE name LIKE '%Mixed Variety Mangoes%' OR description LIKE '%Mixed Variety Mangoes%';

UPDATE products
   SET name = replace(name, 'Mixed Box', 'Mixed Variety Mangoes'),
       description = replace(description, 'Mixed Box', 'Mixed Variety Mangoes'),
       updated_at = now()
 WHERE name LIKE '%Mixed Box%' OR description LIKE '%Mixed Box%';
