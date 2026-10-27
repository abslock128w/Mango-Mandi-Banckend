// Stock forecast (STOCK_FORECAST, docs/ops.md): how many boxes of each variety
// to buy for the next 14 days. A suggestion only: it reads orders, bookings,
// batches and the ledger, and never changes stock.
//
// For each product (SKU), ripeness and day:
//   expected sales   the average sold on the same weekday over the last 4 weeks,
//                    leaving out days with no stock at that ripeness (and closed days);
//                    fewer than MIN_HISTORY_DAYS such days: "not enough history";
//   already booked   paid orders for that day (their boxes are already set aside);
//   Book ahead       paid bookings not yet turned into orders, on the first day of their week;
//   still to sell    max(expected, booked) - booked, plus Book ahead;
//   from stock       free boxes of current batches at that ripeness on that day (the
//                    same ripening rules and 7-day cap the shop sells by), oldest batch
//                    first, less the expected waste;
//   short            what stock can't cover.
// Suggested boxes for a product = its short boxes / (1 - expected waste), rounded up.
import { addDays, diffDays, todayIST } from './clock.js'
import { getConfig } from './config.js'
import { saleLimitDays, sellableAs, sellableQty, sellableRows } from './inventory.js'
import { allProducts, shopProducts } from './products.js'
import { STAGES, stageFor } from './stage.js'

export const HORIZON_DAYS = 14
export const HISTORY_WEEKS = 4
export const MIN_HISTORY_DAYS = 2
export const WASTE_WINDOW_DAYS = 28
/** Expected waste is capped here, so one bad week can't make the suggestion explode. */
export const MAX_WASTE_RATE = 0.5

/** Paid orders: they took (or will take) boxes off the shelf. */
const SOLD_STATUSES = ['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RTO']
/** Paid orders still to be delivered. */
const BOOKED_STATUSES = ['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED']

const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay()
const round1 = (n) => Math.round(n * 10) / 10
const key3 = (a, b, c) => `${a}|${b}|${c}`

/** The last HISTORY_WEEKS dates before `today` that fall on the same weekday as `date`. */
export function sameWeekdays(date, today) {
  let d = addDays(today, -1)
  while (weekday(d) !== weekday(date)) d = addDays(d, -1)
  return Array.from({ length: HISTORY_WEEKS }, (_, i) => addDays(d, -7 * i))
}

/** When each batch stopped selling for good (exhausted or condemned), as an IST date. */
async function closedDates(c, batchIds) {
  if (!batchIds.length) return new Map()
  const { rows } = await c.query(
    `SELECT batch_id, MIN((created_at AT TIME ZONE 'Asia/Kolkata')::date)::text AS closed_on FROM batch_ledger
      WHERE batch_id = ANY($1) AND event_type = 'STATUS' AND (reason LIKE '%→ EXHAUSTED%' OR reason LIKE '%→ CONDEMNED%')
      GROUP BY batch_id`,
    [batchIds],
  )
  return new Map(rows.map((r) => [r.batch_id, r.closed_on]))
}

/**
 * Which past (sku, stage, date) had stock: a batch line of that product whose fruit was at
 * that ripeness on that date (by the ripening rules and the cap, before any QC reading),
 * that had arrived, and that had not been closed. The day's exact count is not stored, so a
 * batch that sold out early still counts its days; a day with sales always counts.
 */
async function stockedDays(c, from, to, cfg) {
  const { rows } = await c.query(
    `SELECT b.id, b.variety, b.plucked_on, b.eta_date, b.status, l.sku,
            COALESCE((SELECT SUM(delta) FROM batch_ledger g WHERE g.batch_id = b.id AND g.sku = l.sku AND g.event_type = 'INTAKE'), 0)::int AS intake
       FROM batches b JOIN batch_lines l ON l.batch_id = b.id
      WHERE b.plucked_on <= $2 AND b.plucked_on >= ($1::date - $3::int)`,
    [from, to, cfg.maxSellableAge],
  )
  const closed = await closedDates(c, [...new Set(rows.map((r) => r.id))])
  const out = new Set()
  for (const r of rows) {
    if (r.intake <= 0) continue
    const arrives = r.eta_date ?? addDays(r.plucked_on, cfg.transitDays)
    const closedOn = closed.get(r.id) ?? null
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (d <= arrives || (closedOn && d > closedOn)) continue
      const stage = stageFor(cfg, { variety: r.variety, pluckedOn: r.plucked_on }, d, null)
      if (stage) out.add(key3(r.sku, stage, d))
    }
  }
  return out
}

