// 24 Oct 2026 audit, delivery leftovers SEC-06, PLT-06, PLT-07, PLT-08, PLT-09
// (docs/audit-2026-10-24-status-B.md), behind DELIVERY_CHECKS. Each flag-on test
// failed on the code before the fix; the flag-off tests show the rollback keeps
// the old behaviour.
import { adminToken, checkout, client, closeAll, customerToken, makeBatch, resetDb, startServer, T0 } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { addDays, setNow } from '../src/clock.js'
import { query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { rebalanceOrder } from '../src/orders.js'

let srv
let api
let manager
let rider
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
  const add = await api.post('/admin/v1/staff', { email: 'ravi@mandimangoes.test', role: 'RIDER', password: 'long-enough-1' }, { token: manager })
  assert.equal(add.status, 201, JSON.stringify(add.body))
  rider = await adminToken(api, 'ravi@mandimangoes.test', 'long-enough-1')
})
afterEach(() => {
  env.DELIVERY_CHECKS = false
})

// T0 is 10:00 IST on 15 Oct: orders placed now are for 16 Oct, tomorrow.
const TOMORROW = '2026-10-16'
const onDeliveryMorning = () => setNow('2026-10-16T01:30:00Z') // 07:00 IST on 16 Oct
const order = async (id) => (await api.get(`/admin/v1/orders/${id}`, { token: manager })).body
const move = (id, status, extra = {}) => api.patch(`/admin/v1/orders/${id}/status`, { status, ...extra }, { token: manager })
const rows = async (sql, params) => (await query(sql, params)).rows

/** A paid order, packed, with no rider yet. */
async function packedOrder(cust, qty = 1) {
  const o = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty }])
  assert.equal(o.status, 201, JSON.stringify(o.body))
  assert.equal((await api.post('/v1/dev/pay', { orderId: o.body.orderId, outcome: 'captured' })).status, 200)
  const id = o.body.orderId
  assert.equal((await move(id, 'PROCESSING')).status, 204)
  assert.equal((await api.post(`/admin/v1/orders/${id}/allocate`, undefined, { token: manager })).status, 204)
  assert.equal((await move(id, 'PACKED')).status, 204)
  assert.equal(o.body.deliveryDate, TOMORROW)
  return id
}

describe("SEC-06, PLT-07: an order goes out on its own day; a rider's run can't take tomorrow's stops", () => {
  async function threeForTomorrow() {
    await makeBatch({ age: 4, rating: 'RIPE', lines: { 'ALP-3': 10 } })
    const cust = await customerToken(api)
    return [await packedOrder(cust), await packedOrder(cust), await packedOrder(cust)]
  }

  test('with DELIVERY_CHECKS: the run for tomorrow takes nothing; on the day it takes the rest', async () => {
    env.DELIVERY_CHECKS = true
    const ids = await threeForTomorrow()
    const early = await api.post('/admin/v1/manifest/dispatch', { date: TOMORROW }, { token: rider })
    assert.equal(early.status, 200)
    assert.deepEqual(early.body.dispatched, [])
    assert.equal(early.body.skipped.length, 3)
    assert.match(early.body.skipped[0].reason, /goes out on that day/)
    for (const id of ids) {
      const [o] = await rows('SELECT status, rider_id FROM orders WHERE id = $1', [id])
      assert.deepEqual(o, { status: 'PACKED', rider_id: null }, 'not taken, not out')
    }
    const manifest = await api.get(`/admin/v1/manifest?date=${TOMORROW}`, { token: rider })
    assert.equal(manifest.body.runs.flatMap((r) => r.stops).length, 0, 'the rider sees no customer details')
    assert.equal((await rows(`SELECT 1 FROM notifications WHERE kind = 'OUT_FOR_DELIVERY'`)).length, 0)
    // A single order from the panel is refused too, unless a manager says why.
    const one = await api.post(`/admin/v1/orders/${ids[0]}/dispatch`, {}, { token: manager })
    assert.equal(one.status, 409)
    assert.equal(one.body.error.code, 'NOT_DUE_YET')
    assert.equal((await move(ids[0], 'SHIPPED')).status, 204, 'loading the van the evening before is still allowed')
    assert.equal((await move(ids[0], 'OUT_FOR_DELIVERY')).body.error.code, 'NOT_DUE_YET')
    assert.equal((await api.post(`/admin/v1/orders/${ids[0]}/dispatch`, { override: true, reason: 'Customer asked for it tonight' }, { token: manager })).status, 204)
    onDeliveryMorning()
    const run = await api.post('/admin/v1/manifest/dispatch', { date: TOMORROW }, { token: rider })
    assert.equal(run.body.dispatched.length, 2, JSON.stringify(run.body))
  })

  test('flag off: the rider takes all three a day early (the old behaviour)', async () => {
    await threeForTomorrow()
    const early = await api.post('/admin/v1/manifest/dispatch', { date: TOMORROW }, { token: rider })
    assert.equal(early.body.dispatched.length, 3)
  })
})

/** A packed order out with the rider on its day, then reported missed. */
async function missedDelivery(prepare) {
  await makeBatch({ age: 4, rating: 'RIPE', lines: { 'ALP-3': 10 } })
  const cust = await customerToken(api)
  const id = await packedOrder(cust)
  onDeliveryMorning()
  assert.equal((await api.post('/admin/v1/manifest/dispatch', { date: TOMORROW }, { token: rider })).body.dispatched.length, 1)
  await prepare()
  const attempt = (await order(id)).attempt
  const r = await api.post(`/admin/v1/orders/${id}/delivery`, { outcome: 'FAILED', reason: 'NOT_HOME', attempt }, { token: rider })
  return { id, r }
}
const failedMessage = async (id) => (await rows(`SELECT status, last_error FROM notifications WHERE order_id = $1 AND kind = 'DELIVERY_FAILED'`, [id]))[0]
const retryDecisions = async () => (await api.get('/admin/v1/attention', { token: manager })).body.retryDecisions ?? []

