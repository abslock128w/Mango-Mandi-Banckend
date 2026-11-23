// Bulk orders paid at once (mango-api/README.md, Bulk orders; src/bulk-orders.js, src/bulk-price.js): bulk prices
// (the shop price less 25% by default, a manager's own price per box, whole rupees, the 10 kg box twice the 5 kg),
// the server working out the total whatever the shop sends, the payment by link (webhook, dev route, reconcile),
// replays and second payments, the unpaid order closed after its time and paid again, the customer's cancel within
// 4 hours of paying (refunded in full) and not after, the staff steps, the manager's cancel and refund, roles.
import { adminToken, client, closeAll, customerToken, resetDb, signWebhook, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { drainBackground } from '../src/background.js'
import { expireBulkOrders, reconcileBulkPayments } from '../src/bulk-orders.js'
import { boxPrices, discounted } from '../src/bulk-price.js'
import { now, setNow } from '../src/clock.js'
import { query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'
import { paramsFor } from '../src/notify.js'
import { formatOrderNumber } from '../src/order-number.js'
import { devGateway, processDueRefunds, refundDuplicatePayments } from '../src/payments.js'
import { loadProducts } from '../src/products.js'

let srv
let api
let manager
let seq = 0

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
  devGateway.clear()
  manager = await adminToken(api)
  Object.assign(env, { BULK_ENQUIRIES: true, WHATSAPP_BULK_UPDATES: true, BULK_ENQUIRY_DAILY_LIMIT: 5 })
})
afterEach(() => Object.assign(env, saved))

const MIN = 60_000
const HOUR = 3_600_000
const later = (ms) => setNow(new Date(now().getTime() + ms).toISOString())
const row = async (id) => (await query('SELECT * FROM bulk_enquiries WHERE id = $1', [id])).rows[0]
const FORM = { name: 'Asha Rao', business: 'Rao Caterers', phone: '98765 43210', city: 'Bengaluru', address: '12, 4th Cross, Koramangala', pincode: '560034' }
/** `n` 5 kg Alphonso boxes (and `ten` 10 kg bulk boxes of the same fruit). */
const lines = (n, ten = 0) => [{ sku: 'ALP-5', stage: 'SEMI_RIPE', boxes: n }, ...(ten ? [{ sku: 'ALP-5', stage: 'RAW', boxes: ten, packKg: 10 }] : [])]
const place = (token, body, key = newId('idem')) => api.post('/v1/me/bulk-orders', body, { token, headers: { 'Idempotency-Key': key } })
const hook = (event) => {
  const { raw, signature } = signWebhook(event)
  return api.raw('POST', '/webhooks/razorpay', {
    raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature, 'X-Razorpay-Event-Id': `evt_bulk_${++seq}` },
  })
}
const linkPaid = (linkId, paymentId, amount) => hook({
  event: 'payment_link.paid',
  payload: { payment_link: { entity: { id: linkId, status: 'paid' } }, payment: { entity: { id: paymentId, amount, currency: 'INR', status: 'captured', method: 'upi' } } },
})
const devPay = (id, outcome = 'captured') => api.post('/v1/dev/pay-bulk', { bulkOrderId: id, outcome })
/** A placed and paid order for a new customer: { cust, order }. */
async function paidOrder(n = 20) {
  const cust = await customerToken(api)
  const o = (await place(cust.accessToken, { ...FORM, lines: lines(n) })).body
  assert.equal((await devPay(o.id)).body.result, 'paid')
  return { cust, order: o }
}

