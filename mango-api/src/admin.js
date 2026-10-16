// /admin/v1: the Mango Ops staff panel. Field names follow the panel's
// src/types.ts exactly.
import bcrypt from 'bcryptjs'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { ACCESS_TTL_S, issueRefresh, requireAdmin, requireManager, revokeRefresh, rotateRefresh, signAccess } from './auth.js'
import { addDays, diffDays, isDate, now, todayIST } from './clock.js'
import { currentConfig, rulesSchema, saveConfig } from './config.js'
import { query, tx } from './db.js'
import { chooseSlot, orderableDates, slotsForDate, slotView } from './delivery.js'
import { env } from './env.js'
import { asyncHandler, badRequest, conflict, notFound, parse, unauthorized } from './errors.js'
import { newId } from './ids.js'
import { availability, ledger, SELLABLE_STATUSES } from './inventory.js'
import { triggerRebalanceAll } from './maintenance.js'
import {
  allocateOrder,
  cancelOrder,
  createReplacement,
  eatByFor,
  placeOnFirstDateWithStock,
  rebalanceBatchOrders,
  rebalanceOrder,
  setOrderStatus,
  takeBatchOutOfService,
} from './orders.js'
import { allProducts, findProduct, productName } from './products.js'
import { STAGES } from './stage.js'

export const router = express.Router()

const COOKIE = 'mango_admin_rt'
const cookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax',
  path: '/admin/v1/auth',
})

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (req, res) =>
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.', requestId: req.id } }),
})

// A real bcrypt hash of a random string, so an unknown email costs the same time.
const DUMMY_HASH = bcrypt.hashSync(newId('x'), 10)

// ---------------------------------------------------------------- auth

router.post(
  '/auth/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }), req.body)
    const { rows } = await query('SELECT id, email, role, password_hash FROM admin_users WHERE email = $1', [email])
    const user = rows[0]
    const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH)
    if (!user || !ok) throw unauthorized('Incorrect email or password', 'INVALID_CREDENTIALS')
    const refresh = await issueRefresh(user.id, 'admin')
    res.cookie(COOKIE, refresh.token, { ...cookieOptions(), expires: refresh.expiresAt })
    res.json({ accessToken: signAccess({ sub: user.id, email: user.email, role: user.role, typ: 'admin' }), expiresIn: ACCESS_TTL_S })
  }),
)

router.post(
  '/auth/refresh',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { userId, refresh } = await rotateRefresh(req.cookies?.[COOKIE], 'admin')
    const { rows } = await query('SELECT id, email, role FROM admin_users WHERE id = $1', [userId])
    if (!rows.length) throw unauthorized('Session expired. Please sign in again.', 'INVALID_TOKEN')
    if (refresh) res.cookie(COOKIE, refresh.token, { ...cookieOptions(), expires: refresh.expiresAt })
    const u = rows[0]
    res.json({ accessToken: signAccess({ sub: u.id, email: u.email, role: u.role, typ: 'admin' }), expiresIn: ACCESS_TTL_S })
  }),
)

router.post(
  '/auth/logout',
  asyncHandler(async (req, res) => {
    await revokeRefresh(req.cookies?.[COOKIE])
    res.clearCookie(COOKIE, cookieOptions())
    res.status(204).end()
  }),
)

router.use(requireAdmin)

router.get('/auth/me', (req, res) => res.json({ email: req.admin.email, role: req.admin.role }))

// ---------------------------------------------------------------- helpers

const available = (l) => Math.max(0, l.on_hand - l.held - l.committed - l.reserve_buffer)

// ---------------------------------------------------------------- dashboard

router.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const cfg = currentConfig().rules
    const today = todayIST()
    const [counts, claims, batches, stock, risky] = await Promise.all([
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
    ])
    const bySku = new Map(stock.rows.map((r) => [r.sku, r.available]))
    res.json({
      orders: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
      openClaims: claims.rows[0].n,
      batchesNearLimit: batches.rows.map((b) => ({ id: b.id, variety: b.variety, ageDays: diffDays(today, b.plucked_on), available: b.available })),
      lowStock: allProducts()
        .map((p) => ({ sku: p.sku, productName: p.name, available: bySku.get(p.sku) ?? 0 }))
        .filter((p) => p.available <= cfg.lowStockThreshold),
      atRiskOrders: risky.rows.map((o) => ({ id: o.id, number: o.number, deliveryDate: o.delivery_date, reason: o.at_risk_reason })),
    })
  }),
)

router.get('/products', (_req, res) => res.json(allProducts().map(({ sku, name, variety, boxSize }) => ({ sku, name, variety, boxSize }))))

