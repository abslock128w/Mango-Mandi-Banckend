// Rider app (docs/rider-app/README.md): pickup with a photo, step photos with GPS,
// the mango check, hashed delivery codes with a 3-try lock, the delivery code in its
// own WhatsApp message, rider sign-in by phone and PIN, the panel's live view,
// rider positions and the 90-day photo purge.
import {
  adminToken, allowLeaveAtDoor, checkout, client, closeAll, customerToken, doorProof, makeBatch, resetDb, startServer, stepJpeg, stepPhoto,
} from './helpers.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { now, setNow } from '../src/clock.js'
import { query } from '../src/db.js'
import { codeMatches, deliveryCodeHash, deriveCode, newDeliveryCode } from '../src/delivery-code.js'
import { env } from '../src/env.js'
import { cleanVerdict, decide, MIN_CONFIDENCE, runCheck, useMangoModel, verdictPasses } from '../src/mango-check.js'
import { orderLinkFor, paramsFor, sendDueNotifications, templateFor } from '../src/notify.js'
import { purgeOldDeliveryPhotos } from '../src/retention.js'

let srv
let api
let admin
let rider
let riderId

before(async () => {
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  useMangoModel(null)
  await srv.close()
  await closeAll()
})
beforeEach(async () => {
  useMangoModel(null)
  delete env.MANGO_CHECK
  await resetDb()
  admin = await adminToken(api)
  const add = await api.post('/admin/v1/staff', { email: 'ravi@mandimangoes.test', role: 'RIDER', password: 'long-enough-1' }, { token: admin })
  assert.equal(add.status, 201, JSON.stringify(add.body))
  riderId = add.body.id
  const named = await api.patch(`/admin/v1/staff/${riderId}`, { phone: '9000000011', displayName: 'Ravi Kumar' }, { token: admin })
  assert.equal(named.status, 200, JSON.stringify(named.body))
  assert.equal(named.body.phone, '+919000000011')
  rider = await adminToken(api, 'ravi@mandimangoes.test', 'long-enough-1')
})

/** A paid, packed order for the rider, on its delivery day (9:30 IST). */
async function packedOrder({ assign = true } = {}) {
  await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
  const cust = await customerToken(api)
  const o = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
  assert.equal(o.status, 201, JSON.stringify(o.body))
  await api.post('/v1/dev/pay', { orderId: o.body.orderId, outcome: 'captured' })
  const id = o.body.orderId
  await api.patch(`/admin/v1/orders/${id}/status`, { status: 'PROCESSING' }, { token: admin })
  assert.equal((await api.post(`/admin/v1/orders/${id}/allocate`, undefined, { token: admin })).status, 204)
  assert.equal((await api.patch(`/admin/v1/orders/${id}/status`, { status: 'PACKED' }, { token: admin })).status, 204)
  if (assign) assert.equal((await api.post('/admin/v1/manifest/assign', { date: o.body.deliveryDate, orderIds: [id], riderId }, { token: admin })).status, 200)
  setNow(`${o.body.deliveryDate}T04:00:00Z`)
  return { id, date: o.body.deliveryDate, cust }
}
const pickup = (id, token = rider) => api.post(`/admin/v1/orders/${id}/pickup`, { clientId: 'pickup-1234' }, { token })
const deliver = (id, body) => api.post(`/admin/v1/orders/${id}/delivery`, body, { token: rider })
const mine = (cust, id) => api.get(`/v1/orders/${id}`, { token: cust.accessToken })

