// Bulk and corporate gifting (MULTI_GIFT, docs/gifting.md): one gift order to
// many recipients, one payment, one delivery order per recipient. The server
// rules: the recipient limit, served pincodes, per-recipient box limits and the
// buyer's hold limits, holds taken for all recipients or none, prices checked
// again at Pay, no access to another customer's gift order, a payment webhook
// that confirms the deliveries once however often it comes, a cancel of one
// recipient refunding only that recipient's amount and only before packing,
// the one bill, the staff view and a formula-safe CSV template.
import { adminToken, client, closeAll, customerToken, makeBatch, resetDb, signWebhook, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { getConfig, loadConfig, saveConfig } from '../src/config.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { gstinCheckChar } from '../src/gstin.js'
import { newId } from '../src/ids.js'
import { recipientsTemplate } from '../src/gift-routes.js'
import { shareDiscount } from '../src/gifts.js'
import { loadProducts } from '../src/products.js'
import { setTrustConfig } from '../src/trust-config.js'

let srv
let api
before(async () => {
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  env.MULTI_GIFT = false
  setTrustConfig({})
  await srv.close()
  await closeAll()
})
beforeEach(async () => {
  env.MULTI_GIFT = true
  env.MULTI_GIFT_MAX_RECIPIENTS = 25
  setTrustConfig({})
  await resetDb()
})
afterEach(() => {
  env.MULTI_GIFT = false
  env.MULTI_GIFT_MAX_RECIPIENTS = 25
})

const BOX = 189_900
const BUYER_GSTIN = `29AABCT1332L1Z${gstinCheckChar('29AABCT1332L1Z')}`
const person = (i, over = {}) => ({
  name: `Recipient ${i}`, phone: `90000000${String(i).padStart(2, '0')}`, address: `${i}, 4th Cross, Koramangala, Bengaluru`,
  pincode: '560034', sku: 'ALP-3', stage: 'RIPE', qty: 1, note: i === 1 ? 'Happy Diwali!' : null, ...over,
})
const people = (n, over = {}) => Array.from({ length: n }, (_, i) => person(i + 1, over))
const stock = (qty = 30) => makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': qty } })

async function quote(token, recipients, extra = {}) {
  return api.post('/v1/gifts/quote', { recipients, ...extra }, { token })
}
async function confirm(token, quoteId, extra = {}, key = newId('k')) {
  return api.post('/v1/gifts/confirm', { quoteId, ...extra }, { token, headers: { 'Idempotency-Key': key } })
}
async function placed(n = 3, { cust, over = {}, extra = {}, confirmExtra = {} } = {}) {
  cust ??= await customerToken(api)
  const q = await quote(cust.accessToken, people(n, over), extra)
  assert.equal(q.status, 200, JSON.stringify(q.body))
  const c = await confirm(cust.accessToken, q.body.quoteId, { name: 'Meera Corp Buyer', ...confirmExtra })
  assert.equal(c.status, 201, JSON.stringify(c.body))
  return { cust, q: q.body, c: c.body }
}
const kids = async (giftOrderId) => (await query('SELECT * FROM orders WHERE gift_order_id = $1 ORDER BY gift_position', [giftOrderId])).rows
const held = async (orderIds) =>
  (await query(`SELECT COALESCE(SUM(quantity), 0)::int AS n FROM order_stock WHERE order_id = ANY($1) AND state = 'held'`, [orderIds])).rows[0].n
const captured = (c, paymentId = 'pay_gift1') => ({
  event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: c.razorpayOrderId, amount: c.total, currency: 'INR', method: 'upi' } } },
})
async function webhook(event, eventId) {
  const s = signWebhook(event)
  const r = await api.raw('POST', '/webhooks/razorpay', {
    raw: s.raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': s.signature, ...(eventId ? { 'X-Razorpay-Event-Id': eventId } : {}) },
  })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
async function paid(n = 3, opts = {}) {
  const p = await placed(n, opts)
  const r = await webhook(captured(p.c), newId('evt'))
  assert.equal(r.result, 'confirmed', JSON.stringify(r))
  return p
}

describe('the switch', () => {
  test('with MULTI_GIFT off every gift route answers 404, for the buyer and for staff', async () => {
    env.MULTI_GIFT = false
    const cust = await customerToken(api)
    for (const [m, p] of [['post', '/v1/gifts/quote'], ['get', '/v1/gifts'], ['get', '/v1/gifts/template.csv'], ['post', '/v1/gifts/confirm']]) {
      const r = m === 'get' ? await api.get(p, { token: cust.accessToken }) : await api.post(p, {}, { token: cust.accessToken, headers: { 'Idempotency-Key': 'k1' } })
      assert.equal(r.status, 404, p)
    }
    const manager = await adminToken(api)
    assert.equal((await api.get('/admin/v1/gift-orders', { token: manager })).status, 404)
    assert.equal((await api.get('/v1/policy')).body.features.multiGift, false)
  })

  test('the routes need a signed-in customer', async () => {
    assert.equal((await api.post('/v1/gifts/quote', { recipients: people(2) })).status, 401)
    assert.equal((await api.get('/v1/gifts/template.csv')).status, 401)
  })
})

describe('recipients are checked on the server', () => {
  test('no more than MULTI_GIFT_MAX_RECIPIENTS recipients, and at least one', async () => {
    await stock()
    env.MULTI_GIFT_MAX_RECIPIENTS = 3
    const cust = await customerToken(api)
    const r = await quote(cust.accessToken, people(4))
    assert.equal(r.status, 400)
    assert.equal(r.body.error.code, 'TOO_MANY_RECIPIENTS')
    assert.equal(r.body.error.maxRecipients, 3)
    assert.equal((await quote(cust.accessToken, people(3))).status, 200)
    assert.equal((await quote(cust.accessToken, [])).body.error.code, 'RECIPIENTS_REQUIRED')
    assert.equal((await api.get('/v1/policy')).body.multiGiftMaxRecipients, 3)
  })

  test('each row is validated, and every problem is reported by row', async () => {
    await stock()
    const cust = await customerToken(api)
    const list = [
      person(1),
      person(2, { pincode: '110001' }), // a pincode we don't serve
      person(3, { phone: '12345' }),
      person(4, { sku: 'NOPE-1' }),
      person(5, { address: 'short' }),
      { ...person(6), extra: 'x' },
    ]
    const r = await quote(cust.accessToken, list)
    assert.equal(r.status, 400)
    assert.equal(r.body.error.code, 'RECIPIENTS_INVALID')
    const byRow = Object.groupBy(r.body.error.rows, (p) => p.row)
    assert.deepEqual(Object.keys(byRow).map(Number), [2, 3, 4, 5, 6])
    assert.equal(byRow[2][0].field, 'pincode')
    assert.match(byRow[2][0].message, /do not deliver to 110001/)
    assert.equal(byRow[3][0].field, 'phone')
    assert.equal(byRow[4][0].field, 'sku')
    assert.equal(byRow[5][0].field, 'address')
    assert.match(r.body.error.message, /^Recipient 2: /)
  })

  test('a served pincode is checked again at Pay', async () => {
    await stock()
    const cust = await customerToken(api)
    const q = await quote(cust.accessToken, [person(1), person(2, { pincode: '560038' })])
    assert.equal(q.status, 200)
    await query(`UPDATE pincodes SET active = FALSE WHERE pincode = '560038'`)
    const c = await confirm(cust.accessToken, q.body.quoteId)
    assert.equal(c.status, 400)
    assert.equal(c.body.error.code, 'NOT_SERVICEABLE')
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM gift_orders')).rows[0].n, 0)
  })

  test('per-recipient and per-buyer box limits: the cart line limit, maxHeldBoxes and one unpaid order', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 80 } })
    const cust = await customerToken(api)
    const tooMany = await quote(cust.accessToken, [person(1, { qty: 21 })])
    assert.equal(tooMany.body.error.code, 'RECIPIENTS_INVALID')
    assert.equal(tooMany.body.error.rows[0].field, 'qty')
    await saveConfig({ ...getConfig(), maxHeldBoxes: 6 }, 'test')
    await loadConfig()
    const max = getConfig().maxHeldBoxes
    assert.equal(max, 6)
    // One recipient may not get more than the buyer may hold.
    assert.equal((await quote(cust.accessToken, [person(1, { qty: 7 })])).body.error.rows[0].field, 'qty')
    // Over the buyer's hold limit across recipients: refused at the review, before anything is held.
    const over = await quote(cust.accessToken, people(Math.ceil((max + 1) / 2), { qty: 2 }))
    assert.equal(over.status, 409)
    assert.equal(over.body.error.code, 'HOLD_LIMIT')
    // An unpaid order already held: the gift order is refused at Pay (maxUnpaidOrders), as any checkout.
    const first = await placed(2, { cust })
    const q2 = await quote(cust.accessToken, people(2))
    const second = await confirm(cust.accessToken, q2.body.quoteId)
    assert.equal(second.status, 409)
    assert.equal(second.body.error.code, 'UNPAID_ORDER_EXISTS')
    assert.equal(second.body.error.giftOrderId, first.c.giftOrderId)
  })
})

