// How long finished rows are kept. Called from the maintenance cleanup step
// (cleanupExpired), which runs once a minute, and from the daily retention
// step: each call deletes a bounded number of rows, and a backlog drains over
// a few runs. What every cleanup removes, and why nothing on a bill or in the
// payment and refund records goes before BILL_RETENTION_MONTHS: docs/trust.md,
// "How long bills are kept".
import { query } from './db.js'
import { now, todayIST } from './clock.js'
import { env } from './env.js'
import { logger } from './logger.js'
import { dropPhoto } from './photos.js'
import { scrubOrderAudit } from './privacy.js'

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

/** The date `months` calendar months before `day` (YYYY-MM-DD), clamped to that month's last day. */
export function monthsBefore(day, months) {
  const [y, m, d] = day.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 - months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, last))
  return first.toISOString().slice(0, 10)
}

/**
 * SEC-05: removes the customer's details from orders finished more than
 * PII_RETENTION_MONTHS (default 12) ago: name, phone, address, gift recipient
 * and message on the order, and who took it and where the rider stood on its
 * delivery attempts. Amounts, items, tax fields, dates, payment and refund ids
 * stay for the books. The order's bill is not touched: it keeps everything
 * printed on it, the buyer's name and address included, for
 * BILL_RETENTION_MONTHS (removeOldBillBuyers). Nothing that prints a bill or
 * fills an export reads the columns cleared here (docs/trust.md). Orders with
 * money still owed back are left until it is paid. The account itself is
 * untouched (the customer can still delete it). Then the photos of those
 * orders go too (removeOldPhotos). Bounded per call; the daily maintenance
 * pass repeats until none are left. Returns the count of orders.
 */
export async function anonymiseOldOrders(at = now(), { months = env.PII_RETENTION_MONTHS, batch = 1_000 } = {}) {
  const cutoff = monthsBefore(todayIST(at), months)
  const { rows } = await query(
    `UPDATE orders SET customer_name = NULL, phone = NULL, delivery_address = NULL,
            gift_recipient_name = NULL, gift_recipient_phone = NULL, gift_message = NULL, pii_removed_at = $3
      WHERE id IN (
        SELECT id FROM orders
         WHERE pii_removed_at IS NULL AND delivery_date < $1 AND status IN ('DELIVERED', 'CANCELLED', 'RTO')
           AND NOT (refund_requested_at IS NOT NULL AND refunded_at IS NULL)
         LIMIT $2)
      RETURNING id`,
    [cutoff, batch, at],
  )
  if (rows.length) {
    await query('UPDATE delivery_attempts SET received_by = NULL, note = NULL, lat = NULL, lng = NULL WHERE order_id = ANY($1)', [rows.map((r) => r.id)])
    await scrubOrderAudit({ query }, 'SELECT unnest($1::text[])', [rows.map((r) => r.id)])
  }
  const photos = await removeOldPhotos(at, { batch })
  if (photos) logger.info({ photos }, 'photos removed from orders past the retention period')
  return rows.length
}

/**
 * Bills keep everything printed on them, the buyer's name and delivery address
 * included, for BILL_RETENTION_MONTHS (default 96, 8 years) after the bill
 * date: tax law needs invoices kept that long (docs/trust.md). After that the
 * name and address come off, as data minimisation. The number, date, lines,
 * amounts and any business name and GSTIN stay; the PDF then says the name
 * and address were removed. Bounded per call; the daily retention pass repeats
 * until none are left. Returns how many bills changed.
 */
export async function removeOldBillBuyers(at = now(), { months = env.BILL_RETENTION_MONTHS, batch = 5_000 } = {}) {
  const cutoff = monthsBefore(todayIST(at), months)
  // bill_date is the IST day of issued_at, so the issued_at test picks the same bills, by its index.
  const r = await query(
    `UPDATE bills SET buyer_name = NULL, buyer_address = NULL, buyer_removed_at = $3
      WHERE id IN (
        SELECT id FROM bills
         WHERE buyer_removed_at IS NULL AND bill_date < $1 AND issued_at < ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata')
         LIMIT $2)`,
    [cutoff, batch, at],
  )
  if (r.rowCount) logger.info({ bills: r.rowCount }, 'buyer name and address removed from bills past the bill retention period')
  return r.rowCount
}

/**
 * The photos of orders whose details were removed (pii_removed_at): the rider's
 * delivery photos, and the photos on the customer's problem reports once the
 * report is resolved (an open one keeps them until staff decide it; a later run
 * takes them). Delivery photo rows stay, marked removed, because the delivery
 * record points at them; claim photo rows are deleted, as account deletion does.
 * The image goes from Vercel Blob or from the row. Covers orders anonymised
 * before photos were included too. Returns how many photos went.
 */
export async function removeOldPhotos(at = now(), { batch = 1_000 } = {}) {
  const delivery = await query(
    `WITH due AS (
       SELECT p.id, p.blob_path FROM delivery_photos p JOIN orders o ON o.id = p.order_id
        WHERE p.removed_at IS NULL AND o.pii_removed_at IS NOT NULL
        LIMIT $1 FOR UPDATE OF p SKIP LOCKED),
     gone AS (UPDATE delivery_photos p SET removed_at = $2, bytes = NULL, blob_path = NULL FROM due WHERE p.id = due.id)
     SELECT blob_path FROM due`,
    [batch, at],
  )
  const claimed = await query(
    `DELETE FROM claim_photos WHERE id IN (
       SELECT cp.id FROM claim_photos cp JOIN claims c ON c.id = cp.claim_id JOIN orders o ON o.id = c.order_id
        WHERE o.pii_removed_at IS NOT NULL AND c.status = 'RESOLVED'
        LIMIT $1 FOR UPDATE OF cp SKIP LOCKED)
     RETURNING blob_path`,
    [batch],
  )
  // A claim filed with a link (before photos were uploaded) loses the link too.
  await query(
    `UPDATE claims c SET photo_url = NULL FROM orders o
      WHERE o.id = c.order_id AND o.pii_removed_at IS NOT NULL AND c.status = 'RESOLVED' AND c.photo_url IS NOT NULL`,
  )
  // The rows are changed first: a Blob delete that fails is logged, and the image can no longer be served.
  for (const row of [...delivery.rows, ...claimed.rows]) await dropPhoto(row)
  return delivery.rowCount + claimed.rowCount
}