describe('pickup', () => {
  test('needs today\'s pickup photo, sends the order out, sends both WhatsApp messages at once, and is idempotent', async () => {
    const { id, date, cust } = await packedOrder()
    assert.equal((await pickup(id)).body.error.code, 'PICKUP_PHOTO_REQUIRED')
    // A door photo before pickup is refused: steps go in order.
    assert.equal((await stepPhoto(api, rider, id, 'door')).body.error.code, 'INVALID_TRANSITION')

    const photo = await stepPhoto(api, rider, id, 'pickup', { clientId: 'pick-abcdefgh', headers: { 'X-Lat': '12.935201', 'X-Lng': '77.624511', 'X-Accuracy': '8', 'X-Taken-At': String(now().getTime()) } })
    assert.equal(photo.status, 201, JSON.stringify(photo.body))
    // The same client id again is the same photo (a resend after a lost answer).
    const again = await stepPhoto(api, rider, id, 'pickup', { clientId: 'pick-abcdefgh' })
    assert.deepEqual([again.status, again.body.id, again.body.duplicate], [200, photo.body.id, true])
    const row = (await query('SELECT step, lat, lng, accuracy, taken_at, attempt FROM delivery_photos WHERE id = $1', [photo.body.id])).rows[0]
    assert.deepEqual([row.step, Number(row.lat), Number(row.lng), Number(row.accuracy), row.attempt], ['pickup', 12.935201, 77.624511, 8, 1])

    const first = await pickup(id)
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(first.body.already, false)
    assert.deepEqual(first.body.messages.map((m) => [m.kind, m.status, m.providerId]).sort(), [['DELIVERY_CODE', 'SENT', 'log'], ['OUT_FOR_DELIVERY', 'SENT', 'log']])
    const o = (await query('SELECT status, delivery_code, delivery_code_hash, delivery_code_nonce FROM orders WHERE id = $1', [id])).rows[0]
    assert.equal(o.status, 'OUT_FOR_DELIVERY')
    // Hashed: no plaintext column written; the hash is of the code the customer sees.
    assert.equal(o.delivery_code, null)
    const code = (await mine(cust, id)).body.deliveryCode
    assert.match(code, /^\d{4}$/)
    assert.equal(o.delivery_code_hash, deliveryCodeHash(id, code))
    assert.equal((await mine(cust, id)).body.rider.firstName, 'Ravi')

    const second = await pickup(id)
    assert.equal(second.status, 200)
    assert.equal(second.body.already, true)
    assert.equal(second.body.messages.length, 2)
    const n = await query("SELECT kind, COUNT(*)::int AS n FROM notifications WHERE order_id = $1 AND kind <> 'ORDER_CONFIRMED' GROUP BY kind ORDER BY kind", [id])
    assert.deepEqual(n.rows.map((r) => [r.kind, r.n]), [['DELIVERY_CODE', 1], ['OUT_FOR_DELIVERY', 1]])
    const events = await query("SELECT COUNT(*)::int AS n FROM order_events WHERE order_id = $1 AND status = 'OUT_FOR_DELIVERY' AND from_status <> status", [id])
    assert.equal(events.rows[0].n, 1)
    // The panel sees it out for delivery.
    const live = await api.get(`/admin/v1/deliveries/live?date=${date}`, { token: admin })
    assert.equal(live.body.stops.find((s) => s.id === id).status, 'OUT_FOR_DELIVERY')
  })

  test('a pickup photo from another day does not count', async () => {
    const { id, date } = await packedOrder()
    setNow(`${date}T04:00:00Z`)
    assert.equal((await stepPhoto(api, rider, id, 'pickup')).status, 201)
    await query("UPDATE delivery_photos SET created_at = created_at - interval '1 day' WHERE order_id = $1", [id])
    assert.equal((await pickup(id)).body.error.code, 'PICKUP_PHOTO_REQUIRED')
  })

  test('a rider picking up an unassigned packed stop takes it; another rider\'s stop is not found', async () => {
    const { id } = await packedOrder({ assign: false })
    assert.equal((await stepPhoto(api, rider, id, 'pickup')).status, 201)
    assert.equal((await pickup(id)).status, 200)
    assert.equal((await query('SELECT rider_id FROM orders WHERE id = $1', [id])).rows[0].rider_id, riderId)
    await api.post('/admin/v1/staff', { email: 'other@mandimangoes.test', role: 'RIDER', password: 'long-enough-2' }, { token: admin })
    const other = await adminToken(api, 'other@mandimangoes.test', 'long-enough-2')
    assert.equal((await stepPhoto(api, other, id, 'door')).status, 404)
  })
})

