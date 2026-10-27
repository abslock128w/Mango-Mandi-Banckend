import { attachDatabasePool } from '@vercel/functions'
import pg from 'pg'
import { env, onVercel } from './env.js'
import { logger } from './logger.js'
import { metrics, watchPool } from './metrics.js'
import { reportProblem } from './sentry.js'

// DATE columns come back as plain "YYYY-MM-DD" strings, not JS Dates in local time.
pg.types.setTypeParser(1082, (v) => v)
// BIGINT counts (COUNT(*)) as numbers.
pg.types.setTypeParser(20, (v) => Number(v))

/**
 * Neon's pooler (PgBouncer, transaction mode) hands the server connection back
 * after every transaction, so session settings don't stick. There the timeout is
 * set on the role instead: ALTER ROLE mango_app SET statement_timeout = '10s'.
 * Row locks (FOR UPDATE) and transaction-scoped advisory locks still work.
 */
export const isPooledUrl = (url) => /-pooler\./.test(url)

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  ...(isPooledUrl(env.DATABASE_URL) ? {} : { statement_timeout: env.DB_STATEMENT_TIMEOUT_MS }),
  // Serverless instances come and go: don't hold idle connections for long.
  ...(onVercel ? { idleTimeoutMillis: 5_000 } : {}),
  // Under a burst every instance's few connections can be busy: wait at most
  // this long, then answer 503 "busy, retry" instead of hanging the request.
  connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
})

/** The error pg raises when no connection frees up in time. */
export const isPoolTimeout = (err) => /timeout exceeded when trying to connect/i.test(err?.message ?? '')

/**
 * The database can't be reached at all (OPS-08): refused, reset, unknown host,
 * a server shutting down (57P0x) or a connection-class SQLSTATE (08xxx).
 * Callers answer these with a retryable 503, not a 500.
 */
const NET_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'])
export const isDbUnavailable = (err) => {
  if (!err) return false
  const code = String(err.code ?? '')
  if (NET_CODES.has(code) || /^57P0[1-3]$/.test(code) || /^08/.test(code)) return true
  if (err instanceof AggregateError && err.errors?.some(isDbUnavailable)) return true
  return /Connection terminated|connection timeout|Client has encountered a connection error/i.test(err.message ?? '')
}

// Lets Vercel close idle connections before it suspends an instance.
if (onVercel) attachDatabasePool(pool)

pool.on('error', (err) => logger.error({ err }, 'idle pg client error'))
watchPool(pool)

/** Counts a pool BUSY timeout (no free connection in time) on its way to the caller. */
const countBusy = (err) => {
  if (isPoolTimeout(err)) metrics.dbPoolBusy.inc()
  throw err
}

/**
 * Logs a query slower than DB_SLOW_QUERY_MS: its duration and the first 80 characters of
 * its SQL only. Never the parameters, which hold phones, addresses and codes.
 */
export function logIfSlow(sql, ms, slowMs = env.DB_SLOW_QUERY_MS) {
  if (!slowMs || ms < slowMs || typeof sql !== 'string') return false
  metrics.dbSlowQueries.inc()
  logger.warn({ ms: Math.round(ms), sql: sql.replace(/\s+/g, ' ').trim().slice(0, 80) }, 'slow query')
  return true
}

/**
 * Times the queries a transaction runs on its client (promise calls only: pg's own callback
 * calls, as pool.query makes, finish in the socket's async context, where the log line would
 * name the wrong request). Pool queries are timed by query() below instead.
 */
function timeQueries(client) {
  const run = client.query
  client.query = function (config, ...rest) {
    const sql = typeof config === 'string' ? config : config?.text
    const start = performance.now()
    const p = run.call(this, config, ...rest)
    if (env.DB_SLOW_QUERY_MS && typeof sql === 'string' && typeof p?.then === 'function') {
      const done = () => logIfSlow(sql, performance.now() - start)
      p.then(done, done)
    }
    return p
  }
}
pool.on('connect', timeQueries)

/** One statement on any free connection. Its time, for the slow-query log, includes any wait for that connection. */
export function query(text, params) {
  const start = performance.now()
  return pool.query(text, params).then(
    (r) => {
      logIfSlow(text, performance.now() - start)
      return r
    },
    (err) => {
      if (!isPoolTimeout(err)) logIfSlow(text, performance.now() - start)
      return countBusy(err)
    },
  )
}

/** Deadlock and serialization failures: safe to run the whole transaction again. */
const RETRYABLE = new Set(['40P01', '40001'])

/**
 * Runs fn(client) inside a transaction. A deadlock or serialization failure
 * rolls it back and runs it again (up to `retries` more times, with jitter),
 * so two checkouts that lock the same stock in a different order both finish.
 * fn must only touch the database (or be safe to repeat) for that to be safe;
 * pass { retries: 0 } otherwise.
 */
export async function tx(fn, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await txOnce(fn)
    } catch (err) {
      if (!RETRYABLE.has(err?.code) || attempt >= retries) throw err
      metrics.dbRetries.inc({ code: err.code })
      logger.warn({ sqlState: err.code, attempt: attempt + 1 }, 'transaction retried')
      reportRetry(err.code, attempt + 1)
      await new Promise((r) => {
        setTimeout(r, 10 + Math.random() * 40 * (attempt + 1))
      })
    }
  }
}

/**
 * DB-05: a retry is a symptom (DB-01 hid deadlocks this way), and on Vercel
 * nothing scrapes /metrics, so the first retry per SQL state each hour on an
 * instance goes to Sentry as well.
 */
const RETRY_REPORT_MS = 60 * 60_000
const lastRetryReport = new Map()
function reportRetry(code, attempt) {
  const t = Date.now()
  if (t - (lastRetryReport.get(code) ?? -Infinity) < RETRY_REPORT_MS) return
  lastRetryReport.set(code, t)
  reportProblem(`A database transaction was retried after ${code === '40P01' ? 'a deadlock' : 'a serialization failure'} (${code})`, {
    sqlState: code,
    attempt,
  })
}

/** Tests: forget when retries were last reported. */
export const resetRetryReportsForTests = () => lastRetryReport.clear()

const afterCommitFns = new WeakMap()

/**
 * DB-05: runs fn once the transaction `c` commits, and never if it rolls back,
 * so a counter bumped inside a retried transaction counts once. Outside tx()
 * (a bare client, a test wrapper) fn runs at once.
 */
export function afterCommit(c, fn) {
  const fns = afterCommitFns.get(c)
  if (fns) fns.push(fn)
  else fn()
}

async function txOnce(fn) {
  const client = await pool.connect().catch(countBusy)
  try {
    await client.query('BEGIN')
    afterCommitFns.set(client, [])
    const result = await fn(client)
    await client.query('COMMIT')
    const done = afterCommitFns.get(client) ?? []
    afterCommitFns.delete(client)
    for (const f of done) {
      try {
        f()
      } catch (err) {
        logger.error({ err }, 'after-commit hook failed')
      }
    }
    return result
  } catch (err) {
    afterCommitFns.delete(client)
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Linear backoff: attempt × baseMs, up to `retries` attempts. */
export async function connectWithRetry(retries = 10, baseMs = 1000) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1')
      return
    } catch (err) {
      if (attempt >= retries) throw err
      logger.warn({ attempt, err: err.message }, 'database not ready, retrying')
      await new Promise((r) => {
        setTimeout(r, attempt * baseMs)
      })
    }
  }
}

export const closePool = () => pool.end()
