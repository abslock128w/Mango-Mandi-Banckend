// The dashboard summary, analytics, needs attention, and the staff audit trail.
import express from 'express'
import { z } from 'zod'
import { requireManager } from '../auth.js'
import { addDays, diffDays, isDate, now, todayIST } from '../clock.js'
import { analytics, mondayOf } from '../analytics.js'
import { currentConfig } from '../config.js'
import { photoReviews } from '../delivery-proof.js'
import { query } from '../db.js'
import { env } from '../env.js'
import { asyncHandler, badRequest, notFound, parse } from '../errors.js'
import { auditLedger, SELLABLE_STATUSES } from '../inventory.js'
import { backupStatus } from '../maintenance.js'
import { MAX_DELIVERY_ATTEMPTS, RETRY_NEEDS_DAY } from '../orders.js'
import { disputeHolds } from '../payments.js'
import { productName, shopProducts } from '../products.js'
import { lateArrivals, overdueOrders, preorderCapacityDrift, preordersNeedingDecision, returnedStockPending } from '../stock-watch.js'

export const router = express.Router()

const AUDIT_PAGE = 50

// ---------------------------------------------------------------- dashboard

router.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const cfg = currentConfig().rules
    const today = todayIST()
    const [counts, claims, batches, stock, risky, overdue] = await Promise.all([
      query('SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status'),
      query(`SELECT COUNT(*)::int AS n FROM claims WHERE status IN ('SUBMITTED', 'UNDER_REVIEW')`),
      query(
        `SELECT b.id, b.variety, b.plucked_on,
                COALESCE(SUM(GREATEST(l.on_hand - l.held - l.committed - l.reserve_buffer, 0)), 0)::int AS available
           FROM batches b LEFT JOIN batch_lines l ON l.batch_id = b.id
          WHERE b.status NOT IN ('EXHAUSTED', 'CONDEMNED') AND b.plucked_on <= $1
          GROUP BY b.id ORDER BY b.plucked_on`,
        [addDays(today, -cfg.nearLimitAge)],
      ),
      query(
        `SELECT l.sku, COALESCE(SUM(GREATEST(l.on_hand - l.held - l.committed - l.reserve_buffer, 0)), 0)::int AS available
           FROM batch_lines l JOIN batches b ON b.id = l.batch_id
          WHERE b.status = ANY($1) GROUP BY l.sku`,
        [SELLABLE_STATUSES],
      ),
      query(
        `SELECT id, number, delivery_date, at_risk_reason FROM orders
          WHERE at_risk AND status NOT IN ('DELIVERED', 'CANCELLED', 'RTO') ORDER BY delivery_date, number`,
      ),
      // INV-G: paid orders past their date, or out for delivery too long.
      overdueOrders({ query }),
    ])
    const bySku = new Map(stock.rows.map((r) => [r.sku, r.available]))
    res.json({
      orders: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
      openClaims: claims.rows[0].n,
      batchesNearLimit: batches.rows.map((b) => ({ id: b.id, variety: b.variety, ageDays: diffDays(today, b.plucked_on), available: b.available })),
      lowStock: shopProducts()
        .map((p) => ({ sku: p.sku, productName: p.name, available: bySku.get(p.sku) ?? 0 }))
        .filter((p) => p.available <= cfg.lowStockThreshold),
      atRiskOrders: risky.rows.map((o) => ({ id: o.id, number: o.number, deliveryDate: o.delivery_date, reason: o.at_risk_reason })),
      overdueOrders: overdue,
      // FE-3: the panel marks stock past this age from the live rule, not a constant.
      maxSellableAge: cfg.maxSellableAge,
    })
  }),
)

// ---------------------------------------------------------------- analytics

/** Week-by-week season numbers. Defaults to the last 8 weeks up to the end of this week. */
router.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const date = z.string().refine(isDate, 'dates must be YYYY-MM-DD')
    const f = parse(z.object({ from: date.optional(), to: date.optional() }), Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')))
    const to = f.to ?? addDays(mondayOf(todayIST()), 6)
    const from = f.from ?? addDays(mondayOf(to), -49)
    if (from > to) throw badRequest('from must be on or before to', 'INVALID_DATE')
    if (diffDays(to, from) > 366) throw badRequest('Pick at most a year', 'INVALID_DATE')
    res.json(await analytics({ from, to }))
  }),
)

