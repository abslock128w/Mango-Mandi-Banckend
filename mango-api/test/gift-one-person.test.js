// A gift for one person with as many boxes as they like (change request 02, CR2-06 and CR2-07; migration 098;
// docs/gifting.md "One person, many boxes"). In season: one recipient with several box lines is ONE delivery order
// with a line per box, paid once, capped at 20 boxes. Before the season: one booking per box line (oneDelivery), all in
// the same week (the latest any line needs), turned by the allocator into ONE delivery order. The optional landmark
// is stored apart from the address and shown to the buyer, the panel and the delivery run.
import { adminToken, client, closeAll, customerToken, makeBatch, resetDb, signWebhook, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { addDays, setNow, todayIST } from '../src/clock.js'
import { query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'
import { runPreorderJobs } from '../src/maintenance.js'
import { setWeekLimit } from '../src/preorders.js'

let srv
let api
let admin
before(async () => {
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  env.MULTI_GIFT = false
  await srv.close()
  await closeAll()
})
beforeEach(async () => {
  env.MULTI_GIFT = true
  await resetDb()
  admin = await adminToken(api)
})
afterEach(() => {
  env.MULTI_GIFT = false
})

const ALP3 = 189_900
const ALP5 = 299_900
const LANDMARK = 'near Sai Baba temple, opposite bus stop'
const ADDRESS = '4, 4th Cross, Koramangala, Bengaluru'
const ravi = (over = {}) => ({ name: 'Ravi Kumar', phone: '9000000001', address: ADDRESS, landmark: LANDMARK, pincode: '560034', note: 'Happy summer!', ...over })
const LINES = [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2 }, { sku: 'ALP-5', stage: 'SEMI_RIPE', qty: 1 }]

const quote = (token, recipients) => api.post('/v1/gifts/quote', { recipients }, { token })
const confirm = (token, quoteId) => api.post('/v1/gifts/confirm', { quoteId, name: 'Asha Rao' }, { token, headers: { 'Idempotency-Key': newId('k') } })
async function payGift(c) {
  const s = signWebhook({ event: 'payment.captured', payload: { payment: { entity: { id: `pay_${c.giftOrderId}`, order_id: c.razorpayOrderId, amount: c.total, currency: 'INR', method: 'upi' } } } })
  const r = await api.raw('POST', '/webhooks/razorpay', { raw: s.raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': s.signature, 'X-Razorpay-Event-Id': newId('evt') } })
  assert.equal(r.status, 200, JSON.stringify(r.body))
}

describe('in season: one person, several boxes, one delivery', () => {
  test('several box lines for one recipient make one delivery order with a line per box, one payment, and the landmark', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10, 'ALP-5': 10 } })
    const cust = await customerToken(api)
    const q = await quote(cust.accessToken, [ravi({ lines: LINES })])
    assert.equal(q.status, 200, JSON.stringify(q.body))
    assert.equal(q.body.boxes, 3)
    assert.equal(q.body.total, 2 * ALP3 + ALP5)
    assert.deepEqual(q.body.recipients[0].lines.map((l) => [l.sku, l.qty, l.linePrice]), [['ALP-3', 2, 2 * ALP3], ['ALP-5', 1, ALP5]])
    const c = await confirm(cust.accessToken, q.body.quoteId)
    assert.equal(c.status, 201, JSON.stringify(c.body))
    assert.equal(c.body.recipientCount, 1)
    const kids = (await query('SELECT * FROM orders WHERE gift_order_id = $1', [c.body.giftOrderId])).rows
    assert.equal(kids.length, 1)
    assert.deepEqual([kids[0].delivery_address, kids[0].delivery_landmark, kids[0].total], [ADDRESS, LANDMARK, 2 * ALP3 + ALP5])
    const items = (await query('SELECT sku, quantity FROM order_items WHERE order_id = $1 ORDER BY sku', [kids[0].id])).rows
    assert.deepEqual(items.map((i) => [i.sku, i.quantity]), [['ALP-3', 2], ['ALP-5', 1]])
    await payGift(c.body)

    // The buyer's gift order: one recipient, both lines, the landmark.
    const g = (await api.get(`/v1/gifts/${c.body.giftOrderId}`, { token: cust.accessToken })).body
    assert.equal(g.status, 'PAID')
    assert.equal(g.recipients.length, 1)
    assert.deepEqual([g.recipients[0].qty, g.recipients[0].landmark, g.recipients[0].lines.length], [3, LANDMARK, 2])
    // The panel's order page and the gift orders list.
    const o = (await api.get(`/admin/v1/orders/${kids[0].id}`, { token: admin })).body
    assert.equal(o.deliveryLandmark, LANDMARK)
    const list = (await api.get('/admin/v1/gift-orders', { token: admin })).body.items[0]
    assert.deepEqual([list.children[0].landmark, list.children[0].boxes.length], [LANDMARK, 2])
    // The delivery run (the printed run and the rider app read it): the stop carries the landmark.
    const run = (await api.get(`/admin/v1/manifest?date=${kids[0].delivery_date}`, { token: admin })).body
    const stop = run.runs.flatMap((r) => r.stops.flatMap((s) => s.orders)).find((x) => x.id === kids[0].id)
    assert.ok(stop, JSON.stringify(run))
    assert.deepEqual([stop.deliveryLandmark, stop.boxes, stop.items.length], [LANDMARK, 3, 2])
    // The customer's own order view.
    assert.equal((await api.get(`/v1/orders/${kids[0].id}`, { token: cust.accessToken })).body.deliveryLandmark, LANDMARK)
    // The gift form's City fills from the pincode.
    const check = (await api.get('/v1/delivery/check?pincode=560034')).body
    assert.equal(typeof check.city, 'string')
    assert.ok(check.city.length > 0)
  })

  test('at most 20 boxes in one gift, a landmark of up to 100 characters, and the old one-box shape still works', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 40, 'ALP-5': 40 } })
    const cust = await customerToken(api)
    const big = await quote(cust.accessToken, [ravi({ lines: [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 11 }, { sku: 'ALP-5', stage: 'SEMI_RIPE', qty: 10 }] })])
    assert.equal(big.status, 400)
    assert.equal(big.body.error.code, 'RECIPIENTS_INVALID')
    assert.deepEqual(big.body.error.rows.map((r) => r.field), ['qty'])
    assert.equal((await quote(cust.accessToken, [ravi({ lines: [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 10 }, { sku: 'ALP-5', stage: 'SEMI_RIPE', qty: 10 }] })])).status, 200)
    const long = await quote(cust.accessToken, [ravi({ lines: LINES, landmark: 'x'.repeat(101) })])
    assert.equal(long.status, 400)
    assert.deepEqual(long.body.error.rows.map((r) => r.field), ['landmark'])
    // Both shapes at once is a mistake; the old shape alone (sku, stage, qty), without a landmark, works as before.
    assert.equal((await quote(cust.accessToken, [ravi({ lines: LINES, sku: 'ALP-3' })])).status, 400)
    const old = await quote(cust.accessToken, [{ ...ravi({ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }), landmark: undefined }])
    assert.equal(old.status, 200, JSON.stringify(old.body))
    assert.deepEqual([old.body.recipients[0].lines.length, old.body.recipients[0].landmark], [1, null])
  })
})

