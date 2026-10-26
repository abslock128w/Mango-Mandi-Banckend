// Review upkeep run by maintenance: the "how were your mangoes?" WhatsApp a
// day after delivery, and photos that were uploaded but never sent. Both only
// read orders; neither touches stock, payments or order status.
import { now } from './clock.js'
import { query } from './db.js'
import { env } from './env.js'
import { dropPhoto, deleteUpload, staleUploads } from './photos.js'

const HOUR_MS = 3_600_000
/** Asked this long after delivery, and not after `REQUEST_UNTIL_MS` (a late ask is noise). */
export const REQUEST_AFTER_MS = 24 * HOUR_MS
const REQUEST_UNTIL_MS = 72 * HOUR_MS
const BATCH = 200

/**
 * Queues one REVIEW_REQUEST per delivered order, keyed on its DELIVERED event
 * so it can never be sent twice, and only if nothing on the order has been
 * reviewed yet. Off until WHATSAPP_REVIEW_REQUESTS=true (the Meta template
 * mandi_review_request has to be approved first); the order page works either
 * way. Returns how many were queued.
 */
export async function enqueueReviewRequests(at = now()) {
  if (!env.WHATSAPP_REVIEW_REQUESTS) return 0
  const r = await query(
    `INSERT INTO notifications (id, order_id, event_id, kind, phone, next_attempt_at, created_at)
     SELECT 'ntf_' || substr(md5(random()::text || e.id), 1, 20), o.id, e.id, 'REVIEW_REQUEST', o.phone, $1, $1
       FROM order_events e JOIN orders o ON o.id = e.order_id
      WHERE e.status = 'DELIVERED' AND e.created_at <= $2 AND e.created_at > $3
        AND o.status = 'DELIVERED' AND COALESCE(o.phone, '') <> ''
        AND NOT EXISTS (SELECT 1 FROM reviews rv WHERE rv.order_id = o.id)
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.order_id = o.id AND n.kind = 'REVIEW_REQUEST')
        AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id AND c.deleted_at IS NOT NULL)
      ORDER BY e.created_at LIMIT $4
     ON CONFLICT (event_id, kind) DO NOTHING`,
    [at, new Date(at.getTime() - REQUEST_AFTER_MS), new Date(at.getTime() - REQUEST_UNTIL_MS), BATCH],
  )
  return r.rowCount
}

/**
 * Review photos never attached to a review a day after upload, and direct
 * Blob uploads the phone never finished. A few hundred per run at most, so it
 * fits the maintenance time budget; the rest go next run.
 */
export async function cleanupReviewPhotos(at = now()) {
  const before = new Date(at.getTime() - 24 * HOUR_MS)
  const { rows } = await query(
    `DELETE FROM review_photos WHERE id IN (
       SELECT id FROM review_photos WHERE review_id IS NULL AND created_at < $1 ORDER BY created_at LIMIT $2)
     RETURNING blob_path`,
    [before, BATCH],
  )
  for (const row of rows) await dropPhoto(row)
  // INT-11 (24 Oct audit, PROVIDER_CHECKS): listing the Blob store is a billed operation, and
  // every-minute runs made ~43,000 a month with nothing to find. Hourly is plenty for uploads
  // that only count as abandoned after a day.
  const stale = !env.PROVIDER_CHECKS || (await blobSweepDue(at)) ? await staleUploads(before, 100) : []
  for (const path of stale) await deleteUpload(path)
  return rows.length + stale.length
}

/** Claims this hour's Blob sweep (one instance, one run an hour). */
async function blobSweepDue(at) {
  const { rowCount } = await query(
    `INSERT INTO maintenance_runs (step, last_ok_at) VALUES ('blob-sweep', $1)
     ON CONFLICT (step) DO UPDATE SET last_ok_at = $1 WHERE maintenance_runs.last_ok_at IS NULL OR maintenance_runs.last_ok_at <= $2`,
    [at, new Date(at.getTime() - HOUR_MS)],
  )
  return rowCount > 0
}
