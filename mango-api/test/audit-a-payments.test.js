// 24 Oct 2026 audit, payments leftovers (docs/audit-2026-10-24-status-A.md).
// Each test failed on the code before its fix. Razorpay is never called: a
// fetch stub stands in for its API and records every call.
import { adminToken, checkout, client, closeAll, customerToken, makeBatch, resetDb, signWebhook, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { drainBackground } from '../src/background.js'
import { setBudget, withBudget } from '../src/budget.js'
import { handleInbound } from '../src/chat.js'
import { addDays, now, setNow, todayIST } from '../src/clock.js'
import { query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'
import { runMaintenance } from '../src/maintenance.js'
import { sweepExpiredHolds } from '../src/orders.js'
import { devGateway, processDueRefunds, reconcileRecentPayments, refundDuplicatePayments } from '../src/payments.js'

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
  devGateway.clear()
  manager = await adminToken(api)
})
afterEach(() => {
  env.REFUND_SAFETY_CHECKS = false
  env.PAYMENT_DAILY_RECON = false
})

const MIN = 60_000
const DAY = 86_400_000
const later = (ms) => setNow(new Date(now().getTime() + ms).toISOString())
const ord = async (id) => (await query('SELECT * FROM orders WHERE id = $1', [id])).rows[0]
const hook = (event) => {
  const { raw, signature } = signWebhook(event)
  return api.raw('POST', '/webhooks/razorpay', {
    raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature, 'X-Razorpay-Event-Id': `evt_auda_${++seq}` },
  })
}

/** Razorpay's API answered by `handler(method, path)`; every call is recorded. Returns { calls, restore }. */
function stubRazorpay(handler) {
  const realFetch = globalThis.fetch
  const calls = []
  env.RAZORPAY_KEY_ID = 'rzp_test_x'
  env.RAZORPAY_KEY_SECRET = 'key_secret_test'
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    if (!u.startsWith('https://api.razorpay.com/v1')) return realFetch(url, init)
    const method = init.method ?? 'GET'
    const path = u.slice('https://api.razorpay.com/v1'.length)
    calls.push(`${method} ${path}`)
    const out = (await handler(method, path)) ?? [404, {}]
    const [status, json] = Array.isArray(out) ? out : [200, out]
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } })
  }
  return {
    calls,
    restore: () => {
      globalThis.fetch = realFetch
      env.RAZORPAY_KEY_ID = ''
      env.RAZORPAY_KEY_SECRET = ''
    },
  }
}

async function paidOrder() {
  await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
  const cust = await customerToken(api)
  const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
  assert.equal(c.status, 201, JSON.stringify(c.body))
  assert.equal((await api.post('/v1/dev/pay', { orderId: c.body.orderId, outcome: 'captured' })).body.result, 'confirmed')
  return { cust, order: c.body }
}

describe('PAY-03: two quick "Pay" taps in WhatsApp', () => {
  test('every reply sends the one stored link; an extra link is cancelled at Razorpay', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    let created = 0
    const rzp = stubRazorpay(async (method, path) => {
      if (method === 'POST' && path === '/payment_links') {
        const n = ++created
        await new Promise((r) => setTimeout(r, 150)) // a normal gateway round trip
        return { id: `plink_${n}`, short_url: `https://rzp.io/i/plink_${n}` }
      }
      if (method === 'POST' && /^\/payment_links\/plink_\d\/cancel$/.test(path)) return { status: 'cancelled' }
      return null
    })
    try {
      const waId = '919800011122'
      const say = (input) =>
        handleInbound({ waId, name: 'Ravi', messageId: `wamid.auda.${++seq}`, input: typeof input === 'string' ? { text: input } : input }, { send: async () => {} })
      await say('hi')
      await say({ id: 'ORDER' })
      await say('560034')
      await say({ id: 'item:ALP-3|RIPE' })
      await say({ id: 'qty:1' })
      await say({ id: 'CHECKOUT' })
      await say('12, 4th Cross, Koramangala, Bengaluru')
      const [r1, r2] = await Promise.all([say({ id: 'PAY' }), new Promise((r) => setTimeout(r, 20)).then(() => say({ id: 'PAY' }))])
      await drainBackground()
      const sent = [...r1, ...r2].filter((x) => x.type === 'link').map((x) => x.url)
      const stored = (await query(`SELECT payment_link_id, payment_link_url FROM orders WHERE phone = '+919800011122'`)).rows[0]
      assert.equal(sent.length, 2, JSON.stringify(sent))
      assert.deepEqual(new Set(sent), new Set([stored.payment_link_url]), `sent ${JSON.stringify(sent)}, stored ${stored.payment_link_url}`)
      // Every link made but not stored was cancelled; the stored one never was.
      const cancels = rzp.calls.filter((x) => x.endsWith('/cancel'))
      assert.equal(cancels.length, created - 1, JSON.stringify(rzp.calls))
      assert.ok(!cancels.includes(`POST /payment_links/${stored.payment_link_id}/cancel`))
    } finally {
      rzp.restore()
    }
  })
})

