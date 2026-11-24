// Things the stock and order engines can't settle on their own, for Needs
// attention, the Today page and the maintenance health check:
//   - overdue orders (INV-G): paid, not delivered, and past their date, or out
//     for delivery for longer than a delivery takes;
//   - preorders that keep rolling forward (INV-H);
//   - boxes on orders cancelled or returned after they left the store (INV-F),
//     which staff put back on the shelf or write off;
//   - preorder capacity counters that disagree with their bookings (INV-06)
//     and trucks still in transit after their arrival date (INV-08).
import { formatOrderNumber, orderSeqSql } from './order-number.js'
import { diffDays, now, todayIST } from './clock.js'
import { getConfig } from './config.js'
import { badRequest, conflict, notFound } from './errors.js'
import { ledger, lockLines, restock } from './inventory.js'
import { addEvent, MAX_DELIVERY_ATTEMPTS } from './orders.js'
import { trackedLine } from './warehouse/core.js'
import { deliveryWeeks, roundKg, varietyRoom, WEEK_LOAD_SQL } from './preorders.js'

/** Booking states that take preorder capacity (a converted booking keeps it). */
export const CAPACITY_STATUSES = ['PAYMENT_PENDING', 'BOOKED', 'CONVERTED']

/**
 * INV-06: weeks whose taken pre-order room disagrees with the bookings
 * that hold it (PAYMENT_PENDING, BOOKED and CONVERTED take capacity; a
 * converted booking keeps it). release() clamps at zero, so drift would
 * otherwise go unseen. An empty array means the counters balance.
 */
export async function preorderCapacityDrift(c, limit = 100) {
  const { rows } = await c.query(
    `SELECT COALESCE(k.sku, b.sku) AS sku, COALESCE(k.week_start, b.week_start) AS week_start,
            COALESCE(k.reserved, 0)::int AS reserved, COALESCE(b.n, 0)::int AS booked
       FROM preorder_capacity k
       FULL JOIN (SELECT sku, week_start, SUM(qty) AS n FROM preorders
                   WHERE status = ANY('{${CAPACITY_STATUSES}}') GROUP BY sku, week_start) b
         ON b.sku = k.sku AND b.week_start = k.week_start
      WHERE COALESCE(k.reserved, 0) <> COALESCE(b.n, 0)
      ORDER BY 2, 1 LIMIT $1`,
    [limit],
  )
  // The week's one limit in kg for every box (migrations 074, 076, preorders.js weekLoad): the same check on
  // preorder_week_kg, shown as sku 'ALL' and recounted by the same route.
  const { rows: weeks } = await c.query(
    `SELECT COALESCE(k.week_start, b.week_start) AS week_start, COALESCE(k.reserved_kg, 0) AS reserved, COALESCE(b.n, 0) AS booked
       FROM preorder_week_kg k
       FULL JOIN (SELECT p.week_start, SUM(${WEEK_LOAD_SQL}) AS n FROM preorders p JOIN products pr ON pr.sku = p.sku
                   WHERE p.status = ANY('{${CAPACITY_STATUSES}}') GROUP BY p.week_start) b
         ON b.week_start = k.week_start
      WHERE ROUND(COALESCE(k.reserved_kg, 0), 3) <> ROUND(COALESCE(b.n, 0), 3)
      ORDER BY 1 LIMIT $1`,
    [limit],
  )
  // Each variety's kg counter (migration 078, the one that decides), shown as sku 'ALL:<variety>' and recounted by the same route.
  const { rows: kinds } = await c.query(
    `SELECT COALESCE(k.week_start, b.week_start) AS week_start, COALESCE(k.variety, b.variety) AS variety, COALESCE(k.reserved_kg, 0) AS reserved, COALESCE(b.n, 0) AS booked
       FROM preorder_variety_week_kg k
       FULL JOIN (SELECT p.week_start, COALESCE(p.variety, pr.variety) AS variety, SUM(${WEEK_LOAD_SQL}) AS n FROM preorders p JOIN products pr ON pr.sku = p.sku
                   WHERE p.status = ANY('{${CAPACITY_STATUSES}}') GROUP BY 1, 2) b
         ON b.week_start = k.week_start AND b.variety = k.variety
      WHERE ROUND(COALESCE(k.reserved_kg, 0), 3) <> ROUND(COALESCE(b.n, 0), 3)
      ORDER BY 1, 2 LIMIT $1`,
    [limit],
  )
  return [
    ...kinds.map((r) => ({ sku: `${ALL_BOXES}:${r.variety}`, variety: r.variety, weekStart: r.week_start, reserved: roundKg(r.reserved), booked: roundKg(r.booked) })),
    ...weeks.map((r) => ({ sku: ALL_BOXES, weekStart: r.week_start, reserved: roundKg(r.reserved), booked: roundKg(r.booked) })),
    ...rows.map((r) => ({ sku: r.sku, weekStart: r.week_start, reserved: r.reserved, booked: r.booked })),
  ].slice(0, limit)
}

