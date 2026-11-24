// Fruit held back for pre-orders (src/holdback.js): the paid bookings of a week that has come into reach keep their
// boxes, per box and ripeness, so regular shoppers (catalogue, quote, checkout, chat, staff paths, backorders) only see
// what is left, while the allocator takes the held boxes. T0 is Thu 2026-10-15 10:00 IST: the shopper's days are
// 10-16 to 10-20, the hold cut-off 10-21, so bookings of the weeks of 10-12 and 10-19 are held, 10-26 is not.
import { adminToken, checkout, client, closeAll, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'
import { afterHold, heldForPreorders, holdCutoff, heldSummary } from '../src/holdback.js'
import { auditLedger, availability, availabilityByDate } from '../src/inventory.js'
import { createOrder, rebalanceOrder, SYSTEM } from '../src/orders.js'
import { allocatePreorders, staffCancelPreorder } from '../src/preorders.js'
import { backorderRoom } from '../src/backorders.js'

const DAY = '2026-10-16'
const THIS_WEEK = '2026-10-12'
const NEXT_WEEK = '2026-10-19'
const LATER_WEEK = '2026-10-26'

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

let seq = 0
async function customerId() {
  const phone = `97${String(20_000_000 + ++seq).slice(-8)}`
  await customerToken(api, phone)
  return (await query('SELECT id FROM customers WHERE phone LIKE $1', [`%${phone}`])).rows[0].id
}

/** A paid booking (BOOKED), as the shop leaves it after payment. */
async function booked({ sku = 'ALP-3', stage = 'SEMI_RIPE', qty, week = THIS_WEEK, bookedAt = new Date('2026-09-01T00:00:00Z') }) {
  const id = newId('pre')
  const cust = await customerId()
  await query(
    `INSERT INTO preorders (id, number, customer_id, customer_name, phone, sku, stage, qty, unit_price, total, week_start, pincode, delivery_address,
                            status, payment_status, payment_id, paid_amount, created_at, booked_at, non_refundable, load_kg, variety)
     VALUES ($1, $2, $3, 'Asha', '+919800000000', $4, $5, $6, 100, $7, $8, '560034', '12, 4th Cross, Koramangala, Bengaluru',
             'BOOKED', 'SUCCEEDED', $9, $7, $10, $10, true, $11, 'Alphonso')`,
    [id, `P${700000000 + ++seq}`, cust, sku, stage, qty, 100 * qty, week, `pay_${id}`, bookedAt, qty * 3],
  )
  return id
}

/** Semi-ripe from 10-16 to 10-18 (age 4 today, QC'd semi-ripe). */
const semi = (n, sku = 'ALP-3') => makeBatch({ age: 4, rating: 'SEMI_RIPE', lines: { [sku]: n } })
/** Raw from 10-16 to 10-18 (plucked today, QC'd raw). */
const raw = (n, sku = 'ALP-3') => makeBatch({ age: 0, rating: 'RAW', lines: { [sku]: n } })

const shown = async (stage = 'SEMI_RIPE', sku = 'ALP-3', date = DAY) => {
  const r = await api.get(`/v1/catalogue?pincode=560034&delivery_date=${date}`)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body.items.find((i) => i.sku === sku && i.stage === stage).qty
}
const buy = async (qty, stage = 'SEMI_RIPE') => {
  const cust = await customerToken(api)
  return checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage, qty }], { deliveryDate: DAY })
}
const noDrift = async () => assert.deepEqual(await auditLedger({ query }), [])

describe('the rule (pure)', () => {
  test('same ripeness first, then every ripeness of the box together; other boxes untouched', () => {
    const pool = new Map([['ALP-3|RAW', 10], ['ALP-3|SEMI_RIPE', 10], ['BAD-3|SEMI_RIPE', 5]])
    const out = afterHold(pool, new Map([['ALP-3|RAW', 6]]))
    assert.equal(out.get('ALP-3|RAW'), 4)
    assert.equal(out.get('ALP-3|SEMI_RIPE'), 10) // 20 boxes, 6 held: the 10 semi-ripe can all go
    assert.equal(out.get('BAD-3|SEMI_RIPE'), 5)
    // The day's boxes are all semi-ripe, but a raw booking is still owed: a box raw earlier in its week is the same box.
    const ripe = afterHold(new Map([['ALP-3|SEMI_RIPE', 10]]), new Map([['ALP-3|RAW', 6]]))
    assert.equal(ripe.get('ALP-3|SEMI_RIPE'), 4)
    // More held than there is: nothing for regular shoppers, never below zero.
    assert.equal(afterHold(new Map([['ALP-3|SEMI_RIPE', 3]]), new Map([['ALP-3|SEMI_RIPE', 6]])).get('ALP-3|SEMI_RIPE'), 0)
  })

  test('the cut-off is the booking horizon plus one day', () => {
    assert.equal(holdCutoff(), '2026-10-21')
  })
})

