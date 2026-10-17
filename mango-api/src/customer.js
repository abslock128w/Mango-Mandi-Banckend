// /v1: the customer storefront API. Phone OTP login, catalogue by pincode and
// delivery date, cart, checkout with stock holds, orders and claims.
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { ACCESS_TTL_S, issueRefresh, requireCustomer, revokeRefresh, rotateRefresh, signAccess } from './auth.js'
import { isDate, now } from './clock.js'
import { getConfig } from './config.js'
import { query, tx } from './db.js'
import { customerDelivery, customerPhoto } from './delivery-proof.js'
import { activeSlots, earliestDeliveryDate, orderableDates, slotsForDate, slotView } from './delivery.js'
import { env, isProd } from './env.js'
import { asyncHandler, badRequest, conflict, HttpError, notFound, parse, StockError, unauthorized } from './errors.js'
import { newId } from './ids.js'
import { availability } from './inventory.js'
import { logger } from './logger.js'
import { createOrder, customerCancel, eatByFor, processPayment, SYSTEM } from './orders.js'
import { createGatewayOrder, devGateway, reconcilePendingPayments, refundOrder } from './payments.js'
import { allProducts, findProduct } from './products.js'
import { bookPreorder, cancelPreorder, ensurePaymentLink, openWeeks, preorderView, refundPreorder } from './preorders.js'
import { sendOtp } from './sms.js'
import { STAGES } from './stage.js'

export const router = express.Router()

const otpLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.', requestId: req.id } }),
})

const OTP_TTL_MS = 5 * 60_000
const OTP_MAX_ATTEMPTS = 5
const OTP_MAX_SENDS_PER_HOUR = 5

/** Indian mobile numbers, normalised to +91XXXXXXXXXX. */
const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
  .refine((s) => /^[6-9]\d{9}$/.test(s), 'Enter a 10-digit Indian mobile number')
  .transform((s) => `+91${s}`)

const hashOtp = (phone, code) => createHash('sha256').update(`${env.JWT_SECRET}:${phone}:${code}`).digest()

// ---------------------------------------------------------------- auth

router.post(
  '/auth/otp/request',
  otpLimiter,
  asyncHandler(async (req, res) => {
    const { phone, channel } = parse(z.object({ phone: phoneSchema, channel: z.enum(['sms', 'whatsapp']).optional() }), req.body)
    const code = String(randomInt(100_000, 1_000_000))
    const at = now()
    const out = await tx(async (c) => {
      const { rows } = await c.query('SELECT * FROM otps WHERE phone = $1 FOR UPDATE', [phone])
      const prev = rows[0]
      const fresh = !prev || at.getTime() - prev.window_start.getTime() > 3_600_000
      if (!fresh && prev.resends >= OTP_MAX_SENDS_PER_HOUR) {
        throw new HttpError(429, 'OTP_LIMIT', 'Too many codes requested. Try again in an hour.')
      }
      await c.query(
        `INSERT INTO otps (phone, code, expires_at, attempts, resends, window_start) VALUES ($1, $2, $3, 0, 1, $4)
         ON CONFLICT (phone) DO UPDATE SET code = $2, expires_at = $3, attempts = 0,
           resends = CASE WHEN $5 THEN 1 ELSE otps.resends + 1 END,
           window_start = CASE WHEN $5 THEN $4 ELSE otps.window_start END`,
        [phone, hashOtp(phone, code).toString('hex'), new Date(at.getTime() + OTP_TTL_MS), at, fresh],
      )
      return { sent: true }
    })
    const via = await sendOtp(phone, code, channel)
    res.json(isProd ? { ...out, channel: via } : { ...out, channel: via, devCode: code })
  }),
)

const tokens = async (customer) => {
  const refresh = await issueRefresh(customer.id, 'customer')
  return {
    accessToken: signAccess({ sub: customer.id, phone: customer.phone, typ: 'customer' }),
    refreshToken: refresh.token,
    expiresIn: ACCESS_TTL_S,
  }
}

