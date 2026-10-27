// Staff operations (docs/ops.md), each behind its own switch; a switch that is
// off answers 404, as if its routes did not exist.
//   STOCK_FORECAST          GET /planning/forecast (managers)
//   PURCHASE_RECORDS        /farms, /batches/:id/purchases, /purchases, /analytics/margins
//                           Costs and margins are for managers: other roles get the
//                           records without any money in them, and /purchases and
//                           /analytics/margins refuse them.
//   PANEL_FEATURE_SWITCHES  /settings/switches (managers; a change asks for the
//                           password or two-step code again)
import express from 'express'
import { z } from 'zod'
import { requireManager } from '../auth.js'
import { addDays, isDate, now, todayIST } from '../clock.js'
import { query, tx } from '../db.js'
import { env } from '../env.js'
import { asyncHandler, badRequest, HttpError, notFound, parse } from '../errors.js'
import { forgetSwitches, isOn, knownSwitch, refreshSwitches, saveSwitch, switchable, switchList, switchRefusal } from '../feature-switches.js'
import { stockForecast } from '../forecast.js'
import { newId } from '../ids.js'
import { productName } from '../products.js'
import { auditNow } from '../staff-audit.js'
import { maskPhone } from './customers.js'
import { stepUp } from './step-up.js'

export const router = express.Router()

const gate = (on) => (_req, _res, next) => next(on() ? undefined : notFound())
const isManager = (req) => req.admin.role === 'MANAGER'

// ---------------------------------------------------------------- stock forecast (STOCK_FORECAST)

router.get(
  '/planning/forecast',
  requireManager,
  gate(() => isOn('STOCK_FORECAST')),
  asyncHandler(async (_req, res) => res.json(await stockForecast({ query }, todayIST()))),
)

// ---------------------------------------------------------------- farms (PURCHASE_RECORDS)

const purchasesOn = gate(() => isOn('PURCHASE_RECORDS'))
const PHONE = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, '').replace(/^(\+91|0)/, ''))
  .refine((s) => /^[6-9]\d{9}$/.test(s), 'phone must be a 10-digit Indian mobile number')

const farmBody = z.object({
  name: z.string().trim().min(1, 'name is required').max(120),
  place: z.string().trim().max(120).nullable().optional(),
  contactName: z.string().trim().max(120).nullable().optional(),
  phone: PHONE.nullable().optional(),
  active: z.boolean().optional(),
}).strict()

/** The phone only ever leaves the API masked, for every role. */
const farmView = (f) => ({
  id: f.id, name: f.name, place: f.place, contactName: f.contact_name, phoneMasked: maskPhone(f.phone), hasPhone: Boolean(f.phone),
  active: f.active, createdAt: f.created_at, updatedAt: f.updated_at, purchases: f.purchases ?? 0, lastPurchaseOn: f.last_purchase_on ?? null,
})

const nameTaken = (err) => err?.code === '23505' && err?.constraint === 'idx_farms_name'

