// Preorders (playbook section 9). A customer books a SKU, ripeness and
// quantity before the fruit exists, at a locked price, and pays in full by
// Razorpay payment link. The delivery WEEK is not chosen: every delivery week
// takes up to its expected kilograms of pre-orders across all boxes (the rule
// preorderDayKg x 7, about a 1,000 kg batch a day, or the week's own expected kg
// set on the Pre-orders page; migrations 074 and 076), the weeks exist by themselves
// (deliveryWeeks), and a booking gets the earliest week with room for its kg
// (assignWeek), taken with a conditional write on the week's counter
// (preorder_week_kg) so a launch-day rush cannot overbook a week. Only when every week to the season's end is
// full does a booking join the waitlist, promoted in booking order as room
// frees up. The per-box table preorder_capacity decides nothing any more: its
// `reserved` is still kept per box and week, for the panel and the INV-06 check.
// Before a week opens to regular orders, the allocator turns each paid
// preorder into a normal confirmed order on a date with stock, so preorders
// get first claim on the fruit. Weeks start on Monday.
//
// Pre-orders are non-refundable once paid (non_refundable, migration 064): the
// customer can drop an unpaid or waitlisted booking, but not a paid one, nor
// the order it became. Bookings made before that rule keep the promise they
// were sold under (cancel until packing for a full refund). Unchanged: a
// manager's cancel (a week we can't fill) refunds in full; a payment that lands
// after the hold ran out is still booked, and one after a cancel is refunded
// automatically; quality claims on the delivered order work as for any order.
//
// The shop takes bookings from the day pre-orders open (season-phase.js);
// before that, booking is refused with PREORDERS_NOT_OPEN.
import { addDays, now, todayIST } from './clock.js'
import { getConfig } from './config.js'
import { query, tx } from './db.js'
import { earliestDeliveryDate, orderableDates } from './delivery.js'
import { badRequest, conflict, HttpError, notFound } from './errors.js'
import { newId } from './ids.js'
import { formatOrderNumber, LETTERED, nextOrderNumber } from './order-number.js'
import { logger } from './logger.js'
import { dateWords, enqueuePreorder, enqueuePreorderMoves, sendNotificationsNow, weekWords } from './notify.js'
import { cancelOrder, createOrder, customerCancel, customerCancelDelayed, LAZY_SWEEP_GATEWAY_GRACE_MS, NON_REFUNDABLE_PREORDER_MESSAGE, recordDuplicatePayment, sweepExpiredPlanned, SYSTEM } from './orders.js'
import { canStartCall } from './budget.js'
import { applyCapture, claimRefund, GATEWAY_CALL_MS, createPaymentLink, fetchLinkPayments, gatewayRefund, refundAttemptFailed, refundReceipt } from './payments.js'
import { boxKg, findProduct, sellable, shopProducts, shownVariety } from './products.js'
import { seasonPhase } from './season-phase.js'
import { mondayOf } from './plan-kg.js'
import { giverFields, openLinks, PENDING } from './gift-address.js'

/** A waitlisted customer whose spot opens has this long to pay. */
export const SPOT_HOLD_HOURS = 12
export const PREORDER_STATUSES = ['PAYMENT_PENDING', 'BOOKED', 'WAITLISTED', 'CONVERTED', 'CANCELLED']

/** What a customer is told when a paid non-refundable booking (or its order) can't be cancelled. */
export const NON_REFUNDABLE_MESSAGE = NON_REFUNDABLE_PREORDER_MESSAGE
export const nonRefundable = () => new HttpError(409, 'PREORDER_NON_REFUNDABLE', NON_REFUNDABLE_MESSAGE)

/**
 * Delayed by us (migration 079): we moved it to a later week than the first one it was promised (delayed_from_week),
 * by a recalculation of the plan, the allocator (a week passed without fruit) or a manager. It stays delayed for good
 * (the owner): the customer's right to cancel lasts until packed, and the booking is never moved to an earlier week again.
 */
export const isDelayed = (p) => Boolean(p.delayed_at && p.delayed_from_week)
/** Order statuses before packing: a delayed pre-order's order can still be cancelled for a full refund (the owner: "only before packaging is done"). */
export const BEFORE_PACKED = ['CONFIRMED', 'PROCESSING']
/**
 * Whether the customer may still cancel a booking themselves: an unpaid or waitlisted one; a paid one sold before the
 * non-refundable rule; and a paid one WE DELAYED (isDelayed), for a full refund, while it is booked and, once it became
 * a delivery order, until that order is packed (`orderStatus`: the converted order's status, when known).
 */
export const customerMayCancel = (p, orderStatus = p.order_status ?? null) =>
  p.status === 'PAYMENT_PENDING' || p.status === 'WAITLISTED' || (!p.non_refundable && (p.status === 'BOOKED' || p.status === 'CONVERTED')) ||
  (isDelayed(p) && (p.status === 'BOOKED' || (p.status === 'CONVERTED' && BEFORE_PACKED.includes(orderStatus))))
/** What the shop shows about a delay: { fromWeek, toWeek, at, count }, or null when the booking is not delayed. */
export const delayView = (p) => (isDelayed(p) ? { fromWeek: p.delayed_from_week, toWeek: p.week_start, at: p.delayed_at, count: p.delay_count } : null)

export const isMonday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1

/** The last date regular customers can book; preorders own every later date. */
export async function regularHorizon(c) {
  const dates = await orderableDates(c)
  return dates.at(-1) ?? addDays(todayIST(), getConfig().maxDaysAhead)
}

export function addPreorderEvent(c, id, status, actor, reason = null) {
  return event(c, id, status, actor, reason)
}

async function event(c, id, status, actor, reason = null) {
  await c.query('INSERT INTO preorder_events (id, preorder_id, status, reason, actor, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
    newId('pev'), id, status, reason, actor.label ?? actor.id, now(),
  ])
}

// ---------------------------------------------------------------- delivery weeks and their one limit (migration 074)

/** Weeks offered from the first one when the season has no end date set, so a full week always has a next one. */
export const WEEK_HORIZON = 26

/**
 * What one booking takes from its delivery week's limit (weekLimit): its weight in kg, boxes x the
 * box's kg (products.js boxKg, "3kg" -> 3). The owner counts a week's batch in kilograms ("1000 kg a day, 7000 kg
 * a week"); a gift for several people is one booking per person, each with its own weight. A booking keeps the
 * weight it was booked with (preorders.load_kg, migration 076), so a box size edited later can't change what its
 * release gives back. This is the ONE place that decides it; the SQL that counts the same thing (WEEK_LOAD_SQL:
 * the INV-06 check and its recount, and migration 076's backfill) and the shop's `countsBy` (WEEK_COUNTS_BY) must
 * change with it.
 */
export const weekLoad = (p) => roundKg(p.load_kg != null ? Number(p.load_kg) : p.qty * boxKg(p.sku))
/** weekLoad over a preorders row `p` joined to its product `pr`, in SQL: `SUM(${WEEK_LOAD_SQL})` is what a week's bookings take. */
export const WEEK_LOAD_SQL = `COALESCE(p.load_kg, p.qty * COALESCE(substring(pr.box_size from '^\\s*([0-9]+(?:\\.[0-9]+)?)')::numeric, 0))`
/** What the limit counts, as the shop is told (GET /v1/preorders/weeks `countsBy`): 'kg' (before 076: 'orders'). */
export const WEEK_COUNTS_BY = 'kg'
/** Kilograms to the gram, so sums of numeric(12,3) and JS numbers compare exactly. */
export const roundKg = (x) => Math.round(Number(x) * 1000) / 1000

/** Delivery days in a week: the week's default limit is the daily kg times this. */
export const DELIVERY_DAYS_PER_WEEK = 7

// The plan is per VARIETY (migration 078, the owner: "expected kg per day per variety"): each variety's boxes share
// that variety's weekly kg, and a booking only ever counts against its own variety. A Mixed Box is its own variety
// (its line in the plan): the products data does not say which varieties are in it.

/** The variety a box counts against (products.variety, e.g. "Alphonso"; "Mixed Box", a key: customers see "Mixed Variety Mangoes", products.js shownVariety). */
export const varietyOf = (sku) => findProduct(sku)?.variety ?? sku
/** The variety a booking counts against: the one it was booked with (preorders.variety, 078), else its box's. */
export const bookingVariety = (p) => p.variety ?? varietyOf(p.sku)
/** The varieties on sale, in the shop's order: the plan's lines. */
export const planVarieties = () => [...new Set(shopProducts().map((p) => p.variety))]
/**
 * Mangoes of `variety` expected per day for pre-orders, in kg: its own number in the plan (rule preorderVarietyDayKg),
 * else the number for varieties not listed (preorderOtherVarietyDayKg, 20 kg unless a manager changed it). `rules`: the live rules, or the rules a manager is previewing.
 */
/** The owner's placeholder until real numbers are typed in: 20 kg a day for each variety. */
export const PLACEHOLDER_DAY_KG = 20
const dayKgOf = (variety, rules) => Number(rules.preorderVarietyDayKg?.[variety] ?? rules.preorderOtherVarietyDayKg ?? PLACEHOLDER_DAY_KG)
export const varietyDayKg = (variety, rules = getConfig()) => roundKg(dayKgOf(variety, rules))
/** A variety's week when the week has no expected kg of its own: its daily kg x 7. No variety: a variety not listed. */
export const defaultWeekKg = (variety = null, rules = getConfig()) => roundKg(dayKgOf(variety, rules) * DELIVERY_DAYS_PER_WEEK)
/** A variety's limit in a week, in kg: the week's own expected kg for it (preorder_variety_week_kg.limit_kg) or the default. */
export const weekLimit = (variety, own = null, rules = getConfig()) => (own != null ? roundKg(own) : defaultWeekKg(variety, rules))

/** The largest limit of `variety` among `weeks`: a booking heavier than it can never be booked. */
const biggestWeek = async (c, weeks, variety) => Math.max(0, ...(await weekRoom(c, weeks, variety)).map((w) => w.limit))

/** The earliest of `room` (weekRoom) with room for `load` kg, or null. A booking is never split across weeks. */
export const weekFor = (room, load) => room.find((w) => w.remaining >= load) ?? null

/** The Monday on or before a date (YYYY-MM-DD). */
export { mondayOf }

/**
 * The delivery weeks pre-orders are taken for, in order (their Mondays). No staff rows: they exist by
 * themselves, from the first Monday after the regular booking horizon (before the season, from the week
 * holding the season's first day: a week ending before the season is never offered, as before)
 * week after week, to the week holding seasonEndsOn, or WEEK_HORIZON weeks when the season has no end set.
 */
export async function deliveryWeeks(c) {
  const cfg = getConfig()
  let first = mondayOf(addDays(await regularHorizon(c), 7))
  const starts = cfg.seasonStartsOn ?? null
  if (starts && todayIST() < starts && mondayOf(starts) > first) first = mondayOf(starts)
  const last = cfg.seasonEndsOn ?? addDays(first, (WEEK_HORIZON - 1) * 7)
  const weeks = []
  for (let w = first; w <= last && weeks.length < 60; w = addDays(w, 7)) weeks.push(w)
  return weeks
}

/** The last day the allocator turns bookings into delivery orders for now: one day past the regular booking horizon. */
export const allocationHorizon = async (c) => addDays(await regularHorizon(c), 1)

