// Regular orders booked against the plan (src/plan-orders.js, migration 083). T0 is Thu 2026-10-15 10:00 IST: bookable days
// are 10-16 to 10-20, so the plan's days start on Wed 10-21, in "next week" (Monday 10-19). ALP-3 is 3 kg; BAD-3 is Badami.
import { adminToken, client, closeAll, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { setNow, now } from '../src/clock.js'
import { currentConfig, saveConfig } from '../src/config.js'
import { query, tx } from '../src/db.js'
import { newId } from '../src/ids.js'
import { auditLedger } from '../src/inventory.js'
import { fulfilPlannedOrders } from '../src/plan-orders.js'
import { allocatePreorders, setWeekLimit, weekRoom } from '../src/preorders.js'
import { recalculatePreorders } from '../src/preorder-plan.js'
import { rebalanceOrder, sweepExpiredPlanned, SYSTEM } from '../src/orders.js'
import { plannedKgDrift } from '../src/stock-watch.js'

const W1 = '2026-10-19'
const W2 = '2026-10-26'
const W3 = '2026-11-02'
const ADDRESS = '12, 4th Cross, Koramangala, Bengaluru'
const BOX = { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }

let srv
let api
let manager
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
})

const limit = (week, kg, variety = 'Alphonso') => tx((c) => setWeekLimit(c, week, kg, variety))
const room = async (week, variety = 'Alphonso') => (await tx((c) => weekRoom(c, [week], variety)))[0]
const cart = async (token, items) => { for (const it of items) assert.equal((await api.post('/v1/cart/items', it, { token })).status, 204) }
const quote = (token, deliveryDate) => api.post('/v1/checkout/quote', { pincode: '560034', deliveryDate }, { token })
const confirm = (token, quoteId) => api.post('/v1/checkout/confirm', { quoteId, address: ADDRESS }, { token, headers: { 'Idempotency-Key': newId('idem') } })
const order = async (id) => (await query('SELECT * FROM orders WHERE id = $1', [id])).rows[0]
const boxesOf = async (id) => (await query(`SELECT COALESCE(SUM(quantity), 0)::int AS n FROM order_stock WHERE order_id = $1 AND state IN ('held', 'committed', 'packed')`, [id])).rows[0].n
const noDrift = async () => {
  assert.deepEqual(await auditLedger({ query }), [])
  assert.deepEqual(await plannedKgDrift({ query }), [])
}

/** A customer places (and by default pays for) a planned order. */
async function planned({ items = [BOX], date = '2026-10-21', pay = true } = {}) {
  const who = await customerToken(api)
  await cart(who.accessToken, items)
  const q = await quote(who.accessToken, date)
  assert.equal(q.status, 200, JSON.stringify(q.body))
  const c = await confirm(who.accessToken, q.body.quoteId)
  assert.equal(c.status, 201, JSON.stringify(c.body))
  if (pay) assert.equal((await api.post('/v1/dev/pay', { orderId: c.body.orderId, outcome: 'captured' })).status, 200)
  return { id: c.body.orderId, token: who.accessToken, quote: q.body }
}

let seq = 0
/** A paid booking in `week`, with its kg counted in the week. */
async function booking({ qty, week = W1, sku = 'ALP-3', stage = 'SEMI_RIPE', at = '2026-09-01T00:00:00Z' }) {
  const id = newId('pre')
  await customerToken(api, `97${String(30_000_000 + ++seq).slice(-8)}`)
  const cust = (await query(`SELECT id FROM customers WHERE phone LIKE $1`, [`%${String(30_000_000 + seq).slice(-8)}`])).rows[0].id
  await query(
    `INSERT INTO preorders (id, number, customer_id, customer_name, phone, sku, stage, qty, unit_price, total, week_start, pincode, delivery_address,
                            status, payment_status, payment_id, paid_amount, created_at, booked_at, non_refundable, load_kg, variety)
     VALUES ($1, $2, $3, 'Asha', '+919800000000', $4, $5, $6, 100, $7, $8, '560034', $9, 'BOOKED', 'SUCCEEDED', $10, $7, $11, $11, true, $12, 'Alphonso')`,
    [id, `P${710000000 + seq}`, cust, sku, stage, qty, 100 * qty, week, ADDRESS, `pay_${id}`, new Date(at), qty * 3],
  )
  await query(
    `INSERT INTO preorder_variety_week_kg (week_start, variety, reserved_kg) VALUES ($1, 'Alphonso', $2)
     ON CONFLICT (week_start, variety) DO UPDATE SET reserved_kg = preorder_variety_week_kg.reserved_kg + EXCLUDED.reserved_kg`,
    [week, qty * 3],
  )
  await query('INSERT INTO preorder_week_kg (week_start, reserved_kg) VALUES ($1, $2) ON CONFLICT (week_start) DO UPDATE SET reserved_kg = preorder_week_kg.reserved_kg + EXCLUDED.reserved_kg', [week, qty * 3])
  await query('INSERT INTO preorder_weeks (week_start, reserved) VALUES ($1, 1) ON CONFLICT (week_start) DO UPDATE SET reserved = preorder_weeks.reserved + 1', [week])
  await query(`INSERT INTO preorder_capacity (sku, week_start, capacity, reserved) VALUES ($1, $2, 0, $3) ON CONFLICT (sku, week_start) DO UPDATE SET reserved = preorder_capacity.reserved + $3`, [sku, week, qty])
  return id
}