describe('at the door', () => {
  async function outForDelivery() {
    const o = await packedOrder()
    assert.equal((await stepPhoto(api, rider, o.id, 'pickup')).status, 201)
    assert.equal((await pickup(o.id)).status, 200)
    o.code = (await mine(o.cust, o.id)).body.deliveryCode
    return o
  }

  test('the code stays locked until the door photo and a passing open-box photo; then it delivers', async () => {
    const { id, code, date } = await outForDelivery()
    assert.equal((await deliver(id, { outcome: 'DELIVERED', code })).body.error.code, 'PROOF_STEPS_MISSING')
    assert.equal((await stepPhoto(api, rider, id, 'door')).status, 201)
    assert.equal((await deliver(id, { outcome: 'DELIVERED', code })).body.error.code, 'PROOF_STEPS_MISSING')
    useMangoModel(async () => ({ isMango: true, mangoCount: 6, boxVisible: true, boxOpen: true, damage: 'none', confidence: 0.93, reason: 'An open box of ripe mangoes.' }))
    env.MANGO_CHECK = 'on'
    const box = await stepPhoto(api, rider, id, 'open_box')
    const check = await api.post(`/admin/v1/orders/${id}/photos/${box.body.id}/check`, {}, { token: rider })
    assert.equal(check.status, 200, JSON.stringify(check.body))
    assert.deepEqual([check.body.passed, check.body.needsReview, check.body.mode], [true, false, 'on'])
    const manifest = (await api.get(`/admin/v1/manifest?date=${date}`, { token: rider })).body.runs[0].stops[0].orders[0]
    assert.deepEqual([manifest.codeUnlocked, manifest.codeTriesLeft, manifest.proof.open_box.passed], [true, 3, true])
    const ok = await deliver(id, { outcome: 'DELIVERED', code })
    assert.deepEqual(ok.body, { outcome: 'DELIVERED', method: 'code' })
    // The delivered message is queued in the outbox as before, and sent at once.
    assert.deepEqual((await query("SELECT status, provider_id FROM notifications WHERE order_id = $1 AND kind = 'DELIVERED'", [id])).rows, [{ status: 'SENT', provider_id: 'log' }])
  })

  test('a non-mango photo is refused with the model\'s reason; after two failures the rider continues for review', async () => {
    const { id, code } = await outForDelivery()
    env.MANGO_CHECK = 'on'
    useMangoModel(async () => ({ isMango: false, mangoCount: 0, boxVisible: true, boxOpen: false, damage: 'none', confidence: 0.9, reason: 'The box is closed.' }))
    await stepPhoto(api, rider, id, 'door')
    const one = await stepPhoto(api, rider, id, 'open_box')
    const c1 = (await api.post(`/admin/v1/orders/${id}/photos/${one.body.id}/check`, {}, { token: rider })).body
    assert.deepEqual([c1.passed, c1.failures, c1.canContinue, c1.reason], [false, 1, false, 'The box is closed.'])
    assert.equal((await api.post(`/admin/v1/orders/${id}/photos/${one.body.id}/check`, { continueForReview: true }, { token: rider })).body.error.code, 'RETAKE_FIRST')
    assert.equal((await deliver(id, { outcome: 'DELIVERED', code })).body.error.code, 'PROOF_STEPS_MISSING')
    const two = await stepPhoto(api, rider, id, 'open_box')
    const c2 = (await api.post(`/admin/v1/orders/${id}/photos/${two.body.id}/check`, {}, { token: rider })).body
    assert.deepEqual([c2.passed, c2.failures, c2.canContinue], [false, 2, true])
    const go = (await api.post(`/admin/v1/orders/${id}/photos/${two.body.id}/check`, { continueForReview: true }, { token: rider })).body
    assert.deepEqual([go.passed, go.needsReview], [true, true])
    assert.equal((await deliver(id, { outcome: 'DELIVERED', code })).status, 200)
    // The delivery waits in the existing review queue, flagged, with the open-box photo.
    const reviews = (await api.get('/admin/v1/delivery-reviews', { token: admin })).body
    const r = reviews.find((x) => x.order.id === id)
    assert.ok(r, 'in the review queue')
    assert.equal(r.photoId, two.body.id)
    assert.ok(r.flags.some((f) => f.startsWith('mango check: needs review')), r.flags.join('; '))
    assert.equal((await api.post(`/admin/v1/delivery-reviews/${r.id}`, { ok: true }, { token: admin })).status, 204)
  })

  test('a model error or timeout passes the step for review; shadow mode never blocks', async () => {
    const { id } = await outForDelivery()
    await stepPhoto(api, rider, id, 'door')
    env.MANGO_CHECK = 'on'
    useMangoModel(async () => {
      throw new Error('overloaded')
    })
    const box = await stepPhoto(api, rider, id, 'open_box')
    const c = (await api.post(`/admin/v1/orders/${id}/photos/${box.body.id}/check`, {}, { token: rider })).body
    assert.deepEqual([c.passed, c.needsReview, c.verdict.error], [true, true, 'error'])
    env.MANGO_CHECK = 'shadow'
    useMangoModel(async () => ({ isMango: false, mangoCount: 0, boxVisible: false, boxOpen: false, damage: 'none', confidence: 0.99, reason: 'A shoe.' }))
    const box2 = await stepPhoto(api, rider, id, 'open_box')
    const s = (await api.post(`/admin/v1/orders/${id}/photos/${box2.body.id}/check`, {}, { token: rider })).body
    assert.deepEqual([s.passed, s.needsReview, s.verdict.wouldPass, s.verdict.reason], [true, false, false, 'A shoe.'])
  })

  test('codes are hashed and three wrong codes lock the order; leaving it needs a manager', async () => {
    const { id, code } = await outForDelivery()
    await doorProof(api, rider, id)
    const bad = code === '0000' ? '1111' : '0000'
    const tries = []
    for (let i = 0; i < 3; i++) tries.push((await deliver(id, { outcome: 'DELIVERED', code: bad })).body.error.triesLeft)
    assert.deepEqual(tries, [2, 1, 0])
    const locked = await deliver(id, { outcome: 'DELIVERED', code })
    assert.deepEqual([locked.status, locked.body.error.code], [429, 'CODE_LOCKED'])
    // Leave at the door: a photo and who took it, only with a manager's OK.
    const pic = await stepPhoto(api, rider, id, 'attempt')
    assert.equal((await deliver(id, { outcome: 'DELIVERED', photoId: pic.body.id, receivedBy: 'Left at the door' })).body.error.code, 'HANDOVER_NOT_ALLOWED')
    assert.equal((await api.post(`/admin/v1/orders/${id}/handover-override`, { reason: 'Customer said yes on the phone' }, { token: rider })).status, 403)
    await allowLeaveAtDoor(api, admin, id)
    assert.equal((await deliver(id, { outcome: 'DELIVERED', photoId: pic.body.id, receivedBy: 'Left at the door' })).status, 200)
  })
})