router.get(
  '/farms',
  purchasesOn,
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT f.*, COUNT(p.id)::int AS purchases, MAX(p.purchased_on)::text AS last_purchase_on
         FROM farms f LEFT JOIN batch_purchases p ON p.farm_id = f.id GROUP BY f.id ORDER BY f.active DESC, lower(f.name)`,
    )
    res.json(rows.map(farmView))
  }),
)

router.post(
  '/farms',
  requireManager,
  purchasesOn,
  asyncHandler(async (req, res) => {
    const b = parse(farmBody.omit({ active: true }), req.body ?? {})
    try {
      const farm = await tx(async (c) => {
        const at = now()
        const { rows } = await c.query(
          `INSERT INTO farms (id, name, place, contact_name, phone, active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, TRUE, $6, $6) RETURNING *`,
          [newId('frm'), b.name, b.place || null, b.contactName || null, b.phone ?? null, at],
        )
        await auditNow(req, 'farm.create', { target: rows[0].id, detail: { name: b.name, place: b.place ?? null, contactName: b.contactName ?? null, phone: b.phone ? maskPhone(b.phone) : null } }, c)
        return rows[0]
      })
      res.status(201).json(farmView(farm))
    } catch (err) {
      if (nameTaken(err)) throw new HttpError(409, 'FARM_EXISTS', 'A farm with this name is already listed')
      throw err
    }
  }),
)

router.patch(
  '/farms/:id',
  requireManager,
  purchasesOn,
  asyncHandler(async (req, res) => {
    const b = parse(farmBody.partial().refine((x) => Object.keys(x).length > 0, 'Change at least one field'), req.body ?? {})
    try {
      const farm = await tx(async (c) => {
        const { rows } = await c.query('SELECT * FROM farms WHERE id = $1 FOR UPDATE', [req.params.id])
        if (!rows.length) throw notFound('Farm not found')
        const f = rows[0]
        const next = {
          name: b.name ?? f.name,
          place: 'place' in b ? b.place || null : f.place,
          contact_name: 'contactName' in b ? b.contactName || null : f.contact_name,
          phone: 'phone' in b ? b.phone ?? null : f.phone,
          active: b.active ?? f.active,
        }
        const r = await c.query(
          'UPDATE farms SET name = $2, place = $3, contact_name = $4, phone = $5, active = $6, updated_at = $7 WHERE id = $1 RETURNING *',
          [f.id, next.name, next.place, next.contact_name, next.phone, next.active, now()],
        )
        // Before and after, for what changed; phones masked even here.
        const changed = {}
        for (const [k, v] of Object.entries(next)) {
          if (v !== f[k]) changed[k] = k === 'phone' ? { from: maskPhone(f[k]), to: maskPhone(v) } : { from: f[k], to: v }
        }
        await auditNow(req, 'farm.update', { target: f.id, detail: { changed } }, c)
        return r.rows[0]
      })
      res.json(farmView(farm))
    } catch (err) {
      if (nameTaken(err)) throw new HttpError(409, 'FARM_EXISTS', 'A farm with this name is already listed')
      throw err
    }
  }),
)

// ---------------------------------------------------------------- purchases (PURCHASE_RECORDS)

/** Paise. A crate costs something; transport and other costs may be nothing, never less. */
const PAISE = z.number().int('amounts are whole paise').max(1_000_000_000)
const purchaseFields = z.object({
  farmId: z.string().min(1).max(40),
  purchasedOn: z.string().refine(isDate, 'must be a date (YYYY-MM-DD)'),
  crates: z.number().int().positive('crates must be more than 0').max(100_000),
  boxes: z.number().int().positive('boxes must be more than 0').max(100_000),
  costPerCrate: PAISE.positive('cost per crate must be more than 0'),
  transportCost: PAISE.min(0, 'transport cost cannot be negative'),
  otherCost: PAISE.min(0, 'other costs cannot be negative'),
  note: z.string().trim().max(500).nullable().optional(),
}).strict()
/** A new purchase: transport and other costs are 0 when left out. An edit changes only what it names. */
const purchaseBody = purchaseFields.extend({ transportCost: purchaseFields.shape.transportCost.default(0), otherCost: purchaseFields.shape.otherCost.default(0) })

const totalCost = (p) => p.crates * p.cost_per_crate + p.transport_cost + p.other_cost

/** Costs only for managers: the same record, with every money field left out for anyone else. */
function purchaseView(p, manager) {
  const base = {
    id: p.id, batchId: p.batch_id, farmId: p.farm_id, farmName: p.farm_name ?? null, purchasedOn: p.purchased_on,
    crates: p.crates, boxes: p.boxes, note: p.note, createdAt: p.created_at, updatedAt: p.updated_at,
  }
  if (!manager) return base
  const total = totalCost(p)
  return { ...base, costPerCrate: p.cost_per_crate, transportCost: p.transport_cost, otherCost: p.other_cost, totalCost: total, costPerBox: Math.round(total / p.boxes) }
}

/**
 * Boxes the batch received: its intake plus later receiving corrections (a short
 * arrival, boxes counted in on receipt). What its purchases may claim, at most.
 */
async function receivedBoxes(c, batchId) {
  const { rows } = await c.query(
    `SELECT COALESCE(SUM(delta), 0)::int AS n FROM batch_ledger
      WHERE batch_id = $1 AND (event_type = 'INTAKE' OR (event_type = 'ADJUST' AND reason_code IN ('RECEIVED', 'BOX_RECEIVED')))`,
    [batchId],
  )
  return Math.max(0, rows[0].n)
}

const purchaseSelect = 'SELECT p.*, p.purchased_on::text AS purchased_on, f.name AS farm_name FROM batch_purchases p JOIN farms f ON f.id = p.farm_id'

router.get(
  '/batches/:id/purchases',
  purchasesOn,
  asyncHandler(async (req, res) => {
    const { rows: b } = await query('SELECT id FROM batches WHERE id = $1', [req.params.id])
    if (!b.length) throw notFound('Batch not found')
    const [{ rows }, received] = await Promise.all([
      query(`${purchaseSelect} WHERE p.batch_id = $1 ORDER BY p.purchased_on, p.created_at`, [req.params.id]),
      receivedBoxes({ query }, req.params.id),
    ])
    const manager = isManager(req)
    res.json({
      batchId: req.params.id,
      receivedBoxes: received,
      purchasedBoxes: rows.reduce((n, p) => n + p.boxes, 0),
      costsShown: manager,
      items: rows.map((p) => purchaseView(p, manager)),
      ...(manager ? { totalCost: rows.reduce((n, p) => n + totalCost(p), 0) } : {}),
    })
  }),
)

/** Checks the farm and the batch's box count, inside the transaction that saves the purchase. */
async function checkPurchase(c, batchId, b, excludeId = null) {
  if (b.purchasedOn > todayIST()) throw badRequest('purchasedOn cannot be in the future')
  const { rows: farm } = await c.query('SELECT id, active FROM farms WHERE id = $1', [b.farmId])
  if (!farm.length) throw badRequest('Unknown farm', 'INVALID_FARM')
  // The batch row is locked, so two purchases saved at once can't both fit.
  const { rows: batch } = await c.query('SELECT id FROM batches WHERE id = $1 FOR UPDATE', [batchId])
  if (!batch.length) throw notFound('Batch not found')
  const received = await receivedBoxes(c, batchId)
  const { rows } = await c.query('SELECT COALESCE(SUM(boxes), 0)::int AS n FROM batch_purchases WHERE batch_id = $1 AND id IS DISTINCT FROM $2', [batchId, excludeId])
  const others = rows[0].n
  if (others + b.boxes > received) {
    throw new HttpError(
      409,
      'PURCHASE_EXCEEDS_BATCH',
      `This batch received ${received} boxes${others ? ` and its other purchases already account for ${others}` : ''}, so this purchase can claim at most ${Math.max(0, received - others)}.`,
      { receivedBoxes: received, otherPurchaseBoxes: others },
    )
  }
  return farm[0]
}

router.post(
  '/batches/:id/purchases',
  requireManager,
  purchasesOn,
  asyncHandler(async (req, res) => {
    const b = parse(purchaseBody, req.body ?? {})
    const out = await tx(async (c) => {
      const farm = await checkPurchase(c, req.params.id, b)
      if (!farm.active) throw badRequest('This farm is switched off. Switch it on again on the Farms page to record a purchase.', 'FARM_INACTIVE')
      const id = newId('pur')
      await c.query(
        `INSERT INTO batch_purchases (id, batch_id, farm_id, purchased_on, crates, boxes, cost_per_crate, transport_cost, other_cost, note, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [id, req.params.id, b.farmId, b.purchasedOn, b.crates, b.boxes, b.costPerCrate, b.transportCost, b.otherCost, b.note || null, req.admin.id, now()],
      )
      await auditNow(req, 'purchase.create', { target: `${req.params.id}/${id}`, detail: { ...b } }, c)
      return (await c.query(`${purchaseSelect} WHERE p.id = $1`, [id])).rows[0]
    })
    res.status(201).json(purchaseView(out, true))
  }),
)

