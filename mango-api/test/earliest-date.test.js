// The earliest delivery date (earliest.js): when the chosen day has run out, the API names the first day
// the whole bag can come (stock, closed days, daily caps and slots), per line too; the catalogue says it per
// box; backorders only sell what an incoming batch can supply; fruit on the truck is never packed.
// T0 is 10:00 IST on 2026-10-15: the bookable days are 10-16 to 10-20.
import { adminToken, checkout, client, closeAll, customerToken, line, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { availability, auditLedger } from '../src/inventory.js'
import { dayLabel, earliestPlan } from '../src/earliest.js'

const D = (n) => `2026-10-${16 + n}` // D(0) = 10-16 … D(4) = 10-20
const DATES = [0, 1, 2, 3, 4].map(D)
const pools = (byDay) => new Map(DATES.map((d) => [d, new Map(Object.entries(byDay[d] ?? {}))]))

describe('earliestPlan (the rule, no database)', () => {
  test('the first day every line fits; per-line days; what the asked day has', () => {
    const p = earliestPlan({
      dates: DATES,
      pools: pools({ [D(0)]: { 'ALP-3|RAW': 5 }, [D(2)]: { 'ALP-3|RAW': 5, 'KES-3|SEMI_RIPE': 2 } }),
      lines: [{ sku: 'ALP-3', stage: 'RAW', qty: 2 }, { sku: 'KES-3', stage: 'SEMI_RIPE', qty: 2 }],
      requestedDate: D(0),
    })
    assert.equal(p.earliestDate, D(2))
    assert.deepEqual(p.lines.map((l) => [l.sku, l.earliestDate, l.available]), [['ALP-3', D(0), 5], ['KES-3', D(2), 0]])
    assert.deepEqual(p.neverFit, [])
    assert.deepEqual(p.days[0].short, [{ sku: 'KES-3', stage: 'SEMI_RIPE', qty: 2, available: 0 }])
  })

  test('a day without room for the whole bag is skipped (daily cap or slots)', () => {
    const p = earliestPlan({
      dates: DATES, pools: pools(Object.fromEntries(DATES.map((d) => [d, { 'ALP-3|RAW': 9 }]))),
      room: new Map([[D(0), 0], [D(1), 2]]), lines: [{ sku: 'ALP-3', stage: 'RAW', qty: 3 }],
    })
    assert.equal(p.earliestDate, D(2))
    assert.equal(p.days[1].full, true)
  })

  test('two lines of the same box and ripeness share the stock', () => {
    const p = earliestPlan({
      dates: DATES, pools: pools({ [D(0)]: { 'ALP-3|RAW': 3 }, [D(1)]: { 'ALP-3|RAW': 4 } }),
      lines: [{ sku: 'ALP-3', stage: 'RAW', qty: 2 }, { sku: 'ALP-3', stage: 'RAW', qty: 2 }],
    })
    assert.equal(p.earliestDate, D(1))
  })

  test('a line no day can supply is named; the other ripeness is offered, not swapped', () => {
    const p = earliestPlan({
      dates: DATES, pools: pools({ [D(3)]: { 'ALP-3|SEMI_RIPE': 4 } }), lines: [{ sku: 'ALP-3', stage: 'RAW', qty: 2 }],
    })
    assert.equal(p.earliestDate, null)
    assert.deepEqual(p.neverFit, [{ sku: 'ALP-3', stage: 'RAW', qty: 2 }])
    assert.deepEqual(p.lines[0].otherStages, [{ stage: 'SEMI_RIPE', earliestDate: D(3) }])
  })

  test('every line fits some day but no one day takes them all', () => {
    const p = earliestPlan({
      dates: DATES, pools: pools({ [D(0)]: { 'ALP-3|RAW': 1 }, [D(4)]: { 'KES-3|RAW': 1 } }),
      lines: [{ sku: 'ALP-3', stage: 'RAW', qty: 1 }, { sku: 'KES-3', stage: 'RAW', qty: 1 }],
    })
    assert.equal(p.earliestDate, null)
    assert.deepEqual(p.neverFit, [])
    assert.deepEqual(p.lines.map((l) => l.earliestDate), [D(0), D(4)])
  })

  test('day labels read the way the shop writes them', () => {
    assert.equal(dayLabel('2026-11-19'), 'Thu, 19 Nov')
  })
})

let srv
let api
let admin
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
  admin = await adminToken(api)
})
afterEach(() => {
  env.BACKORDERS = false
})

