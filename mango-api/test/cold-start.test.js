// A fresh serverless instance can get a webhook as its very first request. It
// must load products and rules first, or the chat says "sold out" with stock
// on the shelf (audit H3). This file's first request is the webhook.
import { client, closeAll, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { after, before, test } from 'node:test'
import { query } from '../src/db.js'
import { forgetProductsForTests } from '../src/products.js'

let srv
let api
before(async () => {
  await resetDb()
  await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
  forgetProductsForTests() // what a cold instance has
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  await srv.close()
  await closeAll()
})

const sign = (raw) => `sha256=${createHmac('sha256', 'wa_test_secret').update(raw).digest('hex')}`
let seq = 0
async function say(msg) {
  const raw = JSON.stringify({ entry: [{ changes: [{ value: {
    contacts: [{ wa_id: '919812345670', profile: { name: 'Asha' } }],
    messages: [{ from: '919812345670', id: `wamid.cold${++seq}`, ...msg }],
  } }] }] })
  const r = await api.raw('POST', '/webhooks/whatsapp', { raw, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(raw) } })
  assert.equal(r.status, 200, JSON.stringify(r.body))
}

test('a WhatsApp order on a cold instance sees the stock', async () => {
  await say({ type: 'text', text: { body: 'hi' } })
  await say({ type: 'interactive', interactive: { button_reply: { id: 'ORDER' } } })
  await say({ type: 'text', text: { body: '560034' } })
  const s = await query(`SELECT state FROM wa_sessions WHERE phone = '+919812345670'`)
  assert.equal(s.rows[0].state, 'PICK') // the product list, not "sold out"
})
