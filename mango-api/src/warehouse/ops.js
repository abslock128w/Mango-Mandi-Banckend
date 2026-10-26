// The scan engine (docs/warehouse/SCANNING.md).
//
// Staff start an operation with a fixed context (a lot to receive, a place to
// move boxes to, a QC result, an order to pick, pack or dispatch), then scan
// boxes into it. Immediate operations (receive, move, QC, pick, unpick,
// return) commit each accepted scan in its own transaction. Staged operations
// (pack, dispatch, stocktake, repack) only collect scans; finalize checks the
// whole set again under locks and applies it all or nothing.
//
// Every scan carries a client-made scan_id. Sending the same scan_id again
// (a retry after a dropped connection) returns the stored result and changes
// nothing. Scans of one operation are serialised by locking the operation row.
import { now } from '../clock.js'
import { getConfig } from '../config.js'
import { tx } from '../db.js'
import { env } from '../env.js'
import { HttpError } from '../errors.js'
import { newId } from '../ids.js'
import { ledger, lineInfo, pack, release, sellableAs } from '../inventory.js'
import { logger } from '../logger.js'
import { addEvent, assertTransition, lockOrder, rebalanceOrder, setOrderStatus } from '../orders.js'
import { hit } from '../ratelimit.js'
import { formatBoxCode, parseScan } from './codes.js'
import {
  addHold, applyLineDeltas, changeBox, lockBox, lockBoxes, moveProblem, newDeltas, pickProblem, readBox, releaseHold, trackedLine, WhError, whError,
} from './core.js'
import { finishReceiving, receivingPlace } from './lots.js'
import { can, featureOn, OP_PERMISSION } from './permissions.js'
import { finalizeRepack, repackContext, repackScan } from './repack.js'
import { pickUnit, stagingPlace, unpickUnit } from './stock.js'
import { finalizeStocktake, stocktakeContext, stocktakeCounts, stocktakeScan } from './stocktake.js'

export const OP_TYPES = Object.keys(OP_PERMISSION)
export const OP_CLASS = Object.freeze({
  receive: 'immediate', move: 'immediate', qc: 'immediate', pick: 'immediate', unpick: 'immediate', return: 'immediate',
  pack: 'staged', dispatch: 'staged', stocktake: 'staged', repack: 'staged',
})

/** False while the operation type's own feature flag is off (stocktake, repack): such sessions are treated as not there. */
export const opTypeOn = (type) => featureOn(OP_PERMISSION[type], env)
export const MAX_SCANS_PER_REQUEST = 50
/** Unknown codes one person may scan per minute before scans are refused (someone scanning random labels). */
export const UNKNOWN_LIMIT = 20

const PICKABLE_ORDER = ['CONFIRMED', 'PROCESSING']
const UNPICKABLE_ORDER = ['CONFIRMED', 'PROCESSING', 'PACKED']
const QC_RESULTS = ['passed', 'failed', 'needs_review']

const need = (who, perm) => {
  if (!can(who.role, perm)) throw whError('FORBIDDEN', 'Your role cannot do this in the warehouse.', 403)
}

const opView = (op, extra = {}) => ({
  id: op.id, type: op.type, class: op.class, status: op.status, context: op.context, locationId: op.location_id, orderId: op.order_id,
  lotId: op.lot_id, ownerId: op.owner_id, startedAt: op.started_at, lastActivityAt: op.last_activity_at, finishedAt: op.finished_at,
  accepted: op.accepted_count, rejected: op.rejected_count, duplicates: op.duplicate_count, result: op.result, ...extra,
})

const scanView = (s, extra = {}) => ({
  scanId: s.scan_id, seq: s.seq, result: s.result, code: s.code, message: s.message, detail: s.detail ?? null, boxId: s.box_id,
  receivedAt: s.received_at, ...extra,
})

/** An operation open longer than the idle limit without a scan has expired; its staged scans are dropped. */
async function expireIfIdle(c, op) {
  if (op.status !== 'open') return op
  const idle = env.WAREHOUSE_OP_IDLE_MINUTES * 60_000
  if (now().getTime() - new Date(op.last_activity_at).getTime() <= idle) return op
  await c.query('DELETE FROM wh_staged WHERE operation_id = $1', [op.id])
  const { rows } = await c.query(`UPDATE wh_operations SET status = 'expired', finished_at = $2 WHERE id = $1 RETURNING *`, [op.id, now()])
  return rows[0]
}

/** Expires every idle operation (the maintenance job; reads also expire lazily). Returns how many. */
export async function expireIdleOperations(c) {
  const cutoff = new Date(now().getTime() - env.WAREHOUSE_OP_IDLE_MINUTES * 60_000)
  const { rows } = await c.query(`SELECT * FROM wh_operations WHERE status = 'open' AND last_activity_at < $1 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 500`, [cutoff])
  for (const op of rows) await expireIfIdle(c, op)
  return rows.length
}

async function lockOp(c, opId, who) {
  const { rows } = await c.query('SELECT * FROM wh_operations WHERE id = $1 AND warehouse_id = $2 FOR UPDATE', [opId, who.warehouseId])
  if (!rows.length || !opTypeOn(rows[0].type)) throw whError('NOT_FOUND', 'Operation not found', 404)
  return expireIfIdle(c, rows[0])
}

const ownerOnly = (op, who) => {
  if (op.owner_id !== who.actor.id) throw whError('FORBIDDEN', 'This scan session belongs to someone else. Start your own.', 403)
}

const closedError = (op) => whError('OPERATION_CLOSED', `This scan session is ${op.status}. Start a new one.`)

// ---------------------------------------------------------------- start

async function orderFor(c, orderId) {
  const { rows } = await c.query('SELECT * FROM orders WHERE id = $1', [orderId])
  if (!rows.length) throw whError('NOT_FOUND', 'Order not found', 404)
  return rows[0]
}

/** D12: only an order whose payment is captured (or a free replacement) is picked. */
const paidOrReplacement = (o) => o.payment_status === 'SUCCEEDED' || Boolean(o.replacement_for)

async function locationIn(c, id, warehouseId) {
  const { rows } = await c.query('SELECT * FROM wh_locations WHERE id = $1 AND warehouse_id = $2', [id, warehouseId])
  if (!rows.length) throw whError('NOT_FOUND', 'Location not found', 404)
  return rows[0]
}

/**
 * Starts an operation. `context` is fixed for its life. Pack and dispatch
 * allow one open session per order: starting again returns your own open
 * session, and someone else's is refused (OPERATION_LOCKED).
 */
