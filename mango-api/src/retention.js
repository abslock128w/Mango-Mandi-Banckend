// How long finished rows are kept. Called from the maintenance cleanup step
// (cleanupExpired), which runs once a minute: each call deletes a bounded
// number of rows, and a backlog drains over a few runs.
import { query } from './db.js'
import { now } from './clock.js'

/** Sent, failed and skipped customer messages are kept this long (the order page shows them). */
export const NOTIFICATION_RETENTION_DAYS = 180
const PRUNE_BATCH = 5_000

/**
 * Deletes finished notifications older than the retention window. PENDING
 * rows are never touched. Nothing queues a message for an event this old
 * (the longest look-back, review requests, is 72 hours), so removing a row
 * cannot cause a second send. Returns how many rows went.
 */
export async function pruneNotifications(at = now(), { days = NOTIFICATION_RETENTION_DAYS, batch = PRUNE_BATCH } = {}) {
  const r = await query(
    `DELETE FROM notifications WHERE id IN (
       SELECT id FROM notifications WHERE created_at < $1 AND status IN ('SENT', 'FAILED', 'SKIPPED') LIMIT $2)`,
    [new Date(at.getTime() - days * 86_400_000), batch],
  )
  return r.rowCount
}
