// The earliest delivery day a bag can have (the owner: "if we run out of stock for today then we
// update the delivery date accordingly").
//
// A day works for a bag when it is a day the customer may book (delivery.js orderableDates: the
// cut-off hour, maxDaysAhead, closed days), every line has enough sellable stock that day under the
// usual rules (inventory.js availabilityByDate: real stock after QC, in-transit stock at the forecast
// confidence once its truck is due, the box's ripeness on that day), and the day still has room for
// the whole bag (the day's box cap in delivery_calendar and, when slots are in use, at least one slot
// with room for every box). The first such day is the bag's earliest date. Each line also gets the
// first day it fits on its own, and the first day each other ripeness of the same box fits, so a
// customer whose raw box is gone can be offered the semi-ripe one (never swapped silently).
//
// earliestPlan is the rule (pure, no database); findEarliest feeds it from the database.
import { now } from './clock.js'
import { orderableDates, slotsForDate } from './delivery.js'
import { availabilityByDate } from './inventory.js'
import { SALE_STAGES, saleStage } from './stage.js'

const keyOf = (sku, stage) => `${sku}|${saleStage(stage)}`

/**
 * The rule. `dates`: the bookable days, earliest first. `pools`: Map date → Map "sku|stage" → boxes
 * free that day. `room`: Map date → boxes the day can still take (missing = no limit). `lines`:
 * [{ sku, stage, qty }]. Two lines for the same box and ripeness draw on the same stock.
 *
 * Returns { earliestDate, lines: [{ sku, stage, qty, available, earliestDate, otherStages }], neverFit,
 * days: [{ date, ok, full, short: [{ sku, stage, qty, available }] }] } where `available` is the
 * stock on `requestedDate` (or the first day when none is given) and neverFit lists the lines no
 * day in the window can supply.
 */
export function earliestPlan({ dates, pools, room = new Map(), lines, requestedDate = null }) {
  const need = new Map()
  for (const l of lines) need.set(keyOf(l.sku, l.stage), (need.get(keyOf(l.sku, l.stage)) ?? 0) + l.qty)
  const total = lines.reduce((s, l) => s + l.qty, 0)
  const free = (d, key) => pools.get(d)?.get(key) ?? 0
  const roomOn = (d) => room.get(d) ?? Infinity
  const fits = (d, key, qty) => free(d, key) >= qty && roomOn(d) >= qty
  const days = dates.map((d) => {
    const short = [...need].filter(([k, q]) => free(d, k) < q).map(([k, q]) => {
      const [sku, stage] = k.split('|')
      return { sku, stage, qty: q, available: free(d, k) }
    })
    const full = roomOn(d) < total
    return { date: d, ok: !short.length && !full, full, short }
  })
  const asked = requestedDate ?? dates[0]
  const perLine = lines.map((l) => {
    const key = keyOf(l.sku, l.stage)
    const qty = need.get(key)
    return {
      sku: l.sku, stage: l.stage, qty: l.qty,
      available: asked ? free(asked, key) : 0,
      earliestDate: dates.find((d) => fits(d, key, qty)) ?? null,
      otherStages: SALE_STAGES.filter((s) => s !== saleStage(l.stage)).map((s) => ({
        stage: s, earliestDate: dates.find((d) => fits(d, keyOf(l.sku, s), l.qty)) ?? null,
      })),
    }
  })
  return {
    earliestDate: days.find((x) => x.ok)?.date ?? null,
    lines: perLine,
    neverFit: perLine.filter((l) => !l.earliestDate).map(({ sku, stage, qty }) => ({ sku, stage, qty })),
    days,
  }
}

/**
 * Boxes each date can still take: the day's cap (delivery_calendar.max_boxes less what is booked,
 * counted as delivery.js BOOKED counts it) and, when slots are in use, the roomiest slot. A date
 * with neither limit is left out (no limit).
 */
export async function dayRoom(c, dates) {
  const room = new Map()
  if (!dates.length) return room
  const { rows } = await c.query(
    `SELECT d.date, d.is_open, d.max_boxes,
            COALESCE((SELECT SUM(i.quantity) FROM orders o JOIN order_items i ON i.order_id = o.id
                       WHERE o.delivery_date = d.date AND o.status NOT IN ('CANCELLED', 'RTO')
                         AND NOT (o.status = 'PAYMENT_PENDING' AND COALESCE(o.hold_expires_at < $2::timestamptz, FALSE))), 0)::int AS booked
       FROM delivery_calendar d WHERE d.date = ANY($1::date[])`,
    [dates, now()],
  )
  for (const r of rows) {
    if (!r.is_open) room.set(r.date, 0)
    else if (r.max_boxes != null) room.set(r.date, Math.max(0, r.max_boxes - r.booked))
  }
  for (const d of dates) {
    const slots = await slotsForDate(c, d)
    if (!slots.length) continue
    const best = slots.some((s) => s.remainingBoxes == null) ? Infinity : Math.max(0, ...slots.map((s) => s.remainingBoxes))
    if (best < (room.get(d) ?? Infinity)) room.set(d, best)
  }
  return room
}

/**
 * The earliest date for `lines` ([{ sku, stage, qty }]) among the days a customer can book now,
 * with per-line dates (earliestPlan). `requestedDate`: the day the customer chose, for `available`.
 */
export async function findEarliest(c, lines, { requestedDate = null, dates = null } = {}) {
  const days = dates ?? (await orderableDates(c))
  const [pools, room] = await Promise.all([availabilityByDate(c, days), dayRoom(c, days)])
  return { dates: days, ...earliestPlan({ dates: days, pools, room, lines, requestedDate }) }
}

/** "Thu, 19 Nov" for a "YYYY-MM-DD" day (the shop's own words). */
export function dayLabel(date) {
  const d = new Date(`${date}T00:00:00Z`)
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}, ${d.getUTCDate()} ${d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}`
}
