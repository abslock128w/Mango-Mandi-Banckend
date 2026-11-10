// The ripening rule (mango-api/README.md, Ripeness): age is days since pluck on the DELIVERY date (the day
// of pluck is 0); a batch reaches the warehouse at 1, sells raw 1–3 and semi-ripe 4–7, and is spoilt from 8.
// Delivery is the next day at the earliest (the day after that past the cutoff), so a batch that is 7 today
// is never offered, and one that arrived today (age 1) is first delivered at 2. Nothing is sold as RIPE;
// orders sold as RIPE before the change stay honoured by stock that is SEMI_RIPE on the day.
import { checkout, client, closeAll, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, test } from 'node:test'
import { setNow } from '../src/clock.js'
import { DEFAULT_RULES, getConfig, loadConfig } from '../src/config.js'
import { query, tx } from '../src/db.js'
import { sellWindow } from '../src/delivery.js'
import { allocateOrder, rebalanceOrder } from '../src/orders.js'

// T0 is 10:00 IST on 2026-10-15, before the 18:00 cutoff: the bookable days are 10-16 to 10-20.
const DAYS = ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']
const PIN = '560034'

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

/** What the catalogue offers of ALP-3 for a day: { RAW: n, SEMI_RIPE: n } (stages with 0 left out). */
async function offered(deliveryDate) {
  const r = await api.get(`/v1/catalogue?pincode=${PIN}&delivery_date=${deliveryDate}`)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.deliveryDate, deliveryDate)
  const out = {}
  for (const i of r.body.items.filter((x) => x.sku === 'ALP-3')) if (i.qty > 0) out[i.stage] = i.qty
  return out
}
const offeredByDay = async (days = DAYS) => Object.fromEntries(await Promise.all(days.map(async (d) => [d, await offered(d)])))

async function order(stage, deliveryDate, qty = 1) {
  const cust = await customerToken(api)
  return checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage, qty }], { deliveryDate })
}