describe('delivery code and verdict rules (units)', () => {
  test('hash compare: right code only, timing-safe, plaintext fallback for older orders', () => {
    const { nonce, hash } = newDeliveryCode('ord_1')
    const code = deriveCode('ord_1', nonce)
    const o = { id: 'ord_1', delivery_code_hash: hash, delivery_code_nonce: nonce }
    assert.equal(codeMatches(o, code), true)
    assert.equal(codeMatches(o, String((Number(code) + 1) % 10_000).padStart(4, '0')), false)
    assert.equal(codeMatches(o, '12a4'), false)
    // The same code on another order hashes differently.
    assert.notEqual(deliveryCodeHash('ord_2', code), hash)
    assert.equal(codeMatches({ id: 'ord_3', delivery_code: '4821' }, '4821'), true)
    assert.equal(codeMatches({ id: 'ord_3', delivery_code: null }, '4821'), false)
  })

  test('the verdict rule: open box of mangoes at confidence 0.7 or more; on, shadow, off, errors', () => {
    const good = cleanVerdict({ isMango: true, mangoCount: 4, boxVisible: true, boxOpen: true, damage: 'minor', confidence: MIN_CONFIDENCE, reason: 'ok' })
    assert.equal(verdictPasses(good), true)
    assert.equal(verdictPasses({ ...good, confidence: 0.69 }), false)
    assert.equal(verdictPasses({ ...good, boxOpen: false }), false)
    assert.equal(verdictPasses({ ...good, isMango: false }), false)
    assert.deepEqual(cleanVerdict({ isMango: 'yes', confidence: 7, damage: 'awful', mangoCount: -2 }), {
      isMango: false, mangoCount: 0, boxVisible: false, boxOpen: false, damage: 'none', confidence: 1, reason: '',
    })
    const bad = { ...good, isMango: false }
    assert.deepEqual(decide({ mode: 'on', verdict: good }), { passed: true, needsReview: false, failures: 0, canContinue: false, wouldPass: true })
    assert.deepEqual(decide({ mode: 'on', verdict: bad, failsBefore: 0 }), { passed: false, needsReview: false, failures: 1, canContinue: false, wouldPass: false })
    assert.deepEqual(decide({ mode: 'on', verdict: bad, failsBefore: 1 }), { passed: false, needsReview: false, failures: 2, canContinue: true, wouldPass: false })
    assert.deepEqual(decide({ mode: 'shadow', verdict: bad }), { passed: true, needsReview: false, failures: 0, canContinue: false, wouldPass: false })
    assert.deepEqual(decide({ mode: 'on', verdict: null, error: true }), { passed: true, needsReview: true, failures: 0, canContinue: false, wouldPass: null })
    assert.equal(decide({ mode: 'off', verdict: null }).passed, true)
  })

  test('a model that does not answer within 6 seconds counts as an error', async () => {
    env.MANGO_CHECK = 'on'
    const started = Date.now()
    useMangoModel(() => new Promise(() => {}))
    const r = await runCheck(await stepJpeg(), 'mangoes')
    assert.deepEqual([r.error, r.errorKind], [true, 'timeout'])
    assert.ok(Date.now() - started >= 5_900 && Date.now() - started < 9_000)
    // With no key and no model swapped in, the mode is shadow and nothing is called.
    useMangoModel(null)
    delete env.MANGO_CHECK
    const skipped = await runCheck(await stepJpeg(), 'mangoes')
    assert.deepEqual([skipped.mode, skipped.skipped], ['shadow', true])
  })

  test('WhatsApp parameters: the update has no code; the code goes in the authentication template and its button', () => {
    const n = { kind: 'OUT_FOR_DELIVERY', order_id: 'ord_9', customer_name: 'Asha', number: 'ORD-1093', rider_name: 'Ravi Kumar', starts_at: '07:00:00', ends_at: '11:00:00' }
    assert.deepEqual(paramsFor(n), ['Asha', 'ORD-1093', 'Ravi', '7 AM to 11 AM'])
    assert.equal(orderLinkFor(n), 'ord_9')
    assert.equal(templateFor('OUT_FOR_DELIVERY'), 'mandi_out_for_delivery')
    const { nonce } = newDeliveryCode('ord_9')
    const c = { kind: 'DELIVERY_CODE', order_id: 'ord_9', delivery_code_nonce: nonce }
    assert.deepEqual(paramsFor(c), [deriveCode('ord_9', nonce)])
    assert.equal(orderLinkFor(c), deriveCode('ord_9', nonce))
    assert.equal(templateFor('DELIVERY_CODE'), 'mandi_delivery_code')
    assert.equal(templateFor('GIFT_DELIVERY_CODE'), 'mandi_delivery_code')
    assert.deepEqual(paramsFor({ ...n, kind: 'GIFT_OUT_FOR_DELIVERY', gift_recipient_name: 'Ravi', rider_name: null, rider_email: 'suresh.p@x.in' }), ['Ravi', 'ORD-1093', 'Suresh', '7 AM to 11 AM'])
  })

  test('message ids are stored, a stale code message is skipped, and an old out-for-delivery template at Meta is not used', async () => {
    const { id } = await packedOrder()
    assert.equal((await stepPhoto(api, rider, id, 'pickup')).status, 201)
    // Through the outbox instead of sending now: a Meta-style sender records its ids.
    await query("INSERT INTO wa_templates (name, language, status, body_params, url_button, synced_at) VALUES ('mandi_out_for_delivery', 'en', 'APPROVED', 4, false, now())")
    const sent = []
    const r = await pickup(id)
    assert.equal(r.status, 200)
    // The log sender ran inside pickup: the stored ids and the guard.
    const rows = (await query("SELECT kind, status, provider_id, last_error FROM notifications WHERE order_id = $1 AND kind <> 'ORDER_CONFIRMED' ORDER BY kind", [id])).rows
    assert.deepEqual(rows.map((x) => [x.kind, x.status]), [['DELIVERY_CODE', 'SENT'], ['OUT_FOR_DELIVERY', 'SKIPPED']])
    assert.match(rows[1].last_error, /older version without the Track order button/)
    assert.equal(rows[0].provider_id, 'log')
    await sendDueNotifications({ sender: async (m) => (sent.push(m), 'wamid.y') })
    // Nothing is sent twice by the outbox afterwards (only the earlier order confirmation was still due).
    assert.deepEqual(sent.map((m) => m.template), ['mandi_order_confirmed'])
  })
})

