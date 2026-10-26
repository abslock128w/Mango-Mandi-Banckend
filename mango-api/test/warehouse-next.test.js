// Warehouse next steps, end to end through the HTTP API: stocktake (cycle
// count) with its supervisor review, repack / split / merge with lineage and
// labels, partial damage, and the mock recall drill following repacked boxes.
// After each story the books are checked: the stock counters equal the
// sellable boxes, the ledger audit balances, nothing is in an impossible state.
import { adminToken, checkout, client, closeAll, customerToken, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, describe, test } from 'node:test'
import jsQR from 'jsqr'
import { addDays, now, setNow, todayIST } from '../src/clock.js'
import { query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { auditLedger } from '../src/inventory.js'
import { formatBoxCode } from '../src/warehouse/codes.js'
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
const box = async (id) => (await query('SELECT * FROM boxes WHERE id = $1', [id])).rows[0]
const holdsOf = async (id) => (await query('SELECT kind FROM box_holds WHERE box_id = $1 AND released_at IS NULL ORDER BY kind', [id])).rows.map((r) => r.kind)
const tick = (ms = 60_000) => setNow(new Date(now().getTime() + ms).toISOString())
const ops = () => adminToken(api, 'ops@mandimangoes.test', 'operator123')

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
const finalize = (opId, body = {}, token = manager) => api.post(`${W}/operations/${opId}/finalize`, body, { token })
const payload = (t) => `MMB1:${t}`
const P = (b) => payload(b.label_token)

async function stockedLot({ count = 4, sku = 'ALP-3', harvestedAgo = 5 } = {}) {
  ok(await api.patch(`${W}/products/${sku}`, { boxTrackingEnabled: true, nominalWeightG: 3000 }, { token: manager }))
  const lot = ok(await api.post(`${W}/lots`, { sku, expectedCount: count, harvestedOn: addDays(todayIST(), -harvestedAgo), supplier: 'Ratnagiri Farms' }, { token: manager }), 201)
  ok(await api.post(`/admin/v1/batches/${lot.batchId}/qc`, { ripenessRating: 'SEMI_RIPE', condition: 'GOOD' }, { token: manager }), 201)
  const boxes = await tokensOf(lot.id)
  const rec = await startOp('receive', { lotId: lot.id })
  assert.deepEqual((await scan(rec.id, boxes.map(P))).map((r) => r.result), boxes.map(() => 'accepted'))
  ok(await api.post(`${W}/lots/${lot.id}/qc`, { result: 'passed' }, { token: manager }))
  ok(await api.post(`${W}/lots/${lot.id}/put-away`, { locationId: (await loc('storage')).id }, { token: manager }))
  return { lot, boxes }
}

async function paidOrder(qty, sku = 'ALP-3') {
  const cust = await customerToken(api)
  const c = await checkout(api, cust.accessToken, [{ sku, stage: 'RIPE', qty }])
  assert.equal(c.status, 201, JSON.stringify(c.body))
  ok(await pay(c.body.orderId))
  return { id: c.body.orderId }
}

async function moveTo(type, boxes, token = manager) {
  const op = await startOp('move', { locationId: (await loc(type)).id }, token)
  const res = await scan(op.id, boxes.map(P), token)
  for (const r of res) assert.ok(['accepted', 'warning'].includes(r.result), JSON.stringify(r))
}

async function secondManager() {
  await query(`INSERT INTO admin_users (id, email, password_hash, role) SELECT 'adm_second', 'second@mandimangoes.test', password_hash, 'MANAGER' FROM admin_users WHERE email = 'manager@mandimangoes.test'`)
  return adminToken(api, 'second@mandimangoes.test', 'manager123')
}

// ---------------------------------------------------------------- stocktake

describe('stocktake', () => {
  test('missing is only proposed at finish, applied after a supervisor review, and a found scan brings the box back', async () => {
    const { lot, boxes } = await stockedLot({ count: 4 })
    const storage = await loc('storage')
    const op = await ops()
    const count = await startOp('stocktake', { locationId: storage.id }, op)
    assert.equal(count.class, 'staged')
    assert.equal(count.context.recorded, 4)
    assert.ok(count.context.snapshotAt)
    const res = await scan(count.id, boxes.slice(0, 3).map(P), op)
    assert.deepEqual(res.map((r) => r.code), ['OK', 'OK', 'OK'])
    assert.equal((await scan(count.id, [P(boxes[0])], op))[0].result, 'duplicate')
    const progress = ok(await api.get(`${W}/operations/${count.id}`, { token: op })).progress
    assert.deepEqual(progress, { staged: 3, needed: 4 })
    // Scanning changes nothing.
    assert.equal((await lineOf(lot.lineId)).on_hand, 4)

    const done = ok(await finalize(count.id, {}, op))
    assert.equal(done.status, 'completed')
    assert.equal(done.result.matched, 3)
    assert.equal(done.result.notFound, 1)
    assert.equal(done.result.toReview, 1)
    assert.equal((await box(boxes[3].id)).lifecycle, 'in_stock', 'not found is only a proposal')
    assert.equal((await lineOf(lot.lineId)).on_hand, 4)
    const ex = ok(await api.get(`${W}/exceptions`, { token: manager }))
    assert.deepEqual(ex.stocktakeReviews.map((r) => [r.operationId, r.toReview]), [[count.id, 1]])

    // Only roles holding warehouse.stocktake review.
    const qc = await adminToken(api, 'qc@mandimangoes.test', 'qc123')
    const packer = await adminToken(api, 'packer@mandimangoes.test', 'packer123')
    for (const t of [qc, packer]) {
      assert.equal((await api.post(`${W}/stocktakes/${count.id}/review`, { missing: [boxes[3].id] }, { token: t })).status, 403)
      assert.equal((await api.get(`${W}/stocktakes`, { token: t })).status, 403)
    }
    const undecided = await api.post(`${W}/stocktakes/${count.id}/review`, { missing: [] }, { token: manager })
    assert.equal(undecided.status, 400)
    const reviewed = ok(await api.post(`${W}/stocktakes/${count.id}/review`, { missing: [boxes[3].id], note: 'Shelf searched twice' }, { token: manager }))
    assert.equal(reviewed.status, 'applied')
    const gone = await box(boxes[3].id)
    assert.deepEqual([gone.lifecycle, gone.location_id], ['missing', null])
    assert.equal((await lineOf(lot.lineId)).on_hand, 3)
    assert.equal((await api.post(`${W}/stocktakes/${count.id}/review`, { missing: [] }, { token: manager })).body.error.code, 'INVALID_TRANSITION')
    const detail = ok(await api.get(`${W}/stocktakes/${count.id}`, { token: op }))
    assert.equal(detail.review.status, 'applied')
    assert.deepEqual(detail.lines.map((l) => [l.kind, l.status]), [['not_found', 'missing']])
    const ex2 = ok(await api.get(`${W}/exceptions`, { token: manager }))
    assert.deepEqual(ex2.stocktakeReviews, [])
    assert.deepEqual(ex2.missingBoxes.map((b) => b.boxId), [boxes[3].id])
    await booksBalance()

    // A later count finds it: back in stock where it was scanned, and stock again.
    tick()
    const recount = await startOp('stocktake', { locationId: storage.id })
    const found = await scan(recount.id, boxes.map(P))
    assert.deepEqual(found.map((r) => r.code), ['OK', 'OK', 'OK', 'FOUND_MISSING'])
    const r2 = ok(await finalize(recount.id))
    assert.equal(r2.result.foundMissing, 1)
    const back = await box(boxes[3].id)
    assert.deepEqual([back.lifecycle, back.location_id], ['in_stock', storage.id])
    assert.equal((await lineOf(lot.lineId)).on_hand, 4)
    const events = ok(await api.get(`${W}/boxes/${boxes[3].id}/events`, { token: manager })).map((e) => e.type)
    assert.deepEqual(events.slice(0, 2), ['FOUND', 'MISSING'])
    assert.deepEqual(ok(await api.get(`${W}/exceptions`, { token: manager })).missingBoxes, [])
    await booksBalance()
  })

  test('found elsewhere is corrected, a box recorded as gone is held, and a box on an order can only be kept', async () => {
    const { lot, boxes } = await stockedLot({ count: 5 })
    const o = await paidOrder(1)
    const pick = await startOp('pick', { orderId: o.id })
    assert.notEqual((await scan(pick.id, [P(boxes[0])], manager, { reason: 'test' }))[0].result, 'rejected')
    assert.equal((await box(boxes[0].id)).lifecycle, 'picked')
    ok(await api.post(`${W}/write-offs`, { boxIds: [boxes[2].id], reasonCode: 'damaged', reason: 'crushed' }, { token: manager }))
    const before = (await lineOf(lot.lineId)).on_hand

    tick()
    const staging = await loc('pick_staging')
    const count = await startOp('stocktake', { locationId: staging.id })
    assert.equal(count.context.recorded, 1)
    const res = await scan(count.id, [P(boxes[1]), P(boxes[2])])
    assert.deepEqual(res.map((r) => [r.result, r.code]), [['warning', 'FOUND_ELSEWHERE'], ['warning', 'RECORDED_GONE']])
    const done = ok(await finalize(count.id))
    assert.deepEqual(
      [done.result.foundElsewhere, done.result.foundGone, done.result.notFoundAllocated, done.result.notFound],
      [1, 1, 1, 0],
    )
    const moved = await box(boxes[1].id)
    assert.equal(moved.location_id, staging.id)
    assert.equal((await lineOf(lot.lineId)).on_hand, before - 1, 'a box found at pick staging is not shelf stock')
    assert.deepEqual(await holdsOf(boxes[2].id), ['investigation_hold'])
    assert.equal((await box(boxes[2].id)).lifecycle, 'disposed', 'the record keeps its state; a supervisor investigates')
    const ev = ok(await api.get(`${W}/boxes/${boxes[1].id}/events`, { token: manager }))
    assert.equal(ev[0].type, 'LOCATION_CORRECTED')

    const wrong = await api.post(`${W}/stocktakes/${count.id}/review`, { missing: [boxes[0].id] }, { token: manager })
    assert.equal(wrong.status, 400)
    const kept = ok(await api.post(`${W}/stocktakes/${count.id}/review`, { keep: [boxes[0].id] }, { token: manager }))
    assert.deepEqual([kept.status, kept.kept, kept.missing], ['applied', 1, 0])
    assert.equal((await box(boxes[0].id)).lifecycle, 'picked')
    await booksBalance()
  })

  test('boxes moved by someone else after the snapshot are ignored, never proposed missing or corrected', async () => {
    const { boxes } = await stockedLot({ count: 4 })
    await moveTo('cold_storage', [boxes[3]])
    const storage = await loc('storage')
    const cold = await loc('cold_storage')
    tick()
    const count = await startOp('stocktake', { locationId: storage.id })
    await scan(count.id, [P(boxes[0]), P(boxes[1]), P(boxes[2])])
    tick()
    // Someone else moves a scanned box out, and another box in, after the count started.
    await moveTo('cold_storage', [boxes[0]])
    await moveTo('storage', [boxes[3]])
    tick()
    const done = ok(await finalize(count.id))
    assert.equal(done.result.movedAfterSnapshot, 2)
    assert.equal(done.result.notFound, 0)
    assert.equal(done.result.foundElsewhere, 0)
    assert.equal((await box(boxes[0].id)).location_id, cold.id, 'not pulled back by the count')
    assert.equal((await box(boxes[3].id)).lifecycle, 'in_stock')
    const detail = ok(await api.get(`${W}/stocktakes/${count.id}`, { token: manager }))
    assert.deepEqual(detail.lines.map((l) => l.status).sort(), ['ignored', 'ignored'])
    assert.equal((await api.post(`${W}/stocktakes/${count.id}/review`, { missing: [] }, { token: manager })).body.error.code, 'NOTHING_TO_REVIEW')
    await booksBalance()
  })

  test('two finishes of one count apply once; a scan after the finish is refused; one open count per place', async () => {
    const { boxes } = await stockedLot({ count: 3 })
    const storage = await loc('storage')
    const op = await ops()
    // Two people starting a count of the same place at once: one count.
    const starts = await Promise.all([
      api.post(`${W}/operations`, { type: 'stocktake', context: { locationId: storage.id } }, { token: manager }),
      api.post(`${W}/operations`, { type: 'stocktake', context: { locationId: storage.id } }, { token: op }),
    ])
    assert.deepEqual(starts.map((r) => r.status).sort(), [201, 409])
    const winner = starts.find((r) => r.status === 201)
    assert.equal(starts.find((r) => r.status === 409).body.error.code, 'OPERATION_LOCKED')
    const token = winner.body.ownerId === (await query(`SELECT id FROM admin_users WHERE email = 'manager@mandimangoes.test'`)).rows[0].id ? manager : op
    const again = ok(await api.post(`${W}/operations`, { type: 'stocktake', context: { locationId: storage.id } }, { token }), 201)
    assert.equal(again.resumed, true)
    await scan(winner.body.id, [P(boxes[0]), P(boxes[1])], token)

    // A scan racing the finish lands either before it (counted) or after it (refused, stored).
    const [f1, f2, late] = await Promise.all([
      finalize(winner.body.id, {}, token),
      finalize(winner.body.id, {}, token),
      api.post(`${W}/operations/${winner.body.id}/scans`, { scans: [{ scanId: randomUUID(), input: P(boxes[2]) }] }, { token }),
    ])
    assert.deepEqual([f1.status, f2.status], [200, 200])
    assert.equal([f1.body.replayed, f2.body.replayed].filter(Boolean).length, 1, 'exactly one finish applied')
    const lateResult = ok(late).results[0]
    const result = (f1.body.replayed ? f2 : f1).body.result
    if (lateResult.result === 'rejected') {
      assert.equal(lateResult.code, 'OPERATION_CLOSED')
      assert.equal(result.notFound, 1)
    } else {
      assert.equal(lateResult.code, 'OK')
      assert.equal(result.notFound, 0)
    }
    const lines = (await query('SELECT count(*)::int AS n FROM wh_stocktake_lines WHERE operation_id = $1', [winner.body.id])).rows[0].n
    assert.equal(lines, result.notFound)
    assert.equal((await scan(winner.body.id, [P(boxes[2])], token))[0].code, 'OPERATION_CLOSED')
    // Done: the place can be counted again.
    ok(await api.post(`${W}/operations`, { type: 'stocktake', context: { locationId: storage.id } }, { token: op === token ? manager : op }), 201)
    await booksBalance()
  })

  test('marking many boxes missing waits for a second person who neither counted nor reviewed (D8)', async () => {
    const { lot, boxes } = await stockedLot({ count: 12 })
    const second = await secondManager()
    const op = await ops()
    const count = await startOp('stocktake', { locationId: (await loc('storage')).id })
    const done = ok(await finalize(count.id))
    assert.equal(done.result.notFound, 12)
    const review = ok(await api.post(`${W}/stocktakes/${count.id}/review`, { missing: boxes.map((b) => b.id) }, { token: op }))
    assert.equal(review.status, 'pending_approval')
    assert.equal((await lineOf(lot.lineId)).on_hand, 12)
    assert.equal((await box(boxes[0].id)).lifecycle, 'in_stock')
    assert.equal((await api.post(`${W}/stocktakes/${count.id}/approve`, {}, { token: op })).status, 403, 'operators cannot approve')
    const self = await api.post(`${W}/stocktakes/${count.id}/approve`, {}, { token: manager })
    assert.equal(self.body.error.code, 'SELF_APPROVAL', 'the counter cannot approve')
    // One box is found and put back before the approval: it is left alone.
    await moveTo('cold_storage', [boxes[0]])
    const approved = ok(await api.post(`${W}/stocktakes/${count.id}/approve`, {}, { token: second }))
    assert.deepEqual([approved.status, approved.missing, approved.superseded], ['applied', 11, 1])
    assert.equal((await box(boxes[0].id)).lifecycle, 'in_stock')
    assert.equal((await box(boxes[1].id)).lifecycle, 'missing')
    assert.equal((await lineOf(lot.lineId)).on_hand, 1)
    assert.equal((await api.post(`${W}/stocktakes/${count.id}/reject`, {}, { token: second })).body.error.code, 'INVALID_TRANSITION')
    await booksBalance()
  })

  test('with WAREHOUSE_STOCKTAKE or WAREHOUSE_REPACK off their routes and sessions are 404 and the permission is not offered', async () => {
    env.WAREHOUSE_STOCKTAKE = false
    env.WAREHOUSE_REPACK = false
    try {
      assert.equal((await api.get(`${W}/stocktakes`, { token: manager })).status, 404)
      assert.equal((await api.get(`${W}/repacks`, { token: manager })).status, 404)
      assert.equal((await api.post(`${W}/boxes/${randomUUID()}/damage`, {}, { token: manager })).status, 404)
      const start = await api.post(`${W}/operations`, { type: 'stocktake', context: {} }, { token: manager })
      assert.equal(start.status, 404)
      const me = ok(await api.get('/admin/v1/auth/me', { token: manager }))
      assert.equal(me.warehouse.permissions.includes('warehouse.stocktake'), false)
      assert.equal(me.warehouse.permissions.includes('warehouse.repack'), false)
      const settings = ok(await api.get(`${W}/settings`, { token: manager }))
      assert.deepEqual(settings.features, { stocktake: false, repack: false, cameraScan: env.WAREHOUSE_CAMERA_SCAN })
      assert.equal(settings.operationTypes.includes('repack'), false)
    } finally {
      env.WAREHOUSE_STOCKTAKE = true
      env.WAREHOUSE_REPACK = true
    }
    const me = ok(await api.get('/admin/v1/auth/me', { token: manager }))
    assert.ok(me.warehouse.permissions.includes('warehouse.stocktake') && me.warehouse.permissions.includes('warehouse.repack'))
  })
})

// ---------------------------------------------------------------- repack

/** Renders a label PDF (one label a page) and decodes every QR. */
function decodeLabels(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'wh-repack-'))
  try {
    writeFileSync(join(dir, 'l.pdf'), bytes)
    execFileSync('pdftoppm', ['-r', '300', '-gray', join(dir, 'l.pdf'), join(dir, 'p')])
    return readdirSync(dir).filter((n) => n.endsWith('.pgm')).sort().map((f) => {
      const img = readPgm(readFileSync(join(dir, f)))
      return jsQR(img.rgba, img.width, img.height)?.data
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function readPgm(buf) {
  let pos = 0
  const token = () => {
    while (/\s/.test(String.fromCharCode(buf[pos]))) pos++
    if (buf[pos] === 0x23) {
      while (buf[pos] !== 0x0a) pos++
      return token()
    }
    let s = ''
    while (!/\s/.test(String.fromCharCode(buf[pos]))) s += String.fromCharCode(buf[pos++])
    return s
  }
  assert.equal(token(), 'P5')
  const width = Number(token())
  const height = Number(token())
  token()
  pos++
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba.set([buf[pos + i], buf[pos + i], buf[pos + i], 255], i * 4)
  }
  return { width, height, rgba }
}

describe('repack', () => {
  test('a merge links both batches, keeps the earliest best-before, ends the sources and prints new labels', async () => {
    const a = await stockedLot({ count: 2, harvestedAgo: 5 })
    const b = await stockedLot({ count: 2, harvestedAgo: 3 })
    const op = await ops()
    const packing = await loc('packing')
    const rp = await startOp('repack', { locationId: packing.id, reasonCode: 'merge_partials', reason: 'Two half boxes after sorting' }, op)
    assert.equal(rp.class, 'staged')
    const res = await scan(rp.id, [P(a.boxes[0]), P(b.boxes[0])], op)
    assert.deepEqual(res.map((r) => r.code), ['OK', 'OK'])
    // Nothing changes until the finish.
    assert.equal((await box(a.boxes[0].id)).lifecycle, 'in_stock')
    const heavy = await finalize(rp.id, { outputs: [{ weightG: 9000 }] }, op)
    assert.equal(heavy.status, 400, 'cannot make more fruit than went in')
    const done = ok(await finalize(rp.id, { outputs: [{ weightG: 3000, fruitCount: 10 }], fruitRemoved: 2, weightLostG: 2900 }, op))
    assert.equal(done.result.kind, 'merge')
    const [out] = done.result.outputs
    const nb = await box(out.id)
    assert.deepEqual([...nb.parent_box_ids].sort(), [a.boxes[0].id, b.boxes[0].id].sort())
    assert.equal(nb.best_before, (await box(a.boxes[0].id)).best_before, 'the oldest fruit decides the date')
    assert.equal(nb.lot_id, a.lot.id)
    assert.deepEqual([nb.lifecycle, nb.location_id, nb.quality, nb.measured_weight_g, nb.fruit_count], ['in_stock', packing.id, 'pending', 3000, 10])
    assert.deepEqual(await holdsOf(nb.id), ['qc_hold'])
    assert.ok(nb.seq > 1_000_000)
    const origins = (await query('SELECT lot_id FROM box_origins WHERE box_id = $1 ORDER BY lot_id', [nb.id])).rows.map((r) => r.lot_id)
    assert.deepEqual(origins, [a.lot.id, b.lot.id].sort())
    for (const s of [a.boxes[0], b.boxes[0]]) {
      const src = await box(s.id)
      assert.deepEqual([src.lifecycle, src.location_id], ['repacked', null])
    }
    assert.equal((await lineOf(a.lot.lineId)).on_hand, 1)
    assert.equal((await lineOf(b.lot.lineId)).on_hand, 1)
    const rec = (await query('SELECT * FROM wh_repacks WHERE operation_id = $1', [rp.id])).rows[0]
    assert.deepEqual([rec.kind, rec.fruit_removed, rec.weight_lost_g, rec.reason_code], ['merge', 2, 2900, 'merge_partials'])
    await booksBalance()

    // New labels: the existing label PDF, every QR decodes to the new box's token.
    const pdf = await api.raw('GET', `${W}/repacks/${rp.id}/labels.pdf`, { token: op })
    assert.equal(pdf.status, 200)
    assert.equal(pdf.headers.get('content-type'), 'application/pdf')
    const bytes = Buffer.from(await (await fetch(`${srv.base}${W}/repacks/${rp.id}/labels.pdf`, { headers: { Authorization: `Bearer ${op}` } })).arrayBuffer())
    assert.deepEqual(decodeLabels(bytes), [payload(nb.label_token)])
    // The new label scans; the old ones are ended.
    const look = ok(await api.post(`${W}/resolve`, { input: payload(nb.label_token) }, { token: op }))
    assert.equal(look.box.id, nb.id)

    // Trace both ways.
    const back = ok(await api.get(`${W}/trace/boxes/${nb.id}`, { token: manager }))
    assert.deepEqual(back.origins.map((o) => o.lotId).sort(), [a.lot.id, b.lot.id].sort())
    assert.deepEqual(back.parents.map((p) => p.id).sort(), [a.boxes[0].id, b.boxes[0].id].sort())
    const fwd = ok(await api.get(`${W}/trace/boxes/${b.boxes[0].id}`, { token: manager }))
    assert.deepEqual(fwd.descendants.map((d) => d.id), [nb.id])
    const lotB = ok(await api.get(`${W}/trace/lots/${b.lot.id}`, { token: manager }))
    const row = lotB.boxes.find((x) => x.id === nb.id)
    assert.equal(row?.descendant, true)
    assert.equal(lotB.boxes.filter((x) => x.id === nb.id).length, 1)

    // QC by scan and put away: stock again on the oldest batch's line.
    const qc = await startOp('qc', { result: 'passed' })
    assert.equal((await scan(qc.id, [payload(nb.label_token)]))[0].code, 'OK')
    await moveTo('storage', [nb])
    assert.equal((await lineOf(a.lot.lineId)).on_hand, 2)
    await booksBalance()
  })

  test('a split carries recall and investigation holds; a box on an order, another product or a storage bench is refused', async () => {
    const { lot, boxes } = await stockedLot({ count: 4 })
    ok(await api.post(`${W}/boxes/${boxes[0].id}/holds`, { kind: 'investigation_hold', reason: 'Label smudged' }, { token: manager }))
    const rc = ok(await api.post(`${W}/recalls`, { lotIds: [lot.id], reason: 'Supplier notice' }, { token: manager }), 201)
    const storage = await loc('storage')
    const bad = await api.post(`${W}/operations`, { type: 'repack', context: { locationId: storage.id, reasonCode: 'split', reason: 'Too heavy' } }, { token: manager })
    assert.equal(bad.body.error.code, 'LOCATION_TYPE_NOT_ALLOWED')
    const rp = await startOp('repack', { locationId: (await loc('qc_hold')).id, reasonCode: 'split', reason: 'Split for two small orders' })
    assert.equal((await scan(rp.id, [P(boxes[0])]))[0].code, 'OK')
    const done = ok(await finalize(rp.id, { outputs: [{ weightG: 1500 }, { weightG: 1450 }], weightLostG: 50 }))
    assert.equal(done.result.kind, 'split')
    assert.deepEqual(done.result.carriedHolds.sort(), ['investigation_hold', 'recall_hold'])
    for (const o of done.result.outputs) assert.deepEqual(await holdsOf(o.id), ['investigation_hold', 'qc_hold', 'recall_hold'])
    assert.deepEqual(await holdsOf(boxes[0].id), [], 'the ended box hands its holds on')
    // Releasing the recall frees the new boxes from it, and only from it.
    ok(await api.post(`${W}/recalls/${rc.id}/release`, { reason: 'Lab test clear' }, { token: manager }))
    for (const o of done.result.outputs) assert.deepEqual(await holdsOf(o.id), ['investigation_hold', 'qc_hold'])

    // Refusals at scan time.
    ok(await api.patch(`${W}/products/BAD-3`, { boxTrackingEnabled: true, nominalWeightG: 3000 }, { token: manager }))
    const other = ok(await api.post(`${W}/lots`, { sku: 'BAD-3', expectedCount: 1, harvestedOn: addDays(todayIST(), -3) }, { token: manager }), 201)
    const [ob] = await tokensOf(other.id)
    const rec = await startOp('receive', { lotId: other.id })
    await scan(rec.id, [P(ob)])
    const o = await paidOrder(1)
    const rp2 = await startOp('repack', { locationId: (await loc('packing')).id, reasonCode: 'spoiled_fruit', reason: 'Mould on two fruit' })
    assert.equal((await scan(rp2.id, [P(boxes[1])]))[0].code, 'OK')
    assert.equal((await scan(rp2.id, [P(ob)]))[0].code, 'WRONG_VARIANT')
    assert.equal((await scan(rp2.id, [P(boxes[0])]))[0].code, 'INVALID_TRANSITION', 'a repacked box cannot go in again')
    const pick = await startOp('pick', { orderId: o.id })
    const picked = await scan(pick.id, [P(boxes[2])], manager, { reason: 'test' })
    assert.notEqual(picked[0].result, 'rejected', JSON.stringify(picked[0]))
    const onOrder = await scan(rp2.id, [P(boxes[2])])
    assert.deepEqual([onOrder[0].result, onOrder[0].code], ['rejected', 'INVALID_TRANSITION'])
    await booksBalance()
  })

  test('two repacks of the same box: the first finish wins, the second is told precisely and the box is taken out of it', async () => {
    const { boxes } = await stockedLot({ count: 3 })
    const packing = (await loc('packing')).id
    const r1 = await startOp('repack', { locationId: packing, reasonCode: 'spoiled_fruit', reason: 'Bench one' })
    const op = await ops()
    const r2 = await startOp('repack', { locationId: packing, reasonCode: 'spoiled_fruit', reason: 'Bench two' }, op)
    await scan(r1.id, [P(boxes[0])])
    const warn = await scan(r2.id, [P(boxes[0]), P(boxes[1])], op)
    assert.deepEqual(warn.map((r) => r.code), ['STAGED_ELSEWHERE', 'OK'])
    // Both finish at once: exactly one gets box 0.
    const [f1, f2] = await Promise.all([
      finalize(r1.id, { outputs: [{ weightG: 2900 }] }),
      finalize(r2.id, { outputs: [{ weightG: 5800 }] }, op),
    ])
    const statuses = [f1.status, f2.status].sort()
    assert.deepEqual(statuses, [200, 409])
    const lost = f1.status === 409 ? { res: f1, op: r1, token: manager } : { res: f2, op: r2, token: op }
    assert.equal(lost.res.body.error.code, 'STALE_SCAN')
    assert.deepEqual(lost.res.body.error.boxes, [formatBoxCode(boxes[0].code)])
    assert.equal(lost.res.body.error.unstage, undefined, 'internal ids stay on the server')
    assert.equal((await box(boxes[0].id)).lifecycle, 'repacked')
    // The stale box is out of the losing session; scanning it again is checked afresh.
    const view = ok(await api.get(`${W}/operations/${lost.op.id}`, { token: lost.token }))
    assert.equal(view.progress.staged, lost.op.id === r2.id ? 1 : 0)
    const again = await scan(lost.op.id, [P(boxes[0])], lost.token)
    assert.deepEqual([again[0].result, again[0].code], ['rejected', 'INVALID_TRANSITION'])
    if (lost.op.id === r2.id) ok(await finalize(r2.id, { outputs: [{ weightG: 2900 }] }, op))
    assert.equal((await query(`SELECT count(*)::int AS n FROM boxes WHERE parent_box_ids @> ARRAY[$1::uuid]`, [boxes[0].id])).rows[0].n, 1, 'one set of new boxes from box 0')
    await booksBalance()
  })

  test('partial damage lowers the weight with an event; below tolerance the box goes to review and leaves stock', async () => {
    const { lot, boxes } = await stockedLot({ count: 3 })
    const small = ok(await api.post(`${W}/boxes/${boxes[0].id}/damage`, { weightLostG: 50, fruitRemoved: 1, reasonCode: 'spoiled_fruit', reason: 'One soft fruit' }, { token: manager }))
    assert.deepEqual([small.belowTolerance, small.needsReview, small.box.quality, small.box.measuredWeightG], [false, false, 'passed', 2950])
    assert.equal((await lineOf(lot.lineId)).on_hand, 3)
    const big = ok(await api.post(`${W}/boxes/${boxes[1].id}/damage`, { weightLostG: 600, reasonCode: 'spoiled_fruit', reason: 'Three fruit out' }, { token: manager }))
    assert.deepEqual([big.belowTolerance, big.needsReview, big.box.quality, big.box.measuredWeightG], [true, true, 'needs_review', 2400])
    assert.equal((await lineOf(lot.lineId)).on_hand, 2)
    const ev = ok(await api.get(`${W}/boxes/${boxes[1].id}/events`, { token: manager }))[0]
    assert.equal(ev.type, 'PARTIAL_DAMAGE')
    assert.deepEqual([ev.meta.weightBeforeG, ev.meta.weightAfterG, ev.reasonCode], [3000, 2400, 'spoiled_fruit'])
    const all = await api.post(`${W}/boxes/${boxes[2].id}/damage`, { weightLostG: 3000, reasonCode: 'damaged_box', reason: 'Flattened' }, { token: manager })
    assert.equal(all.status, 400)
    const none = await api.post(`${W}/boxes/${boxes[2].id}/damage`, { reasonCode: 'other', reason: 'x' }, { token: manager })
    assert.equal(none.status, 400)
    const qc = await adminToken(api, 'qc@mandimangoes.test', 'qc123')
    assert.equal((await api.post(`${W}/boxes/${boxes[2].id}/damage`, { weightLostG: 10, reasonCode: 'other', reason: 'x' }, { token: qc })).status, 403)
    await booksBalance()
  })
})

// ---------------------------------------------------------------- recall drill

describe('recall drill', () => {
  test('a recall finds every box of the batch, repacked descendants included, holds every one not dispatched and lists every order', async () => {
    const { lot, boxes } = await stockedLot({ count: 6 })
    const other = await stockedLot({ count: 2 })
    const packing = (await loc('packing')).id
    // Split box 0 into two; merge box 1 with a box of another batch.
    const split = await startOp('repack', { locationId: packing, reasonCode: 'split', reason: 'Split for small orders' })
    await scan(split.id, [P(boxes[0])])
    const s = ok(await finalize(split.id, { outputs: [{ weightG: 1500 }, { weightG: 1500 }] })).result.outputs
    const merge = await startOp('repack', { locationId: packing, reasonCode: 'merge_partials', reason: 'Two part boxes' })
    await scan(merge.id, [P(boxes[1]), P(other.boxes[0])])
    const m = ok(await finalize(merge.id, { outputs: [{ weightG: 3000 }] })).result.outputs
    const made = [...s, ...m]
    const madeRows = await Promise.all(made.map((x) => box(x.id)))
    const qc = await startOp('qc', { result: 'passed' })
    await scan(qc.id, madeRows.map(P))
    await moveTo('storage', madeRows)
    await booksBalance()

    // One order dispatched (box 2), one picked and waiting (box 3).
    const shipped = await paidOrder(1)
    const pk = await startOp('pick', { orderId: shipped.id })
    assert.notEqual((await scan(pk.id, [P(boxes[2])], manager, { reason: 'drill' }))[0].result, 'rejected')
    const pack = await startOp('pack', { orderId: shipped.id })
    await scan(pack.id, [P(boxes[2])])
    ok(await finalize(pack.id))
    const disp = await startOp('dispatch', { orderId: shipped.id })
    await scan(disp.id, [P(boxes[2])])
    ok(await finalize(disp.id))
    const waiting = await paidOrder(1)
    const pk2 = await startOp('pick', { orderId: waiting.id })
    assert.notEqual((await scan(pk2.id, [P(boxes[3])], manager, { reason: 'drill' }))[0].result, 'rejected')

    const rc = ok(await api.post(`${W}/recalls`, { lotIds: [lot.id], reason: 'Drill: pesticide notice' }, { token: manager }), 201)
    // Every affected box still here is held: the untouched ones, the picked one, and all three new boxes.
    const shouldHold = [boxes[3], boxes[4], boxes[5], ...made]
    for (const b of shouldHold) assert.ok((await holdsOf(b.id)).includes('recall_hold'), `${b.code ?? b.id} held`)
    assert.equal(rc.held, shouldHold.length)
    // The dispatched box is reported, not held; the repacked boxes have ended; the other batch's untouched box is free.
    assert.equal((await holdsOf(boxes[2].id)).includes('recall_hold'), false)
    assert.equal((await holdsOf(other.boxes[1].id)).includes('recall_hold'), false)
    const shippedNo = (await query('SELECT number FROM orders WHERE id = $1', [shipped.id])).rows[0].number
    assert.deepEqual(rc.dispatchedOrders.map((o) => o.number), [shippedNo])
    assert.equal(rc.byState.repacked, 2)
    assert.equal(rc.byState.dispatched, 1)
    assert.equal(rc.byState.in_stock, 5, 'two untouched boxes and three new ones')
    assert.equal(rc.byState.picked, 1)
    const pickable = await query(
      `SELECT count(*)::int AS n FROM boxes b WHERE (b.lot_id = $1 OR b.id = ANY($2::uuid[])) AND box_pickable(b.id, $3)`,
      [lot.id, made.map((x) => x.id), todayIST()],
    )
    assert.equal(pickable.rows[0].n, 0, 'nothing from the recalled batch can be picked')
    // Trace from the batch lists the descendants and both orders.
    const trace = ok(await api.get(`${W}/trace/lots/${lot.id}`, { token: manager }))
    for (const x of made) assert.ok(trace.boxes.some((b) => b.id === x.id && b.descendant), x.code)
    const waitingNo = (await query('SELECT number FROM orders WHERE id = $1', [waiting.id])).rows[0].number
    assert.deepEqual(trace.orders.map((o) => o.number).sort(), [shippedNo, waitingNo].sort())
    // The picked box blocks its order's pack until it is replaced.
    const ex = ok(await api.get(`${W}/exceptions`, { token: manager }))
    assert.ok(ex.heldBoxesOnOrders.some((h) => h.boxId === boxes[3].id))
    await booksBalance()
  })
})

// ---------------------------------------------------------------- food safety, recalls, weights, counts and rollback

const condemn = (batchId, token = manager) => api.patch(`/admin/v1/batches/${batchId}/status`, { status: 'CONDEMNED', reason: 'Lab found residue' }, { token })
const pickableNow = async (id) => (await query('SELECT box_pickable($1, $2) AS p', [id, todayIST()])).rows[0].p

describe('repack and condemned fruit', () => {
  test('a box of a condemned batch cannot go into a repack, at scan or at finish, and the good box goes on alone', async () => {
    const a = await stockedLot({ count: 2, harvestedAgo: 5 })
    const b = await stockedLot({ count: 2, harvestedAgo: 3 })
    const packing = (await loc('packing')).id
    // Condemned before the scan: refused at the scan.
    const rp = await startOp('repack', { locationId: packing, reasonCode: 'merge_partials', reason: 'Two part boxes' })
    assert.deepEqual((await scan(rp.id, [P(a.boxes[0]), P(b.boxes[0])])).map((r) => r.code), ['OK', 'OK'])
    ok(await condemn(b.lot.batchId))
    const late = await scan(rp.id, [P(b.boxes[1])])
    assert.deepEqual([late[0].result, late[0].code], ['rejected', 'BATCH_OUT_OF_SERVICE'])
    // Condemned after the scan: the finish refuses it, takes it out, and changes nothing.
    const refused = await finalize(rp.id, { outputs: [{ weightG: 5900 }] })
    assert.equal(refused.status, 409, JSON.stringify(refused.body))
    assert.equal(refused.body.error.code, 'BATCH_OUT_OF_SERVICE')
    assert.deepEqual(refused.body.error.boxes, [formatBoxCode(b.boxes[0].code)])
    assert.equal(refused.body.error.unstage, undefined)
    assert.equal((await box(a.boxes[0].id)).lifecycle, 'in_stock')
    assert.equal(ok(await api.get(`${W}/operations/${rp.id}`, { token: manager })).progress.staged, 1)
    const done = ok(await finalize(rp.id, { outputs: [{ weightG: 2950 }] }))
    const out = await box(done.result.outputs[0].id)
    const origins = (await query('SELECT batch_id FROM box_origins WHERE box_id = $1', [out.id])).rows.map((r) => r.batch_id)
    assert.deepEqual(origins, [a.lot.batchId], 'no condemned fruit in the new box')
    assert.equal((await box(b.boxes[0].id)).lifecycle, 'in_stock', 'the condemned box stays for its write-off')
    await booksBalance()
  })

  test('condemning a batch later holds the merged boxes that carry its fruit on another batch', async () => {
    const a = await stockedLot({ count: 2, harvestedAgo: 5 })
    const b = await stockedLot({ count: 2, harvestedAgo: 3 })
    const rp = await startOp('repack', { locationId: (await loc('packing')).id, reasonCode: 'merge_partials', reason: 'Two part boxes' })
    await scan(rp.id, [P(a.boxes[0]), P(b.boxes[0])])
    const [made] = ok(await finalize(rp.id, { outputs: [{ weightG: 5800 }] })).result.outputs
    const out = await box(made.id)
    assert.equal(out.batch_id, a.lot.batchId, 'on the oldest batch')
    const qc = await startOp('qc', { result: 'passed' })
    await scan(qc.id, [P(out)])
    await moveTo('storage', [out])
    assert.equal(await pickableNow(out.id), true)
    assert.equal((await lineOf(a.lot.lineId)).on_hand, 2)

    const res = ok(await condemn(b.lot.batchId))
    assert.equal(res.heldRepackedBoxes, 1)
    assert.deepEqual(await holdsOf(out.id), ['investigation_hold'])
    assert.equal(await pickableNow(out.id), false, 'condemned fruit is off sale wherever it went')
    assert.equal((await lineOf(a.lot.lineId)).on_hand, 1, 'the good batch counts only its own clean box')
    const ex = ok(await api.get(`${W}/exceptions`, { token: manager }))
    assert.ok(ex.investigations.some((i) => i.boxId === out.id && /condemned batch/.test(i.reason)))
    await booksBalance()
  })
})

describe('recalls that overlap', () => {
  test('a box merged from two recalled lots stays held until both recalls are released', async () => {
    const a = await stockedLot({ count: 2, harvestedAgo: 5 })
    const b = await stockedLot({ count: 2, harvestedAgo: 3 })
    const ra = ok(await api.post(`${W}/recalls`, { lotIds: [a.lot.id], reason: 'Supplier A notice' }, { token: manager }), 201)
    const rb = ok(await api.post(`${W}/recalls`, { lotIds: [b.lot.id], reason: 'Supplier B notice' }, { token: manager }), 201)
    const rp = await startOp('repack', { locationId: (await loc('packing')).id, reasonCode: 'merge_partials', reason: 'Two part boxes' })
    await scan(rp.id, [P(a.boxes[0]), P(b.boxes[0])])
    const [made] = ok(await finalize(rp.id, { outputs: [{ weightG: 5800 }] })).result.outputs
    const qc = await startOp('qc', { result: 'passed' })
    await scan(qc.id, [P(await box(made.id))])
    const recallOf = async (id) => (await query(`SELECT recall_id FROM box_holds WHERE box_id = $1 AND kind = 'recall_hold' AND released_at IS NULL`, [id])).rows.map((r) => r.recall_id)
    assert.equal((await recallOf(made.id)).length, 1)

    // Release the recall the box's hold names: the other one, still in force, takes the box over.
    const first = (await recallOf(made.id))[0]
    const second = first === ra.id ? rb.id : ra.id
    ok(await api.post(`${W}/recalls/${first}/release`, { reason: 'Lab test clear' }, { token: manager }))
    assert.deepEqual(await recallOf(made.id), [second])
    assert.equal(ok(await api.get(`${W}/recalls/${second}`, { token: manager })).held >= 1, true)
    // Still recalled: it cannot be put away as stock.
    const mv = await startOp('move', { locationId: (await loc('storage')).id })
    const refused = await scan(mv.id, [P(await box(made.id))])
    assert.deepEqual([refused[0].result, refused[0].code], ['rejected', 'LOCATION_TYPE_NOT_ALLOWED'])
    ok(await api.post(`${W}/recalls/${second}/release`, { reason: 'Lab test clear' }, { token: manager }))
    assert.deepEqual(await recallOf(made.id), [])
    await moveTo('storage', [await box(made.id)])
    assert.equal(await pickableNow(made.id), true)
    await booksBalance()
  })

  test('a lot in two recalls: releasing one leaves its boxes held by the other', async () => {
    const { lot, boxes } = await stockedLot({ count: 2 })
    const r1 = ok(await api.post(`${W}/recalls`, { lotIds: [lot.id], reason: 'Notice one' }, { token: manager }), 201)
    const r2 = ok(await api.post(`${W}/recalls`, { lotIds: [lot.id], reason: 'Notice two' }, { token: manager }), 201)
    assert.equal(r2.held, 0, 'already held by the first')
    ok(await api.post(`${W}/recalls/${r1.id}/release`, { reason: 'Notice one withdrawn' }, { token: manager }))
    for (const b of boxes) assert.deepEqual(await holdsOf(b.id), ['recall_hold'])
    assert.equal((await lineOf(lot.lineId)).on_hand, 0)
    ok(await api.post(`${W}/recalls/${r2.id}/release`, { reason: 'Notice two withdrawn' }, { token: manager }))
    for (const b of boxes) assert.deepEqual(await holdsOf(b.id), [])
    assert.equal((await lineOf(lot.lineId)).on_hand, 2)
    await booksBalance()
  })
})

describe('repack weights', () => {
  test('what went in must equal the new boxes plus the weight taken out, within the weighing tolerance', async () => {
    const { boxes } = await stockedLot({ count: 4 })
    const packing = (await loc('packing')).id
    const rp = await startOp('repack', { locationId: packing, reasonCode: 'spoiled_fruit', reason: 'Soft fruit out' })
    await scan(rp.id, [P(boxes[0]), P(boxes[1])])
    // 6 kg in, 1 kg out, nothing recorded as taken out.
    const vanished = await finalize(rp.id, { outputs: [{ weightG: 1000 }], fruitRemoved: 0, weightLostG: 0 })
    assert.deepEqual([vanished.status, vanished.body.error.code], [400, 'WEIGHT_MISMATCH'])
    // More accounted for than went in.
    const tooMuch = await finalize(rp.id, { outputs: [{ weightG: 3000 }], weightLostG: 4000 })
    assert.deepEqual([tooMuch.status, tooMuch.body.error.code], [400, 'WEIGHT_MISMATCH'])
    assert.equal((await box(boxes[0].id)).lifecycle, 'in_stock')
    // Within 3% of 6 kg (180 g) is fine.
    const done = ok(await finalize(rp.id, { outputs: [{ weightG: 4000 }], fruitRemoved: 6, weightLostG: 1850 }))
    assert.equal(done.status, 'completed')

    // Left out, the weight taken out is recorded as what the scales say went.
    const rp2 = await startOp('repack', { locationId: packing, reasonCode: 'spoiled_fruit', reason: 'Two soft fruit' })
    await scan(rp2.id, [P(boxes[2])])
    ok(await finalize(rp2.id, { outputs: [{ weightG: 2400 }], fruitRemoved: 2 }))
    const rec = (await query('SELECT fruit_removed, weight_lost_g FROM wh_repacks WHERE operation_id = $1', [rp2.id])).rows[0]
    assert.deepEqual([rec.fruit_removed, rec.weight_lost_g], [2, 600])
    await booksBalance()
  })

  test('fruit counts add up when every box in and out has one', async () => {
    const { boxes } = await stockedLot({ count: 2 })
    await query('UPDATE boxes SET fruit_count = 12 WHERE id = $1', [boxes[0].id])
    const rp = await startOp('repack', { locationId: (await loc('packing')).id, reasonCode: 'spoiled_fruit', reason: 'Soft fruit out' })
    await scan(rp.id, [P(boxes[0])])
    const wrong = await finalize(rp.id, { outputs: [{ weightG: 2500, fruitCount: 11 }], fruitRemoved: 2 })
    assert.deepEqual([wrong.status, wrong.body.error.code], [400, 'FRUIT_MISMATCH'])
    ok(await finalize(rp.id, { outputs: [{ weightG: 2500, fruitCount: 10 }], fruitRemoved: 2 }))
    await booksBalance()
  })

  test('partial damage with fruit taken out of a box with no fruit count needs the weight', async () => {
    const { boxes } = await stockedLot({ count: 1 })
    const r = await api.post(`${W}/boxes/${boxes[0].id}/damage`, { fruitRemoved: 3, reasonCode: 'spoiled_fruit', reason: 'three soft' }, { token: manager })
    assert.equal(r.status, 400)
    assert.match(r.body.error.message, /no fruit count/)
    const after = await box(boxes[0].id)
    assert.deepEqual([after.fruit_count, after.measured_weight_g ?? after.nominal_weight_g], [null, 3000])
    const events = ok(await api.get(`${W}/boxes/${boxes[0].id}/events`, { token: manager })).map((e) => e.type)
    assert.equal(events.includes('PARTIAL_DAMAGE'), false)
  })
})

describe('stocktake review rules', () => {
  test('the counter reviews their own count only as a manager', async () => {
    const { boxes } = await stockedLot({ count: 2 })
    const op = await ops()
    const count = await startOp('stocktake', { locationId: (await loc('storage')).id }, op)
    await scan(count.id, [P(boxes[0])], op)
    ok(await finalize(count.id, {}, op))
    const self = await api.post(`${W}/stocktakes/${count.id}/review`, { missing: [boxes[1].id] }, { token: op })
    assert.deepEqual([self.status, self.body.error.code], [403, 'SELF_REVIEW'])
    assert.equal((await box(boxes[1].id)).lifecycle, 'in_stock')
    ok(await api.post(`${W}/stocktakes/${count.id}/review`, { missing: [boxes[1].id] }, { token: manager }))
    assert.equal((await box(boxes[1].id)).lifecycle, 'missing')
    await booksBalance()
  })

  test('rest decides every box not listed; boxes on an order are kept, held and show as exceptions', async () => {
    const { lot, boxes } = await stockedLot({ count: 5 })
    const o = await paidOrder(1)
    const pick = await startOp('pick', { orderId: o.id })
    assert.notEqual((await scan(pick.id, [P(boxes[0])], manager, { reason: 'test' }))[0].result, 'rejected')
    // Pick staging holds the picked box; storage holds the other four. Count storage and find only one.
    tick()
    const count = await startOp('stocktake', { locationId: (await loc('storage')).id })
    await scan(count.id, [P(boxes[1])])
    ok(await finalize(count.id))
    const staging = await startOp('stocktake', { locationId: (await loc('pick_staging')).id })
    const r2 = ok(await finalize(staging.id))
    assert.equal(r2.result.notFoundAllocated, 1)

    // One short request for the shelf: keep box 2, the rest missing.
    const review = ok(await api.post(`${W}/stocktakes/${count.id}/review`, { keep: [boxes[2].id], rest: 'missing' }, { token: (await ops()) }))
    assert.deepEqual([review.status, review.missing, review.kept], ['applied', 2, 1])
    assert.deepEqual([(await box(boxes[3].id)).lifecycle, (await box(boxes[4].id)).lifecycle, (await box(boxes[2].id)).lifecycle], ['missing', 'missing', 'in_stock'])
    assert.equal((await lineOf(lot.lineId)).on_hand, 2)

    // rest: missing still keeps the picked box (it can only be kept), and holds it for someone to find.
    const kept = ok(await api.post(`${W}/stocktakes/${staging.id}/review`, { rest: 'missing' }, { token: (await ops()) }))
    assert.deepEqual([kept.missing, kept.kept, kept.heldToFind], [0, 1, 1])
    assert.equal((await box(boxes[0].id)).lifecycle, 'picked')
    assert.deepEqual(await holdsOf(boxes[0].id), ['investigation_hold'])
    const ex = ok(await api.get(`${W}/exceptions`, { token: manager }))
    assert.ok(ex.heldBoxesOnOrders.some((h) => h.boxId === boxes[0].id && h.orderId === o.id))
    assert.ok(ex.investigations.some((i) => i.boxId === boxes[0].id && /Not found in a count/.test(i.reason)))
    await booksBalance()
  })
})

describe('staged sessions after a refused finish', () => {
  test('a pack finish that finds a box changed takes it out of the session, so the next finish goes through', async () => {
    const { boxes } = await stockedLot({ count: 3 })
    const o = await paidOrder(1)
    const pick = await startOp('pick', { orderId: o.id })
    await scan(pick.id, [P(boxes[0])], manager, { reason: 'test' })
    const pack = await startOp('pack', { orderId: o.id })
    assert.equal((await scan(pack.id, [P(boxes[0])]))[0].result, 'accepted')
    // A box staged here that is no longer this order's (as when it changed after its scan).
    await query('INSERT INTO wh_staged (operation_id, box_id, scan_id, staged_at) VALUES ($1, $2, $3, now())', [pack.id, boxes[1].id, randomUUID()])
    const refused = await finalize(pack.id)
    assert.deepEqual([refused.status, refused.body.error.code], [409, 'STALE_SCAN'])
    assert.deepEqual(refused.body.error.boxes, [formatBoxCode(boxes[1].code)])
    assert.equal(refused.body.error.unstage, undefined, 'internal ids stay on the server')
    assert.equal(ok(await api.get(`${W}/operations/${pack.id}`, { token: manager })).progress.staged, 1)
    const done = ok(await finalize(pack.id))
    assert.equal(done.status, 'completed')
    assert.equal((await box(boxes[0].id)).lifecycle, 'packed')
    assert.equal((await box(boxes[1].id)).lifecycle, 'in_stock')
    await booksBalance()
  })
})

describe('lot counts with repacked boxes (rollback safety)', () => {
  test('new boxes count on their lot like any label, so the previous release reads consistent lot counts', async () => {
    const { lot, boxes } = await stockedLot({ count: 2 })
    const rp = await startOp('repack', { locationId: (await loc('packing')).id, reasonCode: 'split', reason: 'Split for two orders' })
    await scan(rp.id, [P(boxes[0])])
    ok(await finalize(rp.id, { outputs: [{ weightG: 1500 }, { weightG: 1500 }] }))
    const stored = (await query('SELECT target_count, generated_count, verified_count, voided_count FROM box_lots WHERE id = $1', [lot.id])).rows[0]
    // The previous release recounts a lot over every one of its boxes (034's refreshLotCounts, no filter).
    const actual = (await query(
      `SELECT count(*)::int AS generated, count(*) FILTER (WHERE verification IS NOT NULL)::int AS verified, count(*) FILTER (WHERE lifecycle = 'voided')::int AS voided FROM boxes WHERE lot_id = $1`,
      [lot.id],
    )).rows[0]
    assert.deepEqual([stored.generated_count, stored.verified_count, stored.voided_count], [actual.generated, actual.verified, actual.voided])
    assert.deepEqual([stored.target_count, actual.generated], [4, 4])
    // That recount, run as the previous release runs it, keeps every lot check.
    await query(
      `UPDATE box_lots l SET generated_count = x.generated, verified_count = x.verified, voided_count = x.voided
         FROM (SELECT count(*)::int AS generated, count(*) FILTER (WHERE verification IS NOT NULL)::int AS verified,
                      count(*) FILTER (WHERE lifecycle = 'voided')::int AS voided FROM boxes WHERE lot_id = $1) x WHERE l.id = $1`,
      [lot.id],
    )
    // Adding intake boxes later numbers them below the repack range and keeps the counts.
    ok(await api.post(`${W}/lots/${lot.id}/add-boxes`, { count: 1, reason: 'One more on the truck' }, { token: manager }))
    const seqs = (await query('SELECT seq FROM boxes WHERE lot_id = $1 ORDER BY seq', [lot.id])).rows.map((r) => r.seq)
    assert.deepEqual(seqs, [1, 2, 3, 1_000_001, 1_000_002])
    await booksBalance()
  })
})
