// Mango season subscriptions (SUBSCRIPTIONS, docs/care.md). A customer picks
// a box (product, ripeness, count), weekly or fortnightly, a weekday, a slot
// and one of their saved addresses, until an end date no later than the
// season's end (SUBSCRIPTION_SEASON_END).
//
// No money moves here: there is no auto-debit and no wallet (recurring
// mandates would need a Razorpay subscriptions contract the shop doesn't
// have). Instead, SUBSCRIPTION_LEAD_DAYS (2) before each delivery the
// scheduler sets up that delivery's cycle on the first day with room and
// stock (the nominal day, or later in the same period when that one is full,
// closed or out of stock) and reminds the customer to pay. Paying makes an
// ordinary unpaid order through the same code as checkout: the unpaid-order
// limits apply, the boxes are held only for holdMinutes once Pay is tapped,
// and a day that filled up in the meantime moves the order to the next day
// with room, as a late payment does. A cycle holds no stock and no capacity.
//
// Each cycle is one row, UNIQUE (subscription_id, scheduled_for): the
// scheduler inserts it with ON CONFLICT DO NOTHING and sends the reminder only
// when its insert made the row, so a retried or overlapping run creates and
// reminds exactly once.
import { addDays, diffDays, isDate, now, todayIST } from './clock.js'
import { getConfig } from './config.js'
import { query, tx } from './db.js'
import { checkCapacity, earliestRawDate, orderableDates, slotsForDate } from './delivery.js'
import { env } from './env.js'
import { isOn } from './feature-switches.js'
import { badRequest, conflict, HttpError, notFound } from './errors.js'
import { newId } from './ids.js'
import { availability } from './inventory.js'
import { logger } from './logger.js'
import { enqueueCycleDue } from './notify.js'
import { checkUnpaidLimit, createOrder, customerCancel, SYSTEM } from './orders.js'
import { findProduct, sellable } from './products.js'

export const PERIOD_DAYS = { WEEKLY: 7, FORTNIGHTLY: 14 }
/** Subscriptions one customer may have running (active or paused) at once. */
export const MAX_SUBSCRIPTIONS = 3
/** Why a day can't take a cycle's order: try the next one. */
const DAY_PROBLEMS = new Set(['DATE_FULL', 'DATE_CLOSED', 'SLOT_FULL', 'SLOT_INVALID', 'STOCK_INSUFFICIENT'])

/** The last day a subscription may run to, or null while it isn't set. */
export const seasonEnd = () => env.SUBSCRIPTION_SEASON_END ?? null
/** Whether a new subscription can be started now: the switch, a season end, and a season that hasn't ended. */
export const subscriptionsOpen = (at = now()) => Boolean(isOn('SUBSCRIPTIONS') && seasonEnd() && seasonEnd() >= earliestRawDate(at))

/** ISO weekday of a date: 1 = Monday … 7 = Sunday. */
export const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7

/** The first date on that weekday a customer could still order for. */
export function firstDateFor(weekday, at = now()) {
  let d = earliestRawDate(at)
  while (weekdayOf(d) !== weekday) d = addDays(d, 1)
  return d
}

const period = (s) => PERIOD_DAYS[s.frequency]
/** The last day a cycle's order may go out: the day before the next cycle, and never past the end date. */
export const windowEnd = (s, scheduledFor) => {
  const end = addDays(scheduledFor, period(s) - 1)
  return end < s.end_date ? end : s.end_date
}

/** Nominal delivery dates (first_date + n periods) from `from` to `to`, inclusive. */
export function nominalDates(s, from, to) {
  const p = period(s)
  const start = from > s.first_date ? from : s.first_date
  const k = Math.max(0, Math.ceil(diffDays(start, s.first_date) / p))
  const out = []
  for (let d = addDays(s.first_date, k * p); d <= to && d <= s.end_date; d = addDays(d, p)) out.push(d)
  return out
}

async function event(c, subscriptionId, action, actor, { cycleId = null, reason = null } = {}) {
  await c.query(
    'INSERT INTO subscription_events (id, subscription_id, cycle_id, action, reason, actor, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [newId('sev'), subscriptionId, cycleId, action, reason, actor.label ?? actor.id, now()],
  )
}

// ---------------------------------------------------------------- views

const masked = (p) => (p ? `******${String(p).slice(-4)}` : null)

