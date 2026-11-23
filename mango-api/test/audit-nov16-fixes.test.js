// The 16 November audit (builder B): messages sent when an order goes out, the pre-order
// waitlist (sent at once, strictly in order, closed at the horizon), scheduled hold expiry
// that asks Razorpay first, NUL bytes in addresses, bulk enquiry checks, the handover photo,
// rule saves that change nothing, and the pincode centre on the panel.
import {
  adminToken, allowLeaveAtDoor, checkout, client, closeAll, customerToken, makeBatch, onePreorderWeek, resetDb, startServer, stepPhoto,
} from './helpers.js'
import { currentConfig, saveConfig } from '../src/config.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { addDays, now, setNow, todayIST } from '../src/clock.js'
import { query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { dbInputErrorOf, hasNul } from '../src/http-contract.js'
import { newId } from '../src/ids.js'
import { runPreorderJobs } from '../src/maintenance.js'
import { expirePreorderHolds } from '../src/preorders.js'
import { hasOpenBusiness } from '../src/privacy.js'
import { enforceLimitsInTests } from '../src/ratelimit.js'

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

const DISPATCH_KINDS = ['DELIVERY_CODE', 'OUT_FOR_DELIVERY']
const messages = async (orderId) =>
  (await query(`SELECT kind, status FROM notifications WHERE order_id = $1 AND kind = ANY($2) ORDER BY kind`, [orderId, DISPATCH_KINDS])).rows.map((r) => [r.kind, r.status])

async function newRider() {
  const add = await api.post('/admin/v1/staff', { email: `rider.${newId('r').slice(-6).toLowerCase()}@mandimangoes.test`, role: 'RIDER', password: 'long-enough-1' }, { token: admin })
  assert.equal(add.status, 201, JSON.stringify(add.body))
  return { id: add.body.id, token: await adminToken(api, add.body.email, 'long-enough-1') }
}

/** A paid, packed order, on its delivery day (09:30 IST). */
async function packedOrder() {
  await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
  const cust = await customerToken(api)
  const o = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }])
  assert.equal(o.status, 201, JSON.stringify(o.body))
  await api.post('/v1/dev/pay', { orderId: o.body.orderId, outcome: 'captured' })
  const id = o.body.orderId
  await api.patch(`/admin/v1/orders/${id}/status`, { status: 'PROCESSING' }, { token: admin })
  assert.equal((await api.post(`/admin/v1/orders/${id}/allocate`, undefined, { token: admin })).status, 204)
  assert.equal((await api.patch(`/admin/v1/orders/${id}/status`, { status: 'PACKED' }, { token: admin })).status, 204)
  setNow(`${o.body.deliveryDate}T04:00:00Z`)
  return { id, date: o.body.deliveryDate }
}

describe('1. sending an order out sends its messages at once', () => {
  test('one order from the panel, and a whole run: the update and the code are sent, not left for the next maintenance run', async () => {
    const one = await packedOrder()
    assert.equal((await api.post(`/admin/v1/orders/${one.id}/dispatch`, undefined, { token: admin })).status, 204)
    assert.deepEqual(await messages(one.id), [['DELIVERY_CODE', 'SENT'], ['OUT_FOR_DELIVERY', 'SENT']])

    const two = await packedOrder()
    const run = await api.post('/admin/v1/manifest/dispatch', { date: two.date }, { token: admin })
    assert.equal(run.status, 200, JSON.stringify(run.body))
    assert.ok(run.body.dispatched.length >= 1)
    assert.deepEqual(await messages(two.id), [['DELIVERY_CODE', 'SENT'], ['OUT_FOR_DELIVERY', 'SENT']])
  })

  test('a repeated pickup sends whatever of its messages is still pending', async () => {
    const rider = await newRider()
    const o = await packedOrder()
    assert.equal((await api.post('/admin/v1/manifest/assign', { date: o.date, orderIds: [o.id], riderId: rider.id }, { token: admin })).status, 200)
    assert.equal((await stepPhoto(api, rider.token, o.id, 'pickup')).status, 201)
    const first = await api.post(`/admin/v1/orders/${o.id}/pickup`, {}, { token: rider.token })
    assert.equal(first.body.already, false)
    // As if the first send never happened (an instance died after the commit).
    await query(`UPDATE notifications SET status = 'PENDING', sent_at = NULL, provider_id = NULL, next_attempt_at = created_at WHERE order_id = $1 AND kind = ANY($2)`, [o.id, DISPATCH_KINDS])
    const again = await api.post(`/admin/v1/orders/${o.id}/pickup`, {}, { token: rider.token })
    assert.equal(again.status, 200, JSON.stringify(again.body))
    assert.equal(again.body.already, true)
    assert.deepEqual(again.body.messages.map((m) => [m.kind, m.status]).sort(), [['DELIVERY_CODE', 'SENT'], ['OUT_FOR_DELIVERY', 'SENT']])
    // Nothing goes twice: one of each.
    const n = await query(`SELECT COUNT(*)::int AS n FROM notifications WHERE order_id = $1 AND kind = ANY($2)`, [o.id, DISPATCH_KINDS])
    assert.equal(n.rows[0].n, 2)
  })
})

