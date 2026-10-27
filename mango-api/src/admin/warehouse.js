// Warehouse and box traceability routes (docs/warehouse/API.md). Hidden
// (404) unless WAREHOUSE_V2=true. access.js lists each route for the roles
// holding its permission (warehouse/permissions.js WAREHOUSE_ROUTES); routes
// whose permission only managers hold also carry requireManager here.
import { createHash } from 'node:crypto'
import express from 'express'
import { z } from 'zod'
import { requireManager } from '../auth.js'
import { isDate, now } from '../clock.js'
import { query, tx } from '../db.js'
import { env } from '../env.js'
import { asyncHandler, notFound, parse } from '../errors.js'
import { newId } from '../ids.js'
import { loadProducts } from '../products.js'
import {
  addManualHold, boxEvents, boxIn, boxView, createLocation, decideWriteOff, listLocations, listWriteOffs, LOCATION_TYPES, measureBox, putAwayLot, qcLot,
  reissueLabel, releaseManualHold, reprintBox, requestWriteOff, resolveCode, restockReturned, updateLocation, WRITE_OFF_LIMIT, WRITE_OFF_REASONS,
} from '../warehouse/boxes.js'
import { HOLD_KINDS, readBox, whError } from '../warehouse/core.js'
import { boxLabel, labelsPdf, labelSize, locationLabel } from '../warehouse/labels.js'
import {
  addBoxes, checkIntake, closeLot, confirmCount, CONTINUE_CHUNK, correctLot, createLot, generateMore, lockLot, lotView, SINGLE_TX_LIMIT, voidBoxes, voidLot,
} from '../warehouse/lots.js'
import { cancelOperation, finalizeOperation, getOperation, listOperations, OP_TYPES, opTypeOn, startOperation, submitScans, undoLastScan, unstageBoxes } from '../warehouse/ops.js'
import { can, effectivePermissions, featureOn, managerOnly, routeFeature, WAREHOUSE_ROUTES } from '../warehouse/permissions.js'
import { DAMAGE_REASONS, getRepack, listRepacks, MAX_OUTPUTS, recordDamage, REPACK_PLACES, REPACK_REASONS, repackOutputsForLabels } from '../warehouse/repack.js'
import { decideStocktakeReview, getStocktake, listStocktakes, reviewStocktake } from '../warehouse/stocktake.js'
import {
  continueRecall, EXPORTS, exceptions, exportReport, listProductSettings, listRecalls, overview, pickList, pickQueue, reconciliation, recallView, releaseRecall,
  startRecall, traceBox, traceLot, updateProductSettings,
} from '../warehouse/reports.js'

export const router = express.Router()

/**
 * Off unless WAREHOUSE_V2: every warehouse path is a plain 404, before sign-in
 * checks, so nothing about it shows. Stocktake and repack routes are also 404
 * while their own flag (WAREHOUSE_STOCKTAKE, WAREHOUSE_REPACK) is off.
 */
export function warehouseGate(req, _res, next) {
  if (!(req.path === '/warehouse' || req.path.startsWith('/warehouse/'))) return next()
  if (!env.WAREHOUSE_V2) return next(notFound())
  const feature = routeFeature(req.path)
  if (feature && !featureOn(feature, env)) return next(notFound())
  next()
}

/** Who is acting, in which warehouse (admin_users.warehouse_id, D9). */
const who = asyncHandler(async (req, _res, next) => {
  const { rows } = await query('SELECT warehouse_id FROM admin_users WHERE id = $1', [req.admin.id])
  req.wh = { actor: req.actor, role: req.admin.role, warehouseId: rows[0]?.warehouse_id ?? 'wh_main', requestId: req.id }
  next()
})
router.use('/warehouse', who)