function cycleView(s, y, at = now()) {
  const paid = y.order_payment_status === 'SUCCEEDED' || y.order_payment_status === 'REFUNDED'
  const unpaidCancelled = y.status === 'ORDERED' && y.order_status === 'CANCELLED' && !paid
  const stillTime = windowEnd(s, y.scheduled_for) >= earliestRawDate(at)
  return {
    id: y.id, scheduledFor: y.scheduled_for, deliveryDate: y.delivery_date, slotId: y.slot_id, status: y.status, note: y.note,
    order: y.order_id ? { id: y.order_id, number: y.order_number, status: y.order_status, paymentStatus: y.order_payment_status, holdExpiresAt: y.order_hold_expires_at } : null,
    /** Pay is offered: set up and not paid, the subscription running, and a day still left to deliver it. */
    canPay: s.status === 'ACTIVE' && stillTime && (y.status === 'DUE' || unpaidCancelled),
    /** Paid, or waiting for a payment already started. */
    paid: y.status === 'ORDERED' && paid,
    awaitingPayment: y.status === 'ORDERED' && y.order_status === 'PAYMENT_PENDING',
  }
}

const CYCLE_SELECT = `SELECT y.*, o.number AS order_number, o.status AS order_status, o.payment_status AS order_payment_status, o.hold_expires_at AS order_hold_expires_at
    FROM subscription_cycles y LEFT JOIN orders o ON o.id = y.order_id`

/** The next nominal dates with no cycle yet: what the customer can skip ahead of time. */
function upcomingDates(s, cycles, at, n = 4) {
  if (s.status === 'CANCELLED') return []
  const from = [addDays(todayIST(at), 1), s.active_from].sort().at(-1)
  const have = new Set(cycles.map((y) => y.scheduled_for))
  return nominalDates(s, from, s.end_date).filter((d) => !have.has(d)).slice(0, n)
}

export function subscriptionView(s, cycles = [], { staff = false, at = now() } = {}) {
  const p = findProduct(s.sku)
  const ended = s.status !== 'CANCELLED' && s.end_date < earliestRawDate(at) && !cycles.some((y) => y.status === 'DUE' || (y.status === 'ORDERED' && y.order_status === 'PAYMENT_PENDING'))
  return {
    id: s.id, number: s.number, status: ended ? 'ENDED' : s.status,
    sku: s.sku, productName: p?.name ?? s.sku, unitPrice: p?.price ?? null, stage: s.stage, qty: s.qty,
    frequency: s.frequency, weekday: weekdayOf(s.first_date), firstDate: s.first_date, endDate: s.end_date, slotId: s.slot_id,
    address: staff ? null : { name: s.customer_name, address: s.delivery_address, pincode: s.pincode },
    pincode: s.pincode,
    createdAt: s.created_at, pausedAt: s.paused_at, cancelledAt: s.cancelled_at,
    cycles: cycles.map((y) => cycleView(s, y, at)),
    upcoming: upcomingDates(s, cycles, at),
    ...(staff ? { customer: { id: s.customer_id, name: s.cust_name ?? null, phoneMasked: masked(s.cust_phone) } } : {}),
  }
}

async function cyclesOf(c, ids) {
  if (!ids.length) return new Map()
  const { rows } = await c.query(`${CYCLE_SELECT} WHERE y.subscription_id = ANY($1) ORDER BY y.scheduled_for DESC`, [ids])
  return Map.groupBy(rows, (y) => y.subscription_id)
}

export async function listOwn(c, customerId) {
  const { rows } = await c.query('SELECT * FROM subscriptions WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20', [customerId])
  const cycles = await cyclesOf(c, rows.map((s) => s.id))
  return rows.map((s) => subscriptionView(s, (cycles.get(s.id) ?? []).slice(0, 6)))
}

export async function ownSubscription(c, customerId, id) {
  const { rows } = await c.query('SELECT * FROM subscriptions WHERE id = $1 AND customer_id = $2', [id, customerId])
  if (!rows.length) throw notFound('Subscription not found')
  const cycles = (await cyclesOf(c, [id])).get(id) ?? []
  const { rows: events } = await c.query('SELECT action, reason, created_at FROM subscription_events WHERE subscription_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50', [id])
  return { ...subscriptionView(rows[0], cycles), history: events.map((e) => ({ action: e.action, reason: e.reason, at: e.created_at })) }
}