describe('rider sign-in on the phone', () => {
  const device = 'device-abc12345'
  test('phone code, then a PIN on this phone; the PIN opens it later; wrong PINs and a manager revoke sign it out', async () => {
    const unknown = await api.post('/admin/v1/rider/otp/request', { phone: '9000000099' })
    assert.deepEqual([unknown.status, unknown.body.devCode], [200, undefined])
    const req = await api.post('/admin/v1/rider/otp/request', { phone: '+91 90000 00011' })
    assert.equal(req.status, 200, JSON.stringify(req.body))
    assert.match(req.body.devCode, /^\d{6}$/)
    assert.equal((await api.post('/admin/v1/rider/otp/verify', { phone: '9000000011', code: '000000', deviceId: device })).body.error.code, 'OTP_INVALID')
    const v = await api.post('/admin/v1/rider/otp/verify', { phone: '9000000011', code: req.body.devCode, deviceId: device })
    assert.equal(v.status, 200, JSON.stringify(v.body))
    assert.equal(v.body.rider.name, 'Ravi Kumar')
    assert.equal((await api.post('/admin/v1/rider/pin/set', { setupToken: v.body.setupToken, deviceId: device, pin: '1234' })).body.error.code, 'WEAK_PIN')
    assert.equal((await api.post('/admin/v1/rider/pin/set', { setupToken: v.body.setupToken, deviceId: 'another-device-1', pin: '4071' })).status, 401)
    const set = await api.post('/admin/v1/rider/pin/set', { setupToken: v.body.setupToken, deviceId: device, pin: '4071' })
    assert.equal(set.status, 200, JSON.stringify(set.body))
    // The access token is a staff token with the RIDER role: the manifest opens, the orders list does not.
    assert.equal((await api.get('/admin/v1/auth/me', { token: set.body.accessToken })).body.role, 'RIDER')
    assert.equal((await api.get('/admin/v1/orders', { token: set.body.accessToken })).status, 403)

    const unlock = await api.post('/admin/v1/rider/pin/unlock', { deviceId: device, refreshToken: set.body.refreshToken, pin: '4071' })
    assert.equal(unlock.status, 200, JSON.stringify(unlock.body))
    // The old refresh token was rotated away.
    assert.equal((await api.post('/admin/v1/rider/pin/unlock', { deviceId: device, refreshToken: set.body.refreshToken, pin: '4071' })).body.error.code, 'DEVICE_REVOKED')
    const refreshed = await api.post('/admin/v1/rider/session/refresh', { deviceId: device, refreshToken: unlock.body.refreshToken })
    assert.equal(refreshed.status, 200)
    // 12 hours after the last PIN, a refresh asks for the PIN.
    setNow(new Date(now().getTime() + 13 * 3_600_000).toISOString())
    assert.equal((await api.post('/admin/v1/rider/session/refresh', { deviceId: device, refreshToken: refreshed.body.refreshToken })).body.error.code, 'PIN_REQUIRED')
    let rt = refreshed.body.refreshToken
    for (let i = 0; i < 4; i++) {
      const w = await api.post('/admin/v1/rider/pin/unlock', { deviceId: device, refreshToken: rt, pin: '9999' })
      assert.equal(w.body.error.code, 'WRONG_PIN')
    }
    const good = await api.post('/admin/v1/rider/pin/unlock', { deviceId: device, refreshToken: rt, pin: '4071' })
    assert.equal(good.status, 200)
    rt = good.body.refreshToken

    // A manager revokes the phone from Staff: its refresh token and access tokens end.
    const devices = (await api.get(`/admin/v1/staff/${riderId}/devices`, { token: admin })).body
    const live = devices.find((d) => !d.revokedAt)
    assert.equal(live.deviceId, device)
    assert.equal((await api.post(`/admin/v1/staff/${riderId}/devices/${live.id}/revoke`, {}, { token: admin })).status, 204)
    assert.equal((await api.get('/admin/v1/auth/me', { token: good.body.accessToken })).status, 401)
    assert.equal((await api.post('/admin/v1/rider/pin/unlock', { deviceId: device, refreshToken: rt, pin: '4071' })).body.error.code, 'DEVICE_REVOKED')
  })

  test('five wrong PINs sign the phone out', async () => {
    const req = await api.post('/admin/v1/rider/otp/request', { phone: '9000000011' })
    const v = await api.post('/admin/v1/rider/otp/verify', { phone: '9000000011', code: req.body.devCode, deviceId: device })
    const set = await api.post('/admin/v1/rider/pin/set', { setupToken: v.body.setupToken, deviceId: device, pin: '4071' })
    const codes = []
    for (let i = 0; i < 5; i++) codes.push((await api.post('/admin/v1/rider/pin/unlock', { deviceId: device, refreshToken: set.body.refreshToken, pin: '9999' })).body.error.code)
    assert.deepEqual(codes, ['WRONG_PIN', 'WRONG_PIN', 'WRONG_PIN', 'WRONG_PIN', 'PIN_LOCKED'])
    assert.equal((await api.post('/admin/v1/rider/pin/unlock', { deviceId: device, refreshToken: set.body.refreshToken, pin: '4071' })).body.error.code, 'DEVICE_REVOKED')
  })
})

