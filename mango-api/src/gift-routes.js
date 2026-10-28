// Bulk and corporate gifting routes (MULTI_GIFT, docs/gifting.md), mounted in
// the /v1 router after the customer sign-in. Every path is under /gifts and
// acts on the caller's own gift orders: someone else's answers 404, the same
// as one that does not exist. While MULTI_GIFT is off every route answers 404.
//
//   GET  /gifts/template.csv                    the recipients template (formula-safe)
//   POST /gifts/quote                           recipients, one day and slot, promo → a priced quote
//   POST /gifts/confirm                         the quote → the gift order, every hold, one Razorpay order
//   GET  /gifts, /gifts/:id                     the buyer's gift orders and one with its deliveries
//   POST /gifts/:id/verify-payment              Checkout's reply, checked as for an order (PAY-B3)
//   POST /gifts/:id/cancel                      the whole order, while nothing is packed
//   POST /gifts/:id/recipients/:orderId/cancel  one recipient, before packing (refunded its own amount)
//   GET  /gifts/:id/bill                        the one bill for the whole order (BILLS_ENABLED)
import express from 'express'
import { z } from 'zod'
import { billFileName, billView } from './bills.js'
import { billPdf } from './bill-pdf.js'
import { now } from './clock.js'
import { getConfig } from './config.js'
import { query, tx } from './db.js'
import { checkCapacity, slotView } from './delivery.js'
import { env } from './env.js'
import { asyncHandler, badRequest, conflict, HttpError, notFound, parse, StockError } from './errors.js'
import { cancelGiftOrder, cancelGiftRecipient, createGiftOrder, giftChildren, GIFT_CANCELLABLE, giftStatus, perRecipientMax, processGiftPayment } from './gifts.js'
import { newId } from './ids.js'
import { availability } from './inventory.js'
import { logger } from './logger.js'
import { checkUnpaidLimit, eatByFor, HOLD_EXPIRED_REASON, SYSTEM } from './orders.js'
import { createGatewayOrder, reconcileGiftNow, refundsFor, sendDueRefunds, verifyCheckoutSignature } from './payments.js'
import { findProduct, sellable, shopProducts } from './products.js'
import { applyPromo, recordRedemption } from './promos.js'
import { hit } from './ratelimit.js'
import { STAGES } from './stage.js'
import { csvCell } from './warehouse/reports.js'
import { isOn } from './feature-switches.js'
// Function declarations and lazily read constants only: customer.js imports this file.
import {
  businessSchema, cutoffLabel, deliveryDateFor, phoneSchema, quoteSlot, replayFor, requestHash, requirePhone, serviceable, startingPayment, stillStarting,
} from './customer.js'

export const customerGifts = express.Router()
const whenOn = (_req, _res, next) => next(isOn('MULTI_GIFT') ? undefined : notFound())
customerGifts.use('/gifts', whenOn)

/** The columns of the recipients CSV, in order (the shop's template and parser use the same). */
export const TEMPLATE_COLUMNS = ['name', 'phone', 'address', 'pincode', 'box', 'ripeness', 'boxes', 'note']

/**
 * The recipients template: the header and one example row with a box on sale.
 * Every cell goes through csvCell (quoted; a cell starting with = + - @ or a
 * tab is prefixed with ' so a spreadsheet never runs it as a formula), so a
 * product name typed by staff can't turn the file into an attack on the buyer.
 */
