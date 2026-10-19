// Ops and performance fixes from the audit: migration lock timeouts, /ready
// with no maintenance run, notification pruning, one stock read for the
// catalogue, and the claims list without a query per claim.
import { adminToken, checkout, client, closeAll, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, test } from 'node:test'
import { addDays, now, todayIST } from '../src/clock.js'
import { pool, query } from '../src/db.js'
import { newId } from '../src/ids.js'
import { availability, availabilityByDate } from '../src/inventory.js'
import { migrate } from '../src/migrate.js'
import { maintenanceReady } from '../src/readiness.js'
import { pruneNotifications } from '../src/retention.js'

let srv
let api
before(async () => {
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  await srv.close()
  await closeAll()
})
beforeEach(resetDb)

/** Counts the pool queries whose SQL matches `re` while fn runs. */
async function counting(re, fn) {
  const real = pool.query
  let n = 0
  pool.query = function (text, ...rest) {
    if (re.test(typeof text === 'string' ? text : text?.text ?? '')) n++
    return real.call(this, text, ...rest)
  }
  try {
    await fn()
  } finally {
    pool.query = real
  }
  return n
}

describe('migrations wait for a table lock only so long', () => {
  test('a migration stuck behind a long transaction gives up, then applies once the lock is free', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mig-'))
    await writeFile(path.join(dir, '999_lock_probe.sql'), 'ALTER TABLE notifications ADD COLUMN lock_probe INT;')
    const holder = await pool.connect()
    try {
      await holder.query('BEGIN')
      await holder.query('LOCK TABLE notifications IN ACCESS SHARE MODE') // like a long-running read
      const t = Date.now()
      await assert.rejects(migrate(pool, { dir, lockTimeout: '200ms', attempts: 2, retryMs: 10 }), /lock timeout.*stayed locked for over 200ms, 2 times/s)
      assert.ok(Date.now() - t < 5_000, 'it gave up quickly instead of queueing')
      assert.equal((await query(`SELECT 1 FROM schema_migrations WHERE version = '999_lock_probe.sql'`)).rowCount, 0)
      await holder.query('ROLLBACK')
      await migrate(pool, { dir, lockTimeout: '200ms', attempts: 2, retryMs: 10 })
      assert.equal((await query(`SELECT 1 FROM schema_migrations WHERE version = '999_lock_probe.sql'`)).rowCount, 1)
    } finally {
      await holder.query('ROLLBACK').catch(() => {})
      holder.release()
      await rm(dir, { recursive: true })
    }
  })
})

describe('/ready and the maintenance loop', () => {
  test('in production, a database that has never had a maintenance run is not ready', () => {
    assert.equal(maintenanceReady(null, { env: 'production' }), false)
    assert.equal(maintenanceReady(30, { env: 'production' }), true)
    assert.equal(maintenanceReady(301, { env: 'production' }), false)
    // Development, tests and Vercel previews (no cron there) may have no run yet.
    assert.equal(maintenanceReady(null, { env: 'preview' }), true)
    assert.equal(maintenanceReady(null, { env: 'test' }), true)
    assert.equal(maintenanceReady(301, { env: 'preview' }), false)
  })
})

describe('notification retention', () => {
  test('finished messages older than 180 days are pruned; pending and recent ones stay', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 5 } })
    const cust = await customerToken(api)
    const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
    assert.equal(c.status, 201, JSON.stringify(c.body))
    const old = new Date(now().getTime() - 200 * 86_400_000)
    const add = async (status, at) => {
      const id = newId('ntf')
      await query(
        `INSERT INTO notifications (id, order_id, event_id, kind, phone, status, next_attempt_at, created_at) VALUES ($1, $2, $3, 'DELIVERED', '9800000000', $4, $5, $5)`,
        [id, c.body.orderId, newId('evt'), status, at],
      )
      return id
    }
    const gone = [await add('SENT', old), await add('FAILED', old), await add('SKIPPED', old)]
    const kept = [await add('PENDING', old), await add('SENT', now())]
    assert.equal(await pruneNotifications(now()), 3)
    const left = new Set((await query('SELECT id FROM notifications')).rows.map((r) => r.id))
    for (const id of gone) assert.ok(!left.has(id))
    for (const id of kept) assert.ok(left.has(id))
    // Bounded per call: a backlog drains over several runs.
    await add('SENT', old)
    await add('SENT', old)
    assert.equal(await pruneNotifications(now(), { batch: 1 }), 1)
    assert.equal(await pruneNotifications(now(), { batch: 1 }), 1)
    assert.equal(await pruneNotifications(now(), { batch: 1 }), 0)
  })
})