describe('PAY-05: "paid back another way" while Razorpay cannot be checked', () => {
  async function stuckRefund() {
    const { order } = await paidOrder()
    // Cancelled and refunded at Razorpay, but the save failed: Razorpay may hold a refund we don't.
    await query(
      `UPDATE orders SET status = 'CANCELLED', payment_id = 'pay_m1', customer_cancelled_at = $2, refund_requested_at = $2 WHERE id = $1`,
      [order.orderId, new Date(now().getTime() - 40 * MIN)],
    )
    return order
  }
  const settle = (orderId) =>
    api.post(`/admin/v1/refunds/${orderId}/paid-another-way`, { type: 'order', reference: 'UTR998877', reason: 'paid by bank transfer' }, { token: manager })

  test('with REFUND_SAFETY_CHECKS it is refused and nothing is written', async () => {
    env.REFUND_SAFETY_CHECKS = true
    const order = await stuckRefund()
    const rzp = stubRazorpay((method, path) => (method === 'GET' && path === '/payments/pay_m1/refunds' ? [503, { error: { code: 'SERVER_ERROR' } }] : null))
    try {
      const r = await settle(order.orderId)
      assert.equal(r.status, 409, JSON.stringify(r.body))
      assert.equal(r.body.error.code, 'RAZORPAY_UNCHECKED')
      const o = await ord(order.orderId)
      assert.deepEqual([o.refund_id, o.refunded_at, o.refund_status], [null, null, null])
      assert.ok(rzp.calls.includes('GET /payments/pay_m1/refunds'))
    } finally {
      rzp.restore()
    }
    // Once Razorpay answers (no refund there), the manager can record it.
    const ok = stubRazorpay((method, path) => (method === 'GET' && path === '/payments/pay_m1/refunds' ? { items: [] } : null))
    try {
      const r = await settle(order.orderId)
      assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.equal((await ord(order.orderId)).refund_id, 'manual:UTR998877')
    } finally {
      ok.restore()
    }
  })

  test('with the flag off it is recorded as before (rollback)', async () => {
    const order = await stuckRefund()
    const rzp = stubRazorpay((method, path) => (method === 'GET' && path === '/payments/pay_m1/refunds' ? [503, {}] : null))
    try {
      const r = await settle(order.orderId)
      assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.equal((await ord(order.orderId)).refund_id, 'manual:UTR998877')
    } finally {
      rzp.restore()
    }
  })
})

describe('PAY-06: refunds while a chargeback is open', () => {
  const dispute = (status) =>
    hook({
      event: `payment.dispute.${status === 'open' ? 'created' : status}`,
      payload: { payment: { entity: { id: 'pay_disp' } }, dispute: { entity: { id: 'disp_auda', payment_id: 'pay_disp', amount: 59900, currency: 'INR', status } } },
    })

  test('with REFUND_SAFETY_CHECKS a customer cancel waits for the dispute, shows as held, and goes out once it is won', async () => {
    env.REFUND_SAFETY_CHECKS = true
    const { cust, order } = await paidOrder()
    await query(`UPDATE orders SET payment_id = 'pay_disp' WHERE id = $1`, [order.orderId])
    assert.equal((await dispute('open')).body.result, 'dispute_recorded')
    assert.equal((await api.post(`/v1/orders/${order.orderId}/cancel`, {}, { token: cust.accessToken })).status, 204)
    await drainBackground()
    let o = await ord(order.orderId)
    assert.ok(o.refund_requested_at, 'the refund is still owed')
    assert.deepEqual([o.refund_id, o.refunded_at, o.payment_status], [null, null, 'SUCCEEDED'])
    // The maintenance loop does not send it either.
    later(31 * MIN)
    await processDueRefunds()
    o = await ord(order.orderId)
    assert.equal(o.refund_id, null)
    const att = await api.get('/admin/v1/attention', { token: manager })
    const row = att.body.stuckRefunds.find((r) => r.id === order.orderId)
    assert.equal(row?.state, 'held', JSON.stringify(att.body.stuckRefunds))
    // Won: the refund is sent as usual.
    assert.equal((await dispute('won')).body.result, 'dispute_recorded')
    later(3 * MIN) // past the refund lease taken by the held attempts
    await processDueRefunds()
    o = await ord(order.orderId)
    assert.match(o.refund_id ?? '', /^rfnd_dev_/)
    assert.equal(o.payment_status, 'REFUNDED')
  })

  test('a second payment under a lost chargeback is never refunded automatically', async () => {
    env.REFUND_SAFETY_CHECKS = true
    const { order } = await paidOrder()
    await query(`INSERT INTO duplicate_payments (payment_id, order_id, amount, found_at) VALUES ('pay_disp', $1, $2, $3)`, [order.orderId, order.total, now()])
    assert.equal((await dispute('lost')).body.result, 'dispute_recorded')
    later(31 * MIN)
    assert.equal(await refundDuplicatePayments(), 0)
    const d = (await query(`SELECT * FROM duplicate_payments WHERE payment_id = 'pay_disp'`)).rows[0]
    assert.deepEqual([d.refund_id, d.refunded_at], [null, null])
    const att = await api.get('/admin/v1/attention', { token: manager })
    assert.equal(att.body.stuckRefunds.find((r) => r.paymentId === 'pay_disp')?.state, 'held')
  })

  test('with the flag off the refund goes out as before (rollback)', async () => {
    const { cust, order } = await paidOrder()
    await query(`UPDATE orders SET payment_id = 'pay_disp' WHERE id = $1`, [order.orderId])
    await dispute('open')
    assert.equal((await api.post(`/v1/orders/${order.orderId}/cancel`, {}, { token: cust.accessToken })).status, 204)
    await drainBackground()
    assert.match((await ord(order.orderId)).refund_id ?? '', /^rfnd_dev_/)
  })
})