/**
 * The weeks of `weeks` that are FROZEN: their bookings have started turning into deliveries, so a recalculation of the
 * plan leaves them (and every booking in them) exactly as they are. A week is frozen when
 *   - it starts on or before the allocator's horizon (allocationHorizon): the allocator is converting its bookings
 *     to delivery orders now, from the stock that is there, or
 *   - any booking in it is already CONVERTED (a delivery order exists for it).
 * A booking in a frozen week that finds no stock is moved by the allocator itself, a week at a time (the delayed path).
 */
export async function frozenWeeks(c, weeks) {
  const h = await allocationHorizon(c)
  const { rows } = await c.query(`SELECT DISTINCT week_start FROM preorders WHERE status = 'CONVERTED' AND week_start = ANY($1::date[])`, [weeks])
  return new Set([...weeks.filter((w) => w <= h), ...rows.map((r) => r.week_start)])
}

/** One variety's week as weekRoom shows it, from its counter row (or none). */
const roomOf = (weekStart, variety, r, rules) => {
  const reserved = roundKg(r?.reserved_kg ?? 0)
  // One budget per variety and week (migration 083): regular orders booked against the plan count too.
  const planned = roundKg(r?.planned_kg ?? 0)
  const own = r?.limit_kg != null ? roundKg(r.limit_kg) : null
  const limit = weekLimit(variety, own, rules)
  return { weekStart, limit, own, reserved, planned, remaining: roundKg(Math.max(limit - reserved - planned, 0)), over: roundKg(Math.max(reserved + planned - limit, 0)) }
}

/**
 * Every variety's weeks, in order: Map variety -> [{ weekStart, limit, own, reserved, remaining, over }], for the
 * varieties on sale (planVarieties) and any other that has a counter row in these weeks (a box taken off sale with
 * bookings left). `own` is the week's own expected kg for that variety (null: daily x 7). A week lowered below what it
 * holds (the harvest came in short) has `over` > 0 and no room. `rules`: the live rules, or a manager's preview.
 */
export async function varietyRoom(c, weeks = null, varieties = null, rules = getConfig(), { lapsed = false } = {}) {
  weeks ??= await deliveryWeeks(c)
  const { rows } = await c.query(
    'SELECT week_start, variety, reserved_kg, planned_kg, limit_kg FROM preorder_variety_week_kg WHERE week_start = ANY($1::date[])',
    [weeks],
  )
  // `lapsed`: what a customer is shown (openWeeks, quotePreorderBag) counts the week as a booking finds it, without the
  // unpaid holds that ran out and that the booking's own lazy sweep gives back first (lapsedHoldKg). The counters
  // themselves are unchanged: the plan, the panel and the checks read them as they are.
  const gone = lapsed ? await lapsedHoldKg(c, weeks) : null
  const less = (r, k) => {
    const x = gone?.get(k)
    if (!x) return r
    return { ...r, reserved_kg: Math.max(Number(r.reserved_kg ?? 0) - x.reserved, 0), planned_kg: Math.max(Number(r.planned_kg ?? 0) - x.planned, 0) }
  }
  const by = new Map(rows.map((r) => [`${r.week_start}|${r.variety}`, less(r, `${r.week_start}|${r.variety}`)]))
  const names = varieties ?? [...new Set([...planVarieties(), ...rows.map((r) => r.variety)])]
  return new Map(names.map((v) => [v, weeks.map((w) => roomOf(w, v, by.get(`${w}|${v}`), rules))]))
}

/**
 * The kg in `weeks` held by unpaid holds that ran out and that a booking's lazy sweep (assignWeek: expireWeekHolds for
 * pre-orders, sweepExpiredPlanned for regular orders booked against the plan) would give back now, by the same rule
 * (PAY-B5: left alone until Razorpay was asked about it after its hold, or for 2 minutes after the hold). Read only:
 * Map `week|variety` -> { reserved, planned }. Without it a quote counted an expired hold that the confirm's sweep then
 * freed, so confirm found an earlier week, refused with 409 PREORDER_WEEK_CHANGED and rolled the sweep back with it:
 * the next quote said the same later week again, for ever (until the maintenance sweep ran).
 */
async function lapsedHoldKg(c, weeks, at = now()) {
  const grace = new Date(at.getTime() - LAZY_SWEEP_GATEWAY_GRACE_MS)
  const out = new Map()
  const add = (k, field, kg) => {
    const x = out.get(k) ?? { reserved: 0, planned: 0 }
    x[field] = roundKg(x[field] + kg)
    out.set(k, x)
  }
  const { rows: pre } = await c.query(
    `SELECT week_start, variety, sku, qty, load_kg FROM preorders
      WHERE status = 'PAYMENT_PENDING' AND week_start = ANY($1::date[]) AND hold_expires_at < $2
        AND (reconcile_checked_at >= hold_expires_at OR hold_expires_at < $3)`,
    [weeks, at, grace],
  )
  for (const p of pre) add(`${p.week_start}|${bookingVariety(p)}`, 'reserved', weekLoad(p))
  const { rows: planned } = await c.query(
    `SELECT o.plan_week AS week_start, i.plan_variety AS variety, SUM(i.plan_kg) AS kg FROM orders o JOIN order_items i ON i.order_id = o.id
      WHERE o.planned AND o.status = 'PAYMENT_PENDING' AND o.plan_week = ANY($1::date[]) AND o.hold_expires_at < $2 AND i.plan_kg IS NOT NULL
        AND ((o.razorpay_order_id IS NULL AND o.payment_link_id IS NULL AND o.gift_order_id IS NULL) OR o.reconcile_checked_at >= o.hold_expires_at OR o.hold_expires_at < $3)
      GROUP BY 1, 2`,
    [weeks, at, grace],
  )
  for (const r of planned) add(`${r.week_start}|${r.variety}`, 'planned', roundKg(r.kg))
  return out
}

/** One variety's weeks with their limit and what is left, in kg, in order (varietyRoom). */
export async function weekRoom(c, weeks = null, variety = null, rules = getConfig()) {
  weeks ??= await deliveryWeeks(c)
  return (await varietyRoom(c, weeks, [variety], rules)).get(variety)
}

/** All varieties of each week added up: [{ weekStart, limit, reserved, remaining, over }] (what the shop's older code reads). */
export const weekTotals = (rooms, weeks) =>
  weeks.map((w, i) => {
    const sum = (k) => roundKg([...rooms.values()].reduce((t, room) => t + (room[i]?.[k] ?? 0), 0))
    return { weekStart: w, limit: sum('limit'), own: null, reserved: sum('reserved'), planned: sum('planned'), remaining: sum('remaining'), over: sum('over') }
  })

/**
 * Sets a week's own expected kg for one variety (`limitKg`; null: back to the default, its daily kg x 7). Lowering it
 * below what is booked is allowed (new pre-orders then skip the week; the Pre-order plan's recalculation moves the
 * newest bookings out, preview first); raising it makes room, and the waitlist is offered it by the caller
 * (promoteWaitlist). Without a variety (an older panel: one number for every box), the number is split evenly over the
 * varieties on sale, as migration 078 did. Returns the variety's week as weekRoom shows it (no variety: the totals).
 */
export async function setWeekLimit(c, week, limitKg, variety = null) {
  const names = variety ? [variety] : planVarieties()
  const each = limitKg == null ? null : variety ? limitKg : roundKg(limitKg / Math.max(names.length, 1))
  for (const v of names) {
    await c.query(
      `INSERT INTO preorder_variety_week_kg (week_start, variety, reserved_kg, limit_kg) VALUES ($1, $2, 0, $3)
       ON CONFLICT (week_start, variety) DO UPDATE SET limit_kg = EXCLUDED.limit_kg`,
      [week, v, each],
    )
  }
  // The previous release's one number for every box (076), kept so a rollback limits the week as the manager meant.
  if (!variety) {
    await c.query(
      `INSERT INTO preorder_week_kg (week_start, reserved_kg, limit_kg) VALUES ($1, 0, $2) ON CONFLICT (week_start) DO UPDATE SET limit_kg = EXCLUDED.limit_kg`,
      [week, limitKg],
    )
    return weekTotals(await varietyRoom(c, [week]), [week])[0]
  }
  return (await weekRoom(c, [week], variety))[0]
}

/**
 * Takes a booking's kg (weekLoad) from a week's limit in one conditional write, or returns false when the week
 * would go over its limit (its own expected kg, else the default: weekLimit). The week's row is created on first use; two bookings at once queue on that row, and the second
 * sees the first's count (INSERT ... ON CONFLICT DO UPDATE re-checks its WHERE against the latest row), so a week
 * never takes more than its limit. `force` always takes it: a payment after the hold ran out, a week moved for want
 * of stock. Two counts follow that decide nothing: migration 074's one-per-booking counter (preorder_weeks, so a
 * rollback to the release that booked by it finds it right) and the box's own count (preorder_capacity, the panel).
 */
async function reserve(c, p, week, { force = false } = {}) {
  const variety = bookingVariety(p)
  const r = await c.query(
    `INSERT INTO preorder_variety_week_kg (week_start, variety, reserved_kg)
     SELECT $1::date, $2, $3::numeric
      WHERE $4::boolean OR $3::numeric <= COALESCE((SELECT limit_kg FROM preorder_variety_week_kg WHERE week_start = $1 AND variety = $2), $5::numeric)
     ON CONFLICT (week_start, variety) DO UPDATE SET reserved_kg = preorder_variety_week_kg.reserved_kg + EXCLUDED.reserved_kg
      WHERE $4::boolean OR preorder_variety_week_kg.reserved_kg + preorder_variety_week_kg.planned_kg + EXCLUDED.reserved_kg <= COALESCE(preorder_variety_week_kg.limit_kg, $5::numeric)`,
    [week, variety, weekLoad(p), force, defaultWeekKg(variety)],
  )
  if (!r.rowCount) return false
  // 076's one kg counter for every box: decides nothing since 078, kept up to date for a rollback (never refuses).
  await c.query(
    `INSERT INTO preorder_week_kg (week_start, reserved_kg) VALUES ($1, $2) ON CONFLICT (week_start) DO UPDATE SET reserved_kg = preorder_week_kg.reserved_kg + EXCLUDED.reserved_kg`,
    [week, weekLoad(p)],
  )
  await c.query(
    `INSERT INTO preorder_weeks (week_start, reserved) VALUES ($1, 1) ON CONFLICT (week_start) DO UPDATE SET reserved = preorder_weeks.reserved + 1`,
    [week],
  )
  await c.query(
    `INSERT INTO preorder_capacity (sku, week_start, capacity, reserved) VALUES ($1, $2, 0, $3)
     ON CONFLICT (sku, week_start) DO UPDATE SET reserved = preorder_capacity.reserved + $3`,
    [p.sku, week, p.qty],
  )
  return true
}

/**
 * What a move to week `to` does to a booking's delay (migration 079). Only a PAID booking (BOOKED) is delayed: later
 * than its week keeps the first week it was promised (delayed_from_week), stamps delayed_at and counts it. A delay is never
 * undone (a delayed booking does not move earlier: moveBooking, preorder-plan.js). An unpaid booking just takes the new week.
 */
export function delayAfterMove(p, to, at = now()) {
  const same = { delayed_at: p.delayed_at ?? null, delayed_from_week: p.delayed_from_week ?? null, delay_count: p.delay_count ?? 0 }
  if (p.status !== 'BOOKED') return same
  if (to > p.week_start) return { delayed_at: at, delayed_from_week: p.delayed_from_week ?? p.week_start, delay_count: (p.delay_count ?? 0) + 1 }
  return same
}

/**
 * Moves one booking to week `to` on THE delayed/earlier path every move takes (a recalculation does the same in bulk,
 * preorder-plan.js): its kg moves (taken first: false when `to` has no room, unless `force`), delayAfterMove, an event,
 * and a paid booking's customer is told: PREORDER_DELAYED (later: may now cancel for a full refund until packed) or
 * PREORDER_EARLIER. Used by a manager's move and the allocator's week-without-fruit move. Returns the row after it.
 */