describe('bulk prices', () => {
  test('the shop price less 25% in whole rupees by default; the 10 kg box is twice the 5 kg; GET /v1/bulk/prices says so', async () => {
    assert.equal(discounted(299_900, 25), 224_900) // ₹2,999 → ₹2,249.25 → ₹2,249
    assert.equal(discounted(10_000, 25), 7_500) // the owner's example: ₹100 → ₹75
    assert.equal(discounted(10_200, 25), 7_700) // ₹76.50 rounds up to ₹77
    assert.deepEqual(boxPrices('ALP-5'), { price: 299_900, bulkPrice: 224_900, custom: false, savingPct: 25 })
    assert.deepEqual(boxPrices('ALP-5', 10), { price: 599_800, bulkPrice: 449_800, custom: false, savingPct: 25 })
    const r = await api.get('/v1/bulk/prices')
    assert.equal(r.status, 200)
    assert.equal(r.body.discountPct, 25)
    const alp = r.body.items.find((x) => x.sku === 'ALP-5')
    assert.deepEqual(alp.packs, [{ packKg: 5, price: 299_900, bulkPrice: 224_900, savingPct: 25 }, { packKg: 10, price: 599_800, bulkPrice: 449_800, savingPct: 25 }])
    // 3 kg boxes are not bulk boxes.
    assert.equal(r.body.items.some((x) => x.sku === 'ALP-3'), false)
  })

  test('a manager sets a box\'s own bulk price and the default discount (step-up); operators read only', async () => {
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    const list = await api.get('/admin/v1/bulk-prices', { token: ops })
    assert.equal(list.status, 200)
    const alp = list.body.varieties.find((v) => v.variety === 'Alphonso')
    assert.deepEqual([alp.box.sku, alp.box.bulkPrice, alp.box.fiveKg.bulkPrice, alp.box.tenKg.bulkPrice], ['ALP-5', null, 224_900, 449_800])
    assert.ok(alp.other.some((x) => x.sku === 'ALP-3'))
    const body = { discountPct: 20, prices: [{ sku: 'ALP-5', bulkPrice: 200_000 }] }
    assert.equal((await api.put('/admin/v1/bulk-prices', body, { token: ops })).status, 403)
    const noCode = await api.put('/admin/v1/bulk-prices', body, { token: manager })
    assert.equal(noCode.status, 403, JSON.stringify(noCode.body))
    assert.equal(noCode.body.error.code, 'REAUTH_REQUIRED')
    // Never above the shop price; whole rupees; 5 kg boxes only.
    assert.equal((await api.put('/admin/v1/bulk-prices', { discountPct: 25, prices: [{ sku: 'ALP-5', bulkPrice: 400_000 }], confirmCode: 'manager123' }, { token: manager })).body.error.code, 'BULK_ABOVE_SHOP')
    assert.equal((await api.put('/admin/v1/bulk-prices', { discountPct: 25, prices: [{ sku: 'ALP-5', bulkPrice: 200_050 }], confirmCode: 'manager123' }, { token: manager })).status, 400)
    assert.equal((await api.put('/admin/v1/bulk-prices', { discountPct: 25, prices: [{ sku: 'ALP-3', bulkPrice: 100_000 }], confirmCode: 'manager123' }, { token: manager })).body.error.code, 'BULK_BOX_SIZE')
    const ok = await api.put('/admin/v1/bulk-prices', { ...body, confirmCode: 'manager123' }, { token: manager })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(ok.body.discountPct, 20)
    const own = ok.body.varieties.find((v) => v.variety === 'Alphonso').box
    assert.deepEqual([own.bulkPrice, own.fiveKg.bulkPrice, own.tenKg.bulkPrice, own.fiveKg.custom], [200_000, 200_000, 400_000, true])
    // Another variety follows the new default: its shop price less 20%.
    const other = ok.body.varieties.find((v) => v.box && v.box.sku !== 'ALP-5')
    if (other) assert.equal(other.box.fiveKg.bulkPrice, discounted(other.box.price, 20))
    assert.equal((await query(`SELECT count(*)::int AS n FROM staff_audit WHERE action = 'SET bulk prices'`)).rows[0].n, 1)
    // Back to the default discount for that box.
    const back = await api.put('/admin/v1/bulk-prices', { discountPct: 20, prices: [{ sku: 'ALP-5', bulkPrice: null }], confirmCode: 'manager123' }, { token: manager })
    assert.equal(back.body.varieties.find((v) => v.variety === 'Alphonso').box.fiveKg.bulkPrice, 239_900)
    assert.equal((await api.put('/admin/v1/bulk-prices', { discountPct: 20, prices: [], confirmCode: 'manager123' }, { token: manager })).body.error.code, 'NOTHING_CHANGED')
  })
})

