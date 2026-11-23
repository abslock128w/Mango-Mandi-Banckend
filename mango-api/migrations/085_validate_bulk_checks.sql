-- 084 re-added three checks NOT VALID (no scan under their lock); this checks the rows already there.
-- locks: VALIDATE CONSTRAINT reads each table under SHARE UPDATE EXCLUSIVE (reads and writes keep working while it runs).

ALTER TABLE bulk_enquiries VALIDATE CONSTRAINT bulk_enquiries_status_check;
ALTER TABLE notifications VALIDATE CONSTRAINT notifications_kind_check;
ALTER TABLE farm_bookings VALIDATE CONSTRAINT farm_bookings_kg_check;
