// Warehouse and box traceability, end to end through the HTTP API: intake,
// labels, receiving, QC, put-away, picking against real paid orders, pack and
// dispatch, returns, holds, write-offs, recalls, shortfalls and cancellations.
// After each story the books are checked: the stock counters equal the
// sellable boxes, the ledger audit balances, and nothing is in an impossible state.
import { adminToken, checkout, client, closeAll, customerToken, resetDb, startServer, T0 } from './helpers.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, describe, test } from 'node:test'
import { addDays, setNow, todayIST } from '../src/clock.js'
import { query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'
import { auditLedger } from '../src/inventory.js'
import { sendDueNotifications } from '../src/notify.js'
import { reconciliation } from '../src/warehouse/reports.js'

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

const W = '/admin/v1/warehouse'
const ok = (r, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.body))
  return r.body
}
const pay = (orderId) => api.post('/v1/dev/pay', { orderId, outcome: 'captured' })
const loc = async (type) => (await query('SELECT * FROM wh_locations WHERE type = $1 ORDER BY created_at, id LIMIT 1', [type])).rows[0]
const tokensOf = async (lotId) => (await query('SELECT label_token, id, code FROM boxes WHERE lot_id = $1 ORDER BY seq', [lotId])).rows
const lineOf = async (lineId) => (await query('SELECT * FROM batch_lines WHERE id = $1', [lineId])).rows[0]
const orderRow = async (id) => (await query('SELECT * FROM orders WHERE id = $1', [id])).rows[0]
const box = async (id) => (await query('SELECT * FROM boxes WHERE id = $1', [id])).rows[0]

/** The books balance: counters = sellable boxes, ledger audit clean, no impossible states. */
async function booksBalance() {
  const r = await reconciliation({ query }, 'wh_main')
  assert.deepEqual(
    { stock: r.stockMismatches, units: r.orderUnitMismatches, states: r.impossibleStates, lots: r.lotCountMismatches, ledger: r.ledgerDrift },
    { stock: [], units: [], states: [], lots: [], ledger: [] },
  )
  assert.deepEqual(await tx((c) => auditLedger(c)), [])
  assert.equal(r.clean, true)
}

async function scan(opId, inputs, token = manager, extra = {}) {
  const r = await api.post(`${W}/operations/${opId}/scans`, { scans: inputs.map((input) => ({ scanId: randomUUID(), input, ...extra })) }, { token })
  return ok(r).results
}
const startOp = async (type, context, token = manager) => ok(await api.post(`${W}/operations`, { type, context }, { token }), 201)
const payload = (t) => `MMB1:${t}`

/** Turns tracking on for ALP-3 and receives `count` boxes, QC-passed and put away in storage. Returns { lot, boxes }. */
async function stockedLot({ count = 4, sku = 'ALP-3', harvestedAgo = 5, putAway = true, qc = true } = {}) {
  ok(await api.patch(`${W}/products/${sku}`, { boxTrackingEnabled: true, nominalWeightG: 3000 }, { token: manager }))
  const lot = ok(await api.post(`${W}/lots`, { sku, expectedCount: count, harvestedOn: addDays(todayIST(), -harvestedAgo), supplier: 'Ratnagiri Farms' }, { token: manager }), 201)
  // The batch's ripeness reading (existing batch QC) is what makes it sellable by date.
  ok(await api.post(`/admin/v1/batches/${lot.batchId}/qc`, { ripenessRating: 'SEMI_RIPE', condition: 'GOOD' }, { token: manager }), 201)
  const boxes = await tokensOf(lot.id)
  const rec = await startOp('receive', { lotId: lot.id })
  const res = await scan(rec.id, boxes.map((b) => payload(b.label_token)))
  assert.deepEqual(res.map((r) => r.result), boxes.map(() => 'accepted'))
  if (qc) ok(await api.post(`${W}/lots/${lot.id}/qc`, { result: 'passed' }, { token: manager }))
  if (putAway) ok(await api.post(`${W}/lots/${lot.id}/put-away`, { locationId: (await loc('storage')).id }, { token: manager }))
  return { lot, boxes }
}

async function paidOrder(qty, sku = 'ALP-3') {
  const cust = await customerToken(api)
  const c = await checkout(api, cust.accessToken, [{ sku, stage: 'RIPE', qty }])
  assert.equal(c.status, 201, JSON.stringify(c.body))
  ok(await pay(c.body.orderId))
  return { id: c.body.orderId, token: cust.accessToken }
}