describe('the catalogue reads stock once', () => {
  test('availabilityByDate matches availability() for each date, from one query', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10, 'ALP-5': 4 } })
    await makeBatch({ age: 1, rating: 'RAW', lines: { 'ALP-3': 7 } })
    await makeBatch({ age: 0, status: 'IN_TRANSIT', rating: null, lines: { 'ALP-3': 20 } })
    const today = todayIST()
    const dates = [1, 2, 3, 4, 5, 6].map((n) => addDays(today, n))
    let byDate
    const reads = await counting(/FROM batch_lines/, async () => {
      byDate = await availabilityByDate({ query }, dates)
    })
    assert.equal(reads, 1)
    for (const d of dates) assert.deepEqual(byDate.get(d), await availability({ query }, d), d)
  })

  test('a catalogue with sold-out choices still reads the stock once', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 2 } })
    let cat
    const reads = await counting(/FROM batch_lines/, async () => {
      cat = await api.get('/v1/catalogue?pincode=560034')
    })
    assert.equal(cat.status, 200)
    assert.ok(cat.body.items.some((i) => i.qty === 0), 'something is sold out')
    assert.equal(reads, 1)
  })
})

describe('admin lists', () => {
  test('the claims list does the same number of queries for one claim or many, with the same risk answers', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 30 } })
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    const cust = await customerToken(api)
    const orders = []
    for (let i = 0; i < 4; i++) {
      const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
      assert.equal(c.status, 201, JSON.stringify(c.body))
      await query(`UPDATE orders SET status = 'DELIVERED' WHERE id = $1`, [c.body.orderId])
      orders.push(c.body.orderId)
    }
    const customerId = (await query('SELECT customer_id FROM orders WHERE id = $1', [orders[0]])).rows[0].customer_id
    await query(
      `INSERT INTO delivery_attempts (id, order_id, outcome, method, actor, created_at) VALUES ($1, $2, 'DELIVERED', 'code', 'rider', $3)`,
      [newId('dat'), orders[0], now()],
    )
    const addClaim = (orderId, issue, extra = '') =>
      query(`INSERT INTO claims (id, order_id, customer_id, issue_type, description, created_at${extra ? ', status, resolution' : ''})
             VALUES ($1, $2, $3, $4, 'x', $5${extra ? `, ${extra}` : ''})`, [newId('clm'), orderId, customerId, issue, now()])
    await addClaim(orders[0], 'NOT_DELIVERED')
    const one = await counting(/delivery_attempts/, () => api.get('/admin/v1/claims', { token: ops }))
    // Two earlier replacements: the next one needs a manager.
    await addClaim(orders[1], 'DAMAGED', `'RESOLVED', 'REPLACEMENT_APPROVED'`)
    await addClaim(orders[2], 'DAMAGED', `'RESOLVED', 'REPLACEMENT_APPROVED'`)
    await addClaim(orders[3], 'DAMAGED')
    let list
    const many = await counting(/delivery_attempts/, async () => {
      list = (await api.get('/admin/v1/claims', { token: ops })).body
    })
    assert.equal(one, 1)
    assert.equal(many, 1)
    assert.equal(list.length, 2)
    const byOrder = Object.fromEntries(list.map((c) => [c.orderId, c]))
    assert.deepEqual(byOrder[orders[0]].delivery.method, 'code')
    assert.ok(byOrder[orders[0]].managerNeeded.includes("the customer's own code confirmed the delivery"))
    assert.deepEqual(byOrder[orders[3]].history, { claims90d: 3, replacements90d: 2 })
    assert.deepEqual(byOrder[orders[3]].managerNeeded, ['2 replacements in the last 90 days'])
    assert.equal(byOrder[orders[3]].delivery, null)
    // Resolved claims come newest first.
    await query(`UPDATE claims SET created_at = created_at - INTERVAL '1 day' WHERE order_id = $1`, [orders[1]])
    const resolved = (await api.get('/admin/v1/claims?status=RESOLVED', { token: ops })).body
    assert.deepEqual(resolved.map((c) => c.orderId), [orders[2], orders[1]])
  })

  test('the claims and batches lists are capped', async () => {
    const { LIST_LIMIT } = await import('../src/admin.js')
    assert.equal(LIST_LIMIT, 500)
    const admin = await adminToken(api)
    const batches = await counting(/LIMIT \$2/, () => api.get('/admin/v1/batches', { token: admin }))
    const claims = await counting(/LIMIT \$2/, () => api.get('/admin/v1/claims?status=RESOLVED', { token: admin }))
    assert.equal(batches, 1)
    assert.equal(claims, 1)
  })
})