export async function startOperation(c, { type, context = {} }, who) {
  if (!OP_TYPES.includes(type)) throw whError('VALIDATION_ERROR', `Unknown operation ${type}`, 400)
  if (!opTypeOn(type)) throw whError('NOT_FOUND', 'Not found', 404)
  need(who, OP_PERMISSION[type])
  const at = now()
  const op = { id: newId('wop'), type, class: OP_CLASS[type], context: {}, location_id: null, order_id: null, lot_id: null }
  if (type === 'receive') {
    const { rows } = await c.query('SELECT * FROM box_lots WHERE id = $1 AND warehouse_id = $2', [context.lotId, who.warehouseId])
    const lot = rows[0]
    if (!lot) throw whError('NOT_FOUND', 'Lot not found', 404)
    if (!['receiving', 'received'].includes(lot.status)) {
      throw whError('INVALID_TRANSITION', lot.status === 'generating' ? 'This lot is still making its labels. Finish it first.' : `This lot is ${lot.status}`)
    }
    const loc = await receivingPlace(c, who.warehouseId, context.locationId ?? null)
    op.lot_id = lot.id
    op.location_id = loc.id
    op.context = { lotId: lot.id, lotCode: lot.code, locationId: loc.id, locationName: loc.name }
  } else if (type === 'move') {
    if (!context.locationId) throw whError('VALIDATION_ERROR', 'Choose where the boxes are going (scan the location label)', 400)
    const loc = await locationIn(c, context.locationId, who.warehouseId)
    if (!loc.active) throw whError('LOCATION_INACTIVE', `${loc.name} is switched off`)
    op.location_id = loc.id
    op.context = { locationId: loc.id, locationName: loc.name, locationType: loc.type }
  } else if (type === 'qc') {
    if (!QC_RESULTS.includes(context.result)) throw whError('VALIDATION_ERROR', 'Choose the QC result: passed, failed or needs review', 400)
    const codes = Array.isArray(context.reasonCodes) ? [...new Set(context.reasonCodes.map(String))].slice(0, 10) : []
    if (context.result !== 'passed' && !codes.length) throw whError('VALIDATION_ERROR', 'Pick at least one reason for a failed or review result', 400)
    const note = String(context.note ?? '').trim().slice(0, 300) || null
    op.context = { result: context.result, reasonCodes: codes, note }
  } else if (type === 'stocktake') {
    op.context = await stocktakeContext(c, context, who, at)
    op.location_id = op.context.locationId
    // One open count per location (a unique index backs this): resume your own, or wait for the other person's.
    const { rows } = await c.query(`SELECT * FROM wh_operations WHERE location_id = $1 AND type = 'stocktake' AND status IN ('open', 'finalizing') FOR UPDATE`, [op.location_id])
    for (const open of rows) {
      const fresh = await expireIfIdle(c, open)
      if (fresh.status !== 'open') continue
      if (fresh.owner_id === who.actor.id) return opView(fresh, { resumed: true })
      throw whError('OPERATION_LOCKED', `Someone else is already counting ${op.context.locationName}.`)
    }
  } else if (type === 'repack') {
    op.context = await repackContext(c, context, who)
    op.location_id = op.context.locationId
  } else {
    if (!context.orderId) throw whError('VALIDATION_ERROR', 'Choose the order', 400)
    await lockOrder(c, context.orderId)
    const o = await orderFor(c, context.orderId)
    op.order_id = o.id
    const reason = String(context.reason ?? '').trim().slice(0, 300)
    if (type === 'pick') {
      if (!PICKABLE_ORDER.includes(o.status)) throw whError('INVALID_TRANSITION', `Order ${o.number} is ${o.status.toLowerCase().replace(/_/g, ' ')}; only confirmed orders are picked`)
      if (!paidOrReplacement(o)) throw whError('PAYMENT_NOT_CAPTURED', `Order ${o.number} is not paid yet`)
    } else if (type === 'unpick') {
      if (!reason) throw whError('VALIDATION_ERROR', 'Say why the boxes are coming off the order', 400)
    } else if (type === 'pack') {
      if (!PICKABLE_ORDER.includes(o.status)) throw whError('INVALID_TRANSITION', `Order ${o.number} is ${o.status.toLowerCase().replace(/_/g, ' ')}`)
    } else if (type === 'dispatch') {
      if (o.status !== 'PACKED') throw whError('INVALID_TRANSITION', `Order ${o.number} is ${o.status.toLowerCase().replace(/_/g, ' ')}; only packed orders are dispatched`)
    } else if (type === 'return') {
      const loc = context.locationId
        ? await locationIn(c, context.locationId, who.warehouseId)
        : (await c.query(`SELECT * FROM wh_locations WHERE warehouse_id = $1 AND type = 'returns' AND active ORDER BY created_at, id LIMIT 1`, [who.warehouseId])).rows[0]
      if (!loc) throw whError('LOCATION_INACTIVE', 'No active returns location. Add one on the Locations page.')
      if (loc.type !== 'returns') throw whError('LOCATION_TYPE_NOT_ALLOWED', 'Returned boxes go to a returns location')
      op.location_id = loc.id
    }
    op.context = { orderId: o.id, orderNumber: o.number, ...(reason ? { reason } : {}), ...(op.location_id ? { locationId: op.location_id } : {}) }
    if (OP_CLASS[type] === 'staged') {
      const { rows } = await c.query(`SELECT * FROM wh_operations WHERE order_id = $1 AND type = $2 AND status = 'open' FOR UPDATE`, [o.id, type])
      for (const open of rows) {
        const fresh = await expireIfIdle(c, open)
        if (fresh.status !== 'open') continue
        if (fresh.owner_id === who.actor.id) return opView(fresh, { resumed: true })
        throw whError('OPERATION_LOCKED', `Someone else is already ${type === 'pack' ? 'packing' : 'dispatching'} order ${o.number}.`)
      }
    }
  }
  await c.query('SAVEPOINT start_op')
  try {
    const { rows } = await c.query(
      `INSERT INTO wh_operations (id, type, class, warehouse_id, context, location_id, order_id, lot_id, status, owner_id, started_at, last_activity_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10, $10) RETURNING *`,
      [op.id, type, op.class, who.warehouseId, op.context, op.location_id, op.order_id, op.lot_id, who.actor.id, at],
    )
    await c.query('RELEASE SAVEPOINT start_op')
    return opView(rows[0])
  } catch (err) {
    await c.query('ROLLBACK TO SAVEPOINT start_op')
    // Two people starting a count of the same place at the same moment: the index lets one in.
    if (err.code === '23505' && err.constraint === 'wh_operations_one_open_stocktake') throw whError('OPERATION_LOCKED', `Someone else is already counting ${op.context.locationName}.`)
    throw err
  }
}

// ---------------------------------------------------------------- scans

/**
 * Submits up to MAX_SCANS_PER_REQUEST scans, in order. Each is its own
 * transaction, so one rejected scan never undoes the others. Returns one
 * result per scan.
 */
