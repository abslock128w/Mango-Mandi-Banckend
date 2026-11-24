-- Partner Network: an application's details are deleted once it has ended
-- (src/partner/erase.js, docs/partner-network.md "How long applications are
-- kept"). PARTNER_RETENTION_DAYS (default 30) after an enquiry became
-- REJECTED, CLOSED or CONVERTED, the daily maintenance pass deletes its answers,
-- documents, notes and follow-ups and blanks the applicant's details on the
-- row; a CONVERTED one (a business partner now) keeps only the contact details.
-- The reference, categories, status, priority and dates stay, so the counts
-- stay honest, with erased_at saying when the rest went.
--
-- Expand-only: one nullable column with no default, and NOT NULL dropped from
-- columns that are blanked (a widening: every row the previous release writes
-- still passes, and it never writes NULL to them). The previous release reads
-- these columns in the panel; for the few minutes both run, an erased row shows
-- empty fields there. Rollback: the previous release ignores erased_at.
--
-- locks: brief ACCESS EXCLUSIVE locks on partner_enquiries and
-- partner_product_proposals for catalogue-only changes (no rewrite, no scan).

ALTER TABLE partner_enquiries ADD COLUMN erased_at TIMESTAMPTZ;

ALTER TABLE partner_enquiries ALTER COLUMN applicant_name DROP NOT NULL;
ALTER TABLE partner_enquiries ALTER COLUMN mobile_number DROP NOT NULL;
ALTER TABLE partner_enquiries ALTER COLUMN email DROP NOT NULL;
ALTER TABLE partner_enquiries ALTER COLUMN city DROP NOT NULL;
ALTER TABLE partner_enquiries ALTER COLUMN pincode DROP NOT NULL;
-- A hash of the answers (duplicate check): derived from the details, so it goes with them.
ALTER TABLE partner_enquiries ALTER COLUMN content_hash DROP NOT NULL;

-- A product proposal keeps its reference, status and dates; what was proposed goes.
ALTER TABLE partner_product_proposals ALTER COLUMN product_name DROP NOT NULL;
ALTER TABLE partner_product_proposals ALTER COLUMN product_category DROP NOT NULL;
