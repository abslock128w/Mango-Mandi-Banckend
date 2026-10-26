// 24 Oct 2026 audit, inventory leftovers (docs/audit-2026-10-24-status-A.md).
// Each test failed on the code before its fix; the flag-off tests show the
// rollback keeps the old behaviour.
import { adminToken, checkout, client, closeAll, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { handleInbound } from '../src/chat.js'
import { addDays, now, setNow, todayIST } from '../src/clock.js'
import { query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'
import { auditLedger } from '../src/inventory.js'
import { runAudit } from '../src/maintenance.js'
import { createReplacement, rebalanceOrder, SYSTEM } from '../src/orders.js'
import { allocatePreorders, promoteWaitlist } from '../src/preorders.js'
import { preorderCapacityDrift } from '../src/stock-watch.js'

let srv
let api
let manager
let seq = 0
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
})
afterEach(() => {
  env.ORDER_RULE_CHECKS = false
  env.STOCK_INTAKE_CHECKS = false
})

const MIN = 60_000
const later = (ms) => setNow(new Date(now().getTime() + ms).toISOString())
const pay = (orderId) => api.post('/v1/dev/pay', { orderId, outcome: 'captured' })
const noDrift = async () => assert.deepEqual(await tx((c) => auditLedger(c)), [])
const shown = async (date, sku = 'ALP-3', stage = 'RIPE') =>
  (await api.get(`/v1/catalogue?pincode=560034&delivery_date=${date}`)).body.items.find((i) => i.sku === sku && i.stage === stage)?.qty ?? 0
const slotBoxes = async (date, slotId) =>
  (
    await query(
      `SELECT COALESCE(SUM(i.quantity), 0)::int AS n FROM orders o JOIN order_items i ON i.order_id = o.id
        WHERE o.delivery_date = $1 AND o.slot_id = $2 AND o.status NOT IN ('CANCELLED', 'RTO')`,
      [date, slotId],
    )
  ).rows[0].n

describe('INV-01: a reschedule never overfills a delivery slot', () => {
  /** One slot of 1 box; order A on 10-16 and order B on 10-17 fill it on both days. */
  async function fullSlot() {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    const morning = (await api.post('/admin/v1/slots', { label: 'Morning', startsAt: '07:00', endsAt: '11:00', maxBoxes: 1, sort: 1 }, { token: manager })).body
    const a = await customerToken(api)
    const oa = await checkout(api, a.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }], { deliveryDate: '2026-10-16', slotId: morning.id })
    assert.equal(oa.status, 201, JSON.stringify(oa.body))
    await pay(oa.body.orderId)
    const b = await customerToken(api)
    const ob = await checkout(api, b.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }], { deliveryDate: '2026-10-17', slotId: morning.id })
    assert.equal(ob.status, 201, JSON.stringify(ob.body))
    await pay(ob.body.orderId)
    return { morning, a, orderA: oa.body.orderId }
  }

  test('with ORDER_RULE_CHECKS the customer gets 409 SLOT_FULL and nothing moves', async () => {
    env.ORDER_RULE_CHECKS = true
    const { morning, a, orderA } = await fullSlot()
    const r = await api.post(`/v1/orders/${orderA}/reschedule`, { deliveryDate: '2026-10-17' }, { token: a.accessToken })
    assert.equal(r.status, 409, JSON.stringify(r.body))
    assert.equal(r.body.error.code, 'SLOT_FULL')
    assert.equal(await slotBoxes('2026-10-17', morning.id), 1)
    assert.equal((await query('SELECT delivery_date FROM orders WHERE id = $1', [orderA])).rows[0].delivery_date, '2026-10-16')
    await noDrift()
  })

  test('with ORDER_RULE_CHECKS staff reschedules and the bulk move do not overfill either', async () => {
    env.ORDER_RULE_CHECKS = true
    const { morning, orderA } = await fullSlot()
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    const r = await api.post(`/admin/v1/orders/${orderA}/reschedule`, { deliveryDate: '2026-10-17' }, { token: ops })
    assert.equal(r.status, 409, JSON.stringify(r.body))
    assert.equal(r.body.error.code, 'SLOT_FULL')
    const bulk = await api.post('/admin/v1/orders/bulk-reschedule', { fromDate: '2026-10-16', toDate: '2026-10-17', reason: 'rain' }, { token: manager })
    assert.equal(bulk.status, 200, JSON.stringify(bulk.body))
    assert.equal(await slotBoxes('2026-10-17', morning.id), 1, JSON.stringify(bulk.body))
    assert.ok(!bulk.body.moved.some((m) => m.deliveryDate === '2026-10-17'), JSON.stringify(bulk.body))
    await noDrift()
  })

  test('with the flag off the slot is overfilled as before (rollback)', async () => {
    const { morning, a, orderA } = await fullSlot()
    const r = await api.post(`/v1/orders/${orderA}/reschedule`, { deliveryDate: '2026-10-17' }, { token: a.accessToken })
    assert.equal(r.status, 204, JSON.stringify(r.body))
    assert.equal(await slotBoxes('2026-10-17', morning.id), 2)
  })
})

