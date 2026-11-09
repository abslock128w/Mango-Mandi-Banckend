// Bulk enquiries (mango-api/README.md, Bulk enquiries): the shop's form for orders above
// 100 kg, the staff quote with extra costs, WhatsApp through the outbox (the log
// provider: nothing reaches Meta), and the customer's accept or decline.
import { adminToken, client, closeAll, customerToken, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'
import { paramsFor } from '../src/notify.js'

let srv
let api
let manager

const FLAGS = ['BULK_ENQUIRIES', 'WHATSAPP_BULK_UPDATES', 'BULK_ENQUIRY_DAILY_LIMIT']
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
  Object.assign(env, { BULK_ENQUIRIES: true, WHATSAPP_BULK_UPDATES: true, BULK_ENQUIRY_DAILY_LIMIT: 5 })
})
afterEach(() => Object.assign(env, saved))

const idem = () => ({ headers: { 'Idempotency-Key': newId('idem') } })
const FORM = { name: 'Asha Rao', business: 'Rao Caterers', email: 'asha@example.com', phone: '98765 43210', city: 'Bengaluru', notes: 'Wedding on the 20th' }
const send = (body, opts = {}) => api.post('/v1/bulk-enquiries', body, { ...idem(), ...opts })

describe('bulk enquiries from the shop', () => {
  test('anonymous, from a bulk list: numbered, kg from the box sizes, phone normalised, "we got it" queued', async () => {
    const r = await send({ ...FORM, lines: [{ sku: 'ALP-3', stage: 'RIPE', boxes: 40, kg: 120 }] })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.match(r.body.number, /^BLK-\d{4}$/)
    assert.equal(r.body.status, 'NEW')
    const row = (await query('SELECT * FROM bulk_enquiries WHERE id = $1', [r.body.id])).rows[0]
    assert.equal(row.phone, '+919876543210')
    assert.equal(row.customer_id, null)
    assert.equal(row.quantity_kg, 120)
    assert.deepEqual(row.lines, [{ sku: 'ALP-3', stage: 'RIPE', boxes: 40, kg: 120 }])
    const n = (await query('SELECT * FROM notifications WHERE bulk_enquiry_id = $1', [r.body.id])).rows
    assert.deepEqual(n.map((x) => x.kind), ['BULK_ENQUIRY_RECEIVED'])
    assert.deepEqual(paramsFor(n[0]), ['Asha Rao', r.body.number, '120 kg (40 boxes)'])
  })

  test('a typed quantity must be over 100 kg; unknown boxes and bad phones are refused', async () => {
    assert.equal((await send({ ...FORM, quantityKg: 100 })).body.error.code, 'BULK_TOO_SMALL')
    assert.equal((await send({ ...FORM, quantityKg: 150, ripeness: 'A mix' })).status, 201)
    assert.equal((await send({ ...FORM, lines: [{ sku: 'NOPE', stage: 'RIPE', boxes: 50 }] })).status, 400)
    assert.equal((await send({ ...FORM, phone: '12345', quantityKg: 150 })).status, 400)
  })

  test('the same Idempotency-Key is one enquiry', async () => {
    const opts = idem()
    const a = await send({ ...FORM, quantityKg: 200 }, opts)
    const b = await send({ ...FORM, quantityKg: 200 }, opts)
    assert.equal(a.status, 201)
    assert.equal(b.status, 200)
    assert.equal(b.body.id, a.body.id)
    assert.equal((await query('SELECT count(*)::int AS n FROM bulk_enquiries')).rows[0].n, 1)
  })

  test('more than the daily limit from one number is refused', async () => {
    env.BULK_ENQUIRY_DAILY_LIMIT = 2
    assert.equal((await send({ ...FORM, quantityKg: 150 })).status, 201)
    assert.equal((await send({ ...FORM, quantityKg: 150 })).status, 201)
    const third = await send({ ...FORM, quantityKg: 150 })
    assert.equal(third.status, 429)
    assert.equal(third.body.error.code, 'BULK_LIMIT')
    assert.equal((await send({ ...FORM, phone: '9123456789', quantityKg: 150 })).status, 201)
  })

  test('signed in: linked to the account; the list also finds an anonymous one from the same number', async () => {
    const cust = await customerToken(api, '9811111111')
    const mine = await send({ ...FORM, phone: '9811111111', quantityKg: 150 }, { ...idem(), token: cust.accessToken })
    assert.equal(mine.status, 201)
    assert.equal((await query('SELECT customer_id FROM bulk_enquiries WHERE id = $1', [mine.body.id])).rows[0].customer_id, cust.customer.id)
    const anon = await send({ ...FORM, phone: '+91 98111 11111', quantityKg: 300 })
    const other = await send({ ...FORM, phone: '9822222222', quantityKg: 300 })
    const list = await api.get('/v1/me/bulk-enquiries', { token: cust.accessToken })
    assert.equal(list.status, 200)
    assert.deepEqual(list.body.items.map((x) => x.id).sort(), [mine.body.id, anon.body.id].sort())
    assert.equal((await api.get(`/v1/me/bulk-enquiries/${other.body.id}`, { token: cust.accessToken })).status, 404)
    assert.equal((await api.get('/v1/me/bulk-enquiries')).status, 401)
  })

  test('a stale token still sends, as anonymous', async () => {
    const r = await send({ ...FORM, quantityKg: 150 }, { ...idem(), token: 'not-a-token' })
    assert.equal(r.status, 201)
  })
})