describe('2-5. the pre-order waitlist and holds', () => {
  /** The first Monday after the regular booking horizon. */
  function openWeek() {
    let d = addDays(todayIST(), 6)
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1)
    return d
  }
  const setCapacity = (week, capacity) => api.put(`/admin/v1/preorder-capacity/${week}/ALP-3`, { capacity }, { token: admin })
  const book = (token, week, extra = {}) =>
    api.post(
      '/v1/preorders',
      { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2, weekStart: week, pincode: '560034', address: '12, 4th Cross, Koramangala, Bengaluru', ...extra },
      { token, headers: { 'Idempotency-Key': newId('idem') } },
    )
  const pre = async (id) => (await query('SELECT * FROM preorders WHERE id = $1', [id])).rows[0]
  const msg = async (id, kind) => (await query('SELECT status FROM notifications WHERE preorder_id = $1 AND kind = $2', [id, kind])).rows.map((r) => r.status)
  const later = (ms) => setNow(new Date(now().getTime() + ms).toISOString())

  test('2. a spot that opens is offered and its message sent in the same run', async () => {
    const week = await onePreorderWeek(6) // one week of 6 kg, one 2 x 3 kg booking: the next one waits
    await book((await customerToken(api)).accessToken, week)
    const waiting = await book((await customerToken(api)).accessToken, week, { waitlist: true })
    assert.equal(waiting.body.status, 'WAITLISTED')
    later(11 * 60_000) // the first hold runs out (and Razorpay is asked about it in the same run)
    const jobs = await runPreorderJobs()
    assert.deepEqual([jobs.expired, jobs.promoted], [1, 1])
    assert.equal((await pre(waiting.body.id)).status, 'PAYMENT_PENDING')
    assert.deepEqual(await msg(waiting.body.id, 'PREORDER_SPOT_OPEN'), ['SENT'])
  })

  test('5. strictly in booking order: a later, smaller booking does not jump an earlier one that does not fit', async () => {
    // One week of 6 kg (migration 076: a booking takes its kg, boxes x 3 kg here).
    const week = await onePreorderWeek(6)
    await book((await customerToken(api)).accessToken, week)
    const big = await book((await customerToken(api)).accessToken, week, { waitlist: true, qty: 2 })
    later(1000)
    const small = await book((await customerToken(api)).accessToken, week, { waitlist: true, qty: 1 })
    assert.deepEqual([big.body.status, small.body.status], ['WAITLISTED', 'WAITLISTED'])

    // 3 kg opens (the week raised to 9 kg): it fits the later 3 kg booking only, so nobody moves.
    await saveConfig({ ...currentConfig().rules, preorderDayKg: 9 / 7, preorderOtherVarietyDayKg: 9 / 7 }, 'test')
    await runPreorderJobs()
    assert.deepEqual([(await pre(big.body.id)).status, (await pre(small.body.id)).status], ['WAITLISTED', 'WAITLISTED'])
    // 6 kg (12 kg a week): the earlier booking goes first; the later one waits for the next 3 kg.
    await saveConfig({ ...currentConfig().rules, preorderDayKg: 12 / 7, preorderOtherVarietyDayKg: 12 / 7 }, 'test')
    await runPreorderJobs()
    assert.deepEqual([(await pre(big.body.id)).status, (await pre(small.body.id)).status], ['PAYMENT_PENDING', 'WAITLISTED'])
    assert.deepEqual(await msg(big.body.id, 'PREORDER_SPOT_OPEN'), ['SENT'])
    await saveConfig({ ...currentConfig().rules, preorderDayKg: 15 / 7, preorderOtherVarietyDayKg: 15 / 7 }, 'test')
    await runPreorderJobs()
    assert.equal((await pre(small.body.id)).status, 'PAYMENT_PENDING')
  })

  test('3. a waitlist closes when its week reaches the horizon: cancelled, told, and no longer open business', async () => {
    const week = await onePreorderWeek(6)
    await book((await customerToken(api)).accessToken, week)
    const waiting = await book((await customerToken(api)).accessToken, week, { waitlist: true })
    const customerId = (await pre(waiting.body.id)).customer_id
    assert.equal(await hasOpenBusiness({ query }, customerId), true)
    // The week opens to regular orders: no spot can open on its waitlist any more.
    setNow(`${week}T04:30:00Z`)
    assert.equal(await hasOpenBusiness({ query }, customerId), false, 'a dead waitlist does not block deleting the account')
    const jobs = await runPreorderJobs()
    assert.equal(jobs.waitlistClosed, 1)
    const p = await pre(waiting.body.id)
    assert.equal(p.status, 'CANCELLED')
    assert.deepEqual(await msg(p.id, 'CANCELLED'), ['SENT'])
    const ev = await query(`SELECT reason FROM preorder_events WHERE preorder_id = $1 AND status = 'CANCELLED'`, [p.id])
    assert.deepEqual(ev.rows.map((r) => r.reason), ['No spot opened on the waitlist for this week'])
    assert.equal((await runPreorderJobs()).waitlistClosed, 0)
  })

  test('4. the scheduled hold expiry waits for Razorpay to be asked after the hold, or 2 minutes past it', async () => {
    const week = openWeek()
    await setCapacity(week, 4)
    const a = await book((await customerToken(api)).accessToken, week)
    const b = await book((await customerToken(api)).accessToken, week)
    const holdEnds = (await pre(a.body.id)).hold_expires_at
    // Razorpay was last asked before the hold ended.
    await query('UPDATE preorders SET reconcile_checked_at = $2 WHERE id = ANY($1)', [[a.body.id, b.body.id], now()])
    setNow(new Date(holdEnds.getTime() + 60_000).toISOString())
    assert.equal(await tx((c) => expirePreorderHolds(c)), 0)
    assert.equal((await pre(a.body.id)).status, 'PAYMENT_PENDING')
    // Asked again after the hold (nothing paid): b may go now.
    await query('UPDATE preorders SET reconcile_checked_at = $2 WHERE id = $1', [b.body.id, now()])
    assert.equal(await tx((c) => expirePreorderHolds(c)), 1)
    assert.equal((await pre(b.body.id)).status, 'CANCELLED')
    // Two minutes past the hold, a goes too.
    setNow(new Date(holdEnds.getTime() + 2 * 60_000 + 1000).toISOString())
    assert.equal(await tx((c) => expirePreorderHolds(c)), 1)
    assert.equal((await pre(a.body.id)).status, 'CANCELLED')
  })
})

