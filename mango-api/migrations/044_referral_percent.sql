-- Refer a friend, revised (docs/growth.md): the thank-you is given as soon as the friend's first
-- order is paid, by default as 10% off the next order (REFERRAL_REWARD_KIND / _PERCENT). If that
-- first order is then cancelled or refunded, codes not yet used are switched off and stamped here.
-- Additive: existing rows keep withdrawn_at NULL.
ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;
COMMENT ON COLUMN referral_rewards.amount IS 'The promo value given: paise for a FLAT code, a percent for a PERCENT code (promo_codes.kind says which)';