describe('quotes', () => {
  test('staff quote with extras: totals worked out on the server, BULK_QUOTE queued with the link, seen, accept', async () => {
    const cust = await customerToken(api, '9833333333')
    const e = (await send({ ...FORM, phone: '9833333333', lines: [{ sku: 'ALP-3', stage: 'RIPE', boxes: 40 }] }, { ...idem(), token: cust.accessToken })).body

    const list = await api.get('/admin/v1/bulk-enquiries?status=NEW', { token: manager })
    assert.equal(list.status, 200)
    assert.deepEqual(list.body.items.map((x) => x.id), [e.id])
    assert.equal(list.body.counts.NEW, 1)
    const detail = await api.get(`/admin/v1/bulk-enquiries/${e.id}`, { token: manager })
    assert.equal(detail.body.lines[0].listPrice > 0, true)
    const byName = await api.get('/admin/v1/bulk-enquiries?q=rao', { token: manager })
    assert.equal(byName.body.items?.length, 1, JSON.stringify(byName.body))
    assert.equal((await api.get('/admin/v1/bulk-enquiries?q=33333', { token: manager })).body.items.length, 1)

    const q = await api.post(`/admin/v1/bulk-enquiries/${e.id}/quote`, {
      lines: [{ label: 'Alphonso 3kg Box · Ripe', sku: 'ALP-3', stage: 'RIPE', qty: 40, unitPrice: 120_000 }],
      extras: [{ label: 'Special packaging', amount: 50_000 }],
      note: 'Delivered in two trips', validUntil: '2099-01-01',
      // A total from the panel is not accepted: the server works it out.
    }, { token: manager })
    assert.equal(q.status, 201, JSON.stringify(q.body))
    assert.equal(q.body.status, 'QUOTED')
    assert.deepEqual([q.body.quote.subtotal, q.body.quote.extrasTotal, q.body.quote.total], [4_800_000, 50_000, 4_850_000])
    assert.match(q.body.quoteText, /Special packaging: ₹500/)
    const msg = q.body.messages.find((m) => m.kind === 'BULK_QUOTE')
    // Sent at once to the log provider (no WhatsApp keys in tests).
    assert.equal(msg.status, 'SENT')
    const row = (await query(`SELECT * FROM notifications WHERE bulk_enquiry_id = $1 AND kind = 'BULK_QUOTE'`, [e.id])).rows[0]
    const p = paramsFor(row)
    assert.equal(p.length, 5)
    assert.equal(p[2], 'Rs 48,500')
    assert.match(p[3], /40 × Alphonso.*special packaging/)
    assert.match(p[4], new RegExp(`/account\\?enquiry=${e.id}$`))
    assert.equal((await query(`SELECT count(*)::int AS n FROM staff_audit WHERE action = 'QUOTE bulk enquiry'`)).rows[0].n, 1)

    const mine = await api.get('/v1/me/bulk-enquiries', { token: cust.accessToken })
    assert.equal(mine.body.items[0].unread, true)
    assert.equal(mine.body.items[0].quote.total, 4_850_000)
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
    const e = (await send({ ...FORM, quantityKg: 150 })).body
    const quote = (unitPrice) => api.post(`/admin/v1/bulk-enquiries/${e.id}/quote`, { lines: [{ label: 'Mixed mangoes per kg', qty: 150, unitPrice }] }, { token: manager })
    assert.equal((await quote(15_000)).status, 201)
    // As if the first had not gone yet.
    await query(`UPDATE notifications SET status = 'PENDING' WHERE bulk_enquiry_id = $1 AND kind = 'BULK_QUOTE'`, [e.id])
    const second = await quote(14_000)
    assert.equal(second.body.quote.total, 2_100_000)
    const rows = (await query(`SELECT status, last_error, event_id FROM notifications WHERE bulk_enquiry_id = $1 AND kind = 'BULK_QUOTE' ORDER BY created_at`, [e.id])).rows
    assert.equal(rows.length, 2)
    assert.equal(rows[0].status, 'SKIPPED')
    assert.match(rows[0].last_error, /newer quote/)
    assert.equal(rows[1].status, 'SENT')
  })

  test('decline with a message; quotes need lines; operators may quote; close and note', async () => {
    const cust = await customerToken(api, '9844444444')
    const e = (await send({ ...FORM, phone: '9844444444', quantityKg: 150 })).body
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
    const e = (await send({ ...FORM, phone: '9855555555', quantityKg: 150 })).body
    await api.post(`/admin/v1/bulk-enquiries/${e.id}/quote`, { lines: [{ label: 'Mangoes per kg', qty: 150, unitPrice: 15_000 }] }, { token: manager })
    assert.equal((await query('SELECT count(*)::int AS n FROM notifications WHERE bulk_enquiry_id = $1', [e.id])).rows[0].n, 0)
    assert.equal((await api.get('/v1/me/bulk-enquiries', { token: cust.accessToken })).body.items[0].unread, true)
  })
})

describe('the switch', () => {
  test('BULK_ENQUIRIES off: every route answers 404', async () => {
    const cust = await customerToken(api)
    env.BULK_ENQUIRIES = false
    assert.equal((await send({ ...FORM, quantityKg: 150 })).status, 404)
    assert.equal((await api.get('/v1/me/bulk-enquiries', { token: cust.accessToken })).status, 404)
    assert.equal((await api.get('/admin/v1/bulk-enquiries', { token: manager })).status, 404)
    assert.equal((await api.get('/admin/v1/auth/me', { token: manager })).body.features.bulkEnquiries, false)
  })
})