export function recipientsTemplate(products = shopProducts()) {
  const p = products[0]
  const rows = [
    TEMPLATE_COLUMNS,
    ['Asha Rao', '9876543210', 'Flat 4B, Lake View Apartments, 2nd Main, Indiranagar, Bengaluru', '560038', p?.sku ?? 'ALP-3', 'RIPE', 1, 'Happy Diwali from all of us!'],
  ]
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

customerGifts.get('/gifts/template.csv', (_req, res) => {
  res.set('Content-Type', 'text/csv; charset=utf-8')
  res.set('Content-Disposition', 'attachment; filename="mandimangoes-gift-recipients.csv"')
  res.set('Cache-Control', 'no-store')
  res.send(recipientsTemplate())
})

const recipientSchema = () =>
  z
    .object({
      name: z.string().trim().min(1, "Enter the recipient's name").max(80, 'The name can be up to 80 characters'),
      phone: phoneSchema,
      address: z.string().trim().min(10, 'Enter the full delivery address').max(500, 'The address can be up to 500 characters'),
      pincode: z.string().trim().regex(/^\d{6}$/, 'The pincode must be 6 digits'),
      sku: z.string().trim().min(1, 'Choose a box').max(40),
      stage: z.enum(STAGES, { message: 'Ripeness must be RAW, SEMI_RIPE or RIPE' }),
      qty: z.number({ message: 'Enter how many boxes' }).int('Enter a whole number of boxes').min(1, 'At least 1 box'),
      note: z.string().trim().max(200, 'The note can be up to 200 characters').optional().nullable(),
    })
    .strict()

/**
 * Checks every recipient and reports every problem at once, by row (1 = the
 * first recipient), so a buyer who uploaded a CSV can fix them all in one go:
 * 400 RECIPIENTS_INVALID with { rows: [{ row, field, message }] }.
 */
async function checkRecipients(c, list) {
  const max = env.MULTI_GIFT_MAX_RECIPIENTS
  if (!Array.isArray(list) || !list.length) throw badRequest('Add at least one recipient', 'RECIPIENTS_REQUIRED')
  if (list.length > max) throw new HttpError(400, 'TOO_MANY_RECIPIENTS', `A gift order can have up to ${max} recipients.`, { maxRecipients: max })
  const schema = recipientSchema()
  const boxMax = perRecipientMax()
  const problems = []
  const out = []
  const served = new Map()
  for (const [i, raw] of list.entries()) {
    const row = i + 1
    const r = schema.safeParse(raw)
    if (!r.success) {
      for (const issue of r.error.issues) problems.push({ row, field: String(issue.path[0] ?? 'row'), message: issue.message })
      continue
    }
    const v = r.data
    if (!served.has(v.pincode)) served.set(v.pincode, await serviceable(c, v.pincode))
    if (!served.get(v.pincode)) problems.push({ row, field: 'pincode', message: `We do not deliver to ${v.pincode} yet` })
    if (!sellable(v.sku)) problems.push({ row, field: 'sku', message: `${findProduct(v.sku)?.name ?? v.sku} is not on sale` })
    if (v.qty > boxMax) problems.push({ row, field: 'qty', message: `Up to ${boxMax} boxes for one recipient` })
    out.push(v)
  }
  if (problems.length) {
    const first = problems[0]
    throw new HttpError(400, 'RECIPIENTS_INVALID', `Recipient ${first.row}: ${first.message}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''}`, { rows: problems })
  }
  return out
}

customerGifts.post(
  '/gifts/quote',
  asyncHandler(async (req, res) => {
    const b = parse(
      z.object({
        deliveryDate: z.string().optional().nullable(), slotId: z.string().max(64).optional().nullable(), promoCode: z.string().max(40).optional().nullable(),
        recipients: z.array(z.unknown()).max(100),
      }),
      req.body,
    )
    const quote = await tx(async (c) => {
      const recipients = await checkRecipients(c, b.recipients)
      // One day for everyone, by the same rules as any order (pincode gate first, then the open days).
      const { date } = await deliveryDateFor(c, recipients[0].pincode, b.deliveryDate || null)
      const boxes = recipients.reduce((s, r) => s + r.qty, 0)
      const cfg = getConfig()
      if (boxes > cfg.maxHeldBoxes) {
        throw new HttpError(409, 'HOLD_LIMIT', `You can reserve up to ${cfg.maxHeldBoxes} boxes at a time. Reduce the quantity.`, { maxHeldBoxes: cfg.maxHeldBoxes })
      }
      const pool = await availability(c, date)
      const need = new Map()
      for (const r of recipients) need.set(`${r.sku}|${r.stage}`, (need.get(`${r.sku}|${r.stage}`) ?? 0) + r.qty)
      for (const [key, qty] of need) if ((pool.get(key) ?? 0) < qty) throw new StockError(key.split('|')[0])
      await checkCapacity(c, date, boxes, null, { lock: false })
      const slot = await quoteSlot(c, date, b.slotId ?? null, boxes)
      const priced = recipients.map((r) => {
        const p = findProduct(r.sku)
        return { ...r, note: r.note || null, boxName: p.name, unitPrice: p.price, linePrice: p.price * r.qty, eatBy: eatByFor(r.stage, date) }
      })
      const subtotal = priced.reduce((s, r) => s + r.linePrice, 0)
      const promo = b.promoCode?.trim() ? await applyPromo(c, b.promoCode, req.customer.id, subtotal) : null
      const discount = promo?.discount ?? 0
      const data = {
        kind: 'multi-gift', deliveryDate: date, slotId: slot?.id ?? null, slot, recipients: priced, boxes, subtotal,
        promo: promo ? { code: promo.code, description: promo.description ?? null } : null, discount, total: subtotal - discount,
      }
      const expiresAt = new Date(now().getTime() + cfg.quoteMinutes * 60_000)
      const quoteId = newId('quo')
      await c.query('INSERT INTO quotes (id, customer_id, data, expires_at) VALUES ($1, $2, $3, $4)', [quoteId, req.customer.id, data, expiresAt])
      return { quoteId, ...data, expiresAt, holdMinutes: cfg.holdMinutes, cutoffTime: cutoffLabel(), bills: isOn('BILLS_ENABLED') }
    })
    res.json(quote)
  }),
)

const confirmView = (g) => ({
  giftOrderId: g.id, number: g.number, status: g.status, total: g.total, deliveryDate: g.delivery_date, recipientCount: g.recipient_count,
  razorpayOrderId: g.razorpay_order_id, razorpayKeyId: env.RAZORPAY_KEY_ID || null, holdExpiresAt: g.hold_expires_at,
})

/** How long a retry waits for the first try to store its Razorpay order before starting the payment itself (as checkout/confirm). */
const PAYMENT_START_GRACE_MS = 15_000

/** Creates the gift order's Razorpay order; if the gateway fails, every delivery is abandoned and the key released. */
async function startGiftPayment(g, key) {
  try {
    const rzp = await createGatewayOrder({ amount: g.total, receipt: g.number, orderId: g.id })
    const { rows } = await query('UPDATE gift_orders SET razorpay_order_id = $2 WHERE id = $1 AND razorpay_order_id IS NULL RETURNING *', [g.id, rzp])
    return rows[0] ?? (await query('SELECT * FROM gift_orders WHERE id = $1', [g.id])).rows[0]
  } catch (err) {
    logger.error({ err, giftOrderId: g.id }, 'could not create the gateway order for a gift order')
    await tx(async (c) => {
      await processGiftPayment(c, { giftOrderId: g.id, outcome: 'abandoned' }, SYSTEM)
      await c.query('DELETE FROM idempotency_keys WHERE key = $1', [key])
    })
    throw new HttpError(502, 'PAYMENT_GATEWAY_ERROR', 'Could not start the payment. Please try again.')
  }
}

customerGifts.post(
  '/gifts/confirm',
  asyncHandler(async (req, res) => {
    const rawKey = req.get('Idempotency-Key')
    if (!rawKey || rawKey.length > 100) throw badRequest('An Idempotency-Key header is required', 'IDEMPOTENCY_KEY_REQUIRED')
    const b = parse(
      z.object({ quoteId: z.string().min(1).max(64), name: z.string().trim().max(80).optional(), business: businessSchema.optional().nullable() }).strict(),
      req.body,
    )
    if (b.business && !isOn('BILLS_ENABLED')) throw badRequest('Business details for a bill are not taken at the moment', 'BILLS_OFF')
    const key = `${req.customer.id}:gift:${rawKey}`
    const hash = requestHash(b)
    const existing = () => replayFor(key, hash, 'gift_orders')
    const replay = await existing()
    if (replay && stillStarting(replay, 'razorpay_order_id')) {
      if (!(replay.hold_expires_at > now() && now() - replay.placed_at >= PAYMENT_START_GRACE_MS)) throw startingPayment()
      return res.status(200).json(confirmView(await startGiftPayment(replay, key)))
    }
    if (replay) return res.status(200).json(confirmView(replay))

    const gift = await tx(async (c) => {
      const ins = await c.query('INSERT INTO idempotency_keys (key, order_id, created_at, request_hash) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [key, 'pending', now(), hash])
      if (!ins.rowCount) return null
      const { rows } = await c.query('SELECT * FROM quotes WHERE id = $1 AND customer_id = $2 FOR UPDATE', [b.quoteId, req.customer.id])
      const q = rows[0]
      if (!q || q.expires_at <= now() || q.data.kind !== 'multi-gift') throw conflict('This quote has expired. Review your gift order again.', 'QUOTE_EXPIRED')
      const data = q.data
      // Every pincode is checked again, and the day is still open.
      for (const pin of new Set(data.recipients.map((r) => r.pincode))) await deliveryDateFor(c, pin, data.deliveryDate)
      // Prices are read again: one that moved since the review fails, so the buyer sees the new total before paying.
      for (const r of data.recipients) {
        if (!sellable(r.sku)) throw new HttpError(409, 'PRODUCT_UNAVAILABLE', `${findProduct(r.sku)?.name ?? r.sku} is no longer sold`, { sku: r.sku, stage: r.stage })
        const price = findProduct(r.sku).price
        if (price !== r.unitPrice) {
          throw new HttpError(409, 'PRICE_CHANGED', `The price of ${findProduct(r.sku).name} changed since you reviewed your order. Review it again to see the new total.`, {
            sku: r.sku, unitPrice: price,
          })
        }
      }
      // The same limits as any checkout: one unpaid order, and the boxes one buyer may hold.
      await checkUnpaidLimit(c, req.customer.id, data.boxes)
      if (b.name) await c.query('UPDATE customers SET name = $2 WHERE id = $1', [req.customer.id, b.name])
      const cust = await requirePhone(c, req.customer.id)
      const promo = data.promo ? await applyPromo(c, data.promo.code, req.customer.id, data.subtotal, { lock: true }) : null
      const g = await createGiftOrder(
        c,
        {
          customerId: req.customer.id, buyerName: b.name ?? cust.name, phone: cust.phone, q: data, promo, business: b.business ?? null,
          holdExpiresAt: new Date(now().getTime() + getConfig().holdMinutes * 60_000),
        },
        req.actor,
      )
      // One use of the code for the whole order, kept on its first delivery.
      if (promo) await recordRedemption(c, { orderId: g.children[0].id, code: promo.code, customerId: req.customer.id, discount: promo.discount })
      await c.query('UPDATE idempotency_keys SET order_id = $2 WHERE key = $1', [key, g.id])
      await c.query('DELETE FROM quotes WHERE id = $1', [q.id])
      return (await c.query('SELECT * FROM gift_orders WHERE id = $1', [g.id])).rows[0]
    })
    if (!gift) {
      const first = await existing()
      if (stillStarting(first, 'razorpay_order_id')) throw startingPayment()
      return res.status(200).json(confirmView(first))
    }
    res.status(201).json(confirmView(await startGiftPayment(gift, key)))
  }),
)

async function ownGift(c, req) {
  const { rows } = await c.query('SELECT * FROM gift_orders WHERE id = $1 AND customer_id = $2', [req.params.id, req.customer.id])
  if (!rows.length) throw notFound('Gift order not found')
  return rows[0]
}

/** What the buyer sees of a gift order: its payment, its one bill and each recipient's delivery. */
async function giftView(c, g) {
  const kids = await giftChildren(c, g.id)
  const [items, bill, expired] = await Promise.all([
    c.query('SELECT order_id, sku, stage, quantity, unit_price, line_price FROM order_items WHERE order_id = ANY($1)', [kids.map((k) => k.id)]),
    isOn('BILLS_ENABLED') ? c.query('SELECT * FROM bills WHERE gift_order_id = $1', [g.id]) : { rows: [] },
    c.query(`SELECT 1 FROM order_events WHERE order_id = ANY($1) AND status = 'CANCELLED' AND reason = $2 LIMIT 1`, [kids.map((k) => k.id), HOLD_EXPIRED_REASON]),
  ])
  const slot = g.slot_id ? (await c.query('SELECT * FROM delivery_slots WHERE id = $1', [g.slot_id])).rows[0] : null
  const status = giftStatus(g, kids)
  return {
    id: g.id, number: g.number, status, paymentStatus: g.payment_status, deliveryDate: g.delivery_date, placedAt: g.placed_at, paidAt: g.paid_at,
    slot: slot ? (({ id, label, startsAt, endsAt }) => ({ id, label, startsAt, endsAt }))(slotView(slot)) : null,
    recipientCount: g.recipient_count, boxes: g.boxes, subtotal: g.subtotal, discount: g.discount, promoCode: g.promo_code, total: g.total,
    business: g.buyer_gstin ? { name: g.buyer_business_name, gstin: g.buyer_gstin } : null,
    razorpayOrderId: g.razorpay_order_id,
    razorpayKeyId: g.status === 'PAYMENT_PENDING' && g.razorpay_order_id && status !== 'CANCELLED' ? env.RAZORPAY_KEY_ID || null : null,
    holdExpiresAt: g.hold_expires_at,
    cancelReason: status !== 'CANCELLED' ? null : expired.rowCount && g.payment_status !== 'SUCCEEDED' ? 'HOLD_EXPIRED' : 'OTHER',
    // The whole order can be cancelled while no delivery is packed yet (the owner's rule).
    cancellable: status !== 'CANCELLED' && kids.some((k) => k.status !== 'CANCELLED') && kids.every((k) => k.status === 'CANCELLED' || GIFT_CANCELLABLE.includes(k.status)),
    bill: billView(bill.rows[0] ?? null),
    recipients: kids.map((k) => {
      const i = items.rows.find((x) => x.order_id === k.id)
      return {
        orderId: k.id, number: k.number, position: k.gift_position, status: k.status,
        name: k.gift_recipient_name, phone: k.gift_recipient_phone, note: k.gift_message, address: k.delivery_address, pincode: k.pincode,
        sku: i?.sku ?? null, boxName: i ? findProduct(i.sku)?.name ?? i.sku : null, stage: i?.stage ?? null, qty: i?.quantity ?? 0,
        linePrice: i?.line_price ?? 0, discount: k.discount, total: k.total,
        // One recipient can be cancelled on their own once the order is paid, before packing; refunded their own amount.
        cancellable: g.payment_status === 'SUCCEEDED' && ['CONFIRMED', 'PROCESSING'].includes(k.status),
        refundStatus: k.refunded_at ? 'REFUNDED' : k.refund_requested_at ? 'PENDING' : null,
      }
    }),
  }
}

customerGifts.get(
  '/gifts',
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM gift_orders WHERE customer_id = $1 ORDER BY placed_at DESC LIMIT 50', [req.customer.id])
    const kids = rows.length
      ? (await query('SELECT gift_order_id, status FROM orders WHERE gift_order_id = ANY($1)', [rows.map((g) => g.id)])).rows
      : []
    res.json(rows.map((g) => ({
      id: g.id, number: g.number, status: giftStatus(g, kids.filter((k) => k.gift_order_id === g.id)), deliveryDate: g.delivery_date,
      recipientCount: g.recipient_count, total: g.total, placedAt: g.placed_at,
    })))
  }),
)

