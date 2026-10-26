// CSV exports for managers (docs/trust.md): orders, order lines, claims,
// reviews, bulk orders, payments and refunds, for a date range of at most
// EXPORT_MAX_DAYS. Each file is streamed a page of rows at a time (keyset
// pages, so no connection is held while the browser reads), every cell goes
// through the warehouse CSV helper (quoted, formula injection made inert), and
// each export is written to staff_audit before the first byte goes out.
// Exports carry the customer's id but never a phone number or an address:
// the customer profile is where those are looked up (and audited).
// Off (404) while STAFF_EXPORTS_ENABLED is off.
import { once } from 'node:events'
import express from 'express'
import { z } from 'zod'
import { requireManager } from '../auth.js'
import { diffDays, isDate } from '../clock.js'
import { query } from '../db.js'
import { asyncHandler, badRequest, notFound, parse } from '../errors.js'
import { logger } from '../logger.js'
import { productName } from '../products.js'
import { auditNow } from '../staff-audit.js'
import { trust } from '../trust-config.js'
import { csvCell } from '../warehouse/reports.js'

export const router = express.Router()

/** The longest range one export may cover, in days (a quarter). */
export const EXPORT_MAX_DAYS = 92
/** Rows fetched per page while streaming (tests lower it to cross page edges). */
export const exportPaging = { size: 1000 }

const rs = (paise) => (paise == null ? null : (Number(paise) / 100).toFixed(2))
/** An instant as IST, e.g. 2026-10-26T10:30:00+05:30. */
export const istStamp = (d) => (d ? `${new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 19)}+05:30` : null)
const STAGE = { RAW: 'raw', SEMI_RIPE: 'semi-ripe', RIPE: 'ripe' }

// IST calendar days [from, to] as instants: $1 and $2 are the dates.
const PLACED = `o.placed_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND o.placed_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`
const DELIVERY = `o.delivery_date BETWEEN $1::date AND $2::date`
const inRange = (col) => `${col} >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND ${col} < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`
/** The order's date column the export pages by: when it was placed, or its delivery day (as midnight IST). */
const sortAt = (by) => (by === 'delivery' ? `(o.delivery_date::timestamp AT TIME ZONE 'Asia/Kolkata')` : 'o.placed_at')

/** When an order's payment landed: its confirmation, else (paid after a cancel) when the refund was asked for. */
const ORDER_PAID_AT = `COALESCE((SELECT MIN(e.created_at) FROM order_events e WHERE e.order_id = o.id AND e.status = 'CONFIRMED'
                                   AND e.from_status IN ('PAYMENT_PENDING', 'CANCELLED')), o.refund_requested_at, o.placed_at)`

/**
 * Each export: a base query selecting sort_at (timestamptz) and sort_id (text)
 * plus its columns for the range in $1/$2, the CSV header, and a row mapper.
 */
