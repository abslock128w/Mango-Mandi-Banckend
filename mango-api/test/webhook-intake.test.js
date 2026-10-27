// Migration 045, part 2: durable webhook intake (src/webhook-events.js). A
// signed webhook is stored before it is processed; one whose processing fails
// is replayed by maintenance, confirms its order once, and a replay of an
// event already processed does nothing. Razorpay is never called.
import { adminToken, checkout, client, closeAll, customerToken, makeBatch, resetDb, signWebhook, startServer, T0 } from './helpers.js'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { after, before, beforeEach, describe, test } from 'node:test'
import { now, setNow } from '../src/clock.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { registry } from '../src/metrics.js'
import { pruneWebhookEvents, replayWebhookEvents, WEBHOOK_MAX_REPLAYS, webhookLag } from '../src/webhook-events.js'

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
})

const MIN = 60_000
const later = (ms) => setNow(new Date(now().getTime() + ms).toISOString())
const post = (raw, signature, eventId) =>
  api.raw('POST', '/webhooks/razorpay', { raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature, 'X-Razorpay-Event-Id': eventId } })
const send = (event, eventId) => {
  const { raw, signature } = signWebhook(event)
  return post(raw, signature, eventId)
}
const captured = (o, paymentId) => ({
  event: 'payment.captured', created_at: Math.floor(now().getTime() / 1000),
  payload: { payment: { entity: { id: paymentId, order_id: o.razorpayOrderId, amount: o.total, currency: 'INR', method: 'upi' } } },
})
const stored = async () => (await query('SELECT * FROM webhook_events ORDER BY received_at, id')).rows
const order = async (id) => (await query('SELECT * FROM orders WHERE id = $1', [id])).rows[0]
const confirmations = async (id) => (await query(`SELECT count(*)::int AS n FROM order_events WHERE order_id = $1 AND status = 'CONFIRMED' AND from_status <> 'CONFIRMED'`, [id])).rows[0].n

async function pendingOrder() {
  await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 5 } })
  const cust = await customerToken(api)
  const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
  assert.equal(c.status, 201, JSON.stringify(c.body))
  return c.body
}

/** Makes confirming a payment fail inside its transaction: the first `times` times, or always. */
async function breakConfirm(times = Infinity) {
  await query('CREATE SEQUENCE IF NOT EXISTS test_confirm_failures')
  await query(`
    CREATE OR REPLACE FUNCTION test_fail_confirm() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.status = 'CONFIRMED' AND NEW.from_status <> 'CONFIRMED' AND nextval('test_confirm_failures') <= ${Number.isFinite(times) ? times : 1_000_000} THEN
        RAISE EXCEPTION 'injected failure while confirming';
      END IF;
      RETURN NEW;
    END $$`)
  await query('CREATE TRIGGER test_fail_confirm BEFORE INSERT ON order_events FOR EACH ROW EXECUTE FUNCTION test_fail_confirm()')
}

