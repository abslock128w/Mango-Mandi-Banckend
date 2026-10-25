// Warehouse checks for the done list (docs/warehouse/PROGRESS.md): receipt
// verification without deletion, the reprint limit, idle sessions, racing
// pack and dispatch, and cancelling an order at every stage.
// Every story ends with the books checked (stock = sellable boxes, ledger clean).
import { adminToken, checkout, client, closeAll, customerToken, resetDb, startServer, T0 } from './helpers.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, describe, test } from 'node:test'
import { addDays, now, setNow, todayIST } from '../src/clock.js'
import { query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { auditLedger } from '../src/inventory.js'
import { expireIdleOperations } from '../src/warehouse/ops.js'
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
const loc = async (type) => (await query('SELECT * FROM wh_locations WHERE type = $1 ORDER BY created_at, id LIMIT 1', [type])).rows[0]
const tokensOf = async (lotId) => (await query('SELECT label_token, id, code FROM boxes WHERE lot_id = $1 ORDER BY seq', [lotId])).rows
const lineOf = async (lineId) => (await query('SELECT * FROM batch_lines WHERE id = $1', [lineId])).rows[0]
const orderRow = async (id) => (await query('SELECT * FROM orders WHERE id = $1', [id])).rows[0]
const box = async (id) => (await query('SELECT * FROM boxes WHERE id = $1', [id])).rows[0]
const payload = (t) => `MMB1:${t}`
const eventCount = async (boxId, type) => (await query('SELECT count(*)::int AS n FROM box_events WHERE box_id = $1 AND type = $2', [boxId, type])).rows[0].n

async function booksBalance() {
  const r = await reconciliation({ query }, 'wh_main')
  assert.deepEqual(
    { stock: r.stockMismatches, units: r.orderUnitMismatches, states: r.impossibleStates, lots: r.lotCountMismatches, ledger: r.ledgerDrift },
    { stock: [], units: [], states: [], lots: [], ledger: [] },
  )
  assert.deepEqual(await tx((c) => auditLedger(c)), [])
  assert.equal(r.clean, true)
}

async function scan(opId, inputs, token = manager) {
  const r = await api.post(`${W}/operations/${opId}/scans`, { scans: inputs.map((input) => ({ scanId: randomUUID(), input })) }, { token })
  return ok(r).results
}
const startOp = async (type, context, token = manager) => ok(await api.post(`${W}/operations`, { type, context }, { token }), 201)
const finalize = (opId, token = manager) => api.post(`${W}/operations/${opId}/finalize`, {}, { token })

async function newLot(count) {
  ok(await api.patch(`${W}/products/ALP-3`, { boxTrackingEnabled: true, nominalWeightG: 3000 }, { token: manager }))
  const lot = ok(await api.post(`${W}/lots`, { sku: 'ALP-3', expectedCount: count, harvestedOn: addDays(todayIST(), -5) }, { token: manager }), 201)
  ok(await api.post(`/admin/v1/batches/${lot.batchId}/qc`, { ripenessRating: 'SEMI_RIPE', condition: 'GOOD' }, { token: manager }), 201)
  return lot
}

async function stockedLot(count) {
  const lot = await newLot(count)
  const boxes = await tokensOf(lot.id)
  const rec = await startOp('receive', { lotId: lot.id })
  await scan(rec.id, boxes.map((b) => payload(b.label_token)))
  ok(await api.post(`${W}/lots/${lot.id}/qc`, { result: 'passed' }, { token: manager }))
  ok(await api.post(`${W}/lots/${lot.id}/put-away`, { locationId: (await loc('storage')).id }, { token: manager }))
  return { lot, boxes }
}

async function paidOrder(qty) {
  const cust = await customerToken(api)
  const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty }])
  assert.equal(c.status, 201, JSON.stringify(c.body))
  ok(await api.post('/v1/dev/pay', { orderId: c.body.orderId, outcome: 'captured' }))
  return c.body.orderId
}