// ---------------------------------------------------------------- batches

const BATCH_FLOW = ['ARRIVING', 'IN_TRANSIT', 'ARRIVED', 'RIPENING', 'SELLING', 'EXHAUSTED']
const BATCH_STATUSES = [...BATCH_FLOW, 'CONDEMNED']
const ARRIVED_OR_LATER = ['ARRIVED', 'RIPENING', 'SELLING', 'EXHAUSTED']

const batchListSql = `
  SELECT b.id, b.variety, b.plucked_on, b.farm, b.status, b.created_at,
         q.ripeness_rating, q.condition,
         COALESCE(SUM(l.on_hand), 0)::int AS on_hand, COALESCE(SUM(l.held), 0)::int AS held,
         COALESCE(SUM(l.committed), 0)::int AS committed,
         COALESCE(SUM(GREATEST(l.on_hand - l.held - l.committed - l.reserve_buffer, 0)), 0)::int AS available
    FROM batches b
    LEFT JOIN batch_lines l ON l.batch_id = b.id
    LEFT JOIN LATERAL (SELECT ripeness_rating, condition FROM batch_qc WHERE batch_id = b.id ORDER BY logged_at DESC LIMIT 1) q ON TRUE`

router.get(
  '/batches',
  asyncHandler(async (req, res) => {
    const status = req.query.status ? parse(z.enum(BATCH_STATUSES), req.query.status) : null
    const { rows } = await query(
      `${batchListSql} WHERE ($1::text IS NULL OR b.status = $1)
        GROUP BY b.id, q.ripeness_rating, q.condition ORDER BY b.plucked_on DESC, b.created_at DESC`,
      [status],
    )
    const today = todayIST()
    res.json(
      rows.map((b) => ({
        id: b.id, variety: b.variety, pluckedOn: b.plucked_on, ageDays: diffDays(today, b.plucked_on), farm: b.farm,
        status: b.status, latestRating: b.ripeness_rating ?? null, latestCondition: b.condition ?? null,
        onHand: b.on_hand, held: b.held, committed: b.committed, available: b.available,
      })),
    )
  }),
)

async function batchDetail(c, batchId) {
  const { rows } = await c.query('SELECT * FROM batches WHERE id = $1', [batchId])
  if (!rows.length) throw notFound('Batch not found')
  const b = rows[0]
  const [lines, qc] = await Promise.all([
    c.query('SELECT * FROM batch_lines WHERE batch_id = $1 ORDER BY sku', [batchId]),
    c.query('SELECT * FROM batch_qc WHERE batch_id = $1 ORDER BY logged_at DESC', [batchId]),
  ])
  return {
    id: b.id, variety: b.variety, pluckedOn: b.plucked_on, ageDays: diffDays(todayIST(), b.plucked_on), farm: b.farm,
    status: b.status, etaDate: b.eta_date, arrivedAt: b.arrived_at, createdAt: b.created_at,
    lines: lines.rows.map((l) => ({
      id: l.id, sku: l.sku, productName: productName(l.sku), onHand: l.on_hand, held: l.held, committed: l.committed,
      reserveBuffer: l.reserve_buffer, available: available(l),
    })),
    qc: qc.rows.map((q) => ({
      id: q.id, ripenessRating: q.ripeness_rating, condition: q.condition, notes: q.notes, loggedBy: q.logged_by, loggedAt: q.logged_at,
    })),
  }
}

router.post(
  '/batches',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        variety: z.string().trim().min(1).max(60),
        pluckedOn: z.string().refine(isDate, 'must be a date (YYYY-MM-DD)'),
        farm: z.string().trim().max(120).optional().nullable(),
        lines: z.array(z.object({ sku: z.string().min(1), onHand: z.number().int().min(0).max(100_000) })).min(1).max(20),
      }),
      req.body,
    )
    if (body.pluckedOn > todayIST()) throw badRequest('pluckedOn cannot be in the future')
    const seen = new Set()
    for (const l of body.lines) {
      const p = findProduct(l.sku)
      if (!p) throw badRequest(`Unknown SKU ${l.sku}`, 'INVALID_SKU')
      if (p.variety !== body.variety) throw badRequest(`${l.sku} is not a ${body.variety} SKU`, 'INVALID_SKU')
      if (seen.has(l.sku)) throw badRequest(`${l.sku} is listed twice`)
      seen.add(l.sku)
    }
    const detail = await tx(async (c) => {
      const batchId = newId('bat')
      await c.query('INSERT INTO batches (id, variety, plucked_on, farm, eta_date, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
        batchId, body.variety, body.pluckedOn, body.farm || null, addDays(body.pluckedOn, currentConfig().rules.transitDays), now(),
      ])
      for (const l of body.lines) {
        await c.query('INSERT INTO batch_lines (id, batch_id, sku, on_hand) VALUES ($1, $2, $3, $4)', [newId('bl'), batchId, l.sku, l.onHand])
        if (l.onHand) await ledger(c, { batchId, eventType: 'INTAKE', sku: l.sku, delta: l.onHand, actorId: req.admin.email, reason: 'Batch received' })
      }
      return batchDetail(c, batchId)
    })
    res.status(201).json(detail)
  }),
)

