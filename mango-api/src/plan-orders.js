// Regular orders booked against the PLAN (migration 083; the owner: "if a variety is sold out / fully booked for this
// week for a normal order, tell them it will be delivered next week and let them choose the dates next week").
// README, Checkout → Booked against the plan.
//
// When no bookable day fits a bag (fruit owed to pre-orders, or simply none), the answer offers days AFTER the regular
// booking horizon: the first week, from the one holding the day after the horizon, where every variety in the bag has
// room. Room = the variety's expected kg for the week - pre-order kg - planned-order kg (preorders.js varietyRoom): one
// budget, so pre-orders and planned orders can't both be promised the same fruit. Only in season (OPEN), never past the
// season's end, PLAN_WEEKS_AHEAD weeks at most.
//
// A planned order takes NO stock when placed: a box taken now could be one next week's pre-orders are owed. It holds its
// week's kg (orders.plan_week, order_items.plan_kg). Once its day is within reach (the hold cut-off) and it is paid,
// the boxes it still needs are part of the hold (holdback.js), and fulfilPlannedOrders gives it real stock, OLDEST ORDER
// FIRST, whole orders only, from what the pre-orders of that time leave. It runs after the allocator: in maintenance and
// right after stock becomes sellable. If its day comes (the earliest delivery day) and the fruit is short, it moves to
// the next day real stock can serve, else to a day in a later week with plan room (one move a week at most, never day
// by day), the customer gets ORDER_DELAYED and may cancel for a full refund until it is packed. No day at all: it keeps
// its date, flagged at risk for staff.
//
// Pre-orders outrank planned orders: when a recalculation or a lowered number leaves a week short, planned orders that
// have no fruit yet move out first, newest first (preorder-plan.js, moveOutPlanned).
import { addDays, now, todayIST } from './clock.js'
import { getConfig } from './config.js'
import { tx } from './db.js'
import { checkCapacity, chooseSlot, closedDays, earliestDeliveryDate, orderableDates, slotsForDate } from './delivery.js'
import { dayRoom } from './earliest.js'
import { HttpError } from './errors.js'
import { holdCutoff } from './holdback.js'
import { logger } from './logger.js'
import { dateWords, enqueueOrderDelayed } from './notify.js'
import { addEvent, fillPlannedOrder, lockOrder, placeOnFirstDateWithStock, setRisk, sweepExpiredPlanned, SYSTEM } from './orders.js'
import { mondayOf, movePlanWeek, planRows, planVarietyOf, takePlanKg } from './plan-kg.js'
import { defaultWeekKg, regularHorizon, varietyRoom } from './preorders.js'
import { seasonPhase } from './season-phase.js'

/** How many weeks ahead a planned order may go. */
export const PLAN_WEEKS_AHEAD = 4
/** Why a bag is offered plan days (the quote's and the catalogue's `reason`). */
export const WEEK_BOOKED = 'WEEK_BOOKED'

const sundayOf = (d) => addDays(mondayOf(d), 6)

/** The weeks and their room for these varieties, the first day that can be offered, and closed days; null out of season. */
async function planContext(c, varieties, after) {
  const cfg = getConfig()
  if (seasonPhase(todayIST(), cfg) !== 'OPEN') return null
  const horizon = await regularHorizon(c)
  const first = addDays(after && after > horizon ? after : horizon, 1)
  const end = cfg.seasonEndsOn ?? null
  const weeks = []
  for (let w = mondayOf(first), i = 0; i < PLAN_WEEKS_AHEAD && (!end || w <= end); i++, w = addDays(w, 7)) weeks.push(w)
  if (!weeks.length) return null
  const [rooms, closed] = await Promise.all([varietyRoom(c, weeks, varieties), closedDays(c, first, addDays(weeks.at(-1), 6))])
  return { first, end, weeks, rooms, closed }
}

const fitsWeek = (ctx, i, rows) => rows.every(({ variety, kg }) => (ctx.rooms.get(variety)?.[i]?.remaining ?? 0) >= kg)