describe('placing a bulk order', () => {
  test('signed in, 100 kg or more: the server works out the total at bulk prices, whatever the shop sends', async () => {
    const cust = await customerToken(api, '9876543210')
    assert.equal((await api.post('/v1/me/bulk-orders', { ...FORM, lines: lines(20) })).status, 401)
    assert.equal((await api.post('/v1/me/bulk-orders', { ...FORM, lines: lines(20) }, { token: cust.accessToken })).body.error.code, 'IDEMPOTENCY_KEY_INVALID')
    assert.equal((await place(cust.accessToken, { ...FORM, lines: lines(19) })).body.error.code, 'BULK_TOO_SMALL')
    assert.equal((await place(cust.accessToken, { ...FORM, lines: [{ sku: 'ALP-3', stage: 'SEMI_RIPE', boxes: 40 }] })).body.error.code, 'BULK_BOX_SIZE')
    assert.equal((await place(cust.accessToken, { ...FORM, pincode: '12', lines: lines(20) })).status, 400)
    // A total or prices from the shop are not part of the order: a total is refused, line prices are ignored.
    assert.equal((await place(cust.accessToken, { ...FORM, total: 100, lines: lines(20) })).status, 400)
    const r = await place(cust.accessToken, { ...FORM, lines: lines(10, 5).map((l) => ({ ...l, unitPrice: 100, price: 1 })) })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.deepEqual([r.body.kind, r.body.status, r.body.quantityKg, r.body.boxes], ['ORDER', 'PAYMENT_PENDING', 100, 15])
    const o = r.body.order
    // 10 × ₹2,249 + 5 × ₹4,498 = ₹44,980; delivery 10% = ₹4,498; total ₹49,478. At shop prices: ₹59,980.
    assert.deepEqual([o.mangoesPaise, o.deliveryPaise, o.amountPaise, o.shopValuePaise, o.savingPaise], [4_498_000, 449_800, 4_947_800, 5_998_000, 1_500_000])
    assert.match(o.paymentUrl, /plink_dev_/)
    assert.equal(new Date(o.payBy).getTime() - now().getTime() > 29 * MIN, true)
    assert.deepEqual(r.body.lines.map((l) => [l.unitPaise, l.shopUnitPaise, l.linePaise]), [[224_900, 299_900, 2_249_000], [449_800, 599_800, 2_249_000]])
    const db = await row(r.body.id)
    assert.deepEqual([db.total, db.payment_status, db.customer_id, db.delivery_address, db.pincode], [4_947_800, 'INITIATED', cust.customer.id, FORM.address, '560034'])
    // Nothing is said on WhatsApp until it is paid.
    assert.equal((await query('SELECT count(*)::int AS n FROM notifications WHERE bulk_enquiry_id = $1', [r.body.id])).rows[0].n, 0)
  })

  test('the same Idempotency-Key is one order; with another body it is refused', async () => {
    const cust = await customerToken(api)
    const key = newId('idem')
    const a = await place(cust.accessToken, { ...FORM, lines: lines(20) }, key)
    const b = await place(cust.accessToken, { ...FORM, lines: lines(20) }, key)
    assert.deepEqual([a.status, b.status, b.body.id], [201, 200, a.body.id])
    assert.equal((await place(cust.accessToken, { ...FORM, lines: lines(30) }, key)).status, 422)
    assert.equal((await query(`SELECT count(*)::int AS n FROM bulk_enquiries WHERE kind = 'ORDER'`)).rows[0].n, 1)
  })
})