// ---------------------------------------------------------------- needs attention

const LOOP_STALE_MS = 5 * 60_000
/** SQL: the dispute that holds the refund of the payment in `col` ({ id, status } as json), or null (PAY-06). */
const disputeOf = (col) =>
  `(SELECT json_build_object('id', pd.dispute_id, 'status', pd.status) FROM payment_disputes pd
     WHERE pd.payment_id = ${col} AND pd.status <> 'won' ORDER BY pd.updated_at DESC, pd.dispute_id LIMIT 1)`

const REFUND_STUCK_MS = 30 * 60_000
const maskPhone = (p) => (p ? `${p.slice(0, -6)}••••${p.slice(-2)}` : null)

/**
 * The dead-letter view nobody has to go looking for: is the loop alive, which
 * steps are failing, WhatsApp messages given up on, refunds that haven't gone
 * through, and webhooks that failed or named an unknown order.
 */
router.get(
  '/attention',
  asyncHandler(async (_req, res) => res.json(await attentionReport())),
)

/**
 * How many problems Needs attention lists, as the panel counts them: one for a stopped loop, one
 * for a missed backup, one per failing step and one per item in each list (low ratings count once,
 * as the panel shows them as one line). Lists are capped at 50 each, as on the page.
 */
export function attentionCount(a) {
  const lists = [
    a.loop.failingSteps, a.overdueOrders, a.retryDecisions, a.failedDeliveries, a.stuckRefunds, a.ledgerDrift, a.preorderCapacityDrift,
    a.lateArrivals, a.returnedStock, a.preorderDecisions, a.photoDeliveries, a.failedMessages, a.disputes, a.webhookFailures,
  ]
  return (a.loop.stale ? 1 : 0) + (a.backup?.stale ? 1 : 0) + (a.lowRatings.length ? 1 : 0) + lists.reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0)
}

