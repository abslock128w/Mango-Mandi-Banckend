// Preorders and their delivery weeks.
import express from 'express'
import { currentConfig, getConfig, rulesSchema, saveConfig } from '../config.js'
import { CAPACITY_STATUSES } from '../stock-watch.js'
import { z } from 'zod'
import { auditInTx } from '../access.js'
import { requireManager } from '../auth.js'
import { addDays, isDate, todayIST } from '../clock.js'
import { query, tx } from '../db.js'
import { asyncHandler, badRequest, conflict, parse } from '../errors.js'
import { GROUP_COLUMNS, isMonday, mondayOf, preorderView, PREORDER_STATUSES, promoteWaitlist, refundPreorder, setWeekLimit, staffCancelPreorder, staffMovePreorder, WEEK_COUNTS_BY, defaultWeekKg, deliveryWeeks, frozenWeeks, openWeeks, planVarieties, roundKg, varietyDayKg, varietyRoom, WEEK_LOAD_SQL, weekLoad, weekTotals, allocationHorizon } from '../preorders.js'
import { normaliseOrderNumber } from '../order-number.js'
import { refundOrder } from '../payments.js'
import { logger } from '../logger.js'
import { productName, sellable } from '../products.js'
import { stepUp, withoutConfirm } from './step-up.js'
import { sameRules } from './planning.js'
import { recalculatePreorders } from '../preorder-plan.js'
import { heldSummary } from '../holdback.js'
import { whatsappSender } from '../whatsapp.js'

export const router = express.Router()

// ---------------------------------------------------------------- preorders

