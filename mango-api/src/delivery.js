// Delivery dates: the cutoff, D+1/D+2, closed days and per-day capacity.
import { getConfig } from './config.js'
import { addDays, istParts, now } from './clock.js'
import { conflict } from './errors.js'

/** Closed days between two dates (inclusive), as a Set of "YYYY-MM-DD". */
async function closedDays(c, from, to) {
  const { rows } = await c.query(
    'SELECT date FROM delivery_calendar WHERE date BETWEEN $1 AND $2 AND NOT is_open',
    [from, to],
  )
  return new Set(rows.map((r) => r.date))
}

/** First open day on or after `from`, looking at most 60 days ahead. */
export async function firstOpenDay(c, from) {
  const closed = await closedDays(c, from, addDays(from, 60))
  for (let d = from, i = 0; i <= 60; i++, d = addDays(d, 1)) if (!closed.has(d)) return d
  throw conflict('No delivery day is open in the next 60 days', 'NO_DELIVERY_DAY')
}

/** D+1 before the IST cutoff, D+2 after it, then skip closed days. */
export function earliestRawDate(at = now()) {
  const { date, hour } = istParts(at)
  return addDays(date, hour < getConfig().cutoffHourIST ? 1 : 2)
}

export const earliestDeliveryDate = (c, at = now()) => firstOpenDay(c, earliestRawDate(at))

/** Open delivery dates a customer can order for right now, earliest first. */
export async function orderableDates(c, at = now()) {
  const first = earliestRawDate(at)
  const last = addDays(first, getConfig().maxDaysAhead - 1)
  const closed = await closedDays(c, first, last)
  const out = []
  for (let d = first; d <= last; d = addDays(d, 1)) if (!closed.has(d)) out.push(d)
  return out
}

/** The next delivery day for a retry: the first open day after today (IST). */
export const nextDeliveryDay = (c, at = now()) => firstOpenDay(c, addDays(istParts(at).date, 1))

/**
 * Locks the day's calendar row (if any) and checks box capacity. Callers hold
 * the lock until their transaction ends, which serialises bookings per day.
 */
export async function checkCapacity(c, date, boxes, excludeOrderId = null) {
  const { rows } = await c.query('SELECT is_open, max_boxes FROM delivery_calendar WHERE date = $1 FOR UPDATE', [date])
  if (!rows.length) return
  if (!rows[0].is_open) throw conflict(`Deliveries are closed on ${date}`, 'DATE_CLOSED')
  if (rows[0].max_boxes == null) return
  const used = await c.query(
    `SELECT COALESCE(SUM(i.quantity), 0)::int AS n FROM orders o JOIN order_items i ON i.order_id = o.id
      WHERE o.delivery_date = $1 AND o.status NOT IN ('CANCELLED', 'RTO') AND o.id IS DISTINCT FROM $2`,
    [date, excludeOrderId],
  )
  if (used.rows[0].n + boxes > rows[0].max_boxes) throw conflict(`${date} is fully booked`, 'DATE_FULL')
}