describe('held for pre-orders', () => {
  test('10 boxes arrive, 6 owed to this week\'s pre-orders: regular shoppers see and can buy 4; the allocator takes the 6', async () => {
    await semi(10)
    const pre = await booked({ qty: 6 })
    assert.equal(await shown(), 4)
    const raw10 = await tx((c) => availability(c, DAY, { raw: true }))
    assert.equal(raw10.get('ALP-3|SEMI_RIPE'), 10)
    // The quote and checkout refuse 5 ...
    const five = await buy(5)
    assert.equal(five.status, 409, JSON.stringify(five.body))
    // ... and sell 4.
    const four = await buy(4)
    assert.equal(four.status, 201, JSON.stringify(four.body))
    assert.equal(await shown(), 0)
    assert.equal((await buy(1)).status, 409)
    // The allocator turns the booking into its delivery order from the held boxes.
    const r = await allocatePreorders()
    assert.equal(r.converted, 1)
    const p = (await query('SELECT status, order_id FROM preorders WHERE id = $1', [pre])).rows[0]
    assert.equal(p.status, 'CONVERTED')
    const boxes = (await query(`SELECT SUM(quantity)::int AS n FROM order_stock WHERE order_id = $1 AND state = 'committed'`, [p.order_id])).rows[0].n
    assert.equal(boxes, 6)
    assert.equal(await shown(), 0)
    await noDrift()
  })

  test('per ripeness: raw bookings keep raw boxes, semi-ripe stays on sale', async () => {
    await raw(10)
    await semi(10)
    await booked({ stage: 'RAW', qty: 6 })
    assert.equal(await shown('RAW'), 4)
    assert.equal(await shown('SEMI_RIPE'), 10)
    assert.equal((await buy(5, 'RAW')).status, 409)
    assert.equal((await buy(4, 'RAW')).status, 201)
    assert.equal((await buy(10, 'SEMI_RIPE')).status, 201)
    assert.equal((await allocatePreorders()).converted, 1)
    await noDrift()
  })

  test('the hold follows a booking: cancelled, moved past the cut-off, and a later week never held; next week is held', async () => {
    await semi(10)
    const a = await booked({ qty: 6 })
    await booked({ qty: 3, week: LATER_WEEK })
    assert.equal(await shown(), 4)
    await tx((c) => staffCancelPreorder(c, a, SYSTEM, 'crop failed'))
    assert.equal(await shown(), 10)
    const b = await booked({ qty: 5, week: NEXT_WEEK })
    assert.equal(await shown(), 5)
    // Moved (delayed) to a week past the cut-off: no longer held now.
    await query('UPDATE preorders SET week_start = $2 WHERE id = $1', [b, LATER_WEEK])
    assert.equal(await shown(), 10)
    const held = await tx((c) => heldForPreorders(c))
    assert.equal(held.size, 0)
  })

  test('stock adjusted, QC-rejected or retired: what regular shoppers see follows; a count raised runs the allocator at once', async () => {
    const batch = await semi(10)
    const pre = await booked({ qty: 6 })
    const lineId = (await query('SELECT id FROM batch_lines WHERE batch_id = $1', [batch])).rows[0].id
    const adjust = (onHand) => api.patch(`/admin/v1/batches/${batch}/lines/${lineId}`, { onHand, reason: 'recount', reasonCode: 'COUNT' }, { token: manager })
    // A hold on the allocator while we look (another run is busy): nothing converts yet.
    let r = await tx(async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('mango:allocate-preorders'))`)
      return adjust(7)
    })
    assert.equal(r.status, 204, JSON.stringify(r.body))
    assert.equal(await shown(), 1)
    r = await adjust(5)
    assert.equal(r.status, 204)
    assert.equal(await shown(), 0)
    // Raised to 12: the allocator runs at once and the booking takes its 6.
    r = await adjust(12)
    assert.equal(r.status, 204)
    assert.equal((await query('SELECT status FROM preorders WHERE id = $1', [pre])).rows[0].status, 'CONVERTED')
    assert.equal(await shown(), 6)
    // A second booking and a QC reject: nothing left to sell.
    await booked({ qty: 2 })
    assert.equal(await shown(), 4)
    const qc = await api.post(`/admin/v1/batches/${batch}/qc`, { ripenessRating: 'SEMI_RIPE', condition: 'REJECT' }, { token: manager })
    assert.equal(qc.status, 201, JSON.stringify(qc.body))
    assert.equal(await shown(), 0)
    await noDrift()
  })

  test('parallel regular checkouts and the allocator never take held boxes nor oversell', async () => {
    for (let round = 0; round < 3; round++) {
      await resetDb()
      manager = await adminToken(api)
      await semi(6)
      await semi(4)
      const pre = await booked({ qty: 6 })
      const buyers = []
      for (let i = 0; i < 8; i++) buyers.push(await customerToken(api))
      // Every buyer has a quote first (the catalogue said 4), then all confirm at once with the allocator.
      const quotes = []
      for (const b of buyers) {
        await api.post('/v1/cart/items', { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }, { token: b.accessToken })
        const q = await api.post('/v1/checkout/quote', { pincode: '560034', deliveryDate: DAY }, { token: b.accessToken })
        quotes.push(q.body.quoteId)
      }
      const results = await Promise.all([
        ...buyers.slice(0, 4).map((b, i) => api.post('/v1/checkout/confirm', { quoteId: quotes[i], address: '12, 4th Cross, Koramangala, Bengaluru' }, { token: b.accessToken, headers: { 'Idempotency-Key': newId('idem') } })),
        allocatePreorders(),
        ...buyers.slice(4).map((b, i) => api.post('/v1/checkout/confirm', { quoteId: quotes[i + 4], address: '12, 4th Cross, Koramangala, Bengaluru' }, { token: b.accessToken, headers: { 'Idempotency-Key': newId('idem') } })),
      ])
      const sold = results.filter((x) => x?.status === 201).length
      assert.equal(sold, 4, `round ${round}: ${results.map((x) => x?.status ?? JSON.stringify(x)).join(',')}`)
      assert.equal((await query('SELECT status FROM preorders WHERE id = $1', [pre])).rows[0].status, 'CONVERTED')
      const neg = await query('SELECT id FROM batch_lines WHERE on_hand - held - committed < 0')
      assert.equal(neg.rowCount, 0)
      await noDrift()
    }
  })

  test('staff and system paths: a rebalance fills only what is not held; a staff-made order is held back too', async () => {
    await semi(8)
    // An order placed before the booking, short of 5 boxes (at risk).
    const cust = await customerId()
    const o = await tx((c) =>
      createOrder(c, {
        customerId: cust, customerName: 'Ravi', phone: '+919811111111', pincode: '560034', address: 'x', deliveryDate: DAY, status: 'CONFIRMED',
        paymentStatus: 'SUCCEEDED', lines: [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 13, unitPrice: 100 }],
      }, SYSTEM),
    )
    assert.equal((await query(`SELECT SUM(quantity)::int AS n FROM order_stock WHERE order_id = $1 AND state = 'committed'`, [o.id])).rows[0].n, 8)
    await semi(10)
    await booked({ qty: 6 })
    // 10 new boxes, 6 held: the rebalance gives the order 4 of the 5 it is short.
    await tx((c) => rebalanceOrder(c, o.id, SYSTEM))
    assert.equal((await query(`SELECT SUM(quantity)::int AS n FROM order_stock WHERE order_id = $1 AND state = 'committed'`, [o.id])).rows[0].n, 12)
    assert.equal((await query('SELECT at_risk FROM orders WHERE id = $1', [o.id])).rows[0].at_risk, true)
    // A replacement or any order made by staff goes through the same take: nothing is left to take.
    const staff = await tx((c) =>
      createOrder(c, {
        customerId: cust, phone: '+919811111111', pincode: '560034', address: 'x', deliveryDate: DAY, status: 'CONFIRMED',
        paymentMethod: 'REPLACEMENT', lines: [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1, unitPrice: 0 }],
      }, SYSTEM),
    )
    assert.equal((await query(`SELECT COUNT(*)::int AS n FROM order_stock WHERE order_id = $1`, [staff.id])).rows[0].n, 0)
    assert.equal((await allocatePreorders()).converted, 1)
    await noDrift()
  })

  test('availability (chat, subscriptions, gifts, the coverage grid) and availabilityByDate both keep the hold', async () => {
    await semi(10)
    await booked({ qty: 6 })
    const one = await tx((c) => availability(c, DAY))
    const many = await tx((c) => availabilityByDate(c, [DAY, '2026-10-17']))
    assert.equal(one.get('ALP-3|SEMI_RIPE'), 4)
    assert.equal(many.get(DAY).get('ALP-3|SEMI_RIPE'), 4)
    assert.equal(many.get('2026-10-17').get('ALP-3|SEMI_RIPE'), 4)
  })

  test('backorders: what the bookings still wait for comes off the fruit on its way', async () => {
    env.BACKORDERS = true
    try {
      await semi(2)
      const id = await makeBatch({ age: 3, status: 'ARRIVING', rating: null, lines: { 'ALP-3': 10 } })
      await query('UPDATE batches SET eta_date = $2 WHERE id = $1', [id, '2026-10-15'])
      const before = (await tx((c) => backorderRoom(c, ['2026-10-17']))).get('2026-10-17').get('ALP-3|SEMI_RIPE')
      await booked({ qty: 6 })
      const afterRoom = (await tx((c) => backorderRoom(c, ['2026-10-17']))).get('2026-10-17').get('ALP-3|SEMI_RIPE')
      // 6 owed, 2 on the shelf: 4 more come off the incoming batch.
      assert.equal(before - afterRoom, 4)
    } finally {
      env.BACKORDERS = false
    }
  })

  test('the panel line: held per variety and ripeness, in boxes and kg', async () => {
    await booked({ qty: 6 })
    await booked({ stage: 'RAW', qty: 2, week: NEXT_WEEK })
    await booked({ qty: 9, week: LATER_WEEK })
    const s = await tx((c) => heldSummary(c))
    assert.deepEqual(s.rows.map((r) => [r.variety, r.stage, r.boxes, r.kg]), [['Alphonso', 'RAW', 2, 6], ['Alphonso', 'SEMI_RIPE', 6, 18]])
    const w = await api.get('/admin/v1/preorder-weeks', { token: manager })
    assert.equal(w.status, 200)
    assert.deepEqual(w.body.held.rows.map((r) => [r.variety, r.stage, r.boxes, r.kg]), [['Alphonso', 'RAW', 2, 6], ['Alphonso', 'SEMI_RIPE', 6, 18]])
  })
})

test('DB-01: every lock of several batch lines goes in LINE_LOCK_ORDER (the hold-back locks every line of a box)', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const dir = new URL('../src/', import.meta.url)
  const files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.js'))
  const bad = []
  for (const f of files) {
    const text = readFileSync(new URL(String(f), dir), 'utf8')
    // Every SQL string (backticks or quotes) that locks batch_lines rows.
    for (const m of text.matchAll(/`[^`]*`|'[^'\n]*'/g)) {
      const sql = m[0]
      if (!/batch_lines/.test(sql) || !/FOR UPDATE/.test(sql)) continue
      // One row only (a line by its id, or by its batch and SKU): no order to keep.
      const oneRow = /WHERE (l\.)?id = \$1( AND (l\.)?batch_id = \$2)? FOR UPDATE|WHERE (l\.)?id = \$1 AND (l\.)?batch_id = \$2|WHERE batch_id = \$1 AND sku = \$2 FOR UPDATE/.test(sql)
      if (!oneRow && !/\$\{LINE_LOCK_ORDER\}/.test(sql)) bad.push(`${f}: ${sql.slice(0, 90).replace(/\s+/g, ' ')}`)
    }
  }
  assert.deepEqual(bad, [])
})
