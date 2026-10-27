// Customer care (docs/care.md): the help centre with order-linked threads
// (HELP_CENTRE) and mango season subscriptions (SUBSCRIPTIONS). Messages go
// through the outbox to a stub WhatsApp sender and the log push provider;
// nothing reaches Meta, Razorpay or a push service.
import { adminToken, checkout, client, closeAll, customerToken, makeBatch, resetDb, startServer, T0 } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { addDays, now, setNow, todayIST } from '../src/clock.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { HELP_TOPICS } from '../src/help.js'
import { newId } from '../src/ids.js'
import { runMaintenance } from '../src/maintenance.js'
import { paramsFor, sendDueNotifications } from '../src/notify.js'
import { sweepExpiredHoldsEach } from '../src/orders.js'
import { sendDuePush, usePushSender } from '../src/push.js'
import { b64url, generateKeyPair } from '../src/webpush.js'
import { firstDateFor, nominalDates, runSubscriptionJobs, weekdayOf } from '../src/subscriptions.js'

let srv
let api
let manager

const FLAGS = ['HELP_CENTRE', 'HELP_DAILY_LIMIT', 'SUBSCRIPTIONS', 'SUBSCRIPTION_SEASON_END', 'SUBSCRIPTION_LEAD_DAYS', 'WHATSAPP_CARE_UPDATES',
  'WEB_PUSH', 'WEB_PUSH_PROVIDER', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']
const saved = Object.fromEntries(FLAGS.map((k) => [k, env[k]]))
const SERVER_KEYS = generateKeyPair()

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
  Object.assign(env, { HELP_CENTRE: true, SUBSCRIPTIONS: true, SUBSCRIPTION_SEASON_END: '2026-12-31', SUBSCRIPTION_LEAD_DAYS: 2, HELP_DAILY_LIMIT: 5 })
})
afterEach(() => {
  Object.assign(env, saved)
  usePushSender(null)
  setNow(T0)
})

const ADDRESS = '12, 4th Cross, Koramangala, Bengaluru'
const as = (cust) => ({ token: cust.accessToken })
const idem = () => ({ headers: { 'Idempotency-Key': newId('idem') } })

/** A stub WhatsApp sender: records every message, never reaches Meta. */
function whatsappStub() {
  const calls = []
  const sender = async (m) => {
    calls.push(m)
    return `wamid.${calls.length}`
  }
  return { calls, send: () => sendDueNotifications({ sender }) }
}

/** Push on with the log provider and a stub sender that records what would go to the browser. */
function pushOn() {
  Object.assign(env, {
    WEB_PUSH: true, WEB_PUSH_PROVIDER: 'log', VAPID_PUBLIC_KEY: b64url(SERVER_KEYS.publicKey), VAPID_PRIVATE_KEY: b64url(SERVER_KEYS.privateKey),
    VAPID_SUBJECT: 'mailto:ops@mandimangoes.test',
  })
  const calls = []
  usePushSender(async (sub, msg) => {
    calls.push({ endpoint: sub.endpoint, payload: JSON.parse(msg.payload) })
    return { status: 201 }
  })
  return calls
}

async function browserFor(customerId) {
  await query('INSERT INTO push_subscriptions (id, customer_id, endpoint, p256dh, auth, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
    newId('psb'), customerId, `https://fcm.googleapis.com/fcm/send/${newId('x')}`, b64url(generateKeyPair().publicKey), b64url(Buffer.alloc(16, 7)), now(),
  ])
}

async function paidOrder(cust) {
  const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
  assert.equal(c.status, 201, JSON.stringify(c.body))
  assert.equal((await api.post('/v1/dev/pay', { orderId: c.body.orderId, outcome: 'captured' })).status, 200)
  return c.body
}

// ================================================================ help centre

describe('help centre: switch', () => {
  test('off: every help route answers 404, for customers and staff', async () => {
    env.HELP_CENTRE = false
    env.SUBSCRIPTIONS = false
    const cust = await customerToken(api)
    assert.equal((await api.get('/v1/me/help', as(cust))).status, 404)
    assert.equal((await api.get('/v1/me/help/requests', as(cust))).status, 404)
    assert.equal((await api.post('/v1/me/help/requests', { topic: 'OTHER', message: 'hello there' }, as(cust))).status, 404)
    assert.equal((await api.get('/admin/v1/help/requests', { token: manager })).status, 404)
    assert.equal((await api.post('/admin/v1/help/requests/hlp_x/reply', { message: 'hi' }, { token: manager })).status, 404)
    assert.equal((await api.get('/v1/policy')).body.care, undefined)
    assert.equal((await api.get('/admin/v1/auth/me', { token: manager })).body.features.helpDesk, undefined)
    env.HELP_CENTRE = true
    assert.equal((await api.get('/v1/policy')).body.care.helpCentre, true)
    assert.equal((await api.get('/admin/v1/auth/me', { token: manager })).body.features.helpDesk, true)
  })
})

