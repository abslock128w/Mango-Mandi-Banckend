// Farm visit enquiries (mango-api/README.md, Bulk orders and enquiries; kind FARM_VISIT, migration 087): the shop's
// Farm visit tab sends one, signed in or not, from 250 kg (the farm visit's own minimum), with Day 1 and Day 2 of the
// visit (2 days at most, migration 097) and "we got it" on WhatsApp; staff move it NEW → CONTACTED → VISIT_PLANNED (with the agreed date) → VISITED, or close it with a
// reason; the customer sees it on their account; Needs attention counts the new ones.
import { adminToken, client, closeAll, customerToken, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { addDays, todayIST } from '../src/clock.js'
import { ENQUIRY_MESSAGES_PER_DAY, enquiryMessageKey } from '../src/bulk-enquiries.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'
import { paramsFor } from '../src/notify.js'
import { formatOrderNumber } from '../src/order-number.js'

let srv
let api
let manager

const FLAGS = ['BULK_ENQUIRIES', 'WHATSAPP_BULK_UPDATES', 'BULK_ENQUIRY_DAILY_LIMIT', 'FARM_EXPERIENCE', 'TURNSTILE_SECRET_KEY']
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
  // The form needs no farm switch: FARM_EXPERIENCE stays off here.
  Object.assign(env, { BULK_ENQUIRIES: true, WHATSAPP_BULK_UPDATES: true, BULK_ENQUIRY_DAILY_LIMIT: 5, FARM_EXPERIENCE: false, TURNSTILE_SECRET_KEY: '' })
})
const realFetch = globalThis.fetch
afterEach(() => {
  Object.assign(env, saved)
  globalThis.fetch = realFetch
})

const FORM = () => ({ name: 'Asha Rao', phone: '98765 43210', city: 'Bengaluru', variety: 'Alphonso', kg: 300, visitFrom: addDays(todayIST(), 10), visitTo: addDays(todayIST(), 11), flexible: false, people: 6, notes: 'Two children' })
const send = (body, opts = {}) => api.post('/v1/farm-visit-enquiries', body, { headers: { 'Idempotency-Key': newId('idem') }, ...opts })
const row = async (id) => (await query('SELECT * FROM bulk_enquiries WHERE id = $1', [id])).rows[0]