/** The first Monday after the regular booking horizon, and the clock set so it is the first delivery week. */
function preSeason() {
  let week = addDays(todayIST(), 6)
  while (new Date(`${week}T00:00:00Z`).getUTCDay() !== 1) week = addDays(week, 1)
  setNow(`${addDays(week, -6)}T04:30:00Z`)
  return week
}
const line = (sku, qty, weekStart, over = {}) => ({
  sku, stage: 'SEMI_RIPE', qty, weekStart, pincode: '560034', address: ADDRESS, landmark: LANDMARK,
  gift: { recipientName: 'Ravi Kumar', recipientPhone: '98450 12342', message: 'Happy summer!' }, ...over,
})
const book = (token, recipients, extra = { oneDelivery: true }) =>
  api.post('/v1/preorders/groups', { name: 'Asha Rao', recipients, ...extra }, { token, headers: { 'Idempotency-Key': newId('idem') } })
const members = async (groupId) => (await query('SELECT * FROM preorders WHERE group_id = $1 ORDER BY group_position', [groupId])).rows
async function payGroup(groupId) {
  const [lead] = await members(groupId)
  const g = (await query('SELECT * FROM preorder_groups WHERE id = $1', [groupId])).rows[0]
  const { raw, signature } = signWebhook({
    event: 'payment_link.paid',
    payload: { payment_link: { entity: { id: lead.payment_link_id, notes: { preorderId: lead.id }, status: 'paid' } }, payment: { entity: { id: `pay_${groupId}`, amount: g.total, method: 'upi' } } },
  })
  const r = await api.raw('POST', '/webhooks/razorpay', { raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature } })
  assert.equal(r.status, 200, JSON.stringify(r.body))
}