router.post(
  '/auth/otp/verify',
  otpLimiter,
  asyncHandler(async (req, res) => {
    const { phone, code } = parse(z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }), req.body)
    const customer = await tx(async (c) => {
      const { rows } = await c.query('SELECT * FROM otps WHERE phone = $1 FOR UPDATE', [phone])
      const otp = rows[0]
      if (!otp || otp.expires_at <= now()) return { error: unauthorized('This code has expired. Request a new one.', 'OTP_EXPIRED') }
      if (otp.attempts >= OTP_MAX_ATTEMPTS) return { error: unauthorized('Too many wrong codes. Request a new one.', 'OTP_LOCKED') }
      if (!timingSafeEqual(Buffer.from(otp.code, 'hex'), hashOtp(phone, code))) {
        await c.query('UPDATE otps SET attempts = attempts + 1 WHERE phone = $1', [phone])
        return { error: unauthorized('Incorrect code', 'OTP_INVALID') }
      }
      await c.query('DELETE FROM otps WHERE phone = $1', [phone])
      const up = await c.query(
        `INSERT INTO customers (id, phone, created_at) VALUES ($1, $2, $3) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id, phone`,
        [newId('cus'), phone, now()],
      )
      return up.rows[0]
    })
    // Failed attempts are counted even though the request fails.
    if (customer.error) throw customer.error
    res.json(await tokens(customer))
  }),
)

router.post(
  '/auth/token/refresh',
  otpLimiter,
  asyncHandler(async (req, res) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(1) }), req.body)
    const { userId, refresh } = await rotateRefresh(refreshToken, 'customer')
    const { rows } = await query('SELECT id, phone FROM customers WHERE id = $1', [userId])
    if (!rows.length) throw unauthorized('Session expired. Please sign in again.', 'INVALID_TOKEN')
    res.json({
      accessToken: signAccess({ sub: rows[0].id, phone: rows[0].phone, typ: 'customer' }),
      refreshToken: refresh.token,
      expiresIn: ACCESS_TTL_S,
    })
  }),
)

router.post(
  '/auth/logout',
  asyncHandler(async (req, res) => {
    await revokeRefresh(req.body?.refreshToken)
    res.status(204).end()
  }),
)

// ---------------------------------------------------------------- delivery and catalogue

const PIN = z.string().regex(/^\d{6}$/, 'pincode must be 6 digits')

async function serviceable(c, pincode) {
  const { rows } = await c.query('SELECT 1 FROM pincodes WHERE pincode = $1 AND active', [pincode])
  return rows.length > 0
}

const cutoffLabel = () => `${String(getConfig().cutoffHourIST).padStart(2, '0')}:00 IST`

router.get(
  '/delivery/check',
  asyncHandler(async (req, res) => {
    const pincode = parse(PIN, req.query.pincode)
    const ok = await serviceable({ query }, pincode)
    const dates = ok ? await orderableDates({ query }) : []
    const slots = ok ? (await activeSlots({ query })).map(slotView) : []
    res.json({ serviceable: ok, earliestDeliveryDate: dates[0] ?? null, deliveryDates: dates, cutoffTime: cutoffLabel(), slots })
  }),
)

/** Delivery slots on a date with what is left in each. Empty when slots are not in use. */
router.get(
  '/delivery/slots',
  asyncHandler(async (req, res) => {
    const pincode = parse(PIN, req.query.pincode)
    const { date } = await deliveryDateFor({ query }, pincode, req.query.delivery_date || null)
    const slots = await slotsForDate({ query }, date)
    res.json({
      deliveryDate: date,
      slots: slots.map(({ id, label, startsAt, endsAt, remainingBoxes, available }) => ({ id, label, startsAt, endsAt, remainingBoxes, available })),
    })
  }),
)

/** Resolves and validates the delivery date for a pincode (pincode gate first). */
async function deliveryDateFor(c, pincode, wanted) {
  if (!(await serviceable(c, pincode))) throw badRequest('We do not deliver to this pincode yet', 'NOT_SERVICEABLE')
  const dates = await orderableDates(c)
  if (!dates.length) throw conflict('No delivery dates are open right now', 'NO_DELIVERY_DAY')
  if (!wanted) return { date: dates[0], dates }
  if (!dates.includes(wanted)) throw badRequest(`Choose one of: ${dates.join(', ')}`, 'INVALID_DATE')
  return { date: wanted, dates }
}

