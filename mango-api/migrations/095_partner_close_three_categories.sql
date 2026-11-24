-- Partner Network: "Grow with us" no longer offers three ways to partner (docs/partner-network.md, 2026-11-24):
-- Farmers & Suppliers (FARMERS_SUPPLIERS), Retail & Reseller Partners (RETAIL_RESELLER) and Other Opportunities
-- (OTHER). The public form lists only active categories (activeCategories, src/partner/enquiries.js) and a
-- submission may only choose an active one, so switching them off removes them from the form and from new
-- enquiries, on either questionnaire version.
--
-- What: UPDATE partnership_categories SET is_active = FALSE for those three codes. Data only; no schema change.
-- The rows stay: enquiries that already chose one keep their primary_category and partner_enquiry_categories rows
-- (both reference partnership_categories), and the panel, its counts and its category filter still read them by
-- name. The codes stay in CATEGORY_CODES (src/partner/questionnaire.js), where the 2026-11-v1 sections name them.
-- Why expand-only is safe: nothing is dropped or narrowed. The previous release reads is_active the same way, so
-- while it still serves it simply stops offering the three as well. An applicant whose open form still shows one
-- of them gets the field error "Choose from the options" on categories, as for any switched-off category.
-- locks: row locks on three rows of partnership_categories (a nine-row table), no table lock beyond ROW EXCLUSIVE.
-- rollback: reactivating is an UPDATE, by hand or from the panel's categories page:
-- UPDATE partnership_categories SET is_active = TRUE, updated_at = now()
--   WHERE code IN ('FARMERS_SUPPLIERS', 'RETAIL_RESELLER', 'OTHER');

UPDATE partnership_categories SET is_active = FALSE, updated_at = now()
 WHERE code IN ('FARMERS_SUPPLIERS', 'RETAIL_RESELLER', 'OTHER') AND is_active;
