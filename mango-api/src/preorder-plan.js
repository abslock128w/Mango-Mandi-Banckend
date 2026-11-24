// The pre-order plan's recalculation (the owner, 18 Nov 2026: "we change later in the season how many kg of mangoes
// we get per day; the backend then recalculates, from the pre-orders we have, when each customer's order is delivered:
// whoever ordered first is delivered first"). Managers change a variety's expected kg a day or a week's own kg on the
// Pre-order plan page; the panel shows a PREVIEW (a dry run) and the manager APPLIES it.
//
// For each variety, separately (a booking only ever counts against its own variety, migration 078):
//   1. The weeks: the delivery weeks from the first OPEN week on. A frozen week (preorders.js frozenWeeks: on or before
//      the allocator's horizon, or with a booking already converted) is left exactly as it is, and so is every week
//      before it.
//   2. The bookings: every unpaid (PAYMENT_PENDING) and paid (BOOKED) booking of the variety in an open week (or later),
//      lined up oldest first: COALESCE(booked_at, created_at), created_at, id (the allocator's order for paid ones).
//   3. The refill: each booking, whole, goes to the earliest open week with room for its kg under the current limits
//      (the variety's daily kg x 7, or the week's own expected kg for it). What other bookings hold in a week (a booking
//      being paid or cancelled at this very moment, skipped while it is locked) stays counted where it is. A booking that
//      fits no week to the season's end keeps its week (counted as `noRoom`; the week shows over its limit).
//   4. The moves: later = DELAYED (paid: delayed_at, delayed_from_week kept, delay_count + 1, an event, PREORDER_DELAYED
//      queued, and the customer may now cancel for a full refund until it is packed); earlier = PREORDER_EARLIER (paid);
//      an unpaid booking just takes its new week (no message: the shop shows the week before paying). One message per
//      moved booking (the move's own event id), so applying the same plan again moves nothing and sends nothing.
//      A booking we delayed is never moved earlier again (the owner): its current week is its floor. It keeps its place in
//      the oldest-first queue but only takes weeks from its floor on, so no PREORDER_EARLIER for it. A newer booking that was
//      never delayed may then get an earlier week than it (`delayedStay.overtakenBy` counts them).
//   5. Regular orders booked against the plan (plan-orders.js) share the week's kg, but pre-orders outrank them: their kg
//      counts as taken, unless a pre-order would otherwise be delayed or a week is left over its number. Then planned
//      orders without fruit move out first, newest first (each in its own transaction after the refill: ORDER_DELAYED and
//      the cancel right for a paid one). Only then do pre-orders move. The preview counts them (`planned`).
//
// Race-safety: one variety per transaction (bounded: a variety's bookings and its weeks), under an advisory lock per
// variety so two applies queue. The bookings are locked first (FOR UPDATE SKIP LOCKED, in id order), then the variety's
// week rows (in week order): the same order a manager's move, a cancel and the allocator take (a booking, then week
// rows), while a new booking only takes week rows, so none of them can deadlock with it. The kg counters move by
// deltas, so what a concurrent booking or cancel did to a week stays counted. Writes are a few set-based statements
// per variety (tested with thousands of bookings).
import { now } from './clock.js'
import { getConfig } from './config.js'
import { query, tx } from './db.js'
import { newId } from './ids.js'
import { logger } from './logger.js'
import { enqueuePreorderMoves } from './notify.js'
import { SYSTEM } from './orders.js'
import { movablePlanned, moveOutPlanned } from './plan-orders.js'
import { delayAfterMove, deliveryWeeks, frozenWeeks, planVarieties, promoteWaitlist, roundKg, setWeekLimit, weekLimit, weekLoad, weekRoom } from './preorders.js'

const PLAN_LOCK = 780_178

/** The open weeks of `weeks`: after the last frozen one. */
export const openOf = (weeks, frozen) => {
  const last = [...frozen].sort().at(-1) ?? null
  return weeks.filter((w) => !frozen.has(w) && (!last || w > last))
}

