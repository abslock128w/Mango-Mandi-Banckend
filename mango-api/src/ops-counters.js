// Rare API events, counted per minute in Postgres (migration 050, docs/alerts.md):
// server errors (5xx), slow answers, 503 BUSY for want of a database connection,
// and 503 UNAVAILABLE when the database can't be reached. On Vercel each function
// instance keeps its own Prometheus counters and nothing scrapes them, so the
// maintenance job's checkHealth reads these shared sums instead (alert-checks.js).
// Only with OPS_ALERTS.
//
// Best effort, and never at the request's expense: an event is noted in memory
// once the answer has been sent, and written after it (kept alive by waitUntil on
// Vercel). At most one write is in flight per instance, so a burst of errors is one
// upsert per kind and minute, not one per request. A failed write is logged and its
// counts dropped, except when the database is unreachable or the pool is full: then
// the counts are kept and nothing is written for PAUSE_MS, so the counter never adds
// load to a database that is already the problem (the uptime monitor on /ready
// covers an outage). Nothing is written until this instance has checked that the
// database is this environment's (app.js), so a deploy pointed at the wrong
// database never writes to it.
import { background } from './background.js'
import { now } from './clock.js'
import { isDbUnavailable, isPoolTimeout, query } from './db.js'
import { env } from './env.js'
import { logger } from './logger.js'

/** The kinds counted. Every 5xx answer counts as exactly one of the first three. */
export const OPS_KINDS = ['api-5xx', 'db-busy', 'db-unavailable', 'api-slow']

/** After a write fails because the database is unreachable or busy, wait this long before the next. */
const PAUSE_MS = 30_000
/** Minute-and-kind counts kept in memory while writes wait; the oldest go first. */
const MAX_PENDING = 120

const pending = new Map()
let flight = null
let pausedUntil = 0
let databaseChecked = false

const pathOf = (req) => String(req.originalUrl ?? req.url ?? '').split('?')[0]

/**
 * Answers never counted as slow: the maintenance run (up to 45 s by design), file
 * downloads (CSV exports, bill and label PDFs, a customer's own data: they build a
 * whole file and say so with Content-Disposition), and photo uploads, which take as
 * long as the phone's network.
 */
export function slowExempt(req, res) {
  return pathOf(req) === '/internal/maintenance' || Boolean(res.get('Content-Disposition')) || /^image\//i.test(req.get('content-type') ?? '')
}

/**
 * What one finished request counts as: nothing, its 5xx kind, and/or 'api-slow'.
 * /ready and /health are never counted: a 503 there is the answer to "are you
 * ready?", and the uptime monitor already pages on it. The error handler names a
 * 503's cause in res.locals.opsEvent ('db-busy' or 'db-unavailable').
 */
export function eventsOf(req, res, ms) {
  const path = pathOf(req)
  if (path === '/ready' || path === '/health') return []
  const out = []
  if (res.statusCode >= 500) out.push(res.locals?.opsEvent ?? 'api-5xx')
  if (env.SLOW_REQUEST_MS && ms > env.SLOW_REQUEST_MS && !slowExempt(req, res)) out.push('api-slow')
  return out
}

/** Middleware: times the request and notes its events once the answer is sent. */
export function opsCounting(req, res, next) {
  const start = performance.now()
  res.on('finish', () => {
    if (!env.OPS_ALERTS) return
    try {
      for (const kind of eventsOf(req, res, performance.now() - start)) countEvent(kind)
    } catch (err) {
      logger.warn({ err }, 'ops counter not noted')
    }
  })
  next()
}

function add(bucket, kind, n) {
  const key = `${bucket.toISOString()} ${kind}`
  const p = pending.get(key)
  if (p) p.n += n
  else pending.set(key, { bucket, kind, n })
  while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value)
}

/** Notes one event in this minute's bucket and starts a write. Never throws, never waits. */
export function countEvent(kind, at = now()) {
  if (!env.OPS_ALERTS) return
  add(new Date(Math.floor(at.getTime() / 60_000) * 60_000), kind, 1)
  write()
}

/** Starts a write of the noted counts, unless one is in flight, writes are paused, or the database is not checked yet. */
function write() {
  if (flight || !pending.size || !databaseChecked || Date.now() < pausedUntil) return
  flight = writeBatch().finally(() => {
    flight = null
    write() // what was noted while this one was in flight
  })
  background(flight)
}

async function writeBatch() {
  const batch = [...pending.values()]
  pending.clear()
  try {
    await query(
      `INSERT INTO ops_counters (bucket, kind, n) SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::int[])
       ON CONFLICT (bucket, kind) DO UPDATE SET n = ops_counters.n + EXCLUDED.n`,
      [batch.map((b) => b.bucket), batch.map((b) => b.kind), batch.map((b) => b.n)],
    )
  } catch (err) {
    const dbDown = isDbUnavailable(err) || isPoolTimeout(err) || err?.code === '53300'
    if (dbDown) {
      pausedUntil = Date.now() + PAUSE_MS
      for (const b of batch) add(b.bucket, b.kind, b.n)
    }
    logger.warn({ err, kinds: [...new Set(batch.map((b) => b.kind))], kept: dbDown }, 'ops counter not written')
  }
}

/** app.js, once this instance has checked the database is this environment's: counts may be written from now on. */
export function allowCounterWrites() {
  databaseChecked = true
  write()
}

/** Writes what is noted now, even during a pause, and waits for it (tests). */
export async function flushOpsCounters() {
  while (flight) await flight
  pausedUntil = 0
  write()
  while (flight) await flight
}

/** Tests: forget noted counts and any pause. */
export function resetOpsCountersForTests() {
  pending.clear()
  pausedUntil = 0
}

/** Each kind's total over the `ms` before `at` (shared by every instance). */
export async function recentCounts(ms, at = now()) {
  const { rows } = await query('SELECT kind, SUM(n)::int AS n FROM ops_counters WHERE bucket > $1 AND bucket <= $2 GROUP BY kind', [new Date(at.getTime() - ms), at])
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]))
}