/** Boxes lost to damage per SKU over the last WASTE_WINDOW_DAYS, and boxes sold. */
async function wasteBySku(c, today) {
  const from = addDays(today, -WASTE_WINDOW_DAYS)
  const [ledger, claims, sold] = await Promise.all([
    c.query(
      `SELECT sku, COALESCE(-SUM(delta), 0)::int AS boxes FROM batch_ledger
        WHERE sku IS NOT NULL AND delta < 0 AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1 AND $2
          AND (event_type = 'CONDEMN' OR (event_type = 'ADJUST' AND reason_code IN ('DAMAGED', 'BOX_WRITE_OFF')))
        GROUP BY sku`,
      [from, addDays(today, -1)],
    ),
    // Damaged on arrival at the customer, and replaced: those boxes were lost too.
    c.query(
      `SELECT i.sku, SUM(i.quantity)::int AS boxes FROM claims cl JOIN order_items i ON i.order_id = cl.order_id
        WHERE cl.issue_type = 'DAMAGED' AND cl.resolution = 'REPLACEMENT_APPROVED'
          AND (cl.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1 AND $2
          AND (cardinality(cl.affected_items) = 0 OR i.sku = ANY(cl.affected_items))
        GROUP BY i.sku`,
      [from, addDays(today, -1)],
    ),
    c.query(
      `SELECT i.sku, SUM(i.quantity)::int AS boxes FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE o.status = ANY($3) AND o.replacement_for IS NULL AND o.delivery_date BETWEEN $1 AND $2
        GROUP BY i.sku`,
      [from, addDays(today, -1), SOLD_STATUSES],
    ),
  ])
  const by = (r) => new Map(r.rows.map((x) => [x.sku, x.boxes]))
  const [damaged, claimed, soldBy] = [by(ledger), by(claims), by(sold)]
  return (sku) => {
    const damagedBoxes = damaged.get(sku) ?? 0
    const claimBoxes = claimed.get(sku) ?? 0
    const soldBoxes = soldBy.get(sku) ?? 0
    const through = soldBoxes + damagedBoxes
    const raw = through > 0 ? (damagedBoxes + claimBoxes) / through : 0
    return { days: WASTE_WINDOW_DAYS, damagedBoxes, claimBoxes, soldBoxes, rate: round1(Math.min(MAX_WASTE_RATE, raw) * 100) / 100, capped: raw > MAX_WASTE_RATE }
  }
}

/** The latest pluck date whose fruit is at `stage` and here by `date` (null: no window for it). */
function pluckBy(cfg, variety, stage, date) {
  const profile = cfg.stageProfiles[variety] ?? cfg.stageProfiles.default
  const w = profile.find((p) => p.stage === stage)
  if (!w) return null
  return addDays(date, -Math.max(w.minAge, cfg.transitDays + 1))
}

/**
 * The forecast for the HORIZON_DAYS after `today`. `c` is a client or { query }.
 * Every number that goes into a suggestion is in the answer, so a manager can check it.
 */