customerGifts.get(
  '/gifts/:id',
  asyncHandler(async (req, res) => {
    let g = await ownGift({ query }, req)
    // Back from Checkout a minute later with no webhook yet: ask Razorpay (throttled), as an order's page does.
    if (g.payment_status === 'INITIATED' && g.razorpay_order_id) {
      const r = await reconcileGiftNow(g.id, { minAgeMs: 60_000, throttleMs: 30_000 }).catch((err) => {
        logger.warn({ err, giftOrderId: g.id }, 'gift order payment check at Razorpay failed')
        return null
      })
      if (r && r !== 'skipped') g = await ownGift({ query }, req)
    }
    res.json(await giftView({ query }, g))
  }),
)

const VERIFY_PER_MINUTE = 6

customerGifts.post(
  '/gifts/:id/verify-payment',
  asyncHandler(async (req, res) => {
    const b = parse(
      z.object({ razorpay_payment_id: z.string().min(1).max(64), razorpay_order_id: z.string().min(1).max(64), razorpay_signature: z.string().min(1).max(128) }),
      req.body,
    )
    let g = await ownGift({ query }, req)
    if (!g.razorpay_order_id || g.razorpay_order_id !== b.razorpay_order_id) throw badRequest('This payment is not for this order', 'PAYMENT_MISMATCH')
    if (!verifyCheckoutSignature(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) throw badRequest('The payment could not be verified', 'BAD_SIGNATURE')
    const tries = await hit(`verify-gift-payment:${g.id}`, 60_000)
    if (tries.hits > VERIFY_PER_MINUTE) throw new HttpError(429, 'RATE_LIMITED', 'Too many checks. Your order page updates on its own.')
    if (g.payment_status !== 'SUCCEEDED') {
      const r = await reconcileGiftNow(g.id, { throttleMs: 2_000 })
      if (r && r !== 'skipped') g = await ownGift({ query }, req)
    }
    res.json({ status: g.payment_status, orderStatus: g.status })
  }),
)

customerGifts.post(
  '/gifts/:id/cancel',
  asyncHandler(async (req, res) => {
    const g = await ownGift({ query }, req)
    const refunds = await tx((c) => cancelGiftOrder(c, g.id, req.customer.id, req.actor))
    if (refunds.length) await sendDueRefunds({ orderIds: refunds })
    res.status(204).end()
  }),
)

customerGifts.post(
  '/gifts/:id/recipients/:orderId/cancel',
  asyncHandler(async (req, res) => {
    const g = await ownGift({ query }, req)
    const refund = await tx((c) => cancelGiftRecipient(c, g.id, req.params.orderId, req.customer.id, req.actor))
    if (refund) await sendDueRefunds({ orderId: req.params.orderId })
    res.status(204).end()
  }),
)

customerGifts.get(
  '/gifts/:id/bill',
  asyncHandler(async (req, res) => {
    if (!isOn('BILLS_ENABLED')) throw notFound('Not found')
    const g = await ownGift({ query }, req)
    const { rows } = await query('SELECT * FROM bills WHERE gift_order_id = $1', [g.id])
    if (!rows.length) throw new HttpError(404, 'BILL_NOT_ISSUED', 'This gift order has no bill yet: it is made once the order is paid.')
    const pdf = billPdf(rows[0])
    res.set('Content-Type', 'application/pdf')
    res.set('Content-Disposition', `attachment; filename="${billFileName(rows[0])}"`)
    res.set('Cache-Control', 'no-store')
    res.send(pdf)
  }),
)

/** /v1/dev (ENABLE_DEV_ROUTES, never in production): pays or fails a gift order, as the Razorpay webhook would. */
export const devGifts = express.Router()

devGifts.post(
  '/pay-gift',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ giftOrderId: z.string().min(1), outcome: z.enum(['captured', 'failed']) }), req.body)
    const { rows } = await query('SELECT total FROM gift_orders WHERE id = $1', [b.giftOrderId])
    if (!rows.length) throw notFound('Gift order not found')
    const r = await tx((c) =>
      processGiftPayment(c, { giftOrderId: b.giftOrderId, outcome: b.outcome, paymentId: `pay_dev_${newId('p').slice(2)}`, amount: rows[0].total, method: 'dev' }),
    )
    await sendDueRefunds(refundsFor(r))
    res.json({ result: r.result })
  }),
)