describe('checkout', () => {
  test('one payment for the whole order; every recipient a delivery order with its boxes held', async () => {
    await stock()
    const { c, q } = await placed(3, { over: { qty: 2 } })
    assert.equal(q.total, 3 * 2 * BOX)
    assert.equal(c.total, q.total)
    assert.match(c.razorpayOrderId, /^order_dev_/)
    assert.equal(c.recipientCount, 3)
    const ks = await kids(c.giftOrderId)
    assert.equal(ks.length, 3)
    for (const [i, k] of ks.entries()) {
      assert.equal(k.status, 'PAYMENT_PENDING')
      assert.equal(k.gift_position, i + 1)
      assert.equal(k.gift_recipient_name, `Recipient ${i + 1}`)
      assert.equal(k.gift_recipient_phone, `+9190000000${String(i + 1).padStart(2, '0')}`)
      assert.equal(k.delivery_date, c.deliveryDate)
      assert.equal(k.razorpay_order_id, null) // the parent carries the one Razorpay order
      assert.equal(k.total, 2 * BOX)
    }
    assert.equal(ks[0].gift_message, 'Happy Diwali!')
    assert.equal(await held(ks.map((k) => k.id)), 6)
  })

  test('holds are all or nothing: one recipient short of stock means no holds and no orders at all', async () => {
    await stock(4)
    const a = await customerToken(api)
    const q = await quote(a.accessToken, people(4))
    assert.equal(q.status, 200)
    // Someone else takes a box between the review and Pay.
    const b = await customerToken(api)
    assert.equal((await api.post('/v1/cart/items', { sku: 'ALP-3', stage: 'RIPE', qty: 1 }, { token: b.accessToken })).status, 204)
    const bq = await api.post('/v1/checkout/quote', { pincode: '560034' }, { token: b.accessToken })
    const bc = await api.post('/v1/checkout/confirm', { quoteId: bq.body.quoteId, address: '9, 1st Main, Koramangala, Bengaluru' }, { token: b.accessToken, headers: { 'Idempotency-Key': 'b1' } })
    assert.equal(bc.status, 201)
    const c = await confirm(a.accessToken, q.body.quoteId)
    assert.equal(c.status, 409)
    assert.equal(c.body.error.code, 'STOCK_INSUFFICIENT')
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM gift_orders')).rows[0].n, 0)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM orders WHERE customer_id = $1', [a.customer.id])).rows[0].n, 0)
    assert.equal((await query(`SELECT COALESCE(SUM(quantity), 0)::int AS n FROM order_stock WHERE state = 'held'`)).rows[0].n, 1) // only b's box
    // The quote also sums every recipient's boxes against the day's stock.
    const short = await quote(a.accessToken, people(4))
    assert.equal(short.status, 409)
    assert.equal(short.body.error.code, 'STOCK_INSUFFICIENT')
  })

  test('a price that changed since the review fails with PRICE_CHANGED and holds nothing', async () => {
    await stock()
    const cust = await customerToken(api)
    const q = await quote(cust.accessToken, people(2))
    await query(`UPDATE products SET price = price + 10000 WHERE sku = 'ALP-3'`)
    await loadProducts()
    const c = await confirm(cust.accessToken, q.body.quoteId)
    assert.equal(c.status, 409)
    assert.equal(c.body.error.code, 'PRICE_CHANGED')
    assert.equal(c.body.error.unitPrice, BOX + 10000)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM orders')).rows[0].n, 0)
  })

  test('a promo applies under the usual rules, shared over the recipients, used once', async () => {
    await stock()
    const manager = await adminToken(api)
    const pr = await api.post('/admin/v1/promos', { code: 'GIFT10', kind: 'PERCENT', value: 10, perCustomer: 1 }, { token: manager })
    assert.ok([200, 201].includes(pr.status), JSON.stringify(pr.body))
    const { c, q, cust } = await placed(3, { extra: { promoCode: 'GIFT10' } })
    assert.equal(q.discount, Math.floor((3 * BOX * 10) / 100))
    assert.equal(c.total, 3 * BOX - q.discount)
    const ks = await kids(c.giftOrderId)
    assert.equal(ks.reduce((s, k) => s + k.total, 0), c.total)
    assert.equal(ks.reduce((s, k) => s + k.discount, 0), q.discount)
    assert.equal((await query(`SELECT COUNT(*)::int AS n FROM promo_redemptions WHERE code = 'GIFT10'`)).rows[0].n, 1)
    // Used up for this buyer (perCustomer 1), as for any order.
    const again = await quote(cust.accessToken, people(1), { promoCode: 'GIFT10' })
    assert.equal(again.body.error.code, 'PROMO_ALREADY_USED')
    assert.deepEqual(shareDiscount(10, [1, 1, 1]), [3, 3, 4])
  })

  test('the same Idempotency-Key replays the gift order; a regular checkout cannot spend a gift quote', async () => {
    await stock()
    const cust = await customerToken(api)
    const q = await quote(cust.accessToken, people(2))
    const k = newId('k')
    const one = await confirm(cust.accessToken, q.body.quoteId, {}, k)
    const two = await confirm(cust.accessToken, q.body.quoteId, {}, k)
    assert.equal(one.status, 201)
    assert.equal(two.status, 200)
    assert.equal(two.body.giftOrderId, one.body.giftOrderId)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM orders')).rows[0].n, 2)
    const q2 = await quote(cust.accessToken, people(1))
    const wrong = await api.post('/v1/checkout/confirm', { quoteId: q2.body.quoteId, address: '12, 4th Cross, Koramangala, Bengaluru' }, { token: cust.accessToken, headers: { 'Idempotency-Key': 'x2' } })
    assert.equal(wrong.status, 409)
    assert.equal(wrong.body.error.code, 'QUOTE_EXPIRED')
  })
})

