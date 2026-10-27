// The managers' evening summary on WhatsApp (MANAGER_DAILY_SUMMARY, docs/growth.md).
//
// At MANAGER_SUMMARY_TIME (IST, default 20:00) the maintenance loop takes the
// day's numbers once and queues one message per opted-in manager through the
// ordinary WhatsApp outbox (notify.js), with the template
// MANAGER_SUMMARY_TEMPLATE. Exactly once a day: a job lease keeps two runs
// from taking the numbers at the same time, and manager_summaries has one row
// per day and manager (its primary key), whose id is also the message's event
// id (notifications are UNIQUE (event_id, kind)).
import { istParts, now, todayIST } from './clock.js'
import { query, tx } from './db.js'
import { env } from './env.js'
import { newId } from './ids.js'
import { logger } from './logger.js'
import { releaseLease, takeLease } from './maintenance.js'
import { attentionCount, attentionReport } from './admin/reports.js'
import { dateWords, rupees } from './notify.js'
import { isOn } from './feature-switches.js'

const IST = (col) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date`
const LEASE_MS = 60_000

/** The day's numbers, IST. */
export async function summaryNumbers(day, at = now()) {
  const [orders, delivered, failed, claims, ratings, attention] = await Promise.all([
    // Paid orders placed today and not cancelled since. Replacements are free and not counted.
    query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(total), 0)::bigint AS revenue FROM orders
        WHERE replacement_for IS NULL AND payment_status = 'SUCCEEDED' AND status <> 'CANCELLED' AND ${IST('placed_at')} = $1`,
      [day],
    ),
    query(
      `SELECT COALESCE(SUM(i.quantity), 0)::int AS n FROM order_events e JOIN order_items i ON i.order_id = e.order_id
        WHERE e.status = 'DELIVERED' AND e.from_status IS DISTINCT FROM 'DELIVERED' AND ${IST('e.created_at')} = $1`,
      [day],
    ),
    query(
      `SELECT COALESCE(SUM(i.quantity), 0)::int AS n FROM order_events e JOIN order_items i ON i.order_id = e.order_id
        WHERE e.status = 'DELIVERY_FAILED' AND e.from_status IS DISTINCT FROM 'DELIVERY_FAILED' AND ${IST('e.created_at')} = $1`,
      [day],
    ),
    query(`SELECT COUNT(*)::int AS n FROM claims WHERE ${IST('created_at')} = $1`, [day]),
    // 1 or 2 stars, on an order or on a box review, given today.
    query(
      `SELECT (SELECT COUNT(*)::int FROM order_ratings WHERE stars <= 2 AND ${IST('created_at')} = $1)
            + (SELECT COUNT(*)::int FROM reviews WHERE rating <= 2 AND ${IST('created_at')} = $1) AS n`,
      [day],
    ),
    attentionReport(at),
  ])
  return {
    day,
    orders: orders.rows[0].n,
    revenue: orders.rows[0].revenue,
    boxesDelivered: delivered.rows[0].n,
    boxesFailed: failed.rows[0].n,
    newClaims: claims.rows[0].n,
    unhappyRatings: ratings.rows[0].n,
    needsAttention: attentionCount(attention),
  }
}

/** The template's body variables, in order ({{1}} to {{8}}). */
export const summaryParams = (n) => [
  dateWords(n.day), String(n.orders), rupees(n.revenue), String(n.boxesDelivered), String(n.boxesFailed), String(n.newClaims),
  String(n.unhappyRatings), String(n.needsAttention),
]

/** The message as the approved template reads (docs/growth.md), for the Today page's preview. */
export function summaryText(p) {
  return [
    `MandiMangoes, ${p[0]}`,
    `Orders: ${p[1]} (${p[2]})`,
    `Boxes delivered: ${p[3]}, failed: ${p[4]}`,
    `New claims: ${p[5]}`,
    `Unhappy ratings: ${p[6]}`,
    `Needs attention: ${p[7]}`,
  ].join('\n')
}

/** "20:00" → minutes after midnight. */
const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Whether today's summary is due at `at`: from MANAGER_SUMMARY_TIME to the end of the IST day. */
export function summaryDue(at = now()) {
  const p = istParts(at)
  return p.hour * 60 + p.minute >= minutesOf(env.MANAGER_SUMMARY_TIME)
}

/** Managers who opted in and gave a number, without today's summary yet. */
const waiting = (c, day) =>
  c.query(
    `SELECT u.id, u.daily_summary_phone FROM admin_users u
      WHERE u.role = 'MANAGER' AND u.daily_summary_opt_in AND u.daily_summary_phone IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM manager_summaries s WHERE s.day = $1 AND s.admin_id = u.id)
      ORDER BY u.id`,
    [day],
  )

/**
 * The maintenance step: once it is due, queues today's summary for every
 * opted-in manager who hasn't had it. Returns how many were queued.
 */
export async function sendManagerSummaries(at = now()) {
  if (!isOn('MANAGER_DAILY_SUMMARY') || !summaryDue(at)) return 0
  const day = todayIST(at)
  // Cheap check first: on most runs after 20:00 everyone has had theirs.
  if (!(await waiting({ query }, day)).rows.length) return 0
  const holder = await takeLease('manager-summary', LEASE_MS, at)
  if (!holder) return 0
  try {
    const numbers = await summaryNumbers(day, at)
    const params = summaryParams(numbers)
    return await tx(async (c) => {
      let queued = 0
      for (const m of (await waiting(c, day)).rows) {
        const id = newId('sum')
        const { rows } = await c.query(
          `INSERT INTO manager_summaries (id, day, admin_id, numbers, params, created_at) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (day, admin_id) DO NOTHING RETURNING id`,
          [id, day, m.id, JSON.stringify(numbers), JSON.stringify(params), at],
        )
        if (!rows.length) continue
        await c.query(
          `INSERT INTO notifications (id, manager_summary_id, event_id, kind, phone, next_attempt_at, created_at)
           VALUES ($1, $2, $2, 'MANAGER_DAILY_SUMMARY', $3, $4, $4) ON CONFLICT (event_id, kind) DO NOTHING`,
          [newId('ntf'), id, m.daily_summary_phone, at],
        )
        queued++
      }
      if (queued) logger.info({ day, managers: queued }, 'daily summary queued')
      return queued
    })
  } finally {
    await releaseLease('manager-summary', holder).catch((err) => logger.warn({ err }, 'could not release the summary lease'))
  }
}