export async function moveBooking(c, p, to, actor, why, { force = false } = {}) {
  if (p.delayed_at && to < p.week_start) throw conflict('This order was delayed, so it can\u2019t be brought forward.', 'DELAYED_NOT_EARLIER')
  if (!(await reserve(c, p, to, { force }))) return null
  await release(c, p)
  const d = delayAfterMove(p, to)
  const { rows } = await c.query(
    `UPDATE preorders SET week_start = $2, moved_count = moved_count + 1, delayed_at = $3, delayed_from_week = $4, delay_count = $5 WHERE id = $1 RETURNING *`,
    [p.id, to, d.delayed_at, d.delayed_from_week, d.delay_count],
  )
  const after = rows[0]
  await event(c, p.id, p.status, actor, `${to > p.week_start ? 'Delayed' : 'Moved earlier'} from the week of ${p.week_start} to the week of ${to}: ${why}`)
  if (p.status === 'BOOKED') {
    await enqueuePreorderMoves(c, [{ id: p.id, number: p.number, name: p.customer_name, phone: p.phone, movedCount: after.moved_count, kind: to > p.week_start ? 'PREORDER_DELAYED' : 'PREORDER_EARLIER', from: p.week_start, to }])
  }
  return after
}

/** Gives a booking's kg back to its week (and its one-per-booking and box counts). */
async function release(c, p) {
  await c.query('UPDATE preorder_variety_week_kg SET reserved_kg = GREATEST(reserved_kg - $3::numeric, 0) WHERE week_start = $1 AND variety = $2', [
    p.week_start, bookingVariety(p), weekLoad(p),
  ])
  await c.query('UPDATE preorder_week_kg SET reserved_kg = GREATEST(reserved_kg - $2::numeric, 0) WHERE week_start = $1', [p.week_start, weekLoad(p)])
  await c.query('UPDATE preorder_weeks SET reserved = GREATEST(reserved - 1, 0) WHERE week_start = $1', [p.week_start])
  await c.query('UPDATE preorder_capacity SET reserved = GREATEST(reserved - $3, 0) WHERE sku = $1 AND week_start = $2', [p.sku, p.week_start, p.qty])
}

/**
 * The earliest of `weeks` with room for the booking `p` ({ sku, qty } or a row) and its whole kg, taken (reserve);
 * null when none has. A booking is never split: a 5 kg booking that doesn't fit what is left of a week goes to the
 * next week with room, and a smaller one booked after it may still fit the earlier week. A week that looks full
 * first lets unpaid holds that ran out give their room back (expireWeekHolds), as before. Weeks are tried in date
 * order (a finite list), so bookings at once lock week rows in the same order. Heavier than a whole week: null at
 * once (bookPreorder refuses it before this).
 */
async function assignWeek(c, p, weeks) {
  if (weekLoad(p) > (await biggestWeek(c, weeks, bookingVariety(p)))) return null
  for (const w of weeks) {
    if (await reserve(c, p, w)) return w
    if ((await expireWeekHolds(c, w)) + (await sweepExpiredPlanned(c, w)) > 0 && (await reserve(c, p, w))) return w
  }
  return null
}

async function lock(c, id) {
  const { rows } = await c.query('SELECT * FROM preorders WHERE id = $1 FOR UPDATE', [id])
  if (!rows.length) throw notFound('Preorder not found')
  return rows[0]
}

/**
 * The weeks as the shop and WhatsApp read them (GET /v1/preorders/weeks `weeks`), in the shape they always had:
 * one entry per box on sale and week, `capacity` the week's limit and `remaining` what is left of it, in kg, for
 * the box's VARIETY (all its boxes together, migration 078). For each box, from the first week to the earliest week
 * with room for one box of it, so an older shop that picks the first week with room picks the week the API gives one
 * box; when no week has room for it, only the first week (the shop then offers the waitlist). Room is counted
 * without the unpaid holds that ran out (lapsedHoldKg), as a booking finds it after its own sweep. Also returns:
 *   rooms  Map variety -> its weeks (varietyRoom); room: every variety of a week added up (weekTotals), or with `sku`
 *          that box's variety alone;
 *   boxes  [{ sku, variety, next }]: the earliest week with room for one box of each box (null: none to the season's end);
 *   next   the earliest of those (the home page's "from"): the earliest week ANY box can get.
 */
export async function openWeeks(c, sku = null) {
  const weeksList = await deliveryWeeks(c)
  const boxes = sku ? [sellable(sku)].filter(Boolean) : shopProducts()
  const rooms = await varietyRoom(c, weeksList, sku ? [...new Set(boxes.map((p) => p.variety))] : null, undefined, { lapsed: true })
  const perBox = boxes.map((p) => {
    const room = rooms.get(p.variety) ?? []
    return { sku: p.sku, variety: p.variety, room, next: weekFor(room, weekLoad({ sku: p.sku, qty: 1 })) }
  })
  const weeks = perBox.flatMap(({ sku: s, variety, room, next }) => {
    const shown = next ? room.slice(0, room.indexOf(next) + 1) : room.slice(0, 1)
    return shown.map((w) => ({ sku: s, variety, weekStart: w.weekStart, capacity: w.limit, remaining: w.remaining }))
  }).sort((a, b) => a.weekStart.localeCompare(b.weekStart))
  const next = perBox.map((x) => x.next).filter(Boolean).sort((a, b) => a.weekStart.localeCompare(b.weekStart))[0] ?? null
  const room = sku && boxes[0] ? (rooms.get(boxes[0].variety) ?? []) : weekTotals(rooms, weeksList)
  return Object.assign(weeks, { room, rooms, next, boxes: perBox.map(({ sku: s, variety, next: n }) => ({ sku: s, variety, next: n })) })
}

export function preorderView(p) {
  return {
    id: p.id, number: p.number, status: p.status, sku: p.sku, productName: findProduct(p.sku)?.name ?? p.sku, variety: bookingVariety(p), stage: p.stage,
    qty: p.qty, unitPrice: p.unit_price, total: p.total, weekStart: p.week_start, pincode: p.pincode, address: p.delivery_address, slotId: p.slot_id,
    // Migration 098 (CR2-07): an optional landmark, kept apart from the address.
    landmark: p.delivery_landmark ?? null,
    // Migration 091 (GIFT_ADDRESS_LINKS): null (address given at booking), ADDRESS_PENDING (no pincode or address yet:
    // the recipient was asked on WhatsApp) or ADDRESS_GIVEN (by the recipient).
    addressState: p.address_state ?? null,
    customerName: p.customer_name, phone: p.phone, channel: p.channel,
    paymentStatus: p.payment_status, paymentUrl: p.status === 'PAYMENT_PENDING' ? p.payment_link_url : null, holdExpiresAt: p.hold_expires_at,
    // Migration 086: the last payment attempt failed and it can still be paid; or it was closed unpaid (the hold ran out).
    paymentFailed: p.status === 'PAYMENT_PENDING' && Boolean(p.payment_failed_at),
    paymentClosed: p.status === 'CANCELLED' && !['SUCCEEDED', 'REFUNDED'].includes(p.payment_status) && !p.customer_cancelled_at && !p.staff_cancelled_at,
    orderId: p.order_id, movedCount: p.moved_count, createdAt: p.created_at, bookedAt: p.booked_at,
    // Paid non-refundable bookings can't be cancelled by the customer (migration 064), unless we delayed them (079):
    // then until the order it becomes is packed (cancelUntil), for a full refund.
    nonRefundable: Boolean(p.non_refundable), canCancel: customerMayCancel(p),
    delayed: delayView(p), cancelUntil: isDelayed(p) && p.payment_status === 'SUCCEEDED' ? 'PACKED' : null,
    cancelledAfterDelay: p.delay_cancelled_at ?? null, firstWeek: p.delayed_from_week ?? p.week_start,
    refund: p.refund_requested_at ? { requestedAt: p.refund_requested_at, refundedAt: p.refunded_at, id: p.refund_id, status: p.refund_status ?? null } : null,
    // Booked as a gift for someone else (migration 070); its order carries the same recipient.
    gift: giftOf(p),
    // One of several pre-orders paid together (migration 071): the group's number, size and the one total paid.
    // kind (migration 089): GIFT, a gift for several people (`people` of them); BAG, the customer's own pre-order bag
    // (`lines` boxes lines, each booking one line with its own week).
    group: p.group_id
      ? {
          id: p.group_id, number: p.group_number ?? null, kind: p.group_kind ?? 'GIFT', people: p.group_people ?? null, lines: p.group_people ?? null,
          total: p.group_total ?? null, position: p.group_position ?? null,
          // Migration 098: a gift for ONE person with several box lines, all in one week and one delivery.
          oneDelivery: Boolean(p.group_one_delivery),
        }
      : null,
  }
}

/** The columns preorderView reads for a booking's group: join `preorder_groups g` on p.group_id. */
export const GROUP_COLUMNS = 'g.number AS group_number, g.recipient_count AS group_people, g.total AS group_total, g.kind AS group_kind, g.one_delivery AS group_one_delivery'

/** A booking's gift recipient, in the shape createOrder's `gift` takes and the answers show; null when not a gift. */
function giftOf(p) {
  return p.gift_recipient_name ? { recipientName: p.gift_recipient_name, recipientPhone: p.gift_recipient_phone, message: p.gift_message } : null
}

/**
 * INV-02 for Book ahead: one customer can't hold a week's capacity with unpaid
 * bookings, on the web or in WhatsApp. Same rules as orders (maxUnpaidOrders,
 * maxHeldBoxes), counted over bookings only: an unpaid order and an unpaid
 * booking don't block each other. Locks the customer row, so two bookings by
 * the same customer at once queue here. A booking whose hold has run out
 * doesn't count.
 */
async function checkUnpaidPreorders(c, customerId, qty, at = now()) {
  if (!customerId) return
  await c.query('SELECT id FROM customers WHERE id = $1 FOR UPDATE', [customerId])
  const { rows } = await c.query(
    `SELECT id, number, qty, hold_expires_at, group_id FROM preorders
      WHERE customer_id = $1 AND status = 'PAYMENT_PENDING' AND (hold_expires_at IS NULL OR hold_expires_at >= $2)
      ORDER BY created_at DESC, group_position NULLS FIRST`,
    [customerId, at],
  )
  const cfg = getConfig()
  // A gift for several people (a group, migration 071) is one booking here: one payment pays it all.
  if (new Set(rows.map((r) => r.group_id ?? r.id)).size >= cfg.maxUnpaidOrders) {
    throw new HttpError(409, 'UNPAID_PREORDER_EXISTS', `You have an unpaid booking (${formatOrderNumber(rows[0].number)}). Pay for it or cancel it first.`, {
      preorderId: rows[0].id,
      number: rows[0].number,
      holdExpiresAt: rows[0].hold_expires_at,
    })
  }
  if (rows.reduce((t, r) => t + r.qty, 0) + qty > cfg.maxHeldBoxes) {
    throw new HttpError(409, 'HOLD_LIMIT', `You can reserve up to ${cfg.maxHeldBoxes} boxes at a time. Reduce the quantity.`, { maxHeldBoxes: cfg.maxHeldBoxes })
  }
}