describe('paying', () => {
  test('the link\'s webhook pays it once: PAID, "received and paid" queued; a replay changes nothing; a second payment is refunded', async () => {
    const cust = await customerToken(api, '9876543210')
    const o = (await place(cust.accessToken, { ...FORM, lines: lines(20) })).body
    const link = (await row(o.id)).payment_link_id
    // The wrong amount pays nothing (and is refunded as a payment that bought nothing).
    assert.equal((await linkPaid(link, 'pay_bulk_short', 100)).status, 200)
    assert.equal((await row(o.id)).status, 'PAYMENT_PENDING')
    assert.equal((await linkPaid(link, 'pay_bulk_1', 4_498_000 + 449_800)).status, 200)
    const paid = await row(o.id)
    assert.deepEqual([paid.status, paid.payment_status, paid.payment_id, paid.paid_amount, paid.hold_expires_at], ['PAID', 'SUCCEEDED', 'pay_bulk_1', 4_947_800, null])
    const n = (await query('SELECT * FROM notifications WHERE bulk_enquiry_id = $1', [o.id])).rows
    assert.deepEqual(n.map((x) => x.kind), ['BULK_ORDER_PAID'])
    assert.deepEqual(paramsFor(n[0]), ['Asha Rao', formatOrderNumber(o.number), 'Rs 49,478', '100 kg (20 boxes)', `${env.CUSTOMER_ORIGIN.split(',')[0].replace(/\/$/, '')}/bulk/orders/${o.id}`])
    // The same payment again (Razorpay's retry): nothing changes, nothing more is queued.
    await linkPaid(link, 'pay_bulk_1', 4_947_800)
    assert.equal((await query('SELECT count(*)::int AS n FROM notifications WHERE bulk_enquiry_id = $1', [o.id])).rows[0].n, 1)
    // A second payment on the paid order: kept as a duplicate and refunded.
    await linkPaid(link, 'pay_bulk_2', 4_947_800)
    await drainBackground()
    const dups = (await query('SELECT * FROM duplicate_payments ORDER BY found_at')).rows
    assert.deepEqual(dups.map((d) => [d.payment_id, d.bulk_enquiry_id]), [['pay_bulk_short', o.id], ['pay_bulk_2', o.id]])
    await refundDuplicatePayments()
    assert.ok((await query('SELECT refund_id FROM duplicate_payments WHERE payment_id = $1', ['pay_bulk_2'])).rows[0].refund_id)
    const mine = (await api.get(`/v1/me/bulk-enquiries/${o.id}`, { token: cust.accessToken })).body
    assert.deepEqual([mine.status, mine.order.paymentStatus, mine.order.canCancel, mine.order.receipt.paymentId, mine.order.paymentUrl], ['PAID', 'SUCCEEDED', true, 'pay_bulk_1', null])
    // The panel lists paid orders first.
    const enquiry = await api.post('/v1/bulk-enquiries', { name: 'Ravi', phone: '9822222222', city: 'Mysuru', lines: lines(50) }, { headers: { 'Idempotency-Key': newId('idem') } })
    assert.equal(enquiry.status, 201)
    const items = (await api.get('/admin/v1/bulk-enquiries', { token: manager })).body.items
    assert.deepEqual([items[0].id, items[0].paid, items[0].paidAmount], [o.id, true, 4_947_800])
  })

  test('a failed attempt changes nothing; the reconcile loop finds a payment whose webhook was lost', async () => {
    const cust = await customerToken(api)
    const o = (await place(cust.accessToken, { ...FORM, lines: lines(20) })).body
    assert.equal((await devPay(o.id, 'failed')).body.result, 'ignored')
    assert.equal((await row(o.id)).status, 'PAYMENT_PENDING')
    const link = (await row(o.id)).payment_link_id
    devGateway.set(link, { id: 'pay_bulk_lost', status: 'captured', amount: 4_947_800, method: 'upi' })
    later(20 * MIN)
    assert.equal(await reconcileBulkPayments(), 1)
    assert.deepEqual([(await row(o.id)).status, (await row(o.id)).payment_id], ['PAID', 'pay_bulk_lost'])
  })

  test('unpaid after 30 minutes it closes; "Pay again" opens it at today\'s price with a new link; a payment on the old link still finds it', async () => {
    const cust = await customerToken(api)
    const o = (await place(cust.accessToken, { ...FORM, lines: lines(20) })).body
    const first = (await row(o.id)).payment_link_id
    later(29 * MIN)
    assert.equal(await tx((c) => expireBulkOrders(c)), 0)
    later(4 * MIN) // past the hold and its 2-minute grace
    assert.equal(await tx((c) => expireBulkOrders(c)), 1)
    const closed = await row(o.id)
    assert.deepEqual([closed.status, closed.payment_status, closed.cancel_reason], ['CANCELLED', 'CANCELLED', 'Not paid in time'])
    const view = (await api.get(`/v1/me/bulk-enquiries/${o.id}`, { token: cust.accessToken })).body
    assert.deepEqual([view.order.payAgain, view.order.canCancel, view.order.cancelledBy], [true, false, 'expired'])
    // The bulk price went down meanwhile: paying again is at today's price.
    await query(`UPDATE products SET bulk_price = 200_000 WHERE sku = 'ALP-5'`.replace('200_000', '200000'))
    await loadProducts()
    const again = await api.post(`/v1/me/bulk-orders/${o.id}/pay`, {}, { token: cust.accessToken })
    assert.equal(again.status, 200, JSON.stringify(again.body))
    assert.deepEqual([again.body.status, again.body.order.amountPaise], ['PAYMENT_PENDING', 20 * 200_000 + 400_000])
    const second = (await row(o.id)).payment_link_id
    assert.notEqual(second, first)
    // Paying again twice keeps the same link.
    assert.equal((await api.post(`/v1/me/bulk-orders/${o.id}/pay`, {}, { token: cust.accessToken })).body.order.paymentUrl, again.body.order.paymentUrl)
    // A payment made on the first link at its old amount is checked against today's total: refused and refunded.
    await linkPaid(first, 'pay_old_link', 4_947_800)
    assert.equal((await row(o.id)).status, 'PAYMENT_PENDING')
    assert.equal((await query('SELECT bulk_enquiry_id FROM duplicate_payments WHERE payment_id = $1', ['pay_old_link'])).rows[0].bulk_enquiry_id, o.id)
    await linkPaid(second, 'pay_new_link', 4_400_000)
    assert.equal((await row(o.id)).status, 'PAID')
  })

  test('a payment after the time ran out (nobody cancelled) is honoured', async () => {
    const cust = await customerToken(api)
    const o = (await place(cust.accessToken, { ...FORM, lines: lines(20) })).body
    later(40 * MIN)
    await tx((c) => expireBulkOrders(c))
    assert.equal((await devPay(o.id)).body.result, 'paid')
    assert.equal((await row(o.id)).status, 'PAID')
  })
})

