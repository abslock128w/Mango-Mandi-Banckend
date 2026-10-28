// The per-minute counters behind the Vercel alert checks (src/ops-counters.js,
// docs/alerts.md): server errors and slow answers are counted in Postgres after
// the answer is sent, so a counter write that waits or fails never slows or
// fails the request, and nothing is written while the database is the problem.
import { client, closeAll, customerToken, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import pino from 'pino'
import { drainBackground } from '../src/background.js'
import { pool, query } from '../src/db.js'
import { env } from '../src/env.js'
import { logger } from '../src/logger.js'
import { countEvent, eventsOf, flushOpsCounters, resetOpsCountersForTests } from '../src/ops-counters.js'

let srv
let api
const saved = { ...env }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

before(async () => {
  await resetDb()
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  await srv.close()
  await closeAll()
})
beforeEach(async () => {
  env.OPS_ALERTS = true
  await drainBackground()
  resetOpsCountersForTests()
  await query('DELETE FROM ops_counters')
})
afterEach(() => {
  Object.assign(env, saved)
})

/** Each kind's total once every write started so far has finished. */
async function counts() {
  await drainBackground()
  await flushOpsCounters()
  const { rows } = await query('SELECT kind, SUM(n)::int AS n FROM ops_counters GROUP BY kind ORDER BY kind')
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]))
}

/** A request that answers 500: the login-code table is gone for the duration of fn. */
async function withBrokenLogin(fn) {
  await query('ALTER TABLE otps RENAME TO otps_away')
  try {
    return await fn(() => api.post('/v1/auth/otp/request', { phone: '9876543210' }))
  } finally {
    await query('ALTER TABLE otps_away RENAME TO otps')
  }
}

function captureLogs() {
  const lines = []
  const stream = logger[pino.symbols.streamSym]
  const level = logger.level
  logger[pino.symbols.streamSym] = { write: (s) => lines.push(JSON.parse(s)) }
  logger.level = 'info'
  return {
    lines,
    stop: () => {
      logger[pino.symbols.streamSym] = stream
      logger.level = level
    },
  }
}

/** Holds every pool connection, with a 50 ms wait for one, while fn runs. */
async function withPoolFull(fn) {
  const held = []
  const timeout = pool.options.connectionTimeoutMillis
  try {
    while (pool.totalCount < pool.options.max || pool.idleCount > 0) held.push(await pool.connect())
    pool.options.connectionTimeoutMillis = 50
    return await fn()
  } finally {
    pool.options.connectionTimeoutMillis = timeout
    for (const c of held) c.release()
  }
}

// Runs first in this file, before any request has checked the database (app.js).
test('nothing is written before this instance has checked that the database is its own', async () => {
  countEvent('api-5xx')
  await drainBackground()
  assert.equal((await query('SELECT COUNT(*)::int AS n FROM ops_counters')).rows[0].n, 0)
  assert.equal((await api.get('/v1/products')).status, 200) // goes through the database check
  assert.deepEqual(await counts(), { 'api-5xx': 1 })
})

