// 24 Oct 2026 audit, integrations leftovers (docs/audit-2026-10-24-status-B.md):
// messages, login codes and photo storage. Each test failed on the code before
// its fix; the flag-off tests show the rollback keeps the old behaviour.
// Providers are stubs (injected senders, fake fetch, an in-memory photo store);
// nothing here calls Meta, Jio, Cloudflare or Vercel.
import { checkout, client, closeAll, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { CHAT_RETRY_MS, handleInbound } from '../src/chat.js'
import { addDays, now, setNow, todayIST } from '../src/clock.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'
import { cleanupExpired } from '../src/maintenance.js'
import { recordDeliveryStatus, sendDueNotifications } from '../src/notify.js'
import { blobCallOptions, oldPaths, usePhotoStore } from '../src/photos.js'
import { onProblemForTests } from '../src/sentry.js'
import { otpDelivery } from '../src/sms.js'
import { metaMessenger, metaOtpSender, metaSender } from '../src/whatsapp.js'

let srv
let api
let problems = []
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
  problems = []
  onProblemForTests((message) => problems.push(message))
})
afterEach(() => {
  onProblemForTests(null)
  usePhotoStore(null)
  env.PROVIDER_CHECKS = false
})

const later = (ms) => setNow(new Date(now().getTime() + ms).toISOString())
const payOrder = (orderId) => api.post('/v1/dev/pay', { orderId, outcome: 'captured' })
/** A sender that records every template it is asked to send. */
function recorder() {
  const sent = []
  const sender = async (m) => {
    sent.push(m.template)
    return `wamid.${sent.length}`
  }
  return { sent, sender }
}
const rows = async (sql, params) => (await query(sql, params)).rows

/** A paid order of raw boxes: its confirmation goes now, the ripeness guide a minute later. */
async function paidRawOrder() {
  await makeBatch({ age: 2, rating: 'RAW', lines: { 'ALP-3': 10 } })
  const cust = await customerToken(api)
  const o = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RAW', qty: 1 }])
  assert.equal(o.status, 201, JSON.stringify(o.body))
  assert.equal((await payOrder(o.body.orderId)).status, 200)
  const kinds = (await rows('SELECT kind FROM notifications WHERE order_id = $1 ORDER BY created_at, kind', [o.body.orderId])).map((r) => r.kind)
  assert.ok(kinds.includes('RIPENESS_GUIDE'), kinds.join())
  return { orderId: o.body.orderId, cust }
}

/** The first Monday after the regular booking horizon, with room for bookings. */
async function bookingWeek() {
  let week = addDays(todayIST(), 6)
  while (new Date(`${week}T00:00:00Z`).getUTCDay() !== 1) week = addDays(week, 1)
  const { adminToken } = await import('./helpers.js')
  const manager = await adminToken(api)
  assert.equal((await api.put(`/admin/v1/preorder-capacity/${week}/ALP-3`, { capacity: 10 }, { token: manager })).status, 200)
  return week
}
async function paidBooking(token, week) {
  const b = await api.post(
    '/v1/preorders',
    { sku: 'ALP-3', stage: 'RIPE', qty: 2, weekStart: week, pincode: '560034', address: '12, 4th Cross, Koramangala, Bengaluru' },
    { token, headers: { 'Idempotency-Key': newId('idem') } },
  )
  assert.equal(b.status, 201, JSON.stringify(b.body))
  const id = b.body.id ?? b.body.preorderId
  assert.equal((await api.post('/v1/dev/pay-preorder', { preorderId: id, outcome: 'captured' })).status, 200)
  return id
}

