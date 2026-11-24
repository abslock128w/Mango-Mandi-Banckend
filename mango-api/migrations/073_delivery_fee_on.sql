-- The owner asked for the delivery charge to be turned on (18 Nov), with the table of 072 (src/delivery-fee.js):
-- free within 2 km for orders of 5 kg and above, charged by distance and weight everywhere else.
--
-- Rules are versioned rows in app_config and the highest version is live (as in 063 and 072). This adds a new
-- version copied from the live one with deliveryFee.enabled true; every other rule is kept (live rules with no
-- deliveryFee get one that only says enabled, and the rest reads as the defaults of src/config.js). It adds
-- nothing when the charge is already on, when run again, or on a fresh database (no rules saved yet: the
-- default stays off there, and a manager turns it on in Planning). A manager can turn it off again in Planning.
--
-- Expand-only: the previous release reads the new version as before.
-- locks: app_config is locked in EXCLUSIVE mode, as saveConfig does, so a manager's save can't take the
-- same version number; it is a handful of rows.

LOCK TABLE app_config IN EXCLUSIVE MODE;

INSERT INTO app_config (version, value, changed_by)
SELECT live.version + 1,
       jsonb_set(live.value, '{deliveryFee}', COALESCE(live.value -> 'deliveryFee', '{}'::jsonb) || '{"enabled": true}'::jsonb),
       'system'
  FROM (SELECT version, value FROM app_config ORDER BY version DESC LIMIT 1) live
 WHERE COALESCE(live.value -> 'deliveryFee' -> 'enabled', 'false'::jsonb) <> 'true'::jsonb;