/** Everything the Needs attention view lists (GET /attention; the managers' daily summary counts it). */
export async function attentionReport(at = now()) {
  const week = new Date(at.getTime() - 7 * 86_400_000)
  const [runs, failed, refunds, hooks, calls, photos, lowRatings, drift, backup, overdue, preorderCalls, returned, stuckRetries, disputes, preorderDrift, lateTrucks] = await Promise.all([
    query('SELECT * FROM maintenance_runs ORDER BY step'),
    query(
      `SELECT n.id, n.kind, n.status, n.phone, n.last_error, n.created_at, n.attempts, o.id AS order_id, o.number AS order_number, p.number AS preorder_number
         FROM notifications n LEFT JOIN orders o ON o.id = n.order_id LEFT JOIN preorders p ON p.id = n.preorder_id
        WHERE (n.status = 'FAILED' OR ($2 AND n.status = 'SKIPPED' AND n.last_error IN ('older than a day', 'no WhatsApp provider configured')))
          AND n.created_at >= $1 ORDER BY n.created_at DESC LIMIT 50`,
      // INT-06 (OPS_ALERTS): messages dropped unsent are listed too, so staff can send the ones that matter.
      [week, env.OPS_ALERTS],
    ),
    query(
      `SELECT 'order' AS type, id, number, refund_requested_at, NULL AS payment_id,
              CASE WHEN refund_gave_up_at IS NOT NULL THEN 'needs_manager' WHEN $3 AND ${disputeHolds('orders.payment_id')} THEN 'held' ELSE 'unsent' END AS state,
              CASE WHEN $3 THEN ${disputeOf('orders.payment_id')} END AS dispute, refund_attempts AS attempts
         FROM orders WHERE refund_requested_at < $1 AND refunded_at IS NULL
       UNION ALL
       SELECT 'preorder', id, number, refund_requested_at, NULL,
              CASE WHEN refund_gave_up_at IS NOT NULL THEN 'needs_manager' WHEN $3 AND ${disputeHolds('preorders.payment_id')} THEN 'held' ELSE 'unsent' END,
              CASE WHEN $3 THEN ${disputeOf('preorders.payment_id')} END, refund_attempts
         FROM preorders WHERE refund_requested_at < $1 AND refunded_at IS NULL
       UNION ALL
       -- A second payment, or a payment that matched no order (type 'payment', its id as the id).
       SELECT CASE WHEN d.order_id IS NOT NULL THEN 'order' WHEN d.preorder_id IS NOT NULL THEN 'preorder' ELSE 'payment' END,
              COALESCE(d.order_id, d.preorder_id, d.payment_id),
              COALESCE(o.number || ' (second payment)', p.number || ' (second payment)', d.payment_id || ' (payment with no order)'), d.found_at, d.payment_id,
              CASE WHEN d.refund_gave_up_at IS NOT NULL THEN 'needs_manager' WHEN $3 AND ${disputeHolds('d.payment_id')} THEN 'held' ELSE 'unsent' END,
              CASE WHEN $3 THEN ${disputeOf('d.payment_id')} END, d.refund_attempts
         FROM duplicate_payments d LEFT JOIN orders o ON o.id = d.order_id LEFT JOIN preorders p ON p.id = d.preorder_id
        WHERE d.found_at < $1 AND d.refunded_at IS NULL
       UNION ALL
       -- PAY-02: sent, but Razorpay hasn't said it went through after 5 days.
       SELECT 'order', id, number || ' (sent, not confirmed by Razorpay)', refund_requested_at, NULL, 'unconfirmed', NULL, refund_attempts FROM orders
        WHERE refund_status = 'pending' AND refunded_at < $2
       UNION ALL
       SELECT 'preorder', id, number || ' (sent, not confirmed by Razorpay)', refund_requested_at, NULL, 'unconfirmed', NULL, refund_attempts FROM preorders
        WHERE refund_status = 'pending' AND refunded_at < $2
       UNION ALL
       SELECT CASE WHEN d.order_id IS NOT NULL THEN 'order' WHEN d.preorder_id IS NOT NULL THEN 'preorder' ELSE 'payment' END,
              COALESCE(d.order_id, d.preorder_id, d.payment_id), d.payment_id || ' (refund sent, not confirmed by Razorpay)',
              d.found_at, d.payment_id, 'unconfirmed', NULL, d.refund_attempts
         FROM duplicate_payments d WHERE d.refund_status = 'pending' AND d.refunded_at < $2
       ORDER BY refund_requested_at LIMIT 50`,
      [new Date(at.getTime() - REFUND_STUCK_MS), new Date(at.getTime() - 5 * 86_400_000), env.REFUND_SAFETY_CHECKS],
    ),
    // Not yet marked resolved; payment problems stay listed at any age (PAY-04). refundable: a captured payment that still matches nothing we hold.
    query(
      `SELECT w.*, (w.payment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders WHERE payment_id = w.payment_id)
              AND NOT EXISTS (SELECT 1 FROM preorders WHERE payment_id = w.payment_id)
              AND NOT EXISTS (SELECT 1 FROM duplicate_payments WHERE payment_id = w.payment_id)) AS refundable
         FROM webhook_failures w WHERE w.resolved_at IS NULL AND (w.created_at >= $1 OR w.source = 'razorpay')
        ORDER BY (w.source = 'razorpay') DESC, w.created_at DESC LIMIT 50`,
      [week],
    ),
    query(
      `SELECT id, number, customer_name, phone, gift_recipient_name, gift_recipient_phone, delivery_failures FROM orders
        WHERE status = 'DELIVERY_FAILED' AND delivery_failures >= $1 ORDER BY placed_at LIMIT 50`,
      [MAX_DELIVERY_ATTEMPTS],
    ),
    photoReviews({ query }),
    // 1 and 2 star reviews from the last week still waiting for a look (a review never opens a claim by itself).
    query(
      `SELECT r.id, r.rating, r.comment, r.sku, r.created_at, r.order_id, o.number FROM reviews r JOIN orders o ON o.id = r.order_id
        WHERE r.rating <= 2 AND r.status = 'PENDING' AND r.created_at >= $1 ORDER BY r.created_at DESC LIMIT 50`,
      [week],
    ),
    // Stock counters that disagree with the ledger (INV-7): until now only a metric and a log line.
    auditLedger({ query }),
    // The Docker server's nightly backup (null where none is expected, as on Vercel).
    backupStatus(at),
    // INV-G, INV-H, INV-F: late orders, preorders that keep moving, boxes back from cancelled or returned orders.
    overdueOrders({ query }, at),
    preordersNeedingDecision({ query }),
    returnedStockPending({ query }),
    // INV-E: a missed delivery whose retry can't go out as packed (too old, no younger stock).
    // PLT-08, PLT-09 (DELIVERY_CHECKS): and a missed delivery whose retry has no day with room, or no open day.
    query(
      `SELECT o.id, o.number, o.delivery_date, o.at_risk, COALESCE(o.at_risk_reason, n.last_error) AS at_risk_reason FROM orders o
         LEFT JOIN LATERAL (SELECT last_error FROM notifications WHERE order_id = o.id AND kind = 'DELIVERY_FAILED' ORDER BY created_at DESC LIMIT 1) n ON $2
        WHERE o.status = 'DELIVERY_FAILED' AND o.delivery_failures < $1 AND (o.at_risk OR ($2 AND n.last_error LIKE $3))
        ORDER BY o.delivery_date, o.number LIMIT 50`,
      [MAX_DELIVERY_ATTEMPTS, env.DELIVERY_CHECKS, `${RETRY_NEEDS_DAY}:%`],
    ),
    // PAY-B12: chargebacks still open at Razorpay (answered in the Razorpay dashboard).
    query(
      `SELECT d.*, o.number AS order_number, p.number AS preorder_number FROM payment_disputes d
         LEFT JOIN orders o ON o.id = d.order_id LEFT JOIN preorders p ON p.id = d.preorder_id
        WHERE d.status NOT IN ('won', 'lost', 'closed') ORDER BY d.respond_by NULLS LAST, d.created_at LIMIT 50`,
    ),
    // INV-06, INV-08: preorder capacity counters that drifted, and trucks late to arrive.
    preorderCapacityDrift({ query }, 50),
    lateArrivals({ query }, at),
  ])
  const tick = runs.rows.find((r) => r.step === 'tick')
  return {
    loop: {
      lastRunAt: tick?.last_ok_at ?? null,
      stale: !tick?.last_ok_at || at - tick.last_ok_at > LOOP_STALE_MS,
      failingSteps: runs.rows
        .filter((r) => r.last_err_at && (!r.last_ok_at || r.last_err_at > r.last_ok_at))
        .map((r) => ({ step: r.step, since: r.last_err_at, error: r.last_error })),
    },
    backup,
    failedMessages: failed.rows.map((n) => ({
      id: n.id, kind: n.kind, status: n.status, phone: maskPhone(n.phone), error: n.last_error, attempts: n.attempts, createdAt: n.created_at,
      order: n.order_id ? { id: n.order_id, number: n.order_number } : null, preorderNumber: n.preorder_number,
    })),
    // state 'unsent': still retrying (a manager may record it as paid back another way); 'unconfirmed': sent, Razorpay silent;
    // 'held': not sent while a chargeback on the payment is open or was lost (PAY-06, REFUND_SAFETY_CHECKS), with the dispute
    // that holds it ({ id, status }: open until the bank decides; a lost one is settled as paid back another way);
    // 'needs_manager': failed REFUND_MAX_ATTEMPTS times and no longer retried (settled as paid back another way).
    stuckRefunds: refunds.rows.map((r) => ({
      type: r.type, id: r.id, number: r.number, requestedAt: r.refund_requested_at, paymentId: r.payment_id, state: r.state, attempts: r.attempts ?? 0,
      ...(r.state === 'held' ? { dispute: r.dispute } : {}),
    })),
    // Missed too many times: someone calls the customer, then sends it out again from the order page.
    failedDeliveries: calls.rows.map((o) => ({
      id: o.id, number: o.number, name: o.gift_recipient_name ?? o.customer_name, phone: o.gift_recipient_phone ?? o.phone, attempts: o.delivery_failures,
    })),
    // Delivered with only a photo: someone other than the rider checks it.
    photoDeliveries: photos,
    webhookFailures: hooks.rows.map((w) => ({
      id: w.id, source: w.source, reason: w.reason, eventKey: w.event_key, createdAt: w.created_at, paymentId: w.payment_id, refundable: w.refundable,
    })),
    disputes: disputes.rows.map((d) => ({
      id: d.dispute_id, paymentId: d.payment_id, status: d.status, amount: d.amount, reasonCode: d.reason_code, respondBy: d.respond_by, createdAt: d.created_at,
      order: d.order_id ? { id: d.order_id, number: d.order_number } : null, preorderNumber: d.preorder_number,
    })),
    ledgerDrift: drift.slice(0, 50),
    preorderCapacityDrift: preorderDrift,
    // sellingPaused: STOCK_INTAKE_CHECKS is on, so their stock no longer sells to new orders.
    lateArrivals: lateTrucks.map((b) => ({ ...b, sellingPaused: env.STOCK_INTAKE_CHECKS })),
    overdueOrders: overdue.slice(0, 50),
    preorderDecisions: preorderCalls.slice(0, 50),
    returnedStock: returned.slice(0, 50),
    retryDecisions: stuckRetries.rows.map((o) => ({
      id: o.id, number: o.number, deliveryDate: o.delivery_date, reason: o.at_risk_reason, kind: o.at_risk ? 'stock' : 'day',
    })),
    lowRatings: lowRatings.rows.map((r) => ({
      id: r.id, rating: r.rating, comment: r.comment, sku: r.sku, productName: productName(r.sku), createdAt: r.created_at, order: { id: r.order_id, number: r.number },
    })),
  }
}