describe('the offer', () => {
  test('nothing bookable: WEEK_BOOKED with next week\'s days after the horizon, the box that caused it, and the catalogue says so', async () => {
    const { accessToken: t } = await customerToken(api)
    await cart(t, [{ ...BOX, qty: 2 }])
    const q = await quote(t, '2026-10-16')
    assert.equal(q.status, 409)
    const e = q.body.error
    assert.equal(e.code, 'STOCK_INSUFFICIENT')
    assert.equal(e.reason, 'WEEK_BOOKED')
    assert.equal(e.earliestDate, null)
    assert.equal(e.offer.weekStart, W1)
    assert.equal(e.offer.words, 'next week')
    assert.deepEqual(e.offer.dates.map((d) => d.date), ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
    assert.ok(Array.isArray(e.offer.dates[0].slots))
    assert.deepEqual(e.boxes.map((b) => [b.sku, b.stage, b.qty]), [['ALP-3', 'SEMI_RIPE', 2]])
    assert.match(e.message, /fully booked for Alphonso\. It can be delivered next week: choose a day/)
    const cat = await api.get('/v1/catalogue?pincode=560034')
    const item = cat.body.items.find((i) => i.sku === 'ALP-3' && i.stage === 'SEMI_RIPE')
    assert.equal(item.qty, 0)
    assert.equal(item.weekBooked.reason, 'WEEK_BOOKED')
    assert.equal(item.weekBooked.from, '2026-10-21')
  })

  test('room = expected kg - pre-order kg - planned kg; a full week rolls to the next; a mixed bag needs one week for every variety', async () => {
    await limit(W1, 12)
    await booking({ qty: 2 }) // 6 kg
    await planned() // 3 kg
    const r = await room(W1)
    assert.deepEqual([r.limit, r.reserved, r.planned, r.remaining], [12, 6, 3, 3])
    const { accessToken: t } = await customerToken(api)
    await cart(t, [{ ...BOX, qty: 2 }]) // 6 kg: no room in W1
    const q = await quote(t, '2026-10-16')
    assert.equal(q.body.error.offer.weekStart, W2)
    assert.equal(q.body.error.offer.from, W2)
    assert.equal(q.body.error.offer.words, `the week of Mon, 26 Oct`)
    await limit(W2, 3, 'Badami')
    await cart(t, [{ sku: 'BAD-3', stage: 'SEMI_RIPE', qty: 2 }])
    assert.equal((await quote(t, '2026-10-16')).body.error.offer.weekStart, W3) // Badami has no 6 kg in W2
  })

  test('a day past the horizon is refused while a bookable day can take the bag; before the season nothing is offered', async () => {
    await makeBatch({ age: 4, rating: 'SEMI_RIPE', lines: { 'ALP-3': 5 } })
    const { accessToken: t } = await customerToken(api)
    await cart(t, [BOX])
    const q = await quote(t, '2026-10-21')
    assert.equal(q.status, 400)
    assert.equal(q.body.error.code, 'INVALID_DATE')
    await query('DELETE FROM batch_lines')
    await saveConfig({ ...currentConfig().rules, preorderOpensOn: '2026-10-01', seasonStartsOn: '2026-12-01' }, 'test')
    const out = await quote(t, '2026-10-16')
    assert.equal(out.status, 409)
    assert.equal(out.body.error.reason, undefined)
    assert.equal((await api.get('/v1/catalogue?pincode=560034')).body.items[0].weekBooked, undefined)
  })
})

describe('placing it', () => {
  test('flagged planned, no stock taken, its kg in the week; the order page says so; an unpaid cancel gives the kg back', async () => {
    await makeBatch({ age: 0, rating: 'RAW', lines: { 'BAD-3': 5 } })
    const o = await planned({ pay: false })
    assert.equal(o.quote.planned, true)
    assert.equal(o.quote.plannedWeek, W1)
    const row = await order(o.id)
    assert.deepEqual([row.planned, row.plan_week, row.delivery_date, row.at_risk], [true, W1, '2026-10-21', false])
    assert.equal(await boxesOf(o.id), 0)
    assert.equal((await room(W1)).planned, 3)
    const view = await api.get(`/v1/orders/${o.id}`, { token: o.token })
    assert.deepEqual([view.body.planned, view.body.plannedWeek, view.body.waitingForFruit, view.body.delayed], [true, W1, true, undefined])
    assert.equal((await api.post(`/v1/orders/${o.id}/cancel`, {}, { token: o.token })).status, 204)
    assert.equal((await room(W1)).planned, 0)
    await noDrift()
  })

  test('paid: confirmed, not at risk, not packable until its fruit is there; a rebalance does not touch it', async () => {
    const o = await planned()
    const row = await order(o.id)
    assert.deepEqual([row.status, row.at_risk], ['CONFIRMED', false])
    await makeBatch({ age: 4, rating: 'SEMI_RIPE', lines: { 'ALP-3': 5 } })
    const r = await tx((c) => rebalanceOrder(c, o.id, SYSTEM))
    assert.equal(r.atRisk, true)
    assert.equal(await boxesOf(o.id), 0)
    assert.equal((await order(o.id)).at_risk, false)
    const pack = await api.post(`/admin/v1/orders/${o.id}/allocate`, {}, { token: manager })
    assert.equal(pack.status, 409, JSON.stringify(pack.body))
  })

  test('a hold that ran out gives the kg back; a payment landing after it takes them again', async () => {
    const o = await planned({ pay: false })
    await query('UPDATE orders SET hold_expires_at = $2 WHERE id = $1', [o.id, new Date(now().getTime() - 10 * 60_000)])
    assert.equal(await tx((c) => sweepExpiredPlanned(c)), 1)
    assert.deepEqual([(await order(o.id)).status, (await room(W1)).planned], ['CANCELLED', 0])
    assert.equal((await api.post('/v1/dev/pay', { orderId: o.id, outcome: 'captured' })).status, 200)
    const row = await order(o.id)
    assert.deepEqual([row.status, row.plan_week, (await room(W1)).planned], ['CONFIRMED', W1, 3])
    await noDrift()
  })

  test('parallel checkouts never take more of a week than its plan has room for; pre-orders see the planned kg', async () => {
    await limit(W1, 9)
    const buyers = []
    for (let i = 0; i < 5; i++) {
      const b = await customerToken(api)
      await cart(b.accessToken, [BOX])
      buyers.push({ t: b.accessToken, q: (await quote(b.accessToken, '2026-10-21')).body.quoteId })
    }
    const out = await Promise.all(buyers.map((b) => confirm(b.t, b.q)))
    assert.equal(out.filter((r) => r.status === 201).length, 3, out.map((r) => r.status).join())
    const r = await room(W1)
    assert.deepEqual([r.planned, r.remaining], [9, 0])
    const refused = out.find((x) => x.status === 409)
    assert.equal(refused.body.error.reason, 'WEEK_BOOKED')
    assert.equal(refused.body.error.offer.weekStart, W2)
    // The same budget for a new pre-order, in the week it is offered.
    await limit(W2, 6)
    await planned({ date: W2 })
    const weeks = await api.get('/v1/preorders/weeks?sku=ALP-3')
    const w2 = weeks.body.room?.find((w) => w.weekStart === W2) ?? (await room(W2))
    assert.equal(w2.remaining, 3)
    await noDrift()
  })
})

describe('fulfilment', () => {
  /** Two paid planned orders of 2 boxes (older first), a booking of 6 for their week, then the clock moves to 10-20. */
  async function scene() {
    const a = await planned({ items: [{ ...BOX, qty: 2 }] })
    setNow(new Date(now().getTime() + 60_000).toISOString())
    const b = await planned({ items: [{ ...BOX, qty: 2 }] })
    const pre = await booking({ qty: 6 })
    setNow('2026-10-20T04:30:00Z')
    return { a, b, pre }
  }
  const stock = (n) => makeBatch({ age: 5, rating: 'RAW', lines: { 'ALP-3': n } }) // semi-ripe on 10-21

  test('pre-orders first, then the oldest planned order; the fruit short: the other moves on with ORDER_DELAYED and may cancel for a full refund', async () => {
    const { a, b, pre } = await scene()
    await stock(8)
    assert.equal((await allocatePreorders()).converted, 1)
    assert.equal((await query('SELECT status FROM preorders WHERE id = $1', [pre])).rows[0].status, 'CONVERTED')
    const r = await fulfilPlannedOrders()
    assert.deepEqual([r.filled, r.delayed, r.stuck], [1, 1, 0])
    assert.equal(await boxesOf(a.id), 2)
    assert.equal(await boxesOf(b.id), 0)
    const moved = await order(b.id)
    assert.equal(moved.delivery_date, W2) // the next week with room, not the next day
    assert.deepEqual([moved.delayed_from_date, moved.delay_count, moved.plan_week], ['2026-10-21', 1, W2])
    assert.equal((await room(W1)).planned, 6) // the filled order keeps its 6 kg in its week
    assert.equal((await room(W2)).planned, 6)
    const msg = (await query(`SELECT params, status FROM notifications WHERE order_id = $1 AND kind = 'ORDER_DELAYED'`, [b.id])).rows
    assert.equal(msg.length, 1)
    assert.deepEqual(msg[0].params.slice(2, 4), ['Wed, 21 Oct', 'Mon, 26 Oct'])
    const view = (await api.get(`/v1/orders/${b.id}`, { token: b.token })).body
    assert.deepEqual([view.delayed.fromDate, view.delayed.toDate, view.canCancelDelayed, view.cancelUntil, view.canCancel], ['2026-10-21', W2, true, 'PACKED', true])
    const row = (await api.get('/v1/orders', { token: b.token })).body.find((x) => x.id === b.id)
    assert.deepEqual([row.planned, row.delayed.fromDate, row.canCancelDelayed], [true, '2026-10-21', true])
    // A delayed order is never brought forward, even to a day with stock.
    await makeBatch({ age: 4, rating: 'SEMI_RIPE', lines: { 'ALP-3': 5 } })
    const back = await api.post(`/v1/orders/${b.id}/reschedule`, { deliveryDate: '2026-10-22' }, { token: b.token })
    assert.equal(back.status, 409, JSON.stringify(back.body))
    assert.equal(back.body.error.code, 'DELAYED_NOT_EARLIER')
    // Long past the 4 hours, the delayed one can still be cancelled, with its money back; the kg go back.
    assert.equal((await api.post(`/v1/orders/${b.id}/cancel`, {}, { token: b.token })).status, 204)
    const gone = await order(b.id)
    assert.equal(gone.status, 'CANCELLED')
    assert.ok(gone.refund_requested_at && gone.delay_cancelled_at)
    assert.equal((await room(W2)).planned, 0)
    // The one that was not delayed keeps the 4-hour rule.
    const kept = await api.post(`/v1/orders/${a.id}/cancel`, {}, { token: a.token })
    assert.equal(kept.status, 409)
    assert.equal(kept.body.error.code, 'CANCEL_WINDOW_CLOSED')
    await noDrift()
  })

  test('the boxes a paid planned order waits for are out of a regular shopper\'s reach, and a delayed order cannot be cancelled once packed', async () => {
    const { b } = await scene()
    await query(`UPDATE preorders SET status = 'CANCELLED'`)
    await query(`UPDATE preorder_variety_week_kg SET reserved_kg = 0`)
    await query(`UPDATE preorder_week_kg SET reserved_kg = 0`)
    await query(`UPDATE preorder_weeks SET reserved = 0`)
    await query(`UPDATE preorder_capacity SET reserved = 0`)
    await stock(5)
    const shown = (await api.get('/v1/catalogue?pincode=560034&delivery_date=2026-10-21')).body.items.find((i) => i.sku === 'ALP-3' && i.stage === 'SEMI_RIPE')
    assert.equal(shown.qty, 1) // 5 boxes, 4 waited for by the two paid orders
    await fulfilPlannedOrders()
    assert.equal(await boxesOf(b.id), 2)
    await query(`UPDATE orders SET delayed_at = $2, delayed_from_date = '2026-10-20', delay_count = 1 WHERE id = $1`, [b.id, now()])
    await api.patch(`/admin/v1/orders/${b.id}/status`, { status: 'PROCESSING' }, { token: manager })
    assert.equal((await api.post(`/admin/v1/orders/${b.id}/allocate`, {}, { token: manager })).status < 300, true)
    const moved = await api.patch(`/admin/v1/orders/${b.id}/status`, { status: 'PACKED' }, { token: manager })
    assert.ok(moved.status < 300, JSON.stringify(moved.body))
    const no = await api.post(`/v1/orders/${b.id}/cancel`, {}, { token: b.token })
    assert.equal(no.status, 409)
    assert.equal(no.body.error.code, 'NOT_CANCELLABLE')
  })

  test('no later week has room: it keeps its date and is flagged for staff, once', async () => {
    const { b } = await scene()
    for (const w of [W2, W3, '2026-11-09', '2026-11-16']) await limit(w, 0)
    await limit(W1, 100)
    await fulfilPlannedOrders()
    const row = await order(b.id)
    assert.deepEqual([row.delivery_date, row.at_risk, row.delay_count], ['2026-10-21', true, 0])
    assert.match(row.at_risk_reason, /no later day has room/)
  })
})

describe('the plan changes', () => {
  test('a lowered week: planned orders move out first, newest first, with the preview counting them; pre-orders stay', async () => {
    const week = W3
    await limit(W1, 0)
    await limit(W2, 0)
    await limit(week, 18)
    const pre = await booking({ qty: 3, week }) // 9 kg
    const older = await planned({ date: week })
    setNow(new Date(now().getTime() + 60_000).toISOString())
    const newer = await planned({ date: week, items: [{ ...BOX, qty: 2 }] })
    // 9 + 3 + 6 = 18: full. Lowered to 12: only the newest order (6 kg) has to go.
    const overrides = [{ weekStart: week, variety: 'Alphonso', limitKg: 12 }]
    const preview = await recalculatePreorders({ dryRun: true, overrides })
    assert.deepEqual([preview.planned.orders, preview.planned.paid, preview.planned.kg, preview.delayed.bookings], [1, 1, 6, 0])
    assert.equal((await order(newer.id)).delivery_date, week) // a preview moves nothing
    const done = await recalculatePreorders({ overrides, reason: 'the pre-order plan changed' })
    assert.deepEqual([done.planned.orders, done.delayed.bookings], [1, 0])
    assert.equal((await order(older.id)).delivery_date, week)
    const moved = await order(newer.id)
    assert.equal(moved.delivery_date, '2026-11-09')
    assert.equal(moved.delay_count, 1)
    assert.equal((await query(`SELECT 1 FROM notifications WHERE order_id = $1 AND kind = 'ORDER_DELAYED'`, [newer.id])).rowCount, 1)
    assert.equal((await query('SELECT week_start FROM preorders WHERE id = $1', [pre])).rows[0].week_start, week)
    // Applying it again moves nothing and sends nothing.
    assert.equal((await recalculatePreorders({ overrides })).planned.orders, 0)
    await noDrift()
  })

  test('a pre-order that would have to move keeps its week: the planned order goes instead', async () => {
    const week = W3
    await limit(W1, 0)
    await limit(W2, 0)
    await limit(week, 15)
    const pre = await booking({ qty: 3, week }) // 9 kg
    const o = await planned({ date: week, items: [{ ...BOX, qty: 2 }] }) // 6 kg: full
    const done = await recalculatePreorders({ overrides: [{ weekStart: week, variety: 'Alphonso', limitKg: 10 }] })
    assert.deepEqual([done.planned.orders, done.delayed.bookings], [1, 0])
    assert.equal((await query('SELECT week_start FROM preorders WHERE id = $1', [pre])).rows[0].week_start, week)
    assert.notEqual((await order(o.id)).delivery_date, week)
    await noDrift()
  })
})