describe('INV-02: batch intake', () => {
  const intake = (token, body, key) => api.post('/admin/v1/batches', body, { token, headers: key ? { 'Idempotency-Key': key } : {} })
  const body = (onHand = 50) => ({ variety: 'Alphonso', pluckedOn: addDays(todayIST(), -1), farm: 'Audit farm', lines: [{ sku: 'ALP-3', onHand }] })
  const batches = async () => (await query(`SELECT COUNT(*)::int AS n FROM batches WHERE farm = 'Audit farm'`)).rows[0].n

  test('with STOCK_INTAKE_CHECKS the same intake sent twice at once makes one batch', async () => {
    env.STOCK_INTAKE_CHECKS = true
    const key = newId('key')
    const rs = await Promise.all([intake(manager, body(), key), intake(manager, body(), key)])
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 201], JSON.stringify(rs.map((r) => r.body)))
    assert.equal(rs[0].body.id, rs[1].body.id)
    assert.equal(await batches(), 1)
    // The same key with other details is refused; a new key is a new batch.
    const other = await intake(manager, body(60), key)
    assert.equal(other.status, 422, JSON.stringify(other.body))
    assert.equal((await intake(manager, body(), newId('key'))).status, 201)
    assert.equal(await batches(), 2)
    await noDrift()
  })

  test('with STOCK_INTAKE_CHECKS a non-manager needs a manager for a very large intake', async () => {
    env.STOCK_INTAKE_CHECKS = true
    const qc = await adminToken(api, 'qc@mandimangoes.test', 'qc123')
    const big = await intake(qc, body(5000), newId('key'))
    assert.equal(big.status, 403, JSON.stringify(big.body))
    assert.equal(big.body.error.code, 'MANAGER_APPROVAL_NEEDED')
    assert.equal(await batches(), 0)
    assert.equal((await intake(qc, body(env.BATCH_INTAKE_MANAGER_BOXES), newId('key'))).status, 201, 'up to the limit is fine')
    assert.equal((await intake(manager, body(5000), newId('key'))).status, 201, 'a manager may')
  })

  test('with the flag off both are accepted as before (rollback)', async () => {
    const key = newId('key')
    const rs = await Promise.all([intake(manager, body(), key), intake(manager, body(), key)])
    assert.deepEqual(rs.map((r) => r.status), [201, 201])
    assert.equal(await batches(), 2)
    const qc = await adminToken(api, 'qc@mandimangoes.test', 'qc123')
    assert.equal((await intake(qc, body(5000))).status, 201)
  })
})

describe('INV-04: expired holds during the gateway grace', () => {
  test('stock the catalogue shows as free can be bought, during and after the grace', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 1 } })
    const a = await customerToken(api)
    const oa = await checkout(api, a.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
    assert.equal(oa.status, 201)
    assert.ok(oa.body.razorpayOrderId)
    // Hold ran out a minute ago: the webhook may still be on its way, so the box is not offered.
    later(11 * MIN)
    assert.equal(await shown('2026-10-16'), 0)
    const b = await customerToken(api)
    const early = await checkout(api, b.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }], { deliveryDate: '2026-10-16' })
    assert.equal(early.status, 409)
    // After the 2-minute grace the catalogue offers it and the checkout gets it.
    later(2 * MIN)
    assert.equal(await shown('2026-10-16'), 1)
    const c = await customerToken(api)
    const ok = await checkout(api, c.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }], { deliveryDate: '2026-10-16' })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    await noDrift()
  })
})