describe('help centre: customers', () => {
  test('a request about an order, a general one, the thread and its status; topics are a fixed list without damage', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    const cust = await customerToken(api)
    const order = await paidOrder(cust)
    const form = await api.get('/v1/me/help', as(cust))
    assert.equal(form.status, 200)
    assert.deepEqual(form.body.topics.map((t) => t.id), Object.keys(HELP_TOPICS))
    // Damaged or missing mangoes are a claim (replacement or rejection), not a help topic.
    assert.ok(!Object.keys(HELP_TOPICS).some((t) => /DAMAGE|MISSING|REFUND|QUALITY/.test(t)))
    assert.equal((await api.post('/v1/me/help/requests', { topic: 'DAMAGED', message: 'squashed mangoes' }, as(cust))).status, 400)

    const r = await api.post('/v1/me/help/requests', { topic: 'DELIVERY', orderId: order.orderId, message: 'Can the rider call before coming?' }, as(cust))
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.match(r.body.number, /^HLP-\d+$/)
    assert.equal(r.body.status, 'OPEN')
    assert.deepEqual(r.body.order, { id: order.orderId, number: order.number })
    assert.deepEqual(r.body.messages.map((m) => [m.from, m.body]), [['YOU', 'Can the rider call before coming?']])
    const general = await api.post('/v1/me/help/requests', { topic: 'ACCOUNT', message: 'How do I change my name?' }, as(cust))
    assert.equal(general.status, 201)
    assert.equal(general.body.order, null)

    const list = await api.get('/v1/me/help/requests', as(cust))
    assert.deepEqual(list.body.items.map((t) => t.id).sort(), [r.body.id, general.body.id].sort())
    const reply = await api.post(`/v1/me/help/requests/${r.body.id}/messages`, { message: 'Before 6 pm please' }, as(cust))
    assert.equal(reply.status, 201)
    assert.equal(reply.body.messages.length, 2)
    // No claim was made: claims stay their own flow.
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM claims')).rows[0].n, 0)
  })

  test('a customer sees only their own requests, and can name only their own orders', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    const a = await customerToken(api)
    const b = await customerToken(api)
    const order = await paidOrder(a)
    const t = await api.post('/v1/me/help/requests', { topic: 'PAYMENT', orderId: order.orderId, message: 'Was I charged twice?' }, as(a))
    assert.equal(t.status, 201)
    for (const r of [
      await api.get(`/v1/me/help/requests/${t.body.id}`, as(b)),
      await api.post(`/v1/me/help/requests/${t.body.id}/messages`, { message: 'me too' }, as(b)),
      await api.post('/v1/me/help/requests', { topic: 'PAYMENT', orderId: order.orderId, message: 'about your order' }, as(b)),
    ]) {
      assert.equal(r.status, 404)
    }
    assert.equal((await api.get('/v1/me/help/requests/hlp_none', as(b))).status, 404)
    assert.deepEqual((await api.get('/v1/me/help/requests', as(b))).body.items, [])
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM help_messages')).rows[0].n, 1)
    assert.equal((await api.get('/v1/me/help/requests')).status, 401)
  })

  test('message lengths are checked by the API', async () => {
    const cust = await customerToken(api)
    const short = await api.post('/v1/me/help/requests', { topic: 'OTHER', message: 'hi' }, as(cust))
    assert.equal(short.status, 400)
    assert.equal((await api.post('/v1/me/help/requests', { topic: 'OTHER', message: 'x'.repeat(2001) }, as(cust))).status, 400)
    assert.equal((await api.post('/v1/me/help/requests', { topic: 'OTHER', message: '       hi       ' }, as(cust))).status, 400, 'spaces do not count')
    const ok = await api.post('/v1/me/help/requests', { topic: 'OTHER', message: 'x'.repeat(2000) }, as(cust))
    assert.equal(ok.status, 201)
    assert.equal((await api.post(`/v1/me/help/requests/${ok.body.id}/messages`, { message: '   ' }, as(cust))).status, 400)
    assert.equal((await api.post(`/v1/me/help/requests/${ok.body.id}/messages`, { message: 'y'.repeat(2001) }, as(cust))).status, 400)
    assert.equal((await api.post(`/v1/me/help/requests/${ok.body.id}/messages`, { message: 'ok' }, as(cust))).status, 201)
    const t = (await query('SELECT id FROM help_tickets')).rows[0].id
    assert.equal((await api.post(`/admin/v1/help/requests/${t}/reply`, { message: '' }, { token: manager })).status, 400)
    assert.equal((await api.post(`/admin/v1/help/requests/${t}/reply`, { message: 'z'.repeat(2001) }, { token: manager })).status, 400)
  })

  test('five new requests a day per customer, counted over 24 hours; replies to one are not new requests', async () => {
    const cust = await customerToken(api)
    const other = await customerToken(api)
    const ids = []
    for (let i = 0; i < 5; i++) {
      const r = await api.post('/v1/me/help/requests', { topic: 'OTHER', message: `question number ${i}` }, as(cust))
      assert.equal(r.status, 201)
      ids.push(r.body.id)
    }
    const sixth = await api.post('/v1/me/help/requests', { topic: 'OTHER', message: 'one more question' }, as(cust))
    assert.equal(sixth.status, 429)
    assert.equal(sixth.body.error.code, 'HELP_LIMIT')
    assert.equal((await api.post(`/v1/me/help/requests/${ids[0]}/messages`, { message: 'still here' }, as(cust))).status, 201)
    assert.equal((await api.post('/v1/me/help/requests', { topic: 'OTHER', message: 'my own first' }, as(other))).status, 201, 'per customer')
    setNow(new Date(Date.parse(T0) + 24 * 3_600_000 + 60_000))
    assert.equal((await api.post('/v1/me/help/requests', { topic: 'OTHER', message: 'a new day' }, as(cust))).status, 201)
    // Twenty messages a day on one request (the first one is now more than a day old), then 429.
    for (let i = 0; i < 20; i++) assert.equal((await api.post(`/v1/me/help/requests/${ids[1]}/messages`, { message: `m${i}` }, as(cust))).status, 201)
    assert.equal((await api.post(`/v1/me/help/requests/${ids[1]}/messages`, { message: 'again' }, as(cust))).status, 429)
  })
})

