// Bulk Deals in the shop: the catalogue (public), a listing's photos (public
// while it is published), and bulk lines in the cart. Checkout prices bulk
// lines in customer.js through bulkQuoteLines() and checkBulkLinesAtConfirm().
import express from 'express'
import { z } from 'zod'
import { fromRow, onSale, orderMax, priceLine, qtyProblem, saleListing, tierView } from './bulk.js'
import { now } from './clock.js'
import { query } from './db.js'
import { orderableDates } from './delivery.js'
import { asyncHandler, HttpError, notFound, parse } from './errors.js'
import { availabilityByDate } from './inventory.js'
import { photoWidth, sendPublicPhoto } from './photos.js'
import { findProduct } from './products.js'
import { eatByFor } from './ripeness.js'
import { STAGES } from './stage.js'

export const publicBulk = express.Router()
export const cartBulk = express.Router()

const shopPhotoUrl = (listingId, photoId) => `/v1/bulk-deals/${encodeURIComponent(listingId)}/photos/${encodeURIComponent(photoId)}`

/** A listing as the shop shows it. `availability` adds stock per delivery date and ripeness when a pincode is known. */
function shopView(l, photos, availability = null) {
  const p = findProduct(l.sku)
  return {
    id: l.id, title: l.title, description: l.description, origin: l.origin,
    product: { sku: p.sku, name: p.name, variety: p.variety, boxSize: p.boxSize, fruitsPerBox: p.fruitsPerBox, fruitWeightG: p.fruitWeightG },
    // The regular one-box price, so the shop can compare; a saving is shown only where a tier is really lower.
    retailPrice: p.price,
    stages: l.stages, minQty: l.minQty, qtyStep: l.qtyStep, maxQty: orderMax(l),
    tiers: tierView(l, p.price), fromPrice: Math.min(...l.tiers.map((t) => t.unitPrice)),
    photos: photos.map((id) => ({ id, url: shopPhotoUrl(l.id, id) })),
    endsAt: l.endsAt, version: l.version,
    ...(availability ? { availability } : {}),
  }
}

async function photoIds(listingIds) {
  if (!listingIds.length) return new Map()
  const { rows } = await query('SELECT id, listing_id FROM bulk_listing_photos WHERE listing_id = ANY($1) ORDER BY position, created_at', [listingIds])
  const out = new Map()
  for (const r of rows) out.set(r.listing_id, [...(out.get(r.listing_id) ?? []), r.id])
  return out
}

/** Per open delivery date, the boxes available for each offered ripeness, and whether the minimum order fits. */
async function availabilityFor(c, listings) {
  const dates = await orderableDates(c)
  if (!dates.length) return new Map(listings.map((l) => [l.id, []]))
  const byDate = await availabilityByDate(c, dates)
  return new Map(
    listings.map((l) => [
      l.id,
      dates.map((date) => {
        const pool = byDate.get(date)
        const stages = l.stages.map((stage) => {
          const qty = pool.get(`${l.sku}|${stage}`) ?? 0
          return { stage, available: qty, enough: qty >= l.minQty, eatBy: eatByFor(stage, date) }
        })
        return { date, stages, enough: stages.some((s) => s.enough) }
      }),
    ]),
  )
}

const PIN = z.string().regex(/^\d{6}$/)

/** Published bulk deals on sale now, in display order. ?pincode= adds stock per delivery date. Paged. */
publicBulk.get(
  '/bulk-deals',
  asyncHandler(async (req, res) => {
    const q = parse(z.object({ pincode: PIN.optional(), page: z.coerce.number().int().min(1).max(1000).default(1) }), req.query)
    const size = 24
    const at = now()
    const { rows } = await query(
      `SELECT * FROM bulk_listings WHERE status = 'PUBLISHED' AND (starts_at IS NULL OR starts_at <= $1) AND (ends_at IS NULL OR ends_at > $1)
        ORDER BY sort_order, created_at DESC`,
      [at],
    )
    const all = rows.map(fromRow).filter((l) => onSale(l, at))
    const pageItems = all.slice((q.page - 1) * size, q.page * size)
    const photos = await photoIds(pageItems.map((l) => l.id))
    const avail = q.pincode && (await serviceable(q.pincode)) ? await availabilityFor({ query }, pageItems) : null
    res.json({
      items: pageItems.map((l) => shopView(l, photos.get(l.id) ?? [], avail?.get(l.id) ?? null)),
      page: q.page, pageSize: size, total: all.length, serviceable: q.pincode ? avail !== null : null,
    })
  }),
)

