// Bulk enquiries (mango-api/README.md, Bulk orders): the shop's enquiry from 250 kg (BULK_ENQUIRY_MIN_KG; less is
// refused with BULK_ENQUIRY_TOO_SMALL, and an order sent to this form with BULK_ORDER_PAY_ONLINE: orders are placed
// signed in and paid, test/bulk-orders.test.js), the staff quote with extra costs and today's bulk prices as its
// starting point, WhatsApp through the outbox (the log provider: nothing reaches Meta), and the customer's accept or
// decline. Direct orders stored before payment came in, and old small enquiries, still work.
import { adminToken, client, closeAll, customerToken, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { ENQUIRY_MESSAGES_PER_DAY, enquiryMessageKey } from '../src/bulk-enquiries.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'
import { paramsFor } from '../src/notify.js'
import { formatOrderNumber } from '../src/order-number.js'

let srv
let api
let manager

const FLAGS = ['BULK_ENQUIRIES', 'WHATSAPP_BULK_UPDATES', 'BULK_ENQUIRY_DAILY_LIMIT', 'TURNSTILE_SECRET_KEY']
const saved = Object.fromEntries(FLAGS.map((k) => [k, env[k]]))

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
  Object.assign(env, { BULK_ENQUIRIES: true, WHATSAPP_BULK_UPDATES: true, BULK_ENQUIRY_DAILY_LIMIT: 5, TURNSTILE_SECRET_KEY: '' })
})
const realFetch = globalThis.fetch
afterEach(() => {
  Object.assign(env, saved)
  globalThis.fetch = realFetch
})

const idem = () => ({ headers: { 'Idempotency-Key': newId('idem') } })
const FORM = { name: 'Asha Rao', business: 'Rao Caterers', email: 'asha@example.com', phone: '98765 43210', city: 'Bengaluru', notes: 'Wedding on the 20th' }
const send = (body, opts = {}) => api.post('/v1/bulk-enquiries', body, { ...idem(), ...opts })
/** An enquiry for `kg` kg, in 5 kg Alphonso boxes. */
const bulk = (kg) => ({ lines: [{ sku: 'ALP-5', stage: 'SEMI_RIPE', boxes: kg / 5 }] })