const likeEscape = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`)
/** The Pre-order plan's bookings list filters (plain chips in the panel). */
export const BOOKING_FILTERS = ['delayed', 'unpaid', 'gift', 'waiting', 'cancelledAfterDelay']

/**
 * The bookings, for the Pre-order plan's list (oldest week first, 500 at most): `status`, `week`, `filter` (delayed: we
 * moved it later and it still is; unpaid; gift; waiting: paid, in a week whose deliveries have started, no delivery
 * order yet (waiting for fruit); cancelledAfterDelay) and `q` (a number typed any way, order-number.js, a name or a
 * phone). Each row carries its latest WhatsApp message about the booking (`message`: kind, status, error).
 */
router.get(
  '/preorders',
  asyncHandler(async (req, res) => {
    const f = parse(
      z.object({
        status: z.enum(PREORDER_STATUSES).optional(), week: z.string().refine(isDate, 'week must be YYYY-MM-DD').optional(),
        filter: z.enum(BOOKING_FILTERS).optional(), q: z.string().trim().max(80).optional(),
      }),
      Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')),
    )
    const params = [f.status ?? null, f.week ?? null]
    const where = ['($1::text IS NULL OR p.status = $1)', '($2::date IS NULL OR p.week_start = $2)']
    if (f.filter === 'delayed') where.push(`p.delayed_at IS NOT NULL AND p.week_start > p.delayed_from_week AND p.status IN ('BOOKED', 'CONVERTED')`)
    if (f.filter === 'unpaid') where.push(`p.status = 'PAYMENT_PENDING'`)
    // A gift: booked for someone else, or a line of a gift group. A pre-order bag (kind BAG) is the customer's own, not a gift.
    if (f.filter === 'gift') where.push(`(p.gift_recipient_name IS NOT NULL OR (p.group_id IS NOT NULL AND COALESCE(g.kind, 'GIFT') <> 'BAG'))`)
    if (f.filter === 'cancelledAfterDelay') where.push('p.delay_cancelled_at IS NOT NULL')
    if (f.filter === 'waiting') {
      params.push(await allocationHorizon({ query }))
      where.push(`p.status = 'BOOKED' AND p.week_start <= $${params.length}`)
    }
    if (f.q) {
      const q = normaliseOrderNumber(f.q)
      params.push(`${likeEscape(q)}%`, `%${likeEscape(q)}%`)
      const [starts, has] = [`$${params.length - 1}`, `$${params.length}`]
      where.push(`(p.number ILIKE ${starts} OR g.number ILIKE ${starts} OR o.number ILIKE ${starts} OR p.phone ILIKE ${has} OR p.customer_name ILIKE ${has} OR p.gift_recipient_name ILIKE ${has})`)
    }
    const { rows } = await query(
      `SELECT p.*, o.number AS order_number, o.status AS order_status, o.delivery_date AS order_date, ${GROUP_COLUMNS},
              m.kind AS msg_kind, m.status AS msg_status, m.last_error AS msg_error, m.provider_id AS msg_provider, m.sent_at AS msg_sent_at
         FROM preorders p LEFT JOIN orders o ON o.id = p.order_id LEFT JOIN preorder_groups g ON g.id = p.group_id
         LEFT JOIN LATERAL (SELECT kind, status, last_error, provider_id, sent_at FROM notifications n
                             WHERE n.preorder_id = p.id ORDER BY n.created_at DESC LIMIT 1) m ON TRUE
        WHERE ${where.join(' AND ')}
        ORDER BY p.week_start, COALESCE(p.booked_at, p.created_at), p.created_at, p.group_position NULLS FIRST LIMIT 500`,
      params,
    )
    res.json(rows.map((p) => ({
      ...preorderView(p),
      moveCount: p.moved_count, delayCount: p.delay_count, kg: weekLoad(p),
      order: p.order_id ? { id: p.order_id, number: p.order_number, status: p.order_status, deliveryDate: p.order_date } : null,
      message: p.msg_kind ? { kind: p.msg_kind, status: p.msg_status, error: p.msg_error, logged: p.msg_provider === 'log', sentAt: p.msg_sent_at } : null,
    })))
  }),
)

/** Manager cancel of a booking we can't fill: frees the capacity and refunds a paid booking in full. */
router.post(
  '/preorders/:id/cancel',
  requireManager,
  asyncHandler(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'reason is required').max(500) }), req.body ?? {})
    const r = await tx(async (c) => {
      const done = await staffCancelPreorder(c, req.params.id, req.actor, reason)
      // A paid booking is refunded: the manager confirms it is them (STEP_UP_ROUTES). A refusal rolls the cancel back.
      if (done.refund) await stepUp(req, { always: true })
      await auditInTx(c, req) // SEC-08, STAFF_AUDIT_TRAIL: a cancel (and its refund) is never left without its record
      return done
    })
    const send = r.refund === 'order' ? refundOrder : r.refund === 'preorder' ? refundPreorder : null
    if (send) await send(r.id).catch((err) => logger.error({ err, id: r.id }, 'refund failed; maintenance will retry'))
    res.json({ refunded: Boolean(r.refund) })
  }),
)

/**
 * The pre-order plan as the panel's Pre-order plan page reads it (migrations 074, 076, 078):
 *   varieties  [{ variety, dayKg, listed, weekKg, bookedKg, bookings }] the plan's lines: kg expected a day (listed: its
 *              own number; else the number for varieties not listed), = a week, and what is booked this season (kg and
 *              bookings holding room: unpaid, paid and converted).
 *   otherDayKg the daily kg for a variety not listed.
 *   weeks      [{ weekStart, frozen, limit, booked, remaining, over, orders, boxes, unpaid, waitlisted, varieties: [{ variety,
 *              limit, own, booked, remaining, over, orders }] }] every delivery week, its totals and each variety in it.
 *              `frozen`: its bookings are being turned into deliveries, so a recalculation leaves it as it is (frozenWeeks).
 * The older fields (limit, dayKg, nextWeek, countsBy) stay for an older panel.
 */
router.get(
  '/preorder-weeks',
  asyncHandler(async (_req, res) => {
    const weeks = await deliveryWeeks({ query })
    const rooms = await varietyRoom({ query }, weeks)
    const totals = weekTotals(rooms, weeks)
    const { rows } = await query(
      `SELECT week_start, COALESCE(p.variety, pr.variety, p.sku) AS variety,
              COUNT(*) FILTER (WHERE status = 'WAITLISTED')::int AS waitlisted,
              COALESCE(SUM(qty) FILTER (WHERE status = ANY($2)), 0)::int AS boxes,
              COUNT(*) FILTER (WHERE status = ANY($2))::int AS orders,
              COUNT(*) FILTER (WHERE status = 'PAYMENT_PENDING')::int AS unpaid
         FROM preorders p LEFT JOIN products pr ON pr.sku = p.sku WHERE week_start = ANY($1::date[]) GROUP BY 1, 2`,
      [weeks, CAPACITY_STATUSES],
    )
    const sum = (week, k, variety = null) => rows.filter((r) => r.week_start === week && (!variety || r.variety === variety)).reduce((t, r) => t + r[k], 0)
    const { rows: season } = await query(
      `SELECT COALESCE(p.variety, pr.variety, p.sku) AS variety, COUNT(*)::int AS bookings, COALESCE(SUM(${WEEK_LOAD_SQL}), 0) AS kg
         FROM preorders p JOIN products pr ON pr.sku = p.sku WHERE p.status = ANY($1) GROUP BY 1`,
      [CAPACITY_STATUSES],
    )
    const seasonBy = new Map(season.map((r) => [r.variety, r]))
    const frozen = await frozenWeeks({ query }, weeks)
    // The week a pre-order made now gets: the earliest week any box can get (as the shop's nextWeek).
    const { next } = await openWeeks({ query })
    const waiting = (await query(`SELECT COUNT(*)::int AS n FROM preorders WHERE status = 'WAITLISTED'`)).rows[0].n
    const cfg = getConfig()
    res.json({
      waitlisted: waiting,
      // Boxes held back from regular shoppers for paid bookings whose week has come (holdback.js), per variety and ripeness.
      held: await heldSummary({ query }),
      // Regular orders booked against the plan, per week and variety (plan-orders.js): they share each week's kg with the pre-orders.
      plannedOrders: (await query(
        `SELECT o.plan_week AS week, i.plan_variety AS variety, SUM(i.plan_kg)::float AS kg, COUNT(DISTINCT o.id)::int AS orders
           FROM orders o JOIN order_items i ON i.order_id = o.id
          WHERE o.planned AND o.plan_week >= $1 AND i.plan_kg IS NOT NULL AND o.status NOT IN ('CANCELLED', 'RTO', 'DELIVERED') GROUP BY 1, 2 ORDER BY 1, 2`,
        [mondayOf(todayIST())],
      )).rows,
      limit: defaultWeekKg(), dayKg: varietyDayKg(null), otherDayKg: varietyDayKg(null),
      countsBy: WEEK_COUNTS_BY,
      nextWeek: next?.weekStart ?? null,
      varieties: [...rooms.keys()].map((v) => ({
        variety: v, dayKg: varietyDayKg(v), listed: cfg.preorderVarietyDayKg?.[v] != null, weekKg: defaultWeekKg(v), onSale: planVarieties().includes(v),
        bookedKg: roundKg(seasonBy.get(v)?.kg ?? 0), bookings: seasonBy.get(v)?.bookings ?? 0,
      })),
      weeks: totals.map((w, i) => ({
        weekStart: w.weekStart, frozen: frozen.has(w.weekStart), limit: w.limit, own: null, booked: w.reserved, ...(w.planned ? { planned: w.planned } : {}), remaining: w.remaining, over: w.over,
        orders: sum(w.weekStart, 'orders'), boxes: sum(w.weekStart, 'boxes'), unpaid: sum(w.weekStart, 'unpaid'), waitlisted: sum(w.weekStart, 'waitlisted'),
        varieties: [...rooms].map(([variety, room]) => ({
          variety, limit: room[i].limit, own: room[i].own, booked: room[i].reserved, ...(room[i].planned ? { planned: room[i].planned } : {}), remaining: room[i].remaining, over: room[i].over,
          orders: sum(w.weekStart, 'orders', variety),
        })),
      })),
    })
  }),
)

/**
 * A week's own expected kg (managers, as the capacity edit was; written to the staff audit like every change):
 * { limitKg: number } for that week, or { limitKg: null } for the default (Planning's daily kg x 7). Lowering it
 * below what is booked is allowed (the harvest came in short): new pre-orders skip the week and the Pre-orders
 * page shows it over, with the bookings to move (POST /preorders/:id/move); nothing booked moves by itself.
 * Raising it makes room: the waitlist is offered it first, then new pre-orders.
 */
router.put(
  '/preorder-weeks/:weekStart',
  requireManager,
  asyncHandler(async (req, res) => {
    const weekStart = parse(z.string().refine((d) => isDate(d) && isMonday(d), 'weekStart must be a Monday (YYYY-MM-DD)'), req.params.weekStart)
    // `variety` (migration 078): that variety's own kg for the week. Without it (an older panel): split over the varieties on sale.
    const { limitKg, variety } = parse(z.object({ limitKg: z.number().min(0).max(1_000_000).nullable(), variety: z.string().trim().min(1).max(80).optional() }).strict(), req.body ?? {})
    const w = await tx(async (c) => {
      if (!(await deliveryWeeks(c)).includes(weekStart)) throw badRequest('That is not a delivery week open for pre-orders', 'INVALID_WEEK')
      return setWeekLimit(c, weekStart, limitKg, variety ?? null)
    })
    await promoteWaitlist().catch((err) => logger.warn({ err }, 'waitlist promotion after a week change failed; maintenance retries'))
    res.json({ weekStart: w.weekStart, limit: w.limit, own: w.own, booked: w.reserved, remaining: w.remaining, over: w.over })
  }),
)

// ---------------------------------------------------------------- the pre-order plan: preview, then apply (preorder-plan.js)

/**
 * A change to the plan: `dayKg` { variety: kg a day, or null to drop the variety's own number }, `otherDayKg` (varieties
 * not listed) and `weeks` [{ weekStart, variety, limitKg }] (a week's own expected kg for a variety; null: back to the
 * default). Everything optional: an empty change is "Recalculate now".
 */
const planChange = z.object({
  dayKg: z.record(z.string().trim().min(1).max(80), z.number().min(0).max(1_000_000).nullable()).optional(),
  otherDayKg: z.number().min(0).max(1_000_000).optional(),
  weeks: z.array(z.object({
    weekStart: z.string().refine((d) => isDate(d) && isMonday(d), 'weekStart must be a Monday (YYYY-MM-DD)'),
    variety: z.string().trim().min(1).max(80),
    limitKg: z.number().min(0).max(1_000_000).nullable(),
  }).strict()).max(500).optional(),
}).strict()

/** The rules with the change's daily kg in them (null when the daily kg don't change). Validated like PUT /config. */
function draftRules(b) {
  if (!b.dayKg && b.otherDayKg === undefined) return null
  const live = getConfig()
  const own = { ...(live.preorderVarietyDayKg ?? {}) }
  for (const [v, kg] of Object.entries(b.dayKg ?? {})) {
    if (kg == null) delete own[v]
    else own[v] = kg
  }
  const rules = parse(rulesSchema, { ...live, preorderVarietyDayKg: own, ...(b.otherDayKg !== undefined ? { preorderOtherVarietyDayKg: b.otherDayKg } : {}) })
  return sameRules(rules, live) ? null : rules
}

/** Weeks named in a change must be delivery weeks that are still open (a frozen week's deliveries have started). */
async function checkWeeks(weeks) {
  if (!weeks?.length) return
  const all = await deliveryWeeks({ query })
  const frozen = await frozenWeeks({ query }, all)
  for (const w of weeks) {
    if (!all.includes(w.weekStart)) throw badRequest(`The week of ${w.weekStart} is not a delivery week open for pre-orders`, 'INVALID_WEEK')
    if (frozen.has(w.weekStart)) throw conflict(`Deliveries for the week of ${w.weekStart} have started, so its plan can no longer change`, 'WEEK_FROZEN')
  }
}

/**
 * PREVIEW (managers): what the change would do, nothing written. The panel words it ("This delays 412 pre-orders
 * (2,100 kg) to a later week and messages those customers. 96 move earlier. 3 weeks change.") with the per-week
 * before/after table. Returns the recalculation's dry run (counts and weeks, no booking list).
 */
router.post(
  '/preorder-plan/preview',
  requireManager,
  asyncHandler(async (req, res) => {
    const b = parse(planChange, withoutConfirm(req.body ?? {}))
    await checkWeeks(b.weeks)
    const rules = draftRules(b)
    const r = await recalculatePreorders({ dryRun: true, rules: rules ?? getConfig(), overrides: b.weeks ?? [] })
    res.json({ ...r, rulesChange: Boolean(rules), whatsappConnected: Boolean(whatsappSender) })
  }),
)

/**
 * APPLY (managers): saves the daily kg (a rules version, with the manager's password or code like every rules change:
 * STEP_UP_ROUTES), writes the week limits and recalculates, moving bookings and queuing the customers' messages. With
 * no change it is "Recalculate now". Returns what was done: counts, the weeks, and the moved bookings.
 */
router.post(
  '/preorder-plan/apply',
  requireManager,
  asyncHandler(async (req, res) => {
    const b = parse(planChange, withoutConfirm(req.body ?? {}))
    await checkWeeks(b.weeks)
    const rules = draftRules(b)
    let version = currentConfig().version
    if (rules) {
      await stepUp(req, { always: true }) // a rules change, as PUT /config
      const saved = await saveConfig(rules, req.admin.email, {
        inTx: (c, was) => auditInTx(c, req, {
          target: null, body: { rules: { preorderVarietyDayKg: rules.preorderVarietyDayKg, preorderOtherVarietyDayKg: rules.preorderOtherVarietyDayKg } },
          before: { rules: { preorderVarietyDayKg: was?.preorderVarietyDayKg ?? null, preorderOtherVarietyDayKg: was?.preorderOtherVarietyDayKg ?? null } },
        }),
      })
      version = saved.version
    }
    const r = await recalculatePreorders({ overrides: b.weeks ?? [], actor: req.actor, reason: rules || b.weeks?.length ? 'the pre-order plan changed' : 'the plan was recalculated' })
    res.json({ ...r, version, rulesChanged: Boolean(rules), whatsappConnected: Boolean(whatsappSender) })
  }),
)

/**
 * A manager moves a booking (unpaid or paid, not yet an order) to another delivery week with room, e.g. out of a
 * week lowered below what it holds. Its kg moves with it; a paid booking's customer gets the moved message.
 */
router.post(
  '/preorders/:id/move',
  requireManager,
  asyncHandler(async (req, res) => {
    const b = parse(
      z.object({ weekStart: z.string().refine((d) => isDate(d) && isMonday(d), 'weekStart must be a Monday (YYYY-MM-DD)'), reason: z.string().trim().min(3, 'Give a reason (at least 3 characters)').max(500) }),
      req.body ?? {},
    )
    const p = await tx((c) => staffMovePreorder(c, req.params.id, b.weekStart, req.actor, b.reason))
    res.json(preorderView(p))
  }),
)

/** Per box and week, as before migration 074. The `capacity` here decides nothing any more (see /preorder-weeks). */
router.get(
  '/preorder-capacity',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT k.*, (SELECT COUNT(*)::int FROM preorders p WHERE p.sku = k.sku AND p.week_start = k.week_start AND p.status = 'WAITLISTED') AS waitlisted
         FROM preorder_capacity k WHERE k.week_start >= $1 ORDER BY k.week_start, k.sku`,
      [addDays(todayIST(), -7)],
    )
    res.json(rows.map((k) => ({ sku: k.sku, productName: productName(k.sku), weekStart: k.week_start, capacity: k.capacity, reserved: k.reserved, waitlisted: k.waitlisted })))
  }),
)

