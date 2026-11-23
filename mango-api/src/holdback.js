// Fruit held back for pre-orders (the owner: "hold back for all the varieties and both raw and semi-ripe, so a
// normal shopper can never take fruit that is owed to pre-orders"). README, Checkout → Held for pre-orders.
//
// What is held: every PAID booking that is not a delivery order yet (preorders.status BOOKED) whose delivery week
// has come into reach of the stock on hand now, i.e. starts on or before the hold cut-off (holdCutoff: today + the
// booking horizon + 1, never earlier than the allocator's own horizon, preorders.js allocationHorizon). Held per
// BOX (SKU: a variety in one box size) and RIPENESS (RAW / SEMI_RIPE), in boxes: that is how stock is kept (a batch
// has one line per SKU; its ripeness on a day comes from the batch's age, stage.js), so the boxes owed and the boxes
// on the shelf are counted in the same unit. A booking's kg (the plan's unit) is boxes × the box's kg, for the panel.
//
// Nothing is stored: the hold is read from the bookings each time (one indexed GROUP BY, migration 082), so it
// follows a booking that is cancelled, delayed or moved to another week, and stock that is adjusted, QC-shifted or
// retired, with no counter to keep right (the ledger audit, inventory.js auditLedger, is unchanged).
//
// The rule (afterHold), for each delivery day a regular shopper may choose, per box:
//   left(stage) = min( sellable(stage) − held(stage),  sellable(every stage) − held(every stage) ), never below 0.
// The first term keeps raw boxes for raw bookings and semi-ripe for semi-ripe; the second keeps a box for a booking
// whatever ripeness it has on the shopper's day (a box raw on Monday is semi-ripe by Thursday: the same box). It errs
// on the side of the pre-orders: a box that could serve a booking on some day of its week is never sold to someone
// else first. The allocator (preorders.js allocatePreorders) turns bookings into orders WITHOUT this rule (the held
// boxes are theirs); a converted booking leaves the held count as its boxes leave the sellable count, so what regular
// shoppers see does not move.
//
// Writes (inventory.js allocate with holdBack): a regular order first locks every sellable line of the box (DB-01
// order, lockSkuLines), then reads the sellable boxes and the hold, then takes at most what is left. Two checkouts,
// or a checkout and the allocator (whose conditional UPDATEs lock the same lines), queue on those rows, so they can
// never together take held fruit.
import { addDays, now, todayIST } from './clock.js'
import { getConfig } from './config.js'
import { boxKg, findProduct } from './products.js'
import { saleStage } from './stage.js'

/** The last week start whose paid bookings are held against the stock on hand now (see the top of this file). */
export const holdCutoff = (at = now(), cfg = getConfig()) => addDays(todayIST(at), cfg.maxDaysAhead + 1)

const keyOf = (sku, stage) => `${sku}|${saleStage(stage)}`

/**
 * Boxes held back from regular shoppers: Map "sku|stage" -> boxes (only boxes with something held). `sku`: one box only.
 * First the paid bookings above; with `planned` (the default) also the boxes still missing on PAID orders booked against
 * the plan (plan-orders.js) whose day has come within reach, so a shopper can't take the fruit they wait for. The
 * fulfilment of those orders passes planned: false: it comes after the bookings, oldest order first.
 */
export async function heldForPreorders(c, { sku = null, at = now(), planned = true } = {}) {
  const { rows } = await c.query(
    `SELECT sku, stage, SUM(n)::int AS n FROM (
       SELECT sku, stage, qty AS n FROM preorders WHERE status = 'BOOKED' AND week_start <= $1 AND ($2::text IS NULL OR sku = $2)
       UNION ALL
       SELECT i.sku, i.stage, GREATEST(0, i.quantity - COALESCE((SELECT SUM(s.quantity) FROM order_stock s
                WHERE s.order_id = i.order_id AND s.sku = i.sku AND s.stage = i.stage AND s.state IN ('held', 'committed', 'packed')), 0))
         FROM orders o JOIN order_items i ON i.order_id = o.id
        WHERE $3::boolean AND o.planned AND o.status IN ('CONFIRMED', 'PROCESSING') AND o.delivery_date <= $1 AND ($2::text IS NULL OR i.sku = $2)
     ) x GROUP BY sku, stage`,
    [holdCutoff(at), sku, planned],
  )
  const held = new Map()
  for (const r of rows) if (r.n > 0) held.set(keyOf(r.sku, r.stage), (held.get(keyOf(r.sku, r.stage)) ?? 0) + r.n)
  return held
}

const perSku = (m) => {
  const out = new Map()
  for (const [k, n] of m) {
    const sku = k.split('|')[0]
    out.set(sku, (out.get(sku) ?? 0) + n)
  }
  return out
}

/**
 * What regular shoppers may take from one day's pool (Map "sku|stage" -> sellable boxes) once `held` is kept back.
 * Pure. Boxes with nothing held are passed through unchanged.
 */
export function afterHold(pool, held) {
  if (!held?.size) return pool
  const heldBySku = perSku(held)
  const poolBySku = perSku(pool)
  const out = new Map()
  for (const [k, n] of pool) {
    const sku = k.split('|')[0]
    const all = heldBySku.get(sku) ?? 0
    if (!all) {
      out.set(k, n)
      continue
    }
    out.set(k, Math.max(0, Math.min(n - (held.get(k) ?? 0), (poolBySku.get(sku) ?? 0) - all)))
  }
  return out
}

/**
 * Boxes of `sku` (all stages) a pool cannot cover of what is held: what the pre-orders still wait for beyond the
 * stock that is sellable that day (0 when covered). Backorders (backorders.js) take this off incoming fruit too.
 */
export function heldShortfall(pool, held, sku) {
  const h = perSku(held).get(sku) ?? 0
  if (!h) return 0
  return Math.max(0, h - (perSku(pool).get(sku) ?? 0))
}

/**
 * The panel's line (Pre-order plan): per variety and ripeness, the boxes held for pre-orders now and their kg.
 * [{ variety, stage, boxes, kg, skus: [{ sku, boxes }] }], varieties in name order, RAW before SEMI_RIPE.
 */
export async function heldSummary(c, at = now()) {
  const pre = await heldForPreorders(c, { at, planned: false })
  const all = await heldForPreorders(c, { at })
  const summed = (entries) => {
    const by = new Map()
    for (const [k, n] of entries) {
      if (n <= 0) continue
      const [sku, stage] = k.split('|')
      const variety = findProduct(sku)?.variety ?? sku
      const key = `${variety}|${stage}`
      const row = by.get(key) ?? { variety, stage, boxes: 0, kg: 0, skus: [] }
      row.boxes += n
      row.kg = Math.round((row.kg + n * boxKg(sku)) * 1000) / 1000
      row.skus.push({ sku, boxes: n })
      by.set(key, row)
    }
    return [...by.values()].sort((a, b) => a.variety.localeCompare(b.variety) || a.stage.localeCompare(b.stage))
  }
  return {
    cutoff: holdCutoff(at),
    rows: summed(pre),
    // Boxes kept for paid orders booked against the plan whose day is near.
    planned: summed([...all].map(([k, n]) => [k, n - (pre.get(k) ?? 0)])),
  }
}