describe('help centre: the help desk', () => {
  test('operators answer: the inbox, filters, a reply that is audited and told to the customer, resolve and reopen', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    env.WHATSAPP_CARE_UPDATES = true
    const pushes = pushOn()
    const cust = await customerToken(api, '9876512345')
    await query('UPDATE customers SET name = $2 WHERE id = $1', [cust.customer.id, 'Asha'])
    await browserFor(cust.customer.id)
    const order = await paidOrder(cust)
    const t = (await api.post('/v1/me/help/requests', { topic: 'DELIVERY', orderId: order.orderId, message: 'Please deliver after 5 pm' }, as(cust))).body
    await api.post('/v1/me/help/requests', { topic: 'ACCOUNT', message: 'How do I sign out?' }, as(cust))
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')

    const inbox = await api.get('/admin/v1/help/requests', { token: ops })
    assert.equal(inbox.status, 200)
    assert.equal(inbox.body.items.length, 2)
    assert.deepEqual(inbox.body.counts, { OPEN: 2, WAITING_CUSTOMER: 0, RESOLVED: 0 })
    // The desk never shows the full number.
    assert.ok(!JSON.stringify(inbox.body).includes('9876512345'))
    assert.equal(inbox.body.items[0].customer.phoneMasked, '******2345')
    assert.equal((await api.get('/admin/v1/help/requests?topic=ACCOUNT', { token: ops })).body.items.length, 1)
    assert.deepEqual((await api.get(`/admin/v1/help/requests?q=${order.number}`, { token: ops })).body.items.map((x) => x.id), [t.id])
    assert.deepEqual((await api.get(`/admin/v1/help/requests?q=${t.number.toLowerCase()}`, { token: ops })).body.items.map((x) => x.id), [t.id])
    assert.equal((await api.get('/admin/v1/help/requests?status=NOPE', { token: ops })).status, 400)
    const detail = await api.get(`/admin/v1/help/requests/${t.id}`, { token: ops })
    assert.equal(detail.body.order.number, order.number)
    assert.ok(!JSON.stringify(detail.body).includes('9876512345'))

    const sent = await api.post(`/admin/v1/help/requests/${t.id}/reply`, { message: 'Done, the rider will come after 5 pm.' }, { token: ops })
    assert.equal(sent.status, 201, JSON.stringify(sent.body))
    assert.equal(sent.body.status, 'WAITING_CUSTOMER')
    assert.equal(sent.body.messages.at(-1).staffEmail, 'ops@mandimangoes.test')
    // Audited in the same transaction: who, which request, which message; not a copy of the text.
    const audit = (await query(`SELECT * FROM staff_audit WHERE action = 'REPLY help request'`)).rows
    assert.equal(audit.length, 1)
    assert.equal(audit[0].email, 'ops@mandimangoes.test')
    assert.equal(audit[0].target, t.id)
    assert.equal(audit[0].detail.messageId, sent.body.messages.at(-1).id)
    assert.ok(!JSON.stringify(audit[0].detail).includes('rider will come'))

    // The customer sees the shop's reply as MandiMangoes, not who wrote it, and the status.
    const mine = await api.get(`/v1/me/help/requests/${t.id}`, as(cust))
    assert.equal(mine.body.status, 'WAITING_CUSTOMER')
    assert.deepEqual(mine.body.messages.at(-1), { id: mine.body.messages.at(-1).id, from: 'MANDIMANGOES', body: 'Done, the rider will come after 5 pm.', at: mine.body.messages.at(-1).at })
    assert.ok(!JSON.stringify(mine.body).includes('ops@'))

    // Told through the existing interfaces: WhatsApp (stub sender) and a browser push (log provider).
    const wa = whatsappStub()
    await wa.send()
    const helpMsgs = wa.calls.filter((m) => m.template === 'mandi_help_reply')
    assert.equal(helpMsgs.length, 1)
    assert.equal(helpMsgs[0].phone, '+919876512345')
    assert.deepEqual(helpMsgs[0].params.slice(0, 2), ['Asha', t.number])
    assert.match(helpMsgs[0].params[2], new RegExp(`/help/requests/${t.id}$`))
    assert.ok(!helpMsgs[0].params.join(' ').includes('9876512345'), 'no phone in the message text')
    await sendDuePush()
    const helpPush = pushes.filter((p) => p.payload.url === `/help/requests/${t.id}`)
    assert.equal(helpPush.length, 1)
    assert.equal(helpPush[0].payload.body, 'MandiMangoes replied to your help request')

    // The customer writes back: it is the shop's turn again.
    assert.equal((await api.post(`/v1/me/help/requests/${t.id}/messages`, { message: 'Thank you' }, as(cust))).body.status, 'OPEN')
    const resolved = await api.post(`/admin/v1/help/requests/${t.id}/resolve`, {}, { token: ops })
    assert.equal(resolved.body.status, 'RESOLVED')
    assert.equal(resolved.body.resolvedBy, 'ops@mandimangoes.test')
    assert.equal((await api.post(`/admin/v1/help/requests/${t.id}/resolve`, {}, { token: ops })).status, 409)
    assert.equal((await api.get('/admin/v1/help/requests?status=RESOLVED', { token: ops })).body.items.length, 1)
    assert.equal((await api.post(`/admin/v1/help/requests/${t.id}/reopen`, {}, { token: manager })).body.status, 'OPEN')
    assert.equal((await api.post(`/admin/v1/help/requests/${t.id}/reopen`, {}, { token: manager })).status, 409)
    const actions = (await query(`SELECT action, email FROM staff_audit WHERE target = $1 ORDER BY created_at`, [t.id])).rows
    assert.deepEqual(actions.map((a) => a.action), ['REPLY help request', 'RESOLVE help request', 'REOPEN help request'])
    assert.equal((await api.post('/admin/v1/help/requests/hlp_none/reply', { message: 'hello' }, { token: ops })).status, 404)
  })

  test('without the WhatsApp templates approved the reply is pushed only; with push off too it is on the shop page alone', async () => {
    const cust = await customerToken(api)
    const t = (await api.post('/v1/me/help/requests', { topic: 'OTHER', message: 'Is Kesar coming back?' }, as(cust))).body
    await api.post(`/admin/v1/help/requests/${t.id}/reply`, { message: 'Next week' }, { token: manager })
    assert.equal((await query(`SELECT COUNT(*)::int AS n FROM notifications WHERE kind = 'HELP_REPLY'`)).rows[0].n, 0)
    assert.equal((await query(`SELECT COUNT(*)::int AS n FROM push_messages WHERE kind = 'HELP_REPLY'`)).rows[0].n, 0)
    assert.equal((await api.get(`/v1/me/help/requests/${t.id}`, as(cust))).body.messages.at(-1).body, 'Next week')
  })

  test('packers, QC and riders have no help desk', async () => {
    const cust = await customerToken(api)
    const t = (await api.post('/v1/me/help/requests', { topic: 'OTHER', message: 'A question for you' }, as(cust))).body
    const packer = await adminToken(api, 'packer@mandimangoes.test', 'packer123')
    const qc = await adminToken(api, 'qc@mandimangoes.test', 'qc123')
    for (const token of [packer, qc]) {
      assert.equal((await api.get('/admin/v1/help/requests', { token })).status, 403)
      assert.equal((await api.get(`/admin/v1/help/requests/${t.id}`, { token })).status, 403)
      assert.equal((await api.post(`/admin/v1/help/requests/${t.id}/reply`, { message: 'hi' }, { token })).status, 403)
    }
    assert.equal((await api.get('/admin/v1/help/requests', as(cust))).status, 401)
  })

  test('deleting the account removes what the customer wrote; the export carries the requests', async () => {
    const cust = await customerToken(api)
    const t = (await api.post('/v1/me/help/requests', { topic: 'ACCOUNT', message: 'My address is 5 Main Road' }, as(cust))).body
    await api.post(`/admin/v1/help/requests/${t.id}/reply`, { message: 'Noted: 5 Main Road' }, { token: manager })
    const exp = await api.get('/v1/me/export', as(cust))
    assert.equal(exp.body.helpRequests.length, 1)
    assert.deepEqual(exp.body.helpRequests[0].messages.map((m) => m.from), ['you', 'MandiMangoes'])
    assert.equal((await api.del('/v1/me', as(cust))).status, 204)
    const bodies = (await query('SELECT body FROM help_messages')).rows.map((r) => r.body)
    assert.ok(bodies.every((b) => b === '(removed when the account was deleted)'), bodies.join(' | '))
    assert.equal((await query('SELECT status FROM help_tickets WHERE id = $1', [t.id])).rows[0].status, 'RESOLVED')
  })
})