export async function stockForecast(c, today = todayIST()) {
  const cfg = getConfig()
  const dates = Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(today, i + 1))
  const products = shopProducts()
  const historyFrom = addDays(today, -7 * HISTORY_WEEKS)
  const historyTo = addDays(today, -1)

  const [sales, booked, preorders, closedDays, stocked, waste] = await Promise.all([
    c.query(
      `SELECT o.delivery_date::text AS date, i.sku, i.stage, SUM(i.quantity)::int AS boxes FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE o.status = ANY($3) AND o.replacement_for IS NULL AND o.delivery_date BETWEEN $1 AND $2 AND i.stage IS NOT NULL
        GROUP BY 1, 2, 3`,
      [historyFrom, historyTo, SOLD_STATUSES],
    ),
    c.query(
      `SELECT o.delivery_date::text AS date, i.sku, i.stage, SUM(i.quantity)::int AS boxes FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE o.status = ANY($3) AND o.delivery_date BETWEEN $1 AND $2 AND i.stage IS NOT NULL
        GROUP BY 1, 2, 3`,
      [dates[0], dates.at(-1), BOOKED_STATUSES],
    ),
    // Paid Book ahead bookings not yet turned into orders (CONVERTED ones are orders above).
    c.query(
      `SELECT week_start::text AS week_start, sku, stage, SUM(qty)::int AS boxes FROM preorders
        WHERE status = 'BOOKED' AND week_start <= $1 GROUP BY 1, 2, 3`,
      [dates.at(-1)],
    ),
    c.query('SELECT date::text AS date FROM delivery_calendar WHERE NOT is_open AND date BETWEEN $1 AND $2', [historyFrom, historyTo]),
    stockedDays(c, historyFrom, historyTo, cfg),
    wasteBySku(c, today),
  ])
  const soldOn = new Map(sales.rows.map((r) => [key3(r.sku, r.stage, r.date), r.boxes]))
  const bookedOn = new Map(booked.rows.map((r) => [key3(r.sku, r.stage, r.date), r.boxes]))
  const aheadOn = new Map()
  for (const r of preorders.rows) {
    // On the first day of the week (or the first forecast day, for a week already started): the earliest it may be needed.
    const d = r.week_start < dates[0] ? dates[0] : r.week_start
    const k = key3(r.sku, r.stage, d)
    aheadOn.set(k, (aheadOn.get(k) ?? 0) + r.boxes)
  }
  const closed = new Set(closedDays.rows.map((r) => r.date))

  /** The weekday average for (sku, stage, date), with every day it looked at. */
  const historyFor = (sku, stage, date) => {
    const samples = sameWeekdays(date, today).map((d) => {
      const sold = soldOn.get(key3(sku, stage, d)) ?? 0
      if (closed.has(d)) return { date: d, sold, counted: false, reason: 'closed' }
      if (sold === 0 && !stocked.has(key3(sku, stage, d))) return { date: d, sold, counted: false, reason: 'no stock' }
      return { date: d, sold, counted: true, reason: null }
    })
    const counted = samples.filter((s) => s.counted)
    const average = counted.length >= MIN_HISTORY_DAYS ? round1(counted.reduce((n, s) => n + s.sold, 0) / counted.length) : null
    return { samples, average }
  }

  // Current stock: each line's free boxes and ripeness on each forecast day, by the shop's own
  // rules (inventory.js sellableAs). A batch here but waiting for its first QC counts too: it
  // will be on sale once QC is logged, and leaving it out would suggest buying boxes already bought.
  const lineInfo = new Map()
  for (const r of await sellableRows(c)) {
    for (const d of dates) {
      const s = sellableAs(r, d, cfg) ?? (!r.ripeness_rating && r.status !== 'IN_TRANSIT' ? sellableAs(r, d, cfg, { existing: true }) : null)
      if (!s) continue
      const info = lineInfo.get(r.id) ?? { id: r.id, batchId: r.batch_id, sku: r.sku, variety: r.variety, pluckedOn: r.plucked_on, status: r.status, onHand: r.on_hand, waitingQc: !r.ripeness_rating && r.status !== 'IN_TRANSIT', used: 0, byDate: new Map() }
      info.byDate.set(d, { stage: s.stage, free: sellableQty(r, s.factor) })
      lineInfo.set(r.id, info)
    }
  }

  const varieties = new Map()
  for (const p of products) {
    const w = waste(p.sku)
    const lines = [...lineInfo.values()].filter((l) => l.sku === p.sku).sort((a, b) => (a.pluckedOn < b.pluckedOn ? -1 : a.pluckedOn > b.pluckedOn ? 1 : a.id < b.id ? -1 : 1))
    const usable = (l, d) => {
      const at = l.byDate.get(d)
      return at ? Math.max(0, Math.floor(at.free * (1 - w.rate)) - l.used) : 0
    }
    const stages = STAGES.map((stage) => ({ stage, days: [], short: 0, history: false }))
    const shortDays = []
    for (const d of dates) {
      for (const s of stages) {
        const history = historyFor(p.sku, s.stage, d)
        const bookedBoxes = bookedOn.get(key3(p.sku, s.stage, d)) ?? 0
        const ahead = aheadOn.get(key3(p.sku, s.stage, d)) ?? 0
        const expected = history.average == null ? null : Math.max(history.average, bookedBoxes)
        const toSell = (expected == null ? 0 : expected - bookedBoxes) + ahead
        let need = Math.ceil(toSell - 1e-9)
        let fromStock = 0
        for (const l of lines) {
          if (need <= 0) break
          if (l.byDate.get(d)?.stage !== s.stage) continue
          const take = Math.min(need, usable(l, d))
          l.used += take
          need -= take
          fromStock += take
        }
        if (history.average != null) s.history = true
        s.short += need
        if (need > 0) shortDays.push({ date: d, stage: s.stage, boxes: need, pluckBy: pluckBy(cfg, p.variety, s.stage, d), fromHistory: history.average != null })
        s.days.push({ date: d, history, booked: bookedBoxes, bookAhead: ahead, expected, toSell: round1(toSell), fromStock, short: need })
      }
    }
    const enoughHistory = stages.some((s) => s.history)
    const shortBoxes = stages.reduce((n, s) => n + s.short, 0)
    const firmShort = shortDays.filter((x) => !x.fromHistory).reduce((n, x) => n + x.boxes, 0)
    const suggested = enoughHistory ? Math.ceil(shortBoxes / (1 - w.rate) - 1e-9) : null
    const batches = lines.map((l) => {
      const sellableUntil = addDays(l.pluckedOn, saleLimitDays(l.sku, cfg))
      const lastDay = [...l.byDate.keys()].at(-1)
      const leftAtEnd = lastDay ? Math.max(0, Math.floor(l.byDate.get(lastDay).free * (1 - w.rate)) - l.used) : 0
      return {
        batchId: l.batchId, pluckedOn: l.pluckedOn, ageToday: diffDays(today, l.pluckedOn), status: l.status, onHand: l.onHand, waitingQc: l.waitingQc,
        freeBoxes: Math.max(...[...l.byDate.values()].map((x) => x.free)), sellableUntil, usedByForecast: l.used,
        // Boxes the forecast didn't need that pass the cap inside the 14 days: expect to lose them.
        unsoldPastCap: sellableUntil <= dates.at(-1) ? leftAtEnd : 0,
        stages: dates.map((d) => ({ date: d, stage: l.byDate.get(d)?.stage ?? null })),
      }
    })
    const product = {
      sku: p.sku, name: p.name, boxSize: p.boxSize, enoughHistory,
      note: enoughHistory ? null : 'not enough history',
      suggestedBoxes: suggested,
      // Boxes short for orders and bookings already paid, whatever the history says.
      shortForBookings: firmShort,
      shortBoxes, waste: w, buyBy: shortDays.map((x) => x.pluckBy).filter(Boolean).sort()[0] ?? null,
      shortDays, batches,
      stages: stages.map(({ stage, days, short, history }) => ({ stage, enoughHistory: history, short, days })),
    }
    const v = varieties.get(p.variety) ?? { variety: p.variety, products: [] }
    v.products.push(product)
    varieties.set(p.variety, v)
  }

  return {
    today, dates,
    rules: {
      horizonDays: HORIZON_DAYS, historyWeeks: HISTORY_WEEKS, minHistoryDays: MIN_HISTORY_DAYS, wasteWindowDays: WASTE_WINDOW_DAYS,
      maxWasteRate: MAX_WASTE_RATE, maxSellableAge: cfg.maxSellableAge, transitDays: cfg.transitDays, forecastConfidence: cfg.forecastConfidence,
    },
    varieties: [...varieties.values()].map((v) => {
      const known = v.products.filter((p) => p.suggestedBoxes != null)
      return {
        variety: v.variety,
        enoughHistory: known.length > 0,
        suggestedBoxes: known.length ? known.reduce((n, p) => n + p.suggestedBoxes, 0) : null,
        note: known.length ? (known.length < v.products.length ? 'some boxes have not enough history' : null) : 'not enough history',
        shortForBookings: v.products.reduce((n, p) => n + p.shortForBookings, 0),
        buyBy: v.products.map((p) => p.buyBy).filter(Boolean).sort()[0] ?? null,
        products: v.products,
      }
    }),
    // Products no longer on sale are left out; their names stay on past orders.
    hidden: allProducts().filter((p) => !p.active).map((p) => p.sku),
  }
}