/** The open days of week number `i` that can be offered. */
function daysOf(ctx, i) {
  const out = []
  for (let n = 0; n < 7; n++) {
    const d = addDays(ctx.weeks[i], n)
    if (d >= ctx.first && (!ctx.end || d <= ctx.end) && !ctx.closed.has(d)) out.push(d)
  }
  return out
}

/**
 * What can be offered for `lines` ([{ sku, stage, qty }]): { reason, weekStart, from, dates: [{ date, slots }] }, the
 * first week with plan room for the whole bag and a day with room for all its boxes; null when there is none. One
 * delivery date is valid for every box. `after`: only days after this one (default: after the booking horizon).
 */
export async function planOffer(c, lines, { after = null } = {}) {
  const rows = planRows(lines)
  if (!rows.length) return null
  const ctx = await planContext(c, rows.map((r) => r.variety), after)
  if (!ctx) return null
  const boxes = lines.reduce((t, l) => t + l.qty, 0)
  for (let i = 0; i < ctx.weeks.length; i++) {
    if (!fitsWeek(ctx, i, rows)) continue
    const days = daysOf(ctx, i)
    if (!days.length) continue
    const room = await dayRoom(c, days)
    const dates = []
    for (const date of days.filter((d) => (room.get(d) ?? Infinity) >= boxes)) {
      const slots = (await slotsForDate(c, date)).filter((s) => s.remainingBoxes == null || s.remainingBoxes >= boxes)
      dates.push({ date, slots: slots.map(({ id, label, startsAt, endsAt, remainingBoxes, available }) => ({ id, label, startsAt, endsAt, remainingBoxes, available })) })
    }
    if (dates.length) return { reason: WEEK_BOOKED, weekStart: ctx.weeks[i], from: dates[0].date, dates }
  }
  return null
}

/**
 * For the catalogue (read on every page): one box of each of `skus`, Map sku -> { reason, weekStart, from, dates }. One
 * read of the weeks and one of the closed days, whatever the number of boxes; each day's own cap is checked at the quote.
 */
export async function planOffersFor(c, skus) {
  const out = new Map()
  if (!skus.length) return out
  const lines = new Map(skus.map((sku) => [sku, planRows([{ sku, qty: 1 }])]))
  const ctx = await planContext(c, [...new Set(skus.map(planVarietyOf))], null)
  if (!ctx) return out
  for (const [sku, rows] of lines) {
    if (rows.some((r) => r.kg <= 0)) continue
    for (let i = 0; i < ctx.weeks.length; i++) {
      const dates = fitsWeek(ctx, i, rows) ? daysOf(ctx, i) : []
      if (dates.length) {
        out.set(sku, { reason: WEEK_BOOKED, weekStart: ctx.weeks[i], from: dates[0], dates })
        break
      }
    }
  }
  return out
}

const limitOf = (variety) => defaultWeekKg(variety)
const noRoom = (sku) => new HttpError(409, 'STOCK_INSUFFICIENT', `That week has just filled up for ${sku}`, { sku })

/** At checkout: takes the bag's kg from its date's week, or 409 STOCK_INSUFFICIENT (the answer then offers what is left). */
export async function bookPlan(c, lines, date) {
  if (seasonPhase(todayIST(), getConfig()) !== 'OPEN') throw noRoom(lines[0]?.sku)
  const week = mondayOf(date)
  const rows = planRows(lines)
  const box = (variety) => lines.find((l) => planVarietyOf(l.sku) === variety)?.sku ?? variety
  for (const r of rows) {
    if (await takePlanKg(c, week, [r], { limitOf })) continue
    // Unpaid planned orders whose hold ran out give their room back, then once more.
    if (!(await sweepExpiredPlanned(c, week)) || !(await takePlanKg(c, week, [r], { limitOf }))) throw noRoom(box(r.variety))
  }
  return { week }
}

/** The bag's lines of an order, as planOffer and createOrder take them. */
const orderLines = async (c, id) =>
  (await c.query('SELECT sku, stage, quantity AS qty FROM order_items WHERE order_id = $1 ORDER BY sku, stage', [id])).rows