router.get('/batches/:id', asyncHandler(async (req, res) => res.json(await batchDetail({ query }, req.params.id))))

router.patch(
  '/batches/:id/status',
  asyncHandler(async (req, res, next) => {
    const { status } = parse(z.object({ status: z.enum(BATCH_STATUSES) }), req.body)
    if (status === 'CONDEMNED' && req.admin.role !== 'MANAGER') return requireManager(req, res, next)
    const result = await tx(async (c) => {
      const { rows } = await c.query('SELECT * FROM batches WHERE id = $1 FOR UPDATE', [req.params.id])
      if (!rows.length) throw notFound('Batch not found')
      const b = rows[0]
      if (['EXHAUSTED', 'CONDEMNED'].includes(b.status)) throw badRequest(`This batch is ${b.status} and cannot change`, 'INVALID_TRANSITION')
      if (status !== 'CONDEMNED' && BATCH_FLOW.indexOf(status) <= BATCH_FLOW.indexOf(b.status)) {
        throw badRequest(`Cannot move a batch from ${b.status} back to ${status}`, 'INVALID_TRANSITION')
      }
      const arrivedAt = !b.arrived_at && ARRIVED_OR_LATER.includes(status) ? now() : b.arrived_at
      await c.query('UPDATE batches SET status = $2, arrived_at = $3 WHERE id = $1', [b.id, status, arrivedAt])
      await ledger(c, { batchId: b.id, eventType: 'STATUS', sku: null, delta: 0, actorId: req.admin.email, reason: `${b.status} → ${status}` })
      const actor = req.actor
      if (status === 'CONDEMNED' || status === 'EXHAUSTED') return takeBatchOutOfService(c, b.id, status, actor)
      const touched = await rebalanceBatchOrders(c, [b.id], actor)
      return { rebalancedOrders: touched.filter((r) => r.changed && !r.atRisk).map((r) => r.number), atRiskOrders: touched.filter((r) => r.atRisk).map((r) => r.number) }
    })
    if (status === 'CONDEMNED') return res.json(result)
    res.status(204).end()
  }),
)

router.post(
  '/batches/:id/qc',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        ripenessRating: z.enum(STAGES),
        condition: z.enum(['GOOD', 'FAIR', 'REJECT']),
        notes: z.string().trim().max(1000).optional().nullable(),
      }),
      req.body,
    )
    const out = await tx(async (c) => {
      const { rows } = await c.query('SELECT id, status FROM batches WHERE id = $1 FOR UPDATE', [req.params.id])
      if (!rows.length) throw notFound('Batch not found')
      if (['EXHAUSTED', 'CONDEMNED'].includes(rows[0].status)) throw badRequest(`This batch is ${rows[0].status}`, 'INVALID_TRANSITION')
      const today = todayIST()
      const dup = await c.query(
        `SELECT 1 FROM batch_qc WHERE batch_id = $1 AND logged_by = $2 AND (logged_at AT TIME ZONE 'Asia/Kolkata')::date = $3 LIMIT 1`,
        [req.params.id, req.admin.email, today],
      )
      const qcId = newId('qc')
      await c.query(
        'INSERT INTO batch_qc (id, batch_id, ripeness_rating, condition, notes, logged_by, logged_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [qcId, req.params.id, body.ripenessRating, body.condition, body.notes || null, req.admin.email, now()],
      )
      // A QC reading can shift the batch's stage: re-check every order on it.
      const touched = await rebalanceBatchOrders(c, [req.params.id], req.actor)
      return {
        id: qcId,
        ...(dup.rowCount ? { warning: 'QC already logged today by this user' } : {}),
        rebalancedOrders: touched.filter((r) => r.changed && !r.atRisk).map((r) => r.number),
        atRiskOrders: touched.filter((r) => r.atRisk).map((r) => r.number),
      }
    })
    res.status(201).json(out)
  }),
)

