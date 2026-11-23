// "Ordered before" and "Order again" (the shop's cards and Your orders): GET /v1/me/ordered-products lists, per variety,
// what the signed-in customer has had DELIVERED. Only delivered orders count (one made from a pre-order too, once it is
// delivered); placed, cancelled and failed ones do not, and nobody sees another customer's orders.
// T0 is Thu 2026-10-15 10:00 IST; the first delivery day is 10-16.
import { checkout, client, closeAll, customerToken, forceOrderState, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { query } from '../src/db.js'
import { newId } from '../src/ids.js'
import { allocatePreorders } from '../src/preorders.js'

const DAY = '2026-10-16'
let srv, api
before(async () => {
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  await srv.close()
  await closeAll()
})
beforeEach(() => resetDb())

let seq = 0
async function shopper() {
  const phone = `96${String(30_000_000 + ++seq).slice(-8)}`
  const t = await customerToken(api, phone)
  const id = (await query('SELECT id FROM customers WHERE phone LIKE $1', [`%${phone}`])).rows[0].id
  return { id, token: t.accessToken }
}

/** An order for these boxes, moved to `status` (DELIVERED gets its delivered event at `at`). */
async function order(who, items, status, at = new Date('2026-10-16T09:00:00Z')) {
  const r = await checkout(api, who.token, items, { deliveryDate: DAY })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  const id = r.body.orderId ?? r.body.id
  await forceOrderState('UPDATE orders SET status = $2 WHERE id = $1', [id, status])
  if (status === 'DELIVERED') {
    await query(`INSERT INTO order_events (id, order_id, from_status, status, actor, created_at) VALUES ($1, $2, 'OUT_FOR_DELIVERY', 'DELIVERED', 'test', $3)`, [newId('evt'), id, at])
  }
  return id
}

const mine = async (who) => {
  const r = await api.get('/v1/me/ordered-products', { token: who.token })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}

test('signed out: 401', async () => {
  const r = await api.get('/v1/me/ordered-products')
  assert.equal(r.status, 401)
})

test('only delivered orders count; cancelled, failed and placed ones do not', async () => {
  await makeBatch({ age: 4, rating: 'SEMI_RIPE', lines: { 'ALP-3': 40 } })
  await makeBatch({ variety: 'Badami', age: 4, rating: 'SEMI_RIPE', lines: { 'BAD-3': 40, 'BAD-5': 40 } })
  const a = await shopper()
  assert.deepEqual(await mine(a), [])
  await order(a, [{ sku: 'BAD-3', stage: 'SEMI_RIPE', qty: 1 }], 'CANCELLED')
  await order(a, [{ sku: 'BAD-5', stage: 'SEMI_RIPE', qty: 1 }], 'DELIVERY_FAILED')
  await order(a, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }], 'CONFIRMED')
  assert.deepEqual(await mine(a), [])
  await order(a, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2 }], 'DELIVERED', new Date('2026-10-16T09:00:00Z'))
  assert.deepEqual(await mine(a), [{ variety: 'Alphonso', sku: 'ALP-3', stage: 'SEMI_RIPE', lastDeliveredOn: '2026-10-16', times: 1 }])
})

test('times and the last day per variety, whichever box size; the last order gives the box and ripeness', async () => {
  await makeBatch({ age: 4, rating: 'SEMI_RIPE', lines: { 'ALP-3': 40, 'ALP-5': 40 } })
  await makeBatch({ variety: 'Badami', age: 4, rating: 'SEMI_RIPE', lines: { 'BAD-3': 40 } })
  const a = await shopper()
  await order(a, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }, { sku: 'BAD-3', stage: 'SEMI_RIPE', qty: 1 }], 'DELIVERED', new Date('2026-10-16T09:00:00Z'))
  await order(a, [{ sku: 'ALP-5', stage: 'SEMI_RIPE', qty: 3 }], 'DELIVERED', new Date('2026-11-16T20:00:00Z'))
  const list = await mine(a)
  // 20:00 UTC on 11-16 is 01:30 IST on 11-17: the day is the shop's (IST).
  assert.deepEqual(list, [
    { variety: 'Alphonso', sku: 'ALP-5', stage: 'SEMI_RIPE', lastDeliveredOn: '2026-11-17', times: 2 },
    { variety: 'Badami', sku: 'BAD-3', stage: 'SEMI_RIPE', lastDeliveredOn: '2026-10-16', times: 1 },
  ])
})

test('an order made from a pre-order counts once delivered', async () => {
  await makeBatch({ age: 4, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
  const a = await shopper()
  const pre = newId('pre')
  await query(
    `INSERT INTO preorders (id, number, customer_id, customer_name, phone, sku, stage, qty, unit_price, total, week_start, pincode, delivery_address,
                            status, payment_status, payment_id, paid_amount, created_at, booked_at, non_refundable, load_kg, variety)
     VALUES ($1, 'P700000901', $2, 'Asha', '+919800000000', 'ALP-3', 'SEMI_RIPE', 2, 100, 200, '2026-10-12', '560034', '12, 4th Cross, Koramangala, Bengaluru',
             'BOOKED', 'SUCCEEDED', $3, 200, $4, $4, true, 6, 'Alphonso')`,
    [pre, a.id, `pay_${pre}`, new Date('2026-09-01T00:00:00Z')],
  )
  assert.equal((await allocatePreorders()).converted, 1)
  const orderId = (await query('SELECT order_id FROM preorders WHERE id = $1', [pre])).rows[0].order_id
  assert.deepEqual(await mine(a), [], 'booked and converted, not delivered yet')
  await forceOrderState(`UPDATE orders SET status = 'DELIVERED' WHERE id = $1`, [orderId])
  await query(`INSERT INTO order_events (id, order_id, from_status, status, actor, created_at) VALUES ($1, $2, 'OUT_FOR_DELIVERY', 'DELIVERED', 'test', $3)`, [newId('evt'), orderId, new Date('2026-10-16T08:00:00Z')])
  assert.deepEqual(await mine(a), [{ variety: 'Alphonso', sku: 'ALP-3', stage: 'SEMI_RIPE', lastDeliveredOn: '2026-10-16', times: 1 }])
})

test("another customer's delivered orders never show", async () => {
  await makeBatch({ age: 4, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
  const a = await shopper(), b = await shopper()
  await order(a, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }], 'DELIVERED')
  assert.equal((await mine(a)).length, 1)
  assert.deepEqual(await mine(b), [])
})
