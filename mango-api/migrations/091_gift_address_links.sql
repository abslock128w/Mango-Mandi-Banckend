-- Gift address links (docs/gifting.md, "Before the season"; GIFT_ADDRESS_LINKS with MULTI_GIFT). A giver who books a gift
-- for several people before the season may choose, per person, "Ask them on WhatsApp" instead of typing the address. The
-- booking is made without an address (address_state ADDRESS_PENDING); once the group is paid, the recipient gets a
-- WhatsApp message (GIFT_ADDRESS_REQUEST) with a link to a page where they type their own address and pincode
-- (address_state ADDRESS_GIVEN). A reminder goes to the recipient (GIFT_ADDRESS_REMINDER) and a note to the giver
-- (GIFT_ADDRESS_MISSING) when the delivery week is five days away and the address is still missing.
--
-- What:
--   - preorders.address_state: NULL for every booking made with its address (all bookings so far), else
--     ADDRESS_PENDING / ADDRESS_GIVEN;
--   - preorders.pincode and delivery_address may be NULL, but only while the address is pending
--     (preorders_address_present, added NOT VALID here and validated in 092);
--   - gift_address_links: one row per link (token_hash = sha256 hex of the token; the token itself is derived from
--     the link's id with a key from JWT_SECRET, src/gift-address-token.js, so it can be sent again without storing it);
--     at most one live (not revoked) link per booking;
--   - three notification kinds (the kind check widened NOT VALID, validated in 092).
-- Why expand-only is safe: the previous release never writes address_state (NULL: a normal booking), always writes a
-- pincode and an address, never reads gift_address_links, and never queues the new kinds.
-- locks: ADD COLUMN with no default is a catalogue change under a brief ACCESS EXCLUSIVE lock; DROP NOT NULL is a
-- catalogue change too (no scan); the three checks on existing tables (address_state, address present, notification
-- kinds) are added NOT VALID (no scan) and validated in 092; gift_address_links and its indexes are new and empty.
-- rollback: the previous release keeps working against this schema. To undo by hand once no booking is ADDRESS_PENDING:
--   DROP TABLE gift_address_links; ALTER TABLE preorders DROP CONSTRAINT preorders_address_present,
--   DROP CONSTRAINT preorders_address_state_check, DROP COLUMN address_state; ALTER TABLE preorders ALTER COLUMN pincode
--   SET NOT NULL, ALTER COLUMN delivery_address SET NOT NULL; and re-add the notifications kind check without the three kinds.

ALTER TABLE preorders ADD COLUMN IF NOT EXISTS address_state TEXT;
ALTER TABLE preorders ADD CONSTRAINT preorders_address_state_check
  CHECK (address_state IS NULL OR address_state IN ('ADDRESS_PENDING', 'ADDRESS_GIVEN')) NOT VALID;

ALTER TABLE preorders ALTER COLUMN pincode DROP NOT NULL;
ALTER TABLE preorders ALTER COLUMN delivery_address DROP NOT NULL;
ALTER TABLE preorders ADD CONSTRAINT preorders_address_present
  CHECK (address_state = 'ADDRESS_PENDING' OR (pincode IS NOT NULL AND delivery_address IS NOT NULL)) NOT VALID;

CREATE TABLE IF NOT EXISTS gift_address_links (
  id            TEXT PRIMARY KEY,
  preorder_id   TEXT NOT NULL REFERENCES preorders (id),
  token_hash    TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  sent_at       TIMESTAMPTZ,
  send_count    INTEGER NOT NULL DEFAULT 0 CHECK (send_count >= 0),
  reminded_at   TIMESTAMPTZ,
  giver_told_at TIMESTAMPTZ,
  filled_at     TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);
-- One live link per booking.
CREATE UNIQUE INDEX IF NOT EXISTS gift_address_links_live_idx ON gift_address_links (preorder_id) WHERE revoked_at IS NULL;
-- The maintenance reminder reads the links still waiting for an address.
CREATE INDEX IF NOT EXISTS gift_address_links_waiting_idx ON gift_address_links (expires_at) WHERE filled_at IS NULL AND revoked_at IS NULL;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'ORDER_CONFIRMED','REPLACEMENT_CONFIRMED','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','CANCELLED','REFUNDED',
  'PREORDER_BOOKED','PREORDER_SPOT_OPEN','PREORDER_MOVED','DATE_MOVED','GIFT_OUT_FOR_DELIVERY',
  'RIPENESS_GUIDE','BACK_IN_STOCK','REORDER_REMINDER','REVIEW_REQUEST',
  'CLAIM_RECEIVED','CLAIM_REJECTED','REFERRAL_REWARD','MANAGER_DAILY_SUMMARY','HELP_REPLY','SUBSCRIPTION_DUE',
  'DELIVERY_CODE','GIFT_DELIVERY_CODE',
  'PARTNER_ENQUIRY_RECEIVED','PARTNER_TEAM_ALERT',
  'BULK_ENQUIRY_RECEIVED','BULK_QUOTE','BULK_ORDER_PAID','FARM_VISIT_ENQUIRY_RECEIVED',
  'FARM_BOOKING_UPDATE','FARM_TEAM_ALERT',
  'PREORDER_DELAYED','PREORDER_EARLIER','ORDER_DELAYED',
  'GIFT_ADDRESS_REQUEST','GIFT_ADDRESS_REMINDER','GIFT_ADDRESS_MISSING')) NOT VALID;