const EXPORTS = {
  orders: {
    byDate: true,
    sql: (by) => `SELECT ${sortAt(by)} AS sort_at, o.id AS sort_id, o.number, o.placed_at, o.delivery_date, o.status, o.channel, o.customer_id, o.pincode,
                         (SELECT COALESCE(SUM(i.quantity), 0)::int FROM order_items i WHERE i.order_id = o.id) AS boxes,
                         EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.listing_id IS NOT NULL) AS bulk,
                         o.subtotal, o.discount, o.promo_code, o.total, o.payment_status, o.payment_method, o.payment_id,
                         o.refund_requested_at, o.refunded_at, r.number AS replacement_for, p.number AS preorder, o.at_risk,
                         b.number AS bill_number, b.cancelled_at AS bill_cancelled_at, o.buyer_business_name, o.buyer_gstin
                    FROM orders o LEFT JOIN orders r ON r.id = o.replacement_for LEFT JOIN preorders p ON p.id = o.preorder_id
                    LEFT JOIN bills b ON b.order_id = o.id
                   WHERE ${by === 'delivery' ? DELIVERY : PLACED}`,
    header: ['order', 'placed_at', 'delivery_date', 'status', 'channel', 'customer_id', 'pincode', 'boxes', 'bulk_deal', 'goods_inr', 'discount_inr', 'promo_code',
      'total_inr', 'payment_status', 'payment_method', 'payment_id', 'refund_requested_at', 'refunded_at', 'replacement_for', 'preorder', 'at_risk',
      'bill_number', 'bill_cancelled', 'business_name', 'business_gstin'],
    row: (r) => [r.number, istStamp(r.placed_at), r.delivery_date, r.status, r.channel, r.customer_id, r.pincode, r.boxes, r.bulk ? 'yes' : 'no', rs(r.subtotal),
      rs(r.discount), r.promo_code, rs(r.total), r.payment_status, r.payment_method, r.payment_id, istStamp(r.refund_requested_at), istStamp(r.refunded_at),
      r.replacement_for, r.preorder, r.at_risk ? 'yes' : 'no', r.bill_number, r.bill_number ? (r.bill_cancelled_at ? 'yes' : 'no') : null,
      r.buyer_business_name, r.buyer_gstin],
  },
  'order-lines': {
    byDate: true,
    sql: (by) => `SELECT ${sortAt(by)} AS sort_at, i.id AS sort_id, o.number, o.placed_at, o.delivery_date, o.status, i.sku, i.stage, i.quantity, i.unit_price,
                         i.line_price, i.listing_id, i.pricing
                    FROM order_items i JOIN orders o ON o.id = i.order_id
                   WHERE ${by === 'delivery' ? DELIVERY : PLACED}`,
    header: ['order', 'placed_at', 'delivery_date', 'order_status', 'sku', 'product', 'ripeness', 'qty', 'unit_price_inr', 'line_total_inr', 'bulk_listing_id', 'bulk_deal',
      'bulk_tier_from_qty'],
    row: (r) => [r.number, istStamp(r.placed_at), r.delivery_date, r.status, r.sku, productName(r.sku), STAGE[r.stage] ?? r.stage, r.quantity, rs(r.unit_price),
      rs(r.line_price), r.listing_id, r.pricing?.kind === 'bulk' ? r.pricing.title : null, r.pricing?.tier?.minQty ?? null],
  },
  'bulk-orders': {
    byDate: true,
    sql: (by) => `SELECT ${sortAt(by)} AS sort_at, i.id AS sort_id, o.number, o.placed_at, o.delivery_date, o.status, o.customer_id, o.total, o.payment_status,
                         o.buyer_business_name, o.buyer_gstin, b.number AS bill_number, i.listing_id, i.pricing, i.sku, i.stage, i.quantity, i.unit_price, i.line_price
                    FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN bills b ON b.order_id = o.id
                   WHERE i.listing_id IS NOT NULL AND ${by === 'delivery' ? DELIVERY : PLACED}`,
    header: ['order', 'placed_at', 'delivery_date', 'status', 'customer_id', 'bulk_listing_id', 'bulk_deal', 'listing_version', 'tier_from_qty', 'sku', 'product',
      'ripeness', 'qty', 'unit_price_inr', 'line_total_inr', 'order_total_inr', 'payment_status', 'bill_number', 'business_name', 'business_gstin'],
    row: (r) => [r.number, istStamp(r.placed_at), r.delivery_date, r.status, r.customer_id, r.listing_id, r.pricing?.title ?? null, r.pricing?.listingVersion ?? null,
      r.pricing?.tier?.minQty ?? null, r.sku, productName(r.sku), STAGE[r.stage] ?? r.stage, r.quantity, rs(r.unit_price), rs(r.line_price), rs(r.total),
      r.payment_status, r.bill_number, r.buyer_business_name, r.buyer_gstin],
  },
  claims: {
    sql: () => `SELECT x.created_at AS sort_at, x.id AS sort_id, x.id, o.number, x.customer_id, x.created_at, x.issue_type, x.affected_items, x.description,
                       x.status, x.resolution, x.resolution_note, r.number AS replacement_number, x.resolved_by, x.resolved_at
                  FROM claims x JOIN orders o ON o.id = x.order_id LEFT JOIN orders r ON r.id = x.replacement_order_id
                 WHERE ${inRange('x.created_at')}`,
    header: ['claim', 'order', 'customer_id', 'created_at', 'issue', 'items', 'description', 'status', 'resolution', 'rejection_reason', 'replacement_order',
      'resolved_by', 'resolved_at'],
    row: (r) => [r.id, r.number, r.customer_id, istStamp(r.created_at), r.issue_type, (r.affected_items ?? []).join(' '), r.description, r.status, r.resolution,
      r.resolution_note, r.replacement_number, r.resolved_by, istStamp(r.resolved_at)],
  },
  reviews: {
    sql: () => `SELECT v.created_at AS sort_at, v.id AS sort_id, v.id, o.number, v.customer_id, v.created_at, v.sku, v.variety, v.stage, v.rating, v.taste,
                       v.ripeness_accuracy, v.packaging, v.delivery, v.status, v.flagged, v.anonymous, v.display_name, v.comment, v.moderated_by, v.moderated_at
                  FROM reviews v JOIN orders o ON o.id = v.order_id
                 WHERE v.status <> 'DELETED' AND ${inRange('v.created_at')}`,
    header: ['review', 'order', 'customer_id', 'created_at', 'sku', 'product', 'variety', 'ripeness', 'stars', 'taste', 'ripeness_as_promised', 'packaging', 'delivery',
      'status', 'flagged', 'anonymous', 'shown_as', 'comment', 'moderated_by', 'moderated_at'],
    row: (r) => [r.id, r.number, r.customer_id, istStamp(r.created_at), r.sku, productName(r.sku), r.variety, STAGE[r.stage] ?? r.stage, r.rating, r.taste,
      r.ripeness_accuracy, r.packaging, r.delivery, r.status, r.flagged ? 'yes' : 'no', r.anonymous ? 'yes' : 'no', r.display_name, r.comment, r.moderated_by,
      istStamp(r.moderated_at)],
  },
  payments: {
    // Orders made from a preorder carry the preorder's payment, so they are listed once, as the preorder.
    sql: () => `SELECT * FROM (
                  SELECT ${ORDER_PAID_AT} AS sort_at, o.id AS sort_id, 'order' AS kind, o.number AS reference, o.customer_id,
                         COALESCE(o.payment_amount, o.total) AS amount, o.payment_method AS method, o.payment_id, o.payment_status AS status, b.number AS bill_number
                    FROM orders o LEFT JOIN bills b ON b.order_id = o.id
                   WHERE o.payment_status IN ('SUCCEEDED', 'REFUNDED') AND o.payment_id IS NOT NULL AND o.preorder_id IS NULL
                     AND o.placed_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata') - interval '7 days'
                     AND o.placed_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
                  UNION ALL
                  SELECT COALESCE(p.booked_at, p.refund_requested_at, p.created_at), p.id, 'preorder', p.number, p.customer_id, COALESCE(p.paid_amount, p.total),
                         p.payment_method, p.payment_id, p.payment_status, NULL
                    FROM preorders p
                   WHERE p.payment_status IN ('SUCCEEDED', 'REFUNDED') AND p.payment_id IS NOT NULL
                  UNION ALL
                  SELECT d.found_at, d.payment_id, 'second payment (refunded)', COALESCE(o.number, p.number), COALESCE(o.customer_id, p.customer_id), d.amount,
                         NULL, d.payment_id, CASE WHEN d.refunded_at IS NULL THEN 'REFUND DUE' ELSE 'REFUNDED' END, NULL
                    FROM duplicate_payments d LEFT JOIN orders o ON o.id = d.order_id LEFT JOIN preorders p ON p.id = d.preorder_id
                ) q WHERE ${inRange('q.sort_at')}`,
    header: ['paid_at', 'kind', 'reference', 'customer_id', 'amount_inr', 'method', 'payment_id', 'status', 'bill_number'],
    row: (r) => [istStamp(r.sort_at), r.kind, r.reference, r.customer_id, rs(r.amount), r.method, r.payment_id, r.status, r.bill_number],
  },
  refunds: {
    sql: () => `SELECT * FROM (
                  SELECT o.refund_requested_at AS sort_at, o.id AS sort_id, 'order' AS kind, o.number AS reference, o.customer_id,
                         COALESCE(o.payment_amount, o.total) AS amount, o.payment_id,
                         CASE WHEN o.customer_cancelled_at IS NOT NULL THEN 'customer cancelled before packing'
                              WHEN o.staff_cancelled_at IS NOT NULL THEN 'manager cancelled (could not deliver)' ELSE 'other' END AS reason,
                         o.refund_id, o.refund_status, o.refunded_at, b.number AS bill_number
                    FROM orders o LEFT JOIN bills b ON b.order_id = o.id WHERE o.refund_requested_at IS NOT NULL
                  UNION ALL
                  SELECT p.refund_requested_at, p.id, 'preorder', p.number, p.customer_id, COALESCE(p.paid_amount, p.total), p.payment_id,
                         CASE WHEN p.customer_cancelled_at IS NOT NULL THEN 'customer cancelled before packing'
                              WHEN p.staff_cancelled_at IS NOT NULL THEN 'manager cancelled (could not deliver)' ELSE 'other' END,
                         p.refund_id, p.refund_status, p.refunded_at, NULL
                    FROM preorders p WHERE p.refund_requested_at IS NOT NULL
                  UNION ALL
                  SELECT d.found_at, d.payment_id, 'second payment', COALESCE(o.number, p.number), COALESCE(o.customer_id, p.customer_id), d.amount, d.payment_id,
                         'charged twice', d.refund_id, d.refund_status, d.refunded_at, NULL
                    FROM duplicate_payments d LEFT JOIN orders o ON o.id = d.order_id LEFT JOIN preorders p ON p.id = d.preorder_id
                ) q WHERE ${inRange('q.sort_at')}`,
    header: ['requested_at', 'kind', 'reference', 'customer_id', 'amount_inr', 'payment_id', 'reason', 'refund_id', 'gateway_status', 'refunded_at', 'bill_number'],
    row: (r) => [istStamp(r.sort_at), r.kind, r.reference, r.customer_id, rs(r.amount), r.payment_id, r.reason, r.refund_id, r.refund_status,
      istStamp(r.refunded_at), r.bill_number],
  },
}