describe('sending one from the shop', () => {
  test('signed out, 300 kg: numbered B, kind FARM_VISIT, the fields kept, "we got it" queued, the panel told', async () => {
    const r = await send(FORM())
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.match(r.body.number, /^B\d{9}$/)
    assert.deepEqual([r.body.kind, r.body.status], ['FARM_VISIT', 'NEW'])
    const e = await row(r.body.id)
    assert.deepEqual([e.kind, e.phone, e.quantity_kg, e.farm_variety, e.people, e.visit_flexible, e.customer_id, e.city], ['FARM_VISIT', '+919876543210', 300, 'Alphonso', 6, false, null, 'Bengaluru'])
    // Not asked: the language and the other number stay empty.
    assert.deepEqual([e.preferred_language, e.alt_phone], [null, null])
    const ymd = (d) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10)
    assert.deepEqual([ymd(e.visit_date), ymd(e.visit_to)], [addDays(todayIST(), 10), addDays(todayIST(), 11)])
    const n = (await query('SELECT * FROM notifications WHERE bulk_enquiry_id = $1', [r.body.id])).rows
    assert.deepEqual(n.map((x) => x.kind), ['FARM_VISIT_ENQUIRY_RECEIVED'])
    const p = paramsFor(n[0])
    assert.deepEqual(p.slice(0, 2), ['Asha Rao', formatOrderNumber(r.body.number)])
    assert.match(p[2], /^300 kg of Alphonso, 6 people, \w{3} \d{1,2}( \w{3})? – \w{3} \d{1,2} \w{3}, 2 days$/)
  })

  test('two visit dates (CR2-01): Day 2 is Day 1 or the next day; longer, backwards or Day 2 alone is refused; one day is fine', async () => {
    const d = (n) => addDays(todayIST(), n)
    for (const [over, field, msg] of [
      [{ visitFrom: d(5), visitTo: d(7) }, 'visitTo', /2 days at most/],
      [{ visitFrom: d(5), visitTo: d(4) }, 'visitTo', /Day 2 can’t be before Day 1/],
      [{ visitFrom: null, visitTo: d(5) }, 'visitFrom', /Pick your visit dates/],
      [{ visitFrom: d(-1), visitTo: d(0) }, 'visitFrom', /has passed/],
    ]) {
      const r = await send({ ...FORM(), ...over })
      assert.equal(r.status, 400, JSON.stringify(over))
      assert.equal(r.body.error.field, field, JSON.stringify(r.body))
      assert.match(r.body.error.message, msg)
    }
    // A 1-day visit (Q4): Day 2 = Day 1, or no Day 2 sent.
    for (const [over, phone] of [[{ visitFrom: d(3), visitTo: d(3) }, '9811111121'], [{ visitFrom: d(3), visitTo: null }, '9811111122']]) {
      const r = await send({ ...FORM(), ...over, phone })
      assert.equal(r.status, 201, JSON.stringify(r.body))
      const e = await row(r.body.id)
      assert.equal(String(e.visit_to instanceof Date ? e.visit_to.toISOString() : e.visit_to).slice(0, 10), d(3))
    }
    // The account and the panel show both days and the words.
    const cust = await customerToken(api, '9876543210')
    const r = await send(FORM(), { headers: { 'Idempotency-Key': newId('idem') }, token: cust.accessToken })
    const mine = (await api.get(`/v1/me/bulk-enquiries/${r.body.id}`, { token: cust.accessToken })).body.farmVisit
    assert.deepEqual([mine.visitFrom, mine.visitTo, mine.visitDays, mine.preferredDate], [d(10), d(11), 2, d(10)])
    assert.match(mine.visitWords, /^\w{3} \d{1,2}( \w{3})? – \w{3} \d{1,2} \w{3}, 2 days$/)
    const staff = (await api.get(`/admin/v1/bulk-enquiries/${r.body.id}`, { token: manager })).body.farmVisit
    assert.deepEqual([staff.visitFrom, staff.visitTo, staff.visitDays, staff.visitWords], [d(10), d(11), 2, mine.visitWords])
    // The database refuses a longer visit too (migration 097).
    await assert.rejects(query(`UPDATE bulk_enquiries SET visit_to = visit_date + 2 WHERE id = $1`, [r.body.id]), /check/i)
  })

  test('the older single visitDate still sends (a cached shop): Day 1 with no Day 2, "around" in the message', async () => {
    const { visitFrom: _f, visitTo: _t, ...old } = FORM()
    const r = await send({ ...old, visitDate: addDays(todayIST(), 4) })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    const e = await row(r.body.id)
    assert.deepEqual([String(e.visit_date instanceof Date ? e.visit_date.toISOString() : e.visit_date).slice(0, 10), e.visit_to], [addDays(todayIST(), 4), null])
    const n = (await query('SELECT * FROM notifications WHERE bulk_enquiry_id = $1', [r.body.id])).rows
    assert.match(paramsFor(n[0])[2], /, around \w{3} \d{1,2} \w{3}$/)
    const past = await send({ ...old, phone: '9811111123', visitDate: addDays(todayIST(), -1) })
    assert.equal(past.status, 400)
  })

  test('250 kg is the minimum; whole kg; a date in the past, an unknown mango and no people are refused; "not sure" and flexible work', async () => {
    for (const [body, field] of [[{ kg: 249 }, 'kg'], [{ kg: 100 }, 'kg'], [{ kg: 260.5 }, 'kg'], [{ people: 0 }, 'people'], [{ visitFrom: addDays(todayIST(), -1), visitTo: null }, 'visitFrom'], [{ variety: 'Durian' }, 'variety']]) {
      const r = await send({ ...FORM(), ...body })
      assert.equal(r.status, 400, `${field}: ${JSON.stringify(r.body)}`)
    }
    assert.match((await send({ ...FORM(), kg: 249 })).body.error.message, /250 kg/)
    const ok = await send({ ...FORM(), kg: 250, variety: null, visitFrom: null, visitTo: null, flexible: true })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    const e = await row(ok.body.id)
    assert.deepEqual([e.quantity_kg, e.farm_variety, e.visit_date, e.visit_to, e.visit_flexible], [250, null, null, null, true])
    // No date and no tick is also "flexible".
    assert.equal((await row((await send({ ...FORM(), visitFrom: null, visitTo: null, phone: '9811111112' })).body.id)).visit_flexible, true)
    // The 250 kg rule still holds for a plain enquiry.
    const plain = await api.post('/v1/bulk-enquiries', { name: 'Ravi', phone: '9822222222', city: 'Mysuru', quantityKg: 150 }, { headers: { 'Idempotency-Key': newId('idem') } })
    assert.equal(plain.body.error.code, 'BULK_ENQUIRY_TOO_SMALL')
  })

  test('the same Idempotency-Key is one enquiry; another body with it is refused; the daily limit per phone', async () => {
    const opts = { headers: { 'Idempotency-Key': newId('idem') } }
    const a = await send(FORM(), opts)
    const b = await send(FORM(), opts)
    assert.deepEqual([a.status, b.status, b.body.id], [201, 200, a.body.id])
    assert.equal((await send({ ...FORM(), kg: 400 }, opts)).body.error.code, 'IDEMPOTENCY_KEY_REUSED')
    env.BULK_ENQUIRY_DAILY_LIMIT = 2
    assert.equal((await send(FORM())).status, 201)
    const third = await send(FORM())
    assert.deepEqual([third.status, third.body.error.code], [429, 'BULK_LIMIT'])
  })

  test('signed in: linked to the account and listed there with its fields; a stale token still sends', async () => {
    const cust = await customerToken(api, '9876543210')
    const r = await send(FORM(), { headers: { 'Idempotency-Key': newId('idem') }, token: cust.accessToken })
    assert.equal(r.status, 201)
    assert.equal((await row(r.body.id)).customer_id, cust.customer.id)
    const mine = (await api.get('/v1/me/bulk-enquiries', { token: cust.accessToken })).body.items
    assert.equal(mine[0].kind, 'FARM_VISIT')
    assert.deepEqual([mine[0].farmVisit.kg, mine[0].farmVisit.variety, mine[0].farmVisit.people, mine[0].farmVisit.flexible], [300, 'Alphonso', 6, false])
    assert.equal(mine[0].order, null)
    assert.equal((await send(FORM(), { headers: { 'Idempotency-Key': newId('idem') }, token: 'stale' })).status, 201)
  })
})