const quote = async (token, items, deliveryDate, extra = {}) => {
  for (const it of items) assert.equal((await api.post('/v1/cart/items', it, { token })).status, 204)
  return api.post('/v1/checkout/quote', { pincode: '560034', deliveryDate, ...extra }, { token })
}
const RAW2 = { sku: 'ALP-3', stage: 'RAW', qty: 2 }
const SEMI2 = { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2 }
/** Plucked today, on the truck, due tomorrow (10-16): sells raw from 10-17, semi-ripe from 10-19. */
const onTheTruck = (qty = 20) => makeBatch({ age: 0, status: 'IN_TRANSIT', rating: null, lines: { 'ALP-3': qty } })

describe('checkout quote: the earliest date instead of a bare STOCK_INSUFFICIENT', () => {
  test('out on the chosen day: 409 with the whole bag’s earliest date and each line’s', async () => {
    await onTheTruck()
    const cust = await customerToken(api)
    const q = await quote(cust.accessToken, [RAW2], D(0))
    assert.equal(q.status, 409)
    assert.equal(q.body.error.code, 'STOCK_INSUFFICIENT')
    assert.equal(q.body.error.sku, 'ALP-3', 'older callers still get the sku')
    assert.equal(q.body.error.requestedDate, D(0))
    assert.equal(q.body.error.earliestDate, D(1))
    assert.deepEqual(q.body.error.lines.map((l) => [l.sku, l.stage, l.qty, l.available, l.earliestDate]), [['ALP-3', 'RAW', 2, 0, D(1)]])
    assert.deepEqual(q.body.error.neverFit, [])
    assert.match(q.body.error.message, /Fri, 16 Oct.*Sat, 17 Oct/)
    // The day it names really works.
    assert.equal((await api.post('/v1/checkout/quote', { pincode: '560034', deliveryDate: D(1) }, { token: cust.accessToken })).status, 200)
  })

  test('the ripeness follows the day: semi-ripe only from 10-19, raw offered from 10-17', async () => {
    await onTheTruck()
    const cust = await customerToken(api)
    const q = await quote(cust.accessToken, [SEMI2], D(1))
    assert.equal(q.status, 409)
    assert.equal(q.body.error.earliestDate, D(3))
    assert.deepEqual(q.body.error.lines[0].otherStages, [{ stage: 'RAW', earliestDate: D(1) }])
  })

  test('a closed day and a full day are skipped', async () => {
    await onTheTruck() // semi-ripe on 10-19 and 10-20
    await query('INSERT INTO delivery_calendar (date, is_open) VALUES ($1, FALSE)', [D(3)])
    const cust = await customerToken(api)
    let q = await quote(cust.accessToken, [SEMI2], D(0))
    assert.equal(q.status, 409)
    assert.equal(q.body.error.earliestDate, D(4), '10-19 is closed')
    // 10-20 can take one more box only: no day works for two.
    await query('INSERT INTO delivery_calendar (date, is_open, max_boxes) VALUES ($1, TRUE, 1)', [D(4)])
    q = await api.post('/v1/checkout/quote', { pincode: '560034', deliveryDate: D(0) }, { token: cust.accessToken })
    assert.equal(q.status, 409)
    assert.equal(q.body.error.earliestDate, null)
    assert.deepEqual(q.body.error.neverFit, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2 }])
  })

  test('slots: a day whose every slot is too small for the bag is skipped', async () => {
    await makeBatch({ age: 1, rating: 'RAW', lines: { 'ALP-3': 10 } }) // raw 10-16 to 10-17
    await query(`INSERT INTO delivery_slots (id, label, starts_at, ends_at, max_boxes, sort) VALUES ('slt_am', 'Morning', '08:00', '12:00', 1, 1)`)
    const cust = await customerToken(api)
    const q = await quote(cust.accessToken, [RAW2], D(0), { slotId: 'slt_am' })
    assert.equal(q.status, 409)
    assert.equal(q.body.error.code, 'SLOT_FULL', 'stock is fine; the slot check is unchanged')
    let cat = await api.get(`/v1/catalogue?pincode=560034&delivery_date=${D(0)}`)
    assert.deepEqual(cat.body.fullDates, [])
    assert.equal(cat.body.items.find((i) => i.sku === 'ALP-3' && i.stage === 'RAW').earliestDate, D(0))
    // Every slot booked out: no day can take a box, so no box has an earliest day.
    await query(`UPDATE delivery_slots SET max_boxes = 0`)
    cat = await api.get(`/v1/catalogue?pincode=560034&delivery_date=${D(0)}`)
    assert.deepEqual(cat.body.fullDates, DATES)
    assert.equal(cat.body.items.find((i) => i.sku === 'ALP-3' && i.stage === 'RAW').earliestDate, null)
  })

  test('nothing on any day: earliestDate null and the line named as never fitting', async () => {
    const cust = await customerToken(api)
    const q = await quote(cust.accessToken, [RAW2], D(0))
    assert.equal(q.status, 409)
    assert.equal(q.body.error.code, 'STOCK_INSUFFICIENT')
    assert.equal(q.body.error.earliestDate, null)
    assert.deepEqual(q.body.error.neverFit, [{ sku: 'ALP-3', stage: 'RAW', qty: 2 }])
  })

  test('confirm after the stock ran out: 409 with the new earliest date, no order placed', async () => {
    const early = await makeBatch({ age: 2, rating: 'RAW', lines: { 'ALP-3': 2 } }) // raw 10-16 only (age 3)
    await onTheTruck()
    const cust = await customerToken(api)
    const q = await quote(cust.accessToken, [RAW2], D(0))
    assert.equal(q.status, 200, JSON.stringify(q.body))
    // Someone else takes the last two boxes for 10-16.
    const other = await customerToken(api, '9876500099')
    assert.equal((await checkout(api, other.accessToken, [RAW2], { deliveryDate: D(0) })).status, 201)
    const c = await api.post('/v1/checkout/confirm', { quoteId: q.body.quoteId, address: '12, 4th Cross, Koramangala, Bengaluru' }, { token: cust.accessToken, headers: { 'Idempotency-Key': 'k-late' } })
    assert.equal(c.status, 409)
    assert.equal(c.body.error.code, 'STOCK_INSUFFICIENT')
    assert.equal(c.body.error.earliestDate, D(1))
    assert.equal(c.body.error.requestedDate, D(0))
    const mine = await query('SELECT count(*)::int AS n FROM orders WHERE customer_id = $1', [cust.customer.id])
    assert.equal(mine.rows[0].n, 0)
    assert.equal((await line(early, 'ALP-3')).held, 2)
  })
})

