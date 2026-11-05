// Mango Ops v2 (docs/design/ops-dashboard-v2.md): the control tower's reads. All additive, for
// managers and operators (access.js): the operating day per slot, the live map, a rider's trail,
// the ops analytics, and the live event stream.
import { orderSeqSql } from '../order-number.js'
import express from 'express'
import { z } from 'zod'
import { addDays, diffDays, isDate, now, todayIST } from '../clock.js'
import { currentConfig } from '../config.js'
import { query } from '../db.js'
import { env } from '../env.js'
import { asyncHandler, badRequest, notFound, parse } from '../errors.js'
import { attentionNow, changesSince, eventsMode, subscribe, watchAttention } from '../events.js'
import { logger } from '../logger.js'
import { attentionCount, attentionReport } from './reports.js'

export const router = express.Router()

/** Owner question defaults (docs/design/ops-dashboard-v2.md): packing done 60 minutes before a window opens. */
export const PACK_LEAD_MINUTES = 60
/** And the run out of the door 15 minutes before it. */
export const DISPATCH_LEAD_MINUTES = 15

/** The orders a delivery day is made of: paid, from confirmed to delivered (the manifest's statuses). */
const DAY_STATUSES = ['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'DELIVERED']
const COUNT_OF = {
  CONFIRMED: 'waiting', PROCESSING: 'waiting', PACKED: 'packed', SHIPPED: 'packed', OUT_FOR_DELIVERY: 'out', DELIVERED: 'delivered', DELIVERY_FAILED: 'failed',
}
// Orders that count as sold: paid and not cancelled (as analytics.js).
const SOLD = `o.status NOT IN ('PAYMENT_PENDING', 'CANCELLED')`

const dateParam = (v) => (v === undefined || v === '' ? todayIST() : parse(z.string().refine(isDate, 'date must be YYYY-MM-DD'), v))
const hhmm = (t) => String(t).slice(0, 5)
/** The instant of a wall-clock time on an IST date. */
const istAt = (date, time) => new Date(`${date}T${hhmm(time)}:00+05:30`)
const minus = (d, minutes) => new Date(d.getTime() - minutes * 60_000)
const iso = (d) => (d ? new Date(d).toISOString() : null)
const num = (v) => (v === null || v === undefined ? null : Number(v))
const emptyCounts = () => ({ waiting: 0, packed: 0, out: 0, delivered: 0, failed: 0 })
const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10
}
const rate = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 1000 : null)

// ---------------------------------------------------------------- the operating day

/**
 * GET /day?date=: every slot of the day with its clock (order cutoff, pack by, dispatch by, the
 * window) and its orders by state, for the Day strip. The order cutoff is the shop rule's hour on
 * the day before (cutoffHourIST: orders placed before it can be delivered the next day).
 */