describe('what the shop offers, by age on the delivery date (fixed clock)', () => {
  test('the catalogue never offers RIPE, and RIPE can no longer be put in a cart', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    const r = await api.get(`/v1/catalogue?pincode=${PIN}&delivery_date=${DAYS[0]}`)
    assert.deepEqual([...new Set(r.body.items.map((i) => i.stage))], ['RAW', 'SEMI_RIPE'])
    const cust = await customerToken(api)
    const add = await api.post('/v1/cart/items', { sku: 'ALP-3', stage: 'RIPE', qty: 1 }, { token: cust.accessToken })
    assert.equal(add.status, 400)
    assert.equal(add.body.error.code, 'INVALID_STAGE')
    // An old RIPE line can still be taken out.
    assert.equal((await api.post('/v1/cart/items', { sku: 'ALP-3', stage: 'RIPE', qty: 0 }, { token: cust.accessToken })).status, 204)
  })

  test('a batch that is 7 today is not offered or orderable for any day', async () => {
    await makeBatch({ age: 7, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    assert.deepEqual(await offeredByDay(), Object.fromEntries(DAYS.map((d) => [d, {}])))
    for (const stage of ['RAW', 'SEMI_RIPE']) {
      const r = await order(stage, DAYS[0])
      assert.equal(r.status, 409, JSON.stringify(r.body))
      assert.equal(r.body.error.code, 'STOCK_INSUFFICIENT')
    }
  })

  test('a batch that is 6 today is orderable for tomorrow only, as semi-ripe', async () => {
    await makeBatch({ age: 6, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    assert.deepEqual(await offeredByDay(), { '2026-10-16': { SEMI_RIPE: 10 }, '2026-10-17': {}, '2026-10-18': {}, '2026-10-19': {}, '2026-10-20': {} })
    const ok = await order('SEMI_RIPE', '2026-10-16')
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    const late = await order('SEMI_RIPE', '2026-10-17')
    assert.equal(late.body.error.code, 'STOCK_INSUFFICIENT')
  })

  test('a batch that arrived today (age 1) is raw for tomorrow (2) and the day after (3), semi-ripe from 4', async () => {
    await makeBatch({ age: 1, status: 'ARRIVED', rating: 'RAW', lines: { 'ALP-3': 10 } })
    assert.deepEqual(await offeredByDay(), {
      '2026-10-16': { RAW: 10 }, '2026-10-17': { RAW: 10 }, '2026-10-18': { SEMI_RIPE: 10 }, '2026-10-19': { SEMI_RIPE: 10 }, '2026-10-20': { SEMI_RIPE: 10 },
    })
    assert.equal((await order('RAW', '2026-10-16')).status, 201)
    assert.equal((await order('SEMI_RIPE', '2026-10-18')).status, 201)
  })

  test('a batch plucked today and still in transit (eta tomorrow) is first offered for the day after tomorrow', async () => {
    const id = await makeBatch({ age: 0, status: 'IN_TRANSIT', rating: null, lines: { 'ALP-3': 10 } })
    assert.equal((await query('SELECT eta_date FROM batches WHERE id = $1', [id])).rows[0].eta_date, '2026-10-16')
    // In-transit stock counts at the forecast confidence until it arrives and passes QC.
    const n = Math.floor(10 * getConfig().forecastConfidence)
    assert.deepEqual(await offeredByDay(), {
      '2026-10-16': {}, '2026-10-17': { RAW: n }, '2026-10-18': { RAW: n }, '2026-10-19': { SEMI_RIPE: n }, '2026-10-20': { SEMI_RIPE: n },
    })
  })

  test('after the cutoff the first day is D+2, and the same age rule holds', async () => {
    setNow('2026-10-15T13:00:00Z') // 18:30 IST
    await makeBatch({ age: 6, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } }) // 8 on 10-17: never offered
    await makeBatch({ age: 1, status: 'ARRIVED', rating: 'RAW', lines: { 'ALP-5': 4 } })
    const r = await api.get(`/v1/catalogue?pincode=${PIN}`)
    assert.equal(r.body.deliveryDate, '2026-10-17')
    assert.deepEqual(r.body.deliveryDates, ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'])
    const late = ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']
    assert.deepEqual(await offeredByDay(late), Object.fromEntries(late.map((d) => [d, {}])))
    const young = async (d) => {
      const x = await api.get(`/v1/catalogue?pincode=${PIN}&delivery_date=${d}`)
      return Object.fromEntries(x.body.items.filter((i) => i.sku === 'ALP-5' && i.qty > 0).map((i) => [i.stage, i.qty]))
    }
    assert.deepEqual(await young('2026-10-17'), { RAW: 4 }, 'age 3')
    assert.deepEqual(await young('2026-10-18'), { SEMI_RIPE: 4 }, 'age 4')
    const sameDay = await order('SEMI_RIPE', '2026-10-16')
    assert.equal(sameDay.body.error.code, 'INVALID_DATE', 'tomorrow is past the cutoff')
  })

  test("no order is taken for today: the batch's last order day is the day before its last delivery day", async () => {
    await makeBatch({ age: 6, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    const today = await order('SEMI_RIPE', '2026-10-15')
    assert.equal(today.status, 400)
    assert.equal(today.body.error.code, 'INVALID_DATE')
    assert.deepEqual(sellWindow('2026-10-09'), { lastDeliveryDay: '2026-10-16', lastOrderDay: '2026-10-15' })
  })
})

describe('the migration that moves a live database to the new rules (063)', () => {
  const sql = async () => readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '063_ripening_rules.sql'), 'utf8')
  const OLD = {
    ...DEFAULT_RULES, transitDays: 2, holdMinutes: 7,
    stageProfiles: { default: [{ stage: 'RAW', minAge: 3, maxAge: 3 }, { stage: 'SEMI_RIPE', minAge: 4, maxAge: 5 }, { stage: 'RIPE', minAge: 6, maxAge: 7 }] },
  }

  test('adds one version copied from the live one with the new rules, and nothing when run again', async () => {
    const { rows: was } = await query('SELECT MAX(version)::int AS v FROM app_config')
    await query(`INSERT INTO app_config (version, value, changed_by) VALUES ($1, $2, 'manager@x')`, [was[0].v + 1, OLD])
    await query(`INSERT INTO bulk_listings (id, sku, title, stages, min_qty, tiers, created_at, updated_at) VALUES ('bl_r', 'ALP-3', 'Ripe deal', '{RIPE,SEMI_RIPE,RAW}', 10, '[{"minQty":10,"unitPrice":100}]', now(), now())`)
    await tx(async (c) => c.query(await sql()))
    const { rows } = await query('SELECT version, value, changed_by FROM app_config ORDER BY version DESC LIMIT 1')
    assert.equal(rows[0].version, was[0].v + 2)
    assert.equal(rows[0].changed_by, 'system')
    assert.equal(rows[0].value.transitDays, 1)
    assert.equal(rows[0].value.maxSellableAge, 7)
    assert.equal(rows[0].value.retireAge, 8)
    assert.equal(rows[0].value.holdMinutes, 7, 'every other rule is kept')
    assert.deepEqual(rows[0].value.stageProfiles, DEFAULT_RULES.stageProfiles)
    const listing = (await query(`SELECT stages, version FROM bulk_listings WHERE id = 'bl_r'`)).rows[0]
    assert.deepEqual(listing.stages, ['SEMI_RIPE', 'RAW'])
    assert.equal(listing.version, 2)
    // The API loads it.
    assert.equal((await loadConfig()).version, was[0].v + 2)
    assert.equal(getConfig().transitDays, 1)
    // Run again: nothing more.
    await tx(async (c) => c.query(await sql()))
    assert.equal((await query('SELECT MAX(version)::int AS v FROM app_config')).rows[0].v, was[0].v + 2)
    assert.equal((await query(`SELECT version FROM bulk_listings WHERE id = 'bl_r'`)).rows[0].version, 2)
  })

  test('a fresh database ends up on the new defaults: the file adds nothing, loadConfig writes version 1', async () => {
    // resetDb ran every migration on an empty app_config, then loadConfig wrote version 1.
    const { rows } = await query('SELECT version, value FROM app_config ORDER BY version')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].value.transitDays, 1)
    assert.deepEqual(rows[0].value.stageProfiles, DEFAULT_RULES.stageProfiles)
  })
})

describe('boxes sold as RIPE before the change', () => {
  /** An order placed as SEMI_RIPE, then written back to how a RIPE sale looked before the change. */
  async function ripeOrder(deliveryDate = '2026-10-16') {
    const c = await order('SEMI_RIPE', deliveryDate, 2)
    assert.equal(c.status, 201, JSON.stringify(c.body))
    const id = c.body.orderId
    assert.equal((await api.post('/v1/dev/pay', { orderId: id, outcome: 'captured' })).status, 200)
    await query(`UPDATE order_items SET stage = 'RIPE' WHERE order_id = $1`, [id])
    await query(`UPDATE order_stock SET stage = 'RIPE' WHERE order_id = $1`, [id])
    return id
  }
  const stock = async (id) => (await query(`SELECT batch_id, stage, quantity, state FROM order_stock WHERE order_id = $1 AND state <> 'released' ORDER BY batch_id`, [id])).rows
  const risk = async (id) => (await query('SELECT at_risk, at_risk_reason FROM orders WHERE id = $1', [id])).rows[0]

  test('stay allocated, are not flagged, and can be packed, where the batch is semi-ripe on the day', async () => {
    const batch = await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    const id = await ripeOrder()
    const r = await tx((c) => rebalanceOrder(c, id, { type: 'system', id: 'test' }))
    assert.equal(r.atRisk, false)
    assert.equal(r.changed, false)
    assert.deepEqual(await stock(id), [{ batch_id: batch, stage: 'RIPE', quantity: 2, state: 'committed' }])
    await tx((c) => allocateOrder(c, id, { type: 'admin', id: 'test' }))
    assert.deepEqual((await stock(id)).map((s) => s.state), ['packed'])
  })

  test('a RIPE line with no stock is filled from semi-ripe stock, and stays a RIPE line', async () => {
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    const id = await ripeOrder()
    await query(`UPDATE batch_lines SET committed = committed - 2`)
    await query(`DELETE FROM order_stock WHERE order_id = $1`, [id])
    const r = await tx((c) => rebalanceOrder(c, id, { type: 'system', id: 'test' }))
    assert.equal(r.atRisk, false)
    assert.deepEqual((await stock(id)).map((s) => [s.stage, s.quantity]), [['RIPE', 2]])
  })

  test('a batch too old for the day is swapped for a fresher one, or the order is flagged, never kept', async () => {
    const old = await makeBatch({ age: 6, rating: 'SEMI_RIPE', lines: { 'ALP-3': 2 } })
    const id = await ripeOrder('2026-10-16')
    assert.deepEqual((await stock(id)).map((s) => s.batch_id), [old])
    // The order moves a day on (as a reschedule would) while the old batch is 8 then.
    await query(`UPDATE orders SET delivery_date = '2026-10-17' WHERE id = $1`, [id])
    let r = await tx((c) => rebalanceOrder(c, id, { type: 'system', id: 'test' }))
    assert.equal(r.atRisk, true, 'no fresher stock: flagged for Needs attention')
    const fresh = await makeBatch({ age: 4, rating: 'SEMI_RIPE', lines: { 'ALP-3': 5 } })
    r = await tx((c) => rebalanceOrder(c, id, { type: 'system', id: 'test' }))
    assert.equal(r.atRisk, false)
    assert.deepEqual(await stock(id), [{ batch_id: fresh, stage: 'RIPE', quantity: 2, state: 'committed' }])
    assert.equal((await risk(id)).at_risk, false)
  })

  test('a RIPE line is not kept on a batch that is raw on the day: it is flagged', async () => {
    const batch = await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 10 } })
    const id = await ripeOrder()
    // The batch's pluck date was entered wrong and corrected: it is 3 on the day, raw.
    await query(`UPDATE batches SET plucked_on = '2026-10-13' WHERE id = $1`, [batch])
    await query(`UPDATE batch_qc SET ripeness_rating = 'RAW'`)
    const r = await tx((c) => rebalanceOrder(c, id, { type: 'system', id: 'test' }))
    assert.equal(r.atRisk, true)
    assert.match((await risk(id)).at_risk_reason, /is not RIPE on 2026-10-16/)
  })
})
