-- Shop languages (SHOP_LANGUAGES, docs/languages.md): the language a signed-in
-- customer chose for the shop. NULL means they never chose; the shop then uses
-- the browser's own choice, or English.
--
-- locks: ADD COLUMN of a nullable column without a default takes a brief ACCESS
-- EXCLUSIVE lock (no rewrite). The CHECK is added NOT VALID, so it does not scan
-- customers under that lock; every existing row is NULL, which passes it.
-- Expand-only: the previous release never reads this column.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS language TEXT;

ALTER TABLE customers ADD CONSTRAINT customers_language_check
  CHECK (language IS NULL OR language IN ('en', 'hi', 'kn')) NOT VALID;
