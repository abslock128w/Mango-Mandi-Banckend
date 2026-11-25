-- Farm visit enquiries ask for two dates (change request 02, CR2-01, 25 Nov 2026: "mention only 2 days of visit"):
-- Day 1 (arrive) and Day 2 (leave); a visit is 2 days at most, and Day 2 may be Day 1 (a 1-day visit). The shop's
-- Farm visit form sends visitFrom and visitTo (bulk-enquiries.js farmVisitBody, visitRange).
--
-- What: ADD COLUMN visit_to DATE (Day 2) to bulk_enquiries, nullable with no default, with an inline CHECK: Day 2 needs
-- Day 1 and is Day 1 or the day after. Day 1 stays in visit_date (087): it already holds the one "preferred date" of
-- every farm visit enquiry sent so far, which reads as Day 1 with no Day 2 (the panel and the account show the one
-- date, as before). No rename, so the previous release keeps reading and writing visit_date unchanged.
-- Why expand-only is safe: a new nullable column only. The previous release never reads or writes it; its INSERT names
-- its columns, so it leaves visit_to NULL, which the CHECK allows. No existing constraint changes.
-- locks: ADD COLUMN with no default is a catalogue change under a brief ACCESS EXCLUSIVE lock; the inline CHECK is on a
-- column that is NULL in every row, so there is nothing to rewrite (bulk_enquiries holds a few hundred rows at most).
-- rollback: the previous release keeps working against this schema. To undo by hand:
-- ALTER TABLE bulk_enquiries DROP COLUMN visit_to; (each enquiry's Day 2 is lost; Day 1 stays in visit_date).

ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS visit_to DATE
  CHECK (visit_to IS NULL OR (visit_date IS NOT NULL AND visit_to >= visit_date AND visit_to <= visit_date + 1));