export const EXPORT_KINDS = Object.keys(EXPORTS)

const day = z.string().refine(isDate, 'Use YYYY-MM-DD')

/** Writes text, waiting while the client's buffer is full. False when the client went away. */
async function write(res, text) {
  if (res.destroyed) return false
  if (!res.write(text)) await Promise.race([once(res, 'drain'), once(res, 'close')])
  return !res.destroyed
}

router.get(
  '/exports/:kind',
  requireManager,
  asyncHandler(async (req, res) => {
    if (!trust.exports) throw notFound('Not found')
    const kind = parse(z.enum(EXPORT_KINDS), req.params.kind)
    const spec = EXPORTS[kind]
    const q = parse(
      z.object({ from: day, to: day, by: z.enum(['placed', 'delivery']).default('placed') }),
      Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')),
    )
    if (q.from > q.to) throw badRequest('from must be on or before to')
    if (diffDays(q.to, q.from) + 1 > EXPORT_MAX_DAYS) throw badRequest(`One export covers at most ${EXPORT_MAX_DAYS} days`, 'RANGE_TOO_LONG')
    const by = spec.byDate ? q.by : null
    const auditId = await auditNow(req, `EXPORT ${kind}`, { target: kind, detail: { from: q.from, to: q.to, ...(by ? { by } : {}) } })

    const base = spec.sql(by)
    const page = `SELECT * FROM (${base}) page
                   WHERE ($3::timestamptz IS NULL OR (page.sort_at, page.sort_id) > ($3::timestamptz, $4::text))
                   ORDER BY page.sort_at, page.sort_id LIMIT ${Number(exportPaging.size)}`
    // The first page before any header, so a query error still answers as JSON.
    let rows = (await query(page, [q.from, q.to, null, null])).rows
    res.status(200)
    res.set('Content-Type', 'text/csv; charset=utf-8')
    res.set('Content-Disposition', `attachment; filename="mandimangoes-${kind}-${q.from}-to-${q.to}.csv"`)
    res.set('Cache-Control', 'no-store')
    let sent = 0
    let complete = false
    try {
      if (!(await write(res, `${spec.header.map(csvCell).join(',')}\r\n`))) return
      for (;;) {
        if (rows.length) {
          const text = rows.map((r) => `${spec.row(r).map(csvCell).join(',')}\r\n`).join('')
          if (!(await write(res, text))) return
          sent += rows.length
        }
        if (rows.length < exportPaging.size) break
        const last = rows.at(-1)
        rows = (await query(page, [q.from, q.to, last.sort_at, last.sort_id])).rows
      }
      complete = true
      res.end()
    } catch (err) {
      // Halfway through a file there is no way to send a JSON error: cut the download off, so it
      // fails in the browser rather than looking complete.
      logger.error({ err, kind, sent }, 'CSV export failed part way')
      res.destroy(err)
    } finally {
      await query(`UPDATE staff_audit SET detail = COALESCE(detail, '{}'::jsonb) || jsonb_build_object('rows', $2::int, 'complete', $3::bool) WHERE id = $1`, [
        auditId, sent, complete,
      ]).catch((err) => logger.error({ err, auditId }, 'could not record the export row count'))
    }
  }),
)
