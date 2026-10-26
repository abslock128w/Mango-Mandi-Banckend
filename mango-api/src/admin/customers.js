// The customer profile for staff (docs/trust.md): one page with a customer's
// orders, claims, reviews, ratings, saved addresses, consent settings and
// lifetime spend. Managers and operators only (access.js). Every look is
// written to staff_audit before the answer goes out: the profile, the phone
// search and the reveal of the full phone number and email (masked to the
// last 4 digits otherwise). Off (404) while CUSTOMER_PROFILES_ENABLED is off.
import express from 'express'
import { z } from 'zod'
import { now } from '../clock.js'
import { query } from '../db.js'
import { asyncHandler, notFound, parse } from '../errors.js'
import { productName } from '../products.js'
import { auditNow } from '../staff-audit.js'
import { trust } from '../trust-config.js'

export const router = express.Router()

/** '+919876543210' → '******3210'. */
export const maskPhone = (p) => (p ? `******${String(p).slice(-4)}` : null)
/** 'ravi.k@example.com' → 'r*****@example.com'. */
export const maskEmail = (e) => {
  if (!e) return null
  const [user, domain] = String(e).split('@')
  return `${user.slice(0, 1)}*****@${domain ?? ''}`
}

const on = (_req, _res, next) => next(trust.customerProfiles ? undefined : notFound('Not found'))

/** Indian mobile numbers as stored: +91 and 10 digits. */
const phone = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
  .refine((s) => /^[6-9]\d{9}$/.test(s), 'Enter a 10-digit Indian mobile number')
  .transform((s) => `+91${s}`)

router.post(
  '/customers/search',
  on,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ phone }).strict(), req.body ?? {})
    const { rows } = await query(
      `SELECT c.id, c.name, c.phone, c.created_at,
              (SELECT COUNT(*)::int FROM orders o WHERE o.customer_id = c.id) AS orders,
              (SELECT MAX(placed_at) FROM orders o WHERE o.customer_id = c.id) AS last_order_at
         FROM customers c WHERE c.phone = $1 AND c.deleted_at IS NULL`,
      [b.phone],
    )
    // The audit keeps only the last 4 digits searched for, like the screen.
    await auditNow(req, 'SEARCH customers by phone', { detail: { phoneEndsWith: b.phone.slice(-4), found: rows.length } })
    res.json({
      items: rows.map((c) => ({ id: c.id, name: c.name, phoneMasked: maskPhone(c.phone), createdAt: c.created_at, orders: c.orders, lastOrderAt: c.last_order_at })),
    })
  }),
)

/** Orders that took money (not free replacements). */
const PAID = `payment_status IN ('SUCCEEDED', 'REFUNDED') AND replacement_for IS NULL AND total > 0`
const ORDER_LIST_LIMIT = 200