router.patch(
  '/batches/:id/lines/:lineId',
  asyncHandler(async (req, res) => {
    const body = parse(
      z
        .object({
          onHand: z.number().int().min(0).max(100_000).optional(),
          reserveBuffer: z.number().int().min(0).max(100_000).optional(),
          reason: z.string().trim().min(1, 'reason is required').max(500),
        })
        .refine((b) => b.onHand !== undefined || b.reserveBuffer !== undefined, 'Change onHand or reserveBuffer'),
      req.body,
    )
    await tx(async (c) => {
      const { rows } = await c.query(
        `SELECT l.*, b.status FROM batch_lines l JOIN batches b ON b.id = l.batch_id WHERE l.id = $1 AND l.batch_id = $2 FOR UPDATE OF l`,
        [req.params.lineId, req.params.id],
      )
      if (!rows.length) throw notFound('Batch line not found')
      const l = rows[0]
      if (['EXHAUSTED', 'CONDEMNED'].includes(l.status)) throw badRequest(`This batch is ${l.status}`, 'INVALID_TRANSITION')
      const onHand = body.onHand ?? l.on_hand
      const buffer = body.reserveBuffer ?? l.reserve_buffer
      if (onHand < l.held + l.committed) {
        throw badRequest(`On hand cannot go below the ${l.held + l.committed} boxes already promised to orders`, 'BELOW_COMMITTED')
      }
      if (onHand - l.held - l.committed - buffer < 0) throw badRequest('The reserve buffer is larger than the free stock', 'BUFFER_TOO_LARGE')
      await c.query('UPDATE batch_lines SET on_hand = $2, reserve_buffer = $3 WHERE id = $1', [l.id, onHand, buffer])
      if (onHand !== l.on_hand) await ledger(c, { batchId: l.batch_id, eventType: 'ADJUST', sku: l.sku, delta: onHand - l.on_hand, actorId: req.admin.email, reason: body.reason })
      if (buffer !== l.reserve_buffer) {
        await ledger(c, { batchId: l.batch_id, eventType: 'ADJUST_BUFFER', sku: l.sku, delta: buffer - l.reserve_buffer, actorId: req.admin.email, reason: body.reason })
      }
    })
    res.status(204).end()
  }),
)

router.get(
  '/batches/:id/ledger',
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM batch_ledger WHERE batch_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200', [req.params.id])
    res.json(
      rows.map((r) => ({ id: r.id, eventType: r.event_type, sku: r.sku, delta: r.delta, actorType: r.actor_type, actorId: r.actor_id, reason: r.reason, createdAt: r.created_at })),
    )
  }),
)

// ---------------------------------------------------------------- orders

const ORDER_STATUSES = ['PAYMENT_PENDING', 'CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RTO', 'CANCELLED']
const PAGE_SIZE = 50
const likeEscape = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

router.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const f = parse(
      z.object({
        status: z.enum(ORDER_STATUSES).optional(),
        from: z.string().refine(isDate, 'from must be YYYY-MM-DD').optional(),
        to: z.string().refine(isDate, 'to must be YYYY-MM-DD').optional(),
        q: z.string().trim().max(40).optional(),
        atRisk: z.enum(['true', 'false']).optional(),
        page: z.coerce.number().int().min(1).max(10_000).default(1),
      }),
      Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')),
    )
    const where = []
    const params = []
    const add = (sql, v) => {
      params.push(v)
      where.push(sql.replace('?', `$${params.length}`))
    }
    if (f.status) add('o.status = ?', f.status)
    if (f.from) add(`(o.placed_at AT TIME ZONE 'Asia/Kolkata')::date >= ?`, f.from)
    if (f.to) add(`(o.placed_at AT TIME ZONE 'Asia/Kolkata')::date <= ?`, f.to)
    if (f.atRisk) add('o.at_risk = ?', f.atRisk === 'true')
    if (f.q) {
      params.push(`${likeEscape(f.q)}%`, `%${likeEscape(f.q)}%`)
      where.push(`(o.number ILIKE $${params.length - 1} OR o.phone ILIKE $${params.length})`)
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = (await query(`SELECT COUNT(*)::int AS n FROM orders o ${w}`, params)).rows[0].n
    const { rows } = await query(
      `SELECT o.*, (SELECT COALESCE(SUM(quantity), 0)::int FROM order_items i WHERE i.order_id = o.id) AS item_count
         FROM orders o ${w} ORDER BY o.placed_at DESC, o.number DESC LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`,
      params,
    )
    res.json({
      page: f.page,
      pageSize: PAGE_SIZE,
      total,
      items: rows.map((o) => ({
        id: o.id, number: o.number, customerName: o.customer_name, phone: o.phone, itemCount: o.item_count, total: o.total,
        status: o.status, deliveryDate: o.delivery_date, placedAt: o.placed_at, atRisk: o.at_risk, channel: o.channel,
      })),
    })
  }),
)

