// The contract walk, part 4: figures worked out by hand, not by the code under test.
// Three orders: their bills (prices are paise, GST is 0 on fresh fruit, delivery is free),
// the stock each takes and gives back, and the ripeness each box is sold at and its dates.
// Then the clock at IST midnight and at a month's end, and two checkouts racing for the
// last box.
//
// Today is T0: 2026-10-15, 10:00 IST (before the 18:00 cutoff), so the first delivery day
// is 2026-10-16. Ripeness by age on the delivery day (DEFAULT_RULES): raw at 1-3, semi-ripe
// at 4-7, unsellable past 7, never sold ripe. Ready to eat: raw +5 days, semi-ripe +2; eat by
// three days after ready.
import '../setup-env.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { setNow } from '../../src/clock.js'
import { query } from '../../src/db.js'
import { adminToken, checkout, client, closeAll, customerToken, makeBatch, resetDb, startServer } from '../helpers.js'

let srv
let api
let manager
let cust

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
  cust = await customerToken(api)
})

const PAISE = { 'ALP-3': 189_900, 'ALP-5': 299_900, 'BAD-3': 129_900, 'BAD-5': 199_900 }

/** Boxes on sale for a delivery day, by "SKU|STAGE". */
async function onSale(date) {
  const r = await api.get(`/v1/catalogue?pincode=560034&deliveryDate=${date}`)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.deliveryDate, date)
  return Object.fromEntries(r.body.items.map((i) => [`${i.sku}|${i.stage}`, { qty: i.qty, eatBy: i.eatBy }]))
}

const promo = (body) => api.post('/admin/v1/promos', { ...body, confirmCode: 'manager123' }, { token: manager })

describe('three orders worked by hand', () => {
  test('order 1: two semi-ripe Alphonso 3 kg, no promo', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } }) // age 6 on 10-16: semi-ripe
    const before = await onSale('2026-10-16')
    // Ready 2 days after delivery (10-18), eat by 3 days after that (10-21).
    assert.deepEqual(before['ALP-3|SEMI_RIPE'], { qty: 10, eatBy: '2026-10-21' })
    assert.equal(before['ALP-3|RAW'].qty, 0)
    assert.equal(before['ALP-3|RIPE'], undefined, 'nothing is offered ripe')

    const o = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2 }], { deliveryDate: '2026-10-16' })
    assert.equal(o.status, 201, JSON.stringify(o.body))
    // 2 x 1,899.00 = 3,798.00; nothing off; free delivery.
    assert.equal((await onSale('2026-10-16'))['ALP-3|SEMI_RIPE'].qty, 8, 'two boxes held while the customer pays')
    await api.post('/v1/dev/pay', { orderId: o.body.orderId, outcome: 'captured' })
    const mine = (await api.get(`/v1/orders/${o.body.orderId}`, { token: cust.accessToken })).body
    assert.deepEqual([mine.subtotal, mine.discount, mine.total], [379_800, 0, 379_800])
    assert.deepEqual(mine.items.map((i) => [i.sku, i.stage, i.quantity, i.unitPrice, i.linePrice, i.readyOn, i.eatBy]), [['ALP-3', 'SEMI_RIPE', 2, 189_900, 379_800, '2026-10-18', '2026-10-21']])
    assert.equal((await onSale('2026-10-16'))['ALP-3|SEMI_RIPE'].qty, 8)

    // A cancel before packing gives both boxes back.
    assert.ok((await api.post(`/v1/orders/${o.body.orderId}/cancel`, {}, { token: cust.accessToken })).status < 300)
    assert.equal((await onSale('2026-10-16'))['ALP-3|SEMI_RIPE'].qty, 10)
  })

  test('order 2: three semi-ripe Badami 5 kg with 15% off, capped at 500 rupees', async () => {
    await makeBatch({ age: 3, rating: 'RAW', lines: { 'BAD-5': 6 } }) // age 4 on 10-16: semi-ripe
    assert.equal((await promo({ code: 'QAFIFTEEN', kind: 'PERCENT', value: 15, maxDiscount: 50_000 })).status, 201)
    for (const it of [{ sku: 'BAD-5', stage: 'SEMI_RIPE', qty: 3 }]) assert.equal((await api.post('/v1/cart/items', it, { token: cust.accessToken })).status, 204)
    const q = await api.post('/v1/checkout/quote', { pincode: '560034', deliveryDate: '2026-10-16', promoCode: 'qafifteen' }, { token: cust.accessToken })
    assert.equal(q.status, 200, JSON.stringify(q.body))
    // 3 x 1,999.00 = 5,997.00. 15% is 899.55, capped at 500.00. To pay: 5,497.00.
    assert.deepEqual([q.body.subtotal, q.body.discount, q.body.total], [599_700, 50_000, 549_700])
    // Ready 2 days after delivery (10-18), eat by 3 days after that (10-21).
    assert.deepEqual(q.body.lines.map((l) => [l.sku, l.stage, l.unitPrice, l.linePrice, l.eatBy]), [['BAD-5', 'SEMI_RIPE', 199_900, 599_700, '2026-10-21']])
    assert.equal(PAISE['BAD-5'] * 3, 599_700)
  })

  test('order 3: two days out, a fresh batch and an old one, with 250 rupees off', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-5': 4 } }) // age 8 on 10-18: past the limit
    await makeBatch({ age: 1, rating: 'RAW', lines: { 'ALP-5': 4 } }) // age 4 on 10-18: semi-ripe
    await makeBatch({ age: 3, rating: 'RAW', lines: { 'BAD-3': 5 } }) // age 6 on 10-18: semi-ripe
    assert.equal((await promo({ code: 'QAFLAT250', kind: 'FLAT', value: 25_000 })).status, 201)
    const day = await onSale('2026-10-18')
    assert.deepEqual(day['ALP-5|SEMI_RIPE'], { qty: 4, eatBy: '2026-10-23' })
    assert.equal(day['ALP-5|RAW'].qty, 0, 'the old batch is past the limit on 10-18')
    assert.deepEqual(day['BAD-3|SEMI_RIPE'], { qty: 5, eatBy: '2026-10-23' })
    // For 10-16 the old batch sells semi-ripe (age 6) and the fresh one raw (age 2).
    const first = await onSale('2026-10-16')
    assert.deepEqual([first['ALP-5|SEMI_RIPE'].qty, first['ALP-5|RAW'].qty], [4, 4])

    for (const it of [{ sku: 'ALP-5', stage: 'SEMI_RIPE', qty: 1 }, { sku: 'BAD-3', stage: 'SEMI_RIPE', qty: 2 }]) {
      assert.equal((await api.post('/v1/cart/items', it, { token: cust.accessToken })).status, 204)
    }
    const q = await api.post('/v1/checkout/quote', { pincode: '560034', deliveryDate: '2026-10-18', promoCode: 'QAFLAT250' }, { token: cust.accessToken })
    assert.equal(q.status, 200, JSON.stringify(q.body))
    // 2,999.00 + 2 x 1,299.00 = 5,597.00, less 250.00 = 5,347.00.
    assert.deepEqual([q.body.subtotal, q.body.discount, q.body.total], [559_700, 25_000, 534_700])
    const c = await api.post('/v1/checkout/confirm', { quoteId: q.body.quoteId, address: '12, 4th Cross, Koramangala, Bengaluru' }, { token: cust.accessToken, headers: { 'Idempotency-Key': 'qa-figures-order-3' } })
    assert.equal(c.status, 201, JSON.stringify(c.body))
    const after = await onSale('2026-10-18')
    assert.deepEqual([after['ALP-5|SEMI_RIPE'].qty, after['BAD-3|SEMI_RIPE'].qty], [3, 3])
    // The held box came from the fresh batch, never the one past its limit.
    const held = (await query(
      `SELECT b.plucked_on::text AS plucked, sum(s.quantity)::int AS n FROM order_stock s JOIN batch_lines l ON l.id = s.line_id JOIN batches b ON b.id = l.batch_id
        WHERE s.order_id = $1 AND s.sku = 'ALP-5' GROUP BY b.plucked_on`, [c.body.orderId])).rows
    assert.deepEqual(held, [{ plucked: '2026-10-14', n: 1 }])
  })
})

