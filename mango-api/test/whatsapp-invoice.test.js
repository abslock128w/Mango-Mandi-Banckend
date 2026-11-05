// The order confirmation that carries the invoice (WHATSAPP_ORDER_INVOICE): one WhatsApp
// message with the confirmation, a "Track order" button and a "Download invoice" button
// whose signed link opens the bill's PDF without a sign-in (src/bill-link.js).
import { closeAll, checkout, client, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { BILL_LINK_DAYS, billLink, readBillLink } from '../src/bill-link.js'
import { now } from '../src/clock.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { sendDueNotifications } from '../src/notify.js'
import { setTrustConfig } from '../src/trust-config.js'
import { metaSender } from '../src/whatsapp.js'

let srv
let api

before(async () => {
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  setTrustConfig({})
  await srv.close()
  await closeAll()
})
beforeEach(async () => {
  setTrustConfig({})
  await resetDb()
  env.WHATSAPP_ORDER_INVOICE = false
  env.WHATSAPP_ORDER_LINKS = false
  await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
})
afterEach(() => {
  setTrustConfig({})
  env.WHATSAPP_ORDER_INVOICE = false
})

const pay = (orderId) => api.post('/v1/dev/pay', { orderId, outcome: 'captured' })

/** A paid order for a new customer. */
async function paidOrder() {
  const cust = await customerToken(api)
  const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
  assert.equal(c.status, 201)
  assert.equal((await pay(c.body.orderId)).status, 200)
  return { cust, orderId: c.body.orderId, number: c.body.number }
}

/** Sends every due message with a fake sender and returns what it was asked to send. */
async function sent() {
  const calls = []
  await query(`UPDATE notifications SET next_attempt_at = created_at WHERE status = 'PENDING'`)
  await sendDueNotifications({ sender: async (m) => (calls.push(m), `wamid.${calls.length}`) })
  return calls
}
const confirmations = (calls) => calls.filter((m) => m.template.startsWith('mandi_order_confirmed'))
const open = (link) => fetch(`${srv.base}/v1/invoice/${link}`)

describe('the invoice link', () => {
  test('a link reads back as its order, and an altered, expired or malformed one does not', () => {
    const link = billLink('ord_3f9c2a7b1d4e5f60a1b2')
    assert.equal(readBillLink(link), 'ord_3f9c2a7b1d4e5f60a1b2')
    assert.match(link, /^[A-Za-z0-9._-]+$/, 'fits a URL button variable')
    const [id, exp, sig] = link.split('.')
    assert.equal(readBillLink(`ord_3f9c2a7b1d4e5f60a1b3.${exp}.${sig}`), null, "another order's id")
    assert.equal(readBillLink(`${id}.${(parseInt(exp, 36) + 1).toString(36)}.${sig}`), null, 'a later expiry')
    assert.equal(readBillLink(`${id}.${exp}.${sig.slice(0, -1)}${sig.at(-1) === 'A' ? 'B' : 'A'}`), null, 'a changed signature')
    assert.equal(readBillLink(link, new Date(now().getTime() + (BILL_LINK_DAYS + 1) * 86_400_000)), null, 'after it expires')
    for (const bad of ['', 'ord_3f9c2a7b1d4e5f60a1b2', `${id}.${exp}`, '../../etc/passwd', null, undefined]) assert.equal(readBillLink(bad), null)
  })
})

describe('the order confirmation on WhatsApp with the invoice', () => {
  test('off: the plain confirmation, no invoice button', async () => {
    await paidOrder()
    const [m] = confirmations(await sent())
    assert.equal(m.template, 'mandi_order_confirmed')
    assert.equal(m.urlParam, null)
    assert.equal(m.urlParams, undefined)
  })

  test('on: one message with the confirmation, a track button and an invoice button that opens the PDF', async () => {
    env.WHATSAPP_ORDER_INVOICE = true
    const { orderId, number } = await paidOrder()
    const all = confirmations(await sent())
    assert.equal(all.length, 1, 'both in one message')
    const [m] = all
    assert.equal(m.template, 'mandi_order_confirmed_invoice')
    assert.equal(m.params.length, 4)
    assert.equal(m.params[1], number)
    assert.equal(m.urlParams.length, 2)
    assert.equal(m.urlParams[0], orderId, 'Track order: the order page')
    assert.equal(m.urlParam, orderId)
    assert.equal(readBillLink(m.urlParams[1]), orderId, 'Download invoice: the signed link')

    const res = await open(m.urlParams[1])
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'application/pdf')
    assert.match(res.headers.get('content-disposition'), /^inline; filename="MandiMangoes-bill-.+\.pdf"$/)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-')
  })

  test('an order without a bill gets the plain confirmation', async () => {
    env.WHATSAPP_ORDER_INVOICE = true
    setTrustConfig({ BILLS_ENABLED: 'false' })
    await paidOrder()
    const [m] = confirmations(await sent())
    assert.equal(m.template, 'mandi_order_confirmed')
    assert.equal(m.urlParams, undefined)
  })

  test('after a template sync, the invoice template is used only when Meta has approved it with its buttons', async () => {
    env.WHATSAPP_ORDER_INVOICE = true
    const add = (name, status, urlButton) =>
      query(
        `INSERT INTO wa_templates (name, language, status, category, body_params, url_button, synced_at) VALUES ($1, $2, $3, 'UTILITY', 4, $4, $5)
         ON CONFLICT (name, language) DO UPDATE SET status = EXCLUDED.status, url_button = EXCLUDED.url_button`,
        [name, env.WHATSAPP_LANGUAGE, status, urlButton, now()],
      )
    await add('mandi_order_confirmed', 'APPROVED', false)
    await paidOrder()
    assert.equal(confirmations(await sent())[0].template, 'mandi_order_confirmed', 'Meta does not have it yet')

    await add('mandi_order_confirmed_invoice', 'PENDING', true)
    await paidOrder()
    assert.equal(confirmations(await sent())[0].template, 'mandi_order_confirmed', 'waiting for approval')

    await add('mandi_order_confirmed_invoice', 'APPROVED', true)
    await paidOrder()
    assert.equal(confirmations(await sent())[0].template, 'mandi_order_confirmed_invoice')
  })

  test('the link needs no sign-in, and a wrong one, bills off or a deleted account answer 404', async () => {
    env.WHATSAPP_ORDER_INVOICE = true
    const { orderId } = await paidOrder()
    const link = confirmations(await sent())[0].urlParams[1]
    assert.equal((await open(link)).status, 200)
    assert.equal((await open(`${link.slice(0, -1)}${link.at(-1) === 'A' ? 'B' : 'A'}`)).status, 404)
    assert.equal((await open(billLink('ord_00000000000000000000'))).status, 404, 'no such order')
    assert.equal((await open('nonsense')).status, 404)

    setTrustConfig({ BILLS_ENABLED: 'false' })
    assert.equal((await open(link)).status, 404)
    setTrustConfig({})

    // An account can't be deleted while its order is open (409), so the deletion is set directly.
    await query('UPDATE customers SET deleted_at = $2 WHERE id = (SELECT customer_id FROM orders WHERE id = $1)', [orderId, now()])
    assert.equal((await open(billLink(orderId))).status, 404, 'the account was deleted')
  })

  test('the Cloud API request carries both buttons in order', async () => {
    const bodies = []
    const fake = async (_url, init) => {
      bodies.push(JSON.parse(init.body))
      return { ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) }
    }
    const send = metaSender({ token: 't', phoneNumberId: '1', apiVersion: 'v23.0', language: 'en' }, fake)
    await send({ phone: '+919800000001', template: 'mandi_order_confirmed_invoice', params: ['Ravi', 'ORD-1', 'Fri, 16 Oct', '7 AM to 11 AM'], urlParam: 'ord_1', urlParams: ['ord_1', 'ord_1.abc.sig'] })
    assert.deepEqual(bodies[0].template.components.slice(1), [
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'ord_1' }] },
      { type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: 'ord_1.abc.sig' }] },
    ])
  })
})