describe('INV-06: preorder capacity audit', () => {
  function farWeek() {
    let d = addDays(todayIST(), 20)
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1)
    return d
  }
  const book = (token, week, extra = {}) =>
    api.post(
      '/v1/preorders',
      { sku: 'ALP-3', stage: 'RIPE', qty: 2, weekStart: week, pincode: '560034', address: '12, 4th Cross, Koramangala, Bengaluru', ...extra },
      { token, headers: { 'Idempotency-Key': newId('idem') } },
    )

  test('the counters balance through booking, waitlist, cancel and promotion; drift is reported and listed', async () => {
    const week = farWeek()
    assert.equal((await api.put(`/admin/v1/preorder-capacity/${week}/ALP-3`, { capacity: 2 }, { token: manager })).status, 200)
    const a = await customerToken(api)
    const held = (await book(a.accessToken, week)).body
    const b = await customerToken(api)
    assert.equal((await book(b.accessToken, week, { waitlist: true })).body.status, 'WAITLISTED')
    assert.deepEqual(await preorderCapacityDrift({ query }), [])
    assert.equal((await api.post(`/v1/preorders/${held.id}/cancel`, {}, { token: a.accessToken })).status, 204)
    assert.equal(await promoteWaitlist(), 1)
    await allocatePreorders()
    assert.deepEqual(await preorderCapacityDrift({ query }), [])
    // A counter that drifted (here by hand) is found by the hourly audit and listed in Needs attention.
    await query('UPDATE preorder_capacity SET reserved = 0 WHERE sku = $1 AND week_start = $2', ['ALP-3', week])
    assert.deepEqual(await preorderCapacityDrift({ query }), [{ sku: 'ALP-3', weekStart: week, reserved: 0, booked: 2 }])
    await runAudit()
    assert.equal((await query(`SELECT 1 FROM maintenance_runs WHERE step = 'alert-preorder-capacity'`)).rowCount, 1)
    const att = await api.get('/admin/v1/attention', { token: manager })
    assert.deepEqual(att.body.preorderCapacityDrift, [{ sku: 'ALP-3', weekStart: week, reserved: 0, booked: 2 }])
  })

  test('a manager recounts a drifted week from its bookings; the freed spots go to the waitlist; stale numbers and other roles are refused', async () => {
    const week = farWeek()
    assert.equal((await api.put(`/admin/v1/preorder-capacity/${week}/ALP-3`, { capacity: 4 }, { token: manager })).status, 200)
    const a = await customerToken(api)
    assert.equal((await book(a.accessToken, week)).status, 201)
    // Drifted up: the week looks full (4 of 4 taken) though bookings hold 2, so the next customer is waitlisted.
    await query('UPDATE preorder_capacity SET reserved = 4 WHERE sku = $1 AND week_start = $2', ['ALP-3', week])
    const c = await customerToken(api)
    const waiting = await book(c.accessToken, week, { waitlist: true })
    assert.equal(waiting.body.status, 'WAITLISTED', JSON.stringify(waiting.body))
    const recount = (body, token = manager) => api.post(`/admin/v1/preorder-capacity/${week}/ALP-3/recount`, body, { token })
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    assert.equal((await recount({ reserved: 4, booked: 2, reason: 'counter drifted' }, ops)).status, 403)
    const stale = await recount({ reserved: 3, booked: 2, reason: 'counter drifted' })
    assert.equal(stale.status, 409, JSON.stringify(stale.body))
    assert.equal(stale.body.error.code, 'PREVIEW_CHANGED')
    const r = await recount({ reserved: 4, booked: 2, reason: 'counter drifted' })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual([r.body.recounted, r.body.before, r.body.reserved], [true, 4, 2])
    // The spots it freed went to the waitlisted customer, and the counter still balances.
    assert.equal((await query('SELECT status FROM preorders WHERE id = $1', [waiting.body.id])).rows[0].status, 'PAYMENT_PENDING')
    assert.deepEqual(await preorderCapacityDrift({ query }), [])
    const audit = (await query(`SELECT detail FROM staff_audit WHERE action = 'POST /preorder-capacity/:weekStart/:sku/recount'`)).rows
    assert.deepEqual(audit.map((x) => x.detail), [{ reason: 'counter drifted', before: 4, after: 2 }])
    // Again: nothing to do, nothing written.
    const again = await recount({ reserved: 4, booked: 4, reason: 'counter drifted' })
    assert.deepEqual([again.status, again.body.recounted], [200, false])
    assert.equal((await recount({ reserved: 0, booked: 0, reason: 'x' })).status, 400, 'a reason of 3 characters or more')
  })
})

