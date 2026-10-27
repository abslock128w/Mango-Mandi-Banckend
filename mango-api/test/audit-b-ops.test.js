// 24 Oct 2026 audit, alerting leftovers INT-03, 06, 07, 08 (docs/audit-2026-10-24-status-B.md),
// behind OPS_ALERTS. Each flag-on test failed on the code before the fix; the
// flag-off tests show the rollback keeps the old behaviour. Sentry is the
// in-process test hook: nothing is sent anywhere.
import { adminToken, checkout, client, closeAll, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { handleWhatsAppWebhook } from '../src/chat.js'
import { now, setNow } from '../src/clock.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'
import { checkHealth, runMaintenance } from '../src/maintenance.js'
import { sendDueNotifications } from '../src/notify.js'
import { recordWebhookFailure } from '../src/payments.js'
import { onErrorForTests, onProblemForTests } from '../src/sentry.js'

let srv
let api
let problems = []
let errors = []
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
  errors = []
  onProblemForTests((message) => problems.push(message))
  onErrorForTests((_err, context) => errors.push(context))
})
afterEach(() => {
  onProblemForTests(null)
  onErrorForTests(null)
  env.OPS_ALERTS = false
})

const later = (ms) => setNow(new Date(now().getTime() + ms).toISOString())

describe('INT-03: a step failing every minute is reported every hour, not once', () => {
  async function failForAnHour() {
    // The back-in-stock step reads stock_alerts: without it, it fails on every run.
    await query('ALTER TABLE stock_alerts RENAME TO stock_alerts_gone')
    for (let minute = 0; minute <= 61; minute++) {
      await runMaintenance()
      later(60_000)
    }
    return errors.filter((c) => c?.maintenanceStep === 'stock-alerts').length
  }

  test('with OPS_ALERTS: reported at the first failure and again an hour later', async () => {
    env.OPS_ALERTS = true
    assert.equal(await failForAnHour(), 2)
  })

  test('flag off: reported once while the failure lasts (the old behaviour)', async () => {
    assert.equal(await failForAnHour(), 1)
  })
})

/** A paid order; its confirmation is PENDING. */
async function paidOrder() {
  await makeBatch({ age: 5, rating: 'RIPE', lines: { 'ALP-3': 10 } })
  const cust = await customerToken(api)
  const o = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
  assert.equal(o.status, 201, JSON.stringify(o.body))
  assert.equal((await api.post('/v1/dev/pay', { orderId: o.body.orderId, outcome: 'captured' })).status, 200)
  return o.body.orderId
}

describe('INT-06: messages dropped after a day-long outage are listed and alerted', () => {
  test('with OPS_ALERTS: Needs attention lists them, checkHealth warns, and Send again works', async () => {
    env.OPS_ALERTS = true
    const orderId = await paidOrder()
    later(25 * 3_600_000)
    const sent = []
    await sendDueNotifications({ sender: async (m) => (sent.push(m.template), 'wamid.1') })
    assert.deepEqual(sent, [])
    const manager = await adminToken(api)
    const a = await api.get('/admin/v1/attention', { token: manager })
    assert.equal(a.status, 200)
    const dropped = a.body.failedMessages.filter((m) => m.order?.id === orderId)
    assert.ok(dropped.length >= 1, JSON.stringify(a.body.failedMessages))
    assert.equal(dropped[0].status, 'SKIPPED')
    assert.equal(dropped[0].error, 'older than a day')
    assert.ok((await checkHealth({}, now())).includes('messages-aged'))
    assert.ok(problems.some((p) => /dropped unsent after waiting a day/.test(p)), problems.join())
    // Staff send the one that still matters.
    assert.equal((await api.post(`/admin/v1/notifications/${dropped[0].id}/retry`, {}, { token: manager })).status, 204)
    await sendDueNotifications({ sender: async (m) => (sent.push(m.template), 'wamid.2') })
    assert.ok(sent.length >= 1)
  })

  test('flag off: nothing lists them and checkHealth is quiet (the old behaviour)', async () => {
    const orderId = await paidOrder()
    later(25 * 3_600_000)
    await sendDueNotifications({ sender: async () => 'wamid.1' })
    const a = await api.get('/admin/v1/attention', { token: await adminToken(api) })
    assert.equal(a.body.failedMessages.filter((m) => m.order?.id === orderId).length, 0)
    assert.equal((await checkHealth({}, now())).includes('messages-aged'), false)
  })
})

describe('INT-07: a few failed messages alert, at any volume; so do "no provider" skips', () => {
  async function failedMessages(orderId, n) {
    for (let i = 0; i < n; i++) {
      await query(
        `INSERT INTO notifications (id, order_id, event_id, kind, phone, status, attempts, next_attempt_at, last_error, created_at)
         VALUES ($1, $2, $3, 'ORDER_CONFIRMED', '+919876543210', 'FAILED', 1, $4, 'template paused', $4)`,
        [newId('ntf'), orderId, newId('evt'), now()],
      )
    }
  }

  test('with OPS_ALERTS: 3 FAILED in a day is a "failing" problem (19 of 19 was not)', async () => {
    env.OPS_ALERTS = true
    const orderId = await paidOrder()
    await failedMessages(orderId, 3)
    assert.ok((await checkHealth({}, now())).includes('failing'))
  })

  test('flag off: 3 FAILED alone is not (the old 20-message floor)', async () => {
    const orderId = await paidOrder()
    await failedMessages(orderId, 3)
    assert.equal((await checkHealth({}, now())).includes('failing'), false)
  })

  test('with OPS_ALERTS: a message skipped for want of a provider is a problem', async () => {
    const orderId = await paidOrder()
    await query(`UPDATE notifications SET status = 'SKIPPED', last_error = 'no WhatsApp provider configured', next_attempt_at = $2 WHERE order_id = $1`, [orderId, now()])
    assert.equal((await checkHealth({}, now())).includes('no-provider'), false, 'flag off: silent')
    env.OPS_ALERTS = true
    assert.ok((await checkHealth({}, now())).includes('no-provider'))
  })
})

describe('INT-08: WhatsApp webhook failures reach Sentry', () => {
  test('with OPS_ALERTS: three in an hour is a problem; flag off it is not', async () => {
    for (let i = 0; i < 3; i++) await recordWebhookFailure('whatsapp', `chat failed ${i}`)
    assert.equal((await checkHealth({}, now())).includes('whatsapp-webhooks'), false)
    env.OPS_ALERTS = true
    assert.ok((await checkHealth({}, now())).includes('whatsapp-webhooks'))
  })

  const unmatched = {
    entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', type: 'payment', status: 'captured', payment: { reference_id: 'ORD-99999', amount: { value: 1000, offset: 100 }, currency: 'INR', transaction: { id: 'txn_1' } } }] } }] }],
  }

  test('with OPS_ALERTS: a WhatsApp payment captured for no order is reported at once', async () => {
    env.OPS_ALERTS = true
    await handleWhatsAppWebhook(unmatched)
    assert.equal(problems.filter((p) => /captured for no order/.test(p)).length, 1)
    assert.equal((await query(`SELECT 1 FROM webhook_failures WHERE source = 'whatsapp'`)).rowCount, 1, 'and still listed for staff')
  })

  test('flag off: only recorded for the panel (the old behaviour)', async () => {
    await handleWhatsAppWebhook(unmatched)
    assert.equal(problems.filter((p) => /captured for no order/.test(p)).length, 0)
  })
})