describe('PAY-08: the daily check of payments Razorpay captured', () => {
  function farWeek(extraWeeks = 2) {
    let d = addDays(todayIST(), 6 + extraWeeks * 7)
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1)
    return d
  }

  test('a checkout order paid 25 hours after it was placed, webhook lost, is confirmed as a late payment', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    const cust = await customerToken(api)
    const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
    assert.equal(c.status, 201, JSON.stringify(c.body))
    later(11 * MIN)
    await tx((cl) => sweepExpiredHolds(cl))
    assert.equal((await ord(c.body.orderId)).status, 'CANCELLED')
    later(25 * 60 * MIN)
    devGateway.set(c.body.razorpayOrderId, { id: 'pay_late25', status: 'captured', amount: c.body.total, method: 'card' })
    const out = await reconcileRecentPayments()
    const o = await ord(c.body.orderId)
    assert.deepEqual([out.applied, o.status, o.payment_status, o.payment_id], [1, 'CONFIRMED', 'SUCCEEDED', 'pay_late25'])
    // Run again: nothing more happens.
    assert.equal((await reconcileRecentPayments()).applied, 0)
  })

  test('a booking paid on its link 4 days after its payment window opened is booked', async () => {
    const week = farWeek()
    assert.equal((await api.put(`/admin/v1/preorder-capacity/${week}/ALP-3`, { capacity: 4 }, { token: manager })).status, 200)
    const cust = await customerToken(api)
    const b = await api.post(
      '/v1/preorders',
      { sku: 'ALP-3', stage: 'RIPE', qty: 2, weekStart: week, pincode: '560034', address: '12, 4th Cross, Koramangala, Bengaluru' },
      { token: cust.accessToken, headers: { 'Idempotency-Key': newId('idem') } },
    )
    assert.equal(b.status, 201, JSON.stringify(b.body))
    const p = (await query('SELECT * FROM preorders WHERE id = $1', [b.body.id])).rows[0]
    later(4 * DAY)
    devGateway.set(p.payment_link_id, { id: 'pay_pre_late', status: 'captured', amount: p.total, method: 'upi' })
    const out = await reconcileRecentPayments()
    const booked = (await query('SELECT status, payment_id FROM preorders WHERE id = $1', [p.id])).rows[0]
    assert.equal(out.applied, 1)
    assert.deepEqual([booked.status, booked.payment_id], ['BOOKED', 'pay_pre_late'])
  })

  test('a captured payment that matches nothing is listed once in Needs attention; booking notes alone are not trusted', async () => {
    const rzp = stubRazorpay((method, path) => {
      if (method === 'GET' && path.startsWith('/payments?')) {
        return {
          items: [
            { id: 'pay_orphan1', status: 'captured', amount: 59900, currency: 'INR', order_id: 'order_unknown1', notes: {} },
            // Notes naming a booking that has no such payment on its link: never applied.
            { id: 'pay_forged', status: 'captured', amount: 59900, currency: 'INR', notes: { preorderId: 'pre_nope' } },
            { id: 'pay_failed1', status: 'failed', amount: 59900, currency: 'INR' },
          ],
        }
      }
      return null
    })
    try {
      const first = await reconcileRecentPayments()
      assert.deepEqual([first.captured, first.applied, first.flagged], [2, 0, 2])
      const second = await reconcileRecentPayments()
      assert.equal(second.flagged, 0)
      const rows = (await query(`SELECT payment_id FROM webhook_failures WHERE event_key LIKE 'recon:%' ORDER BY payment_id`)).rows
      assert.deepEqual(rows.map((r) => r.payment_id), ['pay_forged', 'pay_orphan1'])
      const att = await api.get('/admin/v1/attention', { token: manager })
      assert.equal(att.body.webhookFailures.find((w) => w.paymentId === 'pay_orphan1')?.refundable, true)
    } finally {
      rzp.restore()
    }
  })

  /** 250 captured payments that match nothing, 100 a page; `cut(skip)` true ends the run's time while that page loads. */
  function manyPayments(cut) {
    const all = Array.from({ length: 250 }, (_, i) => ({ id: `pay_bulk${String(i).padStart(3, '0')}`, status: 'captured', amount: 100, currency: 'INR', notes: {} }))
    return stubRazorpay((method, path) => {
      if (method !== 'GET' || !path.startsWith('/payments?')) return null
      const skip = Number(new URLSearchParams(path.split('?')[1]).get('skip'))
      if (cut(skip)) setBudget(0)
      return { items: all.slice(skip, skip + 100) }
    })
  }
  const listed = (calls) => calls.filter((x) => x.startsWith('GET /payments?')).map((x) => Number(new URLSearchParams(x.split('?')[1]).get('skip')))
  const flaggedRows = async () => (await query(`SELECT COUNT(*)::int AS n FROM webhook_failures WHERE event_key LIKE 'recon:pay_bulk%'`)).rows[0].n

  test('a list longer than one run is handled page by page and the next run carries on where it stopped', async () => {
    let cuts = 0
    const rzp = manyPayments((skip) => skip === 0 && !cuts++)
    try {
      const first = await withBudget(45_000, () => reconcileRecentPayments())
      assert.deepEqual([first.partial, first.captured, first.flagged], [true, 100, 100], 'the first page is handled before time runs out')
      later(MIN)
      const second = await withBudget(45_000, () => reconcileRecentPayments())
      assert.deepEqual([second.partial, second.captured, second.flagged], [undefined, 150, 150])
      assert.deepEqual(listed(rzp.calls), [0, 100, 200], 'each page is asked for once, not again from the start')
      assert.equal(await flaggedRows(), 250)
      // Done: the next check starts a new window from the first page.
      later(MIN)
      const third = await withBudget(45_000, () => reconcileRecentPayments())
      assert.deepEqual([third.captured, third.flagged], [250, 0])
      assert.deepEqual(listed(rzp.calls).slice(3), [0, 100, 200])
    } finally {
      rzp.restore()
    }
  })

  test('in the maintenance run a partial check carries on next minute and is marked done once it gets through', async () => {
    env.PAYMENT_DAILY_RECON = true
    const rzp = manyPayments((skip) => skip === 0 || skip === 100)
    try {
      let out = await runMaintenance()
      assert.equal(out.paymentRecon?.partial, true)
      later(MIN)
      out = await runMaintenance()
      assert.equal(out.paymentRecon?.partial, true)
      later(MIN)
      out = await runMaintenance()
      assert.equal(out.paymentRecon?.partial, undefined)
      assert.equal(await flaggedRows(), 250)
      later(MIN)
      out = await runMaintenance()
      assert.equal(out.paymentRecon, undefined, 'done for the day')
      assert.deepEqual(listed(rzp.calls), [0, 100, 200])
      const run = (await query(`SELECT last_ok_at, cursor FROM maintenance_runs WHERE step = 'payment-recon'`)).rows[0]
      assert.ok(run.last_ok_at)
      assert.equal(run.cursor, null)
    } finally {
      rzp.restore()
    }
  })

  test('the maintenance run does it once a day, only with PAYMENT_DAILY_RECON', async () => {
    const rzp = stubRazorpay((method, path) => (method === 'GET' && path.startsWith('/payments?') ? { items: [] } : null))
    try {
      let out = await runMaintenance()
      assert.equal(out.paymentRecon, undefined)
      env.PAYMENT_DAILY_RECON = true
      later(2 * MIN)
      out = await runMaintenance()
      assert.deepEqual(out.paymentRecon, { captured: 0, applied: 0, flagged: 0 })
      later(2 * MIN)
      out = await runMaintenance()
      assert.equal(out.paymentRecon, undefined, 'not again the same day')
      assert.equal(rzp.calls.filter((x) => x.startsWith('GET /payments?')).length, 1)
    } finally {
      rzp.restore()
    }
  })
})