describe('payment', () => {
  test('the webhook confirms every delivery once, however often it comes', async () => {
    await stock()
    const { c } = await placed(3)
    const ev = captured(c)
    assert.equal((await webhook(ev, 'evt_gift_1')).result, 'confirmed')
    assert.equal((await webhook(ev, 'evt_gift_1')).duplicate, true) // the same event id
    assert.equal((await webhook(ev, 'evt_gift_2')).result, 'already_paid') // a retry with a new id
    assert.equal((await webhook(ev)).result, 'already_paid') // and without one
    const ks = await kids(c.giftOrderId)
    assert.equal(ks.length, 3)
    for (const k of ks) {
      assert.equal(k.status, 'CONFIRMED')
      assert.equal(k.payment_status, 'SUCCEEDED')
      assert.equal(k.payment_amount, k.total)
      const ev2 = await query(`SELECT COUNT(*)::int AS n FROM order_events WHERE order_id = $1 AND status = 'CONFIRMED' AND from_status = 'PAYMENT_PENDING'`, [k.id])
      assert.equal(ev2.rows[0].n, 1)
    }
    const g = (await query('SELECT * FROM gift_orders WHERE id = $1', [c.giftOrderId])).rows[0]
    assert.equal(g.status, 'PAID')
    assert.equal(g.payment_id, 'pay_gift1')
    assert.equal(g.payment_amount, c.total)
    assert.equal((await query(`SELECT COUNT(*)::int AS n FROM order_stock WHERE order_id = ANY($1) AND state = 'committed'`, [ks.map((k) => k.id)])).rows[0].n > 0, true)
    // A second, different payment for the paid order is recorded to be refunded, not applied.
    assert.equal((await webhook(captured(c, 'pay_gift_second'), 'evt_gift_3')).result, 'duplicate_payment')
    assert.equal((await query(`SELECT order_id FROM duplicate_payments WHERE payment_id = 'pay_gift_second'`)).rows[0].order_id, ks[0].id)
    assert.equal((await kids(c.giftOrderId)).length, 3)
  })

  test('a payment for less than the whole order confirms nothing', async () => {
    await stock()
    const { c } = await placed(2)
    const r = await webhook({ ...captured(c), payload: { payment: { entity: { id: 'pay_short', order_id: c.razorpayOrderId, amount: c.total - 100, currency: 'INR' } } } }, 'evt_short')
    assert.equal(r.result, 'rejected')
    for (const k of await kids(c.giftOrderId)) assert.equal(k.status, 'PAYMENT_PENDING')
  })

  test('each recipient gets the gift message when their delivery goes out', async () => {
    await stock()
    const { c } = await paid(2)
    const manager = await adminToken(api)
    const [k1] = await kids(c.giftOrderId)
    for (const step of ['PROCESSING', 'ALLOCATE', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY']) {
      const r = step === 'ALLOCATE'
        ? await api.post(`/admin/v1/orders/${k1.id}/allocate`, {}, { token: manager })
        : await api.patch(`/admin/v1/orders/${k1.id}/status`, { status: step }, { token: manager })
      assert.equal(r.status, 204, `${step}: ${JSON.stringify(r.body)}`)
    }
    const { rows } = await query(`SELECT kind, phone FROM notifications WHERE order_id = $1 AND kind = 'GIFT_OUT_FOR_DELIVERY'`, [k1.id])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].phone, '+919000000001')
    // The other recipient has had none yet: each message goes with its own delivery.
    const other = (await kids(c.giftOrderId))[1]
    assert.equal((await query(`SELECT 1 FROM notifications WHERE order_id = $1 AND kind = 'GIFT_OUT_FOR_DELIVERY'`, [other.id])).rowCount, 0)
  })

  test('one bill for the whole order, with the business name and GSTIN, and none per delivery', async () => {
    await stock()
    const { c, cust } = await paid(3, { confirmExtra: { business: { name: 'Tata Gifts Pvt Ltd', gstin: BUYER_GSTIN } } })
    const bills = (await query('SELECT * FROM bills')).rows
    assert.equal(bills.length, 1)
    assert.equal(bills[0].gift_order_id, c.giftOrderId)
    assert.equal(bills[0].total, c.total)
    assert.equal(bills[0].snapshot.buyer.gstin, BUYER_GSTIN)
    assert.equal(bills[0].snapshot.lines.length, 1)
    assert.equal(bills[0].snapshot.lines[0].qty, 3)
    const res = await fetch(`${srv.base}/v1/gifts/${c.giftOrderId}/bill`, { headers: { Authorization: `Bearer ${cust.accessToken}` } })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'application/pdf')
    const text = execFileSync('pdftotext', ['-layout', '-', '-'], { input: Buffer.from(await res.arrayBuffer()) }).toString('utf8')
    assert.match(text, /Tata Gifts Pvt Ltd/)
    assert.match(text, new RegExp(BUYER_GSTIN))
    const view = await api.get(`/v1/gifts/${c.giftOrderId}`, { token: cust.accessToken })
    assert.equal(view.body.bill.number, bills[0].number)
    // Cancelling one recipient keeps the bill; it is cancelled only when every delivery is.
    const [k1] = await kids(c.giftOrderId)
    assert.equal((await api.post(`/v1/gifts/${c.giftOrderId}/recipients/${k1.id}/cancel`, {}, { token: cust.accessToken })).status, 204)
    assert.equal((await query('SELECT cancelled_at FROM bills')).rows[0].cancelled_at, null)
    assert.equal((await api.post(`/v1/gifts/${c.giftOrderId}/cancel`, {}, { token: cust.accessToken })).status, 204)
    assert.notEqual((await query('SELECT cancelled_at FROM bills')).rows[0].cancelled_at, null)
  })
})