/** Flags a paid order as delayed by us and queues its one message. */
async function markDelayed(c, o, from, to, why, actor) {
  const { rows } = await c.query(
    `UPDATE orders SET delayed_at = $2, delayed_from_date = COALESCE(delayed_from_date, $3), delay_count = delay_count + 1 WHERE id = $1 RETURNING delay_count`,
    [o.id, now(), from],
  )
  await addEvent(c, o.id, o.status, o.status, actor, `Delayed from ${from} to ${to}: ${why}. The customer may cancel for a full refund until it is packed`)
  await enqueueOrderDelayed(c, { id: o.id, number: o.number, name: o.customer_name, phone: o.phone, count: rows[0].delay_count, from, to })
}

/**
 * Moves a planned order to a day in a later week with plan room for the whole order. Returns the new date, or null when
 * none has room (nothing changed). A paid order becomes delayed (ORDER_DELAYED, the cancel right); an unpaid one just
 * takes the new date (the shop shows it before paying).
 */
async function moveToLaterWeek(c, o, why, actor) {
  const from = o.delivery_date
  const lines = await orderLines(c, o.id)
  const offer = await planOffer(c, lines, { after: sundayOf(from) })
  if (!offer) return null
  const boxes = lines.reduce((t, l) => t + l.qty, 0)
  for (const { date } of offer.dates) {
    await c.query('SAVEPOINT plan_move')
    try {
      await checkCapacity(c, date, boxes, o.id)
      const slot = await chooseSlot(c, date, boxes, o.slot_id ?? null, { excludeOrderId: o.id })
      if (!(await movePlanWeek(c, o, mondayOf(date), { limitOf }))) {
        await c.query('ROLLBACK TO SAVEPOINT plan_move')
        return null
      }
      await c.query('UPDATE orders SET delivery_date = $2, slot_id = $3 WHERE id = $1', [o.id, date, slot])
      await c.query('RELEASE SAVEPOINT plan_move')
      o.delivery_date = date
      o.slot_id = slot
      if (o.status === 'PAYMENT_PENDING') await addEvent(c, o.id, o.status, o.status, actor, `Moved from ${from} to ${date}: ${why}`)
      else await markDelayed(c, o, from, date, why, actor)
      return date
    } catch (err) {
      await c.query('ROLLBACK TO SAVEPOINT plan_move')
      if (!(err instanceof HttpError)) throw err // a full or closed day: try the next
    }
  }
  return null
}

/** The fruit did not come for this paid order's day: the next day real stock can serve, else a later week of the plan. */
async function delayForShortFruit(c, o, actor) {
  const from = o.delivery_date
  const why = 'less fruit came in than planned'
  const days = (await orderableDates(c)).filter((d) => d > from)
  if (days.length && (await placeOnFirstDateWithStock(c, o, days, actor, why))) {
    await markDelayed(c, o, from, o.delivery_date, why, actor)
    await setRisk(c, o, [], actor)
    return o.delivery_date
  }
  const date = await moveToLaterWeek(c, o, why, actor)
  if (date) await setRisk(c, o, [], actor)
  else await setRisk(c, o, ['The fruit came in short and no later day has room in the plan: choose a day by hand or cancel with a refund'], actor)
  return date
}

/**
 * Gives paid planned orders whose day is within reach their fruit: oldest order first, whole orders only. Runs after the
 * allocator, so the hold has already served (or still protects) the pre-orders. One run at a time. An order whose day
 * has come without fruit is delayed. Returns { filled, delayed, stuck }.
 */
export async function fulfilPlannedOrders() {
  try {
    return await tx(async (c) => {
      const { rows: [run] } = await c.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok', ['mango:fulfil-planned'])
      if (!run.ok) return { filled: 0, delayed: 0, stuck: 0, busy: true }
      const { rows } = await c.query(
        `SELECT o.* FROM orders o
          WHERE o.planned AND o.status IN ('CONFIRMED', 'PROCESSING') AND o.delivery_date <= $1
            AND EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.quantity > COALESCE((SELECT SUM(s.quantity) FROM order_stock s
                  WHERE s.order_id = o.id AND s.sku = i.sku AND s.stage = i.stage AND s.state IN ('held', 'committed', 'packed')), 0))
          ORDER BY o.placed_at, o.id LIMIT 200 FOR UPDATE OF o SKIP LOCKED`,
        [holdCutoff()],
      )
      const earliest = await earliestDeliveryDate(c)
      const out = { filled: 0, delayed: 0, stuck: 0 }
      for (const o of rows) {
        if (await fillPlannedOrder(c, o, SYSTEM)) out.filled++
        else if (o.delivery_date <= earliest) {
          if (await delayForShortFruit(c, o, SYSTEM)) out.delayed++
          else out.stuck++
        }
      }
      return out
    })
  } catch (err) {
    logger.error({ err }, 'planned orders could not be fulfilled in this run; the next one retries')
    return { filled: 0, delayed: 0, stuck: 0, failed: true }
  }
}