describe('flag and access', () => {
  test('with WAREHOUSE_V2 off every warehouse path is a 404, even without signing in; products are untracked', async () => {
    env.WAREHOUSE_V2 = false
    try {
      assert.equal((await api.get(`${W}/overview`, { token: manager })).status, 404)
      assert.equal((await api.get(`${W}/overview`)).status, 404)
      assert.equal((await api.post(`${W}/lots`, {}, { token: manager })).status, 404)
      const me = ok(await api.get('/admin/v1/auth/me', { token: manager }))
      assert.deepEqual(me.warehouse, { enabled: false, permissions: [] })
    } finally {
      env.WAREHOUSE_V2 = true
    }
    const me = ok(await api.get('/admin/v1/auth/me', { token: manager }))
    assert.equal(me.warehouse.enabled, true)
  })

  test('roles: packers cannot take deliveries in, QC cannot pick, riders see nothing; manager-only actions refuse operators', async () => {
    const packer = await adminToken(api, 'packer@mandimangoes.test', 'packer123')
    const qcT = await adminToken(api, 'qc@mandimangoes.test', 'qc123')
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    const body = { sku: 'ALP-3', expectedCount: 2, harvestedOn: addDays(todayIST(), -3) }
    assert.equal((await api.post(`${W}/lots`, body, { token: packer })).status, 403)
    assert.equal((await api.post(`${W}/operations`, { type: 'pick', context: { orderId: 'x' } }, { token: qcT })).status, 403)
    assert.equal((await api.patch(`${W}/products/ALP-3`, { requiresQc: false }, { token: ops })).status, 403)
    assert.equal((await api.post(`${W}/locations`, { name: 'Bay 9', type: 'storage' }, { token: ops })).status, 403)
    assert.equal((await api.post(`${W}/recalls`, { lotIds: ['x'], reason: 'test' }, { token: ops })).status, 403)
    assert.equal((await api.get(`${W}/overview`, { token: packer })).status, 200)
  })
})