describe('7. a NUL byte in the address', () => {
  test('is refused with 400 before any route, not a 500', async () => {
    const cust = await customerToken(api)
    for (const [path, token] of [
      ['/v1/bulk-deals/%00', null], ['/v1/review-photos/%00', null], ['/v1/orders/%00', cust.accessToken],
      ['/v1/products?q=%00', null], ['/admin/v1/orders/abc%00def', admin],
    ]) {
      const r = await api.get(path, token ? { token } : {})
      assert.deepEqual([r.status, r.body.error?.code], [400, 'VALIDATION_ERROR'], path)
    }
    // A "%00" that is really "%2500" (an escaped percent sign) is not a NUL.
    assert.equal(hasNul('/v1/orders/%2500'), false)
    assert.equal(hasNul('/v1/orders/x?y=%00'), true)
  })

  test('Postgres refusing a value (22021, 22P02) is the client’s mistake: 400', () => {
    assert.equal(dbInputErrorOf({ code: '22021' }).status, 400)
    assert.equal(dbInputErrorOf({ code: '22P02' }).status, 400)
    assert.equal(dbInputErrorOf({ code: '23505' }), null)
    assert.equal(dbInputErrorOf(new Error('boom')), null)
  })
})

describe('9. bulk enquiries', () => {
  const FLAGS = ['BULK_ENQUIRIES', 'WHATSAPP_BULK_UPDATES', 'BULK_ENQUIRY_DAILY_LIMIT']
  const saved = Object.fromEntries(FLAGS.map((k) => [k, env[k]]))
  beforeEach(() => Object.assign(env, { BULK_ENQUIRIES: true, WHATSAPP_BULK_UPDATES: true, BULK_ENQUIRY_DAILY_LIMIT: 5 }))
  afterEach(() => {
    Object.assign(env, saved)
    enforceLimitsInTests(false)
  })
  // An enquiry from 250 kg (bulk orders are placed signed in and paid: test/bulk-orders.test.js).
  const FORM = { name: 'Asha Rao', phone: '98765 43210', city: 'Bengaluru', lines: [{ sku: 'ALP-5', stage: 'SEMI_RIPE', boxes: 50 }] }
  const send = (body, key = newId('idem'), opts = {}) => api.post('/v1/bulk-enquiries', body, { headers: { 'Idempotency-Key': key }, ...opts })

  test('a quote valid until a day already past is refused', async () => {
    const e = (await send(FORM)).body
    const quote = (validUntil) => api.post(`/admin/v1/bulk-enquiries/${e.id}/quote`, { lines: [{ label: 'Alphonso', qty: 10, unitPrice: 100_000 }], validUntil }, { token: admin })
    const past = await quote(addDays(todayIST(), -1))
    assert.deepEqual([past.status, past.body.error.code], [400, 'VALID_UNTIL_PAST'])
    assert.equal((await quote(todayIST())).status, 201)
  })

  test('the Idempotency-Key is the sender’s own, and refuses a different body', async () => {
    const key = newId('idem')
    const first = await send(FORM, key)
    assert.equal(first.status, 201, JSON.stringify(first.body))
    const again = await send(FORM, key)
    assert.deepEqual([again.status, again.body.id], [200, first.body.id])
    const changed = await send({ ...FORM, lines: [{ sku: 'ALP-5', stage: 'SEMI_RIPE', boxes: 180 }] }, key)
    assert.deepEqual([changed.status, changed.body.error.code], [422, 'IDEMPOTENCY_KEY_REUSED'])
    // Someone else with the same key gets their own enquiry, never the first one.
    const other = await send({ ...FORM, phone: '9822222222' }, key)
    assert.equal(other.status, 201)
    assert.notEqual(other.body.id, first.body.id)
    const signedIn = await send(FORM, key, { token: (await customerToken(api, '9876543210')).accessToken })
    assert.equal(signedIn.status, 201)
    assert.notEqual(signedIn.body.id, first.body.id)
    const hash = await query(`SELECT request_hash FROM idempotency_keys WHERE order_id = $1`, [first.body.id])
    assert.match(hash.rows[0].request_hash, /^[0-9a-f]{64}$/)
  })

  test('only accepted enquiries count towards the hourly limit', async () => {
    enforceLimitsInTests(true)
    // Refused forms (a bad phone, a box we don't sell) don't use up the hour.
    for (let i = 0; i < 6; i++) assert.equal((await send({ ...FORM, phone: '12345' })).status, 400)
    for (let i = 0; i < 6; i++) {
      assert.equal((await send({ ...FORM, lines: [{ sku: 'NOPE', stage: 'RAW', boxes: 50 }] })).status, 400)
      await new Promise((r) => setTimeout(r, 30)) // the count is taken back once the answer is sent
    }
    const phones = Array.from({ length: 10 }, (_, i) => `98000000${String(i).padStart(2, '0')}`)
    for (const phone of phones) assert.equal((await send({ ...FORM, phone })).status, 201, phone)
    const over = await send({ ...FORM, phone: '9811111111' })
    assert.deepEqual([over.status, over.body.error.code], [429, 'RATE_LIMITED'])
  })

  test('7. a NUL inside the form reaches Postgres (22021) and is answered 400, not 500', async () => {
    const r = await send({ ...FORM, name: 'Asha\u0000Rao' })
    assert.deepEqual([r.status, r.body.error?.code], [400, 'VALIDATION_ERROR'])
  })

  test('a bulk box (packKg) is made from a 5 kg box', async () => {
    const three = await send({ ...FORM, quantityKg: undefined, lines: [{ sku: 'ALP-3', stage: 'RAW', boxes: 20, packKg: 10 }] })
    assert.deepEqual([three.status, three.body.error.code], [400, 'BULK_BOX_SIZE'])
    assert.equal((await send({ ...FORM, quantityKg: undefined, lines: [{ sku: 'ALP-5', stage: 'RAW', boxes: 25, packKg: 10 }] })).status, 201)
  })
})