/** Weeks whose planned-order kg (preorder_variety_week_kg.planned_kg) disagrees with the orders holding it (plan_week set). */
export async function plannedKgDrift(c, limit = 100) {
  const { rows } = await c.query(
    `SELECT COALESCE(k.week_start, b.week) AS week_start, COALESCE(k.variety, b.variety) AS variety, COALESCE(k.planned_kg, 0) AS planned, COALESCE(b.n, 0) AS orders
       FROM preorder_variety_week_kg k
       FULL JOIN (SELECT o.plan_week AS week, i.plan_variety AS variety, SUM(i.plan_kg) AS n FROM orders o JOIN order_items i ON i.order_id = o.id
                   WHERE o.plan_week IS NOT NULL AND i.plan_kg IS NOT NULL GROUP BY 1, 2) b
         ON b.week = k.week_start AND b.variety = k.variety
      WHERE ROUND(COALESCE(k.planned_kg, 0), 3) <> ROUND(COALESCE(b.n, 0), 3)
      ORDER BY 1, 2 LIMIT $1`,
    [limit],
  )
  return rows.map((r) => ({ weekStart: r.week_start, variety: r.variety, planned: roundKg(r.planned), orders: roundKg(r.orders) }))
}

/** The INV-06 row (and recount route sku) for a week's one kg limit across every box (preorder_week_kg, migration 076). */
export const ALL_BOXES = 'ALL'

/**
 * INV-08: batches still in transit after their arrival date. Their stock is
 * sold ahead of arrival at the forecast confidence; with STOCK_INTAKE_CHECKS
 * it stops selling to new orders until staff mark the batch arrived.
 */
export async function lateArrivals(c, at = now(), limit = 50) {
  const { rows } = await c.query(
    `SELECT b.id, b.variety, b.farm, b.eta_date, COALESCE(SUM(l.held + l.committed), 0)::int AS promised
       FROM batches b LEFT JOIN batch_lines l ON l.batch_id = b.id
      WHERE b.status = 'IN_TRANSIT' AND b.eta_date < $1
      GROUP BY b.id ORDER BY b.eta_date, b.id LIMIT $2`,
    [todayIST(at), limit],
  )
  return rows.map((b) => ({ id: b.id, variety: b.variety, farm: b.farm, etaDate: b.eta_date, promised: b.promised }))
}

/** Paid orders that still have to reach the customer. */
const UNDELIVERED = ['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED']

/**
 * Open orders past their delivery date (IST), and orders out for delivery for
 * more than outForDeliveryAlertHours. An order whose delivery attempts are used
 * up is left out: it is already on Needs attention as "call the customer".
 */
export async function overdueOrders(c, at = now(), limit = 100) {
  const today = todayIST(at)
  const hours = getConfig().outForDeliveryAlertHours ?? 8
  const { rows } = await c.query(
    `SELECT o.id, o.number, o.status, o.delivery_date, o.customer_name, o.phone, ofd.at AS out_since
       FROM orders o
       LEFT JOIN LATERAL (
         SELECT MAX(e.created_at) AS at FROM order_events e WHERE e.order_id = o.id AND e.status = 'OUT_FOR_DELIVERY' AND e.from_status IS DISTINCT FROM e.status
       ) ofd ON o.status = 'OUT_FOR_DELIVERY'
      WHERE o.status = ANY($1)
        AND NOT (o.status = 'DELIVERY_FAILED' AND o.delivery_failures >= $5)
        AND (o.delivery_date < $2 OR (o.status = 'OUT_FOR_DELIVERY' AND ofd.at < $3))
      ORDER BY o.delivery_date, ${orderSeqSql('o.number')} LIMIT $4`,
    [UNDELIVERED, today, new Date(at.getTime() - hours * 3_600_000), limit, MAX_DELIVERY_ATTEMPTS],
  )
  return rows.map((o) => {
    const late = o.delivery_date < today ? diffDays(today, o.delivery_date) : 0
    const outHours = o.out_since ? Math.floor((at.getTime() - o.out_since.getTime()) / 3_600_000) : null
    const reason =
      late > 0
        ? `${late} ${late === 1 ? 'day' : 'days'} past its delivery date and still ${o.status.toLowerCase().replaceAll('_', ' ')}`
        : `out for delivery for ${outHours} hours with no result from the rider`
    return { id: o.id, number: o.number, status: o.status, deliveryDate: o.delivery_date, daysLate: late, outSince: o.out_since ?? null, reason }
  })
}

