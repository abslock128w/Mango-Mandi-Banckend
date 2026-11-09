// Backorders (mango-api/README.md, Checkout → Backorders): a box with no stock on the chosen day can still be
// ordered, for a day at least BACKORDER_LEAD_DAYS from today (IST). The order is placed with its short lines
// marked backordered and stays at-risk (orders.backorder says it is expected) until the hourly rebalance
// finds stock for it. The shop tells the customer "delivered in <lead>–<window> days".
import { addDays, now, todayIST } from './clock.js'
import { env } from './env.js'
import { HttpError } from './errors.js'
import { isOn } from './feature-switches.js'

export const backordersOn = () => isOn('BACKORDERS')
export const leadDays = () => env.BACKORDER_LEAD_DAYS
export const windowDays = () => Math.max(env.BACKORDER_WINDOW_DAYS, env.BACKORDER_LEAD_DAYS)

/** What /v1/policy tells the shop. */
export const backorderPolicy = () => ({ enabled: backordersOn(), leadDays: leadDays(), windowDays: windowDays() })

/** The window the shop promises for an order placed now: today + lead to today + window. */
export function backorderEta(at = now()) {
  const today = todayIST(at)
  return { from: addDays(today, leadDays()), to: addDays(today, windowDays()) }
}

/** The first of the bookable `dates` a backorder can be delivered on (null when none is far enough out). */
export const earliestBackorderDate = (dates, at = now()) => dates.find((d) => d >= backorderEta(at).from) ?? null

/**
 * Whether a line short of stock on `date` may be backordered. Throws BACKORDER_DATE (with the earliest day
 * it can come) when the day is too soon; returns false when backorders are off (the caller keeps
 * STOCK_INSUFFICIENT).
 */
export function canBackorder(date, dates, sku) {
  if (!backordersOn()) return false
  if (date >= backorderEta().from) return true
  const earliest = earliestBackorderDate(dates)
  if (!earliest) return false
  throw new HttpError(409, 'BACKORDER_DATE', `This box is being sourced and can be delivered from ${earliest}. Pick that day or later.`, { earliest, sku })
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