/** Planned orders of a variety that have no fruit yet and so can still move, newest first: [{ id, number, week, kg, paid }]. */
export async function movablePlanned(c, variety) {
  const { rows } = await c.query(
    `SELECT o.id, o.number, o.plan_week AS week, o.status, SUM(i.plan_kg) AS kg
       FROM orders o JOIN order_items i ON i.order_id = o.id
      WHERE o.planned AND o.plan_week IS NOT NULL AND i.plan_variety = $1 AND o.status IN ('PAYMENT_PENDING', 'CONFIRMED', 'PROCESSING')
        AND NOT EXISTS (SELECT 1 FROM order_stock s WHERE s.order_id = o.id AND s.state IN ('held', 'committed', 'packed'))
      GROUP BY o.id ORDER BY o.placed_at DESC, o.id DESC`,
    [variety],
  )
  return rows.map((r) => ({ id: r.id, number: r.number, week: r.week, kg: Number(r.kg), paid: r.status !== 'PAYMENT_PENDING' }))
}

/**
 * A recalculation left this order's week short: it moves out (its own transaction, after the pre-orders moved). Looked at
 * again under lock: nothing happens when it got fruit, was cancelled, or the week is no longer over its budget.
 * Returns { moved: date } , { noRoom: true } (flagged at risk for staff) or null.
 */
export function moveOutPlanned(id, variety, why, actor = SYSTEM) {
  return tx(async (c) => {
    const o = await lockOrder(c, id)
    if (!o.planned || !o.plan_week || !['PAYMENT_PENDING', 'CONFIRMED', 'PROCESSING'].includes(o.status)) return null
    const { rows: stock } = await c.query(`SELECT 1 FROM order_stock WHERE order_id = $1 AND state IN ('held', 'committed', 'packed') LIMIT 1`, [id])
    if (stock.length) return null
    const room = (await varietyRoom(c, [o.plan_week], [variety])).get(variety)[0]
    if (room.over <= 0) return null
    const from = o.delivery_date
    const date = await moveToLaterWeek(c, o, why, actor)
    if (date) return { moved: date, from, paid: o.status !== 'PAYMENT_PENDING', number: o.number, id: o.id }
    await setRisk(c, o, ['The plan was lowered and no later week has room for this order: choose a day by hand or cancel with a refund'], actor)
    return { noRoom: true }
  })
}

/** For the shop's and panel's views: { planned, plannedWeek, waitingForFruit } (empty for other orders). */
export const plannedView = (o, waiting) => (o.planned ? { planned: true, plannedWeek: mondayOf(o.delivery_date), waitingForFruit: Boolean(waiting) } : {})

/** "next week", or "the week of Mon, 7 Dec" when the offer is a later one: the words customers read. */
export const planWeekWords = (weekStart, at = now()) => (weekStart === addDays(mondayOf(todayIST(at)), 7) ? 'next week' : weekStart === mondayOf(todayIST(at)) ? 'later this week' : `the week of ${dateWords(weekStart)}`)

/** Boxes still missing on an order, in SQL over `o`: EXISTS true while a planned order waits for fruit. */
export const WAITING_SQL = `EXISTS (SELECT 1 FROM order_items wi WHERE wi.order_id = o.id AND wi.quantity > COALESCE((SELECT SUM(ws.quantity) FROM order_stock ws
  WHERE ws.order_id = o.id AND ws.sku = wi.sku AND ws.stage = wi.stage AND ws.state IN ('held', 'committed', 'packed')), 0))`

