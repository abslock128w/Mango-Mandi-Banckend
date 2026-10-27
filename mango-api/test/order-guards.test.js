// Migration 045, part 1: the database refuses an order status change that
// ORDER_TRANSITIONS does not allow, and its table of moves stays equal to the map.
import { checkout, client, closeAll, customerToken, forceOrderState, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, beforeEach, describe, test } from 'node:test'
import { query, tx } from '../src/db.js'
import { newId } from '../src/ids.js'
import { ORDER_TRANSITIONS } from '../src/orders.js'
import { DOC, orderStatesBlock, withBlock } from '../scripts/order-states.mjs'

let srv
let api

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
})

async function pendingOrder() {
  await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 5 } })
  const cust = await customerToken(api)
  const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
  assert.equal(c.status, 201, JSON.stringify(c.body))
  return c.body.orderId
}

const statusOf = async (id) => (await query('SELECT status FROM orders WHERE id = $1', [id])).rows[0].status

describe('order status guard in the database (migration 045)', () => {
  test('order_status_transitions holds exactly the moves in ORDER_TRANSITIONS', async () => {
    const fromMap = Object.entries(ORDER_TRANSITIONS).flatMap(([from, tos]) => tos.map((to) => `${from} -> ${to}`)).sort()
    const { rows } = await query('SELECT from_status, to_status FROM order_status_transitions')
    const fromDb = rows.map((r) => `${r.from_status} -> ${r.to_status}`).sort()
    assert.deepEqual(fromDb, fromMap, 'change ORDER_TRANSITIONS and order_status_transitions together (a new migration)')
    // Every status the orders table allows has an entry in the map.
    const check = (await query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'orders'::regclass AND conname = 'orders_status_check'`)).rows[0].def
    for (const s of check.match(/'([A-Z_]+)'/g).map((x) => x.slice(1, -1))) assert.ok(s in ORDER_TRANSITIONS, s)
  })

  test('docs/order-states.md shows exactly ORDER_TRANSITIONS (run node scripts/order-states.mjs after a change)', async () => {
    const doc = await readFile(DOC, 'utf8')
    assert.equal(withBlock(doc, orderStatesBlock(ORDER_TRANSITIONS)), doc)
    assert.throws(() => orderStatesBlock({ ...ORDER_TRANSITIONS, RTO: ['CANCELLED', 'DELIVERED'] }), /No description for RTO -> DELIVERED/)
  })

  test('an UPDATE that skips a step raises check_violation; allowed moves and same-status writes pass', async () => {
    const id = await pendingOrder()
    await assert.rejects(query(`UPDATE orders SET status = 'DELIVERED' WHERE id = $1`, [id]), (err) => {
      assert.equal(err.code, '23514')
      assert.equal(err.constraint, 'orders_status_transition')
      assert.match(err.message, /cannot go from PAYMENT_PENDING to DELIVERED/)
      return true
    })
    assert.equal(await statusOf(id), 'PAYMENT_PENDING')
    await query(`UPDATE orders SET status = 'PAYMENT_PENDING', at_risk = FALSE WHERE id = $1`, [id])
    await query(`UPDATE orders SET status = 'CANCELLED' WHERE id = $1`, [id])
    await assert.rejects(query(`UPDATE orders SET status = 'SHIPPED' WHERE id = $1`, [id]), { code: '23514' })
    // A late payment confirms a cancelled order: allowed.
    await query(`UPDATE orders SET status = 'CONFIRMED' WHERE id = $1`, [id])
    assert.equal(await statusOf(id), 'CONFIRMED')
    // Other columns are not guarded.
    await query(`UPDATE orders SET at_risk = TRUE WHERE id = $1`, [id])
  })

  test('a new order must start as PAYMENT_PENDING or CONFIRMED', async () => {
    const insert = (c, status) =>
      c.query(`INSERT INTO orders (id, number, status, delivery_date, placed_at, subtotal, total) VALUES ($1, $2, $3, '2026-10-16', now(), 0, 0)`, [
        newId('ord'), `ORD-G${status}`, status,
      ])
    await assert.rejects(insert({ query }, 'DELIVERED'), { code: '23514', constraint: 'orders_status_transition' })
    await insert({ query }, 'CONFIRMED')
    await insert({ query }, 'PAYMENT_PENDING')
  })

  test('the override lifts the guard for its own transaction only', async () => {
    const id = await pendingOrder()
    await forceOrderState(`UPDATE orders SET status = 'DELIVERED' WHERE id = $1`, [id])
    assert.equal(await statusOf(id), 'DELIVERED')
    await assert.rejects(query(`UPDATE orders SET status = 'PAYMENT_PENDING' WHERE id = $1`, [id]), { code: '23514' })
    // SET LOCAL ends with its transaction: the next one on the same connection is guarded again.
    await tx(async (c) => {
      await c.query(`SET LOCAL mango.order_status_override = 'on'`)
      await c.query(`UPDATE orders SET status = 'CONFIRMED' WHERE id = $1`, [id])
    })
    await assert.rejects(query(`UPDATE orders SET status = 'DELIVERED' WHERE id = $1`, [id]), { code: '23514' })
  })
})
