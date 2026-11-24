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

// ---------------------------------------------------------------- the demo deploy's "Pay (test)" (DEMO_PAYMENTS)
// The demo runs with NODE_ENV=production, so /v1/dev is not there: a pre-order (one booking, a bag or a gift for several
// people), a gift order and a bulk order are paid through the customer's own demo-pay route, as POST /v1/orders/:id/demo-pay
// pays an order. Off (no DEMO_PAYMENTS and no dev routes) each answers 404; someone else's answers 404.

/** Runs `fn` as the demo deploy runs: dev routes off, DEMO_PAYMENTS on (or off with `demo: false`). */
async function asDemo(fn, { demo = true } = {}) {
  const saved = { ENABLE_DEV_ROUTES: env.ENABLE_DEV_ROUTES, DEMO_PAYMENTS: env.DEMO_PAYMENTS }
  Object.assign(env, { ENABLE_DEV_ROUTES: false, DEMO_PAYMENTS: demo })
  try { return await fn() } finally { Object.assign(env, saved) }
}

test('demo payments: a pre-order bag is paid with the test button and every line is booked; off, or not yours, is 404', async () => {
  const week = await preWeek()
  const { accessToken: token } = await customerToken(api)
  const lines = (await api.post('/v1/preorders/quote', { lines: [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }, { sku: 'BAD-3', stage: 'RAW', qty: 1 }] })).body.lines
    .map(({ sku, stage, qty, weekStart }) => ({ sku, stage, qty, weekStart }))
  assert.ok(lines.every((l) => l.weekStart >= week), JSON.stringify(lines))
  const g = await api.post('/v1/preorders/confirm', { lines, pincode: '560034', address: '12, 4th Cross, Koramangala, Bengaluru', nonRefundable: true },
    { token, headers: { 'Idempotency-Key': newId('idem') } })
  assert.equal(g.status, 201, JSON.stringify(g.body))
  const pay = (outcome, t = token) => api.post(`/v1/preorders/${g.body.leadId}/demo-pay`, { outcome }, { token: t })
  assert.equal((await asDemo(() => pay('captured'), { demo: false })).status, 404)
  const other = await customerToken(api)
  assert.equal((await asDemo(() => pay('captured', other.accessToken))).status, 404)
  assert.equal((await api.post(`/v1/preorders/${g.body.leadId}/demo-pay`, { outcome: 'captured' })).status, 401)

  const failed = await asDemo(() => pay('failed'))
  assert.deepEqual([failed.status, failed.body.result], [200, 'ignored'], JSON.stringify(failed.body))
  assert.equal((await api.get(`/v1/preorders/groups/${g.body.id}`, { token })).body.paymentFailed, true)
  const paid = await asDemo(() => pay('captured'))
  assert.deepEqual([paid.status, paid.body.result], [200, 'booked'], JSON.stringify(paid.body))
  const view = (await api.get(`/v1/preorders/groups/${g.body.id}`, { token })).body
  assert.equal(view.paymentStatus, 'SUCCEEDED')
  assert.deepEqual(view.preorders.map((p) => p.status), ['BOOKED', 'BOOKED'])
  const group = (await query('SELECT payment_method, payment_id FROM preorder_groups WHERE id = $1', [g.body.id])).rows[0]
  assert.equal(group.payment_method, 'demo')
  assert.match(group.payment_id, /^pay_demo_/)
})

test('demo payments: one pre-order is paid with the test button', async () => {
  const week = await preWeek()
  const { accessToken: token } = await customerToken(api)
  const p = await api.post('/v1/preorders', { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1, weekStart: week, pincode: '560034', address: '12, 4th Cross, Koramangala, Bengaluru' },
    { token, headers: { 'Idempotency-Key': newId('idem') } })
  assert.equal(p.status, 201, JSON.stringify(p.body))
  const r = await asDemo(() => api.post(`/v1/preorders/${p.body.id}/demo-pay`, { outcome: 'captured' }, { token }))
  assert.deepEqual([r.status, r.body.result], [200, 'booked'], JSON.stringify(r.body))
  assert.equal((await api.get(`/v1/preorders/${p.body.id}`, { token })).body.status, 'BOOKED')
})