describe('cancelling', () => {
  test('before paying, the whole order is cancelled and every hold released; one recipient alone cannot be', async () => {
    await stock()
    const { c, cust } = await placed(3)
    const ks = await kids(c.giftOrderId)
    const one = await api.post(`/v1/gifts/${c.giftOrderId}/recipients/${ks[0].id}/cancel`, {}, { token: cust.accessToken })
    assert.equal(one.status, 409)
    assert.equal(one.body.error.code, 'GIFT_NOT_PAID')
    // Nor through the order's own cancel.
    assert.equal((await api.post(`/v1/orders/${ks[0].id}/cancel`, {}, { token: cust.accessToken })).body.error.code, 'GIFT_NOT_PAID')
    assert.equal((await api.post(`/v1/gifts/${c.giftOrderId}/cancel`, {}, { token: cust.accessToken })).status, 204)
    for (const k of await kids(c.giftOrderId)) assert.equal(k.status, 'CANCELLED')
    assert.equal(await held(ks.map((k) => k.id)), 0)
    const g = (await api.get(`/v1/gifts/${c.giftOrderId}`, { token: cust.accessToken })).body
    assert.equal(g.status, 'CANCELLED')
    assert.equal(g.paymentStatus, 'CANCELLED')
    // A payment that still lands is refunded delivery by delivery, never kept.
    assert.equal((await webhook(captured(c), 'evt_late')).result, 'refund_due')
    for (const k of await kids(c.giftOrderId)) assert.notEqual(k.refund_requested_at, null)
  })

  test("one recipient's cancel refunds only that recipient's amount, before packing only", async () => {
    await stock()
    const manager = await adminToken(api)
    await api.post('/admin/v1/promos', { code: 'TEAM5', kind: 'PERCENT', value: 5, perCustomer: 1 }, { token: manager })
    const { c, cust } = await placed(3, { over: { qty: 1 }, extra: { promoCode: 'TEAM5' } })
    // Razorpay with keys, so the refund amounts are what was really sent.
    const realFetch = globalThis.fetch
    const posted = []
    const made = []
    env.RAZORPAY_KEY_ID = 'rzp_test_x'
    env.RAZORPAY_KEY_SECRET = 'key_secret_test'
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url)
      if (!u.startsWith('https://api.razorpay.com/v1')) return realFetch(url, init)
      const path = u.slice('https://api.razorpay.com/v1'.length)
      const body = init.body ? JSON.parse(init.body) : null
      let json = { items: [] }
      if (init.method === 'POST' && path.endsWith('/refund')) {
        posted.push(body)
        const r = { id: `rfnd_${made.length + 1}`, status: 'pending', amount: body.amount, notes: body.notes }
        made.push(r)
        json = r
      } else if (path.endsWith('/refunds')) json = { items: made }
      return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    try {
      assert.equal((await webhook(captured(c, 'pay_team'), 'evt_team')).result, 'confirmed')
      const ks = await kids(c.giftOrderId)
      // Recipient 2 cancels: only their share comes back.
      assert.equal((await api.post(`/v1/gifts/${c.giftOrderId}/recipients/${ks[1].id}/cancel`, {}, { token: cust.accessToken })).status, 204)
      assert.equal(posted.length, 1)
      assert.equal(posted[0].amount, ks[1].total)
      assert.equal(posted[0].notes.orderId, ks[1].id)
      // Recipient 3 too: a second part refund of the same payment, not mistaken for the first.
      assert.equal((await api.post(`/v1/gifts/${c.giftOrderId}/recipients/${ks[2].id}/cancel`, {}, { token: cust.accessToken })).status, 204)
      assert.equal(posted.length, 2)
      assert.equal(posted[1].amount, ks[2].total)
      const after = await kids(c.giftOrderId)
      assert.equal(after[0].status, 'CONFIRMED')
      assert.equal(after[0].refund_requested_at, null)
      assert.equal(after[1].payment_status, 'REFUNDED')
      assert.equal(after[2].payment_status, 'REFUNDED')
      assert.ok(posted.reduce((s, p) => s + p.amount, 0) < c.total)
      // Recipient 1 is packed: nothing is refunded any more, for them or for the whole order.
      for (const step of ['PROCESSING', 'ALLOCATE', 'PACKED']) {
        const r = step === 'ALLOCATE'
          ? await api.post(`/admin/v1/orders/${ks[0].id}/allocate`, {}, { token: manager })
          : await api.patch(`/admin/v1/orders/${ks[0].id}/status`, { status: step }, { token: manager })
        assert.equal(r.status, 204, `${step}: ${JSON.stringify(r.body)}`)
      }
      const late = await api.post(`/v1/gifts/${c.giftOrderId}/recipients/${ks[0].id}/cancel`, {}, { token: cust.accessToken })
      assert.equal(late.status, 409)
      assert.equal(late.body.error.code, 'NOT_CANCELLABLE')
      const whole = await api.post(`/v1/gifts/${c.giftOrderId}/cancel`, {}, { token: cust.accessToken })
      assert.equal(whole.status, 409)
      assert.equal(whole.body.error.code, 'NOT_CANCELLABLE')
      assert.equal(posted.length, 2)
      assert.equal((await kids(c.giftOrderId))[0].status, 'PACKED')
    } finally {
      globalThis.fetch = realFetch
      env.RAZORPAY_KEY_ID = ''
      env.RAZORPAY_KEY_SECRET = ''
    }
  })
})