describe('cancelling', () => {
  test('unpaid: cancelled; a payment that lands after is refunded in full', async () => {
    const cust = await customerToken(api)
    const o = (await place(cust.accessToken, { ...FORM, lines: lines(20) })).body
    const r = await api.post(`/v1/me/bulk-orders/${o.id}/cancel`, {}, { token: cust.accessToken })
    assert.deepEqual([r.status, r.body.status, r.body.order.refund], [200, 'CANCELLED', null])
    assert.equal((await devPay(o.id)).body.result, 'refund_due')
    await drainBackground()
    const after = await row(o.id)
    assert.deepEqual([after.status, after.payment_status, Boolean(after.refund_id)], ['CANCELLED', 'REFUNDED', true])
    // No "pay again" for an order the customer cancelled.
    assert.equal((await api.post(`/v1/me/bulk-orders/${o.id}/pay`, {}, { token: cust.accessToken })).status, 409)
  })

  test('paid: the customer cancels within 4 hours of paying for a full refund; not after; not once dispatched', async () => {
    const { cust, order } = await paidOrder()
    later(3 * HOUR + 50 * MIN)
    const r = await api.post(`/v1/me/bulk-orders/${order.id}/cancel`, {}, { token: cust.accessToken })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const after = await row(order.id)
    assert.deepEqual([after.status, after.payment_status, after.refund_status, Boolean(after.customer_cancelled_at)], ['CANCELLED', 'REFUNDED', 'pending', true])
    assert.deepEqual((await query('SELECT type FROM bulk_enquiry_events WHERE enquiry_id = $1 ORDER BY created_at, id', [order.id])).rows.map((x) => x.type), ['RECEIVED', 'PAID', 'CANCELLED', 'REFUNDED'])
    assert.equal((await api.get(`/v1/me/bulk-enquiries/${order.id}`, { token: cust.accessToken })).body.order.refund.refundedAt != null, true)

    const late = await paidOrder()
    later(4 * HOUR + MIN)
    const no = await api.post(`/v1/me/bulk-orders/${late.order.id}/cancel`, {}, { token: late.cust.accessToken })
    assert.deepEqual([no.status, no.body.error.code], [409, 'CANCEL_WINDOW_CLOSED'])
    assert.match(no.body.error.message, /within 4 hours of paying/)
    assert.equal((await row(late.order.id)).status, 'PAID')

    const sent = await paidOrder()
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    assert.equal((await api.post(`/admin/v1/bulk-enquiries/${sent.order.id}/status`, { to: 'DISPATCHED' }, { token: ops })).status, 200)
    const gone = await api.post(`/v1/me/bulk-orders/${sent.order.id}/cancel`, {}, { token: sent.cust.accessToken })
    assert.deepEqual([gone.status, gone.body.error.code], [409, 'BULK_DISPATCHED'])
    // Someone else's order: not found.
    assert.equal((await api.post(`/v1/me/bulk-orders/${sent.order.id}/cancel`, {}, { token: cust.accessToken })).status, 404)
  })

  test('a refund that fails at Razorpay is retried by maintenance (the lease and back-off of order refunds)', async () => {
    const { cust, order } = await paidOrder()
    await api.post(`/v1/me/bulk-orders/${order.id}/cancel`, {}, { token: cust.accessToken })
    // As if the refund had not been sent yet.
    await query(`UPDATE bulk_enquiries SET refunded_at = NULL, refund_id = NULL, payment_status = 'SUCCEEDED', refund_attempted_at = NULL, refund_next_attempt_at = NULL WHERE id = $1`, [order.id])
    assert.equal(await processDueRefunds(), 1)
    assert.equal((await row(order.id)).payment_status, 'REFUNDED')
    assert.equal(await processDueRefunds(), 0)
  })
})