/**
 * Lazy hold expiry for Book ahead (as INV-01 for orders): before a booking
 * takes a week's room, unpaid bookings in that week whose hold ran
 * out give theirs back, so a late or stopped maintenance job doesn't keep the
 * week full. As PAY-B5: a booking is left alone until Razorpay has been asked
 * about it after its hold, or for 2 minutes after the hold. A payment that
 * lands later still books (processPreorderPayment takes the capacity back).
 * Bounded and SKIP LOCKED, like the order sweep.
 */
async function expireWeekHolds(c, week, at = now(), limit = 20) {
  const { rows } = await c.query(
    `SELECT * FROM preorders
      WHERE status = 'PAYMENT_PENDING' AND week_start = $1 AND hold_expires_at < $2
        AND (reconcile_checked_at >= hold_expires_at OR hold_expires_at < $3)
      ORDER BY hold_expires_at LIMIT $4
      FOR UPDATE SKIP LOCKED`,
    [week, at, new Date(at.getTime() - LAZY_SWEEP_GATEWAY_GRACE_MS), limit],
  )
  for (const p of rows) await cancelExpiredHold(c, p)
  return rows.length
}

async function cancelExpiredHold(c, p) {
  // The sweeps hand over rows read before the loop: a booking of a group may already have gone with its first one below.
  const { rowCount } = await c.query(
    `UPDATE preorders SET status = 'CANCELLED', payment_status = 'CANCELLED', hold_expires_at = NULL WHERE id = $1 AND status = 'PAYMENT_PENDING'`,
    [p.id],
  )
  if (!rowCount) return
  await release(c, p)
  await event(c, p.id, 'CANCELLED', SYSTEM, 'Not paid in time')
  if (!p.group_id) return
  // One payment pays a whole group (a pre-order bag, a gift for several people): when its hold runs out every booking
  // in it goes, together, whichever week's sweep found the first one. The other bookings share the hold; one locked
  // by someone else just now is left to the next sweep (SKIP LOCKED: never a lock wait inside a booking). A payment
  // that lands later still books them all (processGroupPayment).
  const { rows } = await c.query(
    `SELECT * FROM preorders WHERE group_id = $1 AND id <> $2 AND status = 'PAYMENT_PENDING' AND hold_expires_at <= $3
      ORDER BY group_position FOR UPDATE SKIP LOCKED`,
    [p.group_id, p.id, p.hold_expires_at ?? now()],
  )
  for (const s of rows) {
    await release(c, s)
    await c.query(`UPDATE preorders SET status = 'CANCELLED', payment_status = 'CANCELLED', hold_expires_at = NULL WHERE id = $1`, [s.id])
    await event(c, s.id, 'CANCELLED', SYSTEM, 'Not paid in time')
  }
}

/**
 * Books a preorder in the earliest delivery week with room (assignWeek), decided here, inside the caller's
 * transaction. With room: PAYMENT_PENDING with a hold, paid by link. With no room in any week to the season's
 * end: WAITLISTED when the customer asked for it (held on the season's last week until a spot opens), else
 * 409 PREORDER_FULL.
 * b.weekStart is optional: the week the shop showed the customer before paying. When given it must be the week
 * the booking gets, so the customer never pays for a week they were not told: a week that filled since answers
 * 409 PREORDER_FULL and an earlier week that freed up since answers 409 PREORDER_WEEK_CHANGED, both with
 * extra.weekStart, the week they would get now (nothing is booked; the shop shows it and asks again). Without
 * it the booking takes the earliest week and the answer says which (weekStart).
 * b.gift (optional, { recipientName, recipientPhone, message }): booked for someone else.
 */
export async function bookPreorder(c, b, actor, { group = null } = {}) {
  const p = sellable(b.sku)
  if (!p) throw badRequest(`Unknown SKU ${b.sku}`, 'INVALID_SKU')
  if (b.weekStart != null && !isMonday(b.weekStart)) throw badRequest('weekStart must be a Monday', 'INVALID_WEEK')
  // Before pre-orders open nothing can be booked. In season, booking ahead stays open as before.
  const cfg = getConfig()
  if (seasonPhase(todayIST(), cfg) === 'BEFORE') {
    throw conflict(`Pre-orders open on ${dateWords(cfg.preorderOpensOn)}.`, 'PREORDERS_NOT_OPEN')
  }
  const weeks = await deliveryWeeks(c)
  if (!weeks.length) throw badRequest('Pre-orders are closed: no delivery week is left this season', 'INVALID_WEEK')
  if (b.weekStart != null && !weeks.includes(b.weekStart)) throw badRequest('Preorders are not open for that week', 'INVALID_WEEK')
  // A gift in a group may leave the address to the recipient (askAddress, GIFT_ADDRESS_LINKS: gift-address.js): no
  // pincode yet. Its week does not depend on the pincode; the recipient's pincode is checked when they give it.
  const ask = Boolean(group && b.askAddress)
  if (ask && !b.gift?.recipientPhone) throw badRequest('Asking for the address needs the recipient\u2019s mobile number', 'VALIDATION_ERROR')
  if (!ask) {
    const { rows: pin } = await c.query('SELECT 1 FROM pincodes WHERE pincode = $1 AND active', [b.pincode])
    if (!pin.length) throw badRequest('We do not deliver to this pincode yet', 'NOT_SERVICEABLE')
  }
  if (b.slotId) {
    const { rows } = await c.query('SELECT 1 FROM delivery_slots WHERE id = $1 AND active', [b.slotId])
    if (!rows.length) throw badRequest('That delivery slot is not available', 'SLOT_INVALID')
  }
  // A group's bookings were checked together (bookPreorderGroup); a group never waits on the waitlist.
  // Heavier than a whole week's kg: no week could ever take it (max 20 boxes x 5 kg is 100 kg against 7,000).
  // A variety the plan expects nothing of (0 kg a day in every week) takes no pre-orders: as a full season, below.
  const load = weekLoad({ sku: b.sku, qty: b.qty })
  const biggest = await biggestWeek(c, weeks, p.variety)
  if (biggest > 0 && load > biggest) {
    throw new HttpError(409, 'PREORDER_TOO_BIG', `That is more than a whole delivery week of ${shownVariety(p.variety)} can take (${biggest} kg). Choose fewer boxes.`, { kg: load, limit: biggest })
  }
  if (!group) await checkUnpaidPreorders(c, b.customerId, b.qty)
  // A gift for one person (migration 098, group.week): every line takes the group's one week, found by bookGroup.
  const got = group?.week
    ? ((await reserve(c, { sku: b.sku, qty: b.qty, variety: p.variety }, group.week)) ? group.week : null)
    : await assignWeek(c, { sku: b.sku, qty: b.qty, variety: p.variety }, weeks)
  if (got && b.weekStart != null && got !== b.weekStart) {
    // The transaction is rolled back by the caller: the week taken above is not kept.
    const extra = { weekStart: got, requested: b.weekStart }
    if (got > b.weekStart) throw new HttpError(409, 'PREORDER_FULL', `The week of ${dateWords(b.weekStart)} just filled up. Your order would be delivered in ${weekWords(got)}.`, extra)
    throw new HttpError(409, 'PREORDER_WEEK_CHANGED', `An earlier week has room again: your order would be delivered in ${weekWords(got)}.`, extra)
  }
  if (!got && group?.week) {
    throw new HttpError(409, 'PREORDER_FULL', `The week of ${dateWords(group.week)} just filled up for ${shownVariety(p.variety)}.`, { weekStart: null, requested: group.week })
  }
  if (!got && (group || !b.waitlist)) {
    throw new HttpError(409, 'PREORDER_FULL', `Every delivery week of ${shownVariety(p.variety)} this season is fully booked. Join the waitlist to get the next free spot.`, { weekStart: null, requested: b.weekStart ?? null })
  }
  const week = got ?? weeks.at(-1)
  const id = newId('pre')
  // P743406080 for yourself (a pre-order bag's lines too); G for a gift, and for every booking in a gift for several
  // people (order-number.js).
  const number = await nextOrderNumber(c, (group && group.kind !== 'BAG') || b.gift ? 'G' : 'P')
  const status = got ? 'PAYMENT_PENDING' : 'WAITLISTED'
  await c.query(
    `INSERT INTO preorders (id, number, customer_id, customer_name, phone, sku, stage, qty, unit_price, total, week_start, pincode,
                            delivery_address, slot_id, channel, status, hold_expires_at, payment_status, created_at, non_refundable,
                            gift_recipient_name, gift_recipient_phone, gift_message, group_id, group_position, load_kg, variety, address_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, true, $20, $21, $22, $23, $24, $25, $26, $27)`,
    [
      id, number, b.customerId, b.name ?? null, b.phone, b.sku, b.stage, b.qty, p.price, p.price * b.qty, week, ask ? null : b.pincode,
      ask ? null : b.address, b.slotId ?? null, b.channel ?? 'app', status,
      got ? (group?.holdExpiresAt ?? new Date(now().getTime() + getConfig().holdMinutes * 60_000)) : null, got ? 'INITIATED' : null, now(),
      b.gift?.recipientName ?? null, b.gift?.recipientPhone ?? null, b.gift ? b.gift.message || null : null,
      group?.id ?? null, group?.position ?? null, load, p.variety, ask ? PENDING : null,
    ],
  )
  if (b.landmark) await c.query('UPDATE preorders SET delivery_landmark = $2 WHERE id = $1', [id, b.landmark])
  const moved = got && got !== weeks[0] ? `Earlier weeks full: booked for ${weekWords(got)}` : null
  const part = !group ? null
    : group.kind === 'BAG' ? `Pre-order bag ${formatOrderNumber(group.number)}, line ${group.position} of ${group.size}`
      : group.week ? `Gift for one person: ${formatOrderNumber(group.number)}, box line ${group.position} of ${group.size}, delivered together`
        : `Gift for several people: ${formatOrderNumber(group.number)}, person ${group.position}`
  const why = got ? [part, ask ? 'Address to be given by the recipient' : null, moved].filter(Boolean).join('. ') || null : 'Every week full: joined the waitlist'
  await event(c, id, status, actor, why)
  return (await c.query('SELECT * FROM preorders WHERE id = $1', [id])).rows[0]
}

/** Creates the payment link for an unpaid preorder that has none yet. */
export async function ensurePaymentLink(id) {
  const { rows } = await query(`SELECT * FROM preorders WHERE id = $1 AND status = 'PAYMENT_PENDING'`, [id])
  const p = rows[0]
  if (!p || p.payment_link_url) return p ?? null
  // A booking in a group is paid by the group's one link.
  if (p.group_id) {
    await ensureGroupPaymentLink(p.group_id)
    return (await query('SELECT * FROM preorders WHERE id = $1', [id])).rows[0]
  }
  const link = await createPaymentLink({
    amount: p.total, number: p.number, preorderId: p.id, name: p.customer_name, phone: p.phone,
    description: `MandiMangoes preorder ${formatOrderNumber(p.number)}`,
    holdUntil: p.hold_expires_at,
  })
  const up = await query('UPDATE preorders SET payment_link_id = $2, payment_link_url = $3 WHERE id = $1 AND payment_link_url IS NULL RETURNING *', [
    p.id, link.id, link.url,
  ])
  return up.rows[0] ?? (await query('SELECT * FROM preorders WHERE id = $1', [id])).rows[0]
}

/**
 * Finds the booking a Razorpay payment link was paid for. PAY-B11: only what
 * Razorpay itself sends for the link counts (the link's id, or the notes we
 * set on the link when we made it); a payment's own notes can be set by
 * whoever opens Checkout, so they are never trusted, as for orders.
 */