describe('the language to speak and another number (migration 094)', () => {
  test('optional; checked; kept as +91 numbers; shown on the account and to staff', async () => {
    for (const [over, msg] of [[{ preferredLanguage: 'French' }, /preferredLanguage: Choose a language/], [{ altPhone: '5555555555' }, /altPhone: Enter a 10-digit/], [{ altPhone: '98765' }, /altPhone/]]) {
      const r = await send({ ...FORM(), ...over })
      assert.equal(r.status, 400, JSON.stringify(over))
      assert.match(r.body.error.message, msg)
    }
    const cust = await customerToken(api, '9876543210')
    const r = await send({ ...FORM(), preferredLanguage: 'Tamil', altPhone: '+91 98111 11113' }, { headers: { 'Idempotency-Key': newId('idem') }, token: cust.accessToken })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    const e = await row(r.body.id)
    assert.deepEqual([e.preferred_language, e.alt_phone], ['Tamil', '+919811111113'])
    const mine = (await api.get(`/v1/me/bulk-enquiries/${r.body.id}`, { token: cust.accessToken })).body
    assert.deepEqual([mine.farmVisit.preferredLanguage, mine.farmVisit.altPhone], ['Tamil', '+919811111113'])
    const staff = (await api.get(`/admin/v1/bulk-enquiries/${r.body.id}`, { token: manager })).body
    assert.deepEqual([staff.farmVisit.preferredLanguage, staff.farmVisit.altPhone], ['Tamil', '+919811111113'])
    const list = (await api.get('/admin/v1/bulk-enquiries?kind=FARM_VISIT', { token: manager })).body.items
    assert.deepEqual([list[0].farmVisit.preferredLanguage, list[0].farmVisit.altPhone], ['Tamil', '+919811111113'])
    // Sent empty (the shop's "Choose" and an empty box): nothing stored.
    const blank = await send({ ...FORM(), phone: '9822222223', preferredLanguage: '', altPhone: '' })
    assert.equal(blank.status, 201, JSON.stringify(blank.body))
    assert.deepEqual([(await row(blank.body.id)).preferred_language, (await row(blank.body.id)).alt_phone], [null, null])
  })
})

