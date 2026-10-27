// Staff operations (docs/ops.md): the stock forecast (STOCK_FORECAST), farm and
// purchase records with margins (PURCHASE_RECORDS) and the panel's feature
// switches (PANEL_FEATURE_SWITCHES). Every date is fixed with the clock helper.
import { adminToken, client, closeAll, customerToken, forceOrderState, makeBatch, resetDb, startServer, T0 } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { addDays, now, setNow, todayIST } from '../src/clock.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { forgetSwitches, isOn, knownSwitch, NEVER_FROM_PANEL, PANEL_SWITCHES, SWITCH_CACHE_MS } from '../src/feature-switches.js'
import { sameWeekdays } from '../src/forecast.js'
import { newId } from '../src/ids.js'

let srv
let api
let manager

const FLAGS = ['STOCK_FORECAST', 'PURCHASE_RECORDS', 'PANEL_FEATURE_SWITCHES', 'STAFF_STEP_UP', 'STAFF_AUDIT_TRAIL', 'FAVOURITES', 'SHOP_SORT_FILTER', 'LIVE_TRACKING']
const saved = Object.fromEntries(FLAGS.map((k) => [k, env[k]]))
const savedProcess = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]))

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
  forgetSwitches()
  manager = await adminToken(api)
})
afterEach(() => {
  Object.assign(env, saved)
  for (const [k, v] of Object.entries(savedProcess)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  forgetSwitches()
  setNow(T0)
})

const operatorToken = () => adminToken(api, 'ops@mandimangoes.test', 'operator123')
const qcToken = () => adminToken(api, 'qc@mandimangoes.test', 'qc123')
const packerToken = () => adminToken(api, 'packer@mandimangoes.test', 'packer123')

let orderSeq = 0
/** A paid order inserted directly, for history and margins. */
async function insertOrder({ date, sku, stage = 'RIPE', qty, status = 'DELIVERED', unitPrice = 189_900, discount = 0, replacementFor = null, stock = null }) {
  const id = newId('ord')
  const subtotal = unitPrice * qty
  await forceOrderState(
    `INSERT INTO orders (id, number, status, delivery_date, placed_at, subtotal, total, discount, replacement_for) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, `ORD-T${++orderSeq}`, status, date, now(), subtotal, subtotal - discount, discount, replacementFor],
  )
  await query('INSERT INTO order_items (id, order_id, sku, quantity, stage, unit_price, line_price) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
    newId('oi'), id, sku, qty, stage, unitPrice, subtotal,
  ])
  if (stock) {
    await query('INSERT INTO order_stock (id, order_id, batch_id, line_id, sku, stage, quantity, state) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
      newId('ost'), id, stock.batchId, stock.lineId, sku, stage, qty, stock.state ?? 'packed',
    ])
  }
  return id
}

/** A batch from the past, inserted directly: its fruit was on sale between its pluck day and the 7-day cap. */
async function pastBatch({ pluckedOn, sku = 'ALP-3', boxes = 20, status = 'EXHAUSTED', variety = 'Alphonso' }) {
  const id = newId('bat')
  await query('INSERT INTO batches (id, variety, plucked_on, status, eta_date, arrived_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $6)', [
    id, variety, pluckedOn, status, addDays(pluckedOn, 2), new Date(`${addDays(pluckedOn, 2)}T04:30:00Z`),
  ])
  await query('INSERT INTO batch_lines (id, batch_id, sku, on_hand) VALUES ($1, $2, $3, 0)', [newId('bl'), id, sku])
  await query(`INSERT INTO batch_ledger (id, batch_id, event_type, sku, delta, actor_type, actor_id, created_at) VALUES ($1, $2, 'INTAKE', $3, $4, 'system', 'test', $5)`, [
    newId('led'), id, sku, boxes, new Date(`${pluckedOn}T04:30:00Z`),
  ])
  return id
}

const audits = async (action) => (await query('SELECT * FROM staff_audit WHERE action = $1 ORDER BY created_at', [action])).rows

// ---------------------------------------------------------------- stock forecast

describe('stock forecast (STOCK_FORECAST)', () => {
  test('off: 404 for managers; other roles are refused either way', async () => {
    assert.equal((await api.get('/admin/v1/planning/forecast', { token: manager })).status, 404)
    env.STOCK_FORECAST = true
    for (const token of [await operatorToken(), await qcToken(), await packerToken()]) {
      assert.equal((await api.get('/admin/v1/planning/forecast', { token })).status, 403)
    }
  })

  test('the same-weekday history skips days with no stock and closed days, and shows every number', async () => {
    env.STOCK_FORECAST = true
    setNow(T0) // Thursday 15 Oct 2026, 10:00 IST
    const today = todayIST()
    assert.equal(today, '2026-10-15')
    // The four Fridays before today, for the first forecast day (Friday 16 Oct).
    const fridays = sameWeekdays('2026-10-16', today)
    assert.deepEqual(fridays, ['2026-10-09', '2026-10-02', '2026-09-25', '2026-09-18'])
    await insertOrder({ date: '2026-10-09', sku: 'ALP-3', qty: 6 })
    await insertOrder({ date: '2026-10-02', sku: 'ALP-3', qty: 4 })
    // 25 Sep sold nothing, but a batch was ripe then: a real zero, counted.
    await pastBatch({ pluckedOn: '2026-09-19' })
    // 18 Sep was closed: left out.
    await query(`INSERT INTO delivery_calendar (date, is_open, note) VALUES ('2026-09-18', FALSE, 'Festival')`)
    // A free replacement is not a sale.
    await insertOrder({ date: '2026-10-09', sku: 'ALP-3', qty: 5, unitPrice: 0, replacementFor: await insertOrder({ date: '2026-10-08', sku: 'ALP-3', qty: 1 }) })
    // Damage in the last 28 days: 2 boxes counted down as damaged.
    const old = await pastBatch({ pluckedOn: '2026-10-01', status: 'SELLING' })
    await query(`INSERT INTO batch_ledger (id, batch_id, event_type, sku, delta, actor_type, actor_id, reason, reason_code, created_at)
                 VALUES ($1, $2, 'ADJUST', 'ALP-3', -2, 'admin', 'test', 'crushed', 'DAMAGED', $3)`, [newId('led'), old, new Date('2026-10-10T05:00:00Z')])
    await query(`UPDATE batches SET status = 'EXHAUSTED' WHERE id = $1`, [old])

    // Stock now: plucked 3 days ago, QC raw today: ripe on 18 and 19 Oct, past the cap from 20 Oct.
    const batchId = await makeBatch({ age: 3, rating: 'RAW', lines: { 'ALP-3': 10 } })
    // Paid orders already booked for Friday (their boxes are set aside), and a Book ahead booking for the week of 19 Oct.
    await insertOrder({ date: '2026-10-16', sku: 'ALP-3', qty: 2, status: 'CONFIRMED' })
    const cust = newId('cus')
    await query(`INSERT INTO customers (id, phone, name) VALUES ($1, '9876500001', 'Test')`, [cust])
    await query(
      `INSERT INTO preorders (id, number, customer_id, phone, sku, stage, qty, unit_price, total, week_start, pincode, delivery_address, status, payment_status, created_at, booked_at)
       VALUES ($1, 'PRE-T1', $2, '9876500001', 'ALP-3', 'RIPE', 3, 189900, 569700, '2026-10-19', '560034', 'x', 'BOOKED', 'SUCCEEDED', now(), now())`,
      [newId('pre'), cust],
    )
    const stockBefore = (await query('SELECT on_hand, held, committed FROM batch_lines WHERE batch_id = $1', [batchId])).rows[0]
    const ledgerBefore = (await query('SELECT COUNT(*)::int AS n FROM batch_ledger')).rows[0].n

    const r = await api.get('/admin/v1/planning/forecast', { token: manager })
    assert.equal(r.status, 200)
    assert.equal(r.body.today, '2026-10-15')
    assert.equal(r.body.dates.length, 14)
    assert.equal(r.body.dates[0], '2026-10-16')
    assert.equal(r.body.dates.at(-1), '2026-10-29')
    const alp = r.body.varieties.find((v) => v.variety === 'Alphonso')
    const p = alp.products.find((x) => x.sku === 'ALP-3')
    const ripe = p.stages.find((s) => s.stage === 'RIPE')
    const fri = ripe.days.find((d) => d.date === '2026-10-16')
    assert.deepEqual(
      fri.history.samples.map((s) => [s.date, s.sold, s.counted, s.reason]),
      [
        ['2026-10-09', 6, true, null],
        ['2026-10-02', 4, true, null],
        ['2026-09-25', 0, true, null],
        ['2026-09-18', 0, false, 'closed'],
      ],
    )
    assert.equal(fri.history.average, 3.3)
    assert.equal(fri.booked, 2)
    assert.equal(fri.expected, 3.3)
    // Still to sell 1.3 → 2 boxes; the batch is semi-ripe on Friday, so none from stock.
    assert.equal(fri.fromStock, 0)
    assert.equal(fri.short, 2)
    // Waste: 2 damaged against 11 sold (6 + 4 + the replaced order's 1; the free replacement is not a sale): 2 / 13.
    assert.deepEqual({ ...p.waste }, { days: 28, damagedBoxes: 2, claimBoxes: 0, soldBoxes: 11, rate: 0.154, capped: false })
    // The Book ahead booking is on Monday 19 Oct, and the ripe batch covers it (after expected waste).
    const mon = ripe.days.find((d) => d.date === '2026-10-19')
    assert.equal(mon.bookAhead, 3)
    assert.equal(mon.fromStock, 3)
    assert.equal(mon.short, 0)
    // The next Friday (23 Oct) has the same history, and the batch is past the 7-day cap by then.
    const fri2 = ripe.days.find((d) => d.date === '2026-10-23')
    assert.equal(fri2.history.average, 3.3)
    assert.equal(fri2.short, 4)
    const b = p.batches.find((x) => x.batchId === batchId)
    assert.equal(b.ageToday, 3)
    assert.equal(b.sellableUntil, '2026-10-19')
    assert.equal(b.stages.find((s) => s.date === '2026-10-16').stage, 'SEMI_RIPE')
    assert.equal(b.stages.find((s) => s.date === '2026-10-18').stage, 'RIPE')
    assert.equal(b.stages.find((s) => s.date === '2026-10-20').stage, null)
    assert.equal(b.usedByForecast, 3)
    // floor(10 × (1 − 0.154)) = 8 usable, 3 used: 5 pass the cap unsold.
    assert.equal(b.unsoldPastCap, 5)
    // Short 2 + 4 = 6, grossed up for waste: ceil(6 / 0.846) = 8.
    assert.equal(p.shortBoxes, 6)
    assert.equal(p.suggestedBoxes, 8)
    assert.equal(p.enoughHistory, true)
    // Ripe on 16 Oct means plucked by 10 Oct (ripe from age 6): the earliest short day sets the date.
    assert.equal(p.buyBy, '2026-10-10')
    assert.deepEqual(p.shortDays.map((d) => [d.date, d.pluckBy]), [['2026-10-16', '2026-10-10'], ['2026-10-23', '2026-10-17']])
    // Read only: no stock moved, no ledger row written.
    assert.deepEqual((await query('SELECT on_hand, held, committed FROM batch_lines WHERE batch_id = $1', [batchId])).rows[0], stockBefore)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM batch_ledger')).rows[0].n, ledgerBefore)
  })

  test('a product with no history says "not enough history", never 0', async () => {
    env.STOCK_FORECAST = true
    const r = await api.get('/admin/v1/planning/forecast', { token: manager })
    assert.equal(r.status, 200)
    const badami = r.body.varieties.find((v) => v.variety === 'Badami')
    assert.equal(badami.suggestedBoxes, null)
    assert.equal(badami.note, 'not enough history')
    for (const p of badami.products) {
      assert.equal(p.suggestedBoxes, null)
      assert.equal(p.note, 'not enough history')
      assert.equal(p.enoughHistory, false)
      for (const s of p.stages) for (const d of s.days) assert.equal(d.history.average, null)
    }
  })

  test('paid bookings beyond the stock still show as short when there is no history', async () => {
    env.STOCK_FORECAST = true
    await insertOrder({ date: '2026-10-17', sku: 'BAD-3', qty: 4, status: 'CONFIRMED', unitPrice: 129_900 })
    const cust = newId('cus')
    await query(`INSERT INTO customers (id, phone, name) VALUES ($1, '9876500002', 'Test')`, [cust])
    await query(
      `INSERT INTO preorders (id, number, customer_id, phone, sku, stage, qty, unit_price, total, week_start, pincode, delivery_address, status, payment_status, created_at, booked_at)
       VALUES ($1, 'PRE-T2', $2, '9876500002', 'BAD-3', 'SEMI_RIPE', 2, 129900, 259800, '2026-10-26', '560034', 'x', 'BOOKED', 'SUCCEEDED', now(), now())`,
      [newId('pre'), cust],
    )
    const r = await api.get('/admin/v1/planning/forecast', { token: manager })
    const p = r.body.varieties.find((v) => v.variety === 'Badami').products.find((x) => x.sku === 'BAD-3')
    assert.equal(p.suggestedBoxes, null)
    // The booked order already has its boxes set aside; the Book ahead booking has none.
    assert.equal(p.shortForBookings, 2)
    assert.deepEqual(p.shortDays.map((d) => [d.date, d.stage, d.boxes]), [['2026-10-26', 'SEMI_RIPE', 2]])
  })

  test('the forecast follows the switch a manager set on the panel', async () => {
    env.PANEL_FEATURE_SWITCHES = true
    await query(`INSERT INTO feature_switches (key, enabled, updated_by, updated_at) VALUES ('STOCK_FORECAST', TRUE, 'test', now())`)
    assert.equal((await api.get('/admin/v1/planning/forecast', { token: manager })).status, 200)
  })
})

// ---------------------------------------------------------------- farms and purchases

async function farm(token = manager, body = { name: 'Ratnagiri Orchards', place: 'Ratnagiri', contactName: 'Suresh', phone: '9876543210' }) {
  return api.post('/admin/v1/farms', body, { token })
}

async function intake(boxes = 20) {
  const r = await api.post('/admin/v1/batches', { variety: 'Alphonso', pluckedOn: addDays(todayIST(), -1), lines: [{ sku: 'ALP-3', onHand: boxes }] }, { token: manager })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  return r.body
}

const PURCHASE = { purchasedOn: '2026-10-14', crates: 4, boxes: 20, costPerCrate: 500_000, transportCost: 100_000, otherCost: 0 }

describe('farm and purchase records (PURCHASE_RECORDS)', () => {
  test('off: every route answers 404', async () => {
    assert.equal((await api.get('/admin/v1/farms', { token: manager })).status, 404)
    assert.equal((await farm()).status, 404)
    const b = await intake()
    assert.equal((await api.get(`/admin/v1/batches/${b.id}/purchases`, { token: manager })).status, 404)
    assert.equal((await api.get('/admin/v1/analytics/margins', { token: manager })).status, 404)
  })

  test('farms: the phone only ever comes back masked; edits are audited; names are unique', async () => {
    env.PURCHASE_RECORDS = true
    const r = await farm()
    assert.equal(r.status, 201)
    assert.equal(r.body.phoneMasked, '******3210')
    assert.equal(JSON.stringify(r.body).includes('9876543210'), false)
    assert.equal((await farm(manager, { name: 'ratnagiri orchards' })).body.error.code, 'FARM_EXISTS')
    assert.equal((await farm(manager, { name: 'Bad phone', phone: '12345' })).status, 400)
    const patched = await api.patch(`/admin/v1/farms/${r.body.id}`, { place: 'Devgad', phone: null }, { token: manager })
    assert.equal(patched.status, 200)
    assert.equal(patched.body.place, 'Devgad')
    assert.equal(patched.body.phoneMasked, null)
    const [created] = await audits('farm.create')
    assert.equal(created.target, r.body.id)
    assert.equal(created.detail.phone, '******3210')
    const [updated] = await audits('farm.update')
    assert.deepEqual(updated.detail.changed, { place: { from: 'Ratnagiri', to: 'Devgad' }, phone: { from: '******3210', to: null } })
    assert.equal(JSON.stringify(await query('SELECT detail FROM staff_audit')).includes('9876543210'), false)
    // Operators and QC may read the list; only managers change it.
    const ops = await operatorToken()
    assert.equal((await api.get('/admin/v1/farms', { token: ops })).status, 200)
    assert.equal((await api.get('/admin/v1/farms', { token: await qcToken() })).status, 200)
    assert.equal((await farm(ops, { name: 'Operator farm' })).status, 403)
    assert.equal((await api.patch(`/admin/v1/farms/${r.body.id}`, { name: 'X' }, { token: ops })).status, 403)
    assert.equal((await api.get('/admin/v1/farms', { token: await packerToken() })).status, 403)
  })

  test('purchases: amounts are positive whole paise, boxes never exceed what the batch received', async () => {
    env.PURCHASE_RECORDS = true
    const f = (await farm()).body
    const b = await intake(20)
    const post = (body) => api.post(`/admin/v1/batches/${b.id}/purchases`, { farmId: f.id, ...PURCHASE, ...body }, { token: manager })
    for (const bad of [{ costPerCrate: 0 }, { costPerCrate: -100 }, { costPerCrate: 1000.5 }, { transportCost: -1 }, { otherCost: -5 }, { crates: 0 }, { boxes: 0 }, { purchasedOn: '2026-10-16' }, { purchasedOn: '2026-02-31' }]) {
      const r = await post(bad)
      assert.equal(r.status, 400, `${JSON.stringify(bad)} → ${r.status}`)
    }
    assert.equal((await post({ farmId: 'frm_nope' })).body.error.code, 'INVALID_FARM')
    const over = await post({ boxes: 21 })
    assert.equal(over.status, 409)
    assert.equal(over.body.error.code, 'PURCHASE_EXCEEDS_BATCH')
    assert.equal(over.body.error.receivedBoxes, 20)
    const first = await post({ boxes: 12 })
    assert.equal(first.status, 201)
    assert.equal(first.body.totalCost, 4 * 500_000 + 100_000)
    assert.equal(first.body.costPerBox, Math.round(2_100_000 / 12))
    // Two purchases together may not claim more than arrived either.
    const second = await post({ boxes: 9, crates: 2 })
    assert.equal(second.status, 409)
    assert.equal(second.body.error.otherPurchaseBoxes, 12)
    assert.equal((await post({ boxes: 8, crates: 2 })).status, 201)
    // Raising the first one's boxes past the batch is refused too.
    assert.equal((await api.patch(`/admin/v1/batches/${b.id}/purchases/${first.body.id}`, { boxes: 13 }, { token: manager })).status, 409)
    const edited = await api.patch(`/admin/v1/batches/${b.id}/purchases/${first.body.id}`, { costPerCrate: 450_000 }, { token: manager })
    assert.equal(edited.status, 200)
    assert.equal(edited.body.costPerCrate, 450_000)
    // A short arrival lowers what the batch received.
    const lineId = b.lines[0].id
    assert.equal((await api.post(`/admin/v1/batches/${b.id}/lines/${lineId}/short-arrival`, { onHand: 18, reason: 'two crates short' }, { token: manager })).status, 200)
    const list = await api.get(`/admin/v1/batches/${b.id}/purchases`, { token: manager })
    assert.equal(list.body.receivedBoxes, 18)
    assert.equal(list.body.purchasedBoxes, 20)
    assert.equal((await post({ boxes: 1, crates: 1 })).status, 409)
    // Every change is in the staff audit, with what changed.
    assert.equal((await audits('purchase.create')).length, 2)
    const [upd] = await audits('purchase.update')
    assert.deepEqual(upd.detail.changed, { costPerCrate: { from: 500_000, to: 450_000 } })
    assert.equal(upd.target, `${b.id}/${first.body.id}`)
  })

  test('costs are for managers: other roles get the records without money, and the cost routes refuse them', async () => {
    env.PURCHASE_RECORDS = true
    const f = (await farm()).body
    const b = await intake(20)
    const made = await api.post(`/admin/v1/batches/${b.id}/purchases`, { farmId: f.id, ...PURCHASE }, { token: manager })
    assert.equal(made.status, 201)
    for (const token of [await operatorToken(), await qcToken()]) {
      const r = await api.get(`/admin/v1/batches/${b.id}/purchases`, { token })
      assert.equal(r.status, 200)
      assert.equal(r.body.costsShown, false)
      assert.equal(r.body.items.length, 1)
      assert.equal(r.body.items[0].boxes, 20)
      assert.doesNotMatch(JSON.stringify(r.body), /costPerCrate|transportCost|otherCost|totalCost|costPerBox|500000|100000/)
      assert.equal((await api.get('/admin/v1/purchases', { token })).status, 403)
      assert.equal((await api.get('/admin/v1/analytics/margins', { token })).status, 403)
      assert.equal((await api.post(`/admin/v1/batches/${b.id}/purchases`, { farmId: f.id, ...PURCHASE, boxes: 1 }, { token })).status, 403)
      assert.equal((await api.patch(`/admin/v1/batches/${b.id}/purchases/${made.body.id}`, { boxes: 1 }, { token })).status, 403)
    }
    const packer = await packerToken()
    assert.equal((await api.get(`/admin/v1/batches/${b.id}/purchases`, { token: packer })).status, 403)
    const mgr = await api.get(`/admin/v1/batches/${b.id}/purchases`, { token: manager })
    assert.equal(mgr.body.costsShown, true)
    assert.equal(mgr.body.totalCost, 2_100_000)
  })

  test('margins per box and per variety: revenue after promo discounts, less the cost of the boxes sold', async () => {
    env.PURCHASE_RECORDS = true
    const f = (await farm()).body
    const b = await intake(20)
    assert.equal((await api.post(`/admin/v1/batches/${b.id}/purchases`, { farmId: f.id, ...PURCHASE }, { token: manager })).status, 201)
    const stock = { batchId: b.id, lineId: b.lines[0].id }
    // 2 boxes with 10% off, a free replacement box (no revenue), and a cancelled order (not a sale).
    const paid = await insertOrder({ date: '2026-10-16', sku: 'ALP-3', qty: 2, discount: 37_980, status: 'DELIVERED', stock })
    await insertOrder({ date: '2026-10-17', sku: 'ALP-3', qty: 1, unitPrice: 0, replacementFor: paid, status: 'CONFIRMED', stock: { ...stock, state: 'committed' } })
    await insertOrder({ date: '2026-10-16', sku: 'ALP-3', qty: 3, status: 'CANCELLED', stock: { ...stock, state: 'released' } })
    const r = await api.get('/admin/v1/analytics/margins?from=2026-10-01&to=2026-10-15', { token: manager })
    assert.equal(r.status, 200)
    const [batch] = r.body.batches
    assert.equal(batch.boughtBoxes, 20)
    assert.equal(batch.totalCost, 2_100_000)
    assert.equal(batch.costPerBox, 105_000)
    assert.equal(batch.soldBoxes, 3)
    assert.equal(batch.revenue, 341_820)
    assert.equal(batch.costOfSold, 315_000)
    assert.equal(batch.margin, 26_820)
    assert.equal(batch.marginPerBox, 8_940)
    assert.equal(batch.unsoldBoxes, 17)
    assert.equal(batch.costOfUnsold, 1_785_000)
    const [alp] = r.body.varieties
    assert.equal(alp.variety, 'Alphonso')
    assert.equal(alp.margin, 26_820)
    assert.equal(alp.marginPerBox, 8_940)
    // Out of range: nothing.
    assert.deepEqual((await api.get('/admin/v1/analytics/margins?from=2026-09-01&to=2026-09-30', { token: manager })).body.batches, [])
    assert.equal((await api.get('/admin/v1/analytics/margins?from=2026-10-10&to=2026-10-01', { token: manager })).status, 400)
  })
})

// ---------------------------------------------------------------- feature switches

/** Runs fn as a build that does not read this switch yet: its entry in env is removed, then put back. */
async function withoutEnvKey(key, fn) {
  const had = Object.hasOwn(env, key)
  const value = env[key]
  delete env[key]
  try {
    return await fn()
  } finally {
    if (had) env[key] = value
  }
}
const put = (key, body, token = manager) => api.put(`/admin/v1/settings/switches/${key}`, body, { token })

describe('feature switches in the panel (PANEL_FEATURE_SWITCHES)', () => {
  test('the allowlist holds no security, payment, refund or stock-safety switch', () => {
    const keys = PANEL_SWITCHES.map((s) => s.key)
    assert.equal(new Set(keys).size, keys.length)
    for (const k of ['STAFF_STEP_UP', 'REFUND_SAFETY_CHECKS', 'PAYMENT_DAILY_RECON', 'ORDER_RULE_CHECKS', 'STOCK_INTAKE_CHECKS', 'API_HARDENING', 'ENABLE_DEV_ROUTES', 'PANEL_FEATURE_SWITCHES']) {
      assert.ok(NEVER_FROM_PANEL.includes(k), k)
      assert.ok(!keys.includes(k), k)
    }
    for (const s of PANEL_SWITCHES) assert.ok(s.label && s.description, s.key)
  })

  test('off: 404, and a stored override changes nothing', async () => {
    assert.equal((await api.get('/admin/v1/settings/switches', { token: manager })).status, 404)
    assert.equal((await put('FAVOURITES', { enabled: true, confirmCode: 'manager123' })).status, 404)
    await query(`INSERT INTO feature_switches (key, enabled, updated_by, updated_at) VALUES ('FAVOURITES', TRUE, 'test', now())`)
    env.FAVOURITES = false
    assert.equal((await api.get('/v1/policy')).body.features.favourites, false)
  })

  test('managers only; a toggle asks for the password again even without STAFF_STEP_UP, and is audited', async () => {
    env.PANEL_FEATURE_SWITCHES = true
    env.STAFF_STEP_UP = false
    env.FAVOURITES = false
    const ops = await operatorToken()
    assert.equal((await api.get('/admin/v1/settings/switches', { token: ops })).status, 403)
    assert.equal((await put('FAVOURITES', { enabled: true, confirmCode: 'operator123' }, ops)).status, 403)
    const list = await api.get('/admin/v1/settings/switches', { token: manager })
    assert.equal(list.status, 200)
    const fav = list.body.items.find((s) => s.key === 'FAVOURITES')
    assert.deepEqual({ effective: fav.effective, override: fav.override, envValue: fav.envValue }, { effective: false, override: null, envValue: false })
    assert.ok(fav.description.length > 10)
    // Switches this build doesn't read yet are not offered. Every listed switch now ships, so one is
    // simulated: SHOP_LANGUAGES with its env entry removed, as in a build from before it existed.
    assert.equal(list.body.items.some((s) => s.key === 'SHOP_LANGUAGES'), true)
    const notYet = await withoutEnvKey('SHOP_LANGUAGES', async () => {
      assert.equal(knownSwitch('SHOP_LANGUAGES'), false)
      return api.get('/admin/v1/settings/switches', { token: manager })
    })
    assert.equal(notYet.status, 200)
    assert.equal(notYet.body.items.some((s) => s.key === 'SHOP_LANGUAGES'), false)
    assert.equal(notYet.body.items.some((s) => s.key === 'FAVOURITES'), true)

    const ask = await put('FAVOURITES', { enabled: true })
    assert.equal(ask.status, 403)
    assert.equal(ask.body.error.code, 'REAUTH_REQUIRED')
    const wrong = await put('FAVOURITES', { enabled: true, confirmCode: 'not-it' })
    assert.equal(wrong.body.error.code, 'REAUTH_FAILED')
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM feature_switches')).rows[0].n, 0)

    const on = await put('FAVOURITES', { enabled: true, confirmCode: 'manager123' })
    assert.equal(on.status, 200, JSON.stringify(on.body))
    assert.equal(on.body.effective, true)
    assert.equal(on.body.override, true)
    assert.equal(on.body.updatedBy, 'manager@mandimangoes.test')
    const [row] = await audits('feature_switch.set')
    assert.equal(row.target, 'FAVOURITES')
    assert.deepEqual(row.detail, { key: 'FAVOURITES', override: { from: null, to: true }, effectiveBefore: false })
    assert.equal(JSON.stringify(row.detail).includes('manager123'), false)

    // The shop sees the effective value, and the favourites routes open.
    assert.equal((await api.get('/v1/policy')).body.features.favourites, true)
    const cu = await customerToken(api)
    assert.equal((await api.get('/v1/me/favourites', { token: cu.accessToken })).status, 200)

    // Clearing the override goes back to the environment.
    assert.equal((await put('FAVOURITES', { enabled: null, confirmCode: 'manager123' })).body.effective, false)
    assert.equal((await api.get('/v1/policy')).body.features.favourites, false)
    assert.equal((await api.get('/v1/me/favourites', { token: cu.accessToken })).status, 404)
  })

  test('only allowlisted switches can be changed', async () => {
    env.PANEL_FEATURE_SWITCHES = true
    for (const key of ['REFUND_SAFETY_CHECKS', 'STAFF_STEP_UP', 'STOCK_INTAKE_CHECKS', 'PANEL_FEATURE_SWITCHES', 'WEB_PUSH', 'NOT_A_SWITCH', ...PANEL_SWITCHES.filter((s) => !knownSwitch(s.key)).map((s) => s.key)]) {
      const r = await put(key, { enabled: false, confirmCode: 'manager123' })
      assert.equal(r.status, 403, key)
      assert.equal(r.body.error.code, 'NOT_SWITCHABLE', key)
    }
    // A listed switch this build does not read (simulated, as every listed switch now ships) is refused too.
    const notYet = await withoutEnvKey('SHOP_LANGUAGES', () => put('SHOP_LANGUAGES', { enabled: true, confirmCode: 'manager123' }))
    assert.equal(notYet.status, 403)
    assert.equal(notYet.body.error.code, 'NOT_SWITCHABLE')
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM feature_switches')).rows[0].n, 0)
    // A row written straight into the table for a safeguard is ignored too.
    await query(`INSERT INTO feature_switches (key, enabled, updated_by, updated_at) VALUES ('STOCK_INTAKE_CHECKS', TRUE, 'test', now())`)
    forgetSwitches()
    env.STOCK_INTAKE_CHECKS = false
    assert.equal((await api.get('/v1/policy')).status, 200)
    assert.equal(isOn('STOCK_INTAKE_CHECKS'), false)
  })

  test('the environment is a ceiling: false there always wins; true there can be turned off', async () => {
    env.PANEL_FEATURE_SWITCHES = true
    process.env.FAVOURITES = 'false'
    env.FAVOURITES = false
    const r = await put('FAVOURITES', { enabled: true, confirmCode: 'manager123' })
    assert.equal(r.status, 409)
    assert.equal(r.body.error.code, 'ENV_KILL_SWITCH')
    // Even an override already stored (from before the kill switch was set) does nothing.
    await query(`INSERT INTO feature_switches (key, enabled, updated_by, updated_at) VALUES ('FAVOURITES', TRUE, 'test', now())`)
    forgetSwitches()
    assert.equal((await api.get('/v1/policy')).body.features.favourites, false)
    const listed = (await api.get('/admin/v1/settings/switches', { token: manager })).body.items.find((s) => s.key === 'FAVOURITES')
    assert.deepEqual({ killedByEnv: listed.killedByEnv, override: listed.override, effective: listed.effective }, { killedByEnv: true, override: true, effective: false })
    // Turning it off is still allowed.
    assert.equal((await put('FAVOURITES', { enabled: false, confirmCode: 'manager123' })).status, 200)

    // On in the environment: a manager may turn it off.
    process.env.SHOP_SORT_FILTER = 'true'
    env.SHOP_SORT_FILTER = true
    assert.equal((await api.get('/v1/policy')).body.features.sortFilter, true)
    assert.equal((await put('SHOP_SORT_FILTER', { enabled: false, confirmCode: 'manager123' })).body.effective, false)
    assert.equal((await api.get('/v1/policy')).body.features.sortFilter, false)
  })

  test('another instance sees a change within the 30-second cache', async () => {
    env.PANEL_FEATURE_SWITCHES = true
    env.LIVE_TRACKING = false
    assert.equal(SWITCH_CACHE_MS, 30_000)
    assert.equal((await api.get('/v1/policy')).body.features.tracking, false)
    // As if a manager saved it through another API instance: this one's cache doesn't know yet.
    await query(`INSERT INTO feature_switches (key, enabled, updated_by, updated_at) VALUES ('LIVE_TRACKING', TRUE, 'manager@mandimangoes.test', now())`)
    assert.equal((await api.get('/v1/policy')).body.features.tracking, false)
    setNow(new Date(Date.parse(T0) + SWITCH_CACHE_MS - 5_000))
    assert.equal((await api.get('/v1/policy')).body.features.tracking, false)
    setNow(new Date(Date.parse(T0) + SWITCH_CACHE_MS + 15_000))
    assert.equal((await api.get('/v1/policy')).body.features.tracking, true)
    // The panel's own flag for the riders' route view follows it too.
    const me = await api.get('/admin/v1/auth/me', { token: manager })
    assert.equal(me.body.features.riderRoute, true)
    assert.equal(me.body.features.panelSwitches, true)
  })
})