async function serviceable(pincode) {
  const { rows } = await query('SELECT 1 FROM pincodes WHERE pincode = $1 AND active', [pincode])
  return rows.length > 0
}

/** One bulk deal with its stock per delivery date (with ?pincode=). 404 when it isn't on sale. */
publicBulk.get(
  '/bulk-deals/:id',
  asyncHandler(async (req, res) => {
    const q = parse(z.object({ pincode: PIN.optional() }), req.query)
    const { rows } = await query('SELECT * FROM bulk_listings WHERE id = $1', [req.params.id])
    const l = rows[0] ? fromRow(rows[0]) : null
    if (!l || !onSale(l)) throw notFound('This bulk deal is not available')
    const photos = await photoIds([l.id])
    const ok = q.pincode ? await serviceable(q.pincode) : false
    const avail = ok ? await availabilityFor({ query }, [l]) : null
    res.json({ ...shopView(l, photos.get(l.id) ?? [], avail?.get(l.id) ?? null), serviceable: q.pincode ? ok : null })
  }),
)

/** The server's price for a quantity: the tier, the box price and the total. The shop shows it; checkout works it out again. */
publicBulk.get(
  '/bulk-deals/:id/price',
  asyncHandler(async (req, res) => {
    const q = parse(z.object({ qty: z.coerce.number().int().min(1).max(100_000) }), req.query)
    const l = await saleListing({ query }, req.params.id).catch(() => {
      throw notFound('This bulk deal is not available')
    })
    const priced = priceLine(l, q.qty)
    res.json({ qty: q.qty, unitPrice: priced.unitPrice, total: priced.linePrice, tier: priced.pricing.tier, version: l.version })
  }),
)

