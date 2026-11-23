// Bulk orders and enquiries for staff (mango-api/README.md, Bulk orders): the list (paid orders first), one
// with its events and WhatsApp messages, sending a quote, closing it and notes; a paid order's steps ("Called
// customer", dispatched, delivered) and its cancel with a full refund; and the bulk prices. Managers and
// operators (access.js); cancelling a bulk order and the bulk prices are managers' (with step-up, policy.js).
// Every change writes its staff_audit row in the same transaction. While BULK_ENQUIRIES is off
// the routes answer 404.
import express from 'express'
import { z } from 'zod'
import { addNote, BULK_KINDS, BULK_STATUSES, closeEnquiry, moveFarmVisit, quoteBody, sendQuote, staffDetail, staffList } from '../bulk-enquiries.js'
import { dropLink, moveBulkOrder, refundBulkOrder, staffCancelBulk } from '../bulk-orders.js'
import { boxPrices, bulkDiscountPct } from '../bulk-price.js'
import { requireManager } from '../auth.js'
import { currentConfig, getConfig, saveConfig } from '../config.js'
import { boxKg, findProduct, loadProducts, shopProducts } from '../products.js'
import { stepUp, withoutConfirm } from './step-up.js'
import { query, tx } from '../db.js'
import { asyncHandler, badRequest, conflict, notFound, parse } from '../errors.js'
import { isOn } from '../feature-switches.js'
import { sendNotificationsNow } from '../notify.js'
import { auditNow } from '../staff-audit.js'
import { logger } from '../logger.js'

export const router = express.Router()

const on = (_req, _res, next) => next(isOn('BULK_ENQUIRIES') ? undefined : notFound())

router.get(
  '/bulk-enquiries',
  on,
  asyncHandler(async (req, res) => {
    const f = parse(z.object({ status: z.enum(BULK_STATUSES).optional(), kind: z.enum(BULK_KINDS).optional(), q: z.string().trim().max(60).optional() }), req.query)
    res.json(await staffList({ query }, { status: f.status ?? null, kind: f.kind ?? null, q: f.q || null }))
  }),
)

router.get('/bulk-enquiries/:id', on, asyncHandler(async (req, res) => res.json(await staffDetail({ query }, req.params.id))))

router.post(
  '/bulk-enquiries/:id/quote',
  on,
  asyncHandler(async (req, res) => {
    const b = parse(quoteBody, req.body ?? {})
    const r = await tx(async (c) => {
      const out = await sendQuote(c, req.params.id, b, req.admin)
      await auditNow(req, 'QUOTE bulk enquiry', { target: req.params.id, detail: { round: out.round, total: out.quote.total, lines: out.quote.lines.length, extras: out.quote.extras.length } }, c)
      return out
    })
    // Send it now rather than at the next maintenance run, so the panel shows Sent or Failed at once.
    // A failure stays in the outbox for its retry.
    const { rows } = await query(`SELECT id FROM notifications WHERE bulk_enquiry_id = $1 AND kind = 'BULK_QUOTE' AND event_id = $2`, [req.params.id, `${req.params.id}:quote:${r.round}`])
    if (rows.length) await sendNotificationsNow(rows.map((x) => x.id)).catch((err) => logger.warn({ err }, 'bulk quote: send now failed'))
    res.status(201).json(await staffDetail({ query }, req.params.id))
  }),
)

router.post(
  '/bulk-enquiries/:id/close',
  on,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ reason: z.string().trim().max(500).optional().nullable() }).strict(), req.body ?? {})
    await tx(async (c) => {
      await closeEnquiry(c, req.params.id, req.admin, b.reason || null)
      await auditNow(req, 'CLOSE bulk enquiry', { target: req.params.id, detail: b.reason ? { reason: b.reason } : null }, c)
    })
    res.json(await staffDetail({ query }, req.params.id))
  }),
)

router.post(
  '/bulk-enquiries/:id/note',
  on,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ text: z.string().trim().min(1, 'Write a note').max(1000) }).strict(), req.body ?? {})
    await tx(async (c) => {
      await addNote(c, req.params.id, req.admin, b.text)
      await auditNow(req, 'NOTE bulk enquiry', { target: req.params.id, detail: { length: b.text.length } }, c)
    })
    res.status(201).json(await staffDetail({ query }, req.params.id))
  }),
)

// ---------------------------------------------------------------- farm visit enquiries (kind FARM_VISIT)

/** "Called customer" (CONTACTED), "Visit planned" (with the agreed date), "Visited". Close is /close with a reason. Managers and operators. */
router.post(
  '/bulk-enquiries/:id/farm-status',
  on,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({
      to: z.enum(['CONTACTED', 'VISIT_PLANNED', 'VISITED']),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date').optional().nullable(),
      note: z.string().trim().max(500).optional().nullable(),
    }).strict(), req.body ?? {})
    await tx(async (c) => {
      await moveFarmVisit(c, req.params.id, b.to, req.admin, { date: b.date ?? null, note: b.note || null })
      await auditNow(req, `${b.to} farm visit enquiry`, { target: req.params.id, detail: { ...(b.date ? { date: b.date } : {}), ...(b.note ? { note: b.note } : {}) } }, c)
    })
    res.json(await staffDetail({ query }, req.params.id))
  }),
)

// ---------------------------------------------------------------- bulk orders paid at once (bulk-orders.js)