// ================================================================ subscriptions

/** A saved address for the customer, as checkout would have remembered. */
async function savedAddress(customerId, pincode = '560034') {
  const id = newId('adr')
  await query('INSERT INTO customer_addresses (id, customer_id, name, address, pincode, created_at, last_used_at) VALUES ($1, $2, $3, $4, $5, $6, $6)', [
    id, customerId, 'Asha', ADDRESS, pincode, now(),
  ])
  return id
}

/** Today is Thu 15 Oct 2026, 10:00 IST: the earliest delivery is Fri 16, and Sat 17 is two days ahead. */
const SAT = 6
async function subscribe(cust, body = {}) {
  const addressId = body.addressId ?? (await savedAddress(cust.customer.id))
  return api.post('/v1/me/subscriptions', { sku: 'ALP-3', stage: 'RIPE', qty: 2, frequency: 'WEEKLY', weekday: SAT, addressId, endDate: '2026-11-30', ...body }, as(cust))
}

const cycles = (subId) => query('SELECT * FROM subscription_cycles WHERE subscription_id = $1 ORDER BY scheduled_for', [subId]).then((r) => r.rows)
const heldFor = (customerId) =>
  query(`SELECT COALESCE(SUM(s.quantity), 0)::int AS n FROM order_stock s JOIN orders o ON o.id = s.order_id WHERE o.customer_id = $1 AND s.state = 'held'`, [customerId]).then((r) => r.rows[0].n)

describe('subscriptions: dates', () => {
  test('weekdays, the first date a customer can still order for, and nominal dates', () => {
    assert.equal(weekdayOf('2026-10-15'), 4)
    assert.equal(weekdayOf('2026-10-18'), 7)
    assert.equal(firstDateFor(SAT), '2026-10-17')
    assert.equal(firstDateFor(5), '2026-10-16')
    assert.equal(firstDateFor(4), '2026-10-22', 'Thursday is today: the next one')
    const s = { first_date: '2026-10-17', end_date: '2026-11-14', frequency: 'FORTNIGHTLY' }
    assert.deepEqual(nominalDates(s, '2026-10-01', '2026-12-31'), ['2026-10-17', '2026-10-31', '2026-11-14'])
    assert.deepEqual(nominalDates({ ...s, frequency: 'WEEKLY' }, '2026-10-20', '2026-11-01'), ['2026-10-24', '2026-10-31'])
  })
})

describe('subscriptions: starting one', () => {
  test('off: every subscription route answers 404', async () => {
    env.SUBSCRIPTIONS = false
    const cust = await customerToken(api)
    assert.equal((await api.get('/v1/me/subscriptions', as(cust))).status, 404)
    assert.equal((await subscribe(cust)).status, 404)
    assert.equal((await api.post('/v1/me/subscriptions/sub_x/cycles/cyc_x/pay', {}, { ...as(cust), ...idem() })).status, 404)
    assert.equal((await api.get('/admin/v1/subscriptions', { token: manager })).status, 404)
    assert.equal((await api.post('/admin/v1/subscriptions/sub_x/pause', { reason: 'testing it' }, { token: manager })).status, 404)
  })

  test('the box, frequency, day, slot, address and an end date no later than the season end are all checked by the API', async () => {
    const cust = await customerToken(api)
    const other = await customerToken(api)
    const theirs = await savedAddress(other.customer.id)
    assert.equal((await subscribe(cust, { endDate: '2027-01-15' })).body.error.code, 'END_AFTER_SEASON')
    assert.equal((await subscribe(cust, { endDate: '2026-10-16' })).body.error.code, 'END_TOO_SOON')
    assert.equal((await subscribe(cust, { endDate: '2026-10-41' })).status, 400)
    assert.equal((await subscribe(cust, { sku: 'NOPE-1' })).body.error.code, 'INVALID_SKU')
    assert.equal((await subscribe(cust, { qty: 0 })).status, 400)
    assert.equal((await subscribe(cust, { qty: 21 })).status, 400)
    assert.equal((await subscribe(cust, { frequency: 'DAILY' })).status, 400)
    assert.equal((await subscribe(cust, { weekday: 8 })).status, 400)
    assert.equal((await subscribe(cust, { stage: 'OVERRIPE' })).status, 400)
    assert.equal((await subscribe(cust, { addressId: theirs })).status, 404, "another customer's address")
    assert.equal((await subscribe(cust, { wallet: true })).status, 400, 'no wallet, no stored payment')
    // Slots in use: one must be chosen, and an active one.
    await query(`INSERT INTO delivery_slots (id, label, starts_at, ends_at, max_boxes, sort) VALUES ('slt_am', 'Morning', '08:00', '12:00', 40, 1)`)
    assert.equal((await subscribe(cust)).body.error.code, 'SLOT_REQUIRED')
    assert.equal((await subscribe(cust, { slotId: 'slt_none' })).body.error.code, 'SLOT_INVALID')
    const ok = await subscribe(cust, { slotId: 'slt_am' })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    assert.equal(ok.body.status, 'ACTIVE')
    assert.equal(ok.body.firstDate, '2026-10-17')
    assert.equal(ok.body.weekday, SAT)
    assert.match(ok.body.number, /^SUB-\d+$/)
    assert.equal((await subscribe(cust, { slotId: 'slt_am', addressId: (await query('SELECT id FROM customer_addresses WHERE customer_id = $1 LIMIT 1', [cust.customer.id])).rows[0].id })).body.error.code, 'DUPLICATE_SUBSCRIPTION')
    // The season's end comes from SUBSCRIPTION_SEASON_END; without it nothing can start.
    env.SUBSCRIPTION_SEASON_END = undefined
    assert.equal((await subscribe(cust, { slotId: 'slt_am', stage: 'SEMI_RIPE' })).body.error.code, 'SUBSCRIPTIONS_CLOSED')
    assert.equal((await api.get('/v1/me/subscriptions', as(cust))).body.open, false)
  })

  test('three running at most; a customer without a mobile number is asked for one', async () => {
    const cust = await customerToken(api)
    for (const stage of ['RAW', 'SEMI_RIPE', 'RIPE']) assert.equal((await subscribe(cust, { stage })).status, 201)
    assert.equal((await subscribe(cust, { stage: 'RIPE', qty: 1, sku: 'BAD-3' })).body.error.code, 'TOO_MANY_SUBSCRIPTIONS')
    const g = await customerToken(api)
    await query('UPDATE customers SET phone = NULL WHERE id = $1', [g.customer.id])
    assert.equal((await subscribe(g)).body.error.code, 'PHONE_REQUIRED')
  })
})

