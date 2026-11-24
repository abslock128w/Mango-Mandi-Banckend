// Backorders (mango-api/README.md, Checkout → Backorders): a box short on the chosen day can still be
// ordered, for a day at least BACKORDER_LEAD_DAYS from today (IST), when a batch that is on its way
// (ARRIVING or IN_TRANSIT) can supply it that day: its truck is due before the day, the fruit has the
// chosen ripeness then, and the boxes asked for fit in what that batch is expected to bring (its count at
// the forecast confidence, less what is held or committed on it and less what earlier backorders still
// wait for). The order is placed with its short lines marked backordered and stays at-risk
// (orders.backorder says it is expected) until the hourly rebalance finds stock for it. With no such batch
// a short box is not sold as a backorder: the quote names the earliest day it can come instead
// (earliest.js), or that it can't. The shop tells the customer "delivered in <lead>–<window> days".
import { addDays, now, todayIST } from './clock.js'
import { getConfig } from './config.js'
import { env } from './env.js'
import { isOn } from './feature-switches.js'
import { heldForPreorders, heldShortfall } from './holdback.js'
import { availabilityByDate, incomingAs, incomingRows, sellableQty } from './inventory.js'
import { saleStage } from './stage.js'

export const backordersOn = () => isOn('BACKORDERS')
export const leadDays = () => env.BACKORDER_LEAD_DAYS
export const windowDays = () => Math.max(env.BACKORDER_WINDOW_DAYS, env.BACKORDER_LEAD_DAYS)

/** What /v1/policy tells the shop. */
export const backorderPolicy = () => ({ enabled: backordersOn(), leadDays: leadDays(), windowDays: windowDays() })

/**
 * The window the shop promises for an order placed now: today + lead to today + window, never starting
 * before the order's own delivery day (`date`) when one is given.
 */
export function backorderEta(date = null, at = now()) {
  const today = todayIST(at)
  let from = addDays(today, leadDays())
  let to = addDays(today, windowDays())
  if (date && date > from) from = date
  if (to < from) to = from
  return { from, to }
}

/** Boxes of each SKU that placed backorders are still waiting for (ordered, not yet given stock). */
async function waitingBySku(c, sku) {
  const { rows } = await c.query(
    `SELECT i.sku, SUM(GREATEST(0, i.quantity - COALESCE((SELECT SUM(s.quantity) FROM order_stock s
              WHERE s.order_id = i.order_id AND s.sku = i.sku AND s.stage = i.stage AND s.state IN ('held', 'committed', 'packed')), 0)))::int AS n
       FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE i.backordered AND NOT o.planned AND ($1::text IS NULL OR i.sku = $1)
        AND o.status NOT IN ('CANCELLED', 'RTO', 'DELIVERED')
        AND NOT (o.status = 'PAYMENT_PENDING' AND COALESCE(o.hold_expires_at < $2::timestamptz, FALSE))
      GROUP BY i.sku`,
    [sku, now()],
  )
  return new Map(rows.map((r) => [r.sku, r.n]))
}

/**
 * Boxes that may still be backordered for each of `dates`: Map date → Map "sku|stage" → boxes. A
 * batch's boxes are one pool whatever ripeness they reach on a day, so what earlier backorders wait
 * for comes off every stage of that SKU. Empty maps while backorders are off.
 */
export async function backorderRoom(c, dates, { sku = null } = {}) {
  const out = new Map(dates.map((d) => [d, new Map()]))
  if (!backordersOn()) return out
  const rows = await incomingRows(c, { sku })
  if (!rows.length) return out
  const waiting = await waitingBySku(c, sku)
  // Pre-orders come first (holdback.js): what they are owed beyond the stock on the shelf that day comes off the
  // fruit on its way too, so a backorder never waits for boxes a booking will take when they arrive.
  const held = await heldForPreorders(c, { sku })
  const shelf = held.size ? await availabilityByDate(c, dates, { raw: true }) : null
  const cfg = getConfig()
  for (const d of dates) {
    const stagesOf = new Map()
    for (const r of rows) {
      const s = incomingAs(r, d, cfg)
      if (!s) continue
      const key = `${r.sku}|${s.stage}`
      stagesOf.set(key, (stagesOf.get(key) ?? 0) + sellableQty(r, s.factor))
    }
    for (const [key, n] of stagesOf) {
      const s = key.split('|')[0]
      const left = n - (waiting.get(s) ?? 0) - (shelf ? heldShortfall(shelf.get(d), held, s) : 0)
      if (left > 0) out.get(d).set(key, left)
    }
  }
  return out
}

/**
 * Whether `short` boxes of a line may be backordered for `date`. { ok: true }, or { ok: false, earliest }
 * where `earliest` is the first of `dates` that could take them as a backorder (null when none: then
 * it isn't sold as a backorder at all, see earliest.js).
 */
export async function backorderable(c, { date, dates, sku, stage, short }) {
  if (!backordersOn()) return { ok: false, earliest: null }
  const key = `${sku}|${saleStage(stage)}`
  const from = backorderEta().from
  const room = await backorderRoom(c, dates.filter((d) => d >= from || d === date), { sku })
  if (date >= from && (room.get(date)?.get(key) ?? 0) >= short) return { ok: true }
  return { ok: false, earliest: dates.find((d) => d >= from && (room.get(d)?.get(key) ?? 0) >= short) ?? null }
}

/**
 * After createOrder (allOrNothing off): marks the lines it could not fill as backordered and the order as a
 * backorder. createOrder's setRisk has already flagged the shortfall, so the rebalance fills it later.
 */
export async function markBackorder(c, orderId) {
  const { rows } = await c.query(
    `UPDATE order_items i SET backordered = TRUE
      WHERE i.order_id = $1 AND i.quantity > COALESCE((SELECT SUM(s.quantity) FROM order_stock s
              WHERE s.order_id = i.order_id AND s.sku = i.sku AND s.stage = i.stage AND s.state IN ('held', 'committed', 'packed')), 0)
      RETURNING i.id`,
    [orderId],
  )
  if (rows.length) await c.query('UPDATE orders SET backorder = TRUE WHERE id = $1', [orderId])
  return rows.length > 0
}