router.get(
  '/catalogue',
  asyncHandler(async (req, res) => {
    const pincode = parse(PIN, req.query.pincode)
    if (!(await serviceable({ query }, pincode))) return res.json({ serviceable: false, items: [] })
    const wanted = req.query.delivery_date || req.query.deliveryDate || null
    const { date, dates } = await deliveryDateFor({ query }, pincode, wanted)
    const pool = await tx((c) => availability(c, date))
    const items = allProducts().flatMap((p) =>
      STAGES.map((stage) => ({
        sku: p.sku, name: p.name, variety: p.variety, boxSize: p.boxSize, price: p.price, stage,
        qty: pool.get(`${p.sku}|${stage}`) ?? 0, eatBy: eatByFor(stage, date),
      })),
    )
    res.json({ serviceable: true, deliveryDate: date, deliveryDates: dates, cutoffTime: cutoffLabel(), items })
  }),
)

// ---------------------------------------------------------------- cart

/** Weeks open for preorders, with capacity left per SKU. */
router.get(
  '/preorders/weeks',
  asyncHandler(async (req, res) => {
    const sku = req.query.sku ? String(req.query.sku) : null
    res.json({ weeks: await openWeeks({ query }, sku), cancelPolicy: 'Cancel any time before packing for a full refund.' })
  }),
)

router.use(['/cart', '/checkout', '/orders', '/claims', '/me', '/preorders'], requireCustomer)

router.get('/me', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT id, phone, name FROM customers WHERE id = $1', [req.customer.id])
  if (!rows.length) throw notFound('Customer not found')
  res.json(rows[0])
}))

router.get(
  '/cart',
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT sku, stage, qty FROM carts WHERE customer_id = $1 ORDER BY sku, stage', [req.customer.id])
    let date = req.query.deliveryDate || req.query.delivery_date || null
    const pool = await tx(async (c) => {
      date = date ?? (await earliestDeliveryDate(c))
      return availability(c, date)
    })
    const lines = rows.map((l) => {
      const p = findProduct(l.sku)
      const avail = pool.get(`${l.sku}|${l.stage}`) ?? 0
      return { sku: l.sku, name: p?.name ?? l.sku, stage: l.stage, qty: l.qty, unitPrice: p?.price ?? 0, available: avail, insufficient: avail < l.qty }
    })
    res.json({ deliveryDate: date, lines, subtotal: lines.reduce((s, l) => s + l.unitPrice * l.qty, 0) })
  }),
)

router.post(
  '/cart/items',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ sku: z.string().min(1), stage: z.enum(STAGES), qty: z.number().int().min(0).max(20) }), req.body)
    if (!findProduct(b.sku)) throw badRequest(`Unknown SKU ${b.sku}`, 'INVALID_SKU')
    if (b.qty === 0) {
      await query('DELETE FROM carts WHERE customer_id = $1 AND sku = $2 AND stage = $3', [req.customer.id, b.sku, b.stage])
    } else {
      await query(
        `INSERT INTO carts (customer_id, sku, stage, qty) VALUES ($1, $2, $3, $4)
         ON CONFLICT (customer_id, sku, stage) DO UPDATE SET qty = EXCLUDED.qty`,
        [req.customer.id, b.sku, b.stage, b.qty],
      )
    }
    res.status(204).end()
  }),
)

router.delete(
  '/cart/items/:sku',
  asyncHandler(async (req, res) => {
    const stage = req.query.stage ? parse(z.enum(STAGES), req.query.stage) : null
    await query('DELETE FROM carts WHERE customer_id = $1 AND sku = $2 AND ($3::text IS NULL OR stage = $3)', [req.customer.id, req.params.sku, stage])
    res.status(204).end()
  }),
)

// ---------------------------------------------------------------- checkout