/** Oldest first: the order bookings are delivered in. */
const byAge = (a, b) =>
  new Date(a.booked_at ?? a.created_at) - new Date(b.booked_at ?? b.created_at) || new Date(a.created_at) - new Date(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * One variety's refill (steps 1 to 4), inside `c`. `rules`: the rules to plan with (a preview passes the manager's
 * draft); `overrides`: [{ weekStart, limitKg }] week limits for this variety (a preview: not written; apply: written
 * first). Returns { variety, moves, weeks, noRoom, frozen, open }.
 */
async function planVariety(c, variety, { dryRun, rules, overrides, actor, reason }) {
  if (!dryRun) await c.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [PLAN_LOCK, variety])
  const weeks = await deliveryWeeks(c)
  const frozen = await frozenWeeks(c, weeks)
  const open = openOf(weeks, frozen)
  const own = new Map(overrides.map((o) => [o.weekStart, o.limitKg]))
  if (!dryRun) for (const [w, kg] of own) if (weeks.includes(w)) await setWeekLimit(c, w, kg, variety)
  const empty = { variety, moves: [], weeks: [], noRoom: [], evicted: [], delayedStay: { bookings: 0, kg: 0, overtakenBy: 0 }, frozen: [...frozen].filter((w) => weeks.includes(w)), open }
  const planned = await movablePlanned(c, variety)
  if (!open.length && !planned.length) return empty
  const { rows: mine } = !open.length ? { rows: [] } : await c.query(
    `SELECT p.* FROM preorders p LEFT JOIN products pr ON pr.sku = p.sku
      WHERE p.status IN ('PAYMENT_PENDING', 'BOOKED') AND COALESCE(p.variety, pr.variety, p.sku) = $1 AND p.week_start >= $2
      ORDER BY p.id ${dryRun ? '' : 'FOR UPDATE OF p SKIP LOCKED'}`,
    [variety, open[0]],
  )
  if (!dryRun && open.length) {
    await c.query(
      `INSERT INTO preorder_variety_week_kg (week_start, variety) SELECT w, $2 FROM unnest($1::date[]) AS w ON CONFLICT DO NOTHING`,
      [open, variety],
    )
    await c.query('SELECT 1 FROM preorder_variety_week_kg WHERE variety = $1 AND week_start = ANY($2::date[]) ORDER BY week_start FOR UPDATE', [variety, open])
  }
  // The open weeks, and any other week holding planned orders that can move (a frozen week can be left short too).
  const scope = [...new Set([...open, ...planned.map((o) => o.week)])].sort()
  const room = await weekRoom(c, scope, variety, rules)
  const limit = new Map(room.map((w) => [w.weekStart, own.has(w.weekStart) ? weekLimit(variety, own.get(w.weekStart), rules) : w.limit]))
  // What the week holds besides these bookings (others locked right now, drift): it stays where it is.
  const held = new Map(room.map((w) => [w.weekStart, w.reserved]))
  for (const p of mine) if (held.has(p.week_start)) held.set(p.week_start, roundKg(held.get(p.week_start) - weekLoad(p)))
  const used = new Map(scope.map((w) => [w, Math.max(0, held.get(w) ?? 0)]))
  const before = new Map(room.map((w) => [w.weekStart, w.reserved]))
  const moves = []
  const noRoom = []
  // Planned-order kg per week, and those that can still leave it, newest first (movablePlanned's order).
  const plan = new Map(room.map((w) => [w.weekStart, w.planned]))
  const leaving = new Map(scope.map((w) => [w, planned.filter((o) => o.week === w)]))
  const evicted = []
  const finalWeek = new Map()
  const delayedStay = { bookings: 0, kg: 0, overtakenBy: 0 }
  const free = (w) => roundKg(limit.get(w) - used.get(w) - plan.get(w))
  const evict = (w, need) => {
    while (free(w) < need && leaving.get(w).length) {
      const o = leaving.get(w).shift()
      plan.set(w, roundKg(plan.get(w) - o.kg))
      evicted.push(o)
    }
  }
  for (const p of [...mine].sort(byAge)) {
    const kg = weekLoad(p)
    // A delayed booking: no week before its current one.
    const allowed = p.delayed_at ? open.filter((w) => w >= p.week_start) : open
    const could = open.find((w) => free(w) >= kg) ?? null
    let to = allowed.find((w) => free(w) >= kg) ?? null
    if (p.delayed_at && could && could < p.week_start) {
      delayedStay.bookings++
      delayedStay.kg = roundKg(delayedStay.kg + kg)
    }
    // It would be delayed only because of planned orders: they go first.
    if (!to || to > p.week_start) {
      const w = allowed.find((x) => x <= p.week_start && roundKg(limit.get(x) - used.get(x)) >= kg)
      if (w) {
        evict(w, kg)
        if (free(w) >= kg) to = w
      }
    }
    if (!to) {
      noRoom.push({ id: p.id, number: p.number, week: p.week_start, kg })
      finalWeek.set(p.id, p.week_start)
      if (used.has(p.week_start)) used.set(p.week_start, roundKg(used.get(p.week_start) + kg))
      continue
    }
    used.set(to, roundKg(used.get(to) + kg))
    finalWeek.set(p.id, to)
    if (to !== p.week_start) moves.push({ p, from: p.week_start, to, kg })
  }
  // Never-delayed bookings that end up in an earlier week than an older delayed one.
  let latestDelayed = null
  for (const p of [...mine].sort(byAge)) {
    const w = finalWeek.get(p.id)
    if (p.delayed_at) latestDelayed = !latestDelayed || w > latestDelayed ? w : latestDelayed
    else if (latestDelayed && w < latestDelayed) delayedStay.overtakenBy++
  }
  // A week still over its number (it was lowered): planned orders leave it, newest first.
  for (const w of scope) evict(w, 0)
  const weekRows = open
    .map((w) => ({ weekStart: w, variety, limit: limit.get(w), before: roundKg(before.get(w) ?? 0), after: roundKg(used.get(w)) }))
    .filter((w) => w.before !== w.after || w.limit !== room.find((r) => r.weekStart === w.weekStart).limit)
  if (!dryRun && moves.length) await applyMoves(c, variety, moves, actor, reason)
  return { ...empty, moves, weeks: weekRows, noRoom, evicted, delayedStay }
}