describe('INT-04: messages about an order or booking that moved on are skipped, not sent', () => {
  test('with PROVIDER_CHECKS: no ripeness guide after the customer cancels', async () => {
    env.PROVIDER_CHECKS = true
    const { orderId, cust } = await paidRawOrder()
    const out = recorder()
    await sendDueNotifications({ sender: out.sender })
    assert.deepEqual(out.sent, ['mandi_order_confirmed'])
    assert.equal((await api.post(`/v1/orders/${orderId}/cancel`, {}, { token: cust.accessToken })).status, 204)
    later(2 * 60_000)
    await sendDueNotifications({ sender: out.sender })
    assert.ok(!out.sent.includes('mandi_ripeness_guide'), out.sent.join())
    assert.ok(out.sent.includes('mandi_cancelled'), out.sent.join())
    const [guide] = await rows(`SELECT status, last_error FROM notifications WHERE order_id = $1 AND kind = 'RIPENESS_GUIDE'`, [orderId])
    assert.deepEqual(guide, { status: 'SKIPPED', last_error: 'order cancelled since' })
  })

  test('flag off: the ripeness guide still goes out next to the cancellation (the rollback)', async () => {
    const { orderId, cust } = await paidRawOrder()
    const out = recorder()
    await sendDueNotifications({ sender: out.sender })
    await api.post(`/v1/orders/${orderId}/cancel`, {}, { token: cust.accessToken })
    later(2 * 60_000)
    await sendDueNotifications({ sender: out.sender })
    assert.ok(out.sent.includes('mandi_ripeness_guide'))
  })

  test('with PROVIDER_CHECKS: no "booked" message for a booking cancelled before it went out', async () => {
    env.PROVIDER_CHECKS = true
    const week = await bookingWeek()
    const cust = await customerToken(api)
    const id = await paidBooking(cust.accessToken, week)
    assert.equal((await api.post(`/v1/preorders/${id}/cancel`, {}, { token: cust.accessToken })).status, 204)
    const out = recorder()
    await sendDueNotifications({ sender: out.sender })
    assert.ok(!out.sent.includes('mandi_preorder_booked'), out.sent.join())
    const [booked] = await rows(`SELECT status, last_error FROM notifications WHERE preorder_id = $1 AND kind = 'PREORDER_BOOKED'`, [id])
    assert.deepEqual(booked, { status: 'SKIPPED', last_error: 'booking cancelled since' })
  })
})

describe('INT-05: erasing an account stops its booking messages and blanks their phone', () => {
  test('pending booking messages are SKIPPED and keep no phone; nothing is sent to the deleted number', async () => {
    const week = await bookingWeek()
    const cust = await customerToken(api)
    const id = await paidBooking(cust.accessToken, week)
    assert.equal((await api.post(`/v1/preorders/${id}/cancel`, {}, { token: cust.accessToken })).status, 204)
    assert.equal((await api.del('/v1/me', { token: cust.accessToken })).status, 204)
    const left = await rows(`SELECT kind, status, phone FROM notifications WHERE preorder_id = $1 ORDER BY kind`, [id])
    assert.ok(left.length >= 2, JSON.stringify(left))
    for (const n of left) {
      assert.equal(n.phone, '', n.kind)
      assert.notEqual(n.status, 'PENDING', n.kind)
    }
    const out = recorder()
    await sendDueNotifications({ sender: out.sender })
    assert.deepEqual(out.sent, [])
  })
})

/** A fake fetch answering with `status` and `body` once per call. */
const answer = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const metaOpts = { token: 't', phoneNumberId: '1', apiVersion: 'v23.0', language: 'en' }

describe('INT-09: Meta errors are classed by their error code, not only the HTTP status', () => {
  test("with PROVIDER_CHECKS a 400 pair-rate-limit (131056) is temporary and retried; a bad number (131026) is not", async () => {
    env.PROVIDER_CHECKS = true
    const limited = await metaSender(metaOpts, answer(400, { error: { code: 131056, message: '(#131056) Business account sending pair rate limit has been hit' } }))({ phone: '+919876543210', template: 't', params: [] }).catch((e) => e)
    assert.equal(limited.permanent, false)
    assert.equal(limited.metaCode, 131056)
    const bad = await metaSender(metaOpts, answer(400, { error: { code: 131026, message: 'Message undeliverable' } }))({ phone: '+919876543210', template: 't', params: [] }).catch((e) => e)
    assert.equal(bad.permanent, true)
  })

  test('flag off: the 400 rate limit is permanent, as before', async () => {
    const limited = await metaSender(metaOpts, answer(400, { error: { code: 131056, message: 'pair rate limit' } }))({ phone: '+919876543210', template: 't', params: [] }).catch((e) => e)
    assert.equal(limited.permanent, true)
  })

  test('a delivery code hit by the rate limit stays PENDING for a retry instead of FAILED at once', async () => {
    env.PROVIDER_CHECKS = true
    const { orderId } = await paidRawOrder()
    await sendDueNotifications({ sender: metaSender(metaOpts, answer(400, { error: { code: 130429, message: 'Rate limit hit' } })) })
    const [n] = await rows(`SELECT status, attempts FROM notifications WHERE order_id = $1 AND kind = 'ORDER_CONFIRMED'`, [orderId])
    assert.deepEqual(n, { status: 'PENDING', attempts: 1 })
  })
})