router.patch(
  '/batches/:id/purchases/:purchaseId',
  requireManager,
  purchasesOn,
  asyncHandler(async (req, res) => {
    const patch = parse(purchaseFields.partial().refine((x) => Object.keys(x).length > 0, 'Change at least one field'), req.body ?? {})
    const out = await tx(async (c) => {
      const { rows } = await c.query('SELECT * FROM batch_purchases WHERE id = $1 AND batch_id = $2 FOR UPDATE', [req.params.purchaseId, req.params.id])
      if (!rows.length) throw notFound('Purchase not found')
      const p = rows[0]
      const cur = {
        farmId: p.farm_id, purchasedOn: p.purchased_on, crates: p.crates, boxes: p.boxes, costPerCrate: p.cost_per_crate,
        transportCost: p.transport_cost, otherCost: p.other_cost, note: p.note,
      }
      const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) }
      await checkPurchase(c, req.params.id, next, p.id)
      await c.query(
        `UPDATE batch_purchases SET farm_id = $2, purchased_on = $3, crates = $4, boxes = $5, cost_per_crate = $6, transport_cost = $7, other_cost = $8,
                note = $9, updated_by = $10, updated_at = $11 WHERE id = $1`,
        [p.id, next.farmId, next.purchasedOn, next.crates, next.boxes, next.costPerCrate, next.transportCost, next.otherCost, next.note || null, req.admin.id, now()],
      )
      const changed = Object.fromEntries(Object.keys(next).filter((k) => next[k] !== cur[k]).map((k) => [k, { from: cur[k], to: next[k] }]))
      await auditNow(req, 'purchase.update', { target: `${req.params.id}/${p.id}`, detail: { changed } }, c)
      return (await c.query(`${purchaseSelect} WHERE p.id = $1`, [p.id])).rows[0]
    })
    res.json(purchaseView(out, true))
  }),
)