describe('live view, positions and photo purge', () => {
  test('rider positions are kept once per 20 seconds; the live view shows the last one and what changed', async () => {
    const { id, date } = await packedOrder()
    const at = (await api.get(`/admin/v1/deliveries/live?date=${date}`, { token: admin })).body.cursor
    assert.equal((await api.post('/admin/v1/rider/location', { lat: 12.93, lng: 77.62, accuracy: 9 }, { token: rider })).body.stored, true)
    assert.equal((await api.post('/admin/v1/rider/location', { lat: 12.94, lng: 77.63 }, { token: rider })).body.stored, false)
    setNow(new Date(now().getTime() + 21_000).toISOString())
    assert.equal((await api.post('/admin/v1/rider/location', { lat: 12.95, lng: 77.64 }, { token: rider })).body.stored, true)
    await stepPhoto(api, rider, id, 'pickup', { headers: { 'X-Lat': '12.95', 'X-Lng': '77.64' } })
    await pickup(id)
    const live = (await api.get(`/admin/v1/deliveries/live?date=${date}&since=${encodeURIComponent(at)}`, { token: admin })).body
    assert.deepEqual(live.changed, [id])
    assert.deepEqual(live.events.map((e) => e.status), ['SHIPPED', 'OUT_FOR_DELIVERY'])
    const stop = live.stops.find((s) => s.id === id)
    assert.deepEqual(stop.photos.map((p) => [p.step, p.lat]), [['pickup', 12.95]])
    assert.deepEqual(stop.messages.map((m) => m.kind).sort(), ['DELIVERY_CODE', 'OUT_FOR_DELIVERY'])
    assert.deepEqual(live.riders.map((r) => [r.firstName, r.lat]), [['Ravi', 12.95]])
    assert.equal((await api.get(`/admin/v1/deliveries/live?date=${date}`, { token: rider })).status, 403)
  })

  test('photos older than 90 days lose their image; the row and its verdict stay', async () => {
    const { id } = await packedOrder()
    const p = await stepPhoto(api, rider, id, 'pickup')
    await query(`UPDATE delivery_photos SET verdict = '{"mode":"on","isMango":true}', created_at = created_at - interval '91 days' WHERE id = $1`, [p.body.id])
    assert.equal(await purgeOldDeliveryPhotos(), 1)
    const row = (await query('SELECT bytes, blob_path, removed_at, verdict, step FROM delivery_photos WHERE id = $1', [p.body.id])).rows[0]
    assert.deepEqual([row.bytes, row.blob_path, Boolean(row.removed_at), row.verdict.isMango, row.step], [null, null, true, true, 'pickup'])
    assert.equal(await purgeOldDeliveryPhotos(), 0)
  })
})