router.post(
  '/checkout/quote',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ pincode: PIN, deliveryDate: z.string().optional().nullable(), slotId: z.string().max(64).optional().nullable() }), req.body)
    const quote = await tx(async (c) => {
      const { date } = await deliveryDateFor(c, b.pincode, b.deliveryDate || null)
      const { rows } = await c.query('SELECT sku, stage, qty FROM carts WHERE customer_id = $1 ORDER BY sku, stage', [req.customer.id])
      if (!rows.length) throw badRequest('Your cart is empty', 'CART_EMPTY')
      const pool = await availability(c, date)
      const lines = rows.map((l) => {
        if ((pool.get(`${l.sku}|${l.stage}`) ?? 0) < l.qty) throw new StockError(l.sku)
        const price = findProduct(l.sku).price
        return { sku: l.sku, name: findProduct(l.sku).name, stage: l.stage, qty: l.qty, unitPrice: price, linePrice: price * l.qty, eatBy: eatByFor(l.stage, date) }
      })
      const subtotal = lines.reduce((s, l) => s + l.linePrice, 0)
      const slot = await quoteSlot(c, date, b.slotId ?? null, lines.reduce((s, l) => s + l.qty, 0))
      const data = { pincode: b.pincode, deliveryDate: date, slotId: slot?.id ?? null, slot, lines, subtotal, total: subtotal }
      const expiresAt = new Date(now().getTime() + getConfig().quoteMinutes * 60_000)
      const quoteId = newId('quo')
      await c.query('INSERT INTO quotes (id, customer_id, data, expires_at) VALUES ($1, $2, $3, $4)', [quoteId, req.customer.id, data, expiresAt])
      return { quoteId, ...data, expiresAt }
    })
    res.json(quote)
  }),
)

/** Checks the customer's slot choice at quote time; confirm re-checks it under lock. */
async function quoteSlot(c, date, wanted, boxes) {
  const slots = await slotsForDate(c, date)
  if (!slots.length) return null
  if (!wanted) throw badRequest('Choose a delivery slot', 'SLOT_REQUIRED')
  const s = slots.find((x) => x.id === wanted)
  if (!s) throw badRequest('That delivery slot is not available', 'SLOT_INVALID')
  if (s.remainingBoxes != null && s.remainingBoxes < boxes) throw conflict(`The ${s.label} slot on ${date} is fully booked`, 'SLOT_FULL')
  return { id: s.id, label: s.label, startsAt: s.startsAt, endsAt: s.endsAt }
}

const confirmResponse = (o) => ({
  orderId: o.id, number: o.number, status: o.status, total: o.total, deliveryDate: o.delivery_date, slotId: o.slot_id ?? null,
  razorpayOrderId: o.razorpay_order_id, razorpayKeyId: env.RAZORPAY_KEY_ID || null, holdExpiresAt: o.hold_expires_at,
})

