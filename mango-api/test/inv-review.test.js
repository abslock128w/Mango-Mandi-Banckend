// Architecture review, inventory: a product's shelf life at sale time, the
// hourly box check, and the rule that every counter change has a reviewed path.
import { closeAll, T0, adminToken, checkout, client, customerToken, line, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { after, before, beforeEach, describe, test } from 'node:test'
import { attentionCount, attentionReport } from '../src/admin/reports.js'
import { getConfig } from '../src/config.js'
import { query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { availability, lineInfo, saleLimitDays, sellableAs } from '../src/inventory.js'
import { runAudit } from '../src/maintenance.js'
import { loadProducts } from '../src/products.js'
import { onProblemForTests } from '../src/sentry.js'

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
beforeEach(() => resetDb())

const shelfLife = async (sku, days) => {
  await query('UPDATE products SET shelf_life_days = $2 WHERE sku = $1', [sku, days])
  await loadProducts()
}
const catalogueQty = async (date, sku) => {
  const r = await api.get(`/v1/catalogue?pincode=560034&delivery_date=${date}`)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body.items.filter((i) => i.sku === sku).reduce((n, i) => n + i.qty, 0)
}

describe("a product's shelf life limits what is sold for a delivery date", () => {
  // Plucked on 10-14: day 5 is 10-19, day 6 is 10-20. The shop-wide cap (7 days) allows both.
  const DAY5 = '2026-10-19'
  const DAY6 = '2026-10-20'

  test('shelf life 5 and a 7-day cap: day 6 cannot be sold, day 5 can, and the shop shows the same', async () => {
    assert.equal(getConfig().maxSellableAge, 7)
    const batchId = await makeBatch({ age: 1, lines: { 'ALP-3': 10 } })
    const info = await tx(async (c) => lineInfo(c, (await line(batchId, 'ALP-3')).id))
    const qtyOn = async (date) => [...(await tx((c) => availability(c, date)))].filter(([k]) => k.startsWith('ALP-3|')).reduce((n, [, q]) => n + q, 0)

    // Without a shelf life, the cap alone decides: both days sell.
    assert.ok(sellableAs(info, DAY6))
    assert.equal(await qtyOn(DAY6), 10)
    assert.equal(await catalogueQty(DAY6, 'ALP-3'), 10)

    await shelfLife('ALP-3', 5)
    assert.equal(saleLimitDays('ALP-3'), 5)
    assert.equal(sellableAs(info, DAY6), null, 'past the shelf life on day 6')
    assert.equal(sellableAs(info, DAY6, getConfig(), { existing: true }), null, 'stock already promised is too old too')
    assert.ok(sellableAs(info, DAY5), 'day 5 is the last day it sells')
    assert.equal(await qtyOn(DAY6), 0)
    assert.equal(await qtyOn(DAY5), 10)
    // The shop shows no stock it would then refuse at checkout.
    assert.equal(await catalogueQty(DAY6, 'ALP-3'), 0)
    assert.equal(await catalogueQty(DAY5, 'ALP-3'), 10)

    const stage = [...(await tx((c) => availability(c, DAY5)))].find(([k, q]) => k.startsWith('ALP-3|') && q > 0)[0].split('|')[1]
    const refused = await checkout(api, (await customerToken(api)).accessToken, [{ sku: 'ALP-3', stage, qty: 1 }], { deliveryDate: DAY6 })
    assert.equal(refused.status, 409, JSON.stringify(refused.body))
    const ok = await checkout(api, (await customerToken(api)).accessToken, [{ sku: 'ALP-3', stage, qty: 1 }], { deliveryDate: DAY5 })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
  })

  test('a shelf life longer than the cap changes nothing: the cap still applies', async () => {
    await shelfLife('ALP-3', 30)
    assert.equal(saleLimitDays('ALP-3'), getConfig().maxSellableAge)
  })
})

describe('the hourly box check', () => {
  let problems
  before(() => onProblemForTests((message, context) => problems.push({ message, context })))
  after(() => onProblemForTests(null))
  beforeEach(() => {
    problems = []
  })
  const boxAlerts = () => problems.filter((p) => /Labelled boxes disagree/.test(p.message))

  test('a tracked line with no labelled boxes alerts at most hourly and shows on Needs attention', async () => {
    assert.equal(env.WAREHOUSE_V2, true)
    await makeBatch({ age: 1, lines: { 'ALP-3': 4 } })
    await runAudit()
    assert.deepEqual(boxAlerts(), [], 'untracked stock is not a box problem')
    assert.deepEqual((await attentionReport()).boxMismatches, [])

    await query("UPDATE products SET box_tracking_enabled = TRUE, nominal_weight_g = 3000 WHERE sku = 'ALP-3'")
    await runAudit()
    assert.equal(boxAlerts().length, 1)
    const [w] = boxAlerts()[0].context.warehouses
    assert.equal(w.warehouseId, 'wh_main')
    assert.equal(w.stockMismatches, 1)
    assert.equal(w.sample[0].onHand, 4)
    assert.equal(w.sample[0].sellableBoxes, 0)

    await runAudit(new Date(Date.parse(T0) + 30 * 60_000))
    assert.equal(boxAlerts().length, 1, 'not again within the hour')
    await runAudit(new Date(Date.parse(T0) + 61 * 60_000))
    assert.equal(boxAlerts().length, 2, 'again after an hour')

    const a = await attentionReport()
    assert.deepEqual(a.boxMismatches, [{ warehouseId: 'wh_main', name: 'Main warehouse', stockMismatches: 1, orderUnitMismatches: 0, impossibleStates: 0, lotCountMismatches: 0 }])
    assert.equal(attentionCount(a), attentionCount({ ...a, boxMismatches: [] }) + 1)
    const viaApi = await api.get('/admin/v1/attention', { token: await adminToken(api) })
    assert.deepEqual(viaApi.body.boxMismatches, a.boxMismatches)
  })

  test('with WAREHOUSE_V2 off there is no box check', async (t) => {
    t.after(() => {
      env.WAREHOUSE_V2 = true
    })
    await makeBatch({ age: 1, lines: { 'ALP-3': 4 } })
    await query("UPDATE products SET box_tracking_enabled = TRUE, nominal_weight_g = 3000 WHERE sku = 'ALP-3'")
    env.WAREHOUSE_V2 = false
    await runAudit()
    assert.deepEqual(boxAlerts(), [])
    assert.deepEqual((await attentionReport()).boxMismatches, [])
  })
})

describe('every counter change is on a reviewed path', () => {
  // Each file that changes batch_lines, with how many UPDATE statements it has.
  // on_hand and reserve_buffer must move with a batch_ledger row in the same
  // transaction; held and committed must move with order_stock (auditLedger
  // checks both). A new UPDATE, here or in a new file, fails this test until
  // someone has checked it keeps that rule and updated the list.
  const REVIEWED = {
    'inventory.js': 6, // allocate, release, commit, pack, restock: the stock engine itself, with ledger()
    'orders.js': 3, // condemn or retire a batch (ledger ADJUST_BUFFER, CONDEMN/RETIRE), a count or short arrival (ledger ADJUST)
    'admin/batches.js': 1, // a manager's count change (ledger ADJUST / ADJUST_BUFFER)
    'admin/recovery.js': 1, // repair: counters set back to what the ledger and order_stock say (a STATUS row records it)
    'warehouse/core.js': 1, // box deltas (applyLineDeltas, ledger per delta)
    'warehouse/stock.js': 1, // a box packed for an order (ledger PACK)
    'warehouse/lots.js': 1, // a lot's product corrected while its line has no stock (sku only, no counter)
    'warehouse/ops.js': 1, // pick takes a box for an order (committed, with its order_stock row)
  }
  const SRC = resolve(import.meta.dirname, '../src')
  const files = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : []
  })

  test('UPDATE batch_lines appears only in reviewed files, each of which also writes the ledger', () => {
    const found = {}
    for (const p of files(SRC)) {
      const text = readFileSync(p, 'utf8')
      const n = (text.match(/UPDATE\s+(public\.)?batch_lines\b/gi) ?? []).length
      if (!n) continue
      const name = relative(SRC, p).split('\\').join('/')
      found[name] = n
      assert.ok(/\bledger\(|INSERT INTO batch_ledger/.test(text), `${name} changes batch_lines but writes no batch_ledger row`)
    }
    assert.deepEqual(found, REVIEWED, 'a batch_lines UPDATE was added or removed: check it keeps the ledger rule, then update REVIEWED')
  })
})