const pickAll = async (orderId, boxes) => scan((await startOp('pick', { orderId })).id, boxes.map((b) => payload(b.label_token)))
async function packAll(orderId, boxes) {
  const op = await startOp('pack', { orderId })
  await scan(op.id, boxes.map((b) => payload(b.label_token)))
  ok(await finalize(op.id))
}
async function dispatchAll(orderId, boxes) {
  const op = await startOp('dispatch', { orderId })
  await scan(op.id, boxes.map((b) => payload(b.label_token)))
  ok(await finalize(op.id))
}
const cancel = (orderId) => api.post(`/admin/v1/orders/${orderId}/cancel`, { reason: 'test cancel', refund: true }, { token: manager })

describe('receipt verification', () => {
  test('scanned, count-confirmed and voided boxes stay apart, and nothing is deleted', async () => {
    const lot = await newLot(5)
    const boxes = await tokensOf(lot.id)
    const rec = await startOp('receive', { lotId: lot.id })
    await scan(rec.id, [payload(boxes[0].label_token), payload(boxes[1].label_token)])
    // One more box came than labelled: extend the lot, then count-confirm two without scanning.
    const extended = ok(await api.post(`${W}/lots/${lot.id}/add-boxes`, { count: 1, reason: 'one extra on the truck' }, { token: manager }))
    assert.equal(extended.targetCount, 6)
    ok(await api.post(`${W}/lots/${lot.id}/confirm-count`, { count: 2, reason: 'counted on the pallet' }, { token: manager }))
    const early = await api.post(`${W}/lots/${lot.id}/close`, {}, { token: manager })
    assert.equal(early.body.error.code, 'INCOMPLETE_SET', 'two boxes are still waiting')
    // Two never arrived: void them. Their labels are revoked, the rows stay.
    const voided = ok(await api.post(`${W}/lots/${lot.id}/void-boxes`, { count: 2, reason: 'short delivery' }, { token: manager }))
    assert.equal(voided.status, 'received')
    const rows = (await query('SELECT seq, lifecycle, verification FROM boxes WHERE lot_id = $1 ORDER BY seq', [lot.id])).rows
    assert.equal(rows.length, 6)
    assert.deepEqual(rows.map((r) => r.verification), ['scanned', 'scanned', 'count_confirmed', 'count_confirmed', null, null])
    assert.deepEqual(rows.map((r) => r.lifecycle), ['in_stock', 'in_stock', 'in_stock', 'in_stock', 'voided', 'voided'])
    const v = (await tokensOf(lot.id))[5]
    const late = await scan(rec.id, [payload(v.label_token)])
    assert.equal(late[0].code, 'LABEL_REVOKED')
    const closed = ok(await api.post(`${W}/lots/${lot.id}/close`, {}, { token: manager }))
    assert.equal(closed.status, 'closed')
    assert.deepEqual([closed.verifiedCount, closed.voidedCount], [4, 2])
    assert.equal((await api.post(`${W}/lots/${lot.id}/add-boxes`, { count: 1, reason: 'late' }, { token: manager })).body.error.code, 'INVALID_TRANSITION')
    // A received box cannot be voided: it is written off instead.
    const refused = await api.post(`${W}/lots/${lot.id}/void-boxes`, { boxIds: [boxes[0].id], reason: 'oops' }, { token: manager })
    assert.equal(refused.body.error.code, 'INVALID_TRANSITION')
    await booksBalance()
  })
})

describe('labels', () => {
  test('three free reprints, then a supervisor; reissue needs labels.reissue', async () => {
    const lot = await newLot(1)
    const [b] = await tokensOf(lot.id)
    const qc = await adminToken(api, 'qc@mandimangoes.test', 'qc123')
    for (let i = 1; i <= 3; i++) assert.equal(ok(await api.post(`${W}/boxes/${b.id}/reprint`, { reason: 'smudged' }, { token: qc })).reprintCount, i)
    const fourth = await api.post(`${W}/boxes/${b.id}/reprint`, { reason: 'smudged' }, { token: qc })
    assert.equal(fourth.status, 403)
    assert.equal(fourth.body.error.code, 'SUPERVISOR_REQUIRED')
    assert.equal(ok(await api.post(`${W}/boxes/${b.id}/reprint`, { reason: 'smudged' }, { token: manager })).reprintCount, 4)
    assert.equal((await box(b.id)).label_token, b.label_token, 'a reprint keeps the same label')
    assert.equal((await api.post(`${W}/boxes/${b.id}/reissue`, { reason: 'torn' }, { token: qc })).status, 403)
    assert.equal(await eventCount(b.id, 'LABEL_REPRINTED'), 4)
  })
})

