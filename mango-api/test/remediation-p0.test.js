// Remediation Stage 1 (P0) regression tests. Each test reproduces an audit
// finding from 2026-10-22 and proves the fix.
import { closeAll, checkout, client, customerToken, line, makeBatch, resetDb, startServer, T0 } from './helpers.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { setNow } from '../src/clock.js'
import { query } from '../src/db.js'
import { auditLedger } from '../src/inventory.js'

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

const at = (minutes) => setNow(new Date(Date.parse(T0) + minutes * 60_000).toISOString())
const status = async (id) => (await query('SELECT status FROM orders WHERE id = $1', [id])).rows[0].status
const catalogueQty = async (sku, stage) =>
  (await api.get('/v1/catalogue?pincode=560034')).body.items.find((i) => i.sku === sku && i.stage === stage).qty

describe('lazy hold expiry (INV-01)', () => {
  test('an expired hold frees its stock with no maintenance run: the next buyer gets it and the stale order is cancelled', async () => {
    const b = await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 2 } })
    const first = await customerToken(api)
    const one = await checkout(api, first.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 2 }])
    assert.equal(one.status, 201, JSON.stringify(one.body))
    assert.equal((await line(b, 'ALP-3')).held, 2)

    // Still inside the hold: sold out for everyone else.
    const early = await customerToken(api)
    assert.equal((await checkout(api, early.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])).status, 409)

    // 11 minutes later the hold has run out. No scheduler, no /internal/maintenance.
    at(11)
    const second = await customerToken(api)
    const two = await checkout(api, second.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 2 }])
    assert.equal(two.status, 201, JSON.stringify(two.body))

    assert.equal(await status(one.body.orderId), 'CANCELLED')
    assert.equal(await status(two.body.orderId), 'PAYMENT_PENDING')
    const l = await line(b, 'ALP-3')
    assert.equal(l.held, 2)
    assert.deepEqual(await auditLedger({ query }), [])
    const ev = (await query(`SELECT actor, reason FROM order_events WHERE order_id = $1 AND status = 'CANCELLED'`, [one.body.orderId])).rows
    assert.equal(ev.length, 1)
    assert.match(ev[0].reason, /hold expired/)
  })

  test('the catalogue counts boxes on an expired hold as available before anything sweeps it', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 3 } })
    const first = await customerToken(api)
    assert.equal((await checkout(api, first.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 3 }])).status, 201)
    assert.equal(await catalogueQty('ALP-3', 'RIPE'), 0)
    at(11)
    assert.equal(await catalogueQty('ALP-3', 'RIPE'), 3)
  })

  test('two buyers racing for stock on an expired hold: exactly one wins, nothing oversold, ledger clean', async () => {
    const b = await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 2 } })
    const first = await customerToken(api)
    const one = await checkout(api, first.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 2 }])
    assert.equal(one.status, 201)
    at(11)
    const [x, y] = await Promise.all([customerToken(api), customerToken(api)])
    const results = await Promise.all([
      checkout(api, x.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 2 }]),
      checkout(api, y.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 2 }]),
    ])
    const codes = results.map((r) => r.status).sort()
    assert.deepEqual(codes, [201, 409], JSON.stringify(results.map((r) => r.body)))
    assert.equal(await status(one.body.orderId), 'CANCELLED')
    const l = await line(b, 'ALP-3')
    assert.ok(l.held + l.committed <= l.on_hand)
    assert.equal(l.held, 2)
    assert.deepEqual(await auditLedger({ query }), [])
  })
})
