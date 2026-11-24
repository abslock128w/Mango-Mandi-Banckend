-- A pre-order can be booked as a gift for someone else, as the regular checkout's gift: the booking
-- carries the recipient's name, mobile number and an optional message (POST /v1/preorders `gift`).
-- When the allocator turns the booking into its delivery order, the three go onto the order's own
-- gift_recipient_name / gift_recipient_phone / gift_message, so the rider, the recipient's messages
-- and the order views work as for any gift order. A booking that is not a gift leaves them NULL.
-- Deleting the account blanks them with the rest of the booking's details (src/privacy.js).
--
-- Expand-only: three nullable columns with no default. The previous release never reads them; a
-- gift booking made while both run converts without the recipient there, as before this release.
-- Rollback: the previous release ignores the columns.
--
-- locks: ADD COLUMN without a default is a catalogue change under a brief ACCESS EXCLUSIVE lock on
-- preorders (no rewrite, no scan).

ALTER TABLE preorders ADD COLUMN IF NOT EXISTS gift_recipient_name TEXT;
ALTER TABLE preorders ADD COLUMN IF NOT EXISTS gift_recipient_phone TEXT;
ALTER TABLE preorders ADD COLUMN IF NOT EXISTS gift_message TEXT;
