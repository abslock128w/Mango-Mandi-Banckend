// "Payment failed: try payment again" (migration 086): a failed attempt leaves an order, a pre-order, a several-people gift
// pre-order or a gift order unpaid and payable until its hold ends, and the customer's views say so (paymentFailed); the same
// order is then paid, never a second one. One closed unpaid by us (the hold ran out) says paymentClosed; one the customer
// cancelled does not. T0 is Thu 2026-10-15 10:00 IST.
import { adminToken, checkout, client, closeAll, customerToken, forceOrderState, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { addDays, setNow, todayIST } from '../src/clock.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'

const DAY = '2026-10-16'
let srv, api
before(async () => {
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  env.MULTI_GIFT = false
  await srv.close()
  await closeAll()
})
beforeEach(() => resetDb())
afterEach(() => { env.MULTI_GIFT = false })

const listed = async (token, path, id) => (await api.get(path, { token })).body.find((x) => x.id === id)

test('an order: a failed attempt says so and the same order can still be paid; paid, the tag goes', async () => {
  await makeBatch({ age: 4, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
  const { accessToken: token } = await customerToken(api)
  const c = await checkout(api, token, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }], { deliveryDate: DAY })
  assert.equal(c.status, 201, JSON.stringify(c.body))
  const id = c.body.orderId
  assert.equal((await api.get(`/v1/orders/${id}`, { token })).body.paymentFailed, false)
  assert.equal((await api.post('/v1/dev/pay', { orderId: id, outcome: 'failed' })).status, 200)
  const failed = (await api.get(`/v1/orders/${id}`, { token })).body
  assert.equal(failed.status, 'PAYMENT_PENDING')
  assert.equal(failed.paymentFailed, true)
  assert.equal(failed.paymentClosed, false)
  assert.ok(failed.razorpayOrderId, 'the same gateway order is paid again')
  assert.equal((await listed(token, '/v1/orders', id)).paymentFailed, true)
  // Try payment again: the same order is paid.
  assert.equal((await api.post('/v1/dev/pay', { orderId: id, outcome: 'captured' })).status, 200)
  const paid = (await api.get(`/v1/orders/${id}`, { token })).body
  assert.equal(paid.status, 'CONFIRMED')
  assert.equal(paid.paymentFailed, false)
  assert.equal((await api.get('/v1/orders', { token })).body.length, 1, 'no second order')
})

test('an order closed unpaid by us says paymentClosed; one the customer cancelled does not', async () => {
  await makeBatch({ age: 4, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
  const { accessToken: token } = await customerToken(api)
  const a = (await checkout(api, token, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }], { deliveryDate: DAY })).body.orderId
  await forceOrderState(`UPDATE orders SET status = 'CANCELLED', hold_expires_at = NULL WHERE id = $1`, [a])
  const closed = await listed(token, '/v1/orders', a)
  assert.equal(closed.paymentClosed, true)
  assert.equal(closed.paymentFailed, false)
  assert.equal((await api.get(`/v1/orders/${a}`, { token })).body.paymentClosed, true)
  const b = (await checkout(api, token, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }], { deliveryDate: DAY })).body.orderId
  assert.ok([200, 204].includes((await api.post(`/v1/orders/${b}/cancel`, {}, { token })).status))
  assert.equal((await listed(token, '/v1/orders', b)).paymentClosed, false)
})

/** A week open for pre-orders, with room for ALP-3. */
async function preWeek() {
  let week = addDays(todayIST(), 6)
  while (new Date(`${week}T00:00:00Z`).getUTCDay() !== 1) week = addDays(week, 1)
  setNow(`${addDays(week, -6)}T04:30:00Z`)
  const admin = await adminToken(api)
  assert.equal((await api.put(`/admin/v1/preorder-capacity/${week}/ALP-3`, { capacity: 20 }, { token: admin })).status, 200)
  return week
}