describe('intake and receiving', () => {
  test('a lot makes one box per label; a retried request with the same key returns the same lot', async () => {
    ok(await api.patch(`${W}/products/ALP-3`, { boxTrackingEnabled: true, nominalWeightG: 3000 }, { token: manager }))
    const body = { sku: 'ALP-3', expectedCount: 25, harvestedOn: addDays(todayIST(), -3) }
    const preview = ok(await api.post(`${W}/lots/preview`, body, { token: manager }))
    assert.equal(preview.totalKg, 75)
    assert.equal(preview.bestBefore, addDays(body.harvestedOn, 7))
    const headers = { 'Idempotency-Key': 'intake-test-0001' }
    const [a, b] = await Promise.all([api.post(`${W}/lots`, body, { token: manager, headers }), api.post(`${W}/lots`, body, { token: manager, headers })])
    assert.deepEqual([a.status, b.status].sort(), [200, 201])
    assert.equal(a.body.id, b.body.id)
    assert.equal(b.body.generatedCount, 25)
    assert.equal((await query('SELECT count(*)::int AS n FROM box_lots')).rows[0].n, 1)
    assert.equal((await query('SELECT count(*)::int AS n FROM boxes')).rows[0].n, 25)
    assert.equal((await query('SELECT count(DISTINCT code)::int AS n FROM boxes')).rows[0].n, 25)
    const reused = await api.post(`${W}/lots`, { ...body, expectedCount: 26 }, { token: manager, headers })
    assert.equal(reused.status, 422)
    assert.equal(reused.body.error.code, 'IDEMPOTENCY_KEY_REUSED')
    // A new lot never adds stock: nothing is received yet.
    assert.equal((await lineOf(a.body.lineId)).on_hand, 0)
    const pdf = await api.raw('GET', `${W}/lots/${a.body.id}/labels.pdf?from=1&to=10`, { token: manager })
    assert.equal(pdf.status, 200)
    assert.equal(pdf.headers.get('content-type'), 'application/pdf')
  })

  test('intake rules: future dates, fruit already too old, product with tracking off', async () => {
    const h = addDays(todayIST(), -3)
    let r = await api.post(`${W}/lots`, { sku: 'ALP-3', expectedCount: 2, harvestedOn: h, nominalWeightG: 3000 }, { token: manager })
    assert.equal(r.status, 400)
    assert.match(r.body.error.message, /Box tracking is off/)
    ok(await api.patch(`${W}/products/ALP-3`, { boxTrackingEnabled: true, nominalWeightG: 3000 }, { token: manager }))
    r = await api.post(`${W}/lots`, { sku: 'ALP-3', expectedCount: 2, harvestedOn: h, receivedOn: addDays(todayIST(), 1) }, { token: manager })
    assert.equal(r.status, 400)
    r = await api.post(`${W}/lots`, { sku: 'ALP-3', expectedCount: 2, harvestedOn: addDays(todayIST(), -9) }, { token: manager })
    assert.equal(r.status, 400)
    assert.match(r.body.error.message, /past its 7-day sale limit/)
    r = await api.post(`${W}/lots`, { sku: 'ALP-3', expectedCount: 0, harvestedOn: h }, { token: manager })
    assert.equal(r.status, 400)
  })

  test('receive scans: replayed scan ids, duplicates, wrong lot, unknown and revoked labels', async () => {
    const { lot } = await stockedLot({ count: 3, putAway: false, qc: false })
    const other = ok(await api.post(`${W}/lots`, { sku: 'ALP-3', expectedCount: 2, harvestedOn: addDays(todayIST(), -4) }, { token: manager }), 201)
    const [o1] = await tokensOf(other.id)
    const rec = await startOp('receive', { lotId: other.id })
    const scanId = randomUUID()
    const first = ok(await api.post(`${W}/operations/${rec.id}/scans`, { scans: [{ scanId, input: payload(o1.label_token) }] }, { token: manager })).results[0]
    const again = ok(await api.post(`${W}/operations/${rec.id}/scans`, { scans: [{ scanId, input: payload(o1.label_token) }] }, { token: manager })).results[0]
    assert.equal(first.result, 'accepted')
    assert.equal(again.result, 'accepted')
    assert.equal(again.replayed, true)
    assert.equal((await query(`SELECT count(*)::int AS n FROM box_events WHERE box_id = $1 AND type = 'RECEIVED'`, [o1.id])).rows[0].n, 1)
    const [lotBox] = await tokensOf(lot.id)
    const res = await scan(rec.id, [payload(o1.label_token), payload(lotBox.label_token), 'MMB1:' + '7'.repeat(26), 'not a label!', `MML1:${(await loc('storage')).label_token}`])
    assert.deepEqual(res.map((r) => r.code), ['ALREADY_SCANNED', 'WRONG_BATCH', 'UNKNOWN_CODE', 'MALFORMED_CODE', 'WRONG_LABEL_TYPE'])
    assert.equal(res[4].detail.location.type, 'storage')
    // A reissued label: the old one is refused as revoked, the new one works.
    const [, o2] = await tokensOf(other.id)
    ok(await api.post(`${W}/boxes/${o2.id}/reissue`, { reason: 'label torn' }, { token: manager }))
    const fresh = (await box(o2.id)).label_token
    const r2 = await scan(rec.id, [payload(o2.label_token), payload(fresh)])
    assert.deepEqual(r2.map((r) => r.code), ['LABEL_REVOKED', 'OK'])
    const lotNow = ok(await api.get(`${W}/lots/${other.id}`, { token: manager }))
    assert.equal(lotNow.status, 'received')
    assert.equal(lotNow.verifiedCount, 2)
    // Undo the last receive: the box is waiting again and the lot is receiving.
    ok(await api.post(`${W}/operations/${rec.id}/undo`, {}, { token: manager }))
    assert.equal((await box(o2.id)).lifecycle, 'generated')
    assert.equal(ok(await api.get(`${W}/lots/${other.id}`, { token: manager })).status, 'receiving')
    await booksBalance()
  })

  test('receiving, QC and put-away make stock sellable only when all three are done', async () => {
    const { lot, boxes } = await stockedLot({ count: 4, putAway: false, qc: false })
    assert.equal((await lineOf(lot.lineId)).on_hand, 0, 'received, but waiting for QC and in receiving')
    ok(await api.post(`${W}/lots/${lot.id}/qc`, { result: 'passed', exceptBoxIds: [boxes[3].id] }, { token: manager }))
    assert.equal((await lineOf(lot.lineId)).on_hand, 0, 'QC passed but still in receiving')
    const moved = ok(await api.post(`${W}/lots/${lot.id}/put-away`, { locationId: (await loc('storage')).id }, { token: manager }))
    assert.equal(moved.moved, 3)
    assert.equal(moved.skipped.length, 1, 'the box still waiting for QC cannot go to storage')
    assert.equal((await lineOf(lot.lineId)).on_hand, 3)
    // QC fail the 4th box with a reason; a failed box can only go to QC hold.
    const qcOp = await startOp('qc', { result: 'failed', reasonCodes: ['BRUISED'] })
    assert.equal((await scan(qcOp.id, [payload(boxes[3].label_token)]))[0].result, 'accepted')
    const mv = await startOp('move', { locationId: (await loc('storage')).id })
    assert.equal((await scan(mv.id, [payload(boxes[3].label_token)]))[0].code, 'LOCATION_TYPE_NOT_ALLOWED')
    await booksBalance()
    const ov = ok(await api.get(`${W}/overview`, { token: manager }))
    assert.equal(ov.boxes.sellable, 3)
  })
})