describe('idle sessions', () => {
  test('an idle session closes: its scans are refused and stored, and a staged set is dropped so someone else can pack', async () => {
    const { boxes } = await stockedLot(2)
    const orderId = await paidOrder(1)
    await pickAll(orderId, [boxes[0]])
    const pack = await startOp('pack', { orderId })
    await scan(pack.id, [payload(boxes[0].label_token)])
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    const locked = await api.post(`${W}/operations`, { type: 'pack', context: { orderId } }, { token: ops })
    assert.equal(locked.body.error.code, 'OPERATION_LOCKED')
    setNow(new Date(now().getTime() + (env.WAREHOUSE_OP_IDLE_MINUTES + 1) * 60_000).toISOString())
    try {
      assert.ok((await tx((c) => expireIdleOperations(c))) >= 1, 'the maintenance step closes idle sessions')
      const late = await scan(pack.id, [payload(boxes[0].label_token)])
      assert.equal(late[0].code, 'OPERATION_CLOSED')
      assert.equal((await query('SELECT count(*)::int AS n FROM wh_scans WHERE operation_id = $1', [pack.id])).rows[0].n, 2, 'the late scan is kept')
      assert.equal((await query('SELECT count(*)::int AS n FROM wh_staged WHERE operation_id = $1', [pack.id])).rows[0].n, 0)
      assert.equal((await finalize(pack.id)).body.error.code, 'OPERATION_CLOSED')
      const theirs = await startOp('pack', { orderId }, ops)
      await scan(theirs.id, [payload(boxes[0].label_token)], ops)
      ok(await finalize(theirs.id, ops))
      assert.equal((await orderRow(orderId)).status, 'PACKED')
    } finally {
      setNow(T0)
    }
    await booksBalance()
  })
})

describe('races', () => {
  test('two finalizes of one pack or dispatch session apply once', async () => {
    const { boxes } = await stockedLot(2)
    const orderId = await paidOrder(2)
    await pickAll(orderId, boxes)
    const pack = await startOp('pack', { orderId })
    await scan(pack.id, boxes.map((b) => payload(b.label_token)))
    const packs = await Promise.all([finalize(pack.id), finalize(pack.id)])
    assert.deepEqual(packs.map((r) => r.status), [200, 200])
    assert.deepEqual(packs.map((r) => Boolean(r.body.replayed)).sort(), [false, true])
    const disp = await startOp('dispatch', { orderId })
    await scan(disp.id, boxes.map((b) => payload(b.label_token)))
    const ships = await Promise.all([finalize(disp.id), finalize(disp.id)])
    assert.deepEqual(ships.map((r) => r.status), [200, 200])
    for (const b of boxes) {
      assert.equal(await eventCount(b.id, 'PACKED'), 1)
      assert.equal(await eventCount(b.id, 'DISPATCHED'), 1)
    }
    const shipped = (await query(`SELECT count(*)::int AS n FROM order_events WHERE order_id = $1 AND status = 'SHIPPED'`, [orderId])).rows[0].n
    assert.equal(shipped, 1)
    await booksBalance()
  })

  test('two people starting to dispatch the same order: one session, the other is told it is taken', async () => {
    const { boxes } = await stockedLot(1)
    const orderId = await paidOrder(1)
    await pickAll(orderId, boxes)
    await packAll(orderId, boxes)
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    const [a, b] = await Promise.all([
      api.post(`${W}/operations`, { type: 'dispatch', context: { orderId } }, { token: manager }),
      api.post(`${W}/operations`, { type: 'dispatch', context: { orderId } }, { token: ops }),
    ])
    assert.deepEqual([a.status, b.status].sort(), [201, 409])
    assert.equal([a, b].find((r) => r.status === 409).body.error.code, 'OPERATION_LOCKED')
    assert.equal((await query(`SELECT count(*)::int AS n FROM wh_operations WHERE order_id = $1 AND type = 'dispatch' AND status = 'open'`, [orderId])).rows[0].n, 1)
  })

  test('the same box scanned twice at once in a dispatch session counts once', async () => {
    const { boxes } = await stockedLot(1)
    const orderId = await paidOrder(1)
    await pickAll(orderId, boxes)
    await packAll(orderId, boxes)
    const disp = await startOp('dispatch', { orderId })
    const [r1, r2] = await Promise.all([scan(disp.id, [payload(boxes[0].label_token)]), scan(disp.id, [payload(boxes[0].label_token)])])
    assert.deepEqual([r1[0].result, r2[0].result].sort(), ['accepted', 'duplicate'])
    ok(await finalize(disp.id))
    assert.equal(await eventCount(boxes[0].id, 'DISPATCHED'), 1)
    await booksBalance()
  })
})

