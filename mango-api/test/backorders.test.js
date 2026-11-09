// Backorders (README, Checkout → Backorders): a box with no stock on the chosen day can still be ordered
// for a day at least BACKORDER_LEAD_DAYS out; the order is a backorder, at-risk until stock arrives, and
// the hourly rebalance fills it then. With the switch off, a short line is STOCK_INSUFFICIENT as before.
import { adminToken, checkout, client, closeAll, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { rebalanceAllOpen } from '../src/maintenance.js'

// T0 is 10:00 IST on 2026-10-15: the earliest day is 10-16, a backorder's 10-17 (today + 2).
const TOO_SOON = '2026-10-16'
const EARLIEST = '2026-10-17'
const BOX = { sku: 'ALP-3', stage: 'RIPE', qty: 2 }

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
  env.BACKORDERS = true
  admin = await adminToken(api)
})
afterEach(() => {
  env.BACKORDERS = false
})

const pay = (orderId) => api.post('/v1/dev/pay', { orderId, outcome: 'captured' })
const order = async (id) => (await query('SELECT * FROM orders WHERE id = $1', [id])).rows[0]
const items = async (id) => (await query('SELECT * FROM order_items WHERE order_id = $1', [id])).rows

async function quote(token, deliveryDate, box = BOX) {
  assert.equal((await api.post('/v1/cart/items', box, { token })).status, 204)
  return api.post('/v1/checkout/quote', { pincode: '560034', deliveryDate }, { token })
}

describe('backorders', () => {
  test('policy tells the shop the numbers', async () => {
    const r = await api.get('/v1/policy')
    assert.deepEqual(r.body.backorders, { enabled: true, leadDays: 2, windowDays: 3 })
  })

  test('quote with no stock on a day two or more days out: 200, the line and the quote flagged', async () => {
    const cust = await customerToken(api)
    const q = await quote(cust.accessToken, EARLIEST)
    assert.equal(q.status, 200, JSON.stringify(q.body))
    assert.equal(q.body.backorder, true)
    assert.deepEqual(q.body.backorderEta, { from: '2026-10-17', to: '2026-10-18' })
    assert.equal(q.body.lines[0].backorder, true)
  })

  test('a line in stock is not a backorder', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    const cust = await customerToken(api)
    const q = await quote(cust.accessToken, TOO_SOON)
    assert.equal(q.status, 200, JSON.stringify(q.body))
    assert.equal(q.body.backorder, undefined)
    assert.equal(q.body.lines[0].backorder, undefined)
  })

  test('too soon a day: 409 BACKORDER_DATE with the earliest day it can come', async () => {
    const cust = await customerToken(api)
    const q = await quote(cust.accessToken, TOO_SOON)
    assert.equal(q.status, 409)
    assert.equal(q.body.error.code, 'BACKORDER_DATE')
    assert.equal(q.body.error.earliest, EARLIEST)
    assert.equal(q.body.error.sku, 'ALP-3')
  })

  test('confirm places a backorder; payment keeps its day; the rebalance fills it once stock arrives', async () => {
    const cust = await customerToken(api)
    const c = await checkout(api, cust.accessToken, [BOX], { deliveryDate: EARLIEST })
    assert.equal(c.status, 201, JSON.stringify(c.body))
    let o = await order(c.body.orderId)
    assert.equal(o.backorder, true)
    assert.equal(o.at_risk, true)
    assert.equal(o.status, 'PAYMENT_PENDING')
    assert.deepEqual((await items(o.id)).map((i) => i.backordered), [true])

    let view = await api.get(`/v1/orders/${o.id}`, { token: cust.accessToken })
    assert.equal(view.body.backorder, true)
    assert.equal(view.body.findingStock, true)
    assert.deepEqual(view.body.backorderEta, { from: EARLIEST, to: '2026-10-18' })
    assert.equal(view.body.items[0].backordered, true)
    const list = await api.get('/v1/orders', { token: cust.accessToken })
    assert.equal(list.body[0].backorder, true)
    assert.ok(list.body[0].backorderEta)

    assert.equal((await pay(o.id)).status, 200)
    o = await order(o.id)
    assert.equal(o.status, 'CONFIRMED')
    assert.equal(o.delivery_date, EARLIEST)
    assert.equal(o.at_risk, true)
    // Its confirmation is not held back the way a genuine no-stock order's is.
    const held = await query(`SELECT count(*)::int AS n FROM notifications WHERE order_id = $1 AND last_error LIKE 'held:%'`, [o.id])
    assert.equal(held.rows[0].n, 0)

    // Staff see it as a backorder, not an at-risk alarm.
    const summary = await api.get('/admin/v1/summary', { token: admin })
    assert.equal(summary.status, 200)
    assert.equal(summary.body.atRiskOrders.find((r) => r.id === o.id)?.backorder, true)
    const detail = await api.get(`/admin/v1/orders/${o.id}`, { token: admin })
    assert.equal(detail.body.backorder, true)
    assert.equal(detail.body.items[0].backordered, true)

    // Stock arrives: the hourly at-risk pass allocates it.
    await makeBatch({ age: 4, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    await rebalanceAllOpen({ atRiskOnly: true })
    o = await order(o.id)
    assert.equal(o.at_risk, false)
    assert.equal(o.backorder, true)
    const stock = await query(`SELECT COALESCE(SUM(quantity), 0)::int AS n FROM order_stock WHERE order_id = $1 AND state = 'committed'`, [o.id])
    assert.equal(stock.rows[0].n, 2)
    view = await api.get(`/v1/orders/${o.id}`, { token: cust.accessToken })
    assert.equal(view.body.findingStock, false)
    assert.equal(view.body.backorderEta, undefined)
    assert.equal(view.body.backorder, true)
  })

  test('with backorders off, a short line is STOCK_INSUFFICIENT as before', async () => {
    env.BACKORDERS = false
    const cust = await customerToken(api)
    const q = await quote(cust.accessToken, EARLIEST)
    assert.equal(q.status, 409)
    assert.equal(q.body.error.code, 'STOCK_INSUFFICIENT')
    assert.equal((await api.get('/v1/policy')).body.backorders.enabled, false)
  })
})