describe('access', () => {
  test("no customer can see, pay, cancel or download another customer's gift order", async () => {
    await stock()
    const { c } = await paid(2)
    const other = await customerToken(api)
    const t = { token: other.accessToken }
    const [k1] = await kids(c.giftOrderId)
    assert.equal((await api.get(`/v1/gifts/${c.giftOrderId}`, t)).status, 404)
    assert.equal((await api.post(`/v1/gifts/${c.giftOrderId}/cancel`, {}, t)).status, 404)
    assert.equal((await api.post(`/v1/gifts/${c.giftOrderId}/recipients/${k1.id}/cancel`, {}, t)).status, 404)
    assert.equal((await api.get(`/v1/gifts/${c.giftOrderId}/bill`, t)).status, 404)
    assert.equal((await api.post(`/v1/gifts/${c.giftOrderId}/verify-payment`, { razorpay_payment_id: 'pay_x', razorpay_order_id: c.razorpayOrderId, razorpay_signature: 'a'.repeat(64) }, t)).status, 404)
    assert.equal((await api.get(`/v1/orders/${k1.id}`, t)).status, 404)
    assert.deepEqual((await api.get('/v1/gifts', t)).body, [])
    assert.equal((await kids(c.giftOrderId))[0].status, 'CONFIRMED')
    // A recipient of someone else's order can't be cancelled through one's own gift order either.
    const mine = await placed(1, { cust: other })
    const cross = await api.post(`/v1/gifts/${mine.c.giftOrderId}/recipients/${k1.id}/cancel`, {}, t)
    assert.equal(cross.status, 404)
  })

  test('staff see the parent with its deliveries: managers and operators, not packers', async () => {
    await stock()
    const { c } = await paid(2)
    const manager = await adminToken(api)
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    const packer = await adminToken(api, 'packer@mandimangoes.test', 'packer123')
    const list = await api.get('/admin/v1/gift-orders', { token: ops })
    assert.equal(list.status, 200)
    assert.equal(list.body.items.length, 1)
    assert.equal(list.body.items[0].number, c.number)
    assert.equal(list.body.items[0].children.length, 2)
    assert.equal(list.body.items[0].children[1].recipientName, 'Recipient 2')
    const one = await api.get(`/admin/v1/gift-orders/${c.giftOrderId}`, { token: manager })
    assert.equal(one.status, 200)
    assert.equal(one.body.payment.amount, c.total)
    assert.equal(one.body.billOrderId, one.body.children[0].id)
    assert.equal((await api.get('/admin/v1/gift-orders', { token: packer })).status, 403)
    const child = await api.get(`/admin/v1/orders/${one.body.children[0].id}`, { token: ops })
    assert.equal(child.body.giftOrder.number, c.number)
    assert.equal((await api.get(`/admin/v1/gift-orders?q=${encodeURIComponent('Recipient 2')}`, { token: ops })).body.items.length, 1)
    assert.equal((await api.get('/admin/v1/gift-orders?q=nobody', { token: ops })).body.items.length, 0)
  })
})

describe('the CSV template', () => {
  test('downloads as CSV with the columns the shop reads', async () => {
    const cust = await customerToken(api)
    const res = await fetch(`${srv.base}/v1/gifts/template.csv`, { headers: { Authorization: `Bearer ${cust.accessToken}` } })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /^text\/csv/)
    const [head, row] = (await res.text()).trim().split('\r\n')
    assert.equal(head, '"name","phone","address","pincode","box","ripeness","boxes","note"')
    assert.match(row, /^"Asha Rao","9876543210",/)
  })

  test('no cell can run as a formula in a spreadsheet', () => {
    const csv = recipientsTemplate([{ sku: '=HYPERLINK("http://evil","x")' }])
    assert.match(csv, /"'=HYPERLINK\(""http:\/\/evil"",""x""\)"/)
    for (const start of ['+', '-', '@', '\t']) assert.match(recipientsTemplate([{ sku: `${start}cmd` }]), new RegExp(`"'\\${start === '\t' ? 't' : start}cmd"`))
    for (const line of csv.trim().split('\r\n')) for (const cell of line.match(/"(?:[^"]|"")*"/g)) assert.doesNotMatch(cell, /^"[=+\-@\t]/)
  })
})