/** Sends a failed WhatsApp message again: back to the outbox as new. */
router.post(
  '/notifications/:id/retry',
  asyncHandler(async (req, res) => {
    const r = await query(
      `UPDATE notifications SET status = 'PENDING', attempts = 0, last_error = NULL, next_attempt_at = $2, created_at = $2
        WHERE id = $1 AND status IN ('FAILED', 'SKIPPED') RETURNING id`,
      [req.params.id, now()],
    )
    if (!r.rowCount) throw notFound('No failed message with that id')
    res.status(204).end()
  }),
)

/** The staff audit trail, newest first. Managers only. */
router.get(
  '/audit',
  requireManager,
  asyncHandler(async (req, res) => {
    const f = parse(
      z.object({
        staff: z.string().trim().toLowerCase().max(200).optional(),
        target: z.string().trim().max(100).optional(),
        from: z.string().refine(isDate).optional(),
        to: z.string().refine(isDate).optional(),
        page: z.coerce.number().int().min(1).max(10_000).default(1),
        // SEC-08: views of customer details (STAFF_AUDIT_TRAIL) are listed only when asked for.
        reads: z.enum(['true', 'false']).default('false'),
      }),
      req.query,
    )
    const where = f.reads === 'true' ? [] : ["action NOT LIKE 'GET %'"]
    const params = []
    const add = (sql, v) => {
      params.push(v)
      where.push(sql.replace('?', `$${params.length}`))
    }
    if (f.staff) add('email = ?', f.staff)
    if (f.target) add('target LIKE ?', `${f.target.replace(/[%_\\]/g, '\\$&')}%`)
    if (f.from) add("created_at >= (?::date)::timestamp AT TIME ZONE 'Asia/Kolkata'", f.from)
    if (f.to) add("created_at < ((?::date) + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'", f.to)
    const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = (await query(`SELECT COUNT(*)::int AS n FROM staff_audit ${w}`, params)).rows[0].n
    const { rows } = await query(
      `SELECT * FROM staff_audit ${w} ORDER BY created_at DESC, id DESC LIMIT ${AUDIT_PAGE} OFFSET ${(f.page - 1) * AUDIT_PAGE}`,
      params,
    )
    const staff = (await query('SELECT email, role FROM admin_users ORDER BY email')).rows
    res.json({
      page: f.page,
      pageSize: AUDIT_PAGE,
      total,
      staff,
      items: rows.map((a) => ({ id: a.id, at: a.created_at, email: a.email, role: a.role, action: a.action, target: a.target, detail: a.detail })),
    })
  }),
)
