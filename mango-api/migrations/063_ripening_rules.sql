-- The ripening rule change (mango-api/README.md, Ripeness): a batch reaches the warehouse 1 day after it
-- is plucked, sells as RAW at ages 1–3 and SEMI_RIPE at ages 4–7 (age on the delivery date, the day of
-- pluck being 0), and is spoilt, never sold, from age 8. Nothing is sold as RIPE any more; a QC reading
-- may still say ripe (a fast ripener), and older orders that say RIPE are kept as they are.
--
-- Rules are versioned rows in app_config and the highest version is live, so the new defaults in
-- src/config.js only reach a fresh database. This adds a new version copied from the live one with
-- transitDays, the ripeness windows and the age limits replaced; every other rule is kept. It adds
-- nothing on a database that already has these rules (run again, or a manager saved them first), and
-- nothing on a fresh database (no rows yet): loadConfig writes version 1 from the new defaults there.
-- Stored eta_date on batches is left alone. Open orders are re-checked by the hourly rebalance; boxes
-- already promised as RIPE stay valid where the batch is SEMI_RIPE on the day (stage.js keepsPromise).
--
-- Bulk deals offering RIPE offer SEMI_RIPE instead (a deal offering both keeps SEMI_RIPE once), so no
-- deal offers a ripeness the shop no longer sells. Their version goes up, as for any change to a deal.
--
-- Expand-only: the previous release reads both the new rules version and the listings as before.
-- locks: app_config is locked in EXCLUSIVE mode, as saveConfig does, so a manager's save can't take the
-- same version number; it is a handful of rows. bulk_listings rows that offer RIPE are updated (a few).

LOCK TABLE app_config IN EXCLUSIVE MODE;

INSERT INTO app_config (version, value, changed_by)
SELECT live.version + 1,
       live.value || '{"transitDays": 1, "maxSellableAge": 7, "retireAge": 8,
                        "stageProfiles": {"default": [{"stage": "RAW", "minAge": 1, "maxAge": 3},
                                                      {"stage": "SEMI_RIPE", "minAge": 4, "maxAge": 7}]}}'::jsonb,
       'system'
  FROM (SELECT version, value FROM app_config ORDER BY version DESC LIMIT 1) live
 WHERE NOT (live.value @> '{"transitDays": 1, "maxSellableAge": 7, "retireAge": 8}'::jsonb
            AND live.value -> 'stageProfiles' = '{"default": [{"stage": "RAW", "minAge": 1, "maxAge": 3},
                                                              {"stage": "SEMI_RIPE", "minAge": 4, "maxAge": 7}]}'::jsonb);

UPDATE bulk_listings
   SET stages = ARRAY(SELECT s FROM unnest(array_replace(stages, 'RIPE', 'SEMI_RIPE')) WITH ORDINALITY AS u(s, n)
                       GROUP BY s ORDER BY min(n)),
       version = version + 1
 WHERE 'RIPE' = ANY(stages);
