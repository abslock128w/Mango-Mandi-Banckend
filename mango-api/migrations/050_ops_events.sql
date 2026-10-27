-- Rare API events, counted per minute in the database (docs/alerts.md): server
-- errors (5xx), slow answers, pool-busy 503s and database-unreachable 503s.
-- On Vercel each function instance has its own Prometheus counters and nothing
-- scrapes them, so the maintenance job's checkHealth reads these sums instead
-- and warns through Sentry. One row per minute and kind (src/ops-counters.js);
-- the cleanup step deletes rows older than 7 days.
--
-- locks: one new, empty table; nothing existing is touched.
CREATE TABLE ops_counters (
  bucket TIMESTAMPTZ NOT NULL,
  kind   TEXT NOT NULL CHECK (kind ~ '^[a-z0-9-]{1,40}$'),
  n      INTEGER NOT NULL CHECK (n > 0),
  PRIMARY KEY (bucket, kind)
);