describe('bulk enquiries from the shop', () => {
  test('anonymous, from a bulk list of 250 kg: numbered, kg from the box sizes, phone normalised, "we got it" queued', async () => {
    const r = await send({ ...FORM, lines: [{ sku: 'ALP-5', stage: 'SEMI_RIPE', boxes: 30, kg: 150 }, { sku: 'ALP-5', stage: 'RAW', boxes: 10, packKg: 10 }] })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.match(r.body.number, /^B\d{9}$/)
    assert.deepEqual([r.body.status, r.body.kind], ['NEW', 'ENQUIRY'])
    const row = (await query('SELECT * FROM bulk_enquiries WHERE id = $1', [r.body.id])).rows[0]
    assert.equal(row.phone, '+919876543210')
    assert.equal(row.customer_id, null)
    assert.equal(row.quantity_kg, 250)
    assert.equal(row.total, null)
    assert.deepEqual(row.lines, [{ sku: 'ALP-5', stage: 'SEMI_RIPE', boxes: 30, kg: 150 }, { sku: 'ALP-5', stage: 'RAW', boxes: 10, kg: 100, packKg: 10 }])
    const n = (await query('SELECT * FROM notifications WHERE bulk_enquiry_id = $1', [r.body.id])).rows
    assert.deepEqual(n.map((x) => x.kind), ['BULK_ENQUIRY_RECEIVED'])
    assert.deepEqual(paramsFor(n[0]), ['Asha Rao', formatOrderNumber(r.body.number), '250 kg (40 boxes)'])
  })

  test('an enquiry under 250 kg is refused (order and pay from 100 kg instead); an order sent here is refused; unknown boxes and bad phones too', async () => {
    for (const body of [{ ...FORM, quantityKg: 40 }, { ...FORM, quantityKg: 249, ripeness: 'A mix' }, { ...FORM, ...bulk(245) }, { ...FORM, ...bulk(200), kind: 'ENQUIRY' }]) {
      const r = await send(body)
      assert.deepEqual([r.status, r.body.error?.code], [400, 'BULK_ENQUIRY_TOO_SMALL'], JSON.stringify(r.body))
      assert.equal(r.body.error.message, 'Enquiries are for 250 kg and above. From 100 kg you can order and pay directly.')
    }
    // The old shop's unpaid direct order: refused, with what to do.
    const order = await send({ ...FORM, kind: 'ORDER', ...bulk(150) })
    assert.deepEqual([order.status, order.body.error.code], [400, 'BULK_ORDER_PAY_ONLINE'])
    assert.equal((await query('SELECT count(*)::int AS n FROM bulk_enquiries')).rows[0].n, 0)
    assert.equal((await send({ ...FORM, lines: [{ sku: 'NOPE', stage: 'SEMI_RIPE', boxes: 50 }] })).status, 400)
    assert.equal((await send({ ...FORM, phone: '12345', ...bulk(250) })).status, 400)
    // Exactly 250 kg, by list or by a typed quantity.
    assert.equal((await send({ ...FORM, ...bulk(250) })).status, 201)
    assert.equal((await send({ ...FORM, quantityKg: 250, ripeness: 'A mix' })).status, 201)
  })

  test('an old unpaid direct order (before payment came in) still lists and closes', async () => {
    const r = await send({ ...FORM, ...bulk(250) })
    await query(`UPDATE bulk_enquiries SET kind = 'ORDER' WHERE id = $1`, [r.body.id])
    const detail = (await api.get(`/admin/v1/bulk-enquiries/${r.body.id}`, { token: manager })).body
    assert.deepEqual([detail.kind, detail.status, detail.order], ['ORDER', 'NEW', null])
    const list = (await api.get('/admin/v1/bulk-enquiries', { token: manager })).body.items
    assert.equal(list.find((x) => x.id === r.body.id).paid, false)
    assert.equal((await api.post(`/admin/v1/bulk-enquiries/${r.body.id}/close`, { reason: 'Done by phone' }, { token: manager })).body.status, 'CLOSED')
  })

  test('the same Idempotency-Key is one enquiry', async () => {
    const opts = idem()
    const a = await send({ ...FORM, ...bulk(300) }, opts)
    const b = await send({ ...FORM, ...bulk(300) }, opts)
    assert.equal(a.status, 201)
    assert.equal(b.status, 200)
    assert.equal(b.body.id, a.body.id)
    assert.equal((await query('SELECT count(*)::int AS n FROM bulk_enquiries')).rows[0].n, 1)
  })

  test('more than the daily limit from one number is refused', async () => {
    env.BULK_ENQUIRY_DAILY_LIMIT = 2
    assert.equal((await send({ ...FORM, ...bulk(250) })).status, 201)
    assert.equal((await send({ ...FORM, ...bulk(250) })).status, 201)
    const third = await send({ ...FORM, ...bulk(250) })
    assert.equal(third.status, 429)
    assert.equal(third.body.error.code, 'BULK_LIMIT')
    assert.equal((await send({ ...FORM, phone: '9123456789', ...bulk(250) })).status, 201)
  })

  test('signed in: linked to the account; the list also finds an anonymous one from the same number', async () => {
    const cust = await customerToken(api, '9811111111')
    const mine = await send({ ...FORM, phone: '9811111111', ...bulk(250) }, { ...idem(), token: cust.accessToken })
    assert.equal(mine.status, 201)
    assert.equal((await query('SELECT customer_id FROM bulk_enquiries WHERE id = $1', [mine.body.id])).rows[0].customer_id, cust.customer.id)
    const anon = await send({ ...FORM, phone: '+91 98111 11111', ...bulk(300) })
    const other = await send({ ...FORM, phone: '9822222222', ...bulk(300) })
    const list = await api.get('/v1/me/bulk-enquiries', { token: cust.accessToken })
    assert.equal(list.status, 200)
    assert.deepEqual(list.body.items.map((x) => x.id).sort(), [mine.body.id, anon.body.id].sort())
    assert.equal((await api.get(`/v1/me/bulk-enquiries/${other.body.id}`, { token: cust.accessToken })).status, 404)
    assert.equal((await api.get('/v1/me/bulk-enquiries')).status, 401)
  })

  test('a stale token still sends, as anonymous', async () => {
    const r = await send({ ...FORM, ...bulk(250) }, { ...idem(), token: 'not-a-token' })
    assert.equal(r.status, 201)
  })
})