export async function orderDetail(c, orderId) {
  const { rows } = await c.query(
    `SELECT o.*, r.number AS replacement_for_number, s.label AS slot_label, s.starts_at AS slot_starts_at, s.ends_at AS slot_ends_at
       FROM orders o LEFT JOIN orders r ON r.id = o.replacement_for LEFT JOIN delivery_slots s ON s.id = o.slot_id WHERE o.id = $1`,
    [orderId],
  )
  if (!rows.length) throw notFound('Order not found')
  const o = rows[0]
  const [items, stock, events, notes] = await Promise.all([
    c.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY sku, stage', [orderId]),
    c.query(
      `SELECT s.*, b.variety, b.plucked_on FROM order_stock s JOIN batches b ON b.id = s.batch_id
        WHERE s.order_id = $1 AND s.state <> 'released' ORDER BY s.sku, b.plucked_on`,
      [orderId],
    ),
    c.query('SELECT * FROM order_events WHERE order_id = $1 ORDER BY created_at, id', [orderId]),
    c.query('SELECT * FROM notifications WHERE order_id = $1 ORDER BY created_at, id', [orderId]),
  ])
  return {
    id: o.id, number: o.number, status: o.status, customerName: o.customer_name, phone: o.phone, pincode: o.pincode,
    deliveryAddress: o.delivery_address, deliveryDate: o.delivery_date, placedAt: o.placed_at, total: o.total,
    atRisk: o.at_risk, atRiskReason: o.at_risk_reason, channel: o.channel,
    replacementFor: o.replacement_for ? { id: o.replacement_for, number: o.replacement_for_number } : null,
    slot: o.slot_id ? { id: o.slot_id, label: o.slot_label, startsAt: String(o.slot_starts_at).slice(0, 5), endsAt: String(o.slot_ends_at).slice(0, 5) } : null,
    notifications: notes.rows.map((n) => ({
      kind: n.kind, channel: n.channel, status: n.status, attempts: n.attempts, createdAt: n.created_at, sentAt: n.sent_at, error: n.last_error,
    })),
    items: items.rows.map((i) => ({
      id: i.id, productName: productName(i.sku), sku: i.sku, quantity: i.quantity, stage: i.stage, unitPrice: i.unit_price,
      linePrice: i.line_price, eatBy: i.stage ? eatByFor(i.stage, o.delivery_date) : null,
    })),
    stock: stock.rows.map((s) => ({ id: s.id, batchId: s.batch_id, sku: s.sku, stage: s.stage, variety: s.variety, pluckedOn: s.plucked_on, quantity: s.quantity, state: s.state })),
    events: events.rows.map((e) => ({ status: e.status, fromStatus: e.from_status, actor: e.actor, reason: e.reason, createdAt: e.created_at })),
    payment: o.payment_status || o.payment_method
      ? { status: o.payment_status, method: o.payment_method, amount: o.payment_amount, id: o.payment_id, ...(o.payment_link_url ? { linkUrl: o.payment_link_url } : {}),
          refund: o.refund_requested_at ? { requestedAt: o.refund_requested_at, refundedAt: o.refunded_at, id: o.refund_id } : null }
      : null,
  }
}

router.get('/orders/:id', asyncHandler(async (req, res) => res.json(await orderDetail({ query }, req.params.id))))

router.patch(
  '/orders/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(ORDER_STATUSES) }), req.body)
    await tx((c) => setOrderStatus(c, req.params.id, status, req.actor))
    res.status(204).end()
  }),
)

router.post(
  '/orders/:id/allocate',
  asyncHandler(async (req, res) => {
    await tx((c) => allocateOrder(c, req.params.id, req.actor))
    res.status(204).end()
  }),
)

router.post(
  '/orders/:id/cancel',
  asyncHandler(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'reason is required').max(500) }), req.body ?? {})
    await tx((c) => cancelOrder(c, req.params.id, req.actor, reason))
    res.status(204).end()
  }),
)

router.post(
  '/orders/:id/rebalance',
  asyncHandler(async (req, res) => {
    const r = await tx((c) => rebalanceOrder(c, req.params.id, req.actor))
    if (!r) throw badRequest('Only open orders can be rebalanced', 'INVALID_TRANSITION')
    res.json({ changed: r.changed, atRisk: r.atRisk })
  }),
)

