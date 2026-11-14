// The contract walk, part 3: every request that moves money, stock or an order, sent twice,
// as a phone on a bad network does (a retry after a lost answer, a double tap). The second
// must never make a second order, payment, refund, claim, replacement, booking, batch, staff
// member, stock movement or customer message.
import '../setup-env.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { addDays, setNow, todayIST } from '../../src/clock.js'
import { query } from '../../src/db.js'
import { env } from '../../src/env.js'
import { newId } from '../../src/ids.js'
import { adminToken, checkout, client, closeAll, customerToken, forceOrderState, makeBatch, resetDb, startServer, stepPhoto } from '../helpers.js'

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
  await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
})

const count = async (sql, params) => (await query(sql, params)).rows[0].n
const notes = (orderId, kind) => count('SELECT count(*)::int AS n FROM notifications WHERE order_id = $1 AND kind = $2', [orderId, kind])
/** Moves into a status (a refund or a note on the same status is not a move). */
const events = (orderId, to) =>
  count('SELECT count(*)::int AS n FROM order_events WHERE order_id = $1 AND status = $2 AND from_status IS DISTINCT FROM status', [orderId, to])
const held = (orderId) => count('SELECT coalesce(sum(quantity), 0)::int AS n FROM order_stock WHERE order_id = $1', [orderId])
const onHand = () => count("SELECT sum(on_hand)::int AS n FROM batch_lines WHERE sku = 'ALP-3'")

async function paidOrder() {
  const o = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2 }])
  assert.equal(o.status, 201, JSON.stringify(o.body))
  assert.equal((await api.post('/v1/dev/pay', { orderId: o.body.orderId, outcome: 'captured' })).status, 200)
  return o.body
}

test('checkout sent twice with one Idempotency-Key: one order, one hold', async () => {
  const key = newId('idem')
  assert.equal((await api.post('/v1/cart/items', { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2 }, { token: cust.accessToken })).status, 204)
  const q = await api.post('/v1/checkout/quote', { pincode: '560034' }, { token: cust.accessToken })
  const confirm = () =>
    api.post('/v1/checkout/confirm', { quoteId: q.body.quoteId, address: '12, 4th Cross, Koramangala, Bengaluru' }, { token: cust.accessToken, headers: { 'Idempotency-Key': key } })
  const a = await confirm()
  const b = await confirm()
  assert.equal(a.status, 201)
  assert.ok(b.status === 200 || b.status === 201, `${b.status} ${JSON.stringify(b.body)}`)
  assert.equal(b.body.orderId, a.body.orderId)
  assert.equal(await count('SELECT count(*)::int AS n FROM orders WHERE customer_id = (SELECT customer_id FROM orders WHERE id = $1)', [a.body.orderId]), 1)
  assert.equal(await held(a.body.orderId), 2)
})

test('the same key with a different basket is refused, not a second order', async () => {
  const key = newId('idem')
  const a = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2 }], { key })
  const b = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 3 }], { key })
  assert.equal(a.status, 201)
  assert.equal(b.status, 422)
  assert.equal(b.body.error.code, 'IDEMPOTENCY_KEY_REUSED')
  assert.equal(await held(a.body.orderId), 2)
})

test('a second payment for a paid order confirms nothing again: one confirmation, the extra one refunded', async () => {
  const o = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2 }])
  const one = await api.post('/v1/dev/pay', { orderId: o.body.orderId, outcome: 'captured' })
  const two = await api.post('/v1/dev/pay', { orderId: o.body.orderId, outcome: 'captured' })
  assert.equal(one.status, 200)
  assert.ok(two.status < 500, String(two.status))
  assert.equal(await events(o.body.orderId, 'CONFIRMED'), 1)
  assert.equal(await notes(o.body.orderId, 'ORDER_CONFIRMED'), 1)
  // /v1/dev/pay takes a new payment each time: the second is a duplicate, refunded automatically.
  assert.equal(await count('SELECT count(*)::int AS n FROM duplicate_payments WHERE order_id = $1', [o.body.orderId]), 1)
})

test('a status change sent twice moves the order once', async () => {
  const o = await paidOrder()
  const one = await api.patch(`/admin/v1/orders/${o.orderId}/status`, { status: 'PROCESSING' }, { token: manager })
  const two = await api.patch(`/admin/v1/orders/${o.orderId}/status`, { status: 'PROCESSING' }, { token: manager })
  assert.equal(one.status, 204)
  assert.ok(two.status < 500, String(two.status))
  assert.equal(await events(o.orderId, 'PROCESSING'), 1)
})