describe('demo login code (DEMO_OTP)', () => {
  test('while WhatsApp and SMS are not set up, the fixed code signs riders and customers in and nothing is sent', async () => {
    const { sendOtpForTests } = await import('../src/sms.js')
    const sends = []
    const prev = sendOtpForTests(async (phone) => (sends.push(phone), 'whatsapp'))
    env.DEMO_OTP = '246810'
    try {
      const rider = await api.post('/admin/v1/rider/otp/request', { phone: '9000000011' })
      assert.deepEqual(rider.body, { sent: true, channel: 'demo', devCode: '246810' })
      // A number that is no rider's gets the same answer.
      assert.deepEqual((await api.post('/admin/v1/rider/otp/request', { phone: '9000000099' })).body, rider.body)
      assert.equal((await api.post('/admin/v1/rider/otp/verify', { phone: '9000000011', code: '111111', deviceId: 'device-demo-1' })).body.error.code, 'OTP_INVALID')
      const v = await api.post('/admin/v1/rider/otp/verify', { phone: '9000000011', code: '246810', deviceId: 'device-demo-1' })
      assert.equal(v.status, 200, JSON.stringify(v.body))

      const cust = await api.post('/v1/auth/otp/request', { phone: '9876511111' })
      assert.deepEqual([cust.body.channel, cust.body.devCode], ['demo', '246810'])
      assert.equal((await api.post('/v1/auth/otp/verify', { phone: '9876511111', code: '246810' })).status, 200)
      assert.deepEqual(sends, [])
    } finally {
      delete env.DEMO_OTP
      sendOtpForTests(prev)
    }
  })
})