router.post(
  '/checkout/confirm',
  asyncHandler(async (req, res) => {
    const rawKey = req.get('Idempotency-Key')
    if (!rawKey || rawKey.length > 100) throw badRequest('An Idempotency-Key header is required', 'IDEMPOTENCY_KEY_REQUIRED')
    const b = parse(
      z.object({ quoteId: z.string().min(1), address: z.string().trim().min(10, 'Enter the full delivery address').max(500), name: z.string().trim().max(80).optional() }),
      req.body,
    )
    const key = `${req.customer.id}:${rawKey}`
    const existing = async () => {
      const { rows } = await query('SELECT o.* FROM idempotency_keys k JOIN orders o ON o.id = k.order_id WHERE k.key = $1', [key])
      return rows[0] ?? null
    }
    const replay = await existing()
    if (replay) return res.status(200).json(confirmResponse(replay))

    const order = await tx(async (c) => {
      // Claimed first: a concurrent retry with the same key waits here, then replays.
      const ins = await c.query('INSERT INTO idempotency_keys (key, order_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [key, 'pending', now()])
      if (!ins.rowCount) return null
      const { rows } = await c.query('SELECT * FROM quotes WHERE id = $1 AND customer_id = $2 FOR UPDATE', [b.quoteId, req.customer.id])
      const q = rows[0]
      if (!q || q.expires_at <= now()) throw conflict('This quote has expired. Review your cart again.', 'QUOTE_EXPIRED')
      const { date } = await deliveryDateFor(c, q.data.pincode, q.data.deliveryDate)
      if (b.name) await c.query('UPDATE customers SET name = $2 WHERE id = $1', [req.customer.id, b.name])
      const cust = (await c.query('SELECT name, phone FROM customers WHERE id = $1', [req.customer.id])).rows[0]
      const created = await createOrder(
        c,
        {
          customerId: req.customer.id, customerName: b.name ?? cust.name, phone: cust.phone, pincode: q.data.pincode, address: b.address,
          deliveryDate: date, slotId: q.data.slotId ?? null, strictSlot: Boolean(q.data.slotId), status: 'PAYMENT_PENDING', paymentStatus: 'INITIATED', allOrNothing: true,
          holdExpiresAt: new Date(now().getTime() + getConfig().holdMinutes * 60_000),
          lines: q.data.lines.map((l) => ({ sku: l.sku, stage: l.stage, qty: l.qty, unitPrice: l.unitPrice })),
        },
        req.actor,
      )
      await c.query('UPDATE idempotency_keys SET order_id = $2 WHERE key = $1', [key, created.id])
      await c.query('DELETE FROM quotes WHERE id = $1', [q.id])
      await c.query('DELETE FROM carts WHERE customer_id = $1', [req.customer.id])
      return (await c.query('SELECT * FROM orders WHERE id = $1', [created.id])).rows[0]
    })
    if (!order) return res.status(200).json(confirmResponse(await existing()))

    try {
      const rzp = await createGatewayOrder({ amount: order.total, receipt: order.number, orderId: order.id })
      await query('UPDATE orders SET razorpay_order_id = $2 WHERE id = $1', [order.id, rzp])
      order.razorpay_order_id = rzp
    } catch (err) {
      logger.error({ err, orderId: order.id }, 'could not create the gateway order')
      await tx((c) => processPayment(c, { orderId: order.id, outcome: 'failed' }, SYSTEM))
      throw new HttpError(502, 'PAYMENT_GATEWAY_ERROR', 'Could not start the payment. Please try again.')
    }
    res.status(201).json(confirmResponse(order))
  }),
)

// ---------------------------------------------------------------- orders

async function ownOrder(c, req) {
  const { rows } = await c.query('SELECT * FROM orders WHERE id = $1 AND customer_id = $2', [req.params.id, req.customer.id])
  if (!rows.length) throw notFound('Order not found')
  return rows[0]
}

router.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT o.*, (SELECT COALESCE(SUM(quantity), 0)::int FROM order_items i WHERE i.order_id = o.id) AS item_count
         FROM orders o WHERE customer_id = $1 ORDER BY placed_at DESC LIMIT 100`,
      [req.customer.id],
    )
    res.json(rows.map((o) => ({ id: o.id, number: o.number, status: o.status, deliveryDate: o.delivery_date, total: o.total, itemCount: o.item_count, placedAt: o.placed_at })))
  }),
)

router.get(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const o = await ownOrder({ query }, req)
    const [items, events, slot, proof] = await Promise.all([
      query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY sku, stage', [o.id]),
      query(`SELECT status, created_at FROM order_events WHERE order_id = $1 AND from_status IS DISTINCT FROM status ORDER BY created_at, id`, [o.id]),
      o.slot_id ? query('SELECT * FROM delivery_slots WHERE id = $1', [o.slot_id]) : { rows: [] },
      customerDelivery({ query }, o),
    ])
    res.json({
      slot: slot.rows[0] ? (({ id, label, startsAt, endsAt }) => ({ id, label, startsAt, endsAt }))(slotView(slot.rows[0])) : null,
      id: o.id, number: o.number, status: o.status, deliveryDate: o.delivery_date, placedAt: o.placed_at, pincode: o.pincode,
      deliveryAddress: o.delivery_address, total: o.total, paymentStatus: o.payment_status,
      refundStatus: o.refunded_at ? 'REFUNDED' : o.refund_requested_at ? 'PENDING' : null, razorpayOrderId: o.razorpay_order_id,
      holdExpiresAt: o.hold_expires_at,
      items: items.rows.map((i) => ({ sku: i.sku, name: findProduct(i.sku)?.name ?? i.sku, stage: i.stage, quantity: i.quantity, unitPrice: i.unit_price, linePrice: i.line_price, eatBy: i.stage ? eatByFor(i.stage, o.delivery_date) : null })),
      timeline: events.rows.map((e) => ({ status: e.status, at: e.created_at })),
      ...proof,
    })
  }),
)

router.get(
  '/orders/:id/delivery-photo',
  asyncHandler(async (req, res) => {
    const p = await customerPhoto({ query }, await ownOrder({ query }, req))
    res.set('Content-Type', p.mime).set('Cache-Control', 'private, max-age=86400').send(p.bytes)
  }),
)

router.get(
  '/orders/:id/payment-status',
  asyncHandler(async (req, res) => {
    const o = await ownOrder({ query }, req)
    res.json({ status: o.payment_status, orderStatus: o.status })
  }),
)

router.post(
  '/orders/:id/cancel',
  asyncHandler(async (req, res) => {
    const refundDue = await tx((c) => customerCancel(c, req.params.id, req.customer.id, req.actor))
    if (refundDue) {
      await refundOrder(req.params.id).catch((err) => logger.error({ err, orderId: req.params.id }, 'refund failed; maintenance will retry'))
    }
    res.status(204).end()
  }),
)

// ---------------------------------------------------------------- preorders

router.post(
  '/preorders',
  asyncHandler(async (req, res) => {
    const rawKey = req.get('Idempotency-Key')
    if (!rawKey || rawKey.length > 100) throw badRequest('An Idempotency-Key header is required', 'IDEMPOTENCY_KEY_REQUIRED')
    const b = parse(
      z.object({
        sku: z.string().min(1), stage: z.enum(STAGES), qty: z.number().int().min(1).max(20),
        weekStart: z.string().refine(isDate, 'weekStart must be YYYY-MM-DD'), pincode: PIN,
        address: z.string().trim().min(10, 'Enter the full delivery address').max(500), name: z.string().trim().max(80).optional(),
        slotId: z.string().max(64).optional().nullable(), waitlist: z.boolean().optional(),
      }),
      req.body,
    )
    const key = `${req.customer.id}:pre:${rawKey}`
    const existing = async () => (await query('SELECT p.* FROM idempotency_keys k JOIN preorders p ON p.id = k.order_id WHERE k.key = $1', [key])).rows[0] ?? null
    const replay = await existing()
    if (replay) return res.status(200).json(preorderView(replay))
    const pre = await tx(async (c) => {
      const ins = await c.query('INSERT INTO idempotency_keys (key, order_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [key, 'pending', now()])
      if (!ins.rowCount) return null
      if (b.name) await c.query('UPDATE customers SET name = $2 WHERE id = $1', [req.customer.id, b.name])
      const cust = (await c.query('SELECT name, phone FROM customers WHERE id = $1', [req.customer.id])).rows[0]
      const p = await bookPreorder(c, { ...b, customerId: req.customer.id, name: b.name ?? cust.name, phone: cust.phone }, req.actor)
      await c.query('UPDATE idempotency_keys SET order_id = $2 WHERE key = $1', [key, p.id])
      return p
    })
    if (!pre) return res.status(200).json(preorderView(await existing()))
    if (pre.status !== 'PAYMENT_PENDING') return res.status(201).json(preorderView(pre))
    try {
      res.status(201).json(preorderView(await ensurePaymentLink(pre.id)))
    } catch (err) {
      logger.error({ err, preorderId: pre.id }, 'could not create the preorder payment link')
      await tx((c) => cancelPreorder(c, pre.id, req.customer.id, SYSTEM))
      throw new HttpError(502, 'PAYMENT_GATEWAY_ERROR', 'Could not start the payment. Please try again.')
    }
  }),
)

router.get(
  '/preorders',
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM preorders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50', [req.customer.id])
    res.json(rows.map(preorderView))
  }),
)

router.get(
  '/preorders/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM preorders WHERE id = $1 AND customer_id = $2', [req.params.id, req.customer.id])
    if (!rows.length) throw notFound('Preorder not found')
    res.json(preorderView(rows[0]))
  }),
)

router.post(
  '/preorders/:id/cancel',
  asyncHandler(async (req, res) => {
    const r = await tx((c) => cancelPreorder(c, req.params.id, req.customer.id, req.actor))
    const send = r.refund === 'order' ? refundOrder : r.refund === 'preorder' ? refundPreorder : null
    if (send) await send(r.id).catch((err) => logger.error({ err, id: r.id }, 'refund failed; maintenance will retry'))
    res.status(204).end()
  }),
)

// ---------------------------------------------------------------- claims

router.post(
  '/claims',
  asyncHandler(async (req, res) => {
    const b = parse(
      z.object({
        orderId: z.string().min(1),
        issueType: z.enum(['DAMAGED', 'WRONG_ITEM', 'NOT_DELIVERED']),
        description: z.string().trim().min(5).max(2000),
        itemSkus: z.array(z.string()).max(20).default([]),
        photoUrl: z.string().url().startsWith('https://').max(500).optional().nullable(),
      }),
      req.body,
    )
    const claim = await tx(async (c) => {
      const { rows } = await c.query('SELECT * FROM orders WHERE id = $1 AND customer_id = $2 FOR UPDATE', [b.orderId, req.customer.id])
      if (!rows.length) throw notFound('Order not found')
      if (rows[0].status !== 'DELIVERED') throw badRequest('Claims can only be raised on delivered orders', 'NOT_DELIVERED')
      const { rows: ev } = await c.query(`SELECT MAX(created_at) AS at FROM order_events WHERE order_id = $1 AND status = 'DELIVERED'`, [b.orderId])
      const windowMs = getConfig().claimWindowHours * 3_600_000
      if (ev[0].at && now().getTime() - ev[0].at.getTime() > windowMs) {
        throw badRequest(`Claims must be raised within ${getConfig().claimWindowHours} hours of delivery`, 'CLAIM_WINDOW_CLOSED')
      }
      const { rows: skus } = await c.query('SELECT DISTINCT sku FROM order_items WHERE order_id = $1', [b.orderId])
      const valid = new Set(skus.map((s) => s.sku))
      const bad = b.itemSkus.find((s) => !valid.has(s))
      if (bad) throw badRequest(`${bad} is not in this order`, 'INVALID_SKU')
      const open = await c.query(`SELECT 1 FROM claims WHERE order_id = $1 AND status <> 'RESOLVED'`, [b.orderId])
      if (open.rowCount) throw conflict('A claim for this order is already open')
      const id = newId('clm')
      await c.query(
        `INSERT INTO claims (id, order_id, customer_id, issue_type, description, affected_items, photo_url, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, b.orderId, req.customer.id, b.issueType, b.description, [...new Set(b.itemSkus)], b.photoUrl ?? null, now()],
      )
      return { id, status: 'SUBMITTED' }
    })
    res.status(201).json(claim)
  }),
)

