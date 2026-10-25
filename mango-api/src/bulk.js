// Bulk Deals: listings for large orders. A listing sells one product (box)
// from the same stock, holds, checkout and order lifecycle as the regular shop;
// what it adds is its own text, photos and quantity-based prices.
//
// Prices are paise per box, whole numbers, whatever the ripeness (one price per
// box, the owner's rule). The tier that applies is always worked out here, on
// the server, from the quantity: a browser never sends a price.
import { z } from 'zod'
import { now } from './clock.js'
import { getConfig } from './config.js'
import { conflict, HttpError, notFound } from './errors.js'
import { newId } from './ids.js'
import { findProduct } from './products.js'
import { STAGES } from './stage.js'

export const LISTING_STATUSES = ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED']
export const MAX_TIERS = 8
export const MAX_PHOTOS = 8
/** The most boxes one bulk line can ask for, whatever the listing says. */
export const BULK_QTY_CEILING = 5000
const MAX_UNIT_PRICE = 10_000_000 // ₹1,00,000 a box, far above any real box

export const tierSchema = z.object({
  minQty: z.number().int().min(1, 'A tier starts at 1 box or more').max(BULK_QTY_CEILING),
  unitPrice: z.number().int().positive('A tier price must be more than zero').max(MAX_UNIT_PRICE),
})

/** The listing fields a manager edits (POST and PATCH share them). */
export const listingFields = {
  sku: z.string().trim().min(1),
  title: z.string().trim().min(3, 'Give the listing a name of 3 characters or more').max(80),
  description: z.string().trim().max(2000),
  origin: z.string().trim().max(120),
  stages: z.array(z.enum(STAGES)).min(1, 'Offer at least one ripeness').max(3),
  minQty: z.number().int().min(1, 'The minimum is 1 box or more').max(BULK_QTY_CEILING),
  qtyStep: z.number().int().min(1, 'Boxes go up by 1 or more').max(1000),
  maxQty: z.number().int().min(1).max(BULK_QTY_CEILING).nullable(),
  tiers: z.array(tierSchema).min(1, 'Add at least one price').max(MAX_TIERS, `At most ${MAX_TIERS} price tiers`),
  startsAt: z.iso.datetime({ offset: true }).nullable(),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  sortOrder: z.number().int().min(0).max(10_000),
}

/**
 * Everything wrong with a listing's rules, as sentences a manager can act on.
 * The same checks guard every save (a draft may be incomplete only in what it
 * lacks, never in what contradicts itself) and publishing.
 */
export function listingProblems(l) {
  const out = []
  const tiers = l.tiers ?? []
  if (l.maxQty != null && l.maxQty < l.minQty) out.push('The most boxes per order is below the minimum')
  if (l.maxQty != null && (l.maxQty - l.minQty) % l.qtyStep !== 0) out.push(`The most boxes per order must be the minimum plus steps of ${l.qtyStep}`)
  if (tiers.length && tiers[0].minQty !== l.minQty) out.push(`The first price tier must start at the minimum order (${l.minQty} boxes)`)
  tiers.forEach((t, i) => {
    if (i > 0 && t.minQty <= tiers[i - 1].minQty) out.push(`Price tiers must start at a higher quantity each time (tier ${i + 1} starts at ${t.minQty})`)
    if (i > 0 && t.unitPrice >= tiers[i - 1].unitPrice) out.push(`A bigger order must cost less per box (tier ${i + 1} is not cheaper than tier ${i})`)
    if ((t.minQty - l.minQty) % l.qtyStep !== 0) out.push(`Tier ${i + 1} starts at ${t.minQty} boxes, which can't be ordered in steps of ${l.qtyStep} from ${l.minQty}`)
    if (l.maxQty != null && t.minQty > l.maxQty) out.push(`Tier ${i + 1} starts above the most boxes per order`)
  })
  if (new Set(l.stages ?? []).size !== (l.stages ?? []).length) out.push('A ripeness is listed twice')
  if (l.startsAt && l.endsAt && new Date(l.endsAt) <= new Date(l.startsAt)) out.push('The sale must end after it starts')
  return out
}

/** What else publishing needs: a product on sale, a photo, a description, and a minimum the shop's limits allow. */
export function publishProblems(l, { photos }) {
  const out = listingProblems(l)
  const p = findProduct(l.sku)
  if (!p) out.push('The product no longer exists')
  else if (!p.active) out.push(`${p.name} is not on sale; put it back on sale under Products first`)
  if (!photos) out.push('Add at least one photo')
  if ((l.description ?? '').trim().length < 20) out.push('Write a description of at least 20 characters')
  const cap = getConfig().maxHeldBoxes
  if (l.minQty > cap) out.push(`The minimum order (${l.minQty} boxes) is above the most boxes one customer can hold unpaid (${cap}, Planning → Rules); raise that rule or lower the minimum`)
  if (l.endsAt && new Date(l.endsAt) <= now()) out.push('The sale has already ended; change or clear the end date')
  return out
}

/** The listing as stored → the shape both APIs use. */
export function fromRow(r) {
  return {
    id: r.id, sku: r.sku, title: r.title, description: r.description, origin: r.origin, stages: r.stages,
    minQty: r.min_qty, qtyStep: r.qty_step, maxQty: r.max_qty, tiers: r.tiers, status: r.status,
    startsAt: r.starts_at ? new Date(r.starts_at).toISOString() : null, endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
    sortOrder: r.sort_order, version: r.version, createdAt: r.created_at, createdBy: r.created_by, updatedAt: r.updated_at,
    updatedBy: r.updated_by, publishedAt: r.published_at,
  }
}

