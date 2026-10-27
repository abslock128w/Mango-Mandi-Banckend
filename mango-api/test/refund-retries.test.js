// Migration 045, part 3: a refund that fails is sent again after 2, 4, 8, ...
// up to 60 minutes, and after REFUND_MAX_ATTEMPTS it is left 'failed' for a
// manager (Needs attention, "needs a manager"), never reopened on its own.
// Orders, preorders and second payments alike. Razorpay is never called: a
// fetch stub stands in for it. Also: PAYMENT_DAILY_RECON is on by default in production.
import { adminToken, checkout, client, closeAll, customerToken, makeBatch, resetDb, signWebhook, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { after, before, beforeEach, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { addDays, now, setNow, todayIST } from '../src/clock.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'
import { processDueRefunds, REFUND_MAX_ATTEMPTS, refundBackoffMinutes, refundDuplicatePayments } from '../src/payments.js'

let srv
let api
let manager

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
  await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
})

const MIN = 60_000
const later = (ms) => setNow(new Date(now().getTime() + ms).toISOString())
const order = async (id) => (await query('SELECT * FROM orders WHERE id = $1', [id])).rows[0]

/** Razorpay with test keys: refund lookups answer an empty list, and every refund POST fails while `down()`. */
function failingRefunds(down = () => true) {
  const realFetch = globalThis.fetch
  const posts = []
  let n = 0
  env.RAZORPAY_KEY_ID = 'rzp_test_x'
  env.RAZORPAY_KEY_SECRET = 'key_secret_test'
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    if (!u.startsWith('https://api.razorpay.com/v1')) return realFetch(url, init)
    const path = u.slice('https://api.razorpay.com/v1'.length)
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if ((init.method ?? 'GET') === 'GET' && /\/refunds$/.test(path)) return json(200, { items: [] })
    if (init.method === 'POST' && /\/refund$/.test(path)) {
      posts.push(JSON.parse(init.body))
      if (down()) return json(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'The bank refused the refund' } })
      return json(200, { id: `rfnd_ok${++n}`, status: 'pending', amount: 0 })
    }
    return json(404, { error: { code: 'NOT_FOUND' } })
  }
  return {
    posts,
    restore() {
      globalThis.fetch = realFetch
      env.RAZORPAY_KEY_ID = ''
      env.RAZORPAY_KEY_SECRET = ''
    },
  }
}

async function paidOrder(paymentId) {
  const cust = await customerToken(api)
  const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
  assert.equal(c.status, 201, JSON.stringify(c.body))
  assert.equal((await api.post('/v1/dev/pay', { orderId: c.body.orderId, outcome: 'captured' })).body.result, 'confirmed')
  await query('UPDATE orders SET payment_id = $2 WHERE id = $1', [c.body.orderId, paymentId])
  return { ...c.body, cust }
}

/**
 * Runs `attempt` once per back-off window until the refund has been tried
 * REFUND_MAX_ATTEMPTS times, checking that nothing is sent before each window
 * ends. `sent()` counts the refund POSTs so far.
 */
async function runOutAttempts(attempt, sent) {
  assert.equal(sent(), 1, 'the first attempt went out at once')
  for (let n = 1; n < REFUND_MAX_ATTEMPTS; n++) {
    later((refundBackoffMinutes(n) - 1) * MIN)
    await attempt()
    assert.equal(sent(), n, `attempt ${n + 1} waits ${refundBackoffMinutes(n)} minutes`)
    later(1.5 * MIN)
    await attempt()
    assert.equal(sent(), n + 1, `attempt ${n + 1} goes after ${refundBackoffMinutes(n)} minutes`)
  }
  // Used up: nothing more, however long it waits.
  for (let i = 0; i < 3; i++) {
    later(2 * 60 * MIN)
    await attempt()
  }
  assert.equal(sent(), REFUND_MAX_ATTEMPTS)
}

const attentionRefund = async (id) => (await api.get('/admin/v1/attention', { token: manager })).body.stuckRefunds.find((r) => r.id === id)