/** Turnstile on, with Cloudflare answering every token as solved by the widget with `action` on the shop's own host. */
function turnstileAnswers(action) {
  env.TURNSTILE_SECRET_KEY = 'secret'
  const hostname = new URL(env.CUSTOMER_ORIGIN.split(',')[0].trim()).hostname
  globalThis.fetch = (url, init) =>
    String(url).startsWith('https://challenges.cloudflare.com/')
      ? Promise.resolve(new Response(JSON.stringify({ success: true, hostname, action }), { headers: { 'Content-Type': 'application/json' } }))
      : realFetch(url, init)
}
const counts = async () => (await query(`SELECT (SELECT count(*)::int FROM bulk_enquiries) AS enquiries, (SELECT count(*)::int FROM notifications) AS messages`)).rows[0]

describe('Turnstile and the daily message cap (AUTH-01)', () => {
  test('with Turnstile set up, a form without a token is refused, signed in or not, and nothing is saved or queued', async () => {
    // Signed in first: with Turnstile on, asking for a login code needs a token too.
    const cust = await customerToken(api, '9811111111')
    env.TURNSTILE_SECRET_KEY = 'secret'
    const anon = await send({ ...FORM, ...bulk(250) })
    assert.deepEqual([anon.status, anon.body.error?.code], [400, 'CAPTCHA_REQUIRED'], JSON.stringify(anon.body))
    const signed = await send({ ...FORM, phone: '9811111111', ...bulk(250) }, { ...idem(), token: cust.accessToken })
    assert.deepEqual([signed.status, signed.body.error?.code], [400, 'CAPTCHA_REQUIRED'])
    assert.deepEqual(await counts(), { enquiries: 0, messages: 0 })
  })

  test('with Turnstile set up, a good token sends it; a token for another form is refused; a retry with a new token is the same enquiry', async () => {
    turnstileAnswers('otp')
    const wrong = await send({ ...FORM, ...bulk(250), captchaToken: 'tok-otp' })
    assert.deepEqual([wrong.status, wrong.body.error?.code], [400, 'CAPTCHA_FAILED'])
    assert.deepEqual(await counts(), { enquiries: 0, messages: 0 })

    turnstileAnswers('bulk')
    const opts = idem()
    const a = await send({ ...FORM, ...bulk(300), captchaToken: 'tok-1' }, opts)
    assert.equal(a.status, 201, JSON.stringify(a.body))
    // A token works once, so the retry carries another: it is not part of the form, so the key still matches.
    const b = await send({ ...FORM, ...bulk(300), captchaToken: 'tok-2' }, opts)
    assert.equal(b.status, 200, JSON.stringify(b.body))
    assert.equal(b.body.id, a.body.id)
    assert.deepEqual(await counts(), { enquiries: 1, messages: 1 })
  })

  test('without Turnstile set up the form works as before, with or without a token', async () => {
    assert.equal((await send({ ...FORM, ...bulk(250) })).status, 201)
    assert.equal((await send({ ...FORM, ...bulk(250), captchaToken: 'ignored' })).status, 201)
    assert.equal((await send({ ...FORM, ...bulk(250), captchaToken: 42 })).status, 400)
  })

  test('past the shop-wide daily cap the enquiry is saved but no "we got it" message is queued', async () => {
    const day = enquiryMessageKey()
    await query(`INSERT INTO rate_limits (key, hits, reset_at) VALUES ($1, $2, now() + interval '1 day')`, [day, ENQUIRY_MESSAGES_PER_DAY - 1])
    const last = await send({ ...FORM, ...bulk(250) })
    assert.equal(last.status, 201)
    assert.equal((await query('SELECT count(*)::int AS n FROM notifications WHERE bulk_enquiry_id = $1', [last.body.id])).rows[0].n, 1, 'the Nth is still sent')
    const over = await send({ ...FORM, phone: '9123456789', ...bulk(250) })
    assert.equal(over.status, 201, JSON.stringify(over.body))
    assert.equal((await query('SELECT status FROM bulk_enquiries WHERE id = $1', [over.body.id])).rows[0].status, 'NEW')
    assert.equal((await query('SELECT count(*)::int AS n FROM notifications WHERE bulk_enquiry_id = $1', [over.body.id])).rows[0].n, 0)
    assert.equal((await query('SELECT hits FROM rate_limits WHERE key = $1', [day])).rows[0].hits, ENQUIRY_MESSAGES_PER_DAY + 1)
  })
})