router.get(
  '/day',
  asyncHandler(async (req, res) => {
    const date = dateParam(req.query.date)
    const cutoffHour = currentConfig().rules.cutoffHourIST
    const orderCutoffAt = Number.isInteger(cutoffHour) ? istAt(addDays(date, -1), `${String(cutoffHour).padStart(2, '0')}:00`) : null
    const [slots, counts] = await Promise.all([
      query(
        `SELECT id, label, starts_at, ends_at, max_boxes FROM delivery_slots s
          WHERE active OR EXISTS (SELECT 1 FROM orders o WHERE o.slot_id = s.id AND o.delivery_date = $1 AND o.status = ANY($2))
          ORDER BY sort, starts_at`,
        [date, DAY_STATUSES],
      ),
      query(
        `SELECT o.slot_id, o.status, COUNT(*)::int AS n,
                COALESCE(SUM((SELECT SUM(quantity) FROM order_items i WHERE i.order_id = o.id)), 0)::int AS boxes,
                COUNT(*) FILTER (WHERE o.rider_id IS NULL AND o.status <> 'DELIVERED')::int AS unassigned
           FROM orders o WHERE o.delivery_date = $1 AND o.status = ANY($2) GROUP BY o.slot_id, o.status`,
        [date, DAY_STATUSES],
      ),
    ])
    const tally = (slotId) => {
      const c = emptyCounts()
      let orders = 0
      let boxes = 0
      let unassigned = 0
      for (const r of counts.rows.filter((x) => (x.slot_id ?? null) === slotId)) {
        c[COUNT_OF[r.status]] += r.n
        orders += r.n
        boxes += r.boxes
        unassigned += r.unassigned
      }
      return { counts: c, orders, boxes, unassigned }
    }
    const loose = tally(null)
    res.json({
      date,
      now: now().toISOString(),
      rules: { packLeadMinutes: PACK_LEAD_MINUTES, dispatchLeadMinutes: DISPATCH_LEAD_MINUTES, orderCutoff: orderCutoffAt ? `${String(cutoffHour).padStart(2, '0')}:00 the day before` : null },
      slots: slots.rows.map((s) => {
        const start = istAt(date, s.starts_at)
        return {
          id: s.id, label: s.label, startsAt: hhmm(s.starts_at), endsAt: hhmm(s.ends_at), capacityBoxes: s.max_boxes ?? null,
          windowStartAt: iso(start), windowEndAt: iso(istAt(date, s.ends_at)),
          packByAt: iso(minus(start, PACK_LEAD_MINUTES)), dispatchByAt: iso(minus(start, DISPATCH_LEAD_MINUTES)), orderCutoffAt: iso(orderCutoffAt),
          ...tally(s.id),
        }
      }),
      unslotted: loose.orders ? loose : null,
    })
  }),
)

// ---------------------------------------------------------------- the live map

/**
 * GET /live?date=: every rider with their last position and stops, the day's stops placed at their
 * pincode's centre, and the warehouses, for the Dispatch board's map and the Today live row.
 */
router.get(
  '/live',
  asyncHandler(async (req, res) => {
    const date = dateParam(req.query.date)
    const [riders, stops, warehouses] = await Promise.all([
      query(
        `SELECT u.id, u.display_name, u.email, u.phone, l.lat, l.lng, l.accuracy, l.at,
                (SELECT COUNT(*)::int FROM orders x WHERE x.rider_id = u.id AND x.delivery_date = $1 AND x.status = ANY($2) AND x.status <> 'DELIVERED') AS stops_left,
                (SELECT COUNT(*)::int FROM orders x WHERE x.rider_id = u.id AND x.delivery_date = $1 AND x.status = 'DELIVERED') AS stops_done
           FROM admin_users u
           LEFT JOIN LATERAL (SELECT lat, lng, accuracy, at FROM rider_locations WHERE rider_id = u.id ORDER BY at DESC LIMIT 1) l ON TRUE
          WHERE u.role = 'RIDER' ORDER BY u.display_name NULLS LAST, u.email`,
        [date, DAY_STATUSES],
      ),
      query(
        `SELECT o.id, o.number, o.status, o.slot_id, o.pincode, o.rider_id, o.pickup_warehouse_id,
                COALESCE(o.gift_recipient_name, o.customer_name) AS customer_name, p.zone, p.city, p.lat, p.lng, s.starts_at, s.ends_at,
                COALESCE((SELECT SUM(quantity) FROM order_items i WHERE i.order_id = o.id), 0)::int AS boxes
           FROM orders o LEFT JOIN pincodes p ON p.pincode = o.pincode LEFT JOIN delivery_slots s ON s.id = o.slot_id
          WHERE o.delivery_date = $1 AND o.status = ANY($2) ORDER BY s.sort NULLS LAST, s.starts_at NULLS LAST, ${orderSeqSql('o.number')}`,
        [date, DAY_STATUSES],
      ),
      query('SELECT id, name, address, lat, lng FROM warehouses WHERE active ORDER BY id'),
    ])
    res.json({
      date,
      now: now().toISOString(),
      riders: riders.rows.map((r) => ({
        id: r.id, name: r.display_name ?? r.email, email: r.email, phone: r.phone ?? null,
        lastAt: iso(r.at), lat: num(r.lat), lng: num(r.lng), accuracy: num(r.accuracy), stopsLeft: r.stops_left, stopsDone: r.stops_done,
      })),
      stops: stops.rows.map((o) => ({
        orderId: o.id, number: o.number, status: o.status, slotId: o.slot_id ?? null, pincode: o.pincode, area: o.zone ?? o.city ?? null,
        lat: num(o.lat), lng: num(o.lng), riderId: o.rider_id ?? null, boxes: o.boxes, customerName: o.customer_name ?? null,
        windowStartAt: o.starts_at ? iso(istAt(date, o.starts_at)) : null, dueAt: o.ends_at ? iso(istAt(date, o.ends_at)) : null,
        pickupWarehouseId: o.pickup_warehouse_id ?? null,
      })),
      warehouses: warehouses.rows.map((w) => ({ id: w.id, name: w.name, address: w.address ?? null, lat: num(w.lat), lng: num(w.lng) })),
    })
  }),
)