describe('staff', () => {
  test('operators move a paid order on ("Called customer", dispatched, delivered); managers cancel it with a full refund after step-up', async () => {
    const { order } = await paidOrder()
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    const step = (to) => api.post(`/admin/v1/bulk-enquiries/${order.id}/status`, { to }, { token: ops })
    assert.equal((await step('DELIVERED')).status, 409)
    const called = await step('CONFIRMED')
    assert.equal(called.status, 200, JSON.stringify(called.body))
    assert.equal(called.body.status, 'CONFIRMED')
    assert.equal(called.body.order.amountPaise, 4_947_800)
    assert.deepEqual(called.body.lines.map((l) => [l.unitPrice, l.bulkPrice]), [[224_900, 224_900]])
    // A paid order has no quote, and is cancelled rather than closed.
    assert.equal((await api.post(`/admin/v1/bulk-enquiries/${order.id}/quote`, { lines: [{ label: 'x', qty: 1, unitPrice: 1 }] }, { token: ops })).body.error.code, 'BULK_ORDER_NO_QUOTE')
    assert.equal((await api.post(`/admin/v1/bulk-enquiries/${order.id}/close`, {}, { token: ops })).body.error.code, 'BULK_ORDER_NOT_CLOSABLE')
    assert.equal((await api.post(`/admin/v1/bulk-enquiries/${order.id}/cancel`, { reason: 'Out of fruit' }, { token: ops })).status, 403)
    const noCode = await api.post(`/admin/v1/bulk-enquiries/${order.id}/cancel`, { reason: 'Out of fruit' }, { token: manager })
    assert.equal(noCode.body.error.code, 'REAUTH_REQUIRED')
    assert.equal((await row(order.id)).status, 'CONFIRMED')
    const r = await api.post(`/admin/v1/bulk-enquiries/${order.id}/cancel`, { reason: 'Out of fruit', confirmCode: 'manager123' }, { token: manager })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const after = await row(order.id)
    assert.deepEqual([after.status, after.payment_status, after.cancel_reason, Boolean(after.staff_cancelled_at)], ['CANCELLED', 'REFUNDED', 'Out of fruit', true])
    assert.equal((await query(`SELECT count(*)::int AS n FROM staff_audit WHERE action = 'CANCEL bulk order'`)).rows[0].n, 1)
  })

  test('an unpaid order is cancelled by a manager without a refund or a step-up; BULK_ENQUIRIES off answers 404', async () => {
    const cust = await customerToken(api)
    const o = (await place(cust.accessToken, { ...FORM, lines: lines(20) })).body
    const r = await api.post(`/admin/v1/bulk-enquiries/${o.id}/cancel`, { reason: 'Test order' }, { token: manager })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal((await row(o.id)).payment_status, 'CANCELLED')
    env.BULK_ENQUIRIES = false
    assert.equal((await place(cust.accessToken, { ...FORM, lines: lines(20) })).status, 404)
    assert.equal((await api.get('/v1/bulk/prices')).status, 404)
    assert.equal((await api.get('/admin/v1/bulk-prices', { token: manager })).status, 404)
  })
})