// Every route the table lists, and no other: a route here that the table misses fails the access tests.
const PERM = new Map(WAREHOUSE_ROUTES.map(([m, p, perm]) => [`${m} ${p}`, perm]))
const guard = (method, path) => {
  const perm = PERM.get(`${method} ${path}`)
  if (!perm) throw new Error(`warehouse route ${method} ${path} is not in WAREHOUSE_ROUTES`)
  const check = (req, _res, next) => next(can(req.admin.role, perm) ? undefined : whError('FORBIDDEN', 'Your role cannot do this in the warehouse.', 403))
  return managerOnly(perm) ? [requireManager, check] : [check]
}
const get = (path, fn) => router.get(path, ...guard('GET', path), asyncHandler(fn))
const post = (path, fn) => router.post(path, ...guard('POST', path), asyncHandler(fn))
const patch = (path, fn) => router.patch(path, ...guard('PATCH', path), asyncHandler(fn))

const reason = z.string().trim().min(1, 'Give a reason').max(300)
const day = z.string().refine(isDate, 'Use a YYYY-MM-DD date')
const uuid = z.string().uuid()
const pdf = (res, name, bytes) => {
  res.set('Content-Type', 'application/pdf')
  res.set('Content-Disposition', `inline; filename="${name}"`)
  res.set('Cache-Control', 'no-store')
  res.send(bytes)
}

// ---------------------------------------------------------------- overview and settings

get('/warehouse/overview', async (req, res) => res.json(await overview({ query }, req.wh.warehouseId)))

get('/warehouse/settings', async (req, res) => {
  const { rows } = await query('SELECT id, name, active FROM warehouses WHERE id = $1', [req.wh.warehouseId])
  const mine = effectivePermissions(req.admin.role, env)
  res.json({
    enabled: true, warehouse: rows[0], permissions: mine, labelMm: labelSize(), writeOffLimit: WRITE_OFF_LIMIT, writeOffReasons: WRITE_OFF_REASONS,
    locationTypes: LOCATION_TYPES, holdKinds: HOLD_KINDS, operationTypes: OP_TYPES.filter(opTypeOn), idleMinutes: env.WAREHOUSE_OP_IDLE_MINUTES, maxLot: env.WAREHOUSE_MAX_LOT,
    features: { stocktake: env.WAREHOUSE_STOCKTAKE, repack: env.WAREHOUSE_REPACK, cameraScan: env.WAREHOUSE_CAMERA_SCAN },
    repackReasons: REPACK_REASONS, repackPlaces: REPACK_PLACES, damageReasons: DAMAGE_REASONS,
  })
})

get('/warehouse/products', async (_req, res) => res.json(await listProductSettings({ query })))

const productPatch = z.object({
  boxTrackingEnabled: z.boolean().optional(),
  nominalWeightG: z.number().int().min(1).max(100_000).nullable().optional(),
  weightTolerancePct: z.number().min(0).max(50).optional(),
  requiresQc: z.boolean().optional(),
  restockableReturns: z.boolean().optional(),
  shelfLifeDays: z.number().int().min(1).max(365).nullable().optional(),
  qcChecklist: z.array(z.string().trim().regex(/^[A-Z_]{2,30}$/, 'Reason codes are CAPITALS_AND_UNDERSCORES')).min(1).max(20).optional(),
}).strict()

patch('/warehouse/products/:sku', async (req, res) => {
  const b = parse(productPatch, req.body ?? {})
  const out = await tx((c) => updateProductSettings(c, req.params.sku, b, req.wh))
  req.audited = true
  await loadProducts()
  res.json(out)
})

// ---------------------------------------------------------------- lots

const intake = z.object({
  sku: z.string().min(1).max(40),
  expectedCount: z.number().int().min(1),
  nominalWeightG: z.number().int().min(1).max(100_000).optional(),
  harvestedOn: day,
  receivedOn: day.optional(),
  supplier: z.string().trim().max(120).optional(),
  qcNotes: z.string().trim().max(1000).optional(),
  batchId: z.string().max(40).optional(),
  legacy: z.boolean().optional(),
}).strict()

