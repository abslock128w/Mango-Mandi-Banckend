-- Demo data added after a database already exists (src/seed.js, development and
-- staging previews only) records each addition here so it runs once: a demo
-- product a manager renames or removes does not come back on the next start.
--
-- Additive only: a new, empty table, so the previous release keeps running on
-- this schema (n-minus-1). Rollback: DROP TABLE demo_seed_runs.
--
-- locks: new, empty table only; nothing existing is touched.

CREATE TABLE demo_seed_runs (
  name   TEXT PRIMARY KEY,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