describe('subscriptions: the scheduler', () => {
  test('two days ahead a cycle is set up once, with a reminder, however often the job runs; it holds no stock', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    env.WHATSAPP_CARE_UPDATES = true
    const pushes = pushOn()
    const cust = await customerToken(api, '9876598765')
    await browserFor(cust.customer.id)
    const sub = (await subscribe(cust)).body
    // Sat 17 is two days ahead: set up when the subscription starts.
    let ys = await cycles(sub.id)
    assert.deepEqual(ys.map((y) => [y.scheduled_for, y.delivery_date, y.status]), [['2026-10-17', '2026-10-17', 'DUE']])
    // Retries, overlaps: still one cycle and one reminder.
    await runSubscriptionJobs()
    await Promise.all([runSubscriptionJobs(), runSubscriptionJobs(), runSubscriptionJobs()])
    const wa = whatsappStub()
    await wa.send()
    const due = wa.calls.filter((m) => m.template === 'mandi_subscription_due')
    assert.equal(due.length, 1)
    assert.equal(due[0].params[1], '2 × Alphonso 3kg Box')
    assert.equal(due[0].params[2], 'Sat, 17 Oct')
    assert.match(due[0].params[3], new RegExp(`/account/subscriptions/${sub.id}$`))
    // The maintenance loop runs the job too (and sends the push through the stub).
    await runMaintenance({ forceAll: true })
    ys = await cycles(sub.id)
    assert.equal(ys.length, 1)
    assert.equal((await query(`SELECT COUNT(*)::int AS n FROM notifications WHERE kind = 'SUBSCRIPTION_DUE'`)).rows[0].n, 1)
    assert.equal((await query(`SELECT COUNT(*)::int AS n FROM push_messages WHERE kind = 'SUBSCRIPTION_DUE'`)).rows[0].n, 1)
    // No order yet, so nothing held and no day's room taken.
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM orders WHERE customer_id = $1', [cust.customer.id])).rows[0].n, 0)
    assert.equal(await heldFor(cust.customer.id), 0)

    await sendDuePush()
    assert.deepEqual(pushes.map((p) => p.payload.url), [`/account/subscriptions/${sub.id}`])

    const view = (await api.get(`/v1/me/subscriptions/${sub.id}`, as(cust))).body
    assert.equal(view.cycles[0].canPay, true)
    assert.deepEqual(view.upcoming.slice(0, 2), ['2026-10-24', '2026-10-31'])

    // A week on, the next one; nothing more for the week after yet.
    setNow('2026-10-22T04:30:00Z')
    // The first batch is too old by now: with nothing in stock for the week, no cycle yet (the next run tries again).
    await runSubscriptionJobs()
    assert.deepEqual((await cycles(sub.id)).map((y) => y.scheduled_for), ['2026-10-17'])
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    await runSubscriptionJobs()
    assert.deepEqual((await cycles(sub.id)).map((y) => y.scheduled_for), ['2026-10-17', '2026-10-24'])
    // Unpaid, the 17th's box can still be paid for and come on Fri 23, the last day of its week.
    assert.equal((await cycles(sub.id))[0].status, 'DUE')
    setNow('2026-10-23T04:30:00Z')
    await runSubscriptionJobs()
    assert.equal((await cycles(sub.id))[0].status, 'MISSED', 'the 17th was never paid for')
    assert.equal((await cycles(sub.id)).length, 2)
  })

  test('fortnightly cycles skip a week, and none is made past the end date', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    const cust = await customerToken(api)
    const sub = (await subscribe(cust, { frequency: 'FORTNIGHTLY', endDate: '2026-10-31' })).body
    for (const at of ['2026-10-22T04:30:00Z', '2026-10-29T04:30:00Z', '2026-11-05T04:30:00Z', '2026-11-12T04:30:00Z']) {
      setNow(at)
      await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
      await runSubscriptionJobs()
    }
    assert.deepEqual((await cycles(sub.id)).map((y) => y.scheduled_for), ['2026-10-17', '2026-10-31'])
  })

  test('a full, closed or sold-out day moves the cycle to the next day with room and stock', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    const cust = await customerToken(api)
    // Sat 17 is closed: Sun 18 instead (age 8 there is past the limit, so stock must be younger).
    await query(`INSERT INTO delivery_calendar (date, is_open) VALUES ('2026-10-17', FALSE)`)
    await makeBatch({ age: 4, rating: 'SEMI_RIPE', lines: { 'ALP-3': 5 } })
    const sub = (await subscribe(cust)).body
    let ys = await cycles(sub.id)
    assert.deepEqual(ys.map((y) => [y.scheduled_for, y.delivery_date]), [['2026-10-17', '2026-10-18']])
    assert.match(ys[0].note, /2026-10-17 was full, closed or out of stock/)

    // A full slot: the subscription's slot is full on the day, another slot with room is used.
    const b = await customerToken(api)
    await query(`INSERT INTO delivery_slots (id, label, starts_at, ends_at, max_boxes, sort) VALUES ('slt_am', 'Morning', '08:00', '12:00', 1, 1), ('slt_pm', 'Evening', '16:00', '20:00', 40, 2)`)
    await query(`DELETE FROM delivery_calendar WHERE date = '2026-10-17'`)
    const s2 = (await subscribe(b, { slotId: 'slt_am' })).body
    ys = await cycles(s2.id)
    assert.deepEqual(ys.map((y) => [y.delivery_date, y.slot_id]), [['2026-10-17', 'slt_pm']])

    // No stock and no room anywhere in the week: nothing is set up yet, and the job tries again later.
    const c = await customerToken(api)
    const s3 = (await subscribe(c, { sku: 'BAD-3' })).body
    assert.deepEqual(await cycles(s3.id), [])
  })
})