test('allocating twice sets the stock aside once', async () => {
  const o = await paidOrder()
  await api.patch(`/admin/v1/orders/${o.orderId}/status`, { status: 'PROCESSING' }, { token: manager })
  const stock = await onHand()
  assert.equal((await api.post(`/admin/v1/orders/${o.orderId}/allocate`, undefined, { token: manager })).status, 204)
  const after1 = [await held(o.orderId), await onHand()]
  const again = await api.post(`/admin/v1/orders/${o.orderId}/allocate`, undefined, { token: manager })
  assert.ok(again.status < 500, String(again.status))
  assert.deepEqual([await held(o.orderId), await onHand()], after1)
  assert.ok(after1[1] <= stock)
})

test("a customer's cancel sent twice cancels once and refunds once", async () => {
  const o = await paidOrder()
  const stock = await onHand()
  const one = await api.post(`/v1/orders/${o.orderId}/cancel`, {}, { token: cust.accessToken })
  const two = await api.post(`/v1/orders/${o.orderId}/cancel`, {}, { token: cust.accessToken })
  assert.ok(one.status < 300, `${one.status} ${JSON.stringify(one.body)}`)
  assert.ok(two.status < 500, String(two.status))
  assert.equal(await events(o.orderId, 'CANCELLED'), 1)
  const r = (await query('SELECT refund_status FROM orders WHERE id = $1', [o.orderId])).rows[0]
  assert.ok(r.refund_status, 'refund started')
  assert.equal(two.status, 409)
  assert.equal(two.body.error.code, 'NOT_CANCELLABLE')
  assert.equal(await count("SELECT count(*)::int AS n FROM order_events WHERE order_id = $1 AND reason LIKE 'Refunded in full%'", [o.orderId]), 1)
  assert.equal(await onHand(), stock, 'cancelling a held, unallocated order returns nothing twice')
})

test('a claim sent twice is one claim, and approving it twice makes one replacement', async () => {
  const o = await paidOrder()
  await forceOrderState("UPDATE orders SET status = 'DELIVERED' WHERE id = $1", [o.orderId])
  const body = { orderId: o.orderId, issueType: 'DAMAGED', description: 'Box crushed in transit', itemSkus: ['ALP-3'] }
  const a = await api.post('/v1/claims', body, { token: cust.accessToken })
  const b = await api.post('/v1/claims', body, { token: cust.accessToken })
  assert.equal(a.status, 201, JSON.stringify(a.body))
  assert.ok(b.status >= 400 && b.status < 500, `${b.status} ${JSON.stringify(b.body)}`)
  assert.equal(await count('SELECT count(*)::int AS n FROM claims WHERE order_id = $1', [o.orderId]), 1)
  await api.post(`/admin/v1/claims/${a.body.id}/review`, undefined, { token: manager })
  const r1 = await api.post(`/admin/v1/claims/${a.body.id}/resolve`, { resolution: 'REPLACEMENT_APPROVED' }, { token: manager })
  const r2 = await api.post(`/admin/v1/claims/${a.body.id}/resolve`, { resolution: 'REPLACEMENT_APPROVED' }, { token: manager })
  assert.equal(r1.status, 204, JSON.stringify(r1.body))
  assert.ok(r2.status >= 400 && r2.status < 500, String(r2.status))
  assert.equal(await count('SELECT count(*)::int AS n FROM orders WHERE replacement_for = $1', [o.orderId]), 1)
})

test('a preorder booked twice with one key is one booking', async () => {
  // The first Monday past the regular booking horizon, with room set by a manager (as preorders.test.js).
  let week = addDays(todayIST(), 6)
  while (new Date(`${week}T00:00:00Z`).getUTCDay() !== 1) week = addDays(week, 1)
  assert.equal((await api.put(`/admin/v1/preorder-capacity/${week}/ALP-3`, { capacity: 5 }, { token: manager })).status, 200)
  const key = newId('idem')
  const body = { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2, weekStart: week, pincode: '560034', address: '12, 4th Cross, Koramangala, Bengaluru' }
  const a = await api.post('/v1/preorders', body, { token: cust.accessToken, headers: { 'Idempotency-Key': key } })
  const b = await api.post('/v1/preorders', body, { token: cust.accessToken, headers: { 'Idempotency-Key': key } })
  assert.equal(a.status, 201, JSON.stringify(a.body))
  assert.ok(b.status < 300, `${b.status} ${JSON.stringify(b.body)}`)
  assert.equal(b.body.id ?? b.body.preorderId, a.body.id ?? a.body.preorderId)
  assert.equal(await count('SELECT count(*)::int AS n FROM preorders'), 1)
})