describe('orders', () => {
  test('pick, pack and dispatch by scan: the order moves on, the counters follow, and the books balance', async () => {
    const { lot, boxes } = await stockedLot({ count: 4 })
    const o = await paidOrder(2)
    assert.equal((await lineOf(lot.lineId)).committed, 2)
    // The old buttons refuse labelled stock.
    const alloc = await api.post(`/admin/v1/orders/${o.id}/allocate`, {}, { token: manager })
    assert.equal(alloc.body.error.code, 'PICK_BY_SCAN')
    const list = ok(await api.get(`${W}/orders/${o.id}/pick-list`, { token: manager }))
    assert.equal(list.items[0].toPick, 2)
    assert.equal(list.items[0].suggestions[0].boxes.length, 2)
    const queue = ok(await api.get(`${W}/pick-queue`, { token: manager }))
    assert.equal(queue[0].orderId, o.id)

    const pick = await startOp('pick', { orderId: o.id })
    const res = await scan(pick.id, [payload(boxes[0].label_token), payload(boxes[1].label_token), payload(boxes[2].label_token)])
    assert.deepEqual(res.map((r) => r.code), ['OK', 'OK', 'LINE_ALREADY_FULFILLED'])
    assert.equal((await orderRow(o.id)).status, 'PROCESSING')
    const l = await lineOf(lot.lineId)
    assert.deepEqual([l.on_hand, l.committed], [2, 0])
    await booksBalance()

    // PACKED from the order page is refused until the boxes are packed by scan.
    const early = await api.patch(`/admin/v1/orders/${o.id}/status`, { status: 'PACKED' }, { token: manager })
    assert.equal(early.body.error.code, 'PACK_BY_SCAN')
    const packOp = await startOp('pack', { orderId: o.id })
    await scan(packOp.id, [payload(boxes[0].label_token)])
    const incomplete = await api.post(`${W}/operations/${packOp.id}/finalize`, {}, { token: manager })
    assert.equal(incomplete.body.error.code, 'INCOMPLETE_SET')
    assert.equal((await scan(packOp.id, [payload(boxes[3].label_token)]))[0].code, 'NOT_PICKED')
    await scan(packOp.id, [payload(boxes[1].label_token)])
    const packed = ok(await api.post(`${W}/operations/${packOp.id}/finalize`, {}, { token: manager }))
    assert.equal(packed.result.status, 'PACKED')
    // Finalizing again returns the same result and changes nothing.
    assert.equal(ok(await api.post(`${W}/operations/${packOp.id}/finalize`, {}, { token: manager })).replayed, true)
    assert.equal((await orderRow(o.id)).status, 'PACKED')

    const ship = await api.post(`/admin/v1/orders/${o.id}/dispatch`, {}, { token: manager })
    assert.equal(ship.body.error.code, 'DISPATCH_BY_SCAN')
    const disp = await startOp('dispatch', { orderId: o.id })
    await scan(disp.id, [payload(boxes[0].label_token), payload(boxes[1].label_token)])
    ok(await api.post(`${W}/operations/${disp.id}/finalize`, {}, { token: manager }))
    assert.equal((await orderRow(o.id)).status, 'SHIPPED')
    assert.equal((await box(boxes[0].id)).lifecycle, 'dispatched')
    // The rider flow carries on from SHIPPED as before.
    ok(await api.post(`/admin/v1/orders/${o.id}/dispatch`, {}, { token: manager }), 204)
    assert.equal((await orderRow(o.id)).status, 'OUT_FOR_DELIVERY')
    await booksBalance()

    const trace = ok(await api.get(`${W}/trace/lots/${lot.id}`, { token: manager }))
    assert.equal(trace.byState.dispatched, 2)
    assert.equal(trace.orders[0].number, (await orderRow(o.id)).number)
    assert.equal(trace.orders[0].phone !== undefined, true, 'managers see the customer for a recall')
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    const opsTrace = ok(await api.get(`${W}/trace/lots/${lot.id}`, { token: ops }))
    assert.equal(opsTrace.orders[0].phone, undefined, 'operators do not')
    const events = ok(await api.get(`${W}/boxes/${boxes[0].id}/events`, { token: manager }))
    assert.deepEqual(events.map((e) => e.type).reverse(), ['GENERATED', 'RECEIVED', 'QC_PASSED', 'HOLD_RELEASED', 'MOVED', 'PICKED', 'PACKED', 'DISPATCHED'])
  })

  test('an unpaid order cannot be picked (D12)', async () => {
    await stockedLot({ count: 2 })
    const cust = await customerToken(api)
    const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
    const r = await api.post(`${W}/operations`, { type: 'pick', context: { orderId: c.body.orderId } }, { token: manager })
    assert.equal(r.status, 409)
    assert.equal(r.body.error.code, 'INVALID_TRANSITION')
  })

  test('a box from another batch than the one reserved needs a reason (D5), and the reservation moves with it', async () => {
    const a = await stockedLot({ count: 2, harvestedAgo: 5 })
    const b = await stockedLot({ count: 2, harvestedAgo: 5 })
    const o = await paidOrder(1)
    const reserved = (await query(`SELECT line_id FROM order_stock WHERE order_id = $1 AND state = 'committed'`, [o.id])).rows[0].line_id
    const other = reserved === a.lot.lineId ? b : a
    const pick = await startOp('pick', { orderId: o.id })
    const first = await scan(pick.id, [payload(other.boxes[0].label_token)])
    assert.equal(first[0].code, 'NON_FEFO')
    assert.equal(first[0].result, 'rejected')
    assert.equal(first[0].detail.needsReason, true)
    const withReason = await scan(pick.id, [payload(other.boxes[0].label_token)], manager, { reason: 'Reserved stack is behind a pallet' })
    assert.equal(withReason[0].result, 'warning')
    assert.equal((await box(other.boxes[0].id)).lifecycle, 'picked')
    assert.equal((await lineOf(reserved)).committed, 0)
    await booksBalance()
  })

  test('two packers racing for the same box: one gets it, the other is told it is taken', async () => {
    const { boxes } = await stockedLot({ count: 2 })
    const o1 = await paidOrder(1)
    const o2 = await paidOrder(1)
    const p1 = await startOp('pick', { orderId: o1.id })
    const p2 = await startOp('pick', { orderId: o2.id })
    const [r1, r2] = await Promise.all([scan(p1.id, [payload(boxes[0].label_token)]), scan(p2.id, [payload(boxes[0].label_token)])])
    const codes = [r1[0].code, r2[0].code].sort()
    assert.deepEqual(codes, ['ALLOCATED_TO_OTHER_ORDER', 'OK'])
    assert.equal((await query(`SELECT count(*)::int AS n FROM box_events WHERE box_id = $1 AND type = 'PICKED'`, [boxes[0].id])).rows[0].n, 1)
    await booksBalance()
  })

  test('cancelling a picked order unbinds its boxes to pick staging; putting them away makes them stock again', async () => {
    const { lot, boxes } = await stockedLot({ count: 3 })
    const o = await paidOrder(2)
    const pick = await startOp('pick', { orderId: o.id })
    await scan(pick.id, [payload(boxes[0].label_token), payload(boxes[1].label_token)])
    assert.equal((await lineOf(lot.lineId)).on_hand, 1)
    const cancel = await api.post(`/admin/v1/orders/${o.id}/cancel`, { reason: 'customer asked', refund: true }, { token: manager })
    assert.equal(cancel.status, 204, JSON.stringify(cancel.body))
    const b0 = await box(boxes[0].id)
    assert.equal(b0.lifecycle, 'in_stock')
    assert.equal(b0.order_id, null)
    assert.equal(b0.location_id, (await loc('pick_staging')).id)
    assert.equal((await lineOf(lot.lineId)).on_hand, 1, 'boxes at pick staging are not shelf stock')
    await booksBalance()
    const ex = ok(await api.get(`${W}/exceptions`, { token: manager }))
    assert.equal(ex.boxesToPutAway.length, 0, 'not yet stale')
    const mv = await startOp('move', { locationId: (await loc('storage')).id })
    await scan(mv.id, [payload(boxes[0].label_token), payload(boxes[1].label_token)])
    assert.equal((await lineOf(lot.lineId)).on_hand, 3)
    await booksBalance()
  })

  test('unpick takes a box off an order and the order reserves another', async () => {
    const { lot, boxes } = await stockedLot({ count: 3 })
    const o = await paidOrder(1)
    const pick = await startOp('pick', { orderId: o.id })
    await scan(pick.id, [payload(boxes[0].label_token)])
    const un = await startOp('unpick', { orderId: o.id, reason: 'Bruise found at packing' })
    assert.equal((await scan(un.id, [payload(boxes[0].label_token)]))[0].result, 'accepted')
    assert.equal((await box(boxes[0].id)).lifecycle, 'in_stock')
    const l = await lineOf(lot.lineId)
    assert.deepEqual([l.on_hand, l.committed], [2, 1])
    await booksBalance()
  })

  test('unpicking a box off a packed order reopens it (PACKED to PROCESSING), a move the order map allows', async () => {
    const { boxes } = await stockedLot({ count: 3 })
    const o = await paidOrder(1)
    const pick = await startOp('pick', { orderId: o.id })
    await scan(pick.id, [payload(boxes[0].label_token)])
    const pk = await startOp('pack', { orderId: o.id })
    await scan(pk.id, [payload(boxes[0].label_token)])
    ok(await api.post(`${W}/operations/${pk.id}/finalize`, {}, { token: manager }))
    assert.equal((await orderRow(o.id)).status, 'PACKED')
    const un = await startOp('unpick', { orderId: o.id, reason: 'Bruise found before dispatch' })
    assert.equal((await scan(un.id, [payload(boxes[0].label_token)]))[0].result, 'accepted')
    assert.equal((await orderRow(o.id)).status, 'PROCESSING')
    const ev = (await query(`SELECT from_status, status, reason FROM order_events WHERE order_id = $1 ORDER BY created_at DESC, id DESC LIMIT 5`, [o.id])).rows
    assert.ok(ev.some((e) => e.from_status === 'PACKED' && e.status === 'PROCESSING' && /Reopened in the warehouse/.test(e.reason)))
    await booksBalance()
  })

  test('a QC failure of promised stock flags the youngest order at risk, and the books still balance', async () => {
    const { lot, boxes } = await stockedLot({ count: 2 })
    const o = await paidOrder(2)
    const qcOp = await startOp('qc', { result: 'failed', reasonCodes: ['MOULD'] })
    const r = await scan(qcOp.id, [payload(boxes[0].label_token)])
    assert.equal(r[0].result, 'accepted')
    assert.ok(r[0].detail.shortfall.atRisk.length || r[0].detail.shortfall.moved.length)
    assert.equal((await lineOf(lot.lineId)).on_hand, 1)
    const ord = await orderRow(o.id)
    assert.ok(ord.at_risk || ord.delivery_date !== addDays(todayIST(), 1))
    await booksBalance()
  })

  test('a returned box is booked against its order, held, and never counted as stock (D7)', async () => {
    const { lot, boxes } = await stockedLot({ count: 2 })
    const o = await paidOrder(1)
    const pick = await startOp('pick', { orderId: o.id })
    await scan(pick.id, [payload(boxes[0].label_token)])
    const pk = await startOp('pack', { orderId: o.id })
    await scan(pk.id, [payload(boxes[0].label_token)])
    ok(await api.post(`${W}/operations/${pk.id}/finalize`, {}, { token: manager }))
    const ds = await startOp('dispatch', { orderId: o.id })
    await scan(ds.id, [payload(boxes[0].label_token)])
    ok(await api.post(`${W}/operations/${ds.id}/finalize`, {}, { token: manager }))
    const ret = await startOp('return', { orderId: o.id, reason: 'Customer refused' })
    const r = await scan(ret.id, [payload(boxes[0].label_token), payload(boxes[1].label_token)])
    assert.deepEqual(r.map((x) => x.code), ['OK', 'INVALID_TRANSITION'])
    const b0 = await box(boxes[0].id)
    assert.equal(b0.lifecycle, 'returned')
    assert.equal((await lineOf(lot.lineId)).on_hand, 1)
    const restock = await api.post(`${W}/boxes/${boxes[0].id}/restock`, { reason: 'looks fine' }, { token: manager })
    assert.equal(restock.body.error.code, 'RETURNS_NOT_RESTOCKABLE')
    await booksBalance()
  })

  test('expiry is read at midnight IST: a box past its best-before cannot be picked', async () => {
    const { boxes } = await stockedLot({ count: 2, harvestedAgo: 5 })
    const o = await paidOrder(1)
    const bb = (await box(boxes[0].id)).best_before
    setNow(`${addDays(bb, 1)}T00:05:00+05:30`)
    try {
      const pick = await startOp('pick', { orderId: o.id })
      const r = await scan(pick.id, [payload(boxes[0].label_token)])
      assert.equal(r[0].code, 'EXPIRED')
    } finally {
      setNow(T0)
    }
  })
})