describe('catalogue: earliestDate per box and ripeness', () => {
  test('the first day each can be delivered, from the whole window', async () => {
    await onTheTruck()
    const r = await api.get(`/v1/catalogue?pincode=560034&delivery_date=${D(0)}`)
    assert.equal(r.status, 200)
    const item = (sku, stage) => r.body.items.find((i) => i.sku === sku && i.stage === stage)
    assert.equal(item('ALP-3', 'RAW').qty, 0)
    assert.equal(item('ALP-3', 'RAW').earliestDate, D(1))
    assert.equal(item('ALP-3', 'SEMI_RIPE').earliestDate, D(3))
    assert.equal(item('ALP-5', 'RAW').earliestDate, null, 'no batch has it: out of stock')
    assert.equal(item('ALP-3', 'RAW').nextAvailableDate, D(1), 'existing fields kept')
    assert.deepEqual(r.body.fullDates, [])
  })

  test('a full day is not anyone’s earliest date, and is listed', async () => {
    await onTheTruck()
    await query('INSERT INTO delivery_calendar (date, is_open, max_boxes) VALUES ($1, TRUE, 0)', [D(1)])
    const r = await api.get(`/v1/catalogue?pincode=560034&delivery_date=${D(0)}`)
    assert.equal(r.body.items.find((i) => i.sku === 'ALP-3' && i.stage === 'RAW').earliestDate, D(2))
    assert.deepEqual(r.body.fullDates, [D(1)])
  })
})