/** On sale right now: published, inside its sale window, and its product on sale. */
export function onSale(l, at = now()) {
  if (l.status !== 'PUBLISHED') return false
  if (l.startsAt && new Date(l.startsAt) > at) return false
  if (l.endsAt && new Date(l.endsAt) <= at) return false
  return Boolean(findProduct(l.sku)?.active)
}

/** The most boxes one order can take: the listing's own cap and the unpaid-box limit, whichever is lower. */
export const orderMax = (l) => Math.min(l.maxQty ?? BULK_QTY_CEILING, getConfig().maxHeldBoxes, BULK_QTY_CEILING)

/** Why this quantity can't be ordered, or null. */
export function qtyProblem(l, qty) {
  const max = orderMax(l)
  if (!Number.isInteger(qty) || qty < l.minQty) return `The minimum order is ${l.minQty} boxes`
  if (qty > max) return `The most you can order at once is ${max} boxes`
  if ((qty - l.minQty) % l.qtyStep !== 0) return `Order in steps of ${l.qtyStep} boxes from ${l.minQty}`
  return null
}

/** The tier for a quantity: the last one whose minQty it reaches. Tiers are validated ascending. */
export function tierFor(l, qty) {
  let hit = null
  l.tiers.forEach((t, i) => {
    if (qty >= t.minQty) hit = { index: i, minQty: t.minQty, maxQty: l.tiers[i + 1] ? l.tiers[i + 1].minQty - 1 : (l.maxQty ?? null), unitPrice: t.unitPrice }
  })
  return hit
}

/**
 * Prices a bulk line on the server. Throws BULK_QTY_INVALID for a quantity the
 * listing doesn't allow. The snapshot is what the order item keeps.
 */
export function priceLine(l, qty) {
  const problem = qtyProblem(l, qty)
  if (problem) throw new HttpError(400, 'BULK_QTY_INVALID', problem, { listingId: l.id })
  const tier = tierFor(l, qty)
  if (!tier) throw new HttpError(400, 'BULK_QTY_INVALID', `The minimum order is ${l.minQty} boxes`, { listingId: l.id })
  return {
    unitPrice: tier.unitPrice,
    linePrice: tier.unitPrice * qty,
    pricing: { kind: 'bulk', listingId: l.id, listingVersion: l.version, title: l.title, tier: { minQty: tier.minQty, maxQty: tier.maxQty, unitPrice: tier.unitPrice } },
  }
}

/** The tiers as the shop shows them: each with its range, and the saving against the regular box price only when there is one. */
export function tierView(l, retailPrice) {
  return l.tiers.map((t, i) => ({
    minQty: t.minQty,
    maxQty: l.tiers[i + 1] ? l.tiers[i + 1].minQty - 1 : (l.maxQty ?? null),
    unitPrice: t.unitPrice,
    savingPerBox: retailPrice > t.unitPrice ? retailPrice - t.unitPrice : null,
  }))
}

/** A listing row, locked for a write (FOR UPDATE) or a sale (FOR SHARE: a price change waits for the checkout, and the other way round). */
export async function getListing(c, id, { lock = null } = {}) {
  const { rows } = await c.query(`SELECT * FROM bulk_listings WHERE id = $1${lock === 'update' ? ' FOR UPDATE' : lock === 'share' ? ' FOR SHARE' : ''}`, [id])
  if (!rows.length) throw notFound('Bulk deal not found')
  return fromRow(rows[0])
}

/** A listing a customer may buy right now, else 409 BULK_UNAVAILABLE. */
export async function saleListing(c, id, { lock = null } = {}) {
  const { rows } = await c.query(`SELECT * FROM bulk_listings WHERE id = $1${lock === 'share' ? ' FOR SHARE' : ''}`, [id])
  const l = rows[0] ? fromRow(rows[0]) : null
  if (!l || !onSale(l)) throw new HttpError(409, 'BULK_UNAVAILABLE', `${l?.title ?? 'This bulk deal'} is not on sale right now`, { listingId: id })
  return l
}

/** Records a change to a listing for its history. */
export async function listingEvent(c, listingId, action, version, changes, admin) {
  await c.query(
    `INSERT INTO bulk_listing_events (id, listing_id, action, version, changes, actor_id, actor_name, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [newId('ble'), listingId, action, version, changes, admin?.id ?? null, admin?.email ?? null, now()],
  )
}

/** Only the fields that changed, as { field: { from, to } }. */
export function diff(before, after) {
  const out = {}
  for (const k of Object.keys(after)) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) out[k] = { from: before[k] ?? null, to: after[k] ?? null }
  }
  return out
}

/** Publishing moves, checked: archived is final, and only a draft or unpublished listing can go live. */
export function assertStatusMove(from, to) {
  const ok = { PUBLISHED: ['DRAFT', 'UNPUBLISHED'], UNPUBLISHED: ['PUBLISHED'], ARCHIVED: ['DRAFT', 'PUBLISHED', 'UNPUBLISHED'] }
  if (!ok[to]?.includes(from)) throw conflict(`A ${from.toLowerCase()} listing can't be ${to === 'PUBLISHED' ? 'published' : to.toLowerCase()}`, 'BULK_STATUS')
}
