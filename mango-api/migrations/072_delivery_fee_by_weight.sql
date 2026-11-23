-- The delivery charge goes by weight, not order value (the owner's table, 18 Nov; src/delivery-fee.js):
-- an order of `freeFromKg` (now 5) kg or more pays a band's `fee`, a lighter one its `feeSmall`, and the
-- heavier orders are free only at or within the new `freeWithinKm` (2 km). `freeAbove` decides nothing now;
-- it stays in stored rules (and still parses) so every older version loads.
--
-- Rules are versioned rows in app_config and the highest version is live (as in 063), so the new defaults in
-- src/config.js reach only a fresh database and live rules that never named the keys. This adds a new
-- version copied from the live one with deliveryFee.freeFromKg 6 (the old default, "free from 6 kg at any
-- distance") replaced by 5 and freeWithinKm 2; every other rule, the bands included, is kept. A live
-- version that names another weight was a manager's choice and is left for them on the Planning page
-- (its missing freeWithinKm reads as the default 2). It adds nothing when the live rules have no
-- deliveryFee, or no freeFromKg (both get the new defaults on load), when run again, or on a fresh database.
--
-- Expand-only: the previous release reads the new version as before (freeWithinKm is an unknown key there,
-- dropped by storedRulesSchema); it would treat 5 kg as free at any distance until this release is live.
-- locks: app_config is locked in EXCLUSIVE mode, as saveConfig does, so a manager's save can't take the
-- same version number; it is a handful of rows.

LOCK TABLE app_config IN EXCLUSIVE MODE;

INSERT INTO app_config (version, value, changed_by)
SELECT live.version + 1,
       jsonb_set(live.value, '{deliveryFee}', (live.value -> 'deliveryFee') || '{"freeFromKg": 5, "freeWithinKm": 2}'::jsonb),
       'system'
  FROM (SELECT version, value FROM app_config ORDER BY version DESC LIMIT 1) live
 WHERE live.value -> 'deliveryFee' -> 'freeFromKg' = '6'::jsonb;