/**
 * Paid preorders a manager should decide on (INV-H): moved forward more than
 * maxPreorderMoves times, or now booked for a week after the season's last day.
 * The allocator keeps moving them meanwhile; nothing is cancelled on its own.
 * One a manager kept (POST /preorders/:id/keep) stays off until it moves again.
 */
export async function preordersNeedingDecision(c, limit = 100) {
  const cfg = getConfig()
  const { rows } = await c.query(
    `SELECT id, number, customer_name, sku, qty, week_start, moved_count, non_refundable FROM preorders
      WHERE status = 'BOOKED' AND (moved_count > $1 OR ($2::date IS NOT NULL AND week_start > $2::date))
        -- A manager chose to keep it (Keep booking): back only once it moves again.
        AND NOT (kept_moved_count IS NOT DISTINCT FROM moved_count AND kept_week_start IS NOT DISTINCT FROM week_start)
      ORDER BY booked_at, id LIMIT $3`,
    [cfg.maxPreorderMoves ?? 3, cfg.seasonEndsOn ?? null, limit],
  )
  return rows.map((p) => ({
    id: p.id, number: p.number, customerName: p.customer_name, sku: p.sku, qty: p.qty, weekStart: p.week_start, movedCount: p.moved_count,
    // The customer can't cancel it (migration 064); a manager's cancel still refunds in full.
    nonRefundable: Boolean(p.non_refundable),
    reason:
      cfg.seasonEndsOn && p.week_start > cfg.seasonEndsOn
        ? `booked for the week of ${p.week_start}, after the season ends on ${cfg.seasonEndsOn}`
        : `moved forward ${p.moved_count} times without stock`,
  }))
}

/**
 * The pre-order plan's problems for Needs attention (migration 079):
 *   delayedOften   paid bookings we delayed more than twice (delay_count > 2), still waiting;
 *   weeksOver      delivery weeks where a variety holds more kg than its limit (a week's own kg set below what is booked;
 *                  the Pre-order plan's recalculation moves the newest out, after its preview);
 *   delayRefunds   refunds still owed for bookings (or their orders) the customer cancelled after we delayed them.
 */
export async function preorderPlanIssues(c, limit = 50) {
  const { rows: often } = await c.query(
    `SELECT id, number, customer_name, sku, week_start, delayed_from_week, delay_count FROM preorders
      WHERE status IN ('BOOKED', 'CONVERTED') AND delay_count > 2 AND delayed_at IS NOT NULL AND week_start > delayed_from_week
      ORDER BY delay_count DESC, booked_at, id LIMIT $1`,
    [limit],
  )
  const weeks = await deliveryWeeks(c)
  const over = []
  for (const [variety, room] of await varietyRoom(c, weeks)) {
    for (const w of room) if (w.over > 0) over.push({ weekStart: w.weekStart, variety, limit: w.limit, booked: w.reserved, over: w.over })
  }
  over.sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.variety.localeCompare(b.variety))
  const { rows: refunds } = await c.query(
    `SELECT p.id, p.number, p.customer_name, p.delay_cancelled_at, COALESCE(o.payment_amount, p.paid_amount, p.total) AS amount, o.id AS order_id, o.number AS order_number
       FROM preorders p LEFT JOIN orders o ON o.id = p.order_id AND p.status = 'CONVERTED'
      WHERE p.delay_cancelled_at IS NOT NULL
        AND ((o.id IS NULL AND (p.refunded_at IS NULL OR p.refund_status = 'failed'))
          OR (o.id IS NOT NULL AND (o.refunded_at IS NULL OR o.refund_status = 'failed')))
      ORDER BY p.delay_cancelled_at LIMIT $1`,
    [limit],
  )
  return {
    delayedOften: often.map((p) => ({ id: p.id, number: p.number, customerName: p.customer_name, sku: p.sku, weekStart: p.week_start, firstWeek: p.delayed_from_week, delayCount: p.delay_count })),
    weeksOver: over.slice(0, limit),
    delayRefunds: refunds.map((r) => ({ id: r.id, number: r.number, customerName: r.customer_name, cancelledAt: r.delay_cancelled_at, amount: Number(r.amount), order: r.order_id ? { id: r.order_id, number: r.order_number } : null })),
  }
}

