-- Farm visits: two more contact details on both farm forms (src/farm/contact.js, docs/farm-experience.md; the owner,
-- 24 Nov 2026). The Farm Experience booking (farm_bookings, 065) and the farm visit enquiry (bulk_enquiries of kind
-- FARM_VISIT, 087) each ask, both optional, the language the visitor would like our team to speak (English, Telugu,
-- Hindi, Tamil, Kannada or Other) and another number to reach them on (an Indian mobile, stored +91XXXXXXXXXX like
-- the main one). The panel shows both on the booking and on the enquiry; the team's new-booking WhatsApp names them.
--
-- What: ADD COLUMN preferred_language and alt_phone, nullable with no default, to farm_bookings and bulk_enquiries,
-- each with an inline CHECK (NULL passes: every row already there, and every row the previous release writes).
-- Why expand-only is safe: new nullable columns only. The previous release never reads or writes them; its INSERTs
-- name their columns, so they leave both NULL. Nothing is narrowed and no constraint on an existing column changes.
-- The 250 kg minimum and the two-night stay (same day) are API rules only: farm_bookings_kg_check (084, kg >= 100)
-- is left as it is, so bookings already made for 100 to 249 kg stay valid.
-- locks: ADD COLUMN with no default is a catalogue change under a brief ACCESS EXCLUSIVE lock on each table; the inline
-- CHECKs are on columns that are NULL in every row, so there is nothing to rewrite (both tables hold a few hundred
-- rows at most).
-- rollback: the previous release keeps working against this schema. To undo by hand: ALTER TABLE farm_bookings DROP
-- COLUMN alt_phone, DROP COLUMN preferred_language; and the same on bulk_enquiries (the answers given are lost).

ALTER TABLE farm_bookings ADD COLUMN IF NOT EXISTS preferred_language TEXT
  CHECK (preferred_language IS NULL OR preferred_language IN ('English', 'Telugu', 'Hindi', 'Tamil', 'Kannada', 'Other'));
ALTER TABLE farm_bookings ADD COLUMN IF NOT EXISTS alt_phone TEXT CHECK (alt_phone IS NULL OR alt_phone ~ '^\+91[6-9][0-9]{9}$');

ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS preferred_language TEXT
  CHECK (preferred_language IS NULL OR preferred_language IN ('English', 'Telugu', 'Hindi', 'Tamil', 'Kannada', 'Other'));
ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS alt_phone TEXT CHECK (alt_phone IS NULL OR alt_phone ~ '^\+91[6-9][0-9]{9}$');
