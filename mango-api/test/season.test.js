// Phase 3 season ops: bulk reschedule.
import { closeAll, adminToken, checkout, client, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { query, tx } from '../src/db.js'
import { auditLedger } from '../src/inventory.js'
import { paramsFor } from '../src/notify.js'

let srv
let api
let admin

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
  admin = await adminToken(api)
})

const pay = (orderId) => api.post('/v1/dev/pay', { orderId, outcome: 'captured' })
const bulk = (body, token = admin) => api.post('/admin/v1/orders/bulk-reschedule', body, { token })
const order = async (id) => (await api.get(`/admin/v1/orders/${id}`, { token: admin })).body
const place = async (items) => {
  const cust = await customerToken(api)
  const c = await checkout(api, cust.accessToken, items, { deliveryDate: '2026-10-16' })
  assert.equal(c.status, 201, JSON.stringify(c.body))
  await pay(c.body.orderId)
  return c.body.orderId
}

describe('bulk reschedule', () => {
  test('moves a whole day, tells each customer, and lists orders with no stock on the new date', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 4 } }) // ripe on 10-16 and 10-17
    await makeBatch({ age: 4, rating: 'SEMI_RIPE', lines: { 'ALP-3': 1 } }) // semi-ripe only on 10-16
    const a = await place([{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
    const b = await place([{ sku: 'ALP-3', stage: 'RIPE', qty: 2 }])
    const semi = await place([{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }])
    const body = { fromDate: '2026-10-16', toDate: '2026-10-17', reason: 'Rain' }

    const ops = await adminToken(api, 'ops@vmr.test', 'operator123')
    assert.equal((await bulk(body, ops)).status, 403)
    assert.equal((await bulk({ ...body, toDate: '2026-10-16' })).body.error.code, 'INVALID_DATE')
    assert.equal((await bulk({ ...body, toDate: '2026-10-25' })).body.error.code, 'INVALID_DATE')
    assert.equal((await bulk({ ...body, reason: '' })).status, 400)

    const preview = await bulk({ ...body, dryRun: true })
    assert.equal(preview.status, 200)
    assert.equal(preview.body.matched, 3)
    assert.equal((await order(a)).deliveryDate, '2026-10-16')

    const r = await bulk(body)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual(r.body.moved.map((m) => [m.id, m.deliveryDate]).sort(), [[a, '2026-10-17'], [b, '2026-10-17']].sort())
    assert.deepEqual(r.body.notMoved.map((m) => m.id), [semi])
    assert.match(r.body.notMoved[0].reason, /No stock/)

    for (const id of [a, b]) {
      const o = await order(id)
      assert.equal(o.deliveryDate, '2026-10-17')
      assert.ok(o.events.some((e) => /Rain \(moved by manager@vmr\.test\); moved from 2026-10-16 to 2026-10-17/.test(e.reason ?? '')))
      assert.ok(o.notifications.some((n) => n.kind === 'DATE_MOVED'))
    }
    const kept = await order(semi)
    assert.equal(kept.deliveryDate, '2026-10-16')
    assert.ok(!kept.notifications.some((n) => n.kind === 'DATE_MOVED'))

    // Nothing left on the old day except the order that didn't fit.
    assert.equal((await bulk({ ...body, dryRun: true })).body.matched, 1)
    assert.deepEqual(await tx((c) => auditLedger(c)), [])
  })

  test('only the listed orders move, and a single reschedule also tells the customer', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 4 } })
    const a = await place([{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
    const b = await place([{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
    const r = await bulk({ fromDate: '2026-10-16', toDate: '2026-10-17', reason: 'Van broke down', orderIds: [a] })
    assert.deepEqual(r.body.moved.map((m) => m.id), [a])
    assert.equal((await order(b)).deliveryDate, '2026-10-16')

    const one = await api.post(`/admin/v1/orders/${b}/reschedule`, { deliveryDate: '2026-10-17' }, { token: admin })
    assert.equal(one.status, 204)
    const { rows } = await query(`SELECT COUNT(*)::int AS n FROM notifications WHERE order_id = $1 AND kind = 'DATE_MOVED'`, [b])
    assert.equal(rows[0].n, 1)
    assert.deepEqual(paramsFor({ kind: 'DATE_MOVED', customer_name: 'Asha', number: 'ORD-1', delivery_date: '2026-10-17' }), [
      'Asha', 'ORD-1', 'Sat, 17 Oct', 'during the day',
    ])
  })
})