post('/warehouse/lots/preview', (req, res) => {
  const b = parse(intake, req.body ?? {})
  const k = checkIntake(b)
  res.json({
    sku: k.product.sku, productName: k.product.name, boxes: b.expectedCount, nominalWeightG: k.nominalWeightG, totalKg: (b.expectedCount * k.nominalWeightG) / 1000,
    harvestedOn: k.pluckedOn, receivedOn: k.receivedOn, bestBefore: k.bestBefore, requiresQc: k.product.requiresQc !== false,
    chunked: b.expectedCount > SINGLE_TX_LIMIT, labelMm: labelSize(),
  })
})

const hashOf = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex')

/**
 * Creates a lot and its boxes. An Idempotency-Key header makes a retry (a
 * double tap, a dropped connection) return the same lot instead of a second one.
 */
post('/warehouse/lots', async (req, res) => {
  const b = parse(intake, req.body ?? {})
  const checked = checkIntake(b)
  const raw = req.get('Idempotency-Key')
  if (raw !== undefined && !/^[A-Za-z0-9_-]{8,80}$/.test(raw)) throw whError('VALIDATION_ERROR', 'Idempotency-Key must be 8 to 80 letters, digits, - or _', 400)
  const key = raw ? `wh-lot:${req.admin.id}:${raw}` : null
  const hash = hashOf(b)
  const out = await tx(async (c) => {
    if (key) {
      const ins = await c.query('INSERT INTO idempotency_keys (key, order_id, created_at, request_hash) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [key, 'pending', now(), hash])
      if (!ins.rowCount) {
        const prior = (await c.query('SELECT order_id, request_hash FROM idempotency_keys WHERE key = $1', [key])).rows[0]
        if (prior.request_hash !== hash) throw whError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used for a different intake', 422)
        const lot = (await c.query('SELECT * FROM box_lots WHERE id = $1', [prior.order_id])).rows[0]
        if (!lot) throw whError('CONFLICT', 'The first request with this key is still running. Try again in a moment.')
        return { lot, replayed: true }
      }
    }
    const id = await createLot(c, b, checked, req.actor, req.wh.warehouseId)
    if (key) await c.query('UPDATE idempotency_keys SET order_id = $2 WHERE key = $1', [key, id])
    return { lot: (await c.query('SELECT * FROM box_lots WHERE id = $1', [id])).rows[0], replayed: false }
  })
  res.status(out.replayed ? 200 : 201).json(lotView(out.lot, { replayed: out.replayed }))
})

get('/warehouse/lots', async (req, res) => {
  const status = req.query.status ? parse(z.enum(['generating', 'receiving', 'received', 'closed', 'voided']), req.query.status) : null
  const { rows } = await query(
    `SELECT * FROM box_lots WHERE warehouse_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC LIMIT 200`,
    [req.wh.warehouseId, status],
  )
  res.json(rows.map((l) => lotView(l)))
})

get('/warehouse/lots/:id', async (req, res) => {
  const { rows } = await query('SELECT * FROM box_lots WHERE id = $1 AND warehouse_id = $2', [req.params.id, req.wh.warehouseId])
  if (!rows.length) throw notFound('Lot not found')
  const { rows: states } = await query(
    `SELECT lifecycle, quality, count(*)::int AS n, count(*) FILTER (WHERE box_shelf_sellable(id))::int AS sellable FROM boxes WHERE lot_id = $1 GROUP BY lifecycle, quality`,
    [rows[0].id],
  )
  res.json(lotView(rows[0], { states, sellable: states.reduce((n, s) => n + s.sellable, 0) }))
})

post('/warehouse/lots/:id/continue', async (req, res) => {
  await tx((c) => lockLot(c, req.params.id, req.wh.warehouseId))
  const lot = await tx((c) => generateMore(c, req.params.id, req.actor, CONTINUE_CHUNK))
  res.json(lotView(lot))
})

const LABELS_PER_PDF = 1000
get('/warehouse/lots/:id/labels.pdf', async (req, res) => {
  const { rows } = await query('SELECT * FROM box_lots WHERE id = $1 AND warehouse_id = $2', [req.params.id, req.wh.warehouseId])
  const lot = rows[0]
  if (!lot) throw notFound('Lot not found')
  const from = req.query.from ? parse(z.coerce.number().int().min(1), req.query.from) : 1
  const to = req.query.to ? parse(z.coerce.number().int().min(from), req.query.to) : from + LABELS_PER_PDF - 1
  if (to - from + 1 > LABELS_PER_PDF) throw whError('VALIDATION_ERROR', `At most ${LABELS_PER_PDF} labels per file: print in parts`, 400)
  const layout = req.query.layout === 'a4' ? 'a4' : 'roll'
  const { rows: boxes } = await query(
    `SELECT b.*, l.received_on FROM boxes b JOIN box_lots l ON l.id = b.lot_id WHERE b.lot_id = $1 AND b.seq BETWEEN $2 AND $3 AND b.lifecycle <> 'voided' ORDER BY b.seq`,
    [lot.id, from, to],
  )
  if (!boxes.length) throw whError('NOT_FOUND', 'No labels in that range', 404)
  pdf(res, `${lot.code}-${from}-${to}.pdf`, labelsPdf(boxes.map((b) => boxLabel(b, lot.code)), { layout }))
})

const lotAction = (fn) => async (req, res) => {
  const out = await tx(async (c) => fn(c, await lockLot(c, req.params.id, req.wh.warehouseId), req))
  res.json(out?.code && out?.status ? lotView(out) : out)
}

post('/warehouse/lots/:id/confirm-count', lotAction((c, lot, req) => {
  const b = parse(z.object({ count: z.number().int().min(1).max(20_000), locationId: z.string().max(40).optional(), reason }).strict(), req.body ?? {})
  return confirmCount(c, lot, b, req.actor)
}))

post('/warehouse/lots/:id/add-boxes', lotAction((c, lot, req) => addBoxes(c, lot, parse(z.object({ count: z.number().int().min(1).max(5000), reason }).strict(), req.body ?? {}), req.actor)))

post('/warehouse/lots/:id/void-boxes', lotAction((c, lot, req) => {
  const b = parse(z.object({ count: z.number().int().min(1).max(20_000).optional(), boxIds: z.array(uuid).min(1).max(500).optional(), reason }).strict()
    .refine((x) => Boolean(x.count) !== Boolean(x.boxIds), 'Give either a count or the boxes'), req.body ?? {})
  return voidBoxes(c, lot, b, req.actor)
}))

patch('/warehouse/lots/:id', lotAction(async (c, lot, req) => {
  const b = parse(z.object({ supplier: z.string().trim().max(120).optional(), sku: z.string().max(40).optional(), reason }).strict(), req.body ?? {})
  const r = await correctLot(c, lot, b, req.actor)
  if (r.changes.length) {
    await c.query(
      `INSERT INTO staff_audit (id, admin_id, email, role, action, target, detail, request_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [newId('aud'), req.admin.id, req.admin.email, req.admin.role, 'PATCH /warehouse/lots/:id', lot.id, { changes: r.changes, reason: b.reason }, req.id ?? null, now()],
    )
    req.audited = true
  }
  return { ...lotView((await c.query('SELECT * FROM box_lots WHERE id = $1', [lot.id])).rows[0]), ...r }
}))

post('/warehouse/lots/:id/close', lotAction((c, lot) => closeLot(c, lot)))
post('/warehouse/lots/:id/void', lotAction((c, lot, req) => voidLot(c, lot, parse(z.object({ reason }).strict(), req.body ?? {}), req.actor)))
post('/warehouse/lots/:id/qc', lotAction((c, lot, req) => {
  const b = parse(z.object({ result: z.literal('passed'), exceptBoxIds: z.array(uuid).max(5000).optional(), note: z.string().trim().max(300).optional() }).strict(), req.body ?? {})
  return qcLot(c, lot, { exceptBoxIds: b.exceptBoxIds ?? [], note: b.note ?? null }, req.wh)
}))
post('/warehouse/lots/:id/put-away', lotAction((c, lot, req) => {
  const b = parse(z.object({ locationId: z.string().min(1).max(40), fromLocationId: z.string().max(40).optional() }).strict(), req.body ?? {})
  return putAwayLot(c, lot, b, req.wh)
}))

// ---------------------------------------------------------------- boxes

const LIFECYCLES = ['generated', 'in_stock', 'picked', 'packed', 'dispatched', 'returned', 'missing', 'voided', 'disposed', 'repacked']
get('/warehouse/boxes', async (req, res) => {
  const q = parse(z.object({
    lotId: z.string().max(40).optional(), locationId: z.string().max(40).optional(), orderId: z.string().max(40).optional(),
    lifecycle: z.enum(LIFECYCLES).optional(), quality: z.enum(['pending', 'passed', 'failed', 'needs_review']).optional(), held: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(), after: z.string().max(20).optional(),
  }), req.query)
  const { rows } = await query(
    `SELECT b.*, l.type AS location_type, l.name AS location_name,
            (SELECT coalesce(array_agg(h.kind ORDER BY h.kind), '{}') FROM box_holds h WHERE h.box_id = b.id AND h.released_at IS NULL) AS holds
       FROM boxes b LEFT JOIN wh_locations l ON l.id = b.location_id
      WHERE b.warehouse_id = $1 AND ($2::text IS NULL OR b.lot_id = $2) AND ($3::text IS NULL OR b.location_id = $3) AND ($4::text IS NULL OR b.order_id = $4)
        AND ($5::text IS NULL OR b.lifecycle = $5) AND ($6::text IS NULL OR b.quality = $6)
        AND ($7::boolean IS NULL OR EXISTS (SELECT 1 FROM box_holds h WHERE h.box_id = b.id AND h.released_at IS NULL) = $7)
        AND ($8::text IS NULL OR b.code > $8)
      ORDER BY b.code LIMIT $9`,
    [req.wh.warehouseId, q.lotId ?? null, q.locationId ?? null, q.orderId ?? null, q.lifecycle ?? null, q.quality ?? null, q.held ? q.held === 'true' : null, q.after ?? null, q.limit ?? 100],
  )
  res.json({ boxes: rows.map((b) => boxView(b)), next: rows.length === (q.limit ?? 100) ? rows.at(-1).code : null })
})

post('/warehouse/resolve', async (req, res) => {
  const b = parse(z.object({ input: z.string().max(128) }).strict(), req.body ?? {})
  res.json(await resolveCode({ query }, b.input, req.wh.warehouseId))
})

get('/warehouse/boxes/:id', async (req, res) => {
  const box = await boxIn({ query }, req.params.id, req.wh.warehouseId)
  const lot = (await query('SELECT code FROM box_lots WHERE id = $1', [box.lot_id])).rows[0]
  const order = box.order_id ? (await query('SELECT number, status FROM orders WHERE id = $1', [box.order_id])).rows[0] : null
  const sellable = (await query('SELECT box_shelf_sellable($1) AS s', [box.id])).rows[0].s
  res.json(boxView(box, { lotCode: lot?.code, orderNumber: order?.number ?? null, orderStatus: order?.status ?? null, sellable }))
})

get('/warehouse/boxes/:id/events', async (req, res) => {
  const box = await boxIn({ query }, req.params.id, req.wh.warehouseId)
  const before = req.query.before ? parse(z.string().datetime({ offset: true }), req.query.before) : null
  res.json(await boxEvents({ query }, box.id, { before, limit: req.query.limit }))
})

const boxAction = (fn) => async (req, res) => {
  const out = await tx(async (c) => fn(c, await boxIn(c, req.params.id, req.wh.warehouseId, { lock: true }), req))
  res.json(out)
}

post('/warehouse/boxes/:id/reprint', boxAction(async (c, box, req) => {
  const b = parse(z.object({ reason }).strict(), req.body ?? {})
  const after = await reprintBox(c, box, b, req.wh)
  return boxView(await readBox(c, after.id))
}))
post('/warehouse/boxes/:id/reissue', boxAction(async (c, box, req) => {
  const after = await reissueLabel(c, box, parse(z.object({ reason }).strict(), req.body ?? {}), req.wh)
  return boxView(await readBox(c, after.id))
}))
get('/warehouse/boxes/:id/label.pdf', async (req, res) => {
  const box = await boxIn({ query }, req.params.id, req.wh.warehouseId)
  const lot = (await query('SELECT code, received_on FROM box_lots WHERE id = $1', [box.lot_id])).rows[0]
  pdf(res, `${box.code}.pdf`, labelsPdf([boxLabel({ ...box, received_on: lot.received_on }, lot.code)], { layout: req.query.layout === 'a4' ? 'a4' : 'roll' }))
})
post('/warehouse/boxes/:id/holds', boxAction((c, box, req) => addManualHold(c, box, parse(z.object({ kind: z.enum(HOLD_KINDS), reason }).strict(), req.body ?? {}), req.wh)))
post('/warehouse/boxes/:id/holds/:kind/release', boxAction(async (c, box, req) => {
  await releaseManualHold(c, box, req.params.kind, parse(z.object({ reason }).strict(), req.body ?? {}), req.wh)
  return boxView(await readBox(c, box.id))
}))
post('/warehouse/boxes/:id/measure', boxAction(async (c, box, req) => {
  const b = parse(z.object({ weightG: z.number().int().min(1).max(100_000), fruitCount: z.number().int().min(1).max(200).optional() }).strict(), req.body ?? {})
  const r = await measureBox(c, box, b, req.wh)
  return { box: boxView(await readBox(c, box.id)), outOfTolerance: r.outOfTolerance, shortfall: r.shortfall }
}))
post('/warehouse/boxes/:id/restock', boxAction(async (c, box, req) => {
  await restockReturned(c, box, parse(z.object({ reason }).strict(), req.body ?? {}), req.wh)
  return boxView(await readBox(c, box.id))
}))
post('/warehouse/boxes/:id/damage', boxAction(async (c, box, req) => {
  const b = parse(z.object({
    fruitRemoved: z.number().int().min(0).max(200).optional(), weightLostG: z.number().int().min(0).max(100_000).optional(), reasonCode: z.enum(DAMAGE_REASONS), reason,
  }).strict(), req.body ?? {})
  const r = await recordDamage(c, box, b, req.wh)
  return { box: boxView(await readBox(c, box.id)), belowTolerance: r.belowTolerance, needsReview: r.needsReview, shortfall: r.shortfall }
}))

// ---------------------------------------------------------------- write-offs

post('/warehouse/write-offs', async (req, res) => {
  const b = parse(z.object({ boxIds: z.array(uuid).min(1).max(500), reasonCode: z.enum(WRITE_OFF_REASONS), reason }).strict(), req.body ?? {})
  const out = await tx((c) => requestWriteOff(c, b, req.wh))
  res.status(out.status === 'pending' ? 202 : 200).json(out)
})
get('/warehouse/write-offs', async (req, res) => {
  const status = req.query.status ? parse(z.enum(['pending', 'applied', 'rejected']), req.query.status) : null
  res.json(await listWriteOffs({ query }, req.wh, status))
})
post('/warehouse/write-offs/:id/approve', async (req, res) => res.json(await tx((c) => decideWriteOff(c, req.params.id, true, req.wh))))
post('/warehouse/write-offs/:id/reject', async (req, res) => res.json(await tx((c) => decideWriteOff(c, req.params.id, false, req.wh))))

// ---------------------------------------------------------------- locations

get('/warehouse/locations', async (req, res) => res.json(await listLocations({ query }, req.wh.warehouseId)))
const locationBody = z.object({ zone: z.string().trim().max(40).optional(), name: z.string().trim().min(1).max(60), type: z.enum(LOCATION_TYPES) }).strict()
post('/warehouse/locations', async (req, res) => res.status(201).json(await tx((c) => createLocation(c, parse(locationBody, req.body ?? {}), req.wh))))
patch('/warehouse/locations/:id', async (req, res) => {
  const b = parse(locationBody.partial().extend({ active: z.boolean().optional() }).strict(), req.body ?? {})
  res.json(await tx((c) => updateLocation(c, req.params.id, b, req.wh)))
})
get('/warehouse/locations/:id/label.pdf', async (req, res) => {
  const { rows } = await query('SELECT * FROM wh_locations WHERE id = $1 AND warehouse_id = $2', [req.params.id, req.wh.warehouseId])
  if (!rows.length) throw notFound('Location not found')
  pdf(res, `location-${rows[0].name.replace(/[^\w-]+/g, '_')}.pdf`, labelsPdf([locationLabel(rows[0])], { layout: req.query.layout === 'a4' ? 'a4' : 'roll' }))
})

// ---------------------------------------------------------------- scan sessions

get('/warehouse/operations', async (req, res) => {
  const status = req.query.status ? parse(z.enum(['open', 'completed', 'cancelled', 'expired', 'failed']), req.query.status) : null
  res.json(await listOperations({ query }, req.wh, { mine: req.query.all !== 'true' || !can(req.admin.role, 'adjust.approve'), status, limit: req.query.limit }))
})
post('/warehouse/operations', async (req, res) => {
  const b = parse(z.object({ type: z.enum(OP_TYPES), context: z.record(z.string(), z.unknown()).optional() }).strict(), req.body ?? {})
  res.status(201).json(await tx((c) => startOperation(c, b, req.wh)))
})
get('/warehouse/operations/:id', async (req, res) => res.json(await tx((c) => getOperation(c, req.params.id, req.wh))))

const scanBody = z.object({
  scans: z.array(z.object({
    scanId: uuid, input: z.string().max(128), clientScannedAt: z.string().max(40).optional(), reason: z.string().trim().max(300).optional(),
    weightG: z.number().int().min(1).max(100_000).optional(),
  }).strict()).min(1).max(50),
}).strict()
post('/warehouse/operations/:id/scans', async (req, res) => {
  const b = parse(scanBody, req.body ?? {})
  res.json({ results: await submitScans(req.params.id, b.scans, req.wh) })
})
post('/warehouse/operations/:id/undo', async (req, res) => res.json(await tx((c) => undoLastScan(c, req.params.id, req.wh))))
// A repack's finish says what came out; other sessions send no body.
const finalizeBody = z.object({
  outputs: z.array(z.object({ weightG: z.number().int().min(1).max(100_000), fruitCount: z.number().int().min(1).max(200).optional() }).strict()).min(1).max(MAX_OUTPUTS).optional(),
  fruitRemoved: z.number().int().min(0).max(10_000).optional(),
  weightLostG: z.number().int().min(0).max(1_000_000).optional(),
  note: z.string().trim().max(200).optional(),
}).strict()
post('/warehouse/operations/:id/finalize', async (req, res) => {
  const b = parse(finalizeBody, req.body ?? {})
  try {
    res.json(await tx((c) => finalizeOperation(c, req.params.id, req.wh, b)))
  } catch (err) {
    // A box that changed since it was scanned (or whose batch was condemned) is taken out of the session; the refused finish rolled back.
    const unstage = ['STALE_SCAN', 'BATCH_OUT_OF_SERVICE'].includes(err?.code) ? err.extra?.unstage : null
    if (Array.isArray(unstage) && unstage.length) {
      await tx((c) => unstageBoxes(c, req.params.id, unstage, req.wh))
      delete err.extra.unstage
    }
    throw err
  }
})
post('/warehouse/operations/:id/cancel', async (req, res) => res.json(await tx((c) => cancelOperation(c, req.params.id, req.wh))))

get('/warehouse/orders/:id/pick-list', async (req, res) => res.json(await pickList({ query }, req.params.id, req.wh.warehouseId)))
get('/warehouse/pick-queue', async (req, res) => {
  const date = req.query.date ? parse(day, req.query.date) : null
  res.json(await pickQueue({ query }, { date }))
})

// ---------------------------------------------------------------- reports, trace, recalls

get('/warehouse/exceptions', async (req, res) => res.json(await exceptions({ query }, req.wh.warehouseId)))
get('/warehouse/reconciliation', async (req, res) => res.json(await reconciliation({ query }, req.wh.warehouseId)))
get('/warehouse/trace/boxes/:id', async (req, res) => {
  const box = await boxIn({ query }, req.params.id, req.wh.warehouseId)
  res.json(await traceBox({ query }, box, req.wh))
})
get('/warehouse/trace/lots/:id', async (req, res) => res.json(await traceLot({ query }, req.params.id, req.wh)))
get('/warehouse/recalls', async (req, res) => res.json(await listRecalls({ query }, req.wh)))
post('/warehouse/recalls', async (req, res) => {
  const b = parse(z.object({ lotIds: z.array(z.string().max(40)).min(1).max(50), reason }).strict(), req.body ?? {})
  res.status(201).json(await tx((c) => startRecall(c, b, req.wh)))
})
post('/warehouse/recalls/:id/continue', async (req, res) => res.json(await tx((c) => continueRecall(c, req.params.id, req.wh))))
post('/warehouse/recalls/:id/release', async (req, res) => {
  const b = parse(z.object({ reason }).strict(), req.body ?? {})
  res.json(await tx((c) => releaseRecall(c, req.params.id, b, req.wh)))
})
get('/warehouse/recalls/:id', async (req, res) => {
  const { rows } = await query('SELECT * FROM wh_recalls WHERE id = $1 AND warehouse_id = $2', [req.params.id, req.wh.warehouseId])
  if (!rows.length) throw notFound('Recall not found')
  res.json(await recallView({ query }, rows[0], req.wh))
})

get('/warehouse/export/:report', async (req, res) => {
  const report = parse(z.enum(EXPORTS), req.params.report)
  const from = req.query.from ? parse(day, req.query.from) : null
  const to = req.query.to ? parse(day, req.query.to) : null
  const body = await exportReport({ query }, report, { from, to }, req.wh)
  res.set('Content-Type', 'text/csv; charset=utf-8')
  res.set('Content-Disposition', `attachment; filename="warehouse-${report}.csv"`)
  res.set('Cache-Control', 'no-store')
  res.send(body)
})

// ---------------------------------------------------------------- stocktake

get('/warehouse/stocktakes', async (req, res) => res.json(await listStocktakes({ query }, req.wh)))
get('/warehouse/stocktakes/:id', async (req, res) => res.json(await getStocktake({ query }, req.params.id, req.wh)))
post('/warehouse/stocktakes/:id/review', async (req, res) => {
  // `rest` decides every box not listed, so a count of thousands of boxes is reviewed in one short request.
  const b = parse(z.object({
    missing: z.array(uuid).max(2000).default([]), keep: z.array(uuid).max(2000).default([]), rest: z.enum(['missing', 'keep']).optional(), note: z.string().trim().max(300).optional(),
  }).strict(), req.body ?? {})
  res.json(await tx((c) => reviewStocktake(c, req.params.id, { missing: b.missing, keep: b.keep, rest: b.rest ?? null, note: b.note || null }, req.wh)))
})
post('/warehouse/stocktakes/:id/approve', async (req, res) => res.json(await tx((c) => decideStocktakeReview(c, req.params.id, true, req.wh))))
post('/warehouse/stocktakes/:id/reject', async (req, res) => res.json(await tx((c) => decideStocktakeReview(c, req.params.id, false, req.wh))))

// ---------------------------------------------------------------- repack

get('/warehouse/repacks', async (req, res) => res.json(await listRepacks({ query }, req.wh)))
get('/warehouse/repacks/:id', async (req, res) => res.json(await getRepack({ query }, req.params.id, req.wh)))
get('/warehouse/repacks/:id/labels.pdf', async (req, res) => {
  const boxes = await repackOutputsForLabels({ query }, req.params.id, req.wh)
  pdf(res, `repack-${req.params.id}.pdf`, labelsPdf(boxes.map((b) => boxLabel(b, b.lot_code)), { layout: req.query.layout === 'a4' ? 'a4' : 'roll' }))
})

// Every table entry has a handler (and the other way round, via guard()).
const mounted = new Set(router.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route.path}`)))
for (const key of PERM.keys()) {
  if (!mounted.has(key)) throw new Error(`warehouse route ${key} is listed but has no handler`)
}