async function profile(id) {
  const { rows } = await query(
    'SELECT id, phone, name, email, google_sub, created_at, privacy_accepted_at, deleted_at, reminders_opt_in FROM customers WHERE id = $1',
    [id],
  )
  const cu = rows[0]
  if (!cu) throw notFound('Customer not found')
  const [stats, orders, claims, reviews, ratings, addresses, alerts, preorders] = await Promise.all([
    query(
      `SELECT COUNT(*) FILTER (WHERE ${PAID})::int AS paid_orders,
              COUNT(*)::int AS all_orders,
              COUNT(*) FILTER (WHERE replacement_for IS NOT NULL)::int AS replacements,
              COALESCE(SUM(total) FILTER (WHERE payment_status = 'SUCCEEDED' AND refund_requested_at IS NULL AND replacement_for IS NULL), 0)::bigint AS spend,
              COALESCE(SUM(COALESCE(payment_amount, total)) FILTER (WHERE refund_requested_at IS NOT NULL), 0)::bigint AS refunds,
              MIN(placed_at) FILTER (WHERE ${PAID}) AS first_order_at,
              MAX(placed_at) FILTER (WHERE ${PAID}) AS last_order_at
         FROM orders WHERE customer_id = $1`,
      [id],
    ),
    query(
      `SELECT o.id, o.number, o.status, o.placed_at, o.delivery_date, o.total, o.discount, o.payment_status, o.channel,
              o.replacement_for, o.refund_requested_at, o.refunded_at, o.buyer_business_name, o.buyer_gstin,
              (SELECT COALESCE(SUM(quantity), 0)::int FROM order_items i WHERE i.order_id = o.id) AS boxes,
              b.number AS bill_number, b.cancelled_at AS bill_cancelled_at
         FROM orders o LEFT JOIN bills b ON b.order_id = o.id
        WHERE o.customer_id = $1 ORDER BY o.placed_at DESC, o.id DESC LIMIT $2`,
      [id, ORDER_LIST_LIMIT],
    ),
    query(
      `SELECT x.id, x.order_id, o.number AS order_number, x.issue_type, x.status, x.resolution, x.created_at, x.resolved_at,
              x.replacement_order_id, r.number AS replacement_number
         FROM claims x JOIN orders o ON o.id = x.order_id LEFT JOIN orders r ON r.id = x.replacement_order_id
        WHERE x.customer_id = $1 ORDER BY x.created_at DESC, x.id DESC`,
      [id],
    ),
    query(
      `SELECT v.id, v.order_id, o.number AS order_number, v.sku, v.rating, v.status, v.comment, v.created_at
         FROM reviews v JOIN orders o ON o.id = v.order_id
        WHERE v.customer_id = $1 AND v.status <> 'DELETED' ORDER BY v.created_at DESC, v.id DESC`,
      [id],
    ),
    query(
      `SELECT t.order_id, o.number AS order_number, t.stars, t.comment, t.updated_at
         FROM order_ratings t JOIN orders o ON o.id = t.order_id WHERE t.customer_id = $1 ORDER BY t.updated_at DESC`,
      [id],
    ),
    query('SELECT id, name, address, pincode, last_used_at FROM customer_addresses WHERE customer_id = $1 ORDER BY last_used_at DESC', [id]),
    query('SELECT COUNT(*)::int AS n FROM stock_alerts WHERE customer_id = $1 AND cancelled_at IS NULL AND notified_at IS NULL AND expires_at > $2', [id, now()]),
    query(`SELECT COUNT(*)::int AS n FROM preorders WHERE customer_id = $1 AND status IN ('BOOKED', 'WAITLISTED')`, [id]),
  ])
  const s = stats.rows[0]
  const stars = ratings.rows.map((r) => r.stars)
  return {
    id: cu.id,
    name: cu.name,
    phoneMasked: maskPhone(cu.phone),
    emailMasked: maskEmail(cu.email),
    hasPhone: Boolean(cu.phone),
    hasEmail: Boolean(cu.email),
    signIn: { phone: Boolean(cu.phone), google: Boolean(cu.google_sub) },
    createdAt: cu.created_at,
    deletedAt: cu.deleted_at,
    consent: {
      privacyAcceptedAt: cu.privacy_accepted_at,
      remindersOptIn: Boolean(cu.reminders_opt_in),
      openStockAlerts: alerts.rows[0].n,
    },
    stats: {
      paidOrders: s.paid_orders,
      allOrders: s.all_orders,
      replacements: s.replacements,
      lifetimeSpend: Number(s.spend),
      refunds: Number(s.refunds),
      firstOrderAt: s.first_order_at,
      lastOrderAt: s.last_order_at,
      claims: claims.rows.length,
      reviews: reviews.rows.length,
      averageRating: stars.length ? Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 10) / 10 : null,
      openPreorders: preorders.rows[0].n,
    },
    orders: orders.rows.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      placedAt: o.placed_at,
      deliveryDate: o.delivery_date,
      total: o.total,
      discount: o.discount,
      boxes: o.boxes,
      paymentStatus: o.payment_status,
      channel: o.channel,
      replacement: Boolean(o.replacement_for),
      refund: o.refund_requested_at ? (o.refunded_at ? 'REFUNDED' : 'PENDING') : null,
      business: o.buyer_gstin ? { name: o.buyer_business_name, gstin: o.buyer_gstin } : null,
      bill: o.bill_number ? { number: o.bill_number, cancelled: Boolean(o.bill_cancelled_at) } : null,
    })),
    ordersShown: orders.rows.length,
    claims: claims.rows.map((x) => ({
      id: x.id,
      orderId: x.order_id,
      orderNumber: x.order_number,
      issueType: x.issue_type,
      status: x.status,
      resolution: x.resolution,
      createdAt: x.created_at,
      resolvedAt: x.resolved_at,
      replacementOrder: x.replacement_order_id ? { id: x.replacement_order_id, number: x.replacement_number } : null,
    })),
    reviews: reviews.rows.map((v) => ({
      id: v.id,
      orderId: v.order_id,
      orderNumber: v.order_number,
      sku: v.sku,
      productName: productName(v.sku),
      rating: v.rating,
      status: v.status,
      comment: v.comment,
      createdAt: v.created_at,
    })),
    ratings: ratings.rows.map((t) => ({ orderId: t.order_id, orderNumber: t.order_number, stars: t.stars, comment: t.comment, at: t.updated_at })),
    addresses: addresses.rows.map((a) => ({ id: a.id, name: a.name, address: a.address, pincode: a.pincode, lastUsedAt: a.last_used_at })),
  }
}

router.get(
  '/customers/:id',
  on,
  asyncHandler(async (req, res) => {
    const view = await profile(req.params.id)
    await auditNow(req, 'VIEW customer profile', { target: view.id })
    res.json(view)
  }),
)

router.post(
  '/customers/:id/reveal',
  on,
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT id, phone, email FROM customers WHERE id = $1', [req.params.id])
    if (!rows.length) throw notFound('Customer not found')
    const c = rows[0]
    await auditNow(req, 'REVEAL customer phone and email', { target: c.id, detail: { phone: Boolean(c.phone), email: Boolean(c.email) } })
    res.json({ phone: c.phone, email: c.email })
  }),
)
