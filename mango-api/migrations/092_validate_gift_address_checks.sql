-- 091 added the preorders address checks and re-added the notifications kind check NOT VALID (no scan under their
-- locks); this checks the rows already there. Every existing booking has a pincode and an address and no address_state.
-- locks: VALIDATE CONSTRAINT reads preorders and notifications under SHARE UPDATE EXCLUSIVE (reads and writes keep
-- working while it runs).
-- rollback: nothing to undo (validating changes no data); 091's rollback notes apply.

ALTER TABLE preorders VALIDATE CONSTRAINT preorders_address_state_check;
ALTER TABLE preorders VALIDATE CONSTRAINT preorders_address_present;
ALTER TABLE notifications VALIDATE CONSTRAINT notifications_kind_check;
