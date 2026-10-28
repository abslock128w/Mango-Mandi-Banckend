// Background jobs and observability: log lines carry the request id, order id
// and maintenance step; slow queries and pool BUSY timeouts are visible; each
// step keeps its last duration and failures in a row; failed browser
// notifications reach Needs attention; and the outbox sends nothing twice.
import { adminToken, checkout, client, closeAll, customerToken, makeBatch, resetDb, startServer, T0 } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import pino from 'pino'
import { attentionCount, attentionReport } from '../src/admin/reports.js'
import { setNow } from '../src/clock.js'
import { logIfSlow, pool, query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'
import { logger } from '../src/logger.js'
import { checkHealth, runCounts, runMaintenance } from '../src/maintenance.js'
import { metrics, registry } from '../src/metrics.js'
import { enqueue, enqueueAlert, enqueuePreorder } from '../src/notify.js'

let srv
let api
const saved = { ...env }

/** Captures what the app's own logger writes (tests run it silent otherwise). */
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

before(async () => {
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  await srv.close()
  await closeAll()
})
beforeEach(async () => {
  await resetDb()
})
afterEach(() => {
  Object.assign(env, saved)
})

describe('log correlation', () => {
  test('a line logged deep inside a request carries its request id and the order it locked', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    const { accessToken } = await customerToken(api)
    const co = await checkout(api, accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
    assert.equal(co.status, 201)
    // Every order event insert now takes 60 ms, so the slow-query log (db.js) writes a line from
    // inside the payment's transaction, after lockOrder, without being handed either id.
    await query(`CREATE FUNCTION slow_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.06); RETURN NEW; END $$`)
    await query('CREATE TRIGGER slow_event BEFORE INSERT ON order_events FOR EACH ROW EXECUTE FUNCTION slow_event()')
    env.DB_SLOW_QUERY_MS = 40
    const log = captureLogs()
    let r
    try {
      r = await api.post('/v1/dev/pay', { orderId: co.body.orderId, outcome: 'captured' })
    } finally {
      log.stop()
    }
    assert.equal(r.status, 200)
    const reqId = r.headers.get('x-request-id')
    const slow = log.lines.filter((l) => l.msg === 'slow query' && l.reqId === reqId)
    assert.ok(slow.length >= 1, 'the slow insert was logged within the request')
    assert.ok(slow.some((l) => l.orderId === co.body.orderId && /order_events/.test(l.sql)))
    // The request's own summary line carries the order too.
    assert.equal(log.lines.find((l) => l.msg === 'request' && l.reqId === reqId)?.orderId, co.body.orderId)
    // Another request starts clean.
    const log2 = captureLogs()
    try {
      await api.get('/health')
    } finally {
      log2.stop()
    }
    const line = log2.lines.find((l) => l.msg === 'request')
    assert.ok(line.reqId && line.reqId !== reqId)
    assert.equal(line.orderId, undefined)
  })

  test('each maintenance step logs under its own name', async () => {
    env.DB_SLOW_QUERY_MS = 40
    // The stock-alerts step's first read waits on this lock, so it is logged as slow.
    const holder = await pool.connect()
    await holder.query('BEGIN')
    await holder.query('LOCK TABLE stock_alerts IN ACCESS EXCLUSIVE MODE')
    const log = captureLogs()
    try {
      const run = runMaintenance({ forceAll: true })
      await new Promise((r) => setTimeout(r, 300))
      await holder.query('COMMIT')
      await run
    } finally {
      holder.release()
      log.stop()
    }
    const slow = log.lines.filter((l) => l.msg === 'slow query' && /stock_alerts/.test(l.sql))
    assert.ok(slow.length >= 1)
    assert.equal(slow[0].step, 'stock-alerts')
    // One summary line per run, with its counts.
    const summary = log.lines.filter((l) => l.msg === 'maintenance run')
    assert.equal(summary.length, 1)
    assert.equal(typeof summary[0].ms, 'number')
    assert.deepEqual(summary[0].run.failed, [])
    assert.equal(summary[0].run.atRisk, 0)
    assert.equal(summary[0].step, undefined)
  })
})

describe('database health', () => {
  test('a slow query logs its duration and the start of its SQL, never its values', async () => {
    env.DB_SLOW_QUERY_MS = 40
    const log = captureLogs()
    try {
      await query('SELECT pg_sleep(0.06), $1::text AS phone_number_param_that_must_not_be_logged', ['+919876543210'])
      assert.equal(logIfSlow(`SELECT * FROM orders WHERE ${'x = 1 AND '.repeat(20)}phone = $1`, 900), true)
      assert.equal(logIfSlow('SELECT 1', 10), false)
      env.DB_SLOW_QUERY_MS = 0
      assert.equal(logIfSlow('SELECT 1', 10_000), false)
    } finally {
      log.stop()
    }
    const slow = log.lines.filter((l) => l.msg === 'slow query')
    assert.equal(slow.length, 2)
    assert.ok(slow[0].ms >= 40)
    assert.ok(slow[0].sql.startsWith('SELECT pg_sleep(0.06), $1::text'))
    for (const l of slow) {
      assert.ok(l.sql.length <= 80)
      assert.ok(!JSON.stringify(l).includes('9876543210'))
    }
  })

  test('a pool BUSY timeout is counted, and the pool gauges show open, idle and waiting connections', async () => {
    const before = (await metrics.dbPoolBusy.get()).values[0]?.value ?? 0
    const held = []
    const timeout = pool.options.connectionTimeoutMillis
    try {
      while (pool.totalCount < pool.options.max || pool.idleCount > 0) held.push(await pool.connect())
      pool.options.connectionTimeoutMillis = 50
      const waiting = query('SELECT 1')
      const text = await registry.getSingleMetricAsString('mango_db_pool_connections')
      assert.match(text, new RegExp(`mango_db_pool_connections\\{state="total"\\} ${pool.options.max}`))
      assert.match(text, /mango_db_pool_connections\{state="waiting"\} 1/)
      await assert.rejects(waiting, /timeout exceeded when trying to connect/)
    } finally {
      pool.options.connectionTimeoutMillis = timeout
      for (const c of held) c.release()
    }
    assert.equal((await metrics.dbPoolBusy.get()).values[0].value, before + 1)
  })
})

describe('run records', () => {
  test('a step records how long it took and its failures in a row, shown on Needs attention, and a success resets them', async () => {
    await query('ALTER TABLE stock_alerts RENAME TO stock_alerts_away')
    await runMaintenance()
    await runMaintenance()
    let row = (await query(`SELECT * FROM maintenance_runs WHERE step = 'stock-alerts'`)).rows[0]
    assert.equal(row.fail_count, 2)
    assert.equal(typeof row.last_duration_ms, 'number')
    const failing = (await attentionReport()).loop.failingSteps.find((s) => s.step === 'stock-alerts')
    assert.equal(failing.failCount, 2)
    assert.equal(typeof failing.lastDurationMs, 'number')
    assert.match(failing.error, /stock_alerts/)

    await query('ALTER TABLE stock_alerts_away RENAME TO stock_alerts')
    await runMaintenance()
    row = (await query(`SELECT * FROM maintenance_runs WHERE step = 'stock-alerts'`)).rows[0]
    assert.equal(row.fail_count, 0)
    assert.ok(row.last_ok_at > row.last_err_at)
    assert.equal((await attentionReport()).loop.failingSteps.find((s) => s.step === 'stock-alerts'), undefined)
    // Steps that always succeed have a duration and no failures.
    const sweep = (await query(`SELECT * FROM maintenance_runs WHERE step = 'sweep'`)).rows[0]
    assert.equal(sweep.fail_count, 0)
    assert.ok(sweep.last_duration_ms >= 0)
  })

  test('the run summary keeps counts only', () => {
    assert.deepEqual(runCounts({ expired: 2, bills: null, preorders: { converted: 1, moved: 0, partial: true }, failed: ['push'], list: [{ phone: 'x' }], text: 'x' }), {
      expired: 2, bills: null, preorders: { converted: 1, moved: 0, partial: true }, failed: ['push'], list: 1,
    })
  })
})

describe('browser notifications in Needs attention', () => {
  const pushOn = () => Object.assign(env, { WEB_PUSH: true, WEB_PUSH_PROVIDER: 'log', OPS_ALERTS: true })

  async function pushRow(customerId, status, { createdAt = new Date(T0), nextAt = new Date(T0) } = {}) {
    const id = newId('psh')
    await query(
      `INSERT INTO push_messages (id, customer_id, event_id, kind, status, attempts, next_attempt_at, created_at, last_error)
       VALUES ($1, $2, $3, 'ORDER_CONFIRMED', $4, $5, $6, $7, $8)`,
      [id, customerId, newId('evt'), status, status === 'FAILED' ? 3 : 0, nextAt, createdAt, status === 'FAILED' ? 'fcm.googleapis.com: 500' : null],
    )
    return id
  }

  test('failed and overdue pushes are listed and counted, and the health check alerts on them', async () => {
    pushOn()
    const { customer } = await customerToken(api)
    const failed = [await pushRow(customer.id, 'FAILED'), await pushRow(customer.id, 'FAILED'), await pushRow(customer.id, 'FAILED')]
    const late = await pushRow(customer.id, 'PENDING', { nextAt: new Date(Date.parse(T0) - 20 * 60_000) })
    await pushRow(customer.id, 'PENDING', { nextAt: new Date(Date.parse(T0) - 60_000) }) // just due: not overdue yet
    const a = await attentionReport()
    assert.deepEqual(a.failedPushes.map((m) => m.id).sort(), [...failed, late].sort())
    const one = a.failedPushes.find((m) => m.id === failed[0])
    assert.deepEqual([one.status, one.attempts, one.error], ['FAILED', 3, 'fcm.googleapis.com: 500'])
    assert.equal(attentionCount(a) - attentionCount({ ...a, failedPushes: [] }), 4)
    const problems = await checkHealth({}, new Date(T0))
    assert.ok(problems.includes('push-overdue'))
    assert.ok(problems.includes('push-failing'))

    // With push switched off, a waiting push is not an alarm (nothing would send it).
    env.WEB_PUSH = false
    assert.deepEqual((await attentionReport()).failedPushes.map((m) => m.status), ['FAILED', 'FAILED', 'FAILED'])
    await query(`DELETE FROM maintenance_runs WHERE step LIKE 'alert-%'`)
    assert.ok(!(await checkHealth({}, new Date(T0))).includes('push-overdue'))
  })

  test('the panel can sign in and read the report', async () => {
    const token = await adminToken(api)
    const r = await api.get('/admin/v1/attention', { token })
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.failedPushes, [])
    assert.ok(r.body.loop.failingSteps.every((s) => 'failCount' in s))
  })
})