describe('cancel at every stage', () => {
  test('confirmed, nothing picked: the promise is released and the boxes never moved', async () => {
    const { lot, boxes } = await stockedLot(2)
    const orderId = await paidOrder(2)
    assert.equal((await lineOf(lot.lineId)).committed, 2)
    ok(await cancel(orderId), 204)
    const l = await lineOf(lot.lineId)
    assert.deepEqual([l.on_hand, l.committed], [2, 0])
    for (const b of boxes) assert.equal((await box(b.id)).lifecycle, 'in_stock')
    await booksBalance()
  })

  test('partly picked: picked boxes go to pick staging, the rest of the promise is released', async () => {
    const { lot, boxes } = await stockedLot(3)
    const orderId = await paidOrder(2)
    await pickAll(orderId, [boxes[0]])
    ok(await cancel(orderId), 204)
    const b0 = await box(boxes[0].id)
    assert.deepEqual([b0.lifecycle, b0.order_id, b0.location_id], ['in_stock', null, (await loc('pick_staging')).id])
    const l = await lineOf(lot.lineId)
    assert.deepEqual([l.on_hand, l.committed], [2, 0])
    await booksBalance()
  })

  test('packed, with a dispatch session open: boxes unbind, the session cannot ship them', async () => {
    const { lot, boxes } = await stockedLot(2)
    const orderId = await paidOrder(2)
    await pickAll(orderId, boxes)
    await packAll(orderId, boxes)
    const disp = await startOp('dispatch', { orderId })
    await scan(disp.id, [payload(boxes[0].label_token)])
    ok(await cancel(orderId), 204)
    for (const b of boxes) {
      const row = await box(b.id)
      assert.deepEqual([row.lifecycle, row.order_id], ['in_stock', null])
    }
    assert.equal((await query('SELECT count(*)::int AS n FROM wh_staged WHERE operation_id = $1', [disp.id])).rows[0].n, 0)
    const shipped = await finalize(disp.id)
    assert.equal(shipped.status, 409)
    assert.equal((await orderRow(orderId)).status, 'CANCELLED')
    for (const b of boxes) assert.equal(await eventCount(b.id, 'DISPATCHED'), 0)
    assert.equal((await lineOf(lot.lineId)).on_hand, 0, 'unbound boxes wait at pick staging until put away')
    const mv = await startOp('move', { locationId: (await loc('storage')).id })
    await scan(mv.id, boxes.map((b) => payload(b.label_token)))
    assert.equal((await lineOf(lot.lineId)).on_hand, 2)
    await booksBalance()
  })

  test('shipped: the fruit has left, so stock does not come back; a return books the box and holds it', async () => {
    const { lot, boxes } = await stockedLot(1)
    const orderId = await paidOrder(1)
    await pickAll(orderId, boxes)
    await packAll(orderId, boxes)
    await dispatchAll(orderId, boxes)
    ok(await cancel(orderId), 204)
    assert.equal((await box(boxes[0].id)).lifecycle, 'dispatched')
    assert.equal((await lineOf(lot.lineId)).on_hand, 0)
    await booksBalance()
    const ret = await startOp('return', { orderId, reason: 'Came back with the rider' })
    assert.equal((await scan(ret.id, [payload(boxes[0].label_token)]))[0].result, 'accepted')
    const b0 = ok(await api.get(`${W}/boxes/${boxes[0].id}`, { token: manager }))
    assert.equal(b0.lifecycle, 'returned')
    assert.ok(b0.holds.includes('return_hold'), JSON.stringify(b0.holds))
    assert.equal((await lineOf(lot.lineId)).on_hand, 0, 'returns are not restocked (D7)')
    await booksBalance()
  })
})