describe('PLT-08: a retry with no room in two weeks is not promised a full day silently', () => {
  const fullFortnight = async () => {
    for (let i = 1; i <= 16; i++) await query('INSERT INTO delivery_calendar (date, is_open, max_boxes) VALUES ($1, TRUE, 0)', [addDays(TOMORROW, i)])
  }

  test('with DELIVERY_CHECKS: the "retrying on" message is held and Needs attention lists it', async () => {
    env.DELIVERY_CHECKS = true
    const { id, r } = await missedDelivery(fullFortnight)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const o = await order(id)
    assert.equal(o.status, 'DELIVERY_FAILED')
    assert.equal(o.deliveryDate, addDays(TOMORROW, 1), 'still on the first open day, for staff to move')
    const msg = await failedMessage(id)
    assert.equal(msg.status, 'SKIPPED')
    assert.match(msg.last_error, /^retry needs a day: no day in the next two weeks has room/)
    const listed = (await retryDecisions()).find((x) => x.id === id)
    assert.equal(listed?.kind, 'day', JSON.stringify(await retryDecisions()))
    assert.match(listed.reason, /over capacity/)
  })

  test('flag off: the message promising the full day stays PENDING, and nothing lists it', async () => {
    const { id, r } = await missedDelivery(fullFortnight)
    assert.equal(r.status, 200)
    assert.equal((await failedMessage(id)).status, 'PENDING')
    assert.equal((await retryDecisions()).some((x) => x.id === id), false)
  })
})

describe('PLT-09: with no open day in 60 days the rider can still record the miss', () => {
  const closeTheSeason = async () => {
    for (let i = 1; i <= 62; i++) await query('INSERT INTO delivery_calendar (date, is_open) VALUES ($1, FALSE)', [addDays(TOMORROW, i)])
  }

  test('with DELIVERY_CHECKS: 200, the attempt is recorded, the date stays, staff are asked to pick a day', async () => {
    env.DELIVERY_CHECKS = true
    const { id, r } = await missedDelivery(closeTheSeason)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const o = await order(id)
    assert.equal(o.status, 'DELIVERY_FAILED')
    assert.equal(o.deliveryDate, TOMORROW)
    assert.equal((await rows(`SELECT 1 FROM delivery_attempts WHERE order_id = $1 AND outcome = 'FAILED'`, [id])).length, 1)
    assert.match((await failedMessage(id)).last_error, /^retry needs a day: no delivery day is open/)
    assert.equal((await retryDecisions()).find((x) => x.id === id)?.kind, 'day')
  })

  test('flag off: 409 NO_DELIVERY_DAY and the miss is lost (the old behaviour)', async () => {
    const { id, r } = await missedDelivery(closeTheSeason)
    assert.equal(r.status, 409)
    assert.equal(r.body.error.code, 'NO_DELIVERY_DAY')
    assert.equal((await order(id)).status, 'OUT_FOR_DELIVERY')
  })
})

describe('PLT-06: a replacement with no stock is not announced for a date', () => {
  async function replacementWithNoStock() {
    await makeBatch({ age: 4, rating: 'RIPE', lines: { 'ALP-3': 1 } })
    const cust = await customerToken(api)
    const id = await packedOrder(cust)
    onDeliveryMorning()
    for (const s of ['SHIPPED', 'OUT_FOR_DELIVERY']) assert.equal((await move(id, s)).status, 204, s)
    assert.equal((await move(id, 'DELIVERED', { override: true, reason: 'Customer confirmed by phone' })).status, 204)
    const claim = await api.post('/v1/claims', { orderId: id, issueType: 'DAMAGED', description: 'Box crushed in transit', itemSkus: ['ALP-3'] }, { token: cust.accessToken })
    assert.equal(claim.status, 201, JSON.stringify(claim.body))
    assert.equal((await api.post(`/admin/v1/claims/${claim.body.id}/review`, undefined, { token: manager })).status, 204)
    assert.equal((await api.post(`/admin/v1/claims/${claim.body.id}/resolve`, { resolution: 'REPLACEMENT_APPROVED' }, { token: manager })).status, 204)
    const [rep] = await rows('SELECT id, at_risk FROM orders WHERE replacement_for = $1', [id])
    assert.equal(rep.at_risk, true, 'no stock anywhere')
    return rep.id
  }
  const confirmations = async (id) => rows(`SELECT status, last_error FROM notifications WHERE order_id = $1 AND kind = 'REPLACEMENT_CONFIRMED' ORDER BY created_at, status`, [id])

  test('with DELIVERY_CHECKS: the confirmation is held, then sent once stock is found', async () => {
    env.DELIVERY_CHECKS = true
    const repId = await replacementWithNoStock()
    const [held] = await confirmations(repId)
    assert.equal(held.status, 'SKIPPED')
    assert.match(held.last_error, /^held: paid with no stock/)
    await makeBatch({ age: 4, rating: 'RIPE', lines: { 'ALP-3': 5 } })
    assert.equal((await tx((c) => rebalanceOrder(c, repId))).atRisk, false)
    const after = await confirmations(repId)
    assert.equal(after.filter((n) => n.status === 'PENDING').length, 1, JSON.stringify(after))
  })

  test('flag off: "confirmed for <date>" is queued at once (the old behaviour)', async () => {
    const repId = await replacementWithNoStock()
    assert.equal((await confirmations(repId))[0].status, 'PENDING')
  })
})

// Keeps T0 in view for readers: the dates above are relative to it.
assert.equal(T0, '2026-10-15T04:30:00Z')