describe('outbox', () => {
  test('a rolled-back change leaves no message behind', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    const { accessToken } = await customerToken(api)
    const co = await checkout(api, accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
    const eventId = newId('evt')
    await assert.rejects(
      tx(async (c) => {
        await enqueue(c, co.body.orderId, eventId, 'DELIVERED')
        assert.equal((await c.query('SELECT 1 FROM notifications WHERE event_id = $1', [eventId])).rowCount, 1)
        throw new Error('the order change failed')
      }),
      /the order change failed/,
    )
    assert.equal((await query('SELECT 1 FROM notifications WHERE event_id = $1', [eventId])).rowCount, 0)
    assert.equal((await query('SELECT 1 FROM push_messages WHERE event_id = $1', [eventId])).rowCount, 0)
  })

  test('a back-in-stock or preorder message queued twice is sent once', async () => {
    const { customer } = await customerToken(api)
    const alertId = newId('sal')
    await query(
      `INSERT INTO stock_alerts (id, customer_id, sku, stage, pincode, created_at, expires_at) VALUES ($1, $2, 'ALP-3', 'RIPE', '560034', $3, $4)`,
      [alertId, customer.id, new Date(T0), new Date(Date.parse(T0) + 86_400_000)],
    )
    await tx((c) => enqueueAlert(c, alertId, customer.phone))
    await tx((c) => enqueueAlert(c, alertId, customer.phone))
    assert.equal((await query('SELECT 1 FROM notifications WHERE stock_alert_id = $1', [alertId])).rowCount, 1)

    const preId = newId('pre')
    await query(
      `INSERT INTO preorders (id, number, customer_id, phone, sku, stage, qty, unit_price, total, week_start, pincode, delivery_address, status, created_at, payment_started_at)
       VALUES ($1, 'PRE-TEST-1', $2, $3, 'ALP-3', 'RIPE', 1, 100, 100, '2026-11-02', '560034', '12 MG Road', 'PAYMENT_PENDING', $4, $4)`,
      [preId, customer.id, customer.phone, new Date(T0)],
    )
    const kinds = async () => (await query('SELECT kind FROM notifications WHERE preorder_id = $1 ORDER BY kind', [preId])).rows.map((r) => r.kind)
    for (let i = 0; i < 2; i++) {
      await tx((c) => enqueuePreorder(c, preId, 'PREORDER_SPOT_OPEN'))
      await tx((c) => enqueuePreorder(c, preId, 'PREORDER_BOOKED'))
      await tx((c) => enqueuePreorder(c, preId, 'PREORDER_MOVED'))
    }
    assert.deepEqual(await kinds(), ['PREORDER_BOOKED', 'PREORDER_MOVED', 'PREORDER_SPOT_OPEN'])
    // A second move, or a second promotion from the waitlist, is a new message.
    await query('UPDATE preorders SET moved_count = moved_count + 1, payment_started_at = $2 WHERE id = $1', [preId, new Date(Date.parse(T0) + 3_600_000)])
    await tx((c) => enqueuePreorder(c, preId, 'PREORDER_MOVED'))
    await tx((c) => enqueuePreorder(c, preId, 'PREORDER_SPOT_OPEN'))
    assert.deepEqual(await kinds(), ['PREORDER_BOOKED', 'PREORDER_MOVED', 'PREORDER_MOVED', 'PREORDER_SPOT_OPEN', 'PREORDER_SPOT_OPEN'])
    setNow(T0)
  })
})