/** Staff list (Subscriptions page): every subscription with its customer (phone masked) and its cycles from today on. */
export async function staffList(c, { status = null } = {}) {
  const today = todayIST()
  const { rows } = await c.query(
    `SELECT s.*, cu.name AS cust_name, cu.phone AS cust_phone FROM subscriptions s JOIN customers cu ON cu.id = s.customer_id
      WHERE ($1::text IS NULL OR s.status = $1) ORDER BY CASE s.status WHEN 'ACTIVE' THEN 0 WHEN 'PAUSED' THEN 1 ELSE 2 END, s.created_at DESC LIMIT 500`,
    [status],
  )
  const cycles = await cyclesOf(c, rows.map((s) => s.id))
  const items = rows.map((s) => subscriptionView(s, (cycles.get(s.id) ?? []).filter((y) => (y.delivery_date ?? y.scheduled_for) >= today), { staff: true }))
  const { rows: counts } = await c.query('SELECT status, COUNT(*)::int AS n FROM subscriptions GROUP BY status')
  return { items, counts: Object.fromEntries(['ACTIVE', 'PAUSED', 'CANCELLED'].map((k) => [k, counts.find((r) => r.status === k)?.n ?? 0])) }
}

// ---------------------------------------------------------------- the customer's changes

/**
 * Starts a subscription. Everything is checked here: the box is on sale, the
 * count fits the unpaid-box rule, the end date is no later than the season's
 * end, the address is one of the customer's own and is served, the slot is
 * active. The first cycle is set up at once when it is already due.
 */