/** Ops fix for an at-risk order: move it to a date that has stock. */
router.post(
  '/orders/:id/reschedule',
  asyncHandler(async (req, res) => {
    const { deliveryDate, slotId } = parse(
      z.object({ deliveryDate: z.string().refine(isDate, 'deliveryDate must be YYYY-MM-DD'), slotId: z.string().max(64).optional().nullable() }),
      req.body,
    )
    await tx(async (c) => {
      const { rows } = await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [req.params.id])
      if (!rows.length) throw notFound('Order not found')
      const o = rows[0]
      if (!['CONFIRMED', 'PROCESSING'].includes(o.status)) throw badRequest(`A ${o.status} order cannot be rescheduled`, 'INVALID_TRANSITION')
      if (!(await orderableDates(c)).includes(deliveryDate)) throw badRequest(`${deliveryDate} is not an open delivery date`, 'INVALID_DATE')
      if (slotId) {
        const { rows: q } = await c.query('SELECT COALESCE(SUM(quantity), 0)::int AS n FROM order_items WHERE order_id = $1', [o.id])
        o.slot_id = await chooseSlot(c, deliveryDate, q[0].n, slotId, { strict: true, excludeOrderId: o.id })
        await c.query('UPDATE orders SET slot_id = $2 WHERE id = $1', [o.id, o.slot_id])
      }
      const date = await placeOnFirstDateWithStock(c, o, [deliveryDate], req.actor, `Rescheduled by ${req.admin.email}`)
      if (!date) throw conflict(`Not enough stock for this order on ${deliveryDate}`, 'STOCK_INSUFFICIENT')
      await rebalanceOrder(c, o.id, req.actor)
    })
    res.status(204).end()
  }),
)

// ---------------------------------------------------------------- pack list

router.get(
  '/pack-list',
  asyncHandler(async (req, res) => {
    const date = req.query.date ? parse(z.string().refine(isDate, 'date must be YYYY-MM-DD'), req.query.date) : addDays(todayIST(), 1)
    const { rows: orders } = await query(
      `SELECT o.id, o.number, o.customer_name, o.pincode, o.status, o.slot_id, s.label AS slot_label
         FROM orders o LEFT JOIN delivery_slots s ON s.id = o.slot_id
        WHERE o.delivery_date = $1 AND o.status IN ('CONFIRMED', 'PROCESSING', 'PACKED')
        ORDER BY s.sort NULLS LAST, s.starts_at NULLS LAST, o.number`,
      [date],
    )
    const ids = orders.map((o) => o.id)
    const [items, stock] = await Promise.all([
      query('SELECT order_id, sku, SUM(quantity)::int AS quantity FROM order_items WHERE order_id = ANY($1) GROUP BY order_id, sku ORDER BY sku', [ids]),
      query(
        `SELECT s.order_id, s.sku, s.batch_id, s.quantity, s.state, b.variety, b.plucked_on
           FROM order_stock s JOIN batches b ON b.id = s.batch_id
          WHERE s.order_id = ANY($1) AND s.state IN ('committed', 'packed') ORDER BY b.plucked_on`,
        [ids],
      ),
    ])
    res.json(
      orders.map((o) => ({
        id: o.id, number: o.number, customerName: o.customer_name, pincode: o.pincode, status: o.status,
        slot: o.slot_id ? { id: o.slot_id, label: o.slot_label } : null,
        items: items.rows
          .filter((i) => i.order_id === o.id)
          .map((i) => ({
            sku: i.sku, productName: productName(i.sku), quantity: i.quantity,
            picks: stock.rows
              .filter((s) => s.order_id === o.id && s.sku === i.sku)
              .map((s) => ({ batchId: s.batch_id, variety: s.variety, pluckedOn: s.plucked_on, quantity: s.quantity, packed: s.state === 'packed' })),
          })),
      })),
    )
  }),
)

// ---------------------------------------------------------------- claims

router.get(
  '/claims',
  asyncHandler(async (req, res) => {
    const status = req.query.status ? parse(z.enum(['SUBMITTED', 'UNDER_REVIEW', 'RESOLVED']), req.query.status) : null
    const { rows } = await query(
      `SELECT c.*, o.number AS order_number, o.total AS order_total, o.phone, r.number AS replacement_number
         FROM claims c JOIN orders o ON o.id = c.order_id LEFT JOIN orders r ON r.id = c.replacement_order_id
        WHERE ($1::text IS NULL AND c.status IN ('SUBMITTED', 'UNDER_REVIEW')) OR c.status = $1
        ORDER BY c.created_at`,
      [status],
    )
    res.json(
      rows.map((c) => ({
        id: c.id, orderId: c.order_id, orderNumber: c.order_number, orderTotal: c.order_total, customerPhone: c.phone,
        issueType: c.issue_type, description: c.description, affectedItems: c.affected_items, photoUrl: c.photo_url,
        status: c.status, resolution: c.resolution, createdAt: c.created_at,
        replacementOrder: c.replacement_order_id ? { id: c.replacement_order_id, number: c.replacement_number } : null,
      })),
    )
  }),
)

