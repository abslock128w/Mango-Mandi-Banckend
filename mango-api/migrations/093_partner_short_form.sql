-- Partner Network: the short "Grow with us" form (questionnaire 2026-11-v2, src/partner/questionnaire.js,
-- docs/partner-network.md). Three steps instead of five: it no longer asks the state, country, how to contact
-- the applicant or what type of organisation they represent (the PIN code has been nullable since 069). A v2
-- enquiry stores NULL in those columns rather than a value nobody gave. The first ticked category is still
-- stored as primary_category, and represents_business and start_timeline are still asked, so those stay NOT NULL.
--
-- What: DROP NOT NULL on partner_enquiries.state, country, preferred_contact_method and business_type. Their
-- CHECKs stay: a value that is there must still be one of the allowed ones (a CHECK passes on NULL). country
-- keeps its DEFAULT 'India' for inserts that leave it out; v2 passes NULL explicitly.
-- Why expand-only is safe: a widening. Every row the previous release writes (v1, which answers all four) still
-- passes, and it never writes NULL to them. The previous release reads these columns in the panel and already
-- copes with NULL in its neighbours (erased rows). Nothing to validate: no constraint is added.
-- locks: DROP NOT NULL is a catalogue-only change under a brief ACCESS EXCLUSIVE lock on partner_enquiries
-- (no rewrite, no scan).
-- rollback: the previous release keeps working against this schema. To undo by hand once no row holds NULL in
-- them (v2 rows will): ALTER TABLE partner_enquiries ALTER COLUMN state SET NOT NULL, ALTER COLUMN country SET NOT
-- NULL, ALTER COLUMN preferred_contact_method SET NOT NULL, ALTER COLUMN business_type SET NOT NULL.

ALTER TABLE partner_enquiries ALTER COLUMN state DROP NOT NULL;
ALTER TABLE partner_enquiries ALTER COLUMN country DROP NOT NULL;
ALTER TABLE partner_enquiries ALTER COLUMN preferred_contact_method DROP NOT NULL;
ALTER TABLE partner_enquiries ALTER COLUMN business_type DROP NOT NULL;