describe('INT-10: a login code WhatsApp accepted but could not deliver is seen', () => {
  test('with PROVIDER_CHECKS: the message id is kept, a "failed" status counts, and the third one alerts', async () => {
    env.PROVIDER_CHECKS = true
    let n = 0
    const wa = metaOtpSender({ ...metaOpts, template: 'mandi_login_code' }, async () => new Response(JSON.stringify({ messages: [{ id: `wamid.OTP${++n}` }] }), { status: 200 }))
    const smsCalls = []
    const deliver = otpDelivery({ sms: async (phone) => smsCalls.push(phone), whatsapp: wa })
    for (let i = 0; i < 3; i++) assert.equal(await deliver('+919876543210', '123456', 'whatsapp'), 'whatsapp')
    assert.equal(smsCalls.length, 0)
    assert.equal(await recordDeliveryStatus({ id: 'wamid.OTP1', status: 'failed', errors: [{ code: 131026 }] }), 1)
    assert.equal(await recordDeliveryStatus({ id: 'wamid.OTP1', status: 'failed' }), 0, 'counted once')
    assert.equal(await recordDeliveryStatus({ id: 'wamid.unknown', status: 'failed' }), 0)
    await recordDeliveryStatus({ id: 'wamid.OTP2', status: 'failed' })
    assert.equal(problems.filter((p) => /not being delivered/.test(p)).length, 0)
    await recordDeliveryStatus({ id: 'wamid.OTP3', status: 'failed' })
    assert.equal(problems.filter((p) => /not being delivered/.test(p)).length, 1)
  })

  test('flag off: the failed status matches nothing, as before', async () => {
    const wa = metaOtpSender({ ...metaOpts, template: 'mandi_login_code' }, async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.OTP1' }] }), { status: 200 }))
    await otpDelivery({ sms: null, whatsapp: wa })('+919876543210', '123456', 'whatsapp')
    assert.equal(await recordDeliveryStatus({ id: 'wamid.OTP1', status: 'failed' }), 0)
  })
})

describe('INT-12: a chat reply that fails for a passing reason is tried once more', () => {
  const ask = (send, messageId) => handleInbound({ waId: '919876500001', name: 'Asha', messageId, input: { text: 'hi' } }, { send })

  test('with PROVIDER_CHECKS: a Meta 503 then success sends the reply', async () => {
    env.PROVIDER_CHECKS = true
    const tries = []
    const failingOnce = metaMessenger(metaOpts, async () => {
      tries.push(Date.now())
      return tries.length === 1 ? new Response('{"error":{"message":"busy"}}', { status: 503 }) : new Response('{"messages":[{"id":"wamid.r"}]}', { status: 200 })
    })
    const replies = await ask(failingOnce, 'wamid.in1')
    assert.ok(replies.length >= 1)
    assert.equal(tries.length, replies.length + 1, 'the failed reply was sent again')
    assert.ok(tries[1] - tries[0] >= CHAT_RETRY_MS - 50)
  })

  test('a refused reply (400, not temporary) is not retried; flag off nothing is retried', async () => {
    env.PROVIDER_CHECKS = true
    let calls = 0
    const refused = metaMessenger(metaOpts, async () => (calls++, new Response('{"error":{"code":131026,"message":"undeliverable"}}', { status: 400 })))
    const replies = await ask(refused, 'wamid.in2')
    assert.equal(calls, replies.length)
    env.PROVIDER_CHECKS = false
    let off = 0
    const busy = metaMessenger(metaOpts, async () => (off++, new Response('{}', { status: 503 })))
    const again = await ask(busy, 'wamid.in3')
    assert.equal(off, again.length)
  })
})

describe('INT-13: a failed send does not replace the code the customer already has', () => {
  async function withFailingSecondSend(fn) {
    const sms = await import('../src/sms.js')
    // The second request's send fails: every channel down (OTP_NOT_SENT).
    const phone = '9876511111'
    const first = await api.post('/v1/auth/otp/request', { phone })
    assert.equal(first.status, 200)
    const { HttpError } = await import('../src/errors.js')
    const saved = sms.sendOtpForTests(async () => {
      throw new HttpError(502, 'OTP_NOT_SENT', 'We could not send the code. Please try again.')
    })
    try {
      const second = await api.post('/v1/auth/otp/request', { phone })
      assert.equal(second.status, 502)
    } finally {
      sms.sendOtpForTests(saved)
    }
    return fn(phone, first.body.devCode)
  }

  test('with PROVIDER_CHECKS the first code still signs in', async () => {
    env.PROVIDER_CHECKS = true
    await withFailingSecondSend(async (phone, code) => {
      const v = await api.post('/v1/auth/otp/verify', { phone, code })
      assert.equal(v.status, 200, JSON.stringify(v.body))
    })
  })

  test('flag off: the failed send had already replaced it (the old behaviour)', async () => {
    await withFailingSecondSend(async (phone, code) => {
      const v = await api.post('/v1/auth/otp/verify', { phone, code })
      assert.equal(v.status, 401)
    })
  })
})

describe('INT-18: adding a phone during a Turnstile outage counts only numbers with an account as known', () => {
  async function outage(fn) {
    const saved = { secret: env.TURNSTILE_SECRET_KEY, fetch: globalThis.fetch }
    env.TURNSTILE_SECRET_KEY = 'turnstile-test-secret'
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith('https://challenges.cloudflare.com/')) throw new Error('Cloudflare unreachable')
      return saved.fetch(url, init)
    }
    try {
      return await fn()
    } finally {
      env.TURNSTILE_SECRET_KEY = saved.secret
      globalThis.fetch = saved.fetch
    }
  }

  test('with PROVIDER_CHECKS a new number gets 503 CAPTCHA_UNAVAILABLE; a number with an account still gets a code', async () => {
    env.PROVIDER_CHECKS = true
    const owner = await customerToken(api, '9876522222')
    const me = (await import('../src/auth.js')).signAccess
    const google = await query(`INSERT INTO customers (id, email, created_at) VALUES ($1, 'g@example.in', $2) RETURNING id`, [newId('cus'), now()])
    const token = await me({ sub: google.rows[0].id, phone: null, typ: 'customer', sv: 0 })
    await outage(async () => {
      const fresh = await api.post('/v1/me/phone/request', { phone: '9876533333', captchaToken: 'x' }, { token })
      assert.equal(fresh.status, 503)
      assert.equal(fresh.body.error.code, 'CAPTCHA_UNAVAILABLE')
      const known = await api.post('/v1/me/phone/request', { phone: '9876522222', captchaToken: 'x' }, { token })
      assert.equal(known.status, 200, JSON.stringify(known.body))
    })
    assert.ok(owner.accessToken)
  })

  test('flag off: any number passes during the outage (the old behaviour)', async () => {
    const google = await query(`INSERT INTO customers (id, email, created_at) VALUES ($1, 'g2@example.in', $2) RETURNING id`, [newId('cus'), now()])
    const token = await (await import('../src/auth.js')).signAccess({ sub: google.rows[0].id, phone: null, typ: 'customer', sv: 0 })
    await outage(async () => {
      assert.equal((await api.post('/v1/me/phone/request', { phone: '9876544444', captchaToken: 'x' }, { token })).status, 200)
    })
  })
})