describe('subscriptions: paying for a box', () => {
  test('Pay makes an ordinary unpaid order with the checkout rules; a retry or second tap gives the same order', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    const cust = await customerToken(api)
    const sub = (await subscribe(cust)).body
    const [y] = await cycles(sub.id)
    const key = { headers: { 'Idempotency-Key': 'pay-1' } }
    assert.equal((await api.post(`/v1/me/subscriptions/${sub.id}/cycles/${y.id}/pay`, {}, as(cust))).body.error.code, 'IDEMPOTENCY_KEY_REQUIRED')
    const pay = await api.post(`/v1/me/subscriptions/${sub.id}/cycles/${y.id}/pay`, {}, { ...as(cust), ...key })
    assert.equal(pay.status, 201, JSON.stringify(pay.body))
    assert.equal(pay.body.status, 'PAYMENT_PENDING')
    assert.equal(pay.body.deliveryDate, '2026-10-17')
    assert.equal(pay.body.total, 2 * (await query(`SELECT price FROM products WHERE sku = 'ALP-3'`)).rows[0].price)
    assert.ok(pay.body.razorpayOrderId, 'the payment is started as at checkout')
    // Held only now, for the checkout's hold minutes, like any unpaid order.
    assert.equal(await heldFor(cust.customer.id), 2)
    const hold = new Date(pay.body.holdExpiresAt).getTime() - now().getTime()
    assert.ok(hold > 9 * 60_000 && hold <= 10 * 60_000, `${hold}`)
    const again = await api.post(`/v1/me/subscriptions/${sub.id}/cycles/${y.id}/pay`, {}, { ...as(cust), ...key })
    assert.equal(again.status, 200)
    assert.equal(again.body.orderId, pay.body.orderId)
    const tap2 = await api.post(`/v1/me/subscriptions/${sub.id}/cycles/${y.id}/pay`, {}, { ...as(cust), ...idem() })
    assert.equal(tap2.status, 200)
    assert.equal(tap2.body.orderId, pay.body.orderId)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM orders WHERE customer_id = $1', [cust.customer.id])).rows[0].n, 1)
    assert.equal(await heldFor(cust.customer.id), 2)

    // Paid like any order: the cycle reads as paid, and can't be paid again.
    assert.equal((await api.post('/v1/dev/pay', { orderId: pay.body.orderId, outcome: 'captured' })).status, 200)
    const view = (await api.get(`/v1/me/subscriptions/${sub.id}`, as(cust))).body
    assert.equal(view.cycles[0].paid, true)
    assert.equal(view.cycles[0].canPay, false)
    assert.equal((await api.post(`/v1/me/subscriptions/${sub.id}/cycles/${y.id}/pay`, {}, { ...as(cust), ...idem() })).body.error.code, 'ALREADY_PAID')
  })

  test('the unpaid-order limit applies: an unpaid checkout order blocks paying a box, and the other way round', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    const cust = await customerToken(api)
    const sub = (await subscribe(cust)).body
    const [y] = await cycles(sub.id)
    const unpaid = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
    assert.equal(unpaid.status, 201)
    const pay = await api.post(`/v1/me/subscriptions/${sub.id}/cycles/${y.id}/pay`, {}, { ...as(cust), ...idem() })
    assert.equal(pay.status, 409)
    assert.equal(pay.body.error.code, 'UNPAID_ORDER_EXISTS')
    assert.equal((await cycles(sub.id))[0].status, 'DUE')
    await api.post(`/v1/orders/${unpaid.body.orderId}/cancel`, {}, as(cust))
    assert.equal((await api.post(`/v1/me/subscriptions/${sub.id}/cycles/${y.id}/pay`, {}, { ...as(cust), ...idem() })).status, 201)
    const second = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
    assert.equal(second.body.error.code, 'UNPAID_ORDER_EXISTS')
  })

  test('a day that filled up after the reminder moves the order to the next day with room, as a late payment does', async () => {
    await makeBatch({ age: 4, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    const cust = await customerToken(api)
    const sub = (await subscribe(cust)).body
    const [y] = await cycles(sub.id)
    assert.equal(y.delivery_date, '2026-10-17')
    await query(`INSERT INTO delivery_calendar (date, is_open, max_boxes) VALUES ('2026-10-17', TRUE, 0)`)
    const pay = await api.post(`/v1/me/subscriptions/${sub.id}/cycles/${y.id}/pay`, {}, { ...as(cust), ...idem() })
    assert.equal(pay.status, 201, JSON.stringify(pay.body))
    assert.equal(pay.body.deliveryDate, '2026-10-18')
    const [after] = await cycles(sub.id)
    assert.equal(after.delivery_date, '2026-10-18')
    assert.match(after.note, /Moved to 2026-10-18/)
    // Nothing left before the next box: refused, nothing made.
    const b = await customerToken(api)
    const s2 = (await subscribe(b, { stage: 'RIPE', qty: 1 })).body
    await query(`INSERT INTO delivery_calendar (date, is_open, max_boxes) VALUES ('2026-10-18', TRUE, 0), ('2026-10-19', FALSE, NULL), ('2026-10-20', FALSE, NULL)`)
    const [y2] = await cycles(s2.id)
    const r = await api.post(`/v1/me/subscriptions/${s2.id}/cycles/${y2.id}/pay`, {}, { ...as(b), ...idem() })
    assert.equal(r.status, 409)
    assert.equal(r.body.error.code, 'CYCLE_NO_DAY')
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM orders WHERE customer_id = $1', [b.customer.id])).rows[0].n, 0)
  })

  test('a hold that runs out frees the boxes as for any order, and Pay is offered again', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    const cust = await customerToken(api)
    const sub = (await subscribe(cust)).body
    const [y] = await cycles(sub.id)
    const first = await api.post(`/v1/me/subscriptions/${sub.id}/cycles/${y.id}/pay`, {}, { ...as(cust), ...idem() })
    assert.equal(first.status, 201)
    setNow(new Date(Date.parse(T0) + 15 * 60_000))
    await sweepExpiredHoldsEach()
    assert.equal(await heldFor(cust.customer.id), 0)
    assert.equal((await query('SELECT status FROM orders WHERE id = $1', [first.body.orderId])).rows[0].status, 'CANCELLED')
    assert.equal((await api.get(`/v1/me/subscriptions/${sub.id}`, as(cust))).body.cycles[0].canPay, true)
    const second = await api.post(`/v1/me/subscriptions/${sub.id}/cycles/${y.id}/pay`, {}, { ...as(cust), ...idem() })
    assert.equal(second.status, 201)
    assert.notEqual(second.body.orderId, first.body.orderId)
  })
})