describe('10. the handover photo', () => {
  test('must be taken at the door on this attempt: not the pickup photo, not one from an earlier attempt', async () => {
    const rider = await newRider()
    const o = await packedOrder()
    assert.equal((await api.post('/admin/v1/manifest/assign', { date: o.date, orderIds: [o.id], riderId: rider.id }, { token: admin })).status, 200)
    const pick = await stepPhoto(api, rider.token, o.id, 'pickup')
    assert.equal((await api.post(`/admin/v1/orders/${o.id}/pickup`, {}, { token: rider.token })).status, 200)
    const oldDoor = await stepPhoto(api, rider.token, o.id, 'door')
    assert.equal(oldDoor.status, 201)
    await allowLeaveAtDoor(api, admin, o.id)
    const deliver = (photoId) => api.post(`/admin/v1/orders/${o.id}/delivery`, { outcome: 'DELIVERED', photoId, receivedBy: 'Security guard' }, { token: rider.token })

    assert.deepEqual([(await deliver(pick.body.id)).body.error?.code], ['PHOTO_NOT_CURRENT'])
    // The box came back once and is out again: the earlier attempt's door photo no longer counts.
    await query('UPDATE orders SET delivery_failures = 1 WHERE id = $1', [o.id])
    assert.deepEqual([(await deliver(oldDoor.body.id)).body.error?.code], ['PHOTO_NOT_CURRENT'])
    const door = await stepPhoto(api, rider.token, o.id, 'door')
    const ok = await deliver(door.body.id)
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.deepEqual(ok.body, { outcome: 'DELIVERED', method: 'photo' })
  })
})