describe('quotes', () => {
  test('staff quote with extras: totals worked out on the server, BULK_QUOTE queued with the link, seen, accept', async () => {
    const cust = await customerToken(api, '9833333333')
    const e = (await send({ ...FORM, phone: '9833333333', lines: [{ sku: 'ALP-5', stage: 'SEMI_RIPE', boxes: 50 }] }, { ...idem(), token: cust.accessToken })).body

    const list = await api.get('/admin/v1/bulk-enquiries?status=NEW', { token: manager })
    assert.equal(list.status, 200)
    assert.deepEqual(list.body.items.map((x) => x.id), [e.id])
    assert.equal(list.body.counts.NEW, 1)
    const detail = await api.get(`/admin/v1/bulk-enquiries/${e.id}`, { token: manager })
    assert.equal(detail.body.lines[0].listPrice, 299_900)
    // Today's bulk price is the quote's starting point (the shop price less 25%, whole rupees): a quote can be lower.
    assert.equal(detail.body.lines[0].bulkPrice, 224_900)
    const byName = await api.get('/admin/v1/bulk-enquiries?q=rao', { token: manager })
    assert.equal(byName.body.items?.length, 1, JSON.stringify(byName.body))
    assert.equal((await api.get('/admin/v1/bulk-enquiries?q=33333', { token: manager })).body.items.length, 1)

    const q = await api.post(`/admin/v1/bulk-enquiries/${e.id}/quote`, {
      lines: [{ label: 'Alphonso 3kg Box · Ripe', sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 40, unitPrice: 120_000 }],
      extras: [{ label: 'Special packaging', amount: 50_000 }],
      note: 'Delivered in two trips', validUntil: '2099-01-01',
      // A total from the panel is not accepted: the server works it out.
    }, { token: manager })
    assert.equal(q.status, 201, JSON.stringify(q.body))
    assert.equal(q.body.status, 'QUOTED')
    // Delivery is 10% of the mangoes' value (not of the extras), worked out here and shown as its own line.
    assert.deepEqual([q.body.quote.subtotal, q.body.quote.extrasTotal, q.body.quote.deliveryPct, q.body.quote.deliveryFee, q.body.quote.total], [4_800_000, 50_000, 10, 480_000, 5_330_000])
    assert.match(q.body.quoteText, /Special packaging: ₹500/)
    assert.match(q.body.quoteText, /Delivery \(10% of the order value\): ₹4,800/)
    const msg = q.body.messages.find((m) => m.kind === 'BULK_QUOTE')
    // Sent at once to the log provider (no WhatsApp keys in tests).
    assert.equal(msg.status, 'SENT')
    const row = (await query(`SELECT * FROM notifications WHERE bulk_enquiry_id = $1 AND kind = 'BULK_QUOTE'`, [e.id])).rows[0]
    const p = paramsFor(row)
    assert.equal(p.length, 5)
    assert.equal(p[2], 'Rs 53,300')
    assert.match(p[3], /40 × Alphonso.*special packaging/)
    assert.match(p[4], new RegExp(`/account\\?enquiry=${e.id}$`))
    assert.equal((await query(`SELECT count(*)::int AS n FROM staff_audit WHERE action = 'QUOTE bulk enquiry'`)).rows[0].n, 1)

    const mine = await api.get('/v1/me/bulk-enquiries', { token: cust.accessToken })
    assert.equal(mine.body.items[0].unread, true)
    assert.equal(mine.body.items[0].quote.total, 5_330_000)
    const seen = await api.post(`/v1/me/bulk-enquiries/${e.id}/seen`, {}, { token: cust.accessToken })
    assert.equal(seen.body.unread, false)

    const yes = await api.post(`/v1/me/bulk-enquiries/${e.id}/respond`, { decision: 'ACCEPT', message: 'Please call me' }, { token: cust.accessToken })
    assert.equal(yes.status, 200, JSON.stringify(yes.body))
    assert.equal(yes.body.status, 'ACCEPTED')
    assert.equal((await api.post(`/v1/me/bulk-enquiries/${e.id}/respond`, { decision: 'DECLINE' }, { token: cust.accessToken })).status, 409)
    const after = await api.get(`/admin/v1/bulk-enquiries/${e.id}`, { token: manager })
    assert.equal(after.body.status, 'ACCEPTED')
    assert.equal(after.body.customerMessage, 'Please call me')
    assert.deepEqual(after.body.events.map((x) => x.type), ['RECEIVED', 'QUOTED', 'SEEN', 'ACCEPTED'])
  })

  test('a new quote replaces the last: unseen again, an older unsent quote message is skipped', async () => {
    const e = (await send({ ...FORM, ...bulk(250) })).body
    const quote = (unitPrice) => api.post(`/admin/v1/bulk-enquiries/${e.id}/quote`, { lines: [{ label: 'Mixed mangoes per kg', qty: 150, unitPrice }] }, { token: manager })
    assert.equal((await quote(15_000)).status, 201)
    // As if the first had not gone yet.
    await query(`UPDATE notifications SET status = 'PENDING' WHERE bulk_enquiry_id = $1 AND kind = 'BULK_QUOTE'`, [e.id])
    const second = await quote(14_000)
    assert.equal(second.body.quote.total, 2_310_000)
    const rows = (await query(`SELECT status, last_error, event_id FROM notifications WHERE bulk_enquiry_id = $1 AND kind = 'BULK_QUOTE' ORDER BY created_at`, [e.id])).rows
    assert.equal(rows.length, 2)
    assert.equal(rows[0].status, 'SKIPPED')
    assert.match(rows[0].last_error, /newer quote/)
    assert.equal(rows[1].status, 'SENT')
  })

  test('decline with a message; quotes need lines; operators may quote; close and note', async () => {
    const cust = await customerToken(api, '9844444444')
    const e = (await send({ ...FORM, phone: '9844444444', ...bulk(250) })).body
    assert.equal((await api.post(`/v1/me/bulk-enquiries/${e.id}/respond`, { decision: 'ACCEPT' }, { token: cust.accessToken })).status, 409)
    assert.equal((await api.post(`/admin/v1/bulk-enquiries/${e.id}/quote`, { lines: [] }, { token: manager })).status, 400)
    assert.equal((await api.post(`/admin/v1/bulk-enquiries/${e.id}/quote`, { lines: [{ label: 'x', qty: 1, unitPrice: -5 }] }, { token: manager })).status, 400)
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    assert.equal((await api.post(`/admin/v1/bulk-enquiries/${e.id}/quote`, { lines: [{ label: 'Mangoes per kg', qty: 150, unitPrice: 15_000 }] }, { token: ops })).status, 201)
    const no = await api.post(`/v1/me/bulk-enquiries/${e.id}/respond`, { decision: 'DECLINE', message: 'Too dear' }, { token: cust.accessToken })
    assert.equal(no.body.status, 'DECLINED')
    assert.equal((await api.post(`/admin/v1/bulk-enquiries/${e.id}/note`, { text: 'Called, will try a smaller order' }, { token: ops })).status, 201)
    const closed = await api.post(`/admin/v1/bulk-enquiries/${e.id}/close`, { reason: 'Customer declined' }, { token: ops })
    assert.equal(closed.body.status, 'CLOSED')
    assert.deepEqual(closed.body.events.map((x) => x.type), ['RECEIVED', 'QUOTED', 'DECLINED', 'NOTE', 'CLOSED'])
    assert.equal((await api.post(`/admin/v1/bulk-enquiries/${e.id}/quote`, { lines: [{ label: 'x', qty: 1, unitPrice: 1 }] }, { token: manager })).status, 409)
  })

  test('WHATSAPP_BULK_UPDATES off: nothing is queued, the quote still shows in the shop', async () => {
    env.WHATSAPP_BULK_UPDATES = false
    const cust = await customerToken(api, '9855555555')
    const e = (await send({ ...FORM, phone: '9855555555', ...bulk(250) })).body
    await api.post(`/admin/v1/bulk-enquiries/${e.id}/quote`, { lines: [{ label: 'Mangoes per kg', qty: 150, unitPrice: 15_000 }] }, { token: manager })
    assert.equal((await query('SELECT count(*)::int AS n FROM notifications WHERE bulk_enquiry_id = $1', [e.id])).rows[0].n, 0)
    assert.equal((await api.get('/v1/me/bulk-enquiries', { token: cust.accessToken })).body.items[0].unread, true)
  })
})