/** Writes a variety's moves in a few set-based statements: the bookings, their events, the kg counters, the messages. */
async function applyMoves(c, variety, moves, actor, reason) {
  const at = now()
  const rows = moves.map(({ p, to }) => {
    const d = delayAfterMove(p, to, at)
    return { id: p.id, to, delayed_at: d.delayed_at, delayed_from_week: d.delayed_from_week, delay_count: d.delay_count }
  })
  const { rows: after } = await c.query(
    `UPDATE preorders p SET week_start = x.to, moved_count = p.moved_count + 1, delayed_at = x.delayed_at,
            delayed_from_week = x.delayed_from_week, delay_count = x.delay_count
       FROM jsonb_to_recordset($1::jsonb) AS x(id text, "to" date, delayed_at timestamptz, delayed_from_week date, delay_count int)
      WHERE p.id = x.id RETURNING p.id, p.moved_count`,
    [JSON.stringify(rows)],
  )
  const movedCount = new Map(after.map((r) => [r.id, r.moved_count]))
  await c.query(
    `INSERT INTO preorder_events (id, preorder_id, status, reason, actor, created_at)
     SELECT x.id, x.preorder_id, x.status, x.reason, $2, $3 FROM jsonb_to_recordset($1::jsonb) AS x(id text, preorder_id text, status text, reason text)`,
    [
      JSON.stringify(moves.map(({ p, from, to }) => ({
        id: newId('pev'), preorder_id: p.id, status: p.status,
        reason: `${to > from ? 'Delayed' : 'Moved earlier'} from the week of ${from} to the week of ${to}: ${reason}`,
      }))),
      actor.label ?? actor.id, at,
    ],
  )
  // The kg counters, by deltas: this variety's (the one that decides), every box's (076) and one-per-booking (074),
  // and each box's (preorder_capacity). Rows in week order, as every other writer takes them.
  const delta = (key, n, add) => n.set(key, (n.get(key) ?? 0) + add)
  const kg = new Map()
  const count = new Map()
  const boxes = new Map()
  for (const { p, from, to } of moves) {
    delta(from, kg, -weekLoad(p))
    delta(to, kg, weekLoad(p))
    delta(from, count, -1)
    delta(to, count, 1)
    delta(`${p.sku}|${from}`, boxes, -p.qty)
    delta(`${p.sku}|${to}`, boxes, p.qty)
  }
  const weeks = [...kg.keys()].sort()
  const kgs = weeks.map((w) => roundKg(kg.get(w)))
  await c.query(
    `UPDATE preorder_variety_week_kg k SET reserved_kg = GREATEST(k.reserved_kg + d.kg, 0)
       FROM unnest($1::date[], $2::numeric[]) AS d(w, kg) WHERE k.week_start = d.w AND k.variety = $3`,
    [weeks, kgs, variety],
  )
  // Every box's counter (076): weeks that gained kg (made if missing), then weeks that lost some.
  await c.query(
    `INSERT INTO preorder_week_kg (week_start, reserved_kg) SELECT w, kg FROM unnest($1::date[], $2::numeric[]) AS d(w, kg) ORDER BY w
     ON CONFLICT (week_start) DO UPDATE SET reserved_kg = preorder_week_kg.reserved_kg + EXCLUDED.reserved_kg`,
    [weeks.filter((_, i) => kgs[i] > 0), kgs.filter((x) => x > 0)],
  )
  await c.query(
    `UPDATE preorder_week_kg k SET reserved_kg = GREATEST(k.reserved_kg + d.kg, 0) FROM unnest($1::date[], $2::numeric[]) AS d(w, kg) WHERE k.week_start = d.w AND d.kg < 0`,
    [weeks, kgs],
  )
  const counts = weeks.map((w) => count.get(w))
  await c.query(
    `INSERT INTO preorder_weeks (week_start, reserved) SELECT w, GREATEST(n, 0) FROM unnest($1::date[], $2::int[]) AS d(w, n) ORDER BY w
     ON CONFLICT (week_start) DO UPDATE SET reserved = GREATEST(preorder_weeks.reserved + EXCLUDED.reserved, 0)`,
    [weeks.filter((_, i) => counts[i] > 0), counts.filter((n) => n > 0)],
  )
  await c.query(
    `UPDATE preorder_weeks k SET reserved = GREATEST(k.reserved + d.n, 0) FROM unnest($1::date[], $2::int[]) AS d(w, n) WHERE k.week_start = d.w AND d.n < 0`,
    [weeks, counts],
  )
  const keys = [...boxes.keys()].sort()
  await c.query(
    `INSERT INTO preorder_capacity (sku, week_start, capacity, reserved)
     SELECT s, w, 0, GREATEST(n, 0) FROM unnest($1::text[], $2::date[], $3::int[]) AS d(s, w, n) ORDER BY s, w
     ON CONFLICT (sku, week_start) DO UPDATE SET reserved = GREATEST(preorder_capacity.reserved + EXCLUDED.reserved, 0)`,
    [
      keys.filter((k) => boxes.get(k) > 0).map((k) => k.split('|')[0]),
      keys.filter((k) => boxes.get(k) > 0).map((k) => k.split('|')[1]),
      keys.filter((k) => boxes.get(k) > 0).map((k) => boxes.get(k)),
    ],
  )
  await c.query(
    `UPDATE preorder_capacity k SET reserved = GREATEST(k.reserved + d.n, 0) FROM unnest($1::text[], $2::date[], $3::int[]) AS d(s, w, n)
      WHERE k.sku = d.s AND k.week_start = d.w AND d.n < 0`,
    [keys.map((k) => k.split('|')[0]), keys.map((k) => k.split('|')[1]), keys.map((k) => boxes.get(k))],
  )
  // A paid booking's customer hears once per move: later (may cancel) or earlier (good news).
  await enqueuePreorderMoves(
    c,
    moves.filter(({ p }) => p.status === 'BOOKED').map(({ p, from, to }) => ({
      id: p.id, number: p.number, name: p.customer_name, phone: p.phone, movedCount: movedCount.get(p.id), kind: to > from ? 'PREORDER_DELAYED' : 'PREORDER_EARLIER', from, to,
    })),
  )
}