/** GET /riders/:id/trail?date=: where the rider app reported the rider that IST day, oldest first. */
router.get(
  '/riders/:id/trail',
  asyncHandler(async (req, res) => {
    const date = dateParam(req.query.date)
    const { rows: who } = await query("SELECT id FROM admin_users WHERE id = $1 AND role = 'RIDER'", [req.params.id])
    if (!who.length) throw notFound('Rider not found')
    const { rows } = await query(
      'SELECT lat, lng, accuracy, at FROM rider_locations WHERE rider_id = $1 AND at >= $2 AND at < $3 ORDER BY at',
      [req.params.id, istAt(date, '00:00'), istAt(addDays(date, 1), '00:00')],
    )
    res.json({ riderId: req.params.id, date, points: rows.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng), accuracy: num(p.accuracy), at: iso(p.at) })) })
  }),
)

// ---------------------------------------------------------------- ops analytics

/**
 * GET /analytics/ops?from&to (delivery dates, default the 7 days to today): on-time deliveries,
 * slot fill, minutes per stop, riders, orders per pincode, the variety mix, repeat customers and a
 * day-by-day series. Additive beside GET /analytics, which stays as it is.
 */
router.get(
  '/analytics/ops',
  asyncHandler(async (req, res) => {
    const date = z.string().refine(isDate, 'dates must be YYYY-MM-DD')
    const f = parse(z.object({ from: date.optional(), to: date.optional() }), Object.fromEntries(Object.entries(req.query).filter(([k, v]) => ['from', 'to'].includes(k) && v !== '')))
    const to = f.to ?? todayIST()
    const from = f.from ?? addDays(to, -6)
    if (from > to) throw badRequest('from must be on or before to', 'INVALID_DATE')
    if (diffDays(to, from) > 366) throw badRequest('Pick at most a year', 'INVALID_DATE')
    const p = [from, to]
    const [delivered, slots, riders, failures, flagged, pincodes, varieties, repeat, daily] = await Promise.all([
      // Each delivered order: when it was delivered, when it last went out, its window's end.
      query(
        `SELECT o.id, o.delivery_date, o.rider_id, s.ends_at, d.at AS delivered_at,
                (SELECT MAX(e.created_at) FROM order_events e WHERE e.order_id = o.id AND e.status = 'OUT_FOR_DELIVERY' AND e.created_at <= d.at) AS out_at
           FROM orders o LEFT JOIN delivery_slots s ON s.id = o.slot_id
           JOIN LATERAL (SELECT MAX(created_at) AS at FROM order_events e WHERE e.order_id = o.id AND e.status = 'DELIVERED') d ON d.at IS NOT NULL
          WHERE o.status = 'DELIVERED' AND o.delivery_date BETWEEN $1 AND $2`,
        p,
      ),
      query(
        `SELECT s.id, s.label, s.starts_at, s.ends_at, s.max_boxes, COUNT(o.id)::int AS orders,
                COALESCE(SUM((SELECT SUM(quantity) FROM order_items i WHERE i.order_id = o.id)), 0)::int AS boxes,
                (SELECT COUNT(DISTINCT x.delivery_date)::int FROM orders x WHERE x.delivery_date BETWEEN $1 AND $2 AND x.status NOT IN ('PAYMENT_PENDING', 'CANCELLED')) AS days
           FROM delivery_slots s LEFT JOIN orders o ON o.slot_id = s.id AND o.delivery_date BETWEEN $1 AND $2 AND ${SOLD}
          WHERE s.active OR o.id IS NOT NULL GROUP BY s.id ORDER BY s.sort, s.starts_at`,
        p,
      ),
      query("SELECT id, display_name, email FROM admin_users WHERE role = 'RIDER'"),
      query(
        `SELECT o.rider_id, COUNT(*)::int AS n FROM order_events e JOIN orders o ON o.id = e.order_id
          WHERE e.status = 'DELIVERY_FAILED' AND e.from_status IS DISTINCT FROM 'DELIVERY_FAILED' AND o.delivery_date BETWEEN $1 AND $2 AND o.rider_id IS NOT NULL
          GROUP BY o.rider_id`,
        p,
      ),
      query(
        `SELECT o.rider_id, COUNT(DISTINCT o.id)::int AS n FROM delivery_photos ph JOIN orders o ON o.id = ph.order_id
          WHERE ph.needs_review AND o.delivery_date BETWEEN $1 AND $2 AND o.rider_id IS NOT NULL GROUP BY o.rider_id`,
        p,
      ),
      query(
        `SELECT o.pincode, p.zone, p.city, p.lat, p.lng, COUNT(*)::int AS orders,
                COALESCE(SUM((SELECT SUM(quantity) FROM order_items i WHERE i.order_id = o.id)), 0)::int AS boxes
           FROM orders o LEFT JOIN pincodes p ON p.pincode = o.pincode
          WHERE ${SOLD} AND o.delivery_date BETWEEN $1 AND $2 AND o.pincode IS NOT NULL
          GROUP BY o.pincode, p.zone, p.city, p.lat, p.lng ORDER BY orders DESC, o.pincode`,
        p,
      ),
      query(
        `SELECT COALESCE(pr.variety, i.sku) AS variety, SUM(i.quantity)::int AS boxes, COUNT(DISTINCT o.id)::int AS orders
           FROM orders o JOIN order_items i ON i.order_id = o.id LEFT JOIN products pr ON pr.sku = i.sku
          WHERE ${SOLD} AND o.delivery_date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY boxes DESC, variety`,
        p,
      ),
      query(
        `SELECT COUNT(*)::int AS customers, COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM orders y WHERE y.customer_id = c.customer_id AND y.status NOT IN ('PAYMENT_PENDING', 'CANCELLED')) >= 2)::int AS repeat
           FROM (SELECT DISTINCT o.customer_id FROM orders o WHERE ${SOLD} AND o.delivery_date BETWEEN $1 AND $2 AND o.customer_id IS NOT NULL) c`,
        p,
      ),
      query(
        `SELECT d::date::text AS date,
                (SELECT COUNT(*)::int FROM orders o WHERE ${SOLD} AND o.delivery_date = d::date) AS orders,
                (SELECT COUNT(*)::int FROM orders o WHERE o.status = 'DELIVERED' AND o.delivery_date = d::date) AS delivered,
                (SELECT COUNT(*)::int FROM order_events e JOIN orders o ON o.id = e.order_id
                  WHERE e.status = 'DELIVERY_FAILED' AND e.from_status IS DISTINCT FROM 'DELIVERY_FAILED' AND o.delivery_date = d::date) AS failed
           FROM generate_series($1::date, $2::date, interval '1 day') d ORDER BY d`,
        p,
      ),
    ])
    const rows = delivered.rows.map((o) => {
      const deadline = o.ends_at ? istAt(o.delivery_date, o.ends_at) : istAt(addDays(o.delivery_date, 1), '00:00')
      const minutes = o.out_at ? (new Date(o.delivered_at) - new Date(o.out_at)) / 60_000 : null
      return { riderId: o.rider_id, onTime: new Date(o.delivered_at) <= deadline, minutes }
    })
    const onTime = rows.filter((r) => r.onTime).length
    const minutes = rows.map((r) => r.minutes).filter((m) => m !== null && m >= 0)
    const failedBy = new Map(failures.rows.map((r) => [r.rider_id, r.n]))
    const flaggedBy = new Map(flagged.rows.map((r) => [r.rider_id, r.n]))
    const r0 = repeat.rows[0]
    res.json({
      from,
      to,
      onTime: { delivered: rows.length, onTime, rate: rate(onTime, rows.length) },
      slotFill: slots.rows.map((s) => {
        const capacity = s.max_boxes === null ? null : s.max_boxes * s.days
        return {
          slotId: s.id, label: s.label, startsAt: hhmm(s.starts_at), endsAt: hhmm(s.ends_at), days: s.days, capacityBoxes: s.max_boxes ?? null,
          boxes: s.boxes, orders: s.orders, fill: capacity ? rate(s.boxes, capacity) : null,
        }
      }),
      minutesPerStop: { median: median(minutes), stops: minutes.length },
      riders: riders.rows
        .map((u) => {
          const mine = rows.filter((r) => r.riderId === u.id)
          return {
            id: u.id, name: u.display_name ?? u.email, delivered: mine.length, failed: failedBy.get(u.id) ?? 0,
            medianMinutes: median(mine.map((r) => r.minutes).filter((m) => m !== null && m >= 0)), flagged: flaggedBy.get(u.id) ?? 0,
          }
        })
        .sort((a, b) => b.delivered - a.delivered || a.failed - b.failed || a.name.localeCompare(b.name)),
      pincodes: pincodes.rows.map((x) => ({ pincode: x.pincode, area: x.zone ?? x.city ?? null, lat: num(x.lat), lng: num(x.lng), orders: x.orders, boxes: x.boxes })),
      varieties: varieties.rows.map((v) => ({ variety: v.variety, boxes: v.boxes, orders: v.orders })),
      repeat: { customers: r0.customers, repeatCustomers: r0.repeat, rate: rate(r0.repeat, r0.customers) },
      daily: daily.rows,
    })
  }),
)