describe('backorders only sell what an incoming batch can supply', () => {
  beforeEach(() => {
    env.BACKORDERS = true
  })

  test('no incoming batch: not a backorder, the earliest-date answer instead', async () => {
    const cust = await customerToken(api)
    const q = await quote(cust.accessToken, [{ ...SEMI2, qty: 20 }], D(2))
    assert.equal(q.status, 409)
    assert.equal(q.body.error.code, 'STOCK_INSUFFICIENT')
    assert.equal(q.body.error.earliestDate, null)
  })

  test('an arriving batch: backordered up to its expected count at the forecast factor', async () => {
    // Plucked 10-14, ARRIVING (not yet dispatched), due 10-15: raw on 10-17 (age 3), semi-ripe from 10-18.
    const b = await makeBatch({ age: 1, status: 'ARRIVING', rating: null, lines: { 'ALP-3': 10 } })
    await query('UPDATE batches SET eta_date = $2 WHERE id = $1', [b, '2026-10-15'])
    const cust = await customerToken(api)
    // forecastConfidence 0.8 → 8 boxes expected.
    const over = await quote(cust.accessToken, [{ ...SEMI2, qty: 9 }], D(3))
    assert.equal(over.status, 409)
    assert.equal(over.body.error.code, 'STOCK_INSUFFICIENT')
    const ok = await quote(cust.accessToken, [{ ...SEMI2, qty: 8 }], D(3))
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(ok.body.lines[0].backorder, true)
    // The ETA promised is never before the chosen day.
    assert.deepEqual(ok.body.backorderEta, { from: D(3), to: D(3) })
    // A placed backorder uses up the expected count.
    const c = await api.post('/v1/checkout/confirm', { quoteId: ok.body.quoteId, address: '12, 4th Cross, Koramangala, Bengaluru' }, { token: cust.accessToken, headers: { 'Idempotency-Key': 'k-bo' } })
    assert.equal(c.status, 201, JSON.stringify(c.body))
    const other = await customerToken(api, '9876500098')
    const again = await quote(other.accessToken, [{ ...SEMI2, qty: 1 }], D(3))
    assert.equal(again.status, 409)
    // The catalogue tells the shop how many can still be sourced.
    const cat = await api.get(`/v1/catalogue?pincode=560034&delivery_date=${D(3)}`)
    assert.equal(cat.body.items.find((i) => i.sku === 'ALP-3' && i.stage === 'SEMI_RIPE').backorder, undefined)
  })

  test('the catalogue offers a backorder only where an incoming batch can supply it', async () => {
    const b = await makeBatch({ age: 1, status: 'ARRIVING', rating: null, lines: { 'ALP-3': 10 } })
    await query('UPDATE batches SET eta_date = $2 WHERE id = $1', [b, '2026-10-15'])
    const r = await api.get(`/v1/catalogue?pincode=560034&delivery_date=${D(0)}`)
    const item = (sku, stage) => r.body.items.find((i) => i.sku === sku && i.stage === stage)
    assert.deepEqual(item('ALP-3', 'SEMI_RIPE').backorder, { from: D(2), qty: 8 })
    assert.equal(item('ALP-5', 'SEMI_RIPE').backorder, undefined)
  })
})

describe('fruit on the truck is never packed or shipped', () => {
  const allocateOrder = (id) => api.post(`/admin/v1/orders/${id}/allocate`, undefined, { token: admin })
  const setStatus = (id, status) => api.patch(`/admin/v1/orders/${id}/status`, { status }, { token: admin })

  async function paidOnTruck() {
    const b = await onTheTruck(20)
    const cust = await customerToken(api)
    const o = await checkout(api, cust.accessToken, [RAW2], { deliveryDate: D(1) })
    assert.equal(o.status, 201, JSON.stringify(o.body))
    assert.equal((await api.post('/v1/dev/pay', { orderId: o.body.orderId, outcome: 'captured' })).status, 200)
    return { b, id: o.body.orderId }
  }

  test('allocate refuses, naming the batch; counts are untouched; it packs once the batch has arrived', async () => {
    const { b, id } = await paidOnTruck()
    const before = await tx((c) => availability(c, D(1)))
    const r = await allocateOrder(id)
    assert.equal(r.status, 409)
    assert.equal(r.body.error.code, 'BATCH_NOT_ARRIVED')
    assert.match(r.body.error.message, new RegExp(b))
    assert.match(r.body.error.message, /in transit/)
    assert.deepEqual(r.body.error.batchIds, [b])
    const l = await line(b, 'ALP-3')
    assert.equal(l.on_hand, 20)
    assert.equal(l.committed, 2)
    assert.deepEqual(await tx((c) => availability(c, D(1))), before, 'sellable counts not inflated')
    assert.deepEqual(await tx((c) => auditLedger(c)), [])

    await query(`UPDATE batches SET status = 'ARRIVED', arrived_at = now() WHERE id = $1`, [b])
    assert.equal((await allocateOrder(id)).status, 204)
    assert.equal((await line(b, 'ALP-3')).on_hand, 18)
  })

  test('PACKED and dispatch refuse boxes already packed from a batch that is not arrived', async () => {
    const { b, id } = await paidOnTruck()
    await query(`UPDATE batches SET status = 'ARRIVED', arrived_at = now() WHERE id = $1`, [b])
    assert.equal((await allocateOrder(id)).status, 204)
    // Data from before this rule: the batch is still recorded as on the truck.
    await query(`UPDATE batches SET status = 'IN_TRANSIT' WHERE id = $1`, [b])
    assert.equal((await setStatus(id, 'PROCESSING')).status, 204)
    const r = await setStatus(id, 'PACKED')
    assert.equal(r.status, 409)
    assert.equal(r.body.error.code, 'BATCH_NOT_ARRIVED')
    await query(`UPDATE batches SET status = 'ARRIVED' WHERE id = $1`, [b])
    assert.equal((await setStatus(id, 'PACKED')).status, 204)
    await query(`UPDATE batches SET status = 'IN_TRANSIT' WHERE id = $1`, [b])
    const s = await setStatus(id, 'SHIPPED')
    assert.equal(s.status, 409)
    assert.equal(s.body.error.code, 'BATCH_NOT_ARRIVED')
  })
})