describe('Turnstile and the daily message cap (AUTH-01)', () => {
  const counts = async () => (await query(`SELECT (SELECT count(*)::int FROM bulk_enquiries) AS enquiries, (SELECT count(*)::int FROM notifications) AS messages`)).rows[0]

  test('with Turnstile set up, a form without a token is refused, signed in or not, and nothing is saved or queued', async () => {
    // Signed in first: with Turnstile on, asking for a login code needs a token too.
    const cust = await customerToken(api, '9876543210')
    env.TURNSTILE_SECRET_KEY = 'secret'
    const anon = await send(FORM())
    assert.deepEqual([anon.status, anon.body.error?.code], [400, 'CAPTCHA_REQUIRED'], JSON.stringify(anon.body))
    const signed = await send(FORM(), { headers: { 'Idempotency-Key': newId('idem') }, token: cust.accessToken })
    assert.deepEqual([signed.status, signed.body.error?.code], [400, 'CAPTCHA_REQUIRED'])
    assert.deepEqual(await counts(), { enquiries: 0, messages: 0 })
  })

  test('with Turnstile set up, a token solved for the farm visit form sends it; one for the bulk form does not', async () => {
    env.TURNSTILE_SECRET_KEY = 'secret'
    const hostname = new URL(env.CUSTOMER_ORIGIN.split(',')[0].trim()).hostname
    let action = 'bulk'
    globalThis.fetch = (url, init) =>
      String(url).startsWith('https://challenges.cloudflare.com/')
        ? Promise.resolve(new Response(JSON.stringify({ success: true, hostname, action }), { headers: { 'Content-Type': 'application/json' } }))
        : realFetch(url, init)
    const wrong = await send({ ...FORM(), captchaToken: 'tok-bulk' })
    assert.deepEqual([wrong.status, wrong.body.error?.code], [400, 'CAPTCHA_FAILED'])
    action = 'farm-visit'
    const ok = await send({ ...FORM(), captchaToken: 'tok-farm' })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    assert.deepEqual(await counts(), { enquiries: 1, messages: 1 })
  })

  test('without Turnstile set up the form works as before', async () => {
    assert.equal((await send(FORM())).status, 201)
    assert.equal((await send({ ...FORM(), captchaToken: 'ignored' })).status, 201)
  })

  test('past the shop-wide daily cap the enquiry is saved but no "we got it" message is queued', async () => {
    await query(`INSERT INTO rate_limits (key, hits, reset_at) VALUES ($1, $2, now() + interval '1 day')`, [enquiryMessageKey(), ENQUIRY_MESSAGES_PER_DAY])
    const r = await send(FORM())
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal((await row(r.body.id)).kind, 'FARM_VISIT')
    assert.equal((await query('SELECT count(*)::int AS n FROM notifications WHERE bulk_enquiry_id = $1', [r.body.id])).rows[0].n, 0)
  })
})