describe('11. saving the rules', () => {
  test('without rules is refused, and the same rules again is "nothing changed"', async () => {
    const cfg = (await api.get('/admin/v1/config', { token: admin })).body
    const empty = await api.put('/admin/v1/config', { confirmCode: 'manager123' }, { token: admin })
    assert.deepEqual([empty.status, empty.body.error.code], [400, 'RULES_REQUIRED'])
    assert.equal((await api.put('/admin/v1/config', {}, { token: admin })).status, 400)
    const same = await api.put('/admin/v1/config', { rules: cfg.rules, confirmCode: 'manager123' }, { token: admin })
    assert.deepEqual([same.status, same.body.error.code], [409, 'NOTHING_CHANGED'])
    assert.match(same.body.error.message, /Nothing changed/)
    // The same rules with the keys in another order are still the same.
    const reordered = Object.fromEntries(Object.entries(cfg.rules).reverse())
    assert.equal((await api.put('/admin/v1/config', { rules: reordered, confirmCode: 'manager123' }, { token: admin })).status, 409)
    assert.equal((await api.get('/admin/v1/config', { token: admin })).body.version, cfg.version)
    const changed = await api.put('/admin/v1/config', { rules: { ...cfg.rules, holdMinutes: cfg.rules.holdMinutes + 1 }, confirmCode: 'manager123' }, { token: admin })
    assert.equal(changed.status, 200, JSON.stringify(changed.body))
    assert.equal(changed.body.version, cfg.version + 1)
  })
})

describe('6. the pincode centre on the panel', () => {
  test('is taken on create and edit, both or neither, inside India, and shown in the list', async () => {
    const add = (body) => api.post('/admin/v1/pincodes', { pincode: '560099', city: 'Bengaluru', ...body }, { token: admin })
    assert.equal((await add({ lat: 12.9 })).status, 400)
    // Swapped (77.6 is no Indian latitude).
    assert.equal((await add({ lat: 77.6271, lng: 12.9279 })).status, 400)
    assert.equal((await add({ lat: '12.9', lng: '77.6' })).status, 400)
    const made = await add({ lat: 12.9279, lng: 77.6271 })
    assert.equal(made.status, 201, JSON.stringify(made.body))
    assert.deepEqual([made.body.lat, made.body.lng], [12.9279, 77.6271])
    // Adding it again without a centre keeps the centre.
    assert.deepEqual([(await add({})).body.lat], [12.9279])
    assert.equal((await api.patch('/admin/v1/pincodes/560099', { lng: 77.7 }, { token: admin })).status, 400)
    const moved = await api.patch('/admin/v1/pincodes/560099', { lat: 13.01, lng: 77.7 }, { token: admin })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    const list = (await api.get('/admin/v1/pincodes', { token: admin })).body
    assert.deepEqual(list.find((p) => p.pincode === '560099'), { pincode: '560099', city: 'Bengaluru', zone: null, active: true, lat: 13.01, lng: 77.7 })
    // A pincode without one says so (null), for the page's warning.
    await query(`UPDATE pincodes SET lat = NULL, lng = NULL WHERE pincode = '560034'`)
    const bare = (await api.get('/admin/v1/pincodes', { token: admin })).body.find((p) => p.pincode === '560034')
    assert.deepEqual([bare.lat, bare.lng], [null, null])
  })
})