export async function createSubscription(c, customerId, b, actor, at = now()) {
  const end = seasonEnd()
  if (!end || end < earliestRawDate(at)) throw conflict('Subscriptions are not open right now', 'SUBSCRIPTIONS_CLOSED')
  const product = sellable(b.sku)
  if (!product) throw badRequest(`${findProduct(b.sku)?.name ?? b.sku} is not on sale`, 'INVALID_SKU')
  const maxQty = Math.min(20, getConfig().maxHeldBoxes)
  if (b.qty > maxQty) throw badRequest(`A subscription box can be up to ${maxQty} boxes`, 'QTY_TOO_HIGH')
  const firstDate = firstDateFor(b.weekday, at)
  if (!isDate(b.endDate)) throw badRequest('endDate must be YYYY-MM-DD')
  if (b.endDate > end) throw badRequest(`The season ends on ${end}: choose that day or earlier`, 'END_AFTER_SEASON')
  if (b.endDate < firstDate) throw badRequest(`The first delivery is on ${firstDate}: choose an end date on or after it`, 'END_TOO_SOON')
  const { rows: cust } = await c.query('SELECT id, name, phone FROM customers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [customerId])
  if (!cust[0]?.phone) throw conflict('Add your mobile number first, so the rider can reach you.', 'PHONE_REQUIRED')
  const { rows: adr } = await c.query('SELECT * FROM customer_addresses WHERE id = $1 AND customer_id = $2', [b.addressId, customerId])
  if (!adr.length) throw notFound('Saved address not found')
  const a = adr[0]
  const { rows: pin } = await c.query('SELECT 1 FROM pincodes WHERE pincode = $1 AND active', [a.pincode])
  if (!pin.length) throw badRequest('We do not deliver to this pincode yet', 'NOT_SERVICEABLE')
  const { rows: slots } = await c.query('SELECT id FROM delivery_slots WHERE active')
  let slotId = null
  if (slots.length) {
    if (!b.slotId) throw badRequest('Choose a delivery slot', 'SLOT_REQUIRED')
    if (!slots.some((s) => s.id === b.slotId)) throw badRequest('That delivery slot is not available', 'SLOT_INVALID')
    slotId = b.slotId
  }
  const { rows: running } = await c.query(`SELECT * FROM subscriptions WHERE customer_id = $1 AND status <> 'CANCELLED' AND end_date >= $2`, [customerId, todayIST(at)])
  if (running.some((s) => s.sku === b.sku && s.stage === b.stage && s.pincode === a.pincode && s.delivery_address === a.address)) {
    throw conflict('You already have this box on a subscription to this address', 'DUPLICATE_SUBSCRIPTION')
  }
  if (running.length >= MAX_SUBSCRIPTIONS) throw conflict(`You can have ${MAX_SUBSCRIPTIONS} subscriptions at a time. Cancel one first.`, 'TOO_MANY_SUBSCRIPTIONS')
  const id = newId('sub')
  const number = (await c.query(`SELECT 'SUB-' || nextval('subscription_seq') AS n`)).rows[0].n
  const { rows } = await c.query(
    `INSERT INTO subscriptions (id, number, customer_id, sku, stage, qty, frequency, first_date, end_date, active_from, slot_id,
                                customer_name, delivery_address, pincode, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $10, $11, $12, $13, 'ACTIVE', $14, $14) RETURNING *`,
    [id, number, customerId, b.sku, b.stage, b.qty, b.frequency, firstDate, b.endDate, slotId, a.name ?? cust[0].name ?? null, a.address, a.pincode, at],
  )
  await event(c, id, 'CREATED', actor)
  await scheduleSubscription(c, rows[0], at)
  return id
}

async function lockOwn(c, customerId, id) {
  const { rows } = await c.query('SELECT * FROM subscriptions WHERE id = $1 AND customer_id = $2 FOR UPDATE', [id, customerId])
  if (!rows.length) throw notFound('Subscription not found')
  return rows[0]
}

async function lockAny(c, id) {
  const { rows } = await c.query('SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE', [id])
  if (!rows.length) throw notFound('Subscription not found')
  return rows[0]
}

/** Cycles set up but not paid for are called off when a subscription pauses or stops. */
const dropDueCycles = (c, id, note) =>
  c.query(`UPDATE subscription_cycles SET status = 'CANCELLED', note = $2, updated_at = $3 WHERE subscription_id = $1 AND status = 'DUE'`, [id, note, now()])

async function pause(c, s, actor, reason) {
  if (s.status !== 'ACTIVE') throw conflict(s.status === 'PAUSED' ? 'This subscription is already paused' : 'This subscription has been cancelled', 'NOT_ACTIVE')
  await c.query(`UPDATE subscriptions SET status = 'PAUSED', paused_at = $2, updated_at = $2 WHERE id = $1`, [s.id, now()])
  await dropDueCycles(c, s.id, 'Paused before it was paid for')
  await event(c, s.id, 'PAUSED', actor, { reason })
}

async function cancel(c, s, actor, reason) {
  if (s.status === 'CANCELLED') throw conflict('This subscription is already cancelled', 'NOT_ACTIVE')
  await c.query(`UPDATE subscriptions SET status = 'CANCELLED', cancelled_at = $2, updated_at = $2 WHERE id = $1`, [s.id, now()])
  await dropDueCycles(c, s.id, 'Cancelled before it was paid for')
  await event(c, s.id, 'CANCELLED', actor, { reason })
}

export const customerPause = async (c, customerId, id, actor) => pause(c, await lockOwn(c, customerId, id), actor, null)
export const customerCancelSubscription = async (c, customerId, id, actor) => cancel(c, await lockOwn(c, customerId, id), actor, null)
export const staffPause = async (c, id, actor, reason) => pause(c, await lockAny(c, id), actor, reason)
export const staffCancel = async (c, id, actor, reason) => cancel(c, await lockAny(c, id), actor, reason)

/** Picks up again from the first day that can still be ordered: dates passed while paused are not missed. */
export async function customerResume(c, customerId, id, actor, at = now()) {
  const s = await lockOwn(c, customerId, id)
  if (s.status !== 'PAUSED') throw conflict(s.status === 'ACTIVE' ? 'This subscription is not paused' : 'This subscription has been cancelled', 'NOT_PAUSED')
  const from = earliestRawDate(at)
  if (s.end_date < from) throw conflict('This subscription has reached its end date. Start a new one.', 'SUBSCRIPTION_ENDED')
  const { rows } = await c.query(`UPDATE subscriptions SET status = 'ACTIVE', paused_at = NULL, active_from = $2, updated_at = $3 WHERE id = $1 RETURNING *`, [s.id, from, at])
  await event(c, s.id, 'RESUMED', actor)
  await scheduleSubscription(c, rows[0], at)
}

/**
 * Skips one delivery, named by its nominal date. Not yet set up: a SKIPPED row
 * takes its place, so the scheduler never makes it. Set up and unpaid: called
 * off (an unpaid order started for it is cancelled, which costs nothing).
 * Paid: refused; the order is cancelled from its own page, with the refund.
 */
export async function skipCycle(c, customerId, id, scheduledFor, actor, at = now()) {
  const s = await lockOwn(c, customerId, id)
  if (s.status !== 'ACTIVE') throw conflict('Only a running subscription has deliveries to skip', 'NOT_ACTIVE')
  const valid = isDate(scheduledFor) && scheduledFor >= s.first_date && scheduledFor >= s.active_from && scheduledFor <= s.end_date
    && diffDays(scheduledFor, s.first_date) % period(s) === 0 && scheduledFor > todayIST(at)
  if (!valid) throw badRequest('That is not one of this subscription\'s coming deliveries', 'INVALID_DATE')
  const { rows } = await c.query(`${CYCLE_SELECT} WHERE y.subscription_id = $1 AND y.scheduled_for = $2 FOR UPDATE OF y`, [s.id, scheduledFor])
  const y = rows[0]
  if (!y) {
    const ins = await c.query(
      `INSERT INTO subscription_cycles (id, subscription_id, scheduled_for, status, note, created_at, updated_at) VALUES ($1, $2, $3, 'SKIPPED', 'Skipped by the customer', $4, $4) RETURNING id`,
      [newId('cyc'), s.id, scheduledFor, at],
    )
    await event(c, s.id, 'SKIPPED', actor, { cycleId: ins.rows[0].id, reason: scheduledFor })
    return
  }
  if (y.status === 'ORDERED') {
    if (y.order_status === 'PAYMENT_PENDING') await customerCancel(c, y.order_id, customerId, actor)
    else if (y.order_status !== 'CANCELLED') {
      throw conflict(`This delivery is paid for (order ${y.order_number}). Cancel that order from its page for a full refund.`, 'ALREADY_PAID')
    }
  } else if (y.status !== 'DUE') throw conflict(`This delivery is already ${y.status.toLowerCase()}`, 'NOT_DUE')
  await c.query(`UPDATE subscription_cycles SET status = 'SKIPPED', note = 'Skipped by the customer', updated_at = $2 WHERE id = $1`, [y.id, at])
  await event(c, s.id, 'SKIPPED', actor, { cycleId: y.id, reason: scheduledFor })
}

// ---------------------------------------------------------------- paying for a cycle

/** Slots to try on a date, the subscription's own first, each with room for `qty`. [null] when slots are not in use. */
async function slotChoices(c, date, preferred, qty) {
  const slots = await slotsForDate(c, date)
  if (!slots.length) return [null]
  const fits = slots.filter((s) => s.remainingBoxes == null || s.remainingBoxes >= qty)
  return fits.sort((a, b) => (b.id === preferred) - (a.id === preferred)).map((s) => s.id)
}

/**
 * Pay for one cycle: makes the ordinary unpaid order for it (PAYMENT_PENDING,
 * held for holdMinutes) with the checkout's own rules: the unpaid-order limits
 * (checkUnpaidLimit), the day's capacity and slot (checked under lock by
 * createOrder) and all-or-nothing stock. The cycle's day first, then each
 * later open day up to the next cycle when that one has filled or sold out.
 * A payment already started and still held is handed back instead of a second
 * order. Returns { order, existing }.
 */
export async function orderCycle(c, { customerId, subscriptionId, cycleId }, actor, at = now()) {
  const s = await lockOwn(c, customerId, subscriptionId)
  const { rows } = await c.query(`${CYCLE_SELECT} WHERE y.id = $1 AND y.subscription_id = $2 FOR UPDATE OF y`, [cycleId, s.id])
  const y = rows[0]
  if (!y) throw notFound('Delivery not found')
  if (s.status !== 'ACTIVE') throw conflict('This subscription is not running, so there is nothing to pay for', 'NOT_ACTIVE')
  if (y.status === 'ORDERED') {
    if (y.order_status === 'PAYMENT_PENDING' && y.order_hold_expires_at > at) {
      return { order: (await c.query('SELECT * FROM orders WHERE id = $1', [y.order_id])).rows[0], existing: true }
    }
    if (y.order_status !== 'CANCELLED' || y.order_payment_status === 'SUCCEEDED') throw conflict(`This delivery is already paid for (order ${y.order_number})`, 'ALREADY_PAID')
  } else if (y.status !== 'DUE') throw conflict(`This delivery is ${y.status.toLowerCase()}`, 'NOT_DUE')
  const product = sellable(s.sku)
  if (!product) throw conflict(`${findProduct(s.sku)?.name ?? s.sku} is no longer sold`, 'PRODUCT_UNAVAILABLE')
  const { rows: cust } = await c.query('SELECT name, phone FROM customers WHERE id = $1', [customerId])
  if (!cust[0]?.phone) throw conflict('Add your mobile number first, so the rider can reach you.', 'PHONE_REQUIRED')
  await checkUnpaidLimit(c, customerId, s.qty, at)
  const last = windowEnd(s, y.scheduled_for)
  const from = y.delivery_date ?? y.scheduled_for
  const dates = (await orderableDates(c, at)).filter((d) => d >= from && d <= last)
  for (const date of dates) {
    for (const slotId of await slotChoices(c, date, y.slot_id ?? s.slot_id, s.qty)) {
      await c.query('SAVEPOINT cycle_day')
      try {
        const order = await createOrder(
          c,
          {
            customerId, customerName: s.customer_name ?? cust[0].name, phone: cust[0].phone, pincode: s.pincode, address: s.delivery_address,
            deliveryDate: date, slotId, strictSlot: Boolean(slotId), status: 'PAYMENT_PENDING', paymentStatus: 'INITIATED', allOrNothing: true,
            holdExpiresAt: new Date(at.getTime() + getConfig().holdMinutes * 60_000),
            lines: [{ sku: s.sku, stage: s.stage, qty: s.qty, unitPrice: product.price }],
            eventReason: `From subscription ${s.number}`,
          },
          actor,
        )
        await c.query('RELEASE SAVEPOINT cycle_day')
        const moved = date !== (y.delivery_date ?? y.scheduled_for)
        await c.query(
          `UPDATE subscription_cycles SET status = 'ORDERED', order_id = $2, delivery_date = $3, slot_id = $4, updated_at = $5,
                  note = CASE WHEN $6 THEN $7 ELSE note END WHERE id = $1`,
          [y.id, order.id, date, slotId, at, moved, `Moved to ${date}: the day before was full or out of stock`],
        )
        await event(c, s.id, 'ORDER_STARTED', actor, { cycleId: y.id, reason: `${order.number} for ${date}` })
        return { order: (await c.query('SELECT * FROM orders WHERE id = $1', [order.id])).rows[0], existing: false }
      } catch (err) {
        await c.query('ROLLBACK TO SAVEPOINT cycle_day')
        if (!(err instanceof HttpError && DAY_PROBLEMS.has(err.code))) throw err
      }
    }
  }
  throw conflict('No delivery day before your next box has this box in stock with room left. This one will be marked missed; your next box is not affected.', 'CYCLE_NO_DAY')
}

// ---------------------------------------------------------------- the scheduler

/** The first of `dates` with room on the day, a slot with room and the box in stock (read only: nothing is held). */
async function firstFit(c, s, dates) {
  for (const date of dates) {
    try {
      await checkCapacity(c, date, s.qty, null, { lock: false })
    } catch (err) {
      if (err instanceof HttpError) continue
      throw err
    }
    if (((await availability(c, date)).get(`${s.sku}|${s.stage}`) ?? 0) < s.qty) continue
    const slots = await slotChoices(c, date, s.slot_id, s.qty)
    if (!slots.length) continue
    return { date, slotId: slots[0] }
  }
  return null
}

/**
 * Sets up the subscription's cycles that are due (nominal date within
 * SUBSCRIPTION_LEAD_DAYS). Each goes on the first day of its period with
 * room and stock, and the customer is reminded to pay. One whose whole period
 * has passed without such a day is recorded as MISSED. Returns how many
 * cycles this call created.
 */
export async function scheduleSubscription(c, s, at = now()) {
  if (s.status !== 'ACTIVE') return 0
  const today = todayIST(at)
  const horizon = addDays(today, env.SUBSCRIPTION_LEAD_DAYS)
  const lookBack = [addDays(today, -period(s)), s.active_from].sort().at(-1)
  const due = nominalDates(s, lookBack, horizon)
  if (!due.length) return 0
  const { rows: have } = await c.query('SELECT scheduled_for FROM subscription_cycles WHERE subscription_id = $1 AND scheduled_for = ANY($2)', [s.id, due])
  const taken = new Set(have.map((r) => r.scheduled_for))
  const open = await orderableDates(c, at)
  const earliest = earliestRawDate(at)
  let made = 0
  for (const d of due) {
    if (taken.has(d)) continue
    const last = windowEnd(s, d)
    const fit = await firstFit(c, s, open.filter((x) => x >= d && x <= last))
    if (fit) {
      const note = fit.date !== d ? `Booked for ${fit.date}: ${d} was full, closed or out of stock` : null
      const ins = await c.query(
        `INSERT INTO subscription_cycles (id, subscription_id, scheduled_for, delivery_date, slot_id, status, note, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'DUE', $6, $7, $7) ON CONFLICT (subscription_id, scheduled_for) DO NOTHING RETURNING id`,
        [newId('cyc'), s.id, d, fit.date, fit.slotId, note, at],
      )
      if (!ins.rowCount) continue
      await event(c, s.id, 'CYCLE_DUE', SYSTEM, { cycleId: ins.rows[0].id, reason: note ?? `For ${fit.date}` })
      await enqueueCycleDue(c, ins.rows[0].id)
      made++
    } else if (last < earliest) {
      const ins = await c.query(
        `INSERT INTO subscription_cycles (id, subscription_id, scheduled_for, status, note, created_at, updated_at)
         VALUES ($1, $2, $3, 'MISSED', 'No delivery day with this box in stock and room left before the next one', $4, $4)
         ON CONFLICT (subscription_id, scheduled_for) DO NOTHING RETURNING id`,
        [newId('cyc'), s.id, d, at],
      )
      if (ins.rowCount) await event(c, s.id, 'CYCLE_MISSED', SYSTEM, { cycleId: ins.rows[0].id, reason: `No day with stock and room for ${d}` })
    }
  }
  return made
}

/**
 * The maintenance step (SUBSCRIPTIONS): cycles set up but never paid for whose
 * last possible day has passed become MISSED, then every running subscription
 * gets its due cycles. Each subscription in its own short transaction, locked
 * with SKIP LOCKED so an overlapping run (or a customer changing it) is passed
 * over rather than waited on; the unique cycle row makes a repeat harmless.
 */
export async function runSubscriptionJobs(at = now()) {
  const earliest = earliestRawDate(at)
  const lapsed = await query(
    `UPDATE subscription_cycles y SET status = 'MISSED', note = 'Not paid for before its last delivery day', updated_at = $2
       FROM subscriptions s
      WHERE s.id = y.subscription_id AND LEAST(y.scheduled_for + (CASE s.frequency WHEN 'WEEKLY' THEN 6 ELSE 13 END), s.end_date) < $1::date
        AND (y.status = 'DUE' OR (y.status = 'ORDERED' AND EXISTS (
              SELECT 1 FROM orders o WHERE o.id = y.order_id AND o.status = 'CANCELLED' AND o.payment_status NOT IN ('SUCCEEDED', 'REFUNDED'))))`,
    [earliest, at],
  )
  const { rows } = await query(`SELECT id FROM subscriptions WHERE status = 'ACTIVE' AND end_date >= $1 ORDER BY created_at LIMIT 2000`, [todayIST(at)])
  let created = 0
  let failed = 0
  for (const { id } of rows) {
    try {
      created += await tx(async (c) => {
        const { rows: s } = await c.query(`SELECT * FROM subscriptions WHERE id = $1 AND status = 'ACTIVE' FOR UPDATE SKIP LOCKED`, [id])
        return s.length ? scheduleSubscription(c, s[0], at) : 0
      })
    } catch (err) {
      // One subscription that fails (a bad row) must not stop the others; the next run tries it again.
      failed++
      logger.error({ err, subscriptionId: id }, 'could not set up a subscription cycle')
    }
  }
  // The others went ahead; the step is still recorded as failed (Needs attention, Sentry) and the next run retries.
  if (failed) throw new Error(`${failed} subscriptions could not have their cycles set up (${created} cycles were); see the log`)
  return { created, missed: lapsed.rowCount }
}
