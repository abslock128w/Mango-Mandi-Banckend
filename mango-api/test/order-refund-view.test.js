// The refund on a cancelled, paid order, as the customer's order page and orders list show it
// (customer.js refundView): on its way, paid back, or being handled; the amount in paise.
import { closeAll, checkout, client, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { query } from '../src/db.js'

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
beforeEach(() => resetDb())

const pay = (orderId) => api.post('/v1/dev/pay', { orderId, outcome: 'captured' })

test('a cancelled paid order carries its refund: on its way, paid back, or being handled', async () => {
  await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 5 } })
  const cust = await customerToken(api)
  const get = async (id) => (await api.get(`/v1/orders/${id}`, { token: cust.accessToken })).body
  const listed = async (id) => (await api.get('/v1/orders', { token: cust.accessToken })).body.find((o) => o.id === id)

  const unpaid = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }])
  assert.equal((await api.post(`/v1/orders/${unpaid.body.orderId}/cancel`, undefined, { token: cust.accessToken })).status, 204)
  assert.equal((await get(unpaid.body.orderId)).refund, null, 'nothing was paid, so nothing is refunded')
  assert.equal((await listed(unpaid.body.orderId)).refund, null)

  const paid = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }])
  const id = paid.body.orderId
  await pay(id)
  assert.equal((await get(id)).refund, null, 'a paid order that is not cancelled has no refund')
  assert.equal((await api.post(`/v1/orders/${id}/cancel`, undefined, { token: cust.accessToken })).status, 204)

  let o = await get(id)
  assert.equal(o.status, 'CANCELLED')
  assert.equal(o.refund.status, 'PENDING')
  assert.equal(o.refund.refundAmount, o.total, 'the full amount paid, in paise')
  assert.ok(o.refund.startedAt, 'started with the gateway')
  assert.equal(o.refund.processedAt, null)
  assert.deepEqual((await listed(id)).refund, o.refund, 'the orders list says the same')

  // The bank paid it back.
  await query(`UPDATE orders SET refund_status = 'processed', refund_checked_at = refunded_at + interval '3 days' WHERE id = $1`, [id])
  o = await get(id)
  assert.equal(o.refund.status, 'PROCESSED')
  assert.ok(Date.parse(o.refund.processedAt) > Date.parse(o.refund.startedAt))

  // Sending it went wrong: staff are handling it.
  await query(`UPDATE orders SET refund_status = 'failed', refunded_at = NULL WHERE id = $1`, [id])
  o = await get(id)
  assert.equal(o.refund.status, 'FAILED')
  assert.equal(o.refund.processedAt, null)

  // A manager paid it back another way.
  await query(`UPDATE orders SET refund_status = 'manual', refunded_at = NOW() WHERE id = $1`, [id])
  assert.equal((await get(id)).refund.status, 'PROCESSED')
})