describe('subscriptions: skip, pause, resume and cancel', () => {
  test('skip one ahead of time or once set up; a paid one is cancelled from its order instead', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    env.WHATSAPP_CARE_UPDATES = true
    const cust = await customerToken(api)
    const sub = (await subscribe(cust)).body
    const skipAhead = await api.post(`/v1/me/subscriptions/${sub.id}/skip`, { scheduledFor: '2026-10-24' }, as(cust))
    assert.equal(skipAhead.status, 200, JSON.stringify(skipAhead.body))
    assert.ok(!skipAhead.body.upcoming.includes('2026-10-24'))
    assert.equal((await api.post(`/v1/me/subscriptions/${sub.id}/skip`, { scheduledFor: '2026-10-25' }, as(cust))).body.error.code, 'INVALID_DATE', 'not one of its days')
    assert.equal((await api.post(`/v1/me/subscriptions/${sub.id}/skip`, { scheduledFor: '2026-12-05' }, as(cust))).body.error.code, 'INVALID_DATE', 'after the end date')
    assert.equal((await api.post(`/v1/me/subscriptions/${sub.id}/skip`, { scheduledFor: '2026-10-24' }, as(cust))).status, 409)
    // The one already set up, with its reminder waiting: skipped, and the reminder is not sent.
    assert.equal((await api.post(`/v1/me/subscriptions/${sub.id}/skip`, { scheduledFor: '2026-10-17' }, as(cust))).status, 200)
    const wa = whatsappStub()
    await wa.send()
    assert.equal(wa.calls.length, 0)
    assert.equal((await query(`SELECT status FROM notifications WHERE kind = 'SUBSCRIPTION_DUE'`)).rows[0].status, 'SKIPPED')
    setNow('2026-10-22T04:30:00Z')
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    await runSubscriptionJobs()
    assert.deepEqual((await cycles(sub.id)).map((y) => [y.scheduled_for, y.status]), [['2026-10-17', 'SKIPPED'], ['2026-10-24', 'SKIPPED']])
    setNow('2026-10-29T04:30:00Z')
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    await runSubscriptionJobs()
    const y31 = (await cycles(sub.id)).find((y) => y.scheduled_for === '2026-10-31')
    assert.equal(y31.status, 'DUE')
    const pay = await api.post(`/v1/me/subscriptions/${sub.id}/cycles/${y31.id}/pay`, {}, { ...as(cust), ...idem() })
    await api.post('/v1/dev/pay', { orderId: pay.body.orderId, outcome: 'captured' })
    assert.equal((await api.post(`/v1/me/subscriptions/${sub.id}/skip`, { scheduledFor: '2026-10-31' }, as(cust))).body.error.code, 'ALREADY_PAID')
  })

  test('skipping a box whose payment was started cancels that unpaid order and frees its boxes', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    const cust = await customerToken(api)
    const sub = (await subscribe(cust)).body
    const [y] = await cycles(sub.id)
    const pay = await api.post(`/v1/me/subscriptions/${sub.id}/cycles/${y.id}/pay`, {}, { ...as(cust), ...idem() })
    assert.equal(await heldFor(cust.customer.id), 2)
    assert.equal((await api.post(`/v1/me/subscriptions/${sub.id}/skip`, { scheduledFor: '2026-10-17' }, as(cust))).status, 200)
    assert.equal((await query('SELECT status FROM orders WHERE id = $1', [pay.body.orderId])).rows[0].status, 'CANCELLED')
    assert.equal(await heldFor(cust.customer.id), 0)
  })

  test('pause calls off the unpaid box and stops new ones; resume starts again without counting the pause as missed; cancel ends it', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    const cust = await customerToken(api)
    const sub = (await subscribe(cust)).body
    const paused = await api.post(`/v1/me/subscriptions/${sub.id}/pause`, {}, as(cust))
    assert.equal(paused.body.status, 'PAUSED')
    assert.equal(paused.body.cycles[0].status, 'CANCELLED')
    assert.equal(paused.body.cycles[0].canPay, false)
    assert.equal((await api.post(`/v1/me/subscriptions/${sub.id}/pause`, {}, as(cust))).status, 409)
    const [y] = await cycles(sub.id)
    assert.equal((await api.post(`/v1/me/subscriptions/${sub.id}/cycles/${y.id}/pay`, {}, { ...as(cust), ...idem() })).body.error.code, 'NOT_ACTIVE')
    setNow('2026-10-29T04:30:00Z')
    await runSubscriptionJobs()
    assert.equal((await cycles(sub.id)).length, 1, 'nothing while paused')
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    const resumed = await api.post(`/v1/me/subscriptions/${sub.id}/resume`, {}, as(cust))
    assert.equal(resumed.body.status, 'ACTIVE')
    assert.deepEqual((await cycles(sub.id)).map((y) => [y.scheduled_for, y.status]), [['2026-10-17', 'CANCELLED'], ['2026-10-31', 'DUE']], 'the 24th passed while paused: not missed')
    const cancelled = await api.post(`/v1/me/subscriptions/${sub.id}/cancel`, {}, as(cust))
    assert.equal(cancelled.body.status, 'CANCELLED')
    assert.deepEqual(cancelled.body.upcoming, [])
    assert.equal((await api.post(`/v1/me/subscriptions/${sub.id}/resume`, {}, as(cust))).status, 409)
    setNow('2026-11-05T04:30:00Z')
    await runSubscriptionJobs()
    assert.equal((await cycles(sub.id)).filter((y) => y.status === 'DUE').length, 0)
    const history = (await api.get(`/v1/me/subscriptions/${sub.id}`, as(cust))).body.history.map((h) => h.action)
    assert.deepEqual(history.slice(0, 4), ['CANCELLED', 'CYCLE_DUE', 'RESUMED', 'PAUSED'])
  })

  test("one customer can't see, change or pay for another's subscription", async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    const a = await customerToken(api)
    const b = await customerToken(api)
    const sub = (await subscribe(a)).body
    const [y] = await cycles(sub.id)
    for (const r of [
      await api.get(`/v1/me/subscriptions/${sub.id}`, as(b)),
      await api.post(`/v1/me/subscriptions/${sub.id}/pause`, {}, as(b)),
      await api.post(`/v1/me/subscriptions/${sub.id}/cancel`, {}, as(b)),
      await api.post(`/v1/me/subscriptions/${sub.id}/resume`, {}, as(b)),
      await api.post(`/v1/me/subscriptions/${sub.id}/skip`, { scheduledFor: '2026-10-24' }, as(b)),
      await api.post(`/v1/me/subscriptions/${sub.id}/cycles/${y.id}/pay`, {}, { ...as(b), ...idem() }),
    ]) {
      assert.equal(r.status, 404, JSON.stringify(r.body))
    }
    assert.deepEqual((await api.get('/v1/me/subscriptions', as(b))).body.items, [])
    assert.equal((await query('SELECT status FROM subscriptions WHERE id = $1', [sub.id])).rows[0].status, 'ACTIVE')
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM orders')).rows[0].n, 0)
  })
})