export async function findPreorderId(c, _entity, link) {
  if (!link?.id && !link?.notes?.preorderId) return null
  const noted = typeof link?.notes?.preorderId === 'string' ? link.notes.preorderId : null
  const { rows } = await c.query(
    'SELECT id FROM preorders WHERE payment_link_id = $1 OR (id = $2 AND payment_link_id IS NOT NULL) ORDER BY (payment_link_id = $1) DESC NULLS LAST LIMIT 1',
    [link?.id ?? null, noted],
  )
  return rows[0]?.id ?? null
}

/**
 * Applies a payment. Paid in time: BOOKED. Paid after the hold expired: still
 * booked (late payments are honoured), taking capacity even if the week has
 * filled. Paid after the customer cancelled: refunded, non-refundable or not
 * (the booking was gone before the money came). Replays are no-ops.
 */
export async function processPreorderPayment(c, { preorderId, outcome, paymentId = null, amount = null, method = null }, actor = SYSTEM) {
  // A booking in a group (migration 071): the one payment is for the whole group.
  const { rows: grouped } = await c.query('SELECT group_id FROM preorders WHERE id = $1', [preorderId])
  if (grouped[0]?.group_id) return processGroupPayment(c, grouped[0].group_id, { outcome, paymentId, amount, method }, actor)
  const p = await lock(c, preorderId)
  if (p.payment_status === 'SUCCEEDED' || p.payment_status === 'REFUNDED') {
    const second = outcome === 'captured' && paymentId && p.payment_id && paymentId !== p.payment_id
    if (second && (await recordDuplicatePayment(c, { preorderId: p.id, paymentId, amount }))) return 'duplicate_payment'
    return 'already_paid'
  }
  if (outcome !== 'captured') {
    // A link can be paid again after a failed attempt; migration 086 lets the shop say it failed and offer to try again.
    if (outcome === 'failed' && p.status === 'PAYMENT_PENDING') await c.query('UPDATE preorders SET payment_failed_at = $2 WHERE id = $1', [p.id, now()])
    return 'ignored'
  }
  return applyPaid(c, p, [paymentId, method, amount ?? p.total, now()], actor)
}

/** A captured payment on one locked booking: booked (late or not), or refunded when it was cancelled first. */
async function applyPaid(c, p, paid, actor) {
  if (p.status === 'CANCELLED' && (p.customer_cancelled_at || p.staff_cancelled_at)) {
    await c.query(
      `UPDATE preorders SET payment_status = 'SUCCEEDED', payment_id = $2, payment_method = $3, paid_amount = $4, refund_requested_at = $5 WHERE id = $1`,
      [p.id, ...paid],
    )
    await event(c, p.id, 'CANCELLED', actor, `Paid after the ${p.customer_cancelled_at ? 'customer' : 'shop'} cancelled; full refund requested`)
    return 'refund_due'
  }
  if (p.status !== 'PAYMENT_PENDING' && p.status !== 'CANCELLED') return 'ignored'
  if (p.status === 'CANCELLED') await reserve(c, p, p.week_start, { force: true })
  await c.query(
    `UPDATE preorders SET status = 'BOOKED', payment_status = 'SUCCEEDED', payment_id = $2, payment_method = $3, paid_amount = $4,
            booked_at = $5, hold_expires_at = NULL WHERE id = $1`,
    [p.id, ...paid],
  )
  await event(c, p.id, 'BOOKED', actor, p.status === 'CANCELLED' ? 'Paid after the hold expired' : 'Payment captured')
  await enqueuePreorder(c, p.id, 'PREORDER_BOOKED')
  return 'booked'
}

/**
 * Customer cancel. An unpaid or waitlisted booking is simply dropped. A paid
 * non-refundable one (BOOKED, or CONVERTED into an order) is refused with
 * 409 PREORDER_NON_REFUNDABLE. An older booking (non_refundable false) keeps
 * its promise: before conversion it is cancelled and refunded in full; after
 * conversion it is the order's normal cancel (until packing, with the refund).
 * Returns { refund: 'preorder' | 'order' | null, id }.
 */
export async function cancelPreorder(c, id, customerId, actor) {
  // Before it is paid, a gift for several people is cancelled as a whole (its one payment would pay for all).
  const { rows: grouped } = await c.query('SELECT group_id FROM preorders WHERE id = $1', [id])
  if (grouped[0]?.group_id) {
    const g = await lockGroup(c, grouped[0].group_id)
    if (g.customer_id !== customerId) throw notFound('Preorder not found')
    if (g.payment_status !== 'SUCCEEDED') {
      await cancelGroupUnpaid(c, g, actor)
      return { refund: null, id }
    }
  }
  const p = await lock(c, id)
  if (p.customer_id !== customerId) throw notFound('Preorder not found')
  if (p.status === 'CANCELLED') throw conflict('This preorder is already cancelled')
  // Delayed by us (migration 079): a full refund until it is packed, whatever it was sold as. In a gift for several
  // people only this person's booking, refunded its own amount through the group's payment (refundPreorder).
  if (isDelayed(p) && p.payment_status === 'SUCCEEDED') return cancelDelayed(c, p, customerId, actor)
  if (p.non_refundable && p.payment_status === 'SUCCEEDED') throw nonRefundable()
  if (p.status === 'CONVERTED') {
    const refund = await customerCancel(c, p.order_id, customerId, actor)
    return { refund: refund ? 'order' : null, id: p.order_id }
  }
  if (p.status !== 'WAITLISTED') await release(c, p)
  const paid = p.payment_status === 'SUCCEEDED'
  await c.query(
    `UPDATE preorders SET status = 'CANCELLED', hold_expires_at = NULL, customer_cancelled_at = $2,
            payment_status = CASE WHEN payment_status = 'INITIATED' THEN 'CANCELLED' ELSE payment_status END,
            refund_requested_at = CASE WHEN $3 THEN $2 ELSE refund_requested_at END WHERE id = $1`,
    [p.id, now(), paid],
  )
  await event(c, p.id, 'CANCELLED', actor, paid ? 'Cancelled by customer; full refund requested' : 'Cancelled by customer')
  return { refund: paid ? 'preorder' : null, id: p.id }
}

/** The customer cancels a paid booking we delayed: released and refunded in full; a converted one through its order, until packed. */
async function cancelDelayed(c, p, customerId, actor) {
  if (p.status === 'CONVERTED') {
    const paid = await customerCancelDelayed(c, p.order_id, customerId, actor)
    await c.query('UPDATE preorders SET delay_cancelled_at = $2 WHERE id = $1', [p.id, now()])
    await event(c, p.id, 'CONVERTED', actor, 'Its order was cancelled by the customer after we delayed it; full refund requested')
    return { refund: paid ? 'order' : null, id: p.order_id }
  }
  if (p.status !== 'BOOKED') throw conflict('This pre-order can no longer be cancelled', 'NOT_CANCELLABLE')
  await release(c, p)
  await c.query(
    `UPDATE preorders SET status = 'CANCELLED', hold_expires_at = NULL, customer_cancelled_at = $2, delay_cancelled_at = $2, refund_requested_at = $2 WHERE id = $1`,
    [p.id, now()],
  )
  await event(c, p.id, 'CANCELLED', actor, 'Cancelled by customer after we delayed it; full refund requested')
  return { refund: 'preorder', id: p.id }
}

/**
 * Manager cancel, for a booking we can't fill (crop failure, season end, a
 * week we close). The capacity is freed and a paid booking is refunded in
 * full; a booking already turned into an order is cancelled as a paid order
 * (also refunded). Non-refundable bookings are refunded here too: that rule
 * only stops the customer cancelling, never us when we can't deliver.
 * Returns { refund: 'preorder' | 'order' | null, id }.
 */
export async function staffCancelPreorder(c, id, actor, reason) {
  const p = await lock(c, id)
  if (p.status === 'CANCELLED') throw conflict('This preorder is already cancelled')
  if (p.status === 'CONVERTED') {
    const refund = await cancelOrder(c, p.order_id, actor, reason, { manager: true, refund: true })
    await event(c, p.id, 'CONVERTED', actor, `Its order was cancelled by a manager: ${reason}`)
    return { refund: refund ? 'order' : null, id: p.order_id }
  }
  if (p.status !== 'WAITLISTED') await release(c, p)
  const paid = p.payment_status === 'SUCCEEDED'
  await c.query(
    `UPDATE preorders SET status = 'CANCELLED', hold_expires_at = NULL, staff_cancelled_at = $2,
            payment_status = CASE WHEN payment_status = 'INITIATED' THEN 'CANCELLED' ELSE payment_status END,
            refund_requested_at = CASE WHEN $3 THEN $2 ELSE refund_requested_at END WHERE id = $1`,
    [p.id, now(), paid],
  )
  await event(c, p.id, 'CANCELLED', actor, paid ? `Cancelled by a manager with a full refund: ${reason}` : `Cancelled by a manager: ${reason}`)
  return { refund: paid ? 'preorder' : null, id: p.id }
}

/** Sends the full refund for a cancelled paid preorder. Safe to repeat. */
export async function refundPreorder(id) {
  const p = await claimRefund('preorders', id)
  if (!p) return null
  // A booking in a group (migration 071) was paid by the group's payment: it gets back its own amount only.
  const groupPayment = p.group_id ? ((await query('SELECT payment_id FROM preorder_groups WHERE id = $1', [p.group_id])).rows[0]?.payment_id ?? null) : null
  let refundId
  try {
    refundId = await gatewayRefund({
      paymentId: p.payment_id ?? groupPayment, amount: p.paid_amount ?? p.total, receipt: refundReceipt(p.number, p.refund_attempts), notes: { preorderId: p.id },
      shared: Boolean(p.group_id),
    })
  } catch (err) {
    await refundAttemptFailed('preorders', p.id, p.refund_attempts, err)
    throw err
  }
  if (!refundId) return null
  return tx(async (c) => {
    const r = await c.query(
      `UPDATE preorders SET payment_status = 'REFUNDED', refund_id = $2, refunded_at = $3, refund_status = 'pending' WHERE id = $1 AND refunded_at IS NULL RETURNING id`,
      [p.id, refundId, now()],
    )
    if (r.rowCount) {
      await event(c, p.id, 'CANCELLED', SYSTEM, `Refunded in full (${refundId})`)
      await enqueuePreorder(c, p.id, 'REFUNDED')
    }
    return refundId
  })
}

/**
 * Unpaid preorders whose hold ran out give their capacity back. The same rule
 * as at booking (expireWeekHolds, PAY-B5): a booking is left alone until
 * Razorpay has been asked about it after its hold ended, or for 2 minutes
 * after the hold, so a payment made at the last moment is not cancelled.
 */
export async function expirePreorderHolds(c, at = now()) {
  const { rows } = await c.query(
    `SELECT * FROM preorders WHERE status = 'PAYMENT_PENDING' AND hold_expires_at < $1
        AND (reconcile_checked_at >= hold_expires_at OR hold_expires_at < $2)
      ORDER BY hold_expires_at FOR UPDATE SKIP LOCKED`,
    [at, new Date(at.getTime() - LAZY_SWEEP_GATEWAY_GRACE_MS)],
  )
  for (const p of rows) await cancelExpiredHold(c, p)
  return rows.length
}

/**
 * Sends a preorder message just queued, at once rather than at the next
 * maintenance run. Never throws: a message not sent stays in the outbox.
 */
async function sendPreorderMessageNow(preorderId, kind) {
  try {
    const { rows } = await query(
      `SELECT id FROM notifications WHERE preorder_id = $1 AND kind = $2 AND status = 'PENDING' AND next_attempt_at <= $3`,
      [preorderId, kind, now()],
    )
    if (rows.length) await sendNotificationsNow(rows.map((r) => r.id))
  } catch (err) {
    logger.warn({ err, preorderId, kind }, 'preorder message not sent at once; the outbox retries it')
  }
}