describe('what is counted', () => {
  test('a 500 answer counts once as api-5xx, in its minute', async () => {
    await withBrokenLogin(async (fail) => {
      assert.equal((await fail()).status, 500)
      assert.equal((await fail()).status, 500)
    })
    assert.deepEqual(await counts(), { 'api-5xx': 2 })
    for (const { bucket } of (await query('SELECT bucket FROM ops_counters')).rows) assert.equal(bucket.getTime() % 60_000, 0)
  })

  test('OPS_ALERTS off: nothing is counted', async () => {
    env.OPS_ALERTS = false
    await withBrokenLogin(async (fail) => assert.equal((await fail()).status, 500))
    assert.deepEqual(await counts(), {})
  })

  test('an answer slower than SLOW_REQUEST_MS counts as api-slow', async () => {
    const { accessToken } = await customerToken(api)
    env.SLOW_REQUEST_MS = 300
    const holder = await pool.connect()
    let r
    try {
      await holder.query('BEGIN')
      await holder.query('LOCK TABLE customers IN ACCESS EXCLUSIVE MODE')
      const pending = api.get('/v1/me', { token: accessToken })
      await sleep(500)
      await holder.query('COMMIT')
      r = await pending
    } finally {
      holder.release()
    }
    assert.equal(r.status, 200)
    assert.deepEqual(await counts(), { 'api-slow': 1 })
  })

  test('a 503 BUSY for want of a connection counts as db-busy, not as a plain 5xx', async () => {
    const { accessToken } = await customerToken(api)
    const r = await withPoolFull(() => api.get('/v1/me', { token: accessToken }))
    assert.equal(r.status, 503)
    assert.equal(r.body.error.code, 'BUSY')
    assert.deepEqual(await counts(), { 'db-busy': 1 })
  })

  test('which kinds a finished request counts as, and what is never slow', () => {
    const req = (url, type) => ({ originalUrl: url, get: (h) => (h.toLowerCase() === 'content-type' ? type : undefined) })
    const res = (status, headers = {}, locals = {}) => ({ statusCode: status, locals, get: (h) => headers[h] })
    assert.equal(env.SLOW_REQUEST_MS, 2000)
    assert.deepEqual(eventsOf(req('/v1/me'), res(200), 2500), ['api-slow'])
    assert.deepEqual(eventsOf(req('/v1/me'), res(200), 1500), [])
    assert.deepEqual(eventsOf(req('/v1/catalogue?pincode=560034'), res(500), 2500), ['api-5xx', 'api-slow'])
    assert.deepEqual(eventsOf(req('/v1/me'), res(503, {}, { opsEvent: 'db-busy' }), 10), ['db-busy'])
    assert.deepEqual(eventsOf(req('/v1/me'), res(503, {}, { opsEvent: 'db-unavailable' }), 10), ['db-unavailable'])
    assert.deepEqual(eventsOf(req('/v1/me'), res(404), 10), [])
    // Never slow: a file download, a photo upload, the maintenance run (its errors still count).
    assert.deepEqual(eventsOf(req('/admin/v1/exports/orders'), res(200, { 'Content-Disposition': 'attachment; filename="x.csv"' }), 9000), [])
    assert.deepEqual(eventsOf(req('/admin/v1/deliveries/ord_1/photo', 'image/jpeg'), res(201), 9000), [])
    assert.deepEqual(eventsOf(req('/internal/maintenance'), res(200), 40_000), [])
    assert.deepEqual(eventsOf(req('/internal/maintenance'), res(500), 40_000), ['api-5xx'])
    // Never counted: /ready's 503 is its answer, which the uptime monitor watches.
    assert.deepEqual(eventsOf(req('/ready'), res(503), 3000), [])
    assert.deepEqual(eventsOf(req('/health'), res(200), 3000), [])
    env.SLOW_REQUEST_MS = 0
    assert.deepEqual(eventsOf(req('/v1/me'), res(200), 60_000), [])
  })
})

describe('never at the request\'s expense', () => {
  test('a counter write that waits does not slow the answer; the count lands once it can', async () => {
    const holder = await pool.connect()
    try {
      await holder.query('BEGIN')
      await holder.query('LOCK TABLE ops_counters IN ACCESS EXCLUSIVE MODE')
      await withBrokenLogin(async (fail) => {
        const t = performance.now()
        assert.equal((await fail()).status, 500)
        assert.ok(performance.now() - t < 1000, 'the 500 was not held up by the counter')
      })
      // The counter's upsert is the one waiting on the lock.
      let waiting = false
      for (let i = 0; i < 40 && !waiting; i++) {
        const { rows } = await query(`SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'INSERT INTO ops_counters%'`)
        waiting = rows.length > 0
        if (!waiting) await sleep(50)
      }
      assert.ok(waiting, 'the counter write never waited on the lock')
      await holder.query('COMMIT')
    } finally {
      holder.release()
    }
    assert.deepEqual(await counts(), { 'api-5xx': 1 })
  })

  test('a counter write that fails is logged and dropped; the answers are unchanged', async () => {
    await query('ALTER TABLE ops_counters RENAME TO ops_counters_away')
    const log = captureLogs()
    try {
      await withBrokenLogin(async (fail) => {
        const r = await fail()
        assert.equal(r.status, 500)
        assert.equal(r.body.error.code, 'INTERNAL_ERROR')
      })
      assert.equal((await api.get('/v1/products')).status, 200)
      await drainBackground()
    } finally {
      log.stop()
      await query('ALTER TABLE ops_counters_away RENAME TO ops_counters')
    }
    const lines = log.lines.filter((l) => l.msg === 'ops counter not written')
    assert.equal(lines.length, 1)
    assert.equal(lines[0].kept, false)
    assert.deepEqual(lines[0].kinds, ['api-5xx'])
    assert.deepEqual(await counts(), {})
  })

  test('while the pool is full nothing more is written; the counts are kept and written later', async () => {
    await withPoolFull(async () => {
      countEvent('db-busy')
      await drainBackground() // that write found no connection: writes pause
    })
    countEvent('api-5xx')
    await drainBackground()
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM ops_counters')).rows[0].n, 0, 'paused')
    assert.deepEqual(await counts(), { 'api-5xx': 1, 'db-busy': 1 })
  })
})