describe('QC permissions', () => {
  test('only a manager passes a failed box, never the one who failed it; a weight out of tolerance turns a pass into review', async () => {
    const lot = await newLot(3)
    const boxes = await tokensOf(lot.id)
    const rec = await startOp('receive', { lotId: lot.id })
    await scan(rec.id, boxes.map((b) => payload(b.label_token)))
    const qcT = await adminToken(api, 'qc@mandimangoes.test', 'qc123')
    const qcFail = await startOp('qc', { result: 'failed', reasonCodes: ['BRUISED'] }, qcT)
    const failed = await scan(qcFail.id, [payload(boxes[0].label_token)], qcT)
    assert.equal(failed[0].result, 'accepted', JSON.stringify(failed[0]))
    const qcPass = await startOp('qc', { result: 'passed' }, qcT)
    assert.equal((await scan(qcPass.id, [payload(boxes[0].label_token)], qcT))[0].code, 'QC_OVERRIDE_REQUIRED')
    const mPass = await startOp('qc', { result: 'passed' })
    const passed = await scan(mPass.id, [payload(boxes[0].label_token)])
    assert.equal(passed[0].result, 'accepted', JSON.stringify(passed[0]))
    assert.equal((await box(boxes[0].id)).quality, 'passed')
    const mFail = await startOp('qc', { result: 'failed', reasonCodes: ['BRUISED'] })
    await scan(mFail.id, [payload(boxes[1].label_token)])
    assert.equal((await scan(mPass.id, [payload(boxes[1].label_token)]))[0].code, 'SELF_APPROVAL')
    assert.equal((await box(boxes[1].id)).quality, 'failed')
    const heavy = await api.post(`${W}/operations/${mPass.id}/scans`, { scans: [{ scanId: randomUUID(), input: payload(boxes[2].label_token), weightG: 3200 }] }, { token: manager })
    const r = ok(heavy).results[0]
    assert.deepEqual([r.result, r.code], ['warning', 'WEIGHT_OUT_OF_TOLERANCE'])
    assert.equal((await box(boxes[2].id)).quality, 'needs_review')
    await booksBalance()
  })
})

describe('QC by scan', () => {
  test('a freshly received box passes QC by scan, loses its QC hold and becomes stock once put away', async () => {
    const lot = await newLot(1)
    const [b] = await tokensOf(lot.id)
    const rec = await startOp('receive', { lotId: lot.id })
    await scan(rec.id, [payload(b.label_token)])
    const held = ok(await api.get(`${W}/boxes/${b.id}`, { token: manager }))
    assert.ok(held.holds.includes('qc_hold'), JSON.stringify(held.holds))
    const qcOp = await startOp('qc', { result: 'passed' })
    const r = await scan(qcOp.id, [payload(b.label_token)])
    assert.equal(r[0].result, 'accepted', JSON.stringify(r[0]))
    const passed = ok(await api.get(`${W}/boxes/${b.id}`, { token: manager }))
    assert.deepEqual([passed.quality, passed.holds.includes('qc_hold')], ['passed', false])
    const mv = await startOp('move', { locationId: (await loc('storage')).id })
    await scan(mv.id, [payload(b.label_token)])
    assert.equal((await lineOf(lot.lineId)).on_hand, 1)
    await booksBalance()
  })
})