describe('INT-11 and INT-14: the Blob sweep runs hourly, reads every page, and calls have a deadline', () => {
  /** A photo store whose listOld counts its calls. */
  function countingStore() {
    const store = { lists: 0, async put(p) { return p }, async get() { return null }, async del() {}, async listOld() { store.lists++; return [] } }
    return store
  }

  test('with PROVIDER_CHECKS sixty runs in an hour list the store once, then again after the hour', async () => {
    env.PROVIDER_CHECKS = true
    const store = countingStore()
    usePhotoStore(store)
    for (let i = 0; i < 60; i++) {
      await cleanupExpired(now())
      later(60_000)
    }
    assert.equal(store.lists, 1)
    later(60_000)
    await cleanupExpired(now())
    assert.equal(store.lists, 2)
  })

  test('flag off: every run lists the store (the old behaviour)', async () => {
    const store = countingStore()
    usePhotoStore(store)
    for (let i = 0; i < 5; i++) await cleanupExpired(now())
    assert.equal(store.lists, 5)
  })

  test('the sweep pages past the first 1000 uploads', async () => {
    const old = new Date('2026-10-01T00:00:00Z')
    const pages = [
      { blobs: Array.from({ length: 1000 }, (_, i) => ({ pathname: `review-uploads/c/new${i}`, uploadedAt: new Date('2026-10-20T00:00:00Z') })), hasMore: true, cursor: 'p2' },
      { blobs: Array.from({ length: 500 }, (_, i) => ({ pathname: `review-uploads/c/old${i}`, uploadedAt: old })), hasMore: false },
    ]
    const seen = []
    const listPage = async (cursor) => (seen.push(cursor ?? null), cursor === 'p2' ? pages[1] : pages[0])
    const found = await oldPaths(listPage, new Date('2026-10-10T00:00:00Z'), 100, 10)
    assert.deepEqual(seen, [null, 'p2'])
    assert.equal(found.length, 100)
    assert.ok(found.every((p) => p.includes('/old')))
    // One page only (the old behaviour): nothing past the first 1000 is ever found.
    assert.deepEqual(await oldPaths(listPage, new Date('2026-10-10T00:00:00Z'), 100, 1), [])
  })

  test('with PROVIDER_CHECKS each Blob call carries an abort deadline', () => {
    assert.equal('abortSignal' in blobCallOptions(), false)
    env.PROVIDER_CHECKS = true
    const o = blobCallOptions()
    assert.ok(o.abortSignal instanceof AbortSignal)
    assert.equal(o.abortSignal.aborted, false)
  })
})