describe('before the season: one person, several boxes, one week and one delivery', () => {
  test('every line takes the week of the line that is ready last; a shown week that no longer fits is refused', async () => {
    const week = preSeason()
    const next = addDays(week, 7)
    // Week 1 holds 6 kg of Alphonso: the 3 kg box alone fits, the 3 kg and the 5 kg together do not.
    await tx((c) => setWeekLimit(c, week, 6, 'Alphonso'))
    const a = await customerToken(api)
    const shown = await book(a.accessToken, [line('ALP-3', 1, week), line('ALP-5', 1, week)])
    assert.equal(shown.status, 409)
    assert.equal(shown.body.error.code, 'PREORDER_FULL')
    assert.equal(shown.body.error.weekStart, next)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM preorders')).rows[0].n, 0)

    const r = await book(a.accessToken, [line('ALP-3', 1, next), line('ALP-5', 1, next)])
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.deepEqual([r.body.oneDelivery, r.body.recipientCount, r.body.lineCount, r.body.boxes, r.body.total], [true, 1, 2, 2, ALP3 + ALP5])
    assert.deepEqual(r.body.preorders.map((p) => [p.weekStart, p.landmark]), [[next, LANDMARK], [next, LANDMARK]])
    // Week 1 took nothing: the trial reservations were rolled back.
    const w1 = Number((await query('SELECT COALESCE(SUM(reserved_kg), 0) AS kg FROM preorder_variety_week_kg WHERE week_start = $1', [week])).rows[0].kg)
    assert.equal(w1, 0)
  })

  test('paid once, the allocator turns every line into ONE delivery order with the landmark', async () => {
    const week = preSeason()
    const a = await customerToken(api)
    const r = await book(a.accessToken, [line('ALP-3', 2, week), line('ALP-5', 1, week)])
    assert.equal(r.status, 201, JSON.stringify(r.body))
    await payGroup(r.body.id)
    await makeBatch({ age: 0, rating: 'RAW', lines: { 'ALP-3': 10, 'ALP-5': 10 } })
    await runPreorderJobs()
    const [p1, p2] = await members(r.body.id)
    assert.deepEqual([p1.status, p2.status], ['CONVERTED', 'CONVERTED'])
    assert.equal(p1.order_id, p2.order_id)
    const o = (await query('SELECT * FROM orders WHERE id = $1', [p1.order_id])).rows[0]
    assert.deepEqual([o.delivery_landmark, o.gift_recipient_name, o.preorder_id, o.number], [LANDMARK, 'Ravi Kumar', p1.id, p1.number])
    assert.equal(Number(o.payment_amount), 2 * ALP3 + ALP5)
    const items = (await query('SELECT sku, quantity FROM order_items WHERE order_id = $1 ORDER BY sku', [o.id])).rows
    assert.deepEqual(items.map((i) => [i.sku, i.quantity]), [['ALP-3', 2], ['ALP-5', 1]])
  })

  test('one person and one address, no box twice, at most 20 boxes', async () => {
    const week = preSeason()
    const a = await customerToken(api)
    const two = await book(a.accessToken, [line('ALP-3', 1, week), line('ALP-5', 1, week, { address: '9, 1st Main, Indiranagar, Bengaluru' })])
    assert.deepEqual([two.status, two.body.error.code], [400, 'RECIPIENTS_INVALID'])
    const twice = await book(a.accessToken, [line('ALP-3', 1, week), line('ALP-3', 2, week)])
    assert.deepEqual([twice.status, twice.body.error.code], [400, 'RECIPIENTS_INVALID'])
    const many = await book(a.accessToken, [line('ALP-3', 11, week), line('ALP-5', 10, week)])
    assert.deepEqual([many.status, many.body.error.code, many.body.error.maxBoxes], [400, 'GIFT_TOO_MANY_BOXES', 20])
    const long = await book(a.accessToken, [line('ALP-3', 1, week, { landmark: 'x'.repeat(101) })])
    assert.equal(long.status, 400)
  })
})
