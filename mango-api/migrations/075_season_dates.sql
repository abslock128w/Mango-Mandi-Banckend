-- The owner's season dates on the live shop (18 Nov 2026): the 2027 season starts on 1 March 2027 and pre-orders
-- are open from 1 November 2026 (src/season-phase.js: from today the shop's home page is the pre-order shop, and
-- with migration 074 every box can be pre-ordered with no staff setup).
--
-- Rules are versioned rows in app_config and the highest version is live (as in 063, 072 and 073). This adds a new
-- version copied from the live one with seasonStartsOn "2027-03-01" and preorderOpensOn "2026-11-01", ONLY when the
-- live rules have no season start (null or missing). A season end on or before the new start (a past season's last
-- day) would leave no delivery week to pre-order (preorders.js deliveryWeeks stops at seasonEndsOn), so it is cleared
-- in the same version; a later end is kept. Every other rule is kept. It adds nothing when a start date is already
-- set (a manager's choice), when run again, or on a fresh database (no rules saved yet: the defaults stay, in
-- season, and a manager sets the dates in Planning). A manager can change the dates in Planning.
--
-- Expand-only: the previous release reads the new version as before (it knows both keys).
-- locks: app_config is locked in EXCLUSIVE mode, as saveConfig does, so a manager's save can't take the
-- same version number; it is a handful of rows.

LOCK TABLE app_config IN EXCLUSIVE MODE;

INSERT INTO app_config (version, value, changed_by)
SELECT live.version + 1,
       live.value || jsonb_build_object(
         'seasonStartsOn', '2027-03-01',
         'preorderOpensOn', '2026-11-01',
         'seasonEndsOn', CASE WHEN jsonb_typeof(live.value -> 'seasonEndsOn') = 'string' AND live.value ->> 'seasonEndsOn' > '2027-03-01'
                              THEN live.value -> 'seasonEndsOn' ELSE 'null'::jsonb END
       ),
       'system'
  FROM (SELECT version, value FROM app_config ORDER BY version DESC LIMIT 1) live
 WHERE jsonb_typeof(live.value -> 'seasonStartsOn') IS DISTINCT FROM 'string';
