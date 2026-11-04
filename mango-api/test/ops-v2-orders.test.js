// Mango Ops v2 workbench (docs/design/ops-dashboard-v2.md §4): GET /orders' optional saved-view
// filters (delivery day, slot, not packed yet, unpaid longer than N minutes) and its slot and rider
// fields. Without them the list answers as before.
import { adminToken, checkout, client, closeAll, customerToken, forceOrderState, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { now } from '../src/clock.js'
import { query } from '../src/db.js'
import { stopEvents } from '../src/events.js'
import { newId } from '../src/ids.js'

let srv
let api
let admin
const DATE = '2026-10-16'

before(async () => {
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  await stopEvents()
  await srv.close()
  await closeAll()
})

async function makeOrder({ slotId = 'slt_am', pay = true } = {}) {
  const cust = (await customerToken(api)).accessToken
  const o = await checkout(api, cust, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }], { pincode: '560034', slotId, deliveryDate: DATE })
  assert.equal(o.status, 201, JSON.stringify(o.body))
  if (pay) assert.equal((await api.post('/v1/dev/pay', { orderId: o.body.orderId, outcome: 'captured' })).status, 200)
  return { id: o.body.orderId, number: o.body.number }
}

describe('GET /orders saved-view filters', () => {
  let am, pm, packed, unpaid, rider
  before(async () => {
    await resetDb()
    admin = await adminToken(api)
    await query(`INSERT INTO delivery_slots (id, label, starts_at, ends_at, max_boxes, sort) VALUES ('slt_am', 'Morning', '07:00', '11:00', 10, 1), ('slt_pm', 'Evening', '16:00', '20:00', 10, 2)`)
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 100 } })
    rider = newId('adm')
    await query("INSERT INTO admin_users (id, email, password_hash, role, display_name) VALUES ($1, $2, 'x', 'RIDER', 'Ravi')", [rider, `${rider}@mandimangoes.test`])
    am = await makeOrder()
    pm = await makeOrder({ slotId: 'slt_pm' })
    packed = await makeOrder()
    unpaid = await makeOrder({ pay: false })
    await forceOrderState("UPDATE orders SET status = 'PACKED', rider_id = $2 WHERE id = $1", [packed.id, rider])
    await forceOrderState('UPDATE orders SET placed_at = $2 WHERE id = $1', [unpaid.id, new Date(now().getTime() - 45 * 60_000)])
  })

  const list = async (qs) => {
    const r = await api.get(`/admin/v1/orders?${qs}`, { token: admin })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return r.body.items
  }

  test('each row says its slot and rider', async () => {
    const rows = await list('delivery=' + DATE)
    const p = rows.find((o) => o.id === packed.id)
    assert.equal(p.slotId, 'slt_am')
    assert.equal(p.riderId, rider)
    assert.equal(rows.find((o) => o.id === am.id).riderId, null)
  })

  test('delivery day and slot', async () => {
    assert.deepEqual((await list(`delivery=${DATE}&slot=slt_pm`)).map((o) => o.id), [pm.id])
    assert.equal((await list('delivery=2026-10-17')).length, 0)
  })

  test('not packed yet leaves out packed and unpaid orders', async () => {
    const ids = (await list(`delivery=${DATE}&unpacked=true`)).map((o) => o.id).sort()
    assert.deepEqual(ids, [am.id, pm.id].sort())
  })

  test('unpaid for more than 30 minutes', async () => {
    assert.deepEqual((await list('status=PAYMENT_PENDING&olderThanMinutes=30')).map((o) => o.id), [unpaid.id])
    assert.equal((await list('status=PAYMENT_PENDING&olderThanMinutes=60')).length, 0)
  })

  test('a bad filter is refused', async () => {
    assert.equal((await api.get('/admin/v1/orders?delivery=tomorrow', { token: admin })).status, 400)
    assert.equal((await api.get('/admin/v1/orders?unpacked=yes', { token: admin })).status, 400)
  })
})