// ---------------------------------------------------------------- live event stream

/** How often a stream without LISTEN (eventsMode 'polling') asks the database what changed. */
const POLL_MS = 10_000
const loadAttention = async () => attentionCount(await attentionReport())

/**
 * GET /events: Server-Sent Events for the panel (the Node runtime; a stream, not Edge). hello first,
 * then order.changed { id, number, status, date }, rider.position { riderId, at },
 * attention.changed { count } and heartbeat { at } every 25 seconds. After EVENTS_STREAM_MS (4 min)
 * it sends bye and ends, under the platform's function limit: the panel reconnects. The panel reads
 * it with fetch, so the usual Authorization header signs it in.
 */
router.get('/events', (req, res) => {
  res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  let seq = 0
  let open = true
  const send = (type, data) => {
    if (!open || res.writableEnded) return
    res.write(`id: ${++seq}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  send('hello', { at: now().toISOString(), mode: eventsMode() === 'listening' ? 'listen' : 'poll', retryMs: 3_000 })
  const off = subscribe((e) => send(e.type, e.data))
  let cursor = now()
  const heartbeat = setInterval(() => send('heartbeat', { at: now().toISOString() }), env.EVENTS_HEARTBEAT_MS)
  const poll = setInterval(async () => {
    if (eventsMode() === 'listening') {
      cursor = now()
      return
    }
    try {
      const r = await changesSince(cursor)
      cursor = r.cursor
      for (const e of r.events) send(e.type, e.data)
    } catch (err) {
      logger.warn({ err }, 'live updates: poll failed')
    }
  }, POLL_MS)
  const end = setTimeout(() => {
    send('bye', { at: now().toISOString() })
    res.end()
  }, env.EVENTS_STREAM_MS)
  for (const t of [heartbeat, poll, end]) t.unref()
  watchAttention(loadAttention)
  attentionNow(loadAttention)
    .then((count) => send('attention.changed', { count }))
    .catch((err) => logger.warn({ err }, 'live updates: attention count failed'))
  const close = () => {
    if (!open) return
    open = false
    clearInterval(heartbeat)
    clearInterval(poll)
    clearTimeout(end)
    off()
  }
  req.on('close', close)
  res.on('close', close)
})