describe('enquiries stored before the 250 kg minimum', () => {
  test('an old plain enquiry is still listed, quoted, seen and answered', async () => {
    const cust = await customerToken(api, '9866666666')
    const e = (await send({ ...FORM, phone: '9866666666', ...bulk(250) }, { ...idem(), token: cust.accessToken })).body
    // As the shop's old enquiry form stored it: a typed quantity of 40 kg, no list.
    await query(`UPDATE bulk_enquiries SET kind = 'ENQUIRY', lines = '[]', quantity_kg = 40 WHERE id = $1`, [e.id])
    const staff = (await api.get('/admin/v1/bulk-enquiries', { token: manager })).body.items
    assert.equal(staff.find((x) => x.id === e.id).kind, 'ENQUIRY')
    assert.equal((await api.get(`/admin/v1/bulk-enquiries/${e.id}`, { token: manager })).body.kind, 'ENQUIRY')
    const q = await api.post(`/admin/v1/bulk-enquiries/${e.id}/quote`, { lines: [{ label: 'Mangoes per kg', qty: 40, unitPrice: 15_000 }] }, { token: manager })
    assert.equal(q.status, 201, JSON.stringify(q.body))
    const mine = (await api.get('/v1/me/bulk-enquiries', { token: cust.accessToken })).body.items
    assert.deepEqual([mine[0].id, mine[0].kind, mine[0].status, mine[0].unread], [e.id, 'ENQUIRY', 'QUOTED', true])
    assert.equal((await api.post(`/v1/me/bulk-enquiries/${e.id}/seen`, {}, { token: cust.accessToken })).body.unread, false)
    const yes = await api.post(`/v1/me/bulk-enquiries/${e.id}/respond`, { decision: 'ACCEPT' }, { token: cust.accessToken })
    assert.equal(yes.body.status, 'ACCEPTED')
  })
})

describe('the switch', () => {
  test('BULK_ENQUIRIES off: every route answers 404', async () => {
    const cust = await customerToken(api)
    env.BULK_ENQUIRIES = false
    assert.equal((await send({ ...FORM, ...bulk(250) })).status, 404)
    assert.equal((await api.get('/v1/me/bulk-enquiries', { token: cust.accessToken })).status, 404)
    assert.equal((await api.get('/admin/v1/bulk-enquiries', { token: manager })).status, 404)
    assert.equal((await api.get('/admin/v1/auth/me', { token: manager })).body.features.bulkEnquiries, false)
  })
})
