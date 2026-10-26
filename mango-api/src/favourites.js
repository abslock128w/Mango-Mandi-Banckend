// Favourites (FAVOURITES, docs/app-feel.md): boxes a signed-in customer
// hearted. A guest's hearts live on their device; on sign-in the shop sends
// them here once (mergeFavourites) and forgets its copy.
import { now } from './clock.js'
import { conflict, notFound } from './errors.js'
import { findProduct, sellable } from './products.js'

/** Hearts one customer may have; more is not a list anyone scrolls. */
export const MAX_FAVOURITES = 50

const view = (r) => {
  const p = findProduct(r.sku)
  return {
    sku: r.sku,
    name: p?.name ?? r.sku,
    variety: p?.variety ?? null,
    boxSize: p?.boxSize ?? null,
    price: p?.price ?? null,
    photoUrl: p?.photoUrl ?? null,
    // Taken off sale since it was hearted: the list says so and offers nothing to buy.
    onSale: Boolean(p?.active),
    addedAt: r.created_at,
  }
}

/** The customer's hearts, newest first. */
export async function listFavourites(c, customerId) {
  const { rows } = await c.query('SELECT sku, created_at FROM customer_favourites WHERE customer_id = $1 ORDER BY created_at DESC, sku', [customerId])
  return rows.map(view)
}

/** One customer's changes run one at a time, so the cap holds. */
const lockCustomer = async (c, customerId) => {
  const { rowCount } = await c.query('SELECT 1 FROM customers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [customerId])
  if (!rowCount) throw notFound('Customer not found')
}

/** Hearts a box on sale. Hearting it again changes nothing. */
export async function addFavourite(c, customerId, sku) {
  if (!sellable(sku)) throw notFound('That box is not on sale')
  await lockCustomer(c, customerId)
  const { rows } = await c.query('SELECT sku FROM customer_favourites WHERE customer_id = $1', [customerId])
  if (rows.some((r) => r.sku === sku)) return
  if (rows.length >= MAX_FAVOURITES) throw conflict(`You can keep up to ${MAX_FAVOURITES} favourites. Remove one first.`, 'FAVOURITES_FULL')
  await c.query('INSERT INTO customer_favourites (customer_id, sku, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [customerId, sku, now()])
}

/** Un-hearts a box. Only ever the caller's own list; a box not in it is already un-hearted. */
export async function removeFavourite(c, customerId, sku) {
  await c.query('DELETE FROM customer_favourites WHERE customer_id = $1 AND sku = $2', [customerId, sku])
}

/**
 * Adds the hearts a guest made on this device. Boxes no longer on sale, and any
 * past the cap, are left out and named in `ignored`; nothing fails the sign-in.
 */
export async function mergeFavourites(c, customerId, skus) {
  await lockCustomer(c, customerId)
  const { rows } = await c.query('SELECT sku FROM customer_favourites WHERE customer_id = $1', [customerId])
  const have = new Set(rows.map((r) => r.sku))
  const ignored = []
  const at = now()
  for (const sku of new Set(skus)) {
    if (have.has(sku)) continue
    if (!sellable(sku) || have.size >= MAX_FAVOURITES) {
      ignored.push(sku)
      continue
    }
    await c.query('INSERT INTO customer_favourites (customer_id, sku, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [customerId, sku, at])
    have.add(sku)
  }
  return { ignored }
}