/** The varieties a recalculation looks at: the plan's lines and any variety that still has open bookings. */
async function varietiesToPlan(c) {
  const { rows } = await c.query(
    `SELECT DISTINCT COALESCE(p.variety, pr.variety, p.sku) AS v FROM preorders p LEFT JOIN products pr ON pr.sku = p.sku
      WHERE p.status IN ('PAYMENT_PENDING', 'BOOKED')`,
  )
  return [...new Set([...planVarieties(), ...rows.map((r) => r.v)])]
}

/**
 * Recalculates the plan (see the top of this file). `dryRun`: nothing is written (the preview). `rules`: the rules to
 * plan with (default the live ones; a preview of a daily-kg change passes the draft). `overrides`: [{ weekStart,
 * variety, limitKg }] week limits per variety (a preview plans with them; apply writes them first, in the same
 * transaction as that variety's refill). `varieties`: only these (default all).
 * Returns { dryRun, delayed: { bookings, paid, kg }, earlier: {...}, noRoom: { bookings, kg }, weeks: [{ weekStart, variety,
 * limit, before, after }], frozenWeeks, firstOpenWeek, moves: [{ id, number, variety, from, to, kg, paid }] (dryRun counts only:
 * moves is empty unless `withMoves`), messages }.
 */
export async function recalculatePreorders({ dryRun = false, rules = getConfig(), overrides = [], varieties = null, actor = SYSTEM, reason = 'the pre-order plan changed', withMoves = !dryRun } = {}) {
  const names = varieties ?? (await varietiesToPlan({ query }))
  for (const o of overrides) if (!names.includes(o.variety)) names.push(o.variety)
  const out = {
    dryRun, delayed: { bookings: 0, paid: 0, kg: 0 }, earlier: { bookings: 0, paid: 0, kg: 0 }, noRoom: { bookings: 0, kg: 0 },
    weeks: [], frozenWeeks: [], firstOpenWeek: null, moves: [], messages: 0,
    // Regular orders booked against the plan that move to a later date (pre-orders come first).
    planned: { orders: 0, paid: 0, kg: 0, noRoom: 0, moves: [] },
    // Delayed bookings that could have gone earlier but keep their week; overtakenBy: newer bookings now ahead of a delayed one.
    delayedStay: { bookings: 0, kg: 0, overtakenBy: 0 },
  }
  for (const variety of names) {
    const r = await tx((c) => planVariety(c, variety, { dryRun, rules, overrides: overrides.filter((o) => o.variety === variety), actor, reason }))
    out.frozenWeeks = r.frozen
    out.firstOpenWeek = r.open[0] ?? null
    for (const m of r.moves) {
      const side = m.to > m.from ? out.delayed : out.earlier
      side.bookings++
      side.kg = roundKg(side.kg + m.kg)
      if (m.p.status === 'BOOKED') side.paid++
      if (withMoves) out.moves.push({ id: m.p.id, number: m.p.number, variety, from: m.from, to: m.to, kg: m.kg, paid: m.p.status === 'BOOKED' })
    }
    for (const o of r.evicted) {
      if (dryRun) {
        out.planned.orders++
        if (o.paid) out.planned.paid++
        out.planned.kg = roundKg(out.planned.kg + o.kg)
        continue
      }
      const done = await moveOutPlanned(o.id, variety, reason, actor)
      if (done?.noRoom) out.planned.noRoom++
      if (!done?.moved) continue
      out.planned.orders++
      if (done.paid) out.planned.paid++
      out.planned.kg = roundKg(out.planned.kg + o.kg)
      out.planned.moves.push({ id: o.id, number: o.number, variety, from: done.from, to: done.moved, kg: o.kg, paid: done.paid })
    }
    out.delayedStay.bookings += r.delayedStay.bookings
    out.delayedStay.kg = roundKg(out.delayedStay.kg + r.delayedStay.kg)
    out.delayedStay.overtakenBy += r.delayedStay.overtakenBy
    out.noRoom.bookings += r.noRoom.length
    out.noRoom.kg = roundKg(out.noRoom.kg + r.noRoom.reduce((t, x) => t + x.kg, 0))
    out.weeks.push(...r.weeks)
  }
  out.messages = out.delayed.paid + out.earlier.paid + out.planned.paid
  out.weeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.variety.localeCompare(b.variety))
  out.changedWeeks = new Set(out.weeks.filter((w) => w.before !== w.after).map((w) => w.weekStart)).size
  if (!dryRun) await promoteWaitlist().catch((err) => logger.warn({ err }, 'waitlist promotion after a recalculation failed; maintenance retries'))
  return out
}