describe('INV-07: cancelling a free replacement', () => {
  async function replacement() {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    const cust = await customerToken(api)
    const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
    await pay(c.body.orderId)
    const original = (await query('SELECT * FROM orders WHERE id = $1', [c.body.orderId])).rows[0]
    return tx((cl) => createReplacement(cl, { affected_items: null }, original, SYSTEM))
  }
  const cancel = (id, token) => api.post(`/admin/v1/orders/${id}/cancel`, { reason: 'customer asked' }, { token })

  test('with ORDER_RULE_CHECKS only a manager can cancel it', async () => {
    env.ORDER_RULE_CHECKS = true
    const r = await replacement()
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    // The order page is told, so the panel offers the cancel to a manager only.
    assert.equal((await api.get(`/admin/v1/orders/${r.id}`, { token: ops })).body.cancelNeedsManager, true)
    const refused = await cancel(r.id, ops)
    assert.equal(refused.status, 403, JSON.stringify(refused.body))
    assert.equal((await query('SELECT status FROM orders WHERE id = $1', [r.id])).rows[0].status, 'CONFIRMED')
    assert.equal((await cancel(r.id, manager)).status, 204)
    await noDrift()
  })

  test('with the flag off an operator can, as before (rollback)', async () => {
    const r = await replacement()
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    assert.equal((await api.get(`/admin/v1/orders/${r.id}`, { token: ops })).body.cancelNeedsManager, false)
    assert.equal((await cancel(r.id, ops)).status, 204)
  })
})

describe('INV-08: stock still in transit after its arrival date', () => {
  test('with STOCK_INTAKE_CHECKS it stops selling to new orders, keeps what it promised, and is listed', async () => {
    // Plucked 5 days ago, due 3 days ago, still in transit. No QC yet (it hasn't arrived).
    const batchId = await makeBatch({ age: 5, status: 'IN_TRANSIT', rating: null, lines: { 'ALP-3': 10 } })
    const before = (await api.get('/v1/catalogue?pincode=560034&delivery_date=2026-10-16')).body.items.filter((i) => i.sku === 'ALP-3')
    const stage = before.find((i) => i.qty > 0)?.stage
    assert.ok(stage, 'sold ahead of arrival while the flag is off')
    const cust = await customerToken(api)
    const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage, qty: 1 }], { deliveryDate: '2026-10-16' })
    assert.equal(c.status, 201, JSON.stringify(c.body))
    await pay(c.body.orderId)

    env.STOCK_INTAKE_CHECKS = true
    assert.equal(await shown('2026-10-16', 'ALP-3', stage), 0)
    const late = await customerToken(api)
    const refused = await checkout(api, late.accessToken, [{ sku: 'ALP-3', stage, qty: 1 }], { deliveryDate: '2026-10-16' })
    assert.notEqual(refused.status, 201)
    const r = await tx((cl) => rebalanceOrder(cl, c.body.orderId, SYSTEM))
    assert.equal(r.atRisk, false, 'the paid order keeps its boxes')
    const att = await api.get('/admin/v1/attention', { token: manager })
    assert.deepEqual(
      att.body.lateArrivals.map((b) => [b.id, b.promised, b.sellingPaused]),
      [[batchId, 1, true]],
    )
    // Marked arrived (and QC'd), it sells again.
    assert.equal((await api.patch(`/admin/v1/batches/${batchId}/status`, { status: 'ARRIVED' }, { token: manager })).status, 204)
    assert.equal((await api.post(`/admin/v1/batches/${batchId}/qc`, { ripenessRating: 'SEMI_RIPE', condition: 'GOOD' }, { token: manager })).status, 201)
    assert.ok((await api.get('/admin/v1/attention', { token: manager })).body.lateArrivals.length === 0)
    await noDrift()
  })
})

describe('INV-10: a chat order re-checks its pincode', () => {
  test('with ORDER_RULE_CHECKS a pincode switched off mid-chat books nothing', async () => {
    env.ORDER_RULE_CHECKS = true
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    const waId = '919800022233'
    const say = (input) =>
      handleInbound({ waId, name: 'Asha', messageId: `wamid.audinv.${++seq}`, input: typeof input === 'string' ? { text: input } : input }, { send: async () => {} })
    await say('hi')
    await say({ id: 'ORDER' })
    await say('560034')
    await say({ id: 'item:ALP-3|RIPE' })
    await say({ id: 'qty:1' })
    await say({ id: 'CHECKOUT' })
    await say('12, 4th Cross, Koramangala, Bengaluru')
    await query(`UPDATE pincodes SET active = FALSE WHERE pincode = '560034'`)
    const replies = await say({ id: 'PAY' })
    assert.ok(replies.some((r) => /no longer deliver to 560034/.test(r.text ?? '')), JSON.stringify(replies))
    assert.equal((await query(`SELECT COUNT(*)::int AS n FROM orders WHERE phone = '+919800022233'`)).rows[0].n, 0)
  })
})