router.get(
  '/claims',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT c.*, o.number, r.number AS replacement_number FROM claims c JOIN orders o ON o.id = c.order_id
         LEFT JOIN orders r ON r.id = c.replacement_order_id WHERE c.customer_id = $1 ORDER BY c.created_at DESC`,
      [req.customer.id],
    )
    res.json(
      rows.map((c) => ({
        id: c.id, orderId: c.order_id, orderNumber: c.number, issueType: c.issue_type, status: c.status, resolution: c.resolution,
        replacementOrder: c.replacement_order_id ? { id: c.replacement_order_id, number: c.replacement_number } : null, createdAt: c.created_at,
      })),
    )
  }),
)

// ---------------------------------------------------------------- dev-only

export const devRouter = express.Router()

devRouter.post(
  '/pay',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ orderId: z.string().min(1), outcome: z.enum(['captured', 'failed']) }), req.body)
    const r = await tx((c) => processPayment(c, { orderId: b.orderId, outcome: b.outcome, paymentId: `pay_dev_${newId('p').slice(2)}`, method: 'dev' }))
    if (r.result === 'refund_due') await refundOrder(b.orderId)
    res.json({ result: r.result })
  }),
)

devRouter.post(
  '/mark-paid-at-gateway',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ orderId: z.string().min(1), outcome: z.enum(['captured', 'failed']) }), req.body)
    const { rows } = await query('SELECT razorpay_order_id, total FROM orders WHERE id = $1', [b.orderId])
    if (!rows[0]?.razorpay_order_id) throw notFound('Order not found or has no gateway order')
    devGateway.set(rows[0].razorpay_order_id, { id: `pay_dev_${newId('p').slice(2)}`, status: b.outcome, amount: rows[0].total, method: 'dev' })
    res.json({ ok: true })
  }),
)

devRouter.post('/reconcile', asyncHandler(async (_req, res) => res.json({ reconciled: await reconcilePendingPayments({ minAgeSeconds: 0 }) })))