// ---------------------------------------------------------------- purchase list and margins (managers)

const RANGE_MAX_DAYS = 366
function range(q) {
  const to = q.to === undefined ? todayIST() : q.to
  const from = q.from === undefined ? addDays(to, -89) : q.from
  if (!isDate(from) || !isDate(to)) throw badRequest('from and to must be dates (YYYY-MM-DD)')
  if (from > to) throw badRequest('from must be on or before to')
  if (addDays(from, RANGE_MAX_DAYS) < to) throw badRequest(`Choose at most ${RANGE_MAX_DAYS} days`)
  return { from, to }
}

router.get(
  '/purchases',
  requireManager,
  purchasesOn,
  asyncHandler(async (req, res) => {
    const { from, to } = range(req.query)
    const farmId = typeof req.query.farmId === 'string' && req.query.farmId ? req.query.farmId : null
    const { rows } = await query(
      `${purchaseSelect} WHERE p.purchased_on BETWEEN $1 AND $2 AND ($3::text IS NULL OR p.farm_id = $3) ORDER BY p.purchased_on DESC, p.created_at DESC LIMIT 500`,
      [from, to, farmId],
    )
    res.json({ from, to, items: rows.map((p) => purchaseView(p, true)) })
  }),
)

/** Orders whose boxes count as sold: paid, not cancelled. */
const SOLD = ['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RTO']

/**
 * Margin per box and per variety for batches bought in the range. A batch's cost is
 * spread evenly over the boxes its purchases name; each box sold from it brings what
 * the customer paid for it (the box price less its share of the order's promo
 * discount; a free replacement brings nothing). margin = revenue - cost of the boxes sold.
 * Boxes not sold (yet, or lost) are shown with their cost separately.
 */
