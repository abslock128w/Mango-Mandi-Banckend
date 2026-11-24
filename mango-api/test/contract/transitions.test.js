// The contract walk, part 2: every order status change the API could be asked for. An order
// is put into each state (forceOrderState), then a manager asks for every other state through
// PATCH /orders/:id/status, and the manager's and the customer's cancel routes are tried. A
// move ORDER_TRANSITIONS does not list must be refused with the error shape, and must leave
// the order, its stock and its history exactly as they were.
import '../setup-env.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { query } from '../../src/db.js'
import { ORDER_TRANSITIONS } from '../../src/orders.js'
import { adminToken, checkout, client, closeAll, customerToken, forceOrderState, makeBatch, resetDb, startServer } from '../helpers.js'
import { errorShapeProblem } from './lib.js'

const STATES = Object.keys(ORDER_TRANSITIONS)
let srv
let api
let manager
let cust

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
  manager = await adminToken(api)
  cust = await customerToken(api)
  await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 40 } })
})

/** A paid order (an unpaid one for PAYMENT_PENDING) put straight into `state`. */
async function orderIn(state) {
  const o = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }])
  assert.equal(o.status, 201, JSON.stringify(o.body))
  if (state !== 'PAYMENT_PENDING') assert.equal((await api.post('/v1/dev/pay', { orderId: o.body.orderId, outcome: 'captured' })).status, 200)
  if (state !== 'PAYMENT_PENDING' && state !== 'CONFIRMED') await forceOrderState('UPDATE orders SET status = $1 WHERE id = $2', [state, o.body.orderId])
  return o.body.orderId
}

/** What a refused move must not touch. */
const snapshot = async (id) => {
  const order = (await query('SELECT status, payment_status, refund_status FROM orders WHERE id = $1', [id])).rows[0]
  const events = (await query('SELECT count(*)::int AS n FROM order_events WHERE order_id = $1', [id])).rows[0].n
  const stock = (await query('SELECT state, sum(quantity)::int AS n FROM order_stock WHERE order_id = $1 GROUP BY state ORDER BY state', [id])).rows
  return { order, events, stock }
}

for (const from of STATES) {
  test(`from ${from}, every move ORDER_TRANSITIONS does not list is refused and changes nothing`, async () => {
    const id = await orderIn(from)
    const illegal = STATES.filter((to) => !ORDER_TRANSITIONS[from].includes(to))
    const problems = []
    for (const to of illegal) {
      const before = await snapshot(id)
      const r = await api.patch(`/admin/v1/orders/${id}/status`, { status: to }, { token: manager })
      const after = await snapshot(id)
      if (r.status < 400 || r.status >= 500) problems.push(`${from} -> ${to}: ${r.status}`)
      else if (errorShapeProblem(r.body)) problems.push(`${from} -> ${to}: ${errorShapeProblem(r.body)}`)
      if (JSON.stringify(before) !== JSON.stringify(after)) problems.push(`${from} -> ${to}: changed ${JSON.stringify(before)} to ${JSON.stringify(after)}`)
    }
    assert.deepEqual(problems, [])
  })
}

test('cancelling is refused once an order cannot be cancelled, by staff and by the customer', async () => {
  const problems = []
  for (const from of STATES.filter((s) => !ORDER_TRANSITIONS[s].includes('CANCELLED'))) {
    const id = await orderIn(from)
    const before = await snapshot(id)
    const staff = await api.post(`/admin/v1/orders/${id}/cancel`, { reason: 'QA: not allowed' }, { token: manager })
    const own = await api.post(`/v1/orders/${id}/cancel`, {}, { token: cust.accessToken })
    if (staff.status < 400 || staff.status >= 500) problems.push(`staff cancel from ${from}: ${staff.status}`)
    if (own.status < 400 || own.status >= 500) problems.push(`customer cancel from ${from}: ${own.status}`)
    if (JSON.stringify(before) !== JSON.stringify(await snapshot(id))) problems.push(`cancel from ${from} changed the order`)
  }
  assert.deepEqual(problems, [])
})

test('a customer cannot cancel once the order is packed, though staff can (docs/order-states.md)', async () => {
  for (const from of ['PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY']) {
    const id = await orderIn(from)
    const own = await api.post(`/v1/orders/${id}/cancel`, {}, { token: cust.accessToken })
    assert.ok(own.status >= 400 && own.status < 500, `${from}: ${own.status}`)
    assert.equal((await snapshot(id)).order.status, from)
  }
})

test('another customer cannot cancel, or even see, an order', async () => {
  const id = await orderIn('CONFIRMED')
  const other = await customerToken(api)
  const r = await api.post(`/v1/orders/${id}/cancel`, {}, { token: other.accessToken })
  assert.equal(r.status, 404)
  assert.equal((await api.get(`/v1/orders/${id}`, { token: other.accessToken })).status, 404)
  assert.equal((await snapshot(id)).order.status, 'CONFIRMED')
})