describe('the clock', () => {
  test('at 23:59 IST the next day is the first delivery day; at 00:00 IST it moves on a day', async () => {
    await makeBatch({ age: 4, rating: 'SEMI_RIPE', lines: { 'ALP-3': 5 } })
    // 2026-10-15 23:59 IST is 18:29 UTC: past the 18:00 cutoff, so the 16th is closed.
    setNow('2026-10-15T18:29:00Z')
    let r = await api.get('/v1/catalogue?pincode=560034')
    assert.equal(r.body.deliveryDate, '2026-10-17')
    // 2026-10-16 00:00 IST: a new day, still past nothing; the 17th is first.
    setNow('2026-10-15T18:30:00Z')
    r = await api.get('/v1/catalogue?pincode=560034')
    assert.equal(r.body.deliveryDate, '2026-10-17')
    // 2026-10-16 17:59 IST: before the cutoff, the 17th stays first; 18:00 IST moves it to the 18th.
    setNow('2026-10-16T12:29:00Z')
    assert.equal((await api.get('/v1/catalogue?pincode=560034')).body.deliveryDate, '2026-10-17')
    setNow('2026-10-16T12:30:00Z')
    assert.equal((await api.get('/v1/catalogue?pincode=560034')).body.deliveryDate, '2026-10-18')
  })

  test('across a month end, delivery days and eat-by dates roll into the next month', async () => {
    setNow('2026-10-30T04:30:00Z') // 10:00 IST on the 30th
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 5 } })
    const r = await api.get('/v1/catalogue?pincode=560034')
    assert.equal(r.body.deliveryDate, '2026-10-31')
    assert.deepEqual(r.body.deliveryDates, ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'])
    // Age 6 on the 31st: semi-ripe, ready 11-02, eat by 11-05.
    const semi = r.body.items.find((i) => i.sku === 'ALP-3' && i.stage === 'SEMI_RIPE')
    assert.deepEqual([semi.qty, semi.eatBy], [5, '2026-11-05'])
    const o = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }], { deliveryDate: '2026-10-31' })
    assert.equal(o.status, 201, JSON.stringify(o.body))
    assert.equal(o.body.deliveryDate, '2026-10-31')
  })
})

test('two customers checking out the last box at the same moment: one order, no oversell', async () => {
  await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 1 } })
  const other = await customerToken(api)
  const [a, b] = await Promise.all([
    checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }]),
    checkout(api, other.accessToken, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }]),
  ])
  const won = [a, b].filter((r) => r.status === 201)
  const lost = [a, b].filter((r) => r.status !== 201)
  assert.equal(won.length, 1, `${a.status} ${JSON.stringify(a.body)} / ${b.status} ${JSON.stringify(b.body)}`)
  assert.equal(lost[0].status, 409)
  assert.ok(['STOCK_INSUFFICIENT', 'OUT_OF_STOCK', 'STOCK_CHANGED'].includes(lost[0].body.error.code), lost[0].body.error.code)
  assert.equal((await query("SELECT coalesce(sum(quantity), 0)::int AS n FROM order_stock WHERE sku = 'ALP-3'")).rows[0].n, 1)
  assert.equal((await onSale('2026-10-16'))['ALP-3|SEMI_RIPE'].qty, 0)
})