describe('dispatch and messages', () => {
  test('a dispatch that cannot go rolls back whole; messages go out only after a committed hand-over, through the stubbed sender', async () => {
    const { boxes } = await stockedLot({ count: 2 })
    const o = await paidOrder(1)
    const pick = await startOp('pick', { orderId: o.id })
    await scan(pick.id, [payload(boxes[0].label_token)])
    const pk = await startOp('pack', { orderId: o.id })
    await scan(pk.id, [payload(boxes[0].label_token)])
    ok(await api.post(`${W}/operations/${pk.id}/finalize`, {}, { token: manager }))
    // Make the packed box too old for the order's date: SHIPPED must refuse it.
    const date = (await orderRow(o.id)).delivery_date
    await query('UPDATE orders SET delivery_date = $2 WHERE id = $1', [o.id, addDays(date, 20)])
    const ds = await startOp('dispatch', { orderId: o.id })
    await scan(ds.id, [payload(boxes[0].label_token)])
    const sent = []
    const stub = async (m) => {
      sent.push(m.template)
      return `wamid.${sent.length}`
    }
    await sendDueNotifications({ sender: stub })
    sent.length = 0
    const refused = await api.post(`${W}/operations/${ds.id}/finalize`, {}, { token: manager })
    assert.equal(refused.status, 409)
    assert.equal(refused.body.error.code, 'AT_RISK')
    assert.equal((await box(boxes[0].id)).lifecycle, 'packed', 'nothing was dispatched')
    assert.equal((await orderRow(o.id)).status, 'PACKED')
    assert.equal(await sendDueNotifications({ sender: stub }), 0)
    assert.deepEqual(sent, [])
    await query('UPDATE orders SET delivery_date = $2, at_risk = FALSE, at_risk_reason = NULL WHERE id = $1', [o.id, date])
    ok(await api.post(`${W}/operations/${ds.id}/finalize`, {}, { token: manager }))
    ok(await api.post(`/admin/v1/orders/${o.id}/dispatch`, {}, { token: manager }), 204)
    assert.equal(await sendDueNotifications({ sender: stub }), 1)
    assert.equal(sent.length, 1)
    assert.match(sent[0], /out_for_delivery/)
    await booksBalance()
  })
})

