// The shop's funnel (FUNNEL_ANALYTICS, docs/growth.md): how many browsers a day
// visit, look at a box, add one to the cart, start checkout and pay.
//
// The shop sends the first four steps with a random id it keeps in that
// browser (crypto.randomUUID): no phone, name, address or customer id is ever
// stored with an event. Each browser counts once per step per day (the
// primary key), so a reload or a retry adds nothing. "Paid" is never taken
// from the shop: the API records it in the payment's own transaction when a
// capture confirms the order, for the browser that started that checkout
// (funnel_checkouts, deleted at that moment). Events are kept 90 days; the
// daily rollup (funnel_daily) keeps the counts after that.
import { addDays, diffDays, now, todayIST } from './clock.js'
import { query } from './db.js'
import { env } from './env.js'

export const CLIENT_STEPS = ['visit', 'product_view', 'add_to_cart', 'checkout_start']
export const STEPS = [...CLIENT_STEPS, 'paid']
export const FUNNEL_RETENTION_DAYS = 90
export const BROWSER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Records one step from the shop. Nothing is stored while the switch is off. */
export async function recordStep(browserId, step, at = now()) {
  if (!env.FUNNEL_ANALYTICS) return false
  const r = await query(
    'INSERT INTO funnel_events (day, browser_id, step, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [todayIST(at), browserId, step, at],
  )
  return r.rowCount > 0
}

/** At checkout confirm, in its transaction: this browser started the checkout of this order. */
export async function rememberCheckout(c, orderId, browserId) {
  if (!env.FUNNEL_ANALYTICS || !browserId || !BROWSER_ID.test(browserId)) return
  await c.query('INSERT INTO funnel_checkouts (order_id, browser_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (order_id) DO NOTHING', [
    orderId, browserId, now(),
  ])
}

/**
 * Called in the payment's transaction when a capture confirms an order (orders.js
 * processPayment). The link from the order to the browser goes at once, whether
 * or not the switch is still on.
 */
export async function recordPaid(c, orderId, at = now()) {
  const { rows } = await c.query('DELETE FROM funnel_checkouts WHERE order_id = $1 RETURNING browser_id', [orderId])
  if (!rows.length || !env.FUNNEL_ANALYTICS) return
  await c.query(`INSERT INTO funnel_events (day, browser_id, step, created_at) VALUES ($1, $2, 'paid', $3) ON CONFLICT DO NOTHING`, [
    todayIST(at), rows[0].browser_id, at,
  ])
}

/**
 * The daily pass (maintenance 'retention' step): roll the finished days up
 * into funnel_daily, then delete events older than 90 days and checkout links
 * older than a day. A rollup never lowers a count, so a day that is partly
 * pruned can't shrink. Bounded per call. Returns { rolled, pruned }.
 */
export async function rollupAndPruneFunnel(at = now(), { batch = 5_000 } = {}) {
  const today = todayIST(at)
  const rolled = await query(
    `INSERT INTO funnel_daily (day, step, browsers, rolled_at)
     SELECT day, step, COUNT(*)::int, $3 FROM funnel_events WHERE day < $1 AND day >= $2 GROUP BY day, step
     ON CONFLICT (day, step) DO UPDATE SET browsers = GREATEST(funnel_daily.browsers, EXCLUDED.browsers), rolled_at = EXCLUDED.rolled_at`,
    [today, addDays(today, -FUNNEL_RETENTION_DAYS), at],
  )
  const pruned = await query(
    `DELETE FROM funnel_events WHERE (day, step, browser_id) IN (
       SELECT day, step, browser_id FROM funnel_events WHERE day < $1 LIMIT $2)`,
    [addDays(today, -FUNNEL_RETENTION_DAYS), batch],
  )
  await query('DELETE FROM funnel_checkouts WHERE created_at < $1', [new Date(at.getTime() - 86_400_000)])
  return { rolled: rolled.rowCount, pruned: pruned.rowCount }
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null)

/**
 * Day by day from `from` to `to`: browsers at each step and the conversion
 * from a visit to each step, and from each step to the next. Rolled-up days
 * come from funnel_daily; days not rolled up yet (today) from the events.
 */
export async function funnelReport({ from, to }) {
  const [daily, live] = await Promise.all([
    query('SELECT day, step, browsers FROM funnel_daily WHERE day BETWEEN $1 AND $2', [from, to]),
    query(
      `SELECT day, step, COUNT(*)::int AS browsers FROM funnel_events
        WHERE day BETWEEN $1 AND $2 AND day NOT IN (SELECT day FROM funnel_daily WHERE day BETWEEN $1 AND $2) GROUP BY day, step`,
      [from, to],
    ),
  ])
  const by = new Map()
  for (const r of [...daily.rows, ...live.rows]) by.set(`${r.day}|${r.step}`, r.browsers)
  const days = []
  for (let d = from, i = 0; d <= to && i <= diffDays(to, from); d = addDays(d, 1), i++) {
    const counts = Object.fromEntries(STEPS.map((s) => [s, by.get(`${d}|${s}`) ?? 0]))
    days.push(row(d, counts))
  }
  const totals = Object.fromEntries(STEPS.map((s) => [s, days.reduce((n, x) => n + x.counts[s], 0)]))
  return { from, to, steps: STEPS, days, totals: row(null, totals) }
}

function row(day, counts) {
  return {
    day,
    counts,
    // From a visit to each step, in percent (one decimal); null with no visits.
    conversion: Object.fromEntries(STEPS.map((s) => [s, pct(counts[s], counts.visit)])),
    // From the step before.
    stepConversion: Object.fromEntries(STEPS.slice(1).map((s, i) => [s, pct(counts[s], counts[STEPS[i]])])),
  }
}