export async function submitScans(opId, scans, who) {
  if (!Array.isArray(scans) || !scans.length) throw whError('VALIDATION_ERROR', 'Send at least one scan', 400)
  if (scans.length > MAX_SCANS_PER_REQUEST) throw whError('VALIDATION_ERROR', `Send at most ${MAX_SCANS_PER_REQUEST} scans at a time`, 400)
  const results = []
  for (const s of scans) {
    try {
      results.push(await tx((c) => scanOne(c, opId, s, who), { retries: 3 }))
    } catch (err) {
      // Operation-level problems (not found, someone else's session) apply to every scan: stop.
      if (err instanceof WhError && ['NOT_FOUND', 'FORBIDDEN'].includes(err.code)) throw err
      if (err instanceof HttpError && err.code === 'CONFLICT_RETRY_EXHAUSTED') {
        // Nothing was stored, so the same scan_id can be sent again.
        results.push({ scanId: s.scanId, result: 'rejected', code: err.code, message: err.message, stored: false })
        continue
      }
      throw err
    }
  }
  return results
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function scanOne(c, opId, s, who) {
  if (!UUID.test(String(s?.scanId ?? ''))) throw whError('VALIDATION_ERROR', 'Each scan needs a scanId (a UUID made on the device)', 400)
  const input = String(s.input ?? '').slice(0, 128)
  const op = await lockOp(c, opId, who)
  ownerOnly(op, who)
  need(who, OP_PERMISSION[op.type])

  // 1. A retry of a scan already stored: the same answer, nothing changes.
  const prior = (await c.query('SELECT * FROM wh_scans WHERE scan_id = $1', [s.scanId])).rows[0]
  if (prior) {
    if (prior.operation_id !== op.id) throw whError('VALIDATION_ERROR', 'This scanId was used in another session', 400)
    await c.query('UPDATE wh_scans SET attempts = attempts + 1 WHERE id = $1', [prior.id])
    return scanView(prior, { replayed: true })
  }

  const seq = (await c.query('SELECT coalesce(max(seq), 0)::int + 1 AS n FROM wh_scans WHERE operation_id = $1', [op.id])).rows[0].n
  const at = now()
  const clientAt = s.clientScannedAt && !Number.isNaN(Date.parse(s.clientScannedAt)) ? new Date(s.clientScannedAt) : null
  const store = async (boxId, result, code, message, detail = null) => {
    const { rows } = await c.query(
      `INSERT INTO wh_scans (id, scan_id, operation_id, seq, input, box_id, result, code, message, detail, received_at, client_scanned_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [newId('wsc'), s.scanId, op.id, seq, input || '-', boxId, result, code, message, detail, at, clientAt],
    )
    const col = result === 'duplicate' ? 'duplicate_count' : result === 'rejected' ? 'rejected_count' : 'accepted_count'
    await c.query(`UPDATE wh_operations SET ${col} = ${col} + 1, last_activity_at = $2 WHERE id = $1`, [op.id, at])
    return scanView(rows[0])
  }

  if (op.status !== 'open') {
    const e = closedError(op)
    return store(null, 'rejected', e.code, e.message)
  }

  // 2. What was scanned.
  const parsed = parseScan(input)
  if (parsed.error) {
    const msg = { MALFORMED_CODE: 'Not a MandiMangoes label.', INVALID_CHECK_DIGIT: 'That code has a typo: check the last character.', TOO_LONG: 'Too long to be a label.' }
    return store(null, 'rejected', parsed.error, msg[parsed.error])
  }
  if (parsed.kind === 'location') {
    const loc = (await c.query('SELECT id, name, type, warehouse_id, active FROM wh_locations WHERE label_token = $1', [parsed.token])).rows[0]
    if (loc && loc.warehouse_id === who.warehouseId) {
      return store(null, 'rejected', 'WRONG_LABEL_TYPE', `That is the ${loc.name} location label, not a box.`, { location: { id: loc.id, name: loc.name, type: loc.type, active: loc.active } })
    }
    return unknown(c, who, store)
  }
  if (parsed.kind === 'container') return store(null, 'rejected', 'WRONG_LABEL_TYPE', 'Containers are not in use yet: scan the boxes.')

  let boxId = null
  if (parsed.kind === 'box') {
    const label = (await c.query('SELECT box_id, revoked_at FROM box_labels WHERE token = $1', [parsed.token])).rows[0]
    if (!label) return unknown(c, who, store)
    if (label.revoked_at) {
      const b = await readBox(c, label.box_id)
      if (b?.warehouse_id !== who.warehouseId) return unknown(c, who, store)
      return store(label.box_id, 'rejected', 'LABEL_REVOKED', `This old label was replaced. Use the new label on box ${b.code}.`)
    }
    boxId = label.box_id
  } else {
    const b = (await c.query('SELECT id FROM boxes WHERE code = $1', [parsed.code])).rows[0]
    if (!b) return unknown(c, who, store)
    boxId = b.id
  }
  const box = await readBox(c, boxId)
  if (box.warehouse_id !== who.warehouseId) return store(null, 'rejected', 'WRONG_WAREHOUSE', 'This box belongs to another warehouse.')

  // 3. The same box twice in one session.
  const again = (await c.query(`SELECT 1 FROM wh_scans WHERE operation_id = $1 AND box_id = $2 AND result IN ('accepted', 'warning')`, [op.id, box.id])).rowCount
  if (again) return store(box.id, 'duplicate', 'ALREADY_SCANNED', `Box ${formatBoxCode(box.code)} is already scanned in this session.`)

  // 4. The operation's own rules, inside a savepoint so a refusal leaves nothing behind.
  const deltas = newDeltas()
  await c.query('SAVEPOINT scan')
  let out
  try {
    out = await HANDLERS[op.type](c, op, box, s, who, deltas)
    const short = await applyLineDeltas(c, deltas, who.actor, `Scan ${op.type} (${formatBoxCode(box.code)})`)
    if (short.atRisk.length || short.moved.length || short.refilled.length) out.detail = { ...(out.detail ?? {}), shortfall: short }
    await c.query('RELEASE SAVEPOINT scan')
  } catch (err) {
    await c.query('ROLLBACK TO SAVEPOINT scan')
    // A lost race is retried by the client with the same scanId; anything unexpected is a 500.
    if (err.code === 'CONFLICT_RETRY_EXHAUSTED' || !(err instanceof HttpError) || err.status >= 500) throw err
    return store(box.id, 'rejected', err.code, err.message, err.extra ?? null)
  }
  return store(box.id, out.result ?? 'accepted', out.code ?? 'OK', out.message, out.detail ?? null)
}

async function unknown(c, who, store) {
  const { hits } = await hit(`wh-unknown:${who.actor.id}`, 60_000)
  if (hits > UNKNOWN_LIMIT) {
    logger.warn({ adminId: who.actor.id, hits }, 'warehouse: many unknown codes scanned')
    return store(null, 'rejected', 'RATE_LIMITED', 'Too many unknown labels in a minute. Wait a moment and check you are scanning MandiMangoes labels.')
  }
  return store(null, 'rejected', 'UNKNOWN_CODE', 'Label not recognised.')
}

const reject = (code, message, extra) => {
  throw whError(code, message, 409, extra)
}

const ev = (op, s, who, type, extra = {}) => ({ type, actor: who.actor, operationId: op.id, scanId: s.scanId, ...extra })

// ---------------------------------------------------------------- handlers

const HANDLERS = {
  async receive(c, op, box0, s, who, deltas) {
    const box = await lockBox(c, box0.id)
    if (box.lot_id !== op.lot_id) {
      const lot = (await c.query('SELECT code FROM box_lots WHERE id = $1', [box.lot_id])).rows[0]
      reject('WRONG_BATCH', `Box ${formatBoxCode(box.code)} is from batch ${lot?.code}, not ${op.context.lotCode}. Put it aside.`)
    }
    if (box.lifecycle !== 'generated') {
      if (box.lifecycle === 'voided') reject('INVALID_TRANSITION', `Box ${formatBoxCode(box.code)} was voided. Put it aside for a supervisor.`)
      reject('ALREADY_RECEIVED', `Box ${formatBoxCode(box.code)} was already received.`)
    }
    const lot = (await c.query('SELECT * FROM box_lots WHERE id = $1 FOR UPDATE', [op.lot_id])).rows[0]
    if (!['receiving', 'received'].includes(lot.status)) reject('INVALID_TRANSITION', `Lot ${lot.code} is ${lot.status}`)
    const loc = (await c.query('SELECT * FROM wh_locations WHERE id = $1', [op.location_id])).rows[0]
    if (!loc?.active) reject('LOCATION_INACTIVE', `${loc?.name ?? 'The receiving place'} is switched off. Start a new session.`)
    const changes = { lifecycle: 'in_stock', location_id: loc.id, verification: lot.is_legacy ? 'legacy' : 'scanned' }
    const w = weight(s)
    if (w) changes.measured_weight_g = w
    await changeBox(c, box, changes, ev(op, s, who, 'RECEIVED', { meta: w ? { weightG: w } : null }), deltas)
    const after = await finishReceiving(c, lot.id)
    return { message: `${formatBoxCode(box.code)} received (${after.verified_count} of ${after.target_count - after.voided_count}).`, detail: { verified: after.verified_count, target: after.target_count - after.voided_count } }
  },

  async move(c, op, box0, s, who, deltas) {
    const box = await lockBox(c, box0.id)
    const loc = (await c.query('SELECT * FROM wh_locations WHERE id = $1', [op.location_id])).rows[0]
    if (box.location_id === loc.id) return { result: 'warning', code: 'ALREADY_AT_LOCATION', message: `${formatBoxCode(box.code)} is already in ${loc.name}.` }
    const p = moveProblem(box, loc)
    if (p) reject(...p)
    await changeBox(c, box, { location_id: loc.id }, ev(op, s, who, 'MOVED'), deltas)
    return { message: `${formatBoxCode(box.code)} → ${loc.name}.` }
  },

  async qc(c, op, box0, s, who, deltas) {
    const box = await lockBox(c, box0.id)
    if (!['in_stock', 'returned'].includes(box.lifecycle)) {
      if (box.lifecycle === 'generated') reject('INVALID_TRANSITION', `Box ${formatBoxCode(box.code)} is not received yet. Receive it first.`)
      reject('INVALID_TRANSITION', `Box ${formatBoxCode(box.code)} is ${box.lifecycle}; take it off its order before QC.`)
    }
    const product = (await c.query('SELECT qc_checklist, weight_tolerance_pct FROM products WHERE sku = $1', [box.sku])).rows[0]
    const { result: wanted, reasonCodes, note } = op.context
    const bad = reasonCodes.filter((r) => !(product.qc_checklist ?? []).includes(r))
    if (bad.length) reject('VALIDATION_ERROR', `${bad.join(', ')} is not a QC reason for ${box.sku_name}`)
    const w = weight(s)
    let result = wanted
    let warning = null
    if (w) {
      const off = Math.abs(w - box.nominal_weight_g) / box.nominal_weight_g * 100
      if (off > Number(product.weight_tolerance_pct)) {
        if (result === 'passed') {
          result = 'needs_review'
          warning = `${w} g is outside ±${Number(product.weight_tolerance_pct)}% of ${box.nominal_weight_g} g: marked for review.`
        }
      }
    }
    if (result === 'passed') {
      if (box.quality === 'failed') {
        if (!can(who.role, 'qc.override')) reject('QC_OVERRIDE_REQUIRED', `Box ${formatBoxCode(box.code)} failed QC. A manager must pass it.`)
        const last = (await c.query(`SELECT actor_id FROM box_events WHERE box_id = $1 AND to_quality = 'failed' ORDER BY created_at DESC, id DESC LIMIT 1`, [box.id])).rows[0]
        if (last?.actor_id === who.actor.id) reject('SELF_APPROVAL', 'You failed this box: another manager must pass it.')
      }
      if (box.quality === 'passed' && !box.holds.includes('qc_hold')) return { result: 'warning', code: 'ALREADY_DONE', message: `${formatBoxCode(box.code)} already passed QC.` }
      if (box.quality !== 'passed') {
        await changeBox(c, box, { quality: 'passed', ...(w ? { measured_weight_g: w } : {}) }, ev(op, s, who, 'QC_PASSED', { reason: note, meta: w ? { weightG: w } : null }), deltas)
      }
      await releaseHold(c, box, 'qc_hold', 'QC passed', ev(op, s, who, 'HOLD_RELEASED'), deltas)
      return { message: `${formatBoxCode(box.code)} passed QC.` }
    }
    const codes = warning ? [...new Set([...reasonCodes, 'UNDERWEIGHT'].filter((r) => (product.qc_checklist ?? []).includes(r)))] : reasonCodes
    await changeBox(
      c, box, { quality: result, ...(w ? { measured_weight_g: w } : {}) },
      ev(op, s, who, result === 'failed' ? 'QC_FAILED' : 'QC_REVIEW', { reasonCode: codes[0] ?? 'weight', reason: note ?? warning, meta: { reasonCodes: codes, ...(w ? { weightG: w } : {}) } }),
      deltas,
    )
    const msg = result === 'failed' ? `${formatBoxCode(box.code)} failed QC: move it to QC hold.` : `${formatBoxCode(box.code)} marked for review: move it to QC hold.`
    return warning ? { result: 'warning', code: 'WEIGHT_OUT_OF_TOLERANCE', message: warning } : { message: msg }
  },

  async pick(c, op, box0, s, who) {
    const o = await lockOrder(c, op.order_id)
    if (!PICKABLE_ORDER.includes(o.status)) reject('INVALID_TRANSITION', `Order ${o.number} is ${o.status.toLowerCase().replace(/_/g, ' ')}; picking has stopped.`)
    if (!paidOrReplacement(o)) reject('PAYMENT_NOT_CAPTURED', `Order ${o.number} is not paid.`)
    const box = await lockBox(c, box0.id)
    if (box.order_id === o.id) reject('ALREADY_PICKED', `${formatBoxCode(box.code)} is already on this order.`)
    const tracking = await trackedLine(c, box.line_id)
    const p = pickProblem(box, { trackingOn: tracking })
    if (p) reject(...p)
    const items = (await c.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [o.id])).rows.filter((i) => i.sku === box.sku)
    if (!items.length) reject('WRONG_VARIANT', `Order ${o.number} has no ${box.sku_name}.`)
    const info = await lineInfo(c, box.line_id)
    const st = sellableAs(info, o.delivery_date, getConfig(), { existing: true })
    if (!st || box.best_before < o.delivery_date) reject('EXPIRED', `${formatBoxCode(box.code)} is too old for delivery on ${o.delivery_date}. Pick a younger box.`)
    const item = items.find((i) => i.stage === st.stage)
    if (!item) reject('WRONG_VARIANT', `${formatBoxCode(box.code)} will be ${st.stage.toLowerCase()} on ${o.delivery_date}; this order wants ${items.map((i) => i.stage.toLowerCase()).join(' or ')}.`)
    // The order's reserved units for this product and ripeness, oldest batch first (FEFO).
    const rows = (await c.query(
      `SELECT s.*, b.plucked_on FROM order_stock s JOIN batches b ON b.id = s.batch_id
        WHERE s.order_id = $1 AND s.sku = $2 AND s.stage = $3 AND s.state = 'committed' ORDER BY b.plucked_on, s.id`,
      [o.id, box.sku, st.stage],
    )).rows
    if (!rows.length) reject('LINE_ALREADY_FULFILLED', `Order ${o.number} already has all its ${box.sku_name} (${st.stage.toLowerCase()}).`)
    let row = rows.find((r) => r.line_id === box.line_id)
    let warning = null
    if (!row) {
      // D5: a box from a batch other than the one reserved is a warning that needs a reason.
      const reason = String(s.reason ?? '').trim().slice(0, 300)
      const expected = rows[0]
      const lot = (await c.query('SELECT code FROM box_lots WHERE line_id = $1', [expected.line_id])).rows[0]
      if (!reason) {
        reject('NON_FEFO', `${formatBoxCode(box.code)} is not from the reserved batch${lot ? ` (${lot.code})` : ''}. Pick from that batch, or give a reason.`, { needsReason: true, expectedLot: lot?.code ?? null })
      }
      await c.query('SELECT id FROM batch_lines WHERE id = ANY($1) ORDER BY id FOR UPDATE', [[box.line_id, expected.line_id]])
      const upd = await c.query(
        `UPDATE batch_lines SET committed = committed + 1 WHERE id = $1 AND on_hand - held - committed - reserve_buffer >= 1 RETURNING batch_id`,
        [box.line_id],
      )
      if (!upd.rowCount) reject('STOCK_INSUFFICIENT', `${formatBoxCode(box.code)}'s batch is fully promised to other orders. Pick from ${lot?.code ?? 'the reserved batch'}.`)
      const id = newId('ost')
      await c.query(
        `INSERT INTO order_stock (id, order_id, batch_id, line_id, sku, stage, quantity, state) VALUES ($1, $2, $3, $4, $5, $6, 1, 'committed')`,
        [id, o.id, box.batch_id, box.line_id, box.sku, st.stage],
      )
      await ledger(c, { batchId: box.batch_id, eventType: 'COMMIT', sku: box.sku, delta: 1, actorType: who.actor.type, actorId: who.actor.id, reason: `${o.number}: picked out of order (${reason})` })
      await release(c, expected, who.actor, `${o.number}: another batch picked instead (${reason})`, 1)
      row = (await c.query('SELECT * FROM order_stock WHERE id = $1', [id])).rows[0]
      warning = { code: 'NON_FEFO', reason }
    }
    const staging = await stagingPlace(c, box.warehouse_id)
    await pickUnit(c, row, who.actor, `${o.number}: box ${formatBoxCode(box.code)} picked`)
    await changeBox(
      c, box, { lifecycle: 'picked', order_id: o.id, order_item_id: item.id, location_id: staging?.id ?? box.location_id },
      ev(op, s, who, 'PICKED', { orderId: o.id, reasonCode: warning ? 'non_fefo' : null, reason: warning?.reason ?? null }),
      newDeltas(), { skipStock: true },
    )
    if (o.status === 'CONFIRMED') {
      assertTransition('CONFIRMED', 'PROCESSING')
      await c.query(`UPDATE orders SET status = 'PROCESSING' WHERE id = $1`, [o.id])
      await addEvent(c, o.id, 'CONFIRMED', 'PROCESSING', who.actor, 'Picking started in the warehouse')
    }
    const left = (await c.query(`SELECT coalesce(sum(quantity), 0)::int AS n FROM order_stock WHERE order_id = $1 AND state IN ('held', 'committed')`, [o.id])).rows[0].n
    const detail = { orderId: o.id, left }
    if (warning) return { result: 'warning', code: 'NON_FEFO', message: `${formatBoxCode(box.code)} picked from another batch (${warning.reason}). ${left} left.`, detail }
    return { message: `${formatBoxCode(box.code)} picked for ${o.number}. ${left ? `${left} left to pick.` : 'All picked.'}`, detail }
  },

  async unpick(c, op, box0, s, who) {
    if (!box0.order_id || !['picked', 'packed'].includes(box0.lifecycle)) reject('INVALID_TRANSITION', `${box0.code} is not on an order.`)
    if (op.order_id && box0.order_id !== op.order_id) reject('NOT_FROM_THIS_ORDER', `${box0.code} is on another order.`)
    const o = await lockOrder(c, box0.order_id)
    const r = await unpickBox(c, o, box0.id, who, op.context.reason ?? 'Taken off the order', ev(op, s, who, 'UNPICKED', { reasonCode: 'unpick', reason: op.context.reason }))
    return { message: `${r.code} taken off ${o.number}. Put it back in storage.`, detail: { orderId: o.id, atRisk: r.atRisk } }
  },

  pack(c, op, box0, s) {
    if (box0.order_id !== op.order_id) {
      if (box0.lifecycle === 'in_stock') reject('NOT_PICKED', `${box0.code} is not picked. Pick it for this order first.`)
      reject('NOT_FROM_THIS_ORDER', `${box0.code} belongs to another order. Set it aside.`)
    }
    if (box0.lifecycle === 'packed') reject('ALREADY_PACKED', `${box0.code} is already packed.`)
    if (box0.lifecycle !== 'picked') reject('INVALID_TRANSITION', `${box0.code} is ${box0.lifecycle}.`)
    return stage(c, op, box0, s)
  },

  stocktake(c, op, box0, s) {
    return stocktakeScan(c, op, box0, s)
  },

  repack(c, op, box0, s) {
    return repackScan(c, op, box0, s)
  },

  dispatch(c, op, box0, s) {
    if (box0.order_id !== op.order_id) reject('NOT_FROM_THIS_ORDER', `${box0.code} belongs to another order. Set it aside.`)
    if (box0.lifecycle === 'dispatched') reject('ALREADY_DISPATCHED', `${box0.code} has already left.`)
    if (box0.lifecycle !== 'packed') reject('NOT_PACKED', `${box0.code} is not packed yet.`)
    return stage(c, op, box0, s)
  },

  async return(c, op, box0, s, who, deltas) {
    if (box0.lifecycle !== 'dispatched') {
      reject('INVALID_TRANSITION', box0.lifecycle === 'returned' ? `${box0.code} is already booked as returned.` : `${box0.code} never left the warehouse.`)
    }
    const o = await lockOrder(c, box0.order_id)
    const box = await lockBox(c, box0.id)
    if (box.order_id !== o.id || box.lifecycle !== 'dispatched') reject('CONFLICT_RETRY_EXHAUSTED', 'This box just changed. Scan it again.')
    const wrongOrder = box.order_id !== op.order_id
    const row = (await c.query(`SELECT * FROM order_stock WHERE order_id = $1 AND line_id = $2 AND state = 'packed' ORDER BY id LIMIT 1`, [o.id, box.line_id])).rows[0]
    if (row) await unpickUnit(c, row, who.actor, `${o.number}: box ${formatBoxCode(box.code)} returned`)
    const moved = await changeBox(c, box, { lifecycle: 'returned', order_id: null, order_item_id: null, location_id: op.location_id }, ev(op, s, who, 'RETURNED', { orderId: o.id, reason: op.context.reason ?? null }), deltas)
    // D7: returned mangoes are not resold unless the product allows it and QC passes them again.
    await addHold(c, moved, 'return_hold', `Returned from ${o.number}`, ev(op, s, who, 'HOLD_ADDED'), deltas)
    if (wrongOrder) {
      await addHold(c, moved, 'investigation_hold', `Came back with order ${op.context.orderNumber} but left on ${o.number}`, ev(op, s, who, 'HOLD_ADDED'), deltas)
      return { result: 'warning', code: 'NOT_FROM_THIS_ORDER', message: `${formatBoxCode(box.code)} left on ${o.number}, not this order. Booked as returned and held for a supervisor.`, detail: { orderId: o.id } }
    }
    return { message: `${formatBoxCode(box.code)} returned. It stays in Returns.` }
  },
}

/** Takes a picked or packed box off its locked order `o` (unpick, and undo of a pick). */
async function unpickBox(c, o, boxId, who, why, event) {
  if (!UNPICKABLE_ORDER.includes(o.status)) reject('INVALID_TRANSITION', `Order ${o.number} is ${o.status.toLowerCase().replace(/_/g, ' ')}; its boxes can no longer come off.`)
  const box = await lockBox(c, boxId)
  if (box.order_id !== o.id || !['picked', 'packed'].includes(box.lifecycle)) reject('CONFLICT_RETRY_EXHAUSTED', 'This box just changed. Scan it again.')
  if (o.status === 'PACKED') {
    // The order is open for packing again; it goes through pack (and its finalize) once more.
    await c.query(`UPDATE orders SET status = 'PROCESSING' WHERE id = $1`, [o.id])
    await addEvent(c, o.id, 'PACKED', 'PROCESSING', who.actor, `Reopened in the warehouse: box ${formatBoxCode(box.code)} taken off (${why})`)
  }
  const row = (await c.query(`SELECT * FROM order_stock WHERE order_id = $1 AND line_id = $2 AND state = 'packed' ORDER BY id LIMIT 1`, [o.id, box.line_id])).rows[0]
  if (row) await unpickUnit(c, row, who.actor, `${o.number}: box ${formatBoxCode(box.code)} taken off (${why})`)
  await c.query('DELETE FROM wh_staged WHERE box_id = $1', [box.id])
  const staging = await stagingPlace(c, box.warehouse_id)
  await changeBox(c, box, { lifecycle: 'in_stock', order_id: null, order_item_id: null, location_id: staging?.id ?? box.location_id }, { ...event, orderId: o.id }, newDeltas(), { skipStock: true })
  const r = await rebalanceOrder(c, o.id, who.actor)
  return { code: formatBoxCode(box.code), atRisk: Boolean(r?.atRisk) }
}

/**
 * Stages a box on a pack or dispatch session; one taken from another open
 * session of the same type moves here (a warning). Stocktake and repack
 * staging is never taken: a box can be counted, or wait for a repack, while packed elsewhere.
 */
async function stage(c, op, box, s) {
  const elsewhere = (await c.query(
    `SELECT st.operation_id FROM wh_staged st JOIN wh_operations o ON o.id = st.operation_id
      WHERE st.box_id = $1 AND st.operation_id <> $2 AND o.status = 'open' AND o.type = $3`,
    [box.id, op.id, op.type],
  )).rows
  await c.query('DELETE FROM wh_staged WHERE box_id = $1 AND operation_id <> $2 AND operation_id IN (SELECT id FROM wh_operations WHERE type = $3)', [box.id, op.id, op.type])
  await c.query('INSERT INTO wh_staged (operation_id, box_id, scan_id, staged_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [op.id, box.id, s.scanId, now()])
  const counts = await stagedCounts(c, op)
  const message = `${formatBoxCode(box.code)} scanned (${counts.staged} of ${counts.needed}).`
  if (elsewhere.length) return { result: 'warning', code: 'STAGED_ELSEWHERE', message: `${formatBoxCode(box.code)} was in another open session; it counts here now.`, detail: counts }
  return { message, detail: counts }
}

async function stagedCounts(c, op) {
  if (op.type === 'stocktake') return stocktakeCounts(c, op)
  if (op.type === 'repack') return { staged: (await c.query('SELECT count(*)::int AS n FROM wh_staged WHERE operation_id = $1', [op.id])).rows[0].n, needed: 0 }
  const want = op.type === 'pack' ? 'picked' : 'packed'
  const { rows } = await c.query(
    `SELECT (SELECT count(*)::int FROM wh_staged WHERE operation_id = $1) AS staged,
            (SELECT count(*)::int FROM boxes WHERE order_id = $2 AND lifecycle = $3) AS needed`,
    [op.id, op.order_id, want],
  )
  return rows[0]
}

/** A weight the scanner sent (grams), within reason; else null. */
function weight(s) {
  const w = Number(s.weightG)
  if (!Number.isInteger(w) || w < 1 || w > 100_000) return null
  return w
}

// ---------------------------------------------------------------- finalize, undo, cancel

/**
 * Finalizes a staged session: re-checks every staged box under locks, then
 * applies it in one transaction. Pack and dispatch require the complete set
 * for the order; stocktake and repack have their own rules (stocktake.js,
 * repack.js; `body` carries a repack's new boxes). A completed session
 * returns its stored result.
 */
export async function finalizeOperation(c, opId, who, body = {}) {
  const op0 = (await c.query('SELECT * FROM wh_operations WHERE id = $1 AND warehouse_id = $2', [opId, who.warehouseId])).rows[0]
  if (!op0) throw whError('NOT_FOUND', 'Operation not found', 404)
  if (op0.order_id) await lockOrder(c, op0.order_id)
  const op = await lockOp(c, opId, who)
  ownerOnly(op, who)
  need(who, OP_PERMISSION[op.type])
  if (op.class !== 'staged') throw whError('VALIDATION_ERROR', 'Only pack, dispatch, stocktake and repack sessions are finalized', 400)
  if (op.status === 'completed') return opView(op, { replayed: true })
  if (op.status !== 'open') throw closedError(op)
  if (op.type === 'stocktake' || op.type === 'repack') {
    const result = op.type === 'stocktake' ? await finalizeStocktake(c, op, who) : await finalizeRepack(c, op, who, body)
    await c.query('DELETE FROM wh_staged WHERE operation_id = $1', [op.id])
    const { rows } = await c.query(`UPDATE wh_operations SET status = 'completed', finished_at = $2, last_activity_at = $2, result = $3 WHERE id = $1 RETURNING *`, [op.id, now(), result])
    logger.info({ operationId: op.id, type: op.type, adminId: who.actor.id }, 'warehouse: session finished')
    return opView(rows[0])
  }
  const o = (await c.query('SELECT * FROM orders WHERE id = $1', [op.order_id])).rows[0]
  const want = op.type === 'pack' ? 'picked' : 'packed'
  const staged = (await c.query('SELECT box_id FROM wh_staged WHERE operation_id = $1', [op.id])).rows.map((r) => r.box_id)
  const ids = (await c.query(`SELECT id FROM boxes WHERE order_id = $1 AND lifecycle IN ('picked', 'packed') ORDER BY id`, [o.id])).rows.map((r) => r.id)
  const boxes = await lockBoxesSorted(c, [...new Set([...ids, ...staged])])
  const needed = boxes.filter((b) => b.order_id === o.id && b.lifecycle === want)
  const stale = staged.filter((id) => !needed.some((b) => b.id === id))
  if (stale.length) {
    const codes = boxes.filter((b) => stale.includes(b.id)).map((b) => formatBoxCode(b.code))
    await c.query('DELETE FROM wh_staged WHERE operation_id = $1 AND box_id = ANY($2::uuid[])', [op.id, stale])
    throw whError('STALE_SCAN', `${codes.join(', ')} changed since ${codes.length === 1 ? 'it was' : 'they were'} scanned. Scan again.`, 409, { boxes: codes })
  }
  const missing = needed.filter((b) => !staged.includes(b.id)).map((b) => formatBoxCode(b.code))
  if (missing.length) throw whError('INCOMPLETE_SET', `${missing.length} ${missing.length === 1 ? 'box is' : 'boxes are'} not scanned yet: ${missing.slice(0, 10).join(', ')}.`, 409, { missing })
  const deltas = newDeltas()
  if (op.type === 'pack') {
    if (!PICKABLE_ORDER.includes(o.status)) throw whError('INVALID_TRANSITION', `Order ${o.number} is ${o.status.toLowerCase().replace(/_/g, ' ')}`)
    const committed = (await c.query(`SELECT * FROM order_stock WHERE order_id = $1 AND state IN ('held', 'committed') ORDER BY id`, [o.id])).rows
    let left = 0
    for (const row of committed) {
      if (await trackedLine(c, row.line_id)) left += row.quantity
    }
    if (left) throw whError('INCOMPLETE_SET', `${left} ${left === 1 ? 'box is' : 'boxes are'} still to pick for ${o.number}.`, 409, { toPick: left })
    // Products without box labels in the same order are packed the existing way.
    for (const row of committed) await pack(c, row, who.actor, `${o.number} (packed with its labelled boxes)`)
    const packing = (await c.query(`SELECT id FROM wh_locations WHERE warehouse_id = $1 AND type = 'packing' AND active ORDER BY created_at, id LIMIT 1`, [op.warehouse_id])).rows[0]
    for (const b of needed) {
      await changeBox(c, b, { lifecycle: 'packed', location_id: packing?.id ?? b.location_id }, { type: 'PACKED', actor: who.actor, operationId: op.id, orderId: o.id }, deltas, { skipStock: true })
    }
    if (o.status === 'CONFIRMED') {
      await c.query(`UPDATE orders SET status = 'PROCESSING' WHERE id = $1`, [o.id])
      await addEvent(c, o.id, 'CONFIRMED', 'PROCESSING', who.actor, 'Packing started in the warehouse')
    }
    await setOrderStatus(c, o.id, 'PACKED', who.actor)
  } else {
    if (o.status !== 'PACKED') throw whError('INVALID_TRANSITION', `Order ${o.number} is ${o.status.toLowerCase().replace(/_/g, ' ')}`)
    for (const b of needed) {
      await changeBox(c, b, { lifecycle: 'dispatched', location_id: null }, { type: 'DISPATCHED', actor: who.actor, operationId: op.id, orderId: o.id }, deltas, { skipStock: true })
    }
    // SHIPPED re-checks the order (age, condemned batches, at-risk) and rolls everything back if it can't go.
    await setOrderStatus(c, o.id, 'SHIPPED', who.actor)
  }
  await c.query('DELETE FROM wh_staged WHERE operation_id = $1', [op.id])
  const result = { orderId: o.id, orderNumber: o.number, boxes: needed.map((b) => formatBoxCode(b.code)), status: op.type === 'pack' ? 'PACKED' : 'SHIPPED' }
  const { rows } = await c.query(`UPDATE wh_operations SET status = 'completed', finished_at = $2, last_activity_at = $2, result = $3 WHERE id = $1 RETURNING *`, [op.id, now(), result])
  return opView(rows[0])
}

/**
 * Takes boxes out of a staged session after a finalize refused them as stale
 * (its own transaction: the refused finalize rolled back). Their scans become
 * undone, so scanning one again is checked afresh instead of being a duplicate.
 */
export async function unstageBoxes(c, opId, boxIds, who) {
  const op = await lockOp(c, opId, who)
  ownerOnly(op, who)
  if (op.status !== 'open' || !boxIds.length) return 0
  const del = await c.query('DELETE FROM wh_staged WHERE operation_id = $1 AND box_id = ANY($2::uuid[])', [op.id, boxIds])
  const upd = await c.query(`UPDATE wh_scans SET result = 'undone' WHERE operation_id = $1 AND box_id = ANY($2::uuid[]) AND result IN ('accepted', 'warning')`, [op.id, boxIds])
  await c.query('UPDATE wh_operations SET accepted_count = greatest(accepted_count - $2, 0), last_activity_at = $3 WHERE id = $1', [op.id, upd.rowCount, now()])
  return del.rowCount
}

async function lockBoxesSorted(c, ids) {
  const m = await lockBoxes(c, ids)
  return [...m.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
}

/**
 * Undoes the session's last accepted scan, by its owner, while the session is
 * open. A staged scan is simply unstaged. An applied scan is reversed with new
 * events, only while that scan is still the box's latest change (otherwise
 * UNDO_NOT_POSSIBLE: fix it with a new scan instead).
 */
export async function undoLastScan(c, opId, who) {
  const op0 = (await c.query('SELECT order_id FROM wh_operations WHERE id = $1 AND warehouse_id = $2', [opId, who.warehouseId])).rows[0]
  if (!op0) throw whError('NOT_FOUND', 'Operation not found', 404)
  if (op0.order_id) await lockOrder(c, op0.order_id)
  const op = await lockOp(c, opId, who)
  ownerOnly(op, who)
  need(who, OP_PERMISSION[op.type])
  if (op.status !== 'open') throw closedError(op)
  const scan = (await c.query(
    `SELECT * FROM wh_scans WHERE operation_id = $1 AND result IN ('accepted', 'warning') AND box_id IS NOT NULL ORDER BY seq DESC LIMIT 1`,
    [op.id],
  )).rows[0]
  if (!scan) throw whError('NOTHING_TO_UNDO', 'Nothing to undo in this session')
  const markUndone = async () => {
    await c.query(`UPDATE wh_scans SET result = 'undone' WHERE id = $1`, [scan.id])
    await c.query('UPDATE wh_operations SET accepted_count = greatest(accepted_count - 1, 0), last_activity_at = $2 WHERE id = $1', [op.id, now()])
  }
  if (op.class === 'staged') {
    await c.query('DELETE FROM wh_staged WHERE operation_id = $1 AND box_id = $2', [op.id, scan.box_id])
    await markUndone()
    return { undone: scanView({ ...scan, result: 'undone' }) }
  }
  const events = (await c.query('SELECT * FROM box_events WHERE scan_id = $1 ORDER BY created_at, id', [scan.scan_id])).rows
  if (!events.length) {
    // A scan that changed nothing (already there, already passed).
    await markUndone()
    return { undone: scanView({ ...scan, result: 'undone' }) }
  }
  const latest = (await c.query('SELECT scan_id FROM box_events WHERE box_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [scan.box_id])).rows[0]
  if (latest?.scan_id !== scan.scan_id || !['receive', 'move', 'qc', 'pick'].includes(op.type)) {
    throw whError('UNDO_NOT_POSSIBLE', 'This box changed again since, or this scan cannot be undone. Fix it with a new scan.')
  }
  const undoEv = { type: 'UNDONE', actor: who.actor, operationId: op.id, reasonCode: 'undo', meta: { undoes: scan.scan_id } }
  const deltas = newDeltas()
  if (op.type === 'pick') {
    const box = await readBox(c, scan.box_id)
    const o = await lockOrder(c, box.order_id)
    await unpickBox(c, o, box.id, who, 'Pick undone', undoEv)
  } else {
    let box = await lockBox(c, scan.box_id)
    const first = events[0]
    for (const e of [...events].reverse()) {
      if (e.hold_released) await addHold(c, box, e.hold_released, 'Restored by undo', undoEv, deltas)
      if (e.hold_added) await releaseHold(c, box, e.hold_added, 'Undone', undoEv, deltas)
      box = await lockBox(c, box.id)
    }
    const changes = {}
    if (first.from_lifecycle !== first.to_lifecycle || op.type === 'receive') changes.lifecycle = first.from_lifecycle
    if (first.from_location !== first.to_location) changes.location_id = first.from_location
    if (first.from_quality !== first.to_quality) changes.quality = first.from_quality
    if (op.type === 'receive') changes.verification = null
    if (Object.keys(changes).length) await changeBox(c, box, changes, undoEv, deltas)
    await applyLineDeltas(c, deltas, who.actor, `Undo of a ${op.type} scan`)
    if (op.type === 'receive') await finishReceivingUndo(c, op.lot_id)
  }
  await markUndone()
  return { undone: scanView({ ...scan, result: 'undone' }) }
}

/** After an undone receive the lot may need to go back to receiving. */
async function finishReceivingUndo(c, lotId) {
  const lot = await finishReceiving(c, lotId)
  if (lot.status === 'received' && lot.verified_count + lot.voided_count < lot.target_count) {
    await c.query(`UPDATE box_lots SET status = 'receiving', updated_at = $2 WHERE id = $1`, [lotId, now()])
  }
}

/** Cancels an open session. Applied scans stay applied; staged scans are dropped. */
export async function cancelOperation(c, opId, who) {
  const op = await lockOp(c, opId, who)
  if (op.owner_id !== who.actor.id && !can(who.role, 'adjust.approve')) throw whError('FORBIDDEN', 'Only its owner or a manager can cancel this session.', 403)
  if (op.status !== 'open') return opView(op)
  await c.query('DELETE FROM wh_staged WHERE operation_id = $1', [op.id])
  const { rows } = await c.query(`UPDATE wh_operations SET status = 'cancelled', finished_at = $2 WHERE id = $1 RETURNING *`, [op.id, now()])
  return opView(rows[0])
}

export async function getOperation(c, opId, who) {
  const op = await lockOp(c, opId, who)
  const scans = (await c.query('SELECT * FROM wh_scans WHERE operation_id = $1 ORDER BY seq DESC LIMIT 200', [op.id])).rows
  const extra = { scans: scans.map((s) => scanView(s)) }
  if (op.class === 'staged' && op.status === 'open') extra.progress = await stagedCounts(c, op)
  return opView(op, extra)
}

export async function listOperations(c, who, { mine = true, status = null, limit = 50 } = {}) {
  const { rows } = await c.query(
    `SELECT * FROM wh_operations WHERE warehouse_id = $1 AND ($2::text IS NULL OR owner_id = $2) AND ($3::text IS NULL OR status = $3)
      ORDER BY started_at DESC LIMIT $4`,
    [who.warehouseId, mine ? who.actor.id : null, status, Math.min(Math.max(Number(limit) || 50, 1), 200)],
  )
  return rows.map((r) => opView(r))
}