test('a batch received twice with one Idempotency-Key is one batch', async (t) => {
  // STOCK_INTAKE_CHECKS is a strict switch: on in production, off in tests unless set.
  env.STOCK_INTAKE_CHECKS = true
  t.after(() => delete env.STOCK_INTAKE_CHECKS)
  const before = await count('SELECT count(*)::int AS n FROM batches')
  const body = { variety: 'Alphonso', pluckedOn: '2026-10-12', supplier: 'QA farm', lines: [{ sku: 'ALP-3', onHand: 10 }] }
  const key = newId('idem')
  const a = await api.post('/admin/v1/batches', body, { token: manager, headers: { 'Idempotency-Key': key } })
  const b = await api.post('/admin/v1/batches', body, { token: manager, headers: { 'Idempotency-Key': key } })
  assert.equal(a.status, 201, JSON.stringify(a.body))
  assert.ok(b.status < 300, `${b.status} ${JSON.stringify(b.body)}`)
  assert.equal(b.body.id, a.body.id)
  assert.equal(await count('SELECT count(*)::int AS n FROM batches'), before + 1)
})

test('a staff member added twice is one account', async () => {
  const body = { email: 'twice@mandimangoes.test', role: 'PACKER', password: 'long-enough-qa2' }
  const a = await api.post('/admin/v1/staff', body, { token: manager })
  const b = await api.post('/admin/v1/staff', body, { token: manager })
  assert.equal(a.status, 201)
  assert.equal(b.status, 409)
  assert.equal(await count("SELECT count(*)::int AS n FROM admin_users WHERE email = 'twice@mandimangoes.test'"), 1)
})

test("a rider's pickup photo and pickup sent twice: one photo, one move, one code message", async () => {
  const add = await api.post('/admin/v1/staff', { email: 'twice.rider@mandimangoes.test', role: 'RIDER', password: 'long-enough-qa3' }, { token: manager })
  const rider = await adminToken(api, 'twice.rider@mandimangoes.test', 'long-enough-qa3')
  const o = await paidOrder()
  await api.patch(`/admin/v1/orders/${o.orderId}/status`, { status: 'PROCESSING' }, { token: manager })
  await api.post(`/admin/v1/orders/${o.orderId}/allocate`, undefined, { token: manager })
  assert.equal((await api.patch(`/admin/v1/orders/${o.orderId}/status`, { status: 'PACKED' }, { token: manager })).status, 204)
  assert.equal((await api.post('/admin/v1/manifest/assign', { date: o.deliveryDate, orderIds: [o.orderId], riderId: add.body.id }, { token: manager })).status, 200)
  setNow(`${o.deliveryDate}T04:00:00Z`)
  const p1 = await stepPhoto(api, rider, o.orderId, 'pickup', { clientId: 'pick-twice-01' })
  const p2 = await stepPhoto(api, rider, o.orderId, 'pickup', { clientId: 'pick-twice-01' })
  assert.equal(p1.status, 201, JSON.stringify(p1.body))
  assert.ok(p2.status < 300, String(p2.status))
  assert.equal(p2.body.id, p1.body.id)
  const u1 = await api.post(`/admin/v1/orders/${o.orderId}/pickup`, { clientId: 'pickup-twice-1' }, { token: rider })
  const u2 = await api.post(`/admin/v1/orders/${o.orderId}/pickup`, { clientId: 'pickup-twice-1' }, { token: rider })
  assert.ok(u1.status < 300, `${u1.status} ${JSON.stringify(u1.body)}`)
  assert.ok(u2.status < 500, String(u2.status))
  assert.equal(await count('SELECT count(*)::int AS n FROM delivery_photos WHERE order_id = $1', [o.orderId]), 1)
  assert.equal(await events(o.orderId, 'OUT_FOR_DELIVERY'), 1)
  assert.equal(await notes(o.orderId, 'DELIVERY_CODE'), 1)
  assert.equal(await notes(o.orderId, 'OUT_FOR_DELIVERY'), 1)
})
