-- Past the last distance band (12 km) an order is delivered, not refused (the owner, 19 Nov): it pays the last
-- band's charge plus a per-km amount for every km past it: Rs 20 a km for orders under the weight line (5 kg),
-- Rs 15 a km for orders at or above it; a part km counts as a whole one (src/delivery-fee.js chargeFor).
--
-- Rules are versioned rows in app_config and the highest version is live (as in 072 and 073). This adds a new
-- version copied from the live one with deliveryFee.beyond 'perKm' and perKmBeyond { fee: 15, feeSmall: 20 },
-- only when the live rules have a deliveryFee whose beyond is 'refuse' or missing; a manager's 'charge' is left
-- alone. It adds nothing when run again or on a fresh database (the defaults of src/config.js apply there).
--
-- Expand-only: the previous release drops the unknown key perKmBeyond and does not know 'perKm', so its stored
-- rules schema falls back to its own default for beyond while both run; nothing is refused that was not before.
-- locks: app_config is locked in EXCLUSIVE mode, as saveConfig does, so a manager's save can't take the
-- same version number; it is a handful of rows.

LOCK TABLE app_config IN EXCLUSIVE MODE;

INSERT INTO app_config (version, value, changed_by)
SELECT live.version + 1,
       jsonb_set(live.value, '{deliveryFee}', (live.value -> 'deliveryFee') || '{"beyond": "perKm", "perKmBeyond": {"fee": 15, "feeSmall": 20}}'::jsonb),
       'system'
  FROM (SELECT version, value FROM app_config ORDER BY version DESC LIMIT 1) live
 WHERE live.value ? 'deliveryFee'
   AND COALESCE(live.value -> 'deliveryFee' ->> 'beyond', 'refuse') = 'refuse';