/** A photo of a published listing. Each photo has its own id, so it is cached for a year. */
publicBulk.get(
  '/bulk-deals/:id/photos/:photoId',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT p.id, p.mime, p.bytes, p.blob_path FROM bulk_listing_photos p JOIN bulk_listings l ON l.id = p.listing_id
        WHERE p.id = $1 AND p.listing_id = $2 AND l.status = 'PUBLISHED'`,
      [req.params.photoId, req.params.id],
    )
    if (!rows.length) throw notFound('Photo not found')
    await sendPublicPhoto(res, rows[0], { key: `bulk:${rows[0].id}`, width: photoWidth(req.query.w), cache: 'public, max-age=31536000, immutable' })
  }),
)

// ---------------------------------------------------------------- cart

/** Sets a bulk line in the cart (qty 0 removes it). The quantity must fit the listing's minimum, steps and maximum. */
cartBulk.post(
  '/cart/bulk',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ listingId: z.string().min(1).max(64), stage: z.enum(STAGES), qty: z.number().int().min(0).max(100_000) }).strict(), req.body)
    if (b.qty === 0) {
      await query('DELETE FROM bulk_cart_lines WHERE customer_id = $1 AND listing_id = $2 AND stage = $3', [req.customer.id, b.listingId, b.stage])
      return res.status(204).end()
    }
    const l = await saleListing({ query }, b.listingId)
    if (!l.stages.includes(b.stage)) throw new HttpError(400, 'BULK_STAGE_INVALID', 'That ripeness is not offered on this deal', { listingId: l.id })
    const problem = qtyProblem(l, b.qty)
    if (problem) throw new HttpError(400, 'BULK_QTY_INVALID', problem, { listingId: l.id })
    await query(
      `INSERT INTO bulk_cart_lines (customer_id, listing_id, stage, qty, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (customer_id, listing_id, stage) DO UPDATE SET qty = EXCLUDED.qty, updated_at = EXCLUDED.updated_at`,
      [req.customer.id, l.id, b.stage, b.qty, now()],
    )
    res.status(204).end()
  }),
)

cartBulk.delete(
  '/cart/bulk/:listingId',
  asyncHandler(async (req, res) => {
    const stage = req.query.stage ? parse(z.enum(STAGES), req.query.stage) : null
    await query('DELETE FROM bulk_cart_lines WHERE customer_id = $1 AND listing_id = $2 AND ($3::text IS NULL OR stage = $3)', [
      req.customer.id, req.params.listingId, stage,
    ])
    res.status(204).end()
  }),
)

/**
 * The customer's bulk lines as the cart shows them, each priced now. A line
 * that can't be bought as it stands (taken off sale, ripeness dropped, the
 * quantity no longer allowed) comes back with `problem` instead of failing the cart.
 */
export async function bulkCartView(c, customerId, pool) {
  const { rows } = await c.query(
    `SELECT b.stage, b.qty, l.* FROM bulk_cart_lines b JOIN bulk_listings l ON l.id = b.listing_id WHERE b.customer_id = $1 ORDER BY l.title, b.stage`,
    [customerId],
  )
  return rows.map((r) => {
    const l = fromRow(r)
    const base = { listingId: l.id, title: l.title, sku: l.sku, name: findProduct(l.sku)?.name ?? l.sku, stage: r.stage, qty: r.qty, minQty: l.minQty, qtyStep: l.qtyStep, maxQty: orderMax(l) }
    const problem = !onSale(l) ? 'This bulk deal is no longer on sale' : !l.stages.includes(r.stage) ? 'This ripeness is no longer offered' : qtyProblem(l, r.qty)
    if (problem) return { ...base, problem, unitPrice: 0, linePrice: 0, tier: null, available: 0, insufficient: true }
    const priced = priceLine(l, r.qty)
    const available = pool.get(`${l.sku}|${r.stage}`) ?? 0
    return { ...base, problem: null, unitPrice: priced.unitPrice, linePrice: priced.linePrice, tier: priced.pricing.tier, available, insufficient: available < r.qty }
  })
}

/**
 * Bulk lines for a checkout quote, priced on the server from the listing as
 * it is now. Any line that can't be bought fails the quote with a clear code.
 */
export async function bulkQuoteLines(c, customerId, pool, date) {
  const { rows } = await c.query('SELECT listing_id, stage, qty FROM bulk_cart_lines WHERE customer_id = $1 ORDER BY listing_id, stage', [customerId])
  const out = []
  for (const r of rows) {
    const l = await saleListing(c, r.listing_id)
    if (!l.stages.includes(r.stage)) throw new HttpError(409, 'BULK_STAGE_INVALID', `${l.title}: that ripeness is no longer offered. Change it in your cart.`, { listingId: l.id })
    const priced = priceLine(l, r.qty)
    if ((pool.get(`${l.sku}|${r.stage}`) ?? 0) < r.qty) {
      throw new HttpError(409, 'STOCK_INSUFFICIENT', `Not enough stock for ${l.title} on ${date}: try another day or fewer boxes`, { sku: l.sku, listingId: l.id })
    }
    out.push({
      sku: l.sku, name: findProduct(l.sku).name, stage: r.stage, qty: r.qty, unitPrice: priced.unitPrice, linePrice: priced.linePrice,
      eatBy: eatByFor(r.stage, date), listingId: l.id, title: l.title, pricing: priced.pricing,
    })
  }
  return out
}

/**
 * At confirm: each bulk line of the quote, against the listing as it is now
 * (locked FOR SHARE, so a manager's price change waits for this checkout or
 * goes first). A listing taken off sale fails with BULK_UNAVAILABLE; a price
 * that changed since the quote fails with PRICE_CHANGED, so the shop quotes
 * again and the customer sees the new total before paying. Returns the lines
 * with a fresh snapshot (the version may have moved without the price changing).
 */
export async function checkBulkLinesAtConfirm(c, lines) {
  const out = []
  for (const line of lines) {
    if (!line.listingId) {
      out.push(line)
      continue
    }
    const l = await saleListing(c, line.listingId, { lock: 'share' })
    if (!l.stages.includes(line.stage)) throw new HttpError(409, 'BULK_STAGE_INVALID', `${l.title}: that ripeness is no longer offered`, { listingId: l.id })
    let priced
    try {
      priced = priceLine(l, line.qty)
    } catch (err) {
      throw new HttpError(409, 'PRICE_CHANGED', `${l.title} changed since you reviewed your order: ${err.message}. Review it again.`, { listingId: l.id })
    }
    if (priced.unitPrice !== line.unitPrice) {
      throw new HttpError(409, 'PRICE_CHANGED', `The price of ${l.title} changed since you reviewed your order. Review it again to see the new total.`, {
        listingId: l.id, unitPrice: priced.unitPrice,
      })
    }
    out.push({ ...line, pricing: priced.pricing })
  }
  return out
}