test('a pre-order: a failed attempt says so; the link is paid after it, the same booking', async () => {
  const week = await preWeek()
  const { accessToken: token } = await customerToken(api)
  const p = await api.post('/v1/preorders', { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1, weekStart: week, pincode: '560034', address: '12, 4th Cross, Koramangala, Bengaluru' },
    { token, headers: { 'Idempotency-Key': newId('idem') } })
  assert.equal(p.status, 201, JSON.stringify(p.body))
  assert.equal(p.body.paymentFailed, false)
  assert.equal((await api.post('/v1/dev/pay-preorder', { preorderId: p.body.id, outcome: 'failed' })).status, 200)
  const failed = (await api.get(`/v1/preorders/${p.body.id}`, { token })).body
  assert.equal(failed.status, 'PAYMENT_PENDING')
  assert.equal(failed.paymentFailed, true)
  assert.equal((await listed(token, '/v1/preorders', p.body.id)).paymentFailed, true)
  assert.equal((await api.post('/v1/dev/pay-preorder', { preorderId: p.body.id, outcome: 'captured' })).status, 200)
  const booked = (await api.get(`/v1/preorders/${p.body.id}`, { token })).body
  assert.equal(booked.status, 'BOOKED')
  assert.equal(booked.paymentFailed, false)
  // Closed by us when its hold ran out (not by the customer): paymentClosed.
  const q = await api.post('/v1/preorders', { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1, weekStart: week, pincode: '560034', address: '12, 4th Cross, Koramangala, Bengaluru' },
    { token, headers: { 'Idempotency-Key': newId('idem') } })
  await query(`UPDATE preorders SET status = 'CANCELLED', hold_expires_at = NULL WHERE id = $1`, [q.body.id])
  assert.equal((await api.get(`/v1/preorders/${q.body.id}`, { token })).body.paymentClosed, true)
})

test('a several-people gift pre-order: a failed attempt marks the group and each booking', async () => {
  const week = await preWeek()
  env.MULTI_GIFT = true
  const { accessToken: token } = await customerToken(api)
  const g = await api.post('/v1/preorders/groups', {
    recipients: [1, 2].map((i) => ({
      sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1, weekStart: week, pincode: '560034', address: `${i}, 4th Cross, Koramangala, Bengaluru`,
      gift: { recipientName: `Friend ${i}`, recipientPhone: `98450 1234${i}`, message: null },
    })),
  }, { token, headers: { 'Idempotency-Key': newId('idem') } })
  assert.equal(g.status, 201, JSON.stringify(g.body))
  assert.equal(g.body.paymentFailed, false)
  assert.equal((await api.post('/v1/dev/pay-preorder', { preorderId: g.body.leadId, outcome: 'failed' })).status, 200)
  const group = (await api.get(`/v1/preorders/groups/${g.body.id}`, { token })).body
  assert.equal(group.paymentFailed, true)
  assert.ok(group.preorders.every((p) => p.paymentFailed))
  assert.equal((await api.post('/v1/dev/pay-preorder', { preorderId: g.body.leadId, outcome: 'captured' })).status, 200)
  assert.equal((await api.get(`/v1/preorders/groups/${g.body.id}`, { token })).body.paymentFailed, false)
})

test('a gift order: a failed attempt says so in the list and on its page; paid, it goes', async () => {
  env.MULTI_GIFT = true
  await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
  const { accessToken: token } = await customerToken(api)
  const recipients = [1, 2].map((i) => ({ name: `R ${i}`, phone: `900000000${i}`, address: `${i}, 4th Cross, Koramangala, Bengaluru`, pincode: '560034', sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }))
  const q = await api.post('/v1/gifts/quote', { recipients }, { token })
  assert.equal(q.status, 200, JSON.stringify(q.body))
  const c = await api.post('/v1/gifts/confirm', { quoteId: q.body.quoteId }, { token, headers: { 'Idempotency-Key': newId('k') } })
  assert.equal(c.status, 201, JSON.stringify(c.body))
  const id = c.body.giftOrderId
  assert.equal((await api.post('/v1/dev/pay-gift', { giftOrderId: id, outcome: 'failed' })).status, 200)
  assert.equal((await api.get(`/v1/gifts/${id}`, { token })).body.paymentFailed, true)
  assert.equal((await listed(token, '/v1/gifts', id)).paymentFailed, true)
  assert.equal((await api.post('/v1/dev/pay-gift', { giftOrderId: id, outcome: 'captured' })).status, 200)
  const paid = (await api.get(`/v1/gifts/${id}`, { token })).body
  assert.equal(paid.status, 'PAID')
  assert.equal(paid.paymentFailed, false)
  assert.equal(paid.paymentClosed, false)
})