/** Orders cancelled or returned after dispatch whose boxes nobody has booked back in or written off yet (INV-F). */
export async function returnedStockPending(c, limit = 100) {
  const { rows } = await c.query(
    `SELECT o.id, o.number, o.status, SUM(s.quantity)::int AS boxes FROM order_stock s JOIN orders o ON o.id = s.order_id
      WHERE s.state = 'packed' AND o.status IN ('CANCELLED', 'RTO')
      GROUP BY o.id, o.number, o.status ORDER BY ${orderSeqSql('o.number')} LIMIT $1`,
    [limit],
  )
  return rows.map((r) => ({ id: r.id, number: r.number, status: r.status, boxes: r.boxes }))
}

/** Reason codes a write-off of returned boxes may carry. */
export const WRITE_OFF_REASONS = ['DAMAGED', 'THEFT_LOSS', 'OTHER']

/**
 * Books the boxes of an order cancelled or returned after it left the store
 * (INV-F). RESTOCK puts them back on the shelf (a RESTOCK row, reason
 * RETURN_RESTOCK) when their batch is still on sale. WRITE_OFF records that
 * they came back unusable or never came back: a RESTOCK and an ADJUST of the
 * same size, so on-hand stays as it is and the loss shows in the ledger with
 * its reason. Either way the order no longer holds the boxes.
 */
export async function bookReturnedStock(c, orderId, { action, reasonCode = null, reason }, actor) {
  const { rows } = await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])
  const o = rows[0]
  if (!o) throw notFound('Order not found')
  if (!['CANCELLED', 'RTO'].includes(o.status)) {
    throw badRequest('Only boxes on a cancelled or returned order can be booked back in or written off', 'INVALID_TRANSITION')
  }
  const { rows: packed } = await c.query(
    `SELECT s.*, b.status AS batch_status FROM order_stock s JOIN batches b ON b.id = s.batch_id
      WHERE s.order_id = $1 AND s.state = 'packed' ORDER BY s.id`,
    [o.id],
  )
  if (!packed.length) throw conflict('This order has no boxes waiting to be booked', 'NOTHING_TO_BOOK')
  for (const row of packed) {
    if (await trackedLine(c, row.line_id)) {
      throw conflict('These boxes are labelled: book them in with a Return scan in the warehouse (Warehouse → Scan → Return).', 'USE_WAREHOUSE_RETURNS')
    }
  }
  // Lines after the order, in the line order every stock change uses (DB-01).
  await lockLines(c, packed.map((r) => r.line_id))
  const boxes = packed.reduce((n, r) => n + r.quantity, 0)
  const why = reason.trim()
  if (action === 'RESTOCK') {
    const closed = packed.find((r) => ['EXHAUSTED', 'CONDEMNED'].includes(r.batch_status))
    if (closed) throw badRequest(`Batch ${closed.batch_id} is ${closed.batch_status}; write these boxes off instead`, 'BATCH_CLOSED')
    for (const row of packed) await restock(c, row, actor, `Returned from ${formatOrderNumber(o.number)}: ${why}`, 'RETURN_RESTOCK')
    await addEvent(c, o.id, o.status, o.status, actor, `${boxes} returned ${boxes === 1 ? 'box' : 'boxes'} put back in stock: ${why}`)
  } else {
    const code = reasonCode ?? 'DAMAGED'
    for (const row of packed) {
      await c.query(`UPDATE order_stock SET state = 'released' WHERE id = $1`, [row.id])
      const base = { batchId: row.batch_id, sku: row.sku, actorType: actor.type, actorId: actor.id }
      await ledger(c, { ...base, eventType: 'RESTOCK', delta: row.quantity, reason: `Returned from ${formatOrderNumber(o.number)}`, reasonCode: 'RETURN_RESTOCK' })
      await ledger(c, { ...base, eventType: 'ADJUST', delta: -row.quantity, reason: `Write-off of boxes returned from ${formatOrderNumber(o.number)}: ${why}`, reasonCode: code })
    }
    await addEvent(c, o.id, o.status, o.status, actor, `${boxes} ${boxes === 1 ? 'box' : 'boxes'} from this order written off (${code.toLowerCase().replace('_', ' or ')}): ${why}`)
  }
  return { boxes }
}