/**
 * Gives freed room to the waitlist in booking order. A promoted booking gets
 * the earliest week with room (as a new booking would; its week_start until
 * then was only a placeholder), a payment link and SPOT_HOLD_HOURS to pay,
 * and the customer hears at once. Strictly in order: a later booking never
 * goes ahead of an earlier one that does not fit yet (README, Waitlist).
 */
export async function promoteWaitlist() {
  const promoted = await tx(async (c) => {
    const weeks = await deliveryWeeks(c)
    if (![...(await varietyRoom(c, weeks)).values()].some((room) => room.some((w) => w.remaining > 0))) return []
    const { rows } = await c.query(
      `SELECT * FROM preorders WHERE status = 'WAITLISTED' AND week_start > $1
        ORDER BY created_at, id FOR UPDATE SKIP LOCKED`,
      [await regularHorizon(c)],
    )
    const ids = []
    // Strictly in order within a variety (migration 078): a booking that doesn't fit holds back the later ones of its
    // variety, never another variety's.
    const blocked = new Set()
    for (const p of rows) {
      const variety = bookingVariety(p)
      if (blocked.has(variety)) continue
      if (weekLoad(p) > (await biggestWeek(c, weeks, variety))) continue // heavier than any whole week (a limit was lowered): never fits, so it doesn't hold the queue
      const week = await assignWeek(c, p, weeks)
      if (!week) {
        blocked.add(variety)
        continue
      }
      await c.query(`UPDATE preorders SET status = 'PAYMENT_PENDING', payment_status = 'INITIATED', hold_expires_at = $2, payment_started_at = $3, week_start = $4
          WHERE id = $1`, [p.id, new Date(now().getTime() + SPOT_HOLD_HOURS * 3_600_000), now(), week])
      await event(c, p.id, 'PAYMENT_PENDING', SYSTEM, `A spot opened up from the waitlist: ${weekWords(week)}`)
      ids.push(p.id)
    }
    return ids
  })
  for (const id of promoted) {
    try {
      await ensurePaymentLink(id)
      await tx((c) => enqueuePreorder(c, id, 'PREORDER_SPOT_OPEN'))
    } catch (err) {
      logger.error({ err, preorderId: id }, 'could not send the waitlist payment link; will retry')
      continue
    }
    await sendPreorderMessageNow(id, 'PREORDER_SPOT_OPEN')
  }
  return promoted.length
}

/**
 * Closes the waitlist of every week that has reached the regular booking
 * horizon: no spot can open for it any more (promotion stops there and the
 * allocator takes over). Each booking is cancelled (nothing was paid) and the
 * customer is told with the cancelled message (mandi_cancelled). Bounded per run.
 */