router.get(
  '/analytics/margins',
  requireManager,
  purchasesOn,
  asyncHandler(async (req, res) => {
    const { from, to } = range(req.query)
    const { rows } = await query(
      `WITH p AS (
         SELECT batch_id, SUM(boxes)::int AS boxes, SUM(crates::bigint * cost_per_crate + transport_cost + other_cost)::bigint AS cost
           FROM batch_purchases WHERE purchased_on BETWEEN $1 AND $2 GROUP BY batch_id
       ), s AS (
         SELECT os.batch_id, os.sku, SUM(os.quantity)::int AS boxes,
                COALESCE(SUM(os.quantity * i.unit_price * CASE WHEN o.subtotal > 0 THEN (o.subtotal - o.discount)::numeric / o.subtotal ELSE 0 END), 0) AS revenue
           FROM order_stock os
           JOIN orders o ON o.id = os.order_id
           LEFT JOIN LATERAL (SELECT unit_price FROM order_items WHERE order_id = os.order_id AND sku = os.sku AND (stage = os.stage OR stage IS NULL) LIMIT 1) i ON TRUE
          WHERE os.batch_id IN (SELECT batch_id FROM p) AND os.state IN ('committed', 'packed') AND o.status = ANY($3)
          GROUP BY os.batch_id, os.sku
       )
       SELECT b.id, b.variety, b.plucked_on::text AS plucked_on, b.status, p.boxes, p.cost, s.sku, COALESCE(s.boxes, 0)::int AS sold, COALESCE(s.revenue, 0)::numeric AS revenue
         FROM p JOIN batches b ON b.id = p.batch_id LEFT JOIN s ON s.batch_id = p.batch_id
        ORDER BY b.variety, b.plucked_on, b.id, s.sku`,
      [from, to, SOLD],
    )
    const batches = new Map()
    for (const r of rows) {
      const b = batches.get(r.id) ?? { batchId: r.id, variety: r.variety, pluckedOn: r.plucked_on, status: r.status, boughtBoxes: r.boxes, totalCost: Number(r.cost), soldBoxes: 0, revenue: 0, bySku: [] }
      if (r.sku) {
        b.soldBoxes += r.sold
        b.revenue += Number(r.revenue)
        b.bySku.push({ sku: r.sku, productName: productName(r.sku), soldBoxes: r.sold, revenue: Math.round(Number(r.revenue)) })
      }
      batches.set(r.id, b)
    }
    const finish = (x) => {
      const costPerBox = x.boughtBoxes ? x.totalCost / x.boughtBoxes : 0
      const costOfSold = Math.round(costPerBox * Math.min(x.soldBoxes, x.boughtBoxes) + costPerBox * Math.max(0, x.soldBoxes - x.boughtBoxes))
      const revenue = Math.round(x.revenue)
      return {
        ...x, revenue, costPerBox: Math.round(costPerBox), costOfSold, margin: revenue - costOfSold,
        marginPerBox: x.soldBoxes ? Math.round((revenue - costOfSold) / x.soldBoxes) : null,
        unsoldBoxes: Math.max(0, x.boughtBoxes - x.soldBoxes), costOfUnsold: Math.max(0, x.totalCost - costOfSold),
      }
    }
    const list = [...batches.values()].map(finish)
    const varieties = new Map()
    for (const b of list) {
      const v = varieties.get(b.variety) ?? { variety: b.variety, batches: 0, boughtBoxes: 0, totalCost: 0, soldBoxes: 0, revenue: 0, costOfSold: 0 }
      v.batches += 1
      v.boughtBoxes += b.boughtBoxes
      v.totalCost += b.totalCost
      v.soldBoxes += b.soldBoxes
      v.revenue += b.revenue
      v.costOfSold += b.costOfSold
      varieties.set(b.variety, v)
    }
    res.json({
      from, to,
      varieties: [...varieties.values()].map((v) => ({
        ...v, margin: v.revenue - v.costOfSold, marginPerBox: v.soldBoxes ? Math.round((v.revenue - v.costOfSold) / v.soldBoxes) : null,
        costPerBox: v.boughtBoxes ? Math.round(v.totalCost / v.boughtBoxes) : null, unsoldBoxes: Math.max(0, v.boughtBoxes - v.soldBoxes), costOfUnsold: Math.max(0, v.totalCost - v.costOfSold),
      })),
      batches: list,
    })
  }),
)

// ---------------------------------------------------------------- feature switches (PANEL_FEATURE_SWITCHES)

const switchesOn = gate(() => env.PANEL_FEATURE_SWITCHES)

router.get(
  '/settings/switches',
  requireManager,
  switchesOn,
  asyncHandler(async (_req, res) => {
    await refreshSwitches({ force: true })
    res.json({ cacheSeconds: 30, items: switchList() })
  }),
)

router.put(
  '/settings/switches/:key',
  requireManager,
  switchesOn,
  asyncHandler(async (req, res) => {
    const key = String(req.params.key)
    // Only the allowlist; anything else (security, payments, refunds, stock safeguards) is never changed here.
    if (!switchable(key) || !knownSwitch(key)) throw new HttpError(403, 'NOT_SWITCHABLE', 'This switch cannot be changed from the panel')
    const { enabled } = parse(z.object({ enabled: z.boolean().nullable(), confirmCode: z.string().max(200).optional() }).strict(), req.body ?? {})
    // Checked before the password or code is spent, so a refused change doesn't use up a code.
    await refreshSwitches({ force: true })
    const refused = switchRefusal(key, enabled)
    if (refused) throw refused
    await stepUp(req, { always: true })
    await tx(async (c) => {
      const { before, previousOverride } = await saveSwitch(c, key, enabled, req.admin.email)
      await auditNow(req, 'feature_switch.set', { target: key, detail: { key, override: { from: previousOverride, to: enabled }, effectiveBefore: before } }, c)
    })
    forgetSwitches()
    await refreshSwitches({ force: true })
    const item = switchList().find((s) => s.key === key)
    res.json(item)
  }),
)