describe('controls', () => {
  test('box history is append-only', async () => {
    const { boxes } = await stockedLot({ count: 1, putAway: false, qc: false })
    await assert.rejects(query(`UPDATE box_events SET reason = 'edited' WHERE box_id = $1`, [boxes[0].id]), /append-only/)
    await assert.rejects(query('DELETE FROM box_events WHERE box_id = $1', [boxes[0].id]), /append-only/)
    await assert.rejects(query('TRUNCATE box_events CASCADE'), /append-only/)
  })

  test('a big write-off waits for a second person; nobody approves their own (D8)', async () => {
    const { lot, boxes } = await stockedLot({ count: 12 })
    await query(`INSERT INTO admin_users (id, email, password_hash, role) SELECT 'adm_second', 'second@mandimangoes.test', password_hash, 'MANAGER' FROM admin_users WHERE email = 'manager@mandimangoes.test'`)
    const second = await adminToken(api, 'second@mandimangoes.test', 'manager123')
    const small = ok(await api.post(`${W}/write-offs`, { boxIds: [boxes[0].id], reasonCode: 'damaged', reason: 'crushed' }, { token: manager }))
    assert.equal(small.status, 'applied')
    assert.equal((await lineOf(lot.lineId)).on_hand, 11)
    const big = ok(await api.post(`${W}/write-offs`, { boxIds: boxes.slice(1).map((b) => b.id), reasonCode: 'spoiled', reason: 'cold room failed' }, { token: manager }), 202)
    assert.equal(big.status, 'pending')
    assert.equal((await lineOf(lot.lineId)).on_hand, 11)
    const self = await api.post(`${W}/write-offs/${big.id}/approve`, {}, { token: manager })
    assert.equal(self.body.error.code, 'SELF_APPROVAL')
    ok(await api.post(`${W}/write-offs/${big.id}/approve`, {}, { token: second }))
    assert.equal((await lineOf(lot.lineId)).on_hand, 0)
    await booksBalance()
  })

  test('a recall holds every box of the lot still here, lists where the rest went, and releases only its own holds', async () => {
    const { lot, boxes } = await stockedLot({ count: 3 })
    ok(await api.post(`${W}/boxes/${boxes[2].id}/holds`, { kind: 'damage_hold', reason: 'dented' }, { token: manager }))
    const rc = ok(await api.post(`${W}/recalls`, { lotIds: [lot.id], reason: 'Supplier pesticide notice' }, { token: manager }), 201)
    assert.equal(rc.held, 3)
    assert.equal((await lineOf(lot.lineId)).on_hand, 0)
    const pickable = await query('SELECT count(*)::int AS n FROM boxes b WHERE b.lot_id = $1 AND box_pickable(b.id, $2)', [lot.id, todayIST()])
    assert.equal(pickable.rows[0].n, 0)
    ok(await api.post(`${W}/recalls/${rc.id}/release`, { reason: 'Lab test clear' }, { token: manager }))
    assert.equal((await lineOf(lot.lineId)).on_hand, 2, 'the damage hold stays')
    await booksBalance()
  })

  test('another warehouse cannot see or scan these boxes', async () => {
    const { boxes } = await stockedLot({ count: 1 })
    await query(`INSERT INTO warehouses (id, name) VALUES ('wh_two', 'Second')`)
    await query(`UPDATE admin_users SET warehouse_id = 'wh_two' WHERE email = 'ops@mandimangoes.test'`)
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    assert.equal((await api.get(`${W}/boxes/${boxes[0].id}`, { token: ops })).status, 404)
    const r = ok(await api.post(`${W}/resolve`, { input: payload(boxes[0].label_token) }, { token: ops }))
    assert.equal(r.code, 'UNKNOWN_CODE')
  })

  test('tracking can only be turned on when the stock matches its labelled boxes', async () => {
    const id = newId('bat')
    await query(`INSERT INTO batches (id, variety, plucked_on, status, eta_date, arrived_at) VALUES ($1, 'Alphonso', $2, 'SELLING', $2, now())`, [id, addDays(todayIST(), -3)])
    await query(`INSERT INTO batch_lines (id, batch_id, sku, on_hand) VALUES ($1, $2, 'ALP-3', 5)`, [newId('bl'), id])
    const r = await api.patch(`${W}/products/ALP-3`, { boxTrackingEnabled: true }, { token: manager })
    assert.equal(r.status, 409)
    assert.equal(r.body.error.code, 'RECONCILIATION_NEEDED')
  })

  test('CSV export escapes formula-looking cells', async () => {
    ok(await api.patch(`${W}/products/ALP-3`, { boxTrackingEnabled: true, nominalWeightG: 3000 }, { token: manager }))
    ok(await api.post(`${W}/lots`, { sku: 'ALP-3', expectedCount: 1, harvestedOn: addDays(todayIST(), -3), supplier: '=HYPERLINK("http://x")' }, { token: manager }), 201)
    const r = await api.raw('GET', `${W}/export/lots`, { token: manager })
    assert.equal(r.status, 200)
    assert.match(r.body, /"'=HYPERLINK\(""http:\/\/x""\)"/)
  })

  test('each CSV export is written to the staff audit, like the managers\' exports', async () => {
    assert.equal((await api.raw('GET', `${W}/export/events?from=2026-10-01&to=2026-10-15`, { token: manager })).status, 200)
    assert.equal((await api.raw('GET', `${W}/export/boxes`, { token: manager })).status, 200)
    const { rows } = await query(`SELECT action, target, email, detail FROM staff_audit WHERE action LIKE 'EXPORT warehouse-%' ORDER BY created_at, id`)
    assert.deepEqual(rows.map((x) => [x.action, x.target, x.email]), [
      ['EXPORT warehouse-events', 'warehouse-events', 'manager@mandimangoes.test'],
      ['EXPORT warehouse-boxes', 'warehouse-boxes', 'manager@mandimangoes.test'],
    ])
    assert.deepEqual(rows[0].detail, { warehouseId: 'wh_main', from: '2026-10-01', to: '2026-10-15' })
  })
})
