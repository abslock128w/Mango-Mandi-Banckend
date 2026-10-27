-- Run records for each maintenance step (Needs attention, docs in deploy/SCHEDULER.md):
-- how long the step's last attempt took, and how many times in a row it has failed
-- (set back to 0 when it succeeds). Additive: existing rows get NULL and 0.
-- maintenance_runs holds one row per step, so adding a column with a default is instant.
ALTER TABLE maintenance_runs ADD COLUMN IF NOT EXISTS last_duration_ms INTEGER;
ALTER TABLE maintenance_runs ADD COLUMN IF NOT EXISTS fail_count INTEGER NOT NULL DEFAULT 0;