describe('subscriptions: staff', () => {
  test('the Subscriptions list shows coming cycles with masked phones; pause and cancel need a reason, which is audited', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    const cust = await customerToken(api, '9876511111')
    const sub = (await subscribe(cust)).body
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    const list = await api.get('/admin/v1/subscriptions', { token: ops })
    assert.equal(list.status, 200)
    assert.equal(list.body.items.length, 1)
    const item = list.body.items[0]
    assert.equal(item.customer.phoneMasked, '******1111')
    assert.equal(item.address, null, 'the list leaves the address out')
    assert.ok(!JSON.stringify(list.body).includes('9876511111'))
    assert.ok(!JSON.stringify(list.body).includes('Koramangala'))
    assert.deepEqual(item.cycles.map((y) => [y.deliveryDate, y.status]), [['2026-10-17', 'DUE']])
    assert.deepEqual(item.upcoming.slice(0, 1), ['2026-10-24'])
    assert.deepEqual(list.body.counts, { ACTIVE: 1, PAUSED: 0, CANCELLED: 0 })

    assert.equal((await api.post(`/admin/v1/subscriptions/${sub.id}/pause`, {}, { token: ops })).status, 400)
    assert.equal((await api.post(`/admin/v1/subscriptions/${sub.id}/pause`, { reason: 'no' }, { token: ops })).status, 400)
    assert.equal((await api.post(`/admin/v1/subscriptions/${sub.id}/pause`, { reason: 'Farm short this week' }, { token: ops })).status, 204)
    assert.equal((await api.get('/admin/v1/subscriptions?status=PAUSED', { token: ops })).body.items.length, 1)
    assert.equal((await api.post(`/admin/v1/subscriptions/${sub.id}/cancel`, { reason: 'Customer asked by phone' }, { token: manager })).status, 204)
    assert.equal((await api.post(`/admin/v1/subscriptions/${sub.id}/cancel`, { reason: 'Customer asked by phone' }, { token: manager })).status, 409)
    const audit = (await query(`SELECT action, email, detail FROM staff_audit WHERE target = $1 ORDER BY created_at`, [sub.id])).rows
    assert.deepEqual(audit.map((a) => [a.action, a.email, a.detail.reason]), [
      ['PAUSE subscription', 'ops@mandimangoes.test', 'Farm short this week'],
      ['CANCEL subscription', 'manager@mandimangoes.test', 'Customer asked by phone'],
    ])
    const events = (await query(`SELECT action, reason, actor FROM subscription_events WHERE subscription_id = $1 AND action IN ('PAUSED', 'CANCELLED') ORDER BY created_at`, [sub.id])).rows
    assert.deepEqual(events.map((e) => [e.action, e.reason, e.actor]), [['PAUSED', 'Farm short this week', 'ops@mandimangoes.test'], ['CANCELLED', 'Customer asked by phone', 'manager@mandimangoes.test']])
    assert.equal((await api.get(`/v1/me/subscriptions/${sub.id}`, as(cust))).body.status, 'CANCELLED')

    const packer = await adminToken(api, 'packer@mandimangoes.test', 'packer123')
    assert.equal((await api.get('/admin/v1/subscriptions', { token: packer })).status, 403)
    assert.equal((await api.post(`/admin/v1/subscriptions/${sub.id}/pause`, { reason: 'Farm short this week' }, { token: packer })).status, 403)
  })

  test('deleting the account stops its subscriptions and removes the address; the export lists them', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
    const cust = await customerToken(api)
    const sub = (await subscribe(cust)).body
    assert.equal((await api.get('/v1/me/export', as(cust))).body.subscriptions[0].deliveries.length, 1)
    assert.equal((await api.del('/v1/me', as(cust))).status, 204)
    const s = (await query('SELECT status, delivery_address, customer_name FROM subscriptions WHERE id = $1', [sub.id])).rows[0]
    assert.deepEqual(s, { status: 'CANCELLED', delivery_address: '', customer_name: null })
    assert.equal((await cycles(sub.id))[0].status, 'CANCELLED')
    assert.equal((await query(`SELECT COUNT(*)::int AS n FROM notifications WHERE kind = 'SUBSCRIPTION_DUE' AND status = 'PENDING'`)).rows[0].n, 0)
  })

  test('the reminder text has no phone number in it', () => {
    const params = paramsFor({ kind: 'SUBSCRIPTION_DUE', customer_name: 'Asha', phone: '+919876500000', sub_qty: 1, sub_sku: 'ALP-3', cycle_date: '2026-10-17', sub_id: 'sub_1' })
    assert.ok(!params.join(' ').includes('9876500000'))
    assert.equal(todayIST(), '2026-10-15')
    assert.equal(addDays(todayIST(), 2), '2026-10-17')
  })
})
