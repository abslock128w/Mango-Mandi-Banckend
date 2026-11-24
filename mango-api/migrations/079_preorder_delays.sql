-- Delays, and the customer's right to cancel a delayed pre-order (the owner, 18 Nov 2026: "customers pushed to a later
-- week get a WhatsApp message that it is delayed; if delayed the customer can cancel, only for pre-orders, the
-- cancellation opens when we delay, and only before packaging is done").
--
-- 1. preorders: delayed_at (the last time we moved it later), delayed_from_week (the first week it was promised, kept
--    across further delays), delay_count (how often we moved it later), delay_cancelled_at (the customer cancelled it
--    because of the delay: refunded in full). A booking is delayed while its week is later than delayed_from_week
--    (src/preorders.js isDelayed); a recalculation that brings it back clears delayed_at.
-- 2. notifications.params: a message's template variables fixed when it is queued (the delayed and earlier messages
--    name the week it moved from and to, which later moves must not rewrite), and the new kinds PREORDER_DELAYED,
--    PREORDER_EARLIER and ORDER_DELAYED (a regular order booked against the plan whose fruit came in short).
--
-- The deploy window: the previous release never reads these columns. A booking it cancels is cancelled as before
-- (no refund for a paid one); a delayed booking keeps its flag. Expand-only.
-- locks: ADD COLUMN without a default (and delay_count's constant default) are catalogue changes under a brief
-- ACCESS EXCLUSIVE lock; the kind check is re-added NOT VALID (no scan) and validated in 080; the partial index on
-- preorders (a few hundred rows a season) blocks its writes only for the moment it takes to build.

ALTER TABLE preorders ADD COLUMN IF NOT EXISTS delayed_at TIMESTAMPTZ;
ALTER TABLE preorders ADD COLUMN IF NOT EXISTS delayed_from_week DATE;
ALTER TABLE preorders ADD COLUMN IF NOT EXISTS delay_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE preorders ADD COLUMN IF NOT EXISTS delay_cancelled_at TIMESTAMPTZ;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS params JSONB;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'ORDER_CONFIRMED','REPLACEMENT_CONFIRMED','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','CANCELLED','REFUNDED',
  'PREORDER_BOOKED','PREORDER_SPOT_OPEN','PREORDER_MOVED','DATE_MOVED','GIFT_OUT_FOR_DELIVERY',
  'RIPENESS_GUIDE','BACK_IN_STOCK','REORDER_REMINDER','REVIEW_REQUEST',
  'CLAIM_RECEIVED','CLAIM_REJECTED','REFERRAL_REWARD','MANAGER_DAILY_SUMMARY','HELP_REPLY','SUBSCRIPTION_DUE',
  'DELIVERY_CODE','GIFT_DELIVERY_CODE',
  'PARTNER_ENQUIRY_RECEIVED','PARTNER_TEAM_ALERT',
  'BULK_ENQUIRY_RECEIVED','BULK_QUOTE',
  'FARM_BOOKING_UPDATE','FARM_TEAM_ALERT',
  'PREORDER_DELAYED','PREORDER_EARLIER','ORDER_DELAYED')) NOT VALID;

-- The panel's "Delayed" list and Needs attention look these up.
CREATE INDEX IF NOT EXISTS preorders_delayed_idx ON preorders (delayed_at) WHERE delayed_at IS NOT NULL;