/** "Called customer" (CONFIRMED), DISPATCHED, DELIVERED. Managers and operators. */
router.post(
  '/bulk-enquiries/:id/status',
  on,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ to: z.enum(['CONFIRMED', 'DISPATCHED', 'DELIVERED']), note: z.string().trim().max(500).optional().nullable() }).strict(), req.body ?? {})
    await tx(async (c) => {
      await moveBulkOrder(c, req.params.id, b.to, req.admin, b.note || null)
      await auditNow(req, `${b.to} bulk order`, { target: req.params.id, detail: b.note ? { note: b.note } : null }, c)
    })
    res.json(await staffDetail({ query }, req.params.id))
  }),
)

/** A manager cancels a bulk order; a paid one is refunded in full (step-up, as other refunds: STEP_UP_ROUTES). */
router.post(
  '/bulk-enquiries/:id/cancel',
  on,
  requireManager,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ reason: z.string().trim().min(3, 'Give a reason (at least 3 characters)').max(500) }).strict(), withoutConfirm(req.body ?? {}))
    const r = await tx(async (c) => {
      const done = await staffCancelBulk(c, req.params.id, req.admin, b.reason)
      // A refund: the manager confirms it is them. A refusal rolls the cancel back.
      if (done.refund) await stepUp(req, { always: true })
      await auditNow(req, 'CANCEL bulk order', { target: req.params.id, detail: { reason: b.reason, refund: done.refund } }, c)
      return done
    })
    if (r.refund) await refundBulkOrder(req.params.id).catch((err) => logger.error({ err, bulkOrderId: req.params.id }, 'bulk refund failed; maintenance will retry'))
    else if (r.link) await dropLink(r.link)
    res.json(await staffDetail({ query }, req.params.id))
  }),
)

// ---------------------------------------------------------------- bulk prices (bulk-price.js)

/**
 * The bulk price editor's list, grouped by variety: each variety's 5 kg box (the one bulk boxes are made of) with
 * its shop price, its own bulk price (null: the default discount) and what customers pay for the 5 kg and 10 kg
 * bulk boxes; and the variety's other boxes, which are not sold in bulk. Money in paise.
 */
function priceList() {
  const varieties = new Map()
  for (const p of shopProducts()) {
    const v = varieties.get(p.variety) ?? { variety: p.variety, box: null, other: [] }
    if (boxKg(p.sku) === 5 && !v.box) {
      const five = boxPrices(p.sku), ten = boxPrices(p.sku, 10)
      v.box = { sku: p.sku, name: p.name, price: p.price, bulkPrice: p.bulkPrice, fiveKg: five, tenKg: ten }
    } else v.other.push({ sku: p.sku, name: p.name, boxSize: p.boxSize })
    varieties.set(p.variety, v)
  }
  return { discountPct: bulkDiscountPct(), version: currentConfig().version, varieties: [...varieties.values()] }
}

router.get('/bulk-prices', on, (_req, res) => res.json(priceList()))

const pricesBody = z
  .object({
    discountPct: z.number().int('Whole percent only').min(0, 'The discount can’t be negative').max(90, 'At most 90% off'),
    prices: z.array(z.object({ sku: z.string().trim().min(1).max(64), bulkPrice: z.number().int('Whole paise').min(100, 'At least ₹1').max(10_000_000).nullable() }).strict()).max(200),
  })
  .strict()

/** Saves the default discount (a rules version) and each box's own bulk price (null: back to the default). Managers, step-up. */
router.put(
  '/bulk-prices',
  on,
  requireManager,
  asyncHandler(async (req, res) => {
    const b = parse(pricesBody, withoutConfirm(req.body ?? {}))
    for (const x of b.prices) {
      const p = findProduct(x.sku)
      if (!p) throw badRequest(`Unknown box ${x.sku}`, 'INVALID_SKU')
      if (boxKg(x.sku) !== 5) throw badRequest(`${p.name} is not a 5 kg box: bulk prices are set on the 5 kg box, and the 10 kg bulk box is twice it.`, 'BULK_BOX_SIZE')
      if (x.bulkPrice != null && p.price != null && x.bulkPrice > p.price) throw badRequest(`The bulk price of ${p.name} is above its shop price (${p.price / 100}). Bulk is never dearer than the shop.`, 'BULK_ABOVE_SHOP')
      if (x.bulkPrice != null && x.bulkPrice % 100) throw badRequest('Bulk prices are whole rupees.', 'VALIDATION_ERROR')
    }
    const changes = b.prices.filter((x) => (findProduct(x.sku).bulkPrice ?? null) !== x.bulkPrice)
    const pctChanged = b.discountPct !== bulkDiscountPct()
    if (!changes.length && !pctChanged) throw conflict('Nothing changed: these are the bulk prices already in use.', 'NOTHING_CHANGED')
    await stepUp(req, { always: true }) // prices for every bulk order (STEP_UP_ROUTES)
    await tx(async (c) => {
      for (const x of changes) await c.query('UPDATE products SET bulk_price = $2 WHERE sku = $1', [x.sku, x.bulkPrice])
      await auditNow(req, 'SET bulk prices', {
        detail: { discountPct: b.discountPct, ...(pctChanged ? { discountPctBefore: bulkDiscountPct() } : {}), prices: changes.map((x) => ({ sku: x.sku, bulkPrice: x.bulkPrice, before: findProduct(x.sku).bulkPrice ?? null })) },
      }, c)
    })
    if (pctChanged) await saveConfig({ ...getConfig(), bulkDiscountPct: b.discountPct }, req.admin.email)
    await loadProducts()
    res.json(priceList())
  }),
)