test('demo payments: a gift order is paid with the test button and every delivery confirmed; off, or not yours, is 404', async () => {
  env.MULTI_GIFT = true
  await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
  const { accessToken: token } = await customerToken(api)
  const recipients = [1, 2].map((i) => ({ name: `R ${i}`, phone: `900000000${i}`, address: `${i}, 4th Cross, Koramangala, Bengaluru`, pincode: '560034', sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }))
  const q = await api.post('/v1/gifts/quote', { recipients }, { token })
  assert.equal(q.status, 200, JSON.stringify(q.body))
  const c = await api.post('/v1/gifts/confirm', { quoteId: q.body.quoteId }, { token, headers: { 'Idempotency-Key': newId('k') } })
  assert.equal(c.status, 201, JSON.stringify(c.body))
  const id = c.body.giftOrderId
  const pay = (outcome, t = token) => api.post(`/v1/gifts/${id}/demo-pay`, { outcome }, { token: t })
  assert.equal((await asDemo(() => pay('captured'), { demo: false })).status, 404)
  const other = await customerToken(api)
  assert.equal((await asDemo(() => pay('captured', other.accessToken))).status, 404)

  assert.deepEqual((await asDemo(() => pay('failed'))).body, { result: 'attempt_failed' })
  assert.equal((await api.get(`/v1/gifts/${id}`, { token })).body.paymentFailed, true)
  const paid = await asDemo(() => pay('captured'))
  assert.deepEqual([paid.status, paid.body.result], [200, 'confirmed'], JSON.stringify(paid.body))
  assert.equal((await api.get(`/v1/gifts/${id}`, { token })).body.status, 'PAID')
  const kids = (await query('SELECT status FROM orders WHERE gift_order_id = $1', [id])).rows
  assert.deepEqual(kids.map((k) => k.status), ['CONFIRMED', 'CONFIRMED'])
  assert.equal((await query('SELECT payment_method FROM gift_orders WHERE id = $1', [id])).rows[0].payment_method, 'demo')
})

test('demo payments: a bulk order is paid with the test button; off, or not yours, is 404', async () => {
  const saved = env.BULK_ENQUIRIES
  env.BULK_ENQUIRIES = true
  try {
    const { accessToken: token } = await customerToken(api)
    const o = await api.post('/v1/me/bulk-orders', {
      name: 'Asha Rao', phone: '98765 43210', city: 'Bengaluru', address: '12, 4th Cross, Koramangala', pincode: '560034', lines: [{ sku: 'ALP-5', stage: 'SEMI_RIPE', boxes: 20 }],
    }, { token, headers: { 'Idempotency-Key': newId('idem') } })
    assert.equal(o.status, 201, JSON.stringify(o.body))
    const pay = (outcome, t = token) => api.post(`/v1/me/bulk-orders/${o.body.id}/demo-pay`, { outcome }, { token: t })
    assert.equal((await asDemo(() => pay('captured'), { demo: false })).status, 404)
    const other = await customerToken(api)
    assert.equal((await asDemo(() => pay('captured', other.accessToken))).status, 404)

    assert.deepEqual((await asDemo(() => pay('failed'))).body, { result: 'ignored' })
    const paid = await asDemo(() => pay('captured'))
    assert.deepEqual([paid.status, paid.body.result], [200, 'paid'], JSON.stringify(paid.body))
    const row = (await query('SELECT status, payment_status, payment_method FROM bulk_enquiries WHERE id = $1', [o.body.id])).rows[0]
    assert.deepEqual([row.status, row.payment_status, row.payment_method], ['PAID', 'SUCCEEDED', 'demo'])
  } finally {
    env.BULK_ENQUIRIES = saved
  }
})