describe('webhook intake (migration 045)', () => {
  test('a webhook is stored as received and marked processed by its own transaction', async () => {
    const o = await pendingOrder()
    const r = await send(captured(o, 'pay_wh1'), 'evt_wh1')
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const [e] = await stored()
    assert.equal(e.provider, 'razorpay')
    assert.equal(e.dedupe_key, 'evt_wh1')
    assert.equal(e.event_id, 'evt_wh1')
    assert.ok(e.processed_at)
    assert.equal(e.attempts, 0)
    assert.deepEqual(JSON.parse(e.body.toString('utf8')), captured(o, 'pay_wh1'))
    assert.equal((await order(o.orderId)).status, 'CONFIRMED')
  })

  test('a failure mid-processing is replayed after 5 minutes and confirms the order once', async () => {
    const o = await pendingOrder()
    await breakConfirm(1)
    const r = await send(captured(o, 'pay_wh2'), 'evt_wh2')
    assert.equal(r.status, 500)
    let [e] = await stored()
    assert.equal(e.processed_at, null)
    assert.match(e.last_error, /injected failure/)
    assert.equal((await order(o.orderId)).status, 'PAYMENT_PENDING')
    // The processing transaction rolled back its dedupe row too.
    assert.equal((await query(`SELECT count(*)::int AS n FROM processed_webhooks WHERE dedupe_key = 'evt_wh2'`)).rows[0].n, 0)

    // Not yet: under 5 minutes old.
    later(2 * MIN)
    assert.deepEqual(await replayWebhookEvents(), { replayed: 0, failed: 0, gaveUp: 0 })
    later(4 * MIN)
    assert.deepEqual(await replayWebhookEvents(), { replayed: 1, failed: 0, gaveUp: 0 })
    ;[e] = await stored()
    assert.ok(e.processed_at)
    assert.equal(e.attempts, 1)
    assert.equal(e.last_error, null)
    assert.equal((await order(o.orderId)).status, 'CONFIRMED')
    assert.equal((await order(o.orderId)).payment_id, 'pay_wh2')
    assert.equal(await confirmations(o.orderId), 1)

    // Replaying again, and Razorpay's own retry of the same event, change nothing.
    later(10 * MIN)
    assert.deepEqual(await replayWebhookEvents(), { replayed: 0, failed: 0, gaveUp: 0 })
    const retry = await send(captured(o, 'pay_wh2'), 'evt_wh2')
    assert.equal(retry.status, 200)
    assert.equal(retry.body.duplicate, true)
    assert.equal((await stored()).length, 1)
    assert.equal(await confirmations(o.orderId), 1)
  })

  test('a replay of an event already processed does nothing, even if it is run again by hand', async () => {
    const o = await pendingOrder()
    assert.equal((await send(captured(o, 'pay_wh3'), 'evt_wh3')).status, 200)
    // As if the instance died after committing but the row were picked up again.
    await query('UPDATE webhook_events SET processed_at = NULL, last_attempt_at = $1', [new Date(now().getTime() - 10 * MIN)])
    later(6 * MIN)
    assert.deepEqual(await replayWebhookEvents(), { replayed: 1, failed: 0, gaveUp: 0 })
    assert.equal(await confirmations(o.orderId), 1)
    const [e] = await stored()
    assert.ok(e.processed_at, 'the duplicate run still marks it processed')
    assert.equal((await query(`SELECT count(*)::int AS n FROM duplicate_payments`)).rows[0].n, 0)
  })

  test('an event that keeps failing is replayed at most WEBHOOK_MAX_REPLAYS times, then listed in Needs attention', async () => {
    const o = await pendingOrder()
    await breakConfirm()
    assert.equal((await send(captured(o, 'pay_wh4'), 'evt_wh4')).status, 500)
    for (let i = 1; i <= WEBHOOK_MAX_REPLAYS; i++) {
      later(6 * MIN)
      assert.deepEqual(await replayWebhookEvents(), { replayed: 0, failed: 1, gaveUp: 0 }, `replay ${i}`)
    }
    later(6 * MIN)
    assert.deepEqual(await replayWebhookEvents(), { replayed: 0, failed: 0, gaveUp: 1 })
    later(6 * MIN)
    assert.deepEqual(await replayWebhookEvents(), { replayed: 0, failed: 0, gaveUp: 0 })
    const [e] = await stored()
    assert.equal(e.attempts, WEBHOOK_MAX_REPLAYS)
    assert.ok(e.gave_up_at)
    const att = await api.get('/admin/v1/attention', { token: manager })
    const listed = att.body.webhookFailures.filter((w) => /still failed after 5 replays/.test(w.reason))
    assert.equal(listed.length, 1)
    assert.match(listed[0].reason, /evt_wh4.*injected failure.*needs a manager/)
    assert.equal((await order(o.orderId)).status, 'PAYMENT_PENDING')
  })

  test('the raw body is what is signed: the same JSON re-formatted is refused, and nothing is stored', async () => {
    const o = await pendingOrder()
    const event = captured(o, 'pay_wh5')
    const { signature } = signWebhook(event)
    const reformatted = JSON.stringify(event, null, 2)
    assert.deepEqual(JSON.parse(reformatted), event)
    const r = await post(reformatted, signature, 'evt_wh5')
    assert.equal(r.status, 400)
    assert.equal(r.body.error.code, 'BAD_SIGNATURE')
    assert.equal((await stored()).length, 0)
    assert.equal((await order(o.orderId)).status, 'PAYMENT_PENDING')
    // Signed over those exact bytes, the same body is accepted.
    const sig = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(reformatted).digest('hex')
    assert.equal((await post(reformatted, sig, 'evt_wh5')).status, 200)
    assert.equal((await order(o.orderId)).status, 'CONFIRMED')
  })

  test('a WhatsApp webhook is stored and marked processed after its messages', async () => {
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
    const sig = `sha256=${createHmac('sha256', 'wa_test_secret').update(raw).digest('hex')}`
    const r = await api.raw('POST', '/webhooks/whatsapp', { raw, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig } })
    assert.equal(r.status, 200)
    const [e] = await stored()
    assert.equal(e.provider, 'whatsapp')
    assert.match(e.dedupe_key, /^sha256:[0-9a-f]{64}$/)
    assert.ok(e.processed_at)
  })

  test('webhook lag is measured from the event time and observed in a histogram', async () => {
    const before = await registry.getSingleMetric('mango_webhook_lag_seconds').get()
    const count = (m) => m.values.find((v) => v.metricName === 'mango_webhook_lag_seconds_count' && v.labels.provider === 'razorpay')?.value ?? 0
    const at = new Date(Date.parse(T0))
    assert.equal(webhookLag('razorpay', at.getTime() / 1000 - 90, at), 90)
    assert.equal(webhookLag('razorpay', undefined, at), null)
    assert.equal(count(await registry.getSingleMetric('mango_webhook_lag_seconds').get()), count(before) + 1)
  })

  test('stored events are deleted after 30 days, WhatsApp ones after 7', async () => {
    const day = 86_400_000
    const add = (id, provider, ageDays) =>
      query(`INSERT INTO webhook_events (id, provider, dedupe_key, body, received_at, last_attempt_at, processed_at) VALUES ($1, $2, $1, '\\x7b7d', $3, $3, $3)`, [
        id, provider, new Date(now().getTime() - ageDays * day),
      ])
    await add('r8', 'razorpay', 8)
    await add('r31', 'razorpay', 31)
    await add('w6', 'whatsapp', 6)
    await add('w8', 'whatsapp', 8)
    assert.equal(await pruneWebhookEvents(), 2)
    assert.deepEqual((await stored()).map((e) => e.id).sort(), ['r8', 'w6'])
  })
})