describe('refund retries back off, then stop for a manager', () => {
  test('the back-off doubles from 2 minutes up to an hour', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 20].map(refundBackoffMinutes), [2, 4, 8, 16, 32, 60, 60, 60, 60])
    assert.equal(REFUND_MAX_ATTEMPTS, 8)
  })

  test('order: a refund Razorpay keeps refusing is tried 8 times, then left failed and shown as needing a manager', async () => {
    const o = await paidOrder('pay_RR1')
    const gw = failingRefunds()
    try {
      assert.equal((await api.post(`/v1/orders/${o.orderId}/cancel`, {}, { token: o.cust.accessToken })).status, 204)
      await runOutAttempts(() => processDueRefunds(), () => gw.posts.length)
      const row = await order(o.orderId)
      assert.equal(row.refunded_at, null)
      assert.equal(row.refund_status, 'failed')
      assert.ok(row.refund_gave_up_at)
      assert.equal(row.refund_attempts, REFUND_MAX_ATTEMPTS)
      assert.equal(row.payment_status, 'SUCCEEDED')
      // Each attempt had its own receipt.
      assert.deepEqual(gw.posts.map((p) => p.receipt), Array.from({ length: 8 }, (_, i) => `${o.number}-r${i + 1}`))
      const events = (await query(`SELECT reason FROM order_events WHERE order_id = $1 AND reason LIKE 'The refund failed%'`, [o.orderId])).rows
      assert.equal(events.length, 1)
      assert.match(events[0].reason, /failed 8 times and is not sent again on its own/)
      assert.deepEqual(await attentionRefund(o.orderId), {
        type: 'order', id: o.orderId, number: o.number, requestedAt: row.refund_requested_at.toISOString(), paymentId: null, state: 'needs_manager', attempts: 8,
      })
      // A customer's cancel request path (sendDueRefunds) does not reopen it either.
      const { sendDueRefunds } = await import('../src/payments.js')
      await sendDueRefunds({ orderId: o.orderId })
      assert.equal(gw.posts.length, REFUND_MAX_ATTEMPTS)
      // The manager's way out still works.
      const settle = await api.post(
        `/admin/v1/refunds/${o.orderId}/paid-another-way`,
        { type: 'order', reference: 'NEFT UTR 4455', reason: 'bank refused the card refund', confirmCode: 'manager123' },
        { token: manager },
      )
      assert.equal(settle.status, 200, JSON.stringify(settle.body))
      assert.equal((await order(o.orderId)).refund_status, 'manual')
      assert.equal(await attentionRefund(o.orderId), undefined)
    } finally {
      gw.restore()
    }
  })

  test('a refund that goes through on a later attempt is recorded as usual', async () => {
    const o = await paidOrder('pay_RR2')
    let down = true
    const gw = failingRefunds(() => down)
    try {
      assert.equal((await api.post(`/v1/orders/${o.orderId}/cancel`, {}, { token: o.cust.accessToken })).status, 204)
      assert.equal(gw.posts.length, 1)
      down = false
      assert.equal(await processDueRefunds(), 0, 'still backing off')
      later(2.5 * MIN)
      assert.equal(await processDueRefunds(), 1)
      const row = await order(o.orderId)
      assert.deepEqual([row.refund_id, row.refund_status, row.payment_status, row.refund_gave_up_at], ['rfnd_ok1', 'pending', 'REFUNDED', null])
    } finally {
      gw.restore()
    }
  })

  test('refund.failed from Razorpay on the last attempt leaves it for a manager instead of reopening it', async () => {
    const o = await paidOrder('pay_RR3')
    const gw = failingRefunds(() => false)
    try {
      assert.equal((await api.post(`/v1/orders/${o.orderId}/cancel`, {}, { token: o.cust.accessToken })).status, 204)
      assert.equal((await order(o.orderId)).refund_id, 'rfnd_ok1')
      await query('UPDATE orders SET refund_attempts = $2 WHERE id = $1', [o.orderId, REFUND_MAX_ATTEMPTS])
      const { raw, signature } = signWebhook({ event: 'refund.failed', payload: { refund: { entity: { id: 'rfnd_ok1', payment_id: 'pay_RR3', status: 'failed' } } } })
      const r = await api.raw('POST', '/webhooks/razorpay', { raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature, 'X-Razorpay-Event-Id': 'evt_rr3' } })
      assert.equal(r.body.result, 'refund_failed')
      const row = await order(o.orderId)
      assert.deepEqual([row.refund_status, row.refund_id, row.refunded_at, row.payment_status], ['failed', null, null, 'SUCCEEDED'])
      assert.ok(row.refund_gave_up_at)
      later(3 * 60 * MIN)
      assert.equal(await processDueRefunds(), 0)
      assert.equal(gw.posts.length, 1)
      assert.equal((await attentionRefund(o.orderId)).state, 'needs_manager')
    } finally {
      gw.restore()
    }
  })

  test('an attempt that never came back still counts: after the last one the refund is given up', async () => {
    const o = await paidOrder('pay_RR4')
    // As if attempts were made and the instance died during the last one.
    await query(
      `UPDATE orders SET status = 'CANCELLED', customer_cancelled_at = $2, refund_requested_at = $2, refund_attempts = $3,
              refund_attempted_at = $2, refund_next_attempt_at = $2::timestamptz + interval '60 minutes' WHERE id = $1`,
      [o.orderId, now(), REFUND_MAX_ATTEMPTS],
    )
    const gw = failingRefunds()
    try {
      later(61 * MIN)
      assert.equal(await processDueRefunds(), 0)
      assert.equal(gw.posts.length, 0)
      assert.ok((await order(o.orderId)).refund_gave_up_at)
    } finally {
      gw.restore()
    }
  })

  test('second payment: the same back-off and the same stop', async () => {
    const o = await paidOrder('pay_RR5')
    await query('INSERT INTO duplicate_payments (payment_id, order_id, amount, found_at) VALUES ($1, $2, $3, $4)', ['pay_DUP5', o.orderId, o.total, now()])
    const gw = failingRefunds()
    try {
      await refundDuplicatePayments()
      await runOutAttempts(() => refundDuplicatePayments(), () => gw.posts.length)
      const d = (await query(`SELECT * FROM duplicate_payments WHERE payment_id = 'pay_DUP5'`)).rows[0]
      assert.deepEqual([d.refund_status, d.refunded_at, d.refund_attempts], ['failed', null, REFUND_MAX_ATTEMPTS])
      assert.ok(d.refund_gave_up_at)
      assert.match(d.last_error ?? '', /refund failed: 400/)
      const listed = (await api.get('/admin/v1/attention', { token: manager })).body.stuckRefunds.find((r) => r.paymentId === 'pay_DUP5')
      assert.equal(listed.state, 'needs_manager')
    } finally {
      gw.restore()
    }
  })

  test('preorder: the same back-off and the same stop', async () => {
    let week = addDays(todayIST(), 6)
    while (new Date(`${week}T00:00:00Z`).getUTCDay() !== 1) week = addDays(week, 1)
    assert.equal((await api.put(`/admin/v1/preorder-capacity/${week}/ALP-3`, { capacity: 10 }, { token: manager })).status, 200)
    const cust = await customerToken(api)
    const b = await api.post(
      '/v1/preorders',
      { sku: 'ALP-3', stage: 'RIPE', qty: 1, weekStart: week, pincode: '560034', address: '12, 4th Cross, Koramangala, Bengaluru' },
      { token: cust.accessToken, headers: { 'Idempotency-Key': newId('idem') } },
    )
    assert.equal(b.status, 201, JSON.stringify(b.body))
    assert.equal((await api.post('/v1/dev/pay-preorder', { preorderId: b.body.id, outcome: 'captured' })).body.result, 'booked')
    await query(`UPDATE preorders SET payment_id = 'pay_PRE6' WHERE id = $1`, [b.body.id])
    const gw = failingRefunds()
    try {
      assert.equal((await api.post(`/v1/preorders/${b.body.id}/cancel`, {}, { token: cust.accessToken })).status, 204)
      await runOutAttempts(() => processDueRefunds(), () => gw.posts.length)
      const p = (await query('SELECT * FROM preorders WHERE id = $1', [b.body.id])).rows[0]
      assert.deepEqual([p.refund_status, p.refunded_at], ['failed', null])
      assert.ok(p.refund_gave_up_at)
      assert.equal((await attentionRefund(b.body.id)).state, 'needs_manager')
      const ev = (await query(`SELECT reason FROM preorder_events WHERE preorder_id = $1 AND reason LIKE 'The refund failed%'`, [b.body.id])).rows
      assert.equal(ev.length, 1)
    } finally {
      gw.restore()
    }
  })
})

describe('PAYMENT_DAILY_RECON defaults', () => {
  const run = (vars) =>
    promisify(execFile)(process.execPath, ['--input-type=module', '-e', "const { env } = await import('./src/env.js'); console.log(String(env.PAYMENT_DAILY_RECON))"], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { PATH: process.env.PATH, DATABASE_URL: 'postgres://nobody@localhost:5432/none_test', ...vars },
    }).then((r) => r.stdout.trim())

  test('on in production unless set to false; off in development unless set', async () => {
    // PREFLIGHT=1 only stops env.js refusing to start for the missing production settings.
    assert.equal(await run({ NODE_ENV: 'production', PREFLIGHT: '1' }), 'true')
    assert.equal(await run({ NODE_ENV: 'production', PREFLIGHT: '1', PAYMENT_DAILY_RECON: 'false' }), 'false')
    assert.equal(await run({ NODE_ENV: 'development' }), 'false')
    assert.equal(await run({ NODE_ENV: 'development', PAYMENT_DAILY_RECON: 'true' }), 'true')
  })

  test('tests run with it off unless a test turns it on', () => {
    assert.equal(env.PAYMENT_DAILY_RECON, false)
  })
})