router.post(
  '/claims/:id/review',
  asyncHandler(async (req, res) => {
    const r = await query(`UPDATE claims SET status = 'UNDER_REVIEW' WHERE id = $1 AND status = 'SUBMITTED'`, [req.params.id])
    if (!r.rowCount) throw notFound('Claim not found or not awaiting review')
    res.status(204).end()
  }),
)

router.post(
  '/claims/:id/resolve',
  asyncHandler(async (req, res) => {
    if (req.body?.resolution === 'REFUND_APPROVED') throw badRequest('VMR does not refund. Approve a replacement or reject the claim.', 'NO_REFUNDS')
    const { resolution } = parse(z.object({ resolution: z.enum(['REPLACEMENT_APPROVED', 'REJECTED']) }), req.body)
    await tx(async (c) => {
      const { rows } = await c.query('SELECT * FROM claims WHERE id = $1 FOR UPDATE', [req.params.id])
      if (!rows.length) throw notFound('Claim not found')
      const claim = rows[0]
      if (claim.status === 'RESOLVED') throw conflict('This claim is already resolved')
      let replacementId = null
      if (resolution === 'REPLACEMENT_APPROVED') {
        const { rows: o } = await c.query('SELECT * FROM orders WHERE id = $1', [claim.order_id])
        replacementId = (await createReplacement(c, claim, o[0], req.actor)).id
      }
      await c.query(
        `UPDATE claims SET status = 'RESOLVED', resolution = $2, replacement_order_id = $3, resolved_by = $4, resolved_at = $5 WHERE id = $1`,
        [claim.id, resolution, replacementId, req.admin.email, now()],
      )
    })
    res.status(204).end()
  }),
)

// ---------------------------------------------------------------- pincodes

const pincodeDto = (p) => ({ pincode: p.pincode, city: p.city, zone: p.zone, active: p.active })
const PIN = z.string().regex(/^\d{6}$/, 'pincode must be 6 digits')

router.get('/pincodes', asyncHandler(async (_req, res) => res.json((await query('SELECT * FROM pincodes ORDER BY pincode')).rows.map(pincodeDto))))

router.post(
  '/pincodes',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ pincode: PIN, city: z.string().trim().min(1, 'city is required').max(80), zone: z.string().trim().max(80).optional().nullable() }), req.body)
    const { rows } = await query(
      `INSERT INTO pincodes (pincode, city, zone, active) VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (pincode) DO UPDATE SET city = EXCLUDED.city, zone = EXCLUDED.zone, active = TRUE RETURNING *`,
      [b.pincode, b.city, b.zone || null],
    )
    res.status(201).json(pincodeDto(rows[0]))
  }),
)

router.patch(
  '/pincodes/:pincode',
  asyncHandler(async (req, res) => {
    const b = parse(
      z.object({ city: z.string().trim().min(1).max(80).optional(), zone: z.string().trim().max(80).nullable().optional(), active: z.boolean().optional() }),
      req.body,
    )
    const { rows } = await query(
      `UPDATE pincodes SET city = COALESCE($2, city), zone = CASE WHEN $5 THEN $3 ELSE zone END, active = COALESCE($4, active)
        WHERE pincode = $1 RETURNING *`,
      [req.params.pincode, b.city ?? null, b.zone ?? null, b.active ?? null, 'zone' in b],
    )
    if (!rows.length) throw notFound('Pincode not found')
    res.json(pincodeDto(rows[0]))
  }),
)

router.delete(
  '/pincodes/:pincode',
  requireManager,
  asyncHandler(async (req, res) => {
    const r = await query('DELETE FROM pincodes WHERE pincode = $1', [req.params.pincode])
    if (!r.rowCount) throw notFound('Pincode not found')
    res.status(204).end()
  }),
)

// ---------------------------------------------------------------- rules, calendar, coverage

router.get('/config', (_req, res) => {
  const { version, rules } = currentConfig()
  res.json({ version, rules })
})

router.put(
  '/config',
  requireManager,
  asyncHandler(async (req, res) => {
    const rules = parse(rulesSchema, req.body?.rules ?? req.body)
    const saved = await saveConfig(rules, req.admin.email)
    triggerRebalanceAll() // new windows can invalidate allocations
    res.json(saved)
  }),
)