/**
 * Sets a week's capacity for a SKU, as before migration 074. Kept for older panels and scripts, but since then
 * the number decides nothing: every week takes its expected kilograms across all boxes (Planning, and PUT /preorder-weeks/:weekStart).
 */
router.put(
  '/preorder-capacity/:weekStart/:sku',
  requireManager,
  asyncHandler(async (req, res) => {
    const weekStart = parse(z.string().refine((d) => isDate(d) && isMonday(d), 'weekStart must be a Monday (YYYY-MM-DD)'), req.params.weekStart)
    if (!sellable(req.params.sku)) throw badRequest(`Unknown SKU ${req.params.sku}`, 'INVALID_SKU')
    const { capacity } = parse(z.object({ capacity: z.number().int().min(0).max(100_000) }), req.body)
    const { rows } = await query(
      `INSERT INTO preorder_capacity (sku, week_start, capacity) VALUES ($1, $2, $3)
       ON CONFLICT (sku, week_start) DO UPDATE SET capacity = $3 RETURNING *`,
      [req.params.sku, weekStart, capacity],
    )
    await promoteWaitlist().catch(() => {}) // maintenance retries
    res.json({ sku: rows[0].sku, weekStart: rows[0].week_start, capacity: rows[0].capacity, reserved: rows[0].reserved })
  }),
)
