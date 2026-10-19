// The shop's payment paths: reopening checkout from another device (FE-1) and
// retrying after the gateway failed to start a payment (FE-2).
import { closeAll, adminToken, checkout, client, customerToken, line, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { addDays, todayIST } from '../src/clock.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'

let srv
let api
let admin
const realFetch = globalThis.fetch

/** Pretends Razorpay keys are set; `razorpay` answers every call to api.razorpay.com. */
function withGateway(razorpay) {
  env.RAZORPAY_KEY_ID = 'rzp_test_publickey'
  env.RAZORPAY_KEY_SECRET = 'secret'
  globalThis.fetch = (url, init) => (String(url).startsWith('https://api.razorpay.com/') ? razorpay(String(url), init) : realFetch(url, init))
}

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
afterEach(() => {
  globalThis.fetch = realFetch
  env.RAZORPAY_KEY_ID = ''
  env.RAZORPAY_KEY_SECRET = ''
})

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('reopening checkout (FE-1)', () => {
  test('the order page carries the public key id while unpaid, for its owner only', async () => {
    withGateway(() => json({ id: 'order_rzp_1' }))
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    const cust = await customerToken(api)
    const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
    assert.equal(c.status, 201, JSON.stringify(c.body))

    const o = await api.get(`/v1/orders/${c.body.orderId}`, { token: cust.accessToken })
    assert.equal(o.status, 200)
    assert.equal(o.body.razorpayOrderId, 'order_rzp_1')
    assert.equal(o.body.razorpayKeyId, 'rzp_test_publickey')
    assert.ok(o.body.holdExpiresAt)

    const other = await customerToken(api)
    assert.equal((await api.get(`/v1/orders/${c.body.orderId}`, { token: other.accessToken })).status, 404)

    // Once paid there is nothing to reopen.
    await query(`UPDATE orders SET status = 'CONFIRMED', payment_status = 'SUCCEEDED' WHERE id = $1`, [c.body.orderId])
    assert.equal((await api.get(`/v1/orders/${c.body.orderId}`, { token: cust.accessToken })).body.razorpayKeyId, null)
  })
})

describe('gateway failure at checkout (FE-2)', () => {
  test('a 502 releases the key and the stock, and a fresh quote and key place a new order', async () => {
    let up = false
    withGateway(() => (up ? json({ id: 'order_rzp_ok' }) : json({ error: 'down' }, 500)))
    const b = await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    const cust = await customerToken(api)

    const failed = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 2 }], { key: 'k-1' })
    assert.equal(failed.status, 502)
    assert.equal(failed.body.error.code, 'PAYMENT_GATEWAY_ERROR')
    assert.equal((await line(b, 'ALP-3')).held, 0)
    assert.equal((await query('SELECT count(*)::int AS n FROM idempotency_keys')).rows[0].n, 0)
    const cancelled = (await query(`SELECT status FROM orders WHERE customer_id = $1`, [cust.customer.id])).rows
    assert.deepEqual(cancelled.map((r) => r.status), ['CANCELLED'])

    // Retrying with the same key no longer replays the cancelled order as a success.
    const sameKey = await api.post(
      '/v1/checkout/confirm',
      { quoteId: 'gone', address: '12, 4th Cross, Koramangala, Bengaluru' },
      { token: cust.accessToken, headers: { 'Idempotency-Key': 'k-1' } },
    )
    assert.notEqual(sameKey.status, 200)

    // The shop starts over: new quote, new key.
    up = true
    const retry = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 2 }], { key: 'k-2' })
    assert.equal(retry.status, 201, JSON.stringify(retry.body))
    assert.equal(retry.body.status, 'PAYMENT_PENDING')
    assert.equal(retry.body.razorpayOrderId, 'order_rzp_ok')
    assert.equal((await line(b, 'ALP-3')).held, 2)
  })

  test('a preorder whose payment link failed can be booked again with the same key', async () => {
    let up = false
    withGateway(() => (up ? json({ id: 'plink_ok', short_url: 'https://rzp.io/i/ok' }) : json({ error: 'down' }, 500)))
    let week = addDays(todayIST(), 6)
    while (new Date(`${week}T00:00:00Z`).getUTCDay() !== 1) week = addDays(week, 1)
    assert.equal((await api.put(`/admin/v1/preorder-capacity/${week}/ALP-3`, { capacity: 10 }, { token: admin })).status < 300, true)
    const cust = await customerToken(api)
    const key = newId('idem')
    const book = () =>
      api.post(
        '/v1/preorders',
        { sku: 'ALP-3', stage: 'RIPE', qty: 2, weekStart: week, pincode: '560034', address: '12, 4th Cross, Koramangala, Bengaluru' },
        { token: cust.accessToken, headers: { 'Idempotency-Key': key } },
      )
    const failed = await book()
    assert.equal(failed.status, 502)
    up = true
    const again = await book()
    assert.equal(again.status, 201, JSON.stringify(again.body))
    assert.equal(again.body.status, 'PAYMENT_PENDING')
    assert.equal(again.body.paymentUrl, 'https://rzp.io/i/ok')
  })

  test('a retry while the first try is still creating the Razorpay order gets 409 PAYMENT_STARTING (PAY-6)', async () => {
    let release
    const gate = new Promise((r) => (release = r))
    withGateway(async () => {
      await gate
      return json({ id: 'order_rzp_slow' })
    })
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    const cust = await customerToken(api)
    assert.equal((await api.post('/v1/cart/items', { sku: 'ALP-3', stage: 'RIPE', qty: 1 }, { token: cust.accessToken })).status, 204)
    const q = await api.post('/v1/checkout/quote', { pincode: '560034' }, { token: cust.accessToken })
    assert.equal(q.status, 200, JSON.stringify(q.body))
    const confirm = () =>
      api.post('/v1/checkout/confirm', { quoteId: q.body.quoteId, address: '12, 4th Cross, Koramangala, Bengaluru' }, { token: cust.accessToken, headers: { 'Idempotency-Key': 'slow' } })

    const first = confirm()
    // Wait until the order exists and the first request is waiting on Razorpay.
    for (let i = 0; i < 100; i++) {
      const { rows } = await query('SELECT 1 FROM orders WHERE customer_id = $1', [cust.customer.id])
      if (rows.length) break
      await new Promise((r) => setTimeout(r, 20))
    }
    const early = await confirm()
    assert.equal(early.status, 409)
    assert.equal(early.body.error.code, 'PAYMENT_STARTING')

    release()
    const done = await first
    assert.equal(done.status, 201, JSON.stringify(done.body))
    const replay = await confirm()
    assert.equal(replay.status, 200)
    assert.equal(replay.body.razorpayOrderId, 'order_rzp_slow')
    assert.equal(replay.body.orderId, done.body.orderId)
  })
})