router.get(
  '/calendar',
  asyncHandler(async (req, res) => {
    const from = isDate(req.query.from) ? req.query.from : todayIST()
    const to = isDate(req.query.to) ? req.query.to : addDays(from, 60)
    const { rows } = await query('SELECT * FROM delivery_calendar WHERE date BETWEEN $1 AND $2 ORDER BY date', [from, to])
    res.json(rows.map((r) => ({ date: r.date, isOpen: r.is_open, maxBoxes: r.max_boxes, note: r.note })))
  }),
)

router.put(
  '/calendar/:date',
  asyncHandler(async (req, res) => {
    if (!isDate(req.params.date)) throw badRequest('date must be YYYY-MM-DD')
    const b = parse(
      z.object({ isOpen: z.boolean(), maxBoxes: z.number().int().min(0).nullable().optional(), note: z.string().trim().max(200).nullable().optional() }),
      req.body,
    )
    await query(
      `INSERT INTO delivery_calendar (date, is_open, max_boxes, note) VALUES ($1, $2, $3, $4)
       ON CONFLICT (date) DO UPDATE SET is_open = EXCLUDED.is_open, max_boxes = EXCLUDED.max_boxes, note = EXCLUDED.note`,
      [req.params.date, b.isOpen, b.maxBoxes ?? null, b.note ?? null],
    )
    res.status(204).end()
  }),
)

router.delete(
  '/calendar/:date',
  asyncHandler(async (req, res) => {
    await query('DELETE FROM delivery_calendar WHERE date = $1', [req.params.date])
    res.status(204).end()
  }),
)

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)')
const slotBody = z.object({
  label: z.string().trim().min(1).max(40),
  startsAt: TIME,
  endsAt: TIME,
  maxBoxes: z.number().int().min(0).nullable().optional(),
  active: z.boolean().optional(),
  sort: z.number().int().min(0).max(1000).optional(),
})

router.get(
  '/slots',
  asyncHandler(async (_req, res) => {
    const { rows } = await query('SELECT * FROM delivery_slots ORDER BY sort, starts_at, id')
    res.json(rows.map(slotView))
  }),
)

router.post(
  '/slots',
  requireManager,
  asyncHandler(async (req, res) => {
    const b = parse(slotBody.refine((s) => s.endsAt > s.startsAt, { message: 'The slot must end after it starts', path: ['endsAt'] }), req.body)
    const { rows } = await query(
      `INSERT INTO delivery_slots (id, label, starts_at, ends_at, max_boxes, active, sort, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [newId('slt'), b.label, b.startsAt, b.endsAt, b.maxBoxes ?? null, b.active ?? true, b.sort ?? 0, now()],
    )
    res.status(201).json(slotView(rows[0]))
  }),
)

/** Slots are switched off rather than deleted: orders keep pointing at them. */
router.patch(
  '/slots/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const b = parse(slotBody.partial(), req.body)
    const out = await tx(async (c) => {
      const { rows } = await c.query('SELECT * FROM delivery_slots WHERE id = $1 FOR UPDATE', [req.params.id])
      if (!rows.length) throw notFound('Slot not found')
      const s = { ...slotView(rows[0]), ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) }
      if (!(s.endsAt > s.startsAt)) throw badRequest('The slot must end after it starts', 'VALIDATION_ERROR')
      const r = await c.query(
        'UPDATE delivery_slots SET label = $2, starts_at = $3, ends_at = $4, max_boxes = $5, active = $6, sort = $7 WHERE id = $1 RETURNING *',
        [s.id, s.label, s.startsAt, s.endsAt, s.maxBoxes ?? null, s.active, s.sort],
      )
      return slotView(r.rows[0])
    })
    res.json(out)
  }),
)

/** Sellable boxes per SKU and stage for each orderable date: the supply-coverage grid. */
router.get(
  '/coverage',
  asyncHandler(async (_req, res) => {
    const out = await tx(async (c) => {
      const dates = await orderableDates(c)
      const grid = []
      for (const date of dates) {
        const pool = await availability(c, date)
        grid.push({
          date,
          slots: (await slotsForDate(c, date)).map(({ id, label, booked, maxBoxes }) => ({ id, label, booked, maxBoxes })),
          stock: allProducts().flatMap((p) => STAGES.map((stage) => ({ sku: p.sku, stage, qty: pool.get(`${p.sku}|${stage}`) ?? 0 }))),
        })
      }
      return grid
    })
    res.json(out)
  }),
)