export async function closeWaitlistAtHorizon(limit = 100) {
  const closed = await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT * FROM preorders WHERE status = 'WAITLISTED' AND week_start <= $1
        ORDER BY week_start, created_at, id LIMIT $2 FOR UPDATE SKIP LOCKED`,
      [await regularHorizon(c), limit],
    )
    for (const p of rows) {
      await c.query(`UPDATE preorders SET status = 'CANCELLED', hold_expires_at = NULL WHERE id = $1`, [p.id])
      await event(c, p.id, 'CANCELLED', SYSTEM, 'No spot opened on the waitlist for this week')
      await enqueuePreorder(c, p.id, 'CANCELLED')
    }
    return rows.map((p) => p.id)
  })
  for (const id of closed) await sendPreorderMessageNow(id, 'CANCELLED')
  return closed.length
}

/** Retries payment links (and their messages) for promoted preorders that have none yet. */
export async function retryMissingLinks() {
  const { rows } = await query(`SELECT id FROM preorders WHERE status = 'PAYMENT_PENDING' AND payment_link_url IS NULL LIMIT 20`)
  for (const { id } of rows) {
    try {
      const p = await ensurePaymentLink(id)
      if (p?.payment_link_url) {
        await tx((c) => enqueuePreorder(c, id, 'PREORDER_SPOT_OPEN'))
        await sendPreorderMessageNow(id, 'PREORDER_SPOT_OPEN')
      }
    } catch (err) {
      logger.error({ err, preorderId: id }, 'payment link retry failed')
    }
  }
}

/**
 * Catches missed link payments (webhook lost) for unpaid or just-expired preorders.
 * The window starts when the payment window opened: a waitlist spot is often
 * offered days after the booking was made.
 */
export async function reconcilePreorderPayments() {
  const at = now()
  const { rows } = await query(
    `SELECT id, payment_link_id FROM preorders WHERE payment_link_id IS NOT NULL AND payment_status IN ('INITIATED', 'CANCELLED')
        AND COALESCE(payment_started_at, created_at) > $1 AND (reconcile_checked_at IS NULL OR reconcile_checked_at < $2)
      ORDER BY (payment_status = 'INITIATED') DESC, reconcile_checked_at NULLS FIRST, COALESCE(payment_started_at, created_at) DESC LIMIT 100`,
    [new Date(at.getTime() - 3 * 86_400_000), new Date(at.getTime() - 15 * 60_000)],
  )
  let n = 0
  const asked = new Set()
  for (const p of rows) {
    // A group's bookings share one link (migration 071): it is asked about once, for all of them.
    if (asked.has(p.payment_link_id)) continue
    asked.add(p.payment_link_id)
    if (!canStartCall(GATEWAY_CALL_MS)) break // the next run carries on
    try {
      await query('UPDATE preorders SET reconcile_checked_at = $2 WHERE payment_link_id = $1', [p.payment_link_id, now()])
      const captured = (await fetchLinkPayments(p.payment_link_id)).find((x) => x.status === 'captured')
      if (!captured) continue
      const r = await tx((c) => applyCapture(c, 'preorders', p.id, captured))
      if (r === 'rejected') continue
      if (r === 'refund_due') await refundPreorder(p.id).catch(() => {})
      n++
    } catch (err) {
      logger.error({ err, preorderId: p.id }, 'preorder reconciliation failed')
    }
  }
  return n
}

/**
 * A manager moves a booking to another delivery week (a week lowered below what it holds, a customer's request).
 * Unpaid (PAYMENT_PENDING) or paid (BOOKED) only: a converted booking is an order now, a waitlisted one has no week
 * yet. The new week must be a delivery week with room for the booking's kg (refused with 409 PREORDER_FULL: raise
 * that week's expected kg first). It takes the one move path (moveBooking): a paid booking moved later is DELAYED (the
 * customer is told, PREORDER_DELAYED, and may cancel for a full refund until packed), moved earlier is told
 * PREORDER_EARLIER; moved_count counts it. Lowering a week moves nothing by itself: the Pre-order plan's
 * recalculation does, after the manager has seen its preview (preorder-plan.js).
 */
export async function staffMovePreorder(c, id, weekStart, actor, reason) {
  const p = await lock(c, id)
  if (p.status !== 'BOOKED' && p.status !== 'PAYMENT_PENDING') throw conflict('Only an unpaid or paid booking that is not an order yet can be moved', 'PREORDER_NOT_MOVABLE')
  if (p.week_start === weekStart) throw conflict('The booking is already in that week', 'PREORDER_SAME_WEEK')
  const weeks = await deliveryWeeks(c)
  if (!weeks.includes(weekStart)) throw badRequest('That is not a delivery week open for pre-orders', 'INVALID_WEEK')
  const moved = await moveBooking(c, p, weekStart, actor, `moved by a manager: ${reason}`)
  if (!moved) {
    throw new HttpError(409, 'PREORDER_FULL', `The ${weekWords(weekStart)} has no room for ${weekLoad(p)} kg of ${bookingVariety(p)}. Raise its expected kg first.`, { weekStart, kg: weekLoad(p) })
  }
  return moved
}

async function attempt(c, fn) {
  await c.query('SAVEPOINT pre_alloc')
  try {
    const v = await fn()
    await c.query('RELEASE SAVEPOINT pre_alloc')
    return v
  } catch (err) {
    await c.query('ROLLBACK TO SAVEPOINT pre_alloc')
    if (err instanceof HttpError) return null
    throw err
  }
}

/**
 * The allocator. Each paid preorder becomes a confirmed order on the first
 * date in its week that has stock, trying dates up to one day past the
 * regular booking horizon (so preorders claim stock before regular shoppers
 * can). A week that passes without stock moves the preorder to the next week
 * and tells the customer. Returns { converted, moved }.
 */
export async function allocatePreorders() {
  return await tx(async (c) => {
    // One run at a time (the maintenance job, or a batch that just became sellable: allocateOnStock), so bookings are
    // served strictly oldest first; a run that finds another in progress leaves the work to it.
    const { rows: [run] } = await c.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok', ['mango:allocate-preorders'])
    if (!run.ok) return { converted: 0, moved: 0, busy: true }
    const horizon = await allocationHorizon(c)
    const earliest = await earliestDeliveryDate(c)
    // A gift whose recipient has not given their address yet (GIFT_ADDRESS_LINKS) stays BOOKED, keeping its week's kg:
    // it is turned into a delivery on the first run after the address is given.
    const { rows: waiting } = await c.query(
      `SELECT id, number, week_start FROM preorders WHERE status = 'BOOKED' AND week_start <= $1 AND address_state = 'ADDRESS_PENDING' ORDER BY week_start, id LIMIT 50`,
      [horizon],
    )
    if (waiting.length) logger.warn({ count: waiting.length, preorders: waiting.map((p) => formatOrderNumber(p.number)) }, 'pre-orders waiting for the recipient\u2019s address were not turned into deliveries')
    const { rows } = await c.query(
      `SELECT p.*, g.one_delivery AS group_one_delivery FROM preorders p LEFT JOIN preorder_groups g ON g.id = p.group_id
        WHERE p.status = 'BOOKED' AND p.week_start <= $1 AND p.address_state IS DISTINCT FROM 'ADDRESS_PENDING'
        ORDER BY p.booked_at, p.created_at, p.id FOR UPDATE OF p SKIP LOCKED LIMIT 200`,
      [horizon],
    )
    let converted = 0
    let moved = 0
    const seen = new Set()
    for (const p of rows) {
      if (seen.has(p.id)) continue
      // A gift for one person (migration 098): its box lines in this week become ONE delivery order, a line per box.
      // A line another run holds right now waits for the next run with the rest; a line a manager moved to another
      // week goes on its own when its week comes.
      let set = [p]
      if (p.group_one_delivery) {
        set = rows.filter((x) => x.group_id === p.group_id && x.week_start === p.week_start).sort((a, b) => (a.group_position ?? 0) - (b.group_position ?? 0))
        for (const x of set) seen.add(x.id)
        const { rows: [all] } = await c.query(
          `SELECT COUNT(*)::int AS n FROM preorders WHERE group_id = $1 AND week_start = $2 AND status = 'BOOKED' AND address_state IS DISTINCT FROM 'ADDRESS_PENDING'`,
          [p.group_id, p.week_start],
        )
        if (all.n > set.length) continue
      }
      const lead = set[0]
      const last = addDays(p.week_start, 6)
      let order = null
      for (let d = p.week_start < earliest ? earliest : p.week_start; d <= last && d <= horizon && !order; d = addDays(d, 1)) {
        order = await attempt(c, () =>
          createOrder(
            c,
            {
              customerId: lead.customer_id, customerName: lead.customer_name, phone: lead.phone, pincode: lead.pincode, address: lead.delivery_address,
              landmark: lead.delivery_landmark ?? null,
              deliveryDate: d, slotId: lead.slot_id, strictSlot: false, status: 'CONFIRMED', paymentStatus: 'SUCCEEDED',
              paymentMethod: lead.payment_method ?? 'preorder', allOrNothing: true, channel: lead.channel,
              // The boxes held for pre-orders (holdback.js) are this booking's to take.
              holdBack: false,
              lines: set.map((x) => ({ sku: x.sku, stage: x.stage, qty: x.qty, unitPrice: x.unit_price })),
              eventReason: set.length > 1 ? `From gift pre-order lines ${set.map((x) => formatOrderNumber(x.number)).join(', ')}, delivered together` : `From preorder ${formatOrderNumber(lead.number)}`,
              gift: giftOf(lead),
              // The customer keeps one number: the delivery order carries the booking's own (P or G). A booking
              // from before lettered numbers (PRE-1035) gets a new number of its letter, and still says where it came from.
              ...(LETTERED.test(lead.number) ? { number: lead.number } : { letter: giftOf(lead) || lead.group_id ? 'G' : 'P' }),
            },
            SYSTEM,
          ),
        )
      }
      if (order) {
        const paid = set.reduce((t, x) => t + Number(x.paid_amount ?? x.total), 0)
        await c.query('UPDATE orders SET preorder_id = $2, payment_id = $3, payment_amount = $4 WHERE id = $1', [order.id, lead.id, lead.payment_id, paid])
        for (const x of set) {
          await c.query(`UPDATE preorders SET status = 'CONVERTED', order_id = $2 WHERE id = $1`, [x.id, order.id])
          await event(c, x.id, 'CONVERTED', SYSTEM, `Delivering on ${order.delivery_date} as ${formatOrderNumber(order.number)}`)
        }
        converted += set.length
      } else if (last < earliest) {
        // The same delayed path as a recalculation (flag, message, the customer's cancel right): taken by force, the fruit owes it.
        for (const x of set) await moveBooking(c, x, addDays(x.week_start, 7), SYSTEM, `no fruit came in the week of ${x.week_start}`, { force: true })
        moved += set.length
      }
    }
    return { converted, moved }
  })
}

/**
 * Runs the allocator at once when stock has just become sellable (a batch received, marked arrived or ripening, a QC
 * reading, a count raised), so held fruit turns into the bookings' delivery orders without waiting for the
 * maintenance run (which may run only once a day on the live host). After the staff change has committed, in its own
 * transaction; never throws (the maintenance run does it later).
 */
export async function allocateOnStock(why) {
  try {
    const r = await allocatePreorders()
    if (r.converted || r.moved) logger.info({ ...r, why }, 'pre-order allocator ran after a stock change')
    // Then the orders booked against the plan, with what the pre-orders left (plan-orders.js).
    const { fulfilPlannedOrders } = await import('./plan-orders.js')
    return { ...r, planned: await fulfilPlannedOrders() }
  } catch (err) {
    logger.warn({ err, why }, 'pre-order allocator after a stock change failed; the maintenance run retries')
    return null
  }
}

// ---------------------------------------------------------------- several pre-orders, one payment (migrations 071, 089)
//
// A group is several pre-order bookings booked in one transaction and paid by ONE payment link. Two kinds
// (preorder_groups.kind, migration 089):
//   GIFT  a gift for several people (071, below): one gift booking per person, each with its own address.
//   BAG   the customer's own pre-order bag (089, the browser audit of 23 Nov 2026: "Alphonso and Kesar can't be
//         bought in one checkout"): one booking per box line, all to one address. Each line keeps its own delivery
//         week: lines are booked in order, each taking the earliest week with room for its kg in its variety
//         (assignWeek), so an Alphonso line can come in week N and a Kesar line in N+2. The shop shows those weeks
//         first (POST /v1/preorders/quote, quotePreorderBag) and sends them back at Pay (POST /v1/preorders/confirm,
//         bookPreorderBag); a week that changed since refuses the whole bag (409, naming the line), so nothing is
//         booked half-way. Why on this table and not gifts.js: a gift order makes delivery ORDERS against a day's
//         stock, a pre-order books a WEEK's kg; and everything below (one hold, one link, one payment, per-booking
//         paid amounts, per-booking refunds) is what a bag needs, unchanged.
// Everything below holds for both kinds; "the buyer" is the customer.
//
// Before the season the shop's "Send as a gift" books one gift pre-order per person, all in one
// transaction, paid by ONE payment link for the whole group (docs/gifting.md, "Before the season").
// Each booking is an ordinary gift pre-order (its own box, week, address and recipient), so the
// allocator, staff cancel and refunds work on it unchanged. The group holds the one payment:
// - every booking carries the group's link, so the webhook, the reconcile loop and the dev pay route
//   find a booking and processPreorderPayment pays the whole group (processGroupPayment), once;
// - a hold that runs out cancels every booking of the group together (cancelExpiredHold) and frees each
//   one's week; a payment that lands later still books them all; one after the buyer cancelled is refunded,
//   booking by booking;
// - the unpaid-booking rule counts an unpaid group as one booking;
// - the buyer can cancel it only before paying, and then as a whole; once paid each booking is an ordinary
//   pre-order: non-refundable, unless we delay it, when that one booking can be cancelled for its own amount.

const lockGroup = async (c, id) => {
  const { rows } = await c.query('SELECT * FROM preorder_groups WHERE id = $1 FOR UPDATE', [id])
  if (!rows.length) throw notFound('Pre-order not found')
  return rows[0]
}

const groupMembers = async (c, groupId, { lock: forUpdate = false } = {}) =>
  (await c.query(`SELECT * FROM preorders WHERE group_id = $1 ORDER BY group_position, id${forUpdate ? ' FOR UPDATE' : ''}`, [groupId])).rows

/** The group as the buyer sees it: unpaid with every booking cancelled (the hold ran out) is cancelled. */
export function groupStatus(g, members) {
  if (g.status === 'PAYMENT_PENDING' && members.length && members.every((p) => p.status === 'CANCELLED')) return 'CANCELLED'
  return g.status
}

/**
 * One booking as its giver sees it (the shop): an address the RECIPIENT gave is not shown back to the giver, only its
 * pincode (docs/gifting.md). Staff views use preorderView.
 */
export function giverPreorderView(p) {
  const v = preorderView(p)
  return p.address_state === 'ADDRESS_GIVEN' ? { ...v, address: null } : v
}

/** `links`: Map preorder id -> its live gift address link (gift-address.js linksFor), for the giver's fields. */
export function groupView(g, members, links = new Map()) {
  const status = groupStatus(g, members)
  const paid = g.payment_status === 'SUCCEEDED'
  return {
    id: g.id, number: g.number, kind: g.kind ?? 'GIFT', status, paymentStatus: g.payment_status, total: g.total, recipientCount: g.recipient_count,
    // Migration 098: a gift for one person, its box lines (one booking each) in one week and one delivery.
    oneDelivery: Boolean(g.one_delivery), lineCount: g.one_delivery ? members.length : g.recipient_count, boxes: g.boxes,
    holdExpiresAt: g.hold_expires_at, createdAt: g.created_at, paidAt: g.paid_at, nonRefundable: true,
    paymentUrl: status === 'PAYMENT_PENDING' ? g.payment_link_url : null,
    // The booking to pay through (the shop's pre-order sheet, the dev pay route): the first one.
    leadId: members[0]?.id ?? null,
    canCancel: status === 'PAYMENT_PENDING' && g.payment_status !== 'SUCCEEDED',
    // Migration 086 (marked on the bookings): the last payment attempt failed; the link can be paid again while held.
    paymentFailed: status === 'PAYMENT_PENDING' && g.payment_status !== 'SUCCEEDED' && members.some((p) => p.status === 'PAYMENT_PENDING' && p.payment_failed_at),
    preorders: members.map((p) => ({
      ...giverPreorderView({ ...p, group_number: g.number, group_people: g.recipient_count, group_total: g.total, group_kind: g.kind, group_one_delivery: g.one_delivery }),
      // GIFT_ADDRESS_LINKS: addressLink (sentAt, sendCount, expiresAt, canResend, resendAfter) and addressMessage.
      ...giverFields(p, links.get(p.id) ?? null, paid),
    })),
  }
}

/** Cancels every booking of an unpaid group, frees their weeks, and the group with them. */
async function cancelGroupUnpaid(c, g, actor) {
  const members = await groupMembers(c, g.id, { lock: true })
  const open = members.filter((p) => p.status !== 'CANCELLED')
  if (!open.length) throw conflict('This preorder is already cancelled')
  for (const p of open) {
    if (p.status !== 'WAITLISTED') await release(c, p)
    await c.query(
      `UPDATE preorders SET status = 'CANCELLED', hold_expires_at = NULL, customer_cancelled_at = $2,
              payment_status = CASE WHEN payment_status = 'INITIATED' THEN 'CANCELLED' ELSE payment_status END WHERE id = $1`,
      [p.id, now()],
    )
    await event(c, p.id, 'CANCELLED', actor, `Cancelled by customer, with the whole ${g.kind === 'BAG' ? 'pre-order bag' : 'gift'} ${formatOrderNumber(g.number)}`)
  }
  await c.query(
    `UPDATE preorder_groups SET status = 'CANCELLED', payment_status = 'CANCELLED', hold_expires_at = NULL, cancelled_at = $2 WHERE id = $1`,
    [g.id, now()],
  )
}

/**
 * Books a gift for several people: one gift pre-order per recipient, in one transaction (inside the
 * caller's), with one hold and one total. Each recipient names its own box, ripeness and quantity;
 * each person, in list order, gets the earliest week with room (bookPreorder), so a group can straddle
 * two weeks: some people in week N, the rest in N+1. A recipient's `weekStart` (optional) is the week
 * the shop showed for that person: when it no longer matches, or no week has room, the whole group
 * fails with 409 (PREORDER_FULL / PREORDER_WEEK_CHANGED), naming the person (extra.row), so nothing is
 * booked half-way. The same rules as
 * one booking: pre-orders open, the week open, the pincode served, one unpaid booking (a group counts
 * once), the boxes one buyer may hold. Returns the group row.
 */
export function bookPreorderGroup(c, { customerId, name, phone, recipients, oneDelivery = false }, actor) {
  return bookGroup(c, { kind: 'GIFT', customerId, name, phone, entries: recipients, oneDelivery }, actor)
}

/** The most boxes one gift for one person may hold (change request 02, Q2: 20). */
export const GIFT_MAX_BOXES = 20

/**
 * The one week a gift for one person arrives in (migration 098): the earliest week in which EVERY line has room
 * together (lines of one variety share its kg), which is the week of the line that is ready last. Found by taking each
 * line's kg in turn under a savepoint that is always rolled back, so nothing is kept; a week that looks full first lets
 * its lapsed holds go (as assignWeek). null when no week can take the whole gift.
 */
async function togetherWeek(c, entries, weeks) {
  const loads = entries.map((r) => ({ sku: r.sku, qty: r.qty, variety: varietyOf(r.sku) }))
  const fits = async (w) => {
    await c.query('SAVEPOINT together_week')
    let ok = true
    try {
      for (const p of loads) if (!(await reserve(c, p, w))) { ok = false; break }
    } finally {
      await c.query('ROLLBACK TO SAVEPOINT together_week')
      await c.query('RELEASE SAVEPOINT together_week')
    }
    return ok
  }
  for (const w of weeks) {
    if (await fits(w)) return w
    if ((await expireWeekHolds(c, w)) + (await sweepExpiredPlanned(c, w)) > 0 && (await fits(w))) return w
  }
  return null
}

/** The most box lines one pre-order bag takes (a line is one box size and ripeness; 20 boxes a line at most). */
export const PREORDER_BAG_MAX_LINES = 10

/** "Line 2 (Kesar 3 kg box)": how a bag's errors name the line, as the shop shows it. */
const lineName = (i, sku) => `Line ${i + 1} (${findProduct(sku)?.name ?? sku})`

/**
 * Books the customer's pre-order bag (kind BAG): one pre-order per line { sku, stage, qty, weekStart? }, all to
 * `pincode`/`address`, in one transaction (inside the caller's) with one hold and one total, paid by one payment
 * link (ensureGroupPaymentLink). Each line, in order, gets the earliest week with room (bookPreorder), so lines can
 * fall in different weeks. A line's `weekStart` is the week the shop showed (quotePreorderBag): when it no longer
 * matches, or no week has room, the whole bag fails with 409 (PREORDER_FULL / PREORDER_WEEK_CHANGED / PREORDER_TOO_BIG)
 * naming the line (extra.row). The same rules as one booking: pre-orders open, the pincode served, one unpaid
 * pre-order at a time (the bag counts once), the boxes one buyer may hold. Returns the group row.
 */
export function bookPreorderBag(c, { customerId, name, phone, pincode, address, slotId = null, lines }, actor) {
  const entries = lines.map((l) => ({ sku: l.sku, stage: l.stage, qty: l.qty, weekStart: l.weekStart ?? null, pincode, address, slotId }))
  return bookGroup(c, { kind: 'BAG', customerId, name, phone, entries }, actor)
}

/** The two kinds' one booker: the group row, then each entry as an ordinary pre-order of it, in order. */
async function bookGroup(c, { kind, customerId, name, phone, entries, oneDelivery = false }, actor) {
  const cfg = getConfig()
  if (seasonPhase(todayIST(), cfg) === 'BEFORE') {
    throw conflict(`Pre-orders open on ${dateWords(cfg.preorderOpensOn)}.`, 'PREORDERS_NOT_OPEN')
  }
  const bag = kind === 'BAG'
  const label = (i, sku) => (bag ? lineName(i, sku) : `Person ${i + 1}`)
  const boxes = entries.reduce((t, r) => t + r.qty, 0)
  await checkUnpaidPreorders(c, customerId, boxes)
  const id = newId('pgr')
  // A bag is for yourself: a P number, as each of its bookings. A gift: a G number from the one G sequence (order-number.js).
  const number = await nextOrderNumber(c, bag ? 'P' : 'G')
  const holdExpiresAt = new Date(now().getTime() + cfg.holdMinutes * 60_000)
  const priced = entries.map((r, i) => {
    const p = sellable(r.sku)
    if (!p) throw new HttpError(400, 'INVALID_SKU', `${label(i, r.sku)}: unknown box ${r.sku}`, { row: i + 1 })
    return p.price * r.qty
  })
  const total = priced.reduce((t, x) => t + x, 0)
  // A gift for one person (migration 098): one week for every line, the week the shop showed (weekStart) or 409.
  let week = null
  if (oneDelivery) {
    const weeks = await deliveryWeeks(c)
    if (!weeks.length) throw badRequest('Pre-orders are closed: no delivery week is left this season', 'INVALID_WEEK')
    week = await togetherWeek(c, entries, weeks)
    const shown = entries.find((r) => r.weekStart)?.weekStart ?? null
    if (!week) {
      throw new HttpError(409, 'PREORDER_FULL', 'No delivery week this season has room for every box in this gift together. Take out a box or two.', { weekStart: null, requested: shown })
    }
    if (shown && week !== shown) {
      const extra = { weekStart: week, requested: shown }
      if (week > shown) throw new HttpError(409, 'PREORDER_FULL', `The week of ${dateWords(shown)} just filled up. The whole gift would arrive in ${weekWords(week)}.`, extra)
      throw new HttpError(409, 'PREORDER_WEEK_CHANGED', `An earlier week has room again: the whole gift would arrive in ${weekWords(week)}.`, extra)
    }
  }
  await c.query(
    `INSERT INTO preorder_groups (id, number, customer_id, status, recipient_count, boxes, total, payment_status, hold_expires_at, created_at, kind, one_delivery)
     VALUES ($1, $2, $3, 'PAYMENT_PENDING', $4, $5, $6, 'INITIATED', $7, $8, $9, $10)`,
    [id, number, customerId, oneDelivery ? 1 : entries.length, boxes, total, holdExpiresAt, now(), kind, Boolean(oneDelivery)],
  )
  for (const [i, r] of entries.entries()) {
    const line = oneDelivery ? `Box line ${i + 1} (${findProduct(r.sku)?.name ?? r.sku})` : label(i, r.sku)
    try {
      await bookPreorder(c, { ...r, ...(week ? { weekStart: null } : {}), customerId, name, phone, channel: 'app', waitlist: false }, actor, {
        group: { id, number, kind, position: i + 1, size: entries.length, holdExpiresAt, week },
      })
    } catch (err) {
      if (!(err instanceof HttpError)) throw err
      throw new HttpError(err.status, err.code, `${line}: ${err.message}`, { weekStart: r.weekStart ?? null, ...(err.extra ?? {}), row: i + 1, sku: r.sku })
    }
  }
  return (await c.query('SELECT * FROM preorder_groups WHERE id = $1', [id])).rows[0]
}

/**
 * What a pre-order bag would book now, without booking it (POST /v1/preorders/quote): each line's price and the
 * week it would get, found as bookPreorderBag books them: lines in order, each the earliest week with room for its
 * kg in its variety, counting the kg of the lines before it, and without the unpaid holds that ran out (lapsedHoldKg:
 * confirm's own sweep frees them, so the quote shows the week confirm will give). Nothing is reserved, so a week can
 * still fill before Pay; confirm then answers 409 with the line's new week. A line no week can take says why: `tooBig` (heavier than
 * any whole week of its variety) or `full` (every week to the season's end is full); the bag can't be paid then.
 * Throws INVALID_SKU (400, extra.row) for a box not on sale.
 */
export async function quotePreorderBag(c, lines) {
  const weeks = await deliveryWeeks(c)
  const products = lines.map((l, i) => {
    const p = sellable(l.sku)
    if (!p) throw new HttpError(400, 'INVALID_SKU', `${lineName(i, l.sku)}: this box is not on sale`, { row: i + 1, sku: l.sku })
    return p
  })
  const rooms = weeks.length ? await varietyRoom(c, weeks, [...new Set(products.map((p) => p.variety))], undefined, { lapsed: true }) : new Map()
  const left = new Map([...rooms].map(([v, room]) => [v, room.map((w) => ({ ...w }))]))
  const out = lines.map((l, i) => {
    const p = products[i]
    const kg = weekLoad({ sku: l.sku, qty: l.qty })
    const room = left.get(p.variety) ?? []
    const biggest = Math.max(0, ...room.map((w) => w.limit))
    const tooBig = biggest > 0 && kg > biggest
    const week = tooBig ? null : weekFor(room, kg)
    if (week) week.remaining = roundKg(week.remaining - kg)
    return {
      sku: l.sku, stage: l.stage, qty: l.qty, name: p.name, variety: p.variety, boxSize: p.boxSize, unitPrice: p.price, linePrice: p.price * l.qty, kg,
      weekStart: week?.weekStart ?? null, firstWeek: room[0]?.weekStart ?? null, tooBig, full: !tooBig && !week, limitKg: biggest,
    }
  })
  const total = out.reduce((t, l) => t + l.linePrice, 0)
  return { lines: out, total, boxes: out.reduce((t, l) => t + l.qty, 0), payable: out.length > 0 && out.every((l) => l.weekStart), nonRefundable: true }
}

/** Creates the one payment link of an unpaid group (and copies it onto its bookings). */
export async function ensureGroupPaymentLink(groupId) {
  const { rows } = await query(`SELECT * FROM preorder_groups WHERE id = $1 AND status = 'PAYMENT_PENDING'`, [groupId])
  const g = rows[0]
  if (!g || g.payment_link_url) return g ?? null
  const lead = (await groupMembers({ query }, g.id))[0]
  if (!lead) return g
  const link = await createPaymentLink({
    amount: g.total, number: g.number, preorderId: lead.id, name: lead.customer_name, phone: lead.phone,
    description: g.kind === 'BAG'
      ? `MandiMangoes pre-order ${formatOrderNumber(g.number)}, ${g.boxes} ${g.boxes === 1 ? 'box' : 'boxes'}`
      : `MandiMangoes gift pre-order ${formatOrderNumber(g.number)} for ${g.recipient_count} ${g.recipient_count === 1 ? 'person' : 'people'}`,
    holdUntil: g.hold_expires_at,
  })
  return tx(async (c) => {
    const up = await c.query('UPDATE preorder_groups SET payment_link_id = $2, payment_link_url = $3 WHERE id = $1 AND payment_link_url IS NULL RETURNING *', [g.id, link.id, link.url])
    if (!up.rowCount) return (await c.query('SELECT * FROM preorder_groups WHERE id = $1', [g.id])).rows[0]
    await c.query('UPDATE preorders SET payment_link_id = $2, payment_link_url = $3 WHERE group_id = $1 AND payment_link_url IS NULL', [g.id, link.id, link.url])
    return up.rows[0]
  })
}

/**
 * The group's one payment, as processPreorderPayment for one booking, and as idempotent: once the
 * group is paid a replay changes nothing and a second payment is recorded as a duplicate (refunded).
 * A captured payment books every booking (a late one too, taking its week back), or marks it for a
 * full refund when the buyer had cancelled. Each booking records its own amount (paid_amount); the
 * payment id stays on the group. Returns 'booked', 'refund_due' (every booking), 'already_paid',
 * 'duplicate_payment' or 'ignored'.
 */
async function processGroupPayment(c, groupId, { outcome, paymentId, amount, method }, actor) {
  const g = await lockGroup(c, groupId)
  const members = await groupMembers(c, g.id, { lock: true })
  if (g.payment_status === 'SUCCEEDED') {
    const second = outcome === 'captured' && paymentId && g.payment_id && paymentId !== g.payment_id
    if (second && members.length && (await recordDuplicatePayment(c, { preorderId: members[0].id, paymentId, amount }))) return 'duplicate_payment'
    return 'already_paid'
  }
  if (outcome !== 'captured') {
    // A link can be paid again after a failed attempt (migration 086: marked on each booking of the group).
    if (outcome === 'failed' && g.status === 'PAYMENT_PENDING') await c.query(`UPDATE preorders SET payment_failed_at = $2 WHERE group_id = $1 AND status = 'PAYMENT_PENDING'`, [g.id, now()])
    return 'ignored'
  }
  await c.query(
    `UPDATE preorder_groups SET payment_status = 'SUCCEEDED', status = CASE WHEN status = 'CANCELLED' THEN 'CANCELLED' ELSE 'PAID' END,
            payment_id = $2, payment_method = $3, paid_amount = $4, paid_at = $5, hold_expires_at = NULL WHERE id = $1`,
    [g.id, paymentId, method, amount ?? g.total, now()],
  )
  const results = []
  for (const p of members) results.push(await applyPaid(c, p, [null, method, p.total, now()], actor))
  // Recipients asked for their address (GIFT_ADDRESS_LINKS): one link and one WhatsApp message each, now it is paid.
  if (members.some((p) => p.address_state === PENDING)) await openLinks(c, await groupMembers(c, g.id), { oneDelivery: Boolean(g.one_delivery) })
  if (results.length && results.every((r) => r === 'refund_due')) return 'refund_due'
  return results.includes('booked') ? 'booked' : 'ignored'
}