describe('staff', () => {
  test('the third list, its badge count, search; called, visit planned (a date), visited; history; Needs attention counts the new ones', async () => {
    const a = (await send(FORM())).body
    const b = (await send({ ...FORM(), name: 'Ravi Kumar', phone: '9822222222' })).body
    await api.post('/v1/bulk-enquiries', { name: 'Big', phone: '9833333333', city: 'Mysuru', quantityKg: 300 }, { headers: { 'Idempotency-Key': newId('idem') } })
    const list = (await api.get('/admin/v1/bulk-enquiries?kind=FARM_VISIT', { token: manager })).body
    assert.deepEqual(list.items.map((x) => x.kind), ['FARM_VISIT', 'FARM_VISIT'])
    assert.equal(list.kinds.FARM_VISIT.NEW, 2)
    assert.equal(list.kinds.ENQUIRY.NEW, 1)
    assert.equal(list.items[0].farmVisit.people, 6)
    for (const typed of [formatOrderNumber(a.number), a.number.toLowerCase(), 'asha', '43210']) {
      const found = (await api.get(`/admin/v1/bulk-enquiries?kind=FARM_VISIT&q=${encodeURIComponent(typed)}`, { token: manager })).body.items
      assert.deepEqual(found.map((x) => x.id), [a.id], typed)
    }
    assert.deepEqual((await api.get('/admin/v1/attention', { token: manager })).body.farmVisitEnquiries.new, 2)

    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    const move = (id, body) => api.post(`/admin/v1/bulk-enquiries/${id}/farm-status`, body, { token: ops })
    assert.equal((await move(a.id, { to: 'VISITED' })).body.error.code, 'INVALID_TRANSITION')
    const called = await move(a.id, { to: 'CONTACTED', note: 'Prefers a Saturday' })
    assert.equal(called.status, 200, JSON.stringify(called.body))
    assert.equal(called.body.status, 'CONTACTED')
    assert.equal((await move(a.id, { to: 'VISIT_PLANNED' })).status, 400)
    assert.equal((await move(a.id, { to: 'VISIT_PLANNED', date: addDays(todayIST(), -2) })).status, 400)
    const day = addDays(todayIST(), 12)
    const planned = await move(a.id, { to: 'VISIT_PLANNED', date: day })
    assert.deepEqual([planned.body.status, planned.body.farmVisit.plannedDate], ['VISIT_PLANNED', day])
    const visited = await move(a.id, { to: 'VISITED' })
    assert.equal(visited.body.status, 'VISITED')
    assert.deepEqual(visited.body.events.map((x) => x.type), ['RECEIVED', 'CONTACTED', 'VISIT_PLANNED', 'VISITED'])
    assert.equal(visited.body.events[2].detail.date, day)
    // Closing asks why; the reason is kept and shown.
    assert.equal((await api.post(`/admin/v1/bulk-enquiries/${b.id}/close`, {}, { token: ops })).status, 400)
    const closed = await api.post(`/admin/v1/bulk-enquiries/${b.id}/close`, { reason: 'Chose another farm' }, { token: ops })
    assert.deepEqual([closed.body.status, closed.body.closeReason], ['CLOSED', 'Chose another farm'])
    assert.equal((await move(b.id, { to: 'CONTACTED' })).status, 409)
    // No quote for a farm visit.
    assert.equal((await api.post(`/admin/v1/bulk-enquiries/${a.id}/quote`, { lines: [{ label: 'x', qty: 1, unitPrice: 1 }] }, { token: ops })).body.error.code, 'FARM_VISIT_NO_QUOTE')
    assert.equal((await api.get('/admin/v1/attention', { token: manager })).body.farmVisitEnquiries.new, 0)
    assert.equal((await query(`SELECT count(*)::int AS n FROM staff_audit WHERE action LIKE '% farm visit enquiry'`)).rows[0].n, 3)
    // A plain enquiry can't be moved as a farm visit; packers can't move any.
    const plain = (await api.get('/admin/v1/bulk-enquiries?kind=ENQUIRY', { token: manager })).body.items[0]
    assert.equal((await move(plain.id, { to: 'CONTACTED' })).body.error.code, 'NOT_FARM_VISIT')
    const packer = await adminToken(api, 'packer@mandimangoes.test', 'packer123').catch(() => null)
    if (packer) assert.equal((await api.post(`/admin/v1/bulk-enquiries/${b.id}/farm-status`, { to: 'CONTACTED' }, { token: packer })).status, 403)
  })

  test('BULK_ENQUIRIES off: the form answers 404', async () => {
    env.BULK_ENQUIRIES = false
    assert.equal((await send(FORM())).status, 404)
  })
})
