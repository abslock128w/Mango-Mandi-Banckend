// Gift orders to many recipients (MULTI_GIFT, docs/gifting.md) on the Orders
// page: each parent with its child deliveries. Read only: each delivery is an
// ordinary order, packed, sent, cancelled and refunded from its own page with
// the existing permissions. Managers and operators (access.js), as for the
// order list; while MULTI_GIFT is off both routes answer 404.
import express from 'express'
import { z } from 'zod'
import { billView } from '../bills.js'
import { query } from '../db.js'
import { asyncHandler, notFound, parse } from '../errors.js'
import { giftStatus } from '../gifts.js'
import { productName } from '../products.js'
import { trust } from '../trust-config.js'
import { isOn } from '../feature-switches.js'

export const router = express.Router()
router.use('/gift-orders', (_req, _res, next) => next(isOn('MULTI_GIFT') ? undefined : notFound()))

const PAGE_SIZE = 25
const likeEscape = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

const childView = (k, items) => {
  const i = items.find((x) => x.order_id === k.id)
  return {
    id: k.id, number: k.number, position: k.gift_position, status: k.status, deliveryDate: k.delivery_date, pincode: k.pincode,
    recipientName: k.gift_recipient_name, total: k.total, atRisk: k.at_risk,
    box: i ? { sku: i.sku, name: productName(i.sku), stage: i.stage, qty: i.quantity } : null,
    refund: k.refund_requested_at ? { requestedAt: k.refund_requested_at, refundedAt: k.refunded_at } : null,
  }
}

async function withChildren(gifts) {
  if (!gifts.length) return []
  const ids = gifts.map((g) => g.id)
  const { rows: kids } = await query('SELECT * FROM orders WHERE gift_order_id = ANY($1) ORDER BY gift_position, id', [ids])
  const { rows: items } = kids.length ? await query('SELECT * FROM order_items WHERE order_id = ANY($1)', [kids.map((k) => k.id)]) : { rows: [] }
  return gifts.map((g) => {
    const mine = kids.filter((k) => k.gift_order_id === g.id)
    return {
      id: g.id, number: g.number, status: giftStatus(g, mine), paymentStatus: g.payment_status, customerName: mine[0]?.customer_name ?? null,
      deliveryDate: g.delivery_date, placedAt: g.placed_at, paidAt: g.paid_at, recipientCount: g.recipient_count, boxes: g.boxes,
      subtotal: g.subtotal, discount: g.discount, promoCode: g.promo_code, total: g.total,
      business: g.buyer_gstin ? { name: g.buyer_business_name, gstin: g.buyer_gstin } : null,
      children: mine.map((k) => childView(k, items)),
    }
  })
}

router.get(
  '/gift-orders',
  asyncHandler(async (req, res) => {
    const f = parse(
      z.object({ q: z.string().trim().max(40).optional(), page: z.coerce.number().int().min(1).max(10_000).default(1) }),
      Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')),
    )
    const params = []
    let where = ''
    if (f.q) {
      params.push(`${likeEscape(f.q)}%`, `%${likeEscape(f.q)}%`)
      // The gift order's number, or any of its deliveries' numbers, buyer or recipient.
      where = `WHERE g.number ILIKE $1 OR EXISTS (SELECT 1 FROM orders o WHERE o.gift_order_id = g.id
                 AND (o.number ILIKE $1 OR o.customer_name ILIKE $2 OR o.gift_recipient_name ILIKE $2))`
    }
    const total = (await query(`SELECT COUNT(*)::int AS n FROM gift_orders g ${where}`, params)).rows[0].n
    const { rows } = await query(
      `SELECT g.* FROM gift_orders g ${where} ORDER BY g.placed_at DESC, g.number DESC LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`,
      params,
    )
    res.json({ page: f.page, pageSize: PAGE_SIZE, total, items: await withChildren(rows) })
  }),
)

router.get(
  '/gift-orders/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM gift_orders WHERE id = $1', [req.params.id])
    if (!rows.length) throw notFound('Gift order not found')
    const [view] = await withChildren(rows)
    const bill = trust.bills ? (await query('SELECT * FROM bills WHERE gift_order_id = $1', [rows[0].id])).rows[0] : null
    // The bill downloads from its first delivery's bill route (GET /orders/:id/bill, audited).
    res.json({ ...view, payment: { status: rows[0].payment_status, method: rows[0].payment_method, amount: rows[0].payment_amount, id: rows[0].payment_id }, bill: billView(bill ?? null), billOrderId: bill?.order_id ?? null })
  }),
)
