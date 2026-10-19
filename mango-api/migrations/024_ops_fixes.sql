-- Finished notifications are pruned after 180 days (retention.js), and the
-- Needs attention view lists recent FAILED ones: both look rows up by age.
-- locks: CREATE INDEX blocks writes to notifications while it builds. The
-- table holds a few thousand rows at this point (well under a second), and the
-- runner's lock_timeout stops it queueing behind a long transaction.
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at);
