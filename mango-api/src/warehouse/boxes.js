// Box-level actions outside a scan session: look-ups, labels, holds,
// weights, write-offs, bulk lot actions and locations (docs/warehouse/API.md).
import { now } from '../clock.js'
import { newId } from '../ids.js'
import { formatBoxCode, newToken, parseScan } from './codes.js'
import {
  addHold, applyLineDeltas, changeBox, HOLD_KINDS, lockBox, lockBoxes, moveProblem, newDeltas, PICKABLE_TYPES, readBox, releaseHold, whError,
} from './core.js'
import { can } from './permissions.js'

/** D8: a write-off above either limit waits for a second person. */
export const WRITE_OFF_LIMIT = { boxes: 10, grams: 20_000 }
export const WRITE_OFF_REASONS = ['spoiled', 'damaged', 'expired', 'recall', 'sample', 'other']
/** Reprints of one box beyond this need a supervisor (labels.reissue). */
export const FREE_REPRINTS = 3

export const boxView = (b, extra = {}) => ({
  id: b.id, code: formatBoxCode(b.code), rawCode: b.code, lotId: b.lot_id, batchId: b.batch_id, lineId: b.line_id, sku: b.sku, skuName: b.sku_name,
  seq: b.seq, warehouseId: b.warehouse_id, locationId: b.location_id, locationName: b.location_name ?? null, locationType: b.location_type ?? null,
  lifecycle: b.lifecycle, quality: b.quality, holds: b.holds ?? [], verification: b.verification, nominalWeightG: b.nominal_weight_g,
  measuredWeightG: b.measured_weight_g, bestBefore: b.best_before, orderId: b.order_id, orderItemId: b.order_item_id,
  parentBoxIds: b.parent_box_ids ?? [], reprintCount: b.reprint_count, version: b.version, createdAt: b.created_at, updatedAt: b.updated_at, ...extra,
})

export const eventView = (e) => ({
  id: e.id, type: e.type, at: e.created_at, actorId: e.actor_id, actor: e.actor_email ?? null, operationId: e.operation_id, scanId: e.scan_id,
  fromLifecycle: e.from_lifecycle, toLifecycle: e.to_lifecycle, fromLocation: e.from_location, toLocation: e.to_location,
  fromQuality: e.from_quality, toQuality: e.to_quality, holdAdded: e.hold_added, holdReleased: e.hold_released, orderId: e.order_id,
  reasonCode: e.reason_code, reason: e.reason, meta: e.meta,
})

/** A box in this warehouse, or 404 (a box elsewhere is reported the same as none: no cross-warehouse lookups). */
export async function boxIn(c, id, warehouseId, { lock = false } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw whError('NOT_FOUND', 'Box not found', 404)
  const box = lock ? await lockBox(c, id) : await readBox(c, id)
  if (!box || box.warehouse_id !== warehouseId) throw whError('NOT_FOUND', 'Box not found', 404)
  return box
}

/** What a scanned or typed code is, for the look-up screen: a box, a location, or why not. */
export async function resolveCode(c, input, warehouseId) {
  const p = parseScan(input)
  if (p.error) return { kind: 'error', code: p.error }
  if (p.kind === 'location') {
    const loc = (await c.query('SELECT * FROM wh_locations WHERE label_token = $1 AND warehouse_id = $2', [p.token, warehouseId])).rows[0]
    return loc ? { kind: 'location', location: locationView(loc) } : { kind: 'error', code: 'UNKNOWN_CODE' }
  }
  if (p.kind === 'container') return { kind: 'error', code: 'WRONG_LABEL_TYPE' }
  let id = null
  let revoked = false
  if (p.kind === 'box') {
    const l = (await c.query('SELECT box_id, revoked_at FROM box_labels WHERE token = $1', [p.token])).rows[0]
    id = l?.box_id ?? null
    revoked = Boolean(l?.revoked_at)
  } else {
    id = (await c.query('SELECT id FROM boxes WHERE code = $1', [p.code])).rows[0]?.id ?? null
  }
  const box = id ? await readBox(c, id) : null
  if (!box || box.warehouse_id !== warehouseId) return { kind: 'error', code: 'UNKNOWN_CODE' }
  return { kind: 'box', box: boxView(box), labelRevoked: revoked }
}

export async function boxEvents(c, boxId, { before = null, limit = 100 } = {}) {
  const { rows } = await c.query(
    `SELECT e.*, a.email AS actor_email FROM box_events e LEFT JOIN admin_users a ON a.id = e.actor_id
      WHERE e.box_id = $1 AND ($2::timestamptz IS NULL OR e.created_at < $2) ORDER BY e.created_at DESC, e.id DESC LIMIT $3`,
    [boxId, before, Math.min(Math.max(Number(limit) || 100, 1), 500)],
  )
  return rows.map(eventView)
}

/** Records a reprint of the same label (the token does not change). More than FREE_REPRINTS needs labels.reissue. */
export function reprintBox(c, box, { reason }, who) {
  if (box.reprint_count >= FREE_REPRINTS && !can(who.role, 'labels.reissue')) {
    throw whError('SUPERVISOR_REQUIRED', `Box ${formatBoxCode(box.code)} has been reprinted ${box.reprint_count} times. A supervisor must reprint it.`, 403)
  }
  if (['voided', 'disposed', 'repacked'].includes(box.lifecycle)) throw whError('INVALID_TRANSITION', `Box ${formatBoxCode(box.code)} is ${box.lifecycle}; it needs no label`)
  const d = newDeltas()
  return changeBox(c, box, { reprint_count: box.reprint_count + 1 }, { type: 'LABEL_REPRINTED', actor: who.actor, reasonCode: 'reprint', reason }, d)
}

/** A new token for a box whose label was lost, damaged or copied: the old label stops working (LABEL_REVOKED). */
export async function reissueLabel(c, box, { reason }, who) {
  if (['voided', 'disposed', 'repacked'].includes(box.lifecycle)) throw whError('INVALID_TRANSITION', `Box ${formatBoxCode(box.code)} is ${box.lifecycle}; it needs no label`)
  const token = newToken()
  const at = now()
  await c.query('UPDATE box_labels SET revoked_at = $2, revoked_by = $3, revoke_reason = $4 WHERE box_id = $1 AND revoked_at IS NULL', [box.id, at, who.actor.id, `Reissued: ${reason}`])
  await c.query('INSERT INTO box_labels (token, box_id, issued_at, issued_by) VALUES ($1, $2, $3, $4)', [token, box.id, at, who.actor.id])
  return changeBox(c, box, { label_token: token }, { type: 'LABEL_REISSUED', actor: who.actor, reasonCode: 'reissue', reason }, newDeltas())
}

/** Holds staff add by hand. qc_hold and return_hold come from QC and returns; recall_hold from a recall. */
const MANUAL_HOLDS = ['damage_hold', 'investigation_hold']
const RELEASABLE = { qc_hold: 'warehouse.qc', damage_hold: 'warehouse.qc', investigation_hold: 'warehouse.qc', return_hold: 'warehouse.returns', recall_hold: 'recall.manage' }

export async function addManualHold(c, box, { kind, reason }, who) {
  if (!MANUAL_HOLDS.includes(kind)) throw whError('VALIDATION_ERROR', `Add ${kind.replace('_', ' ')} through its own flow`, 400)
  if (['voided', 'disposed', 'repacked', 'dispatched'].includes(box.lifecycle)) throw whError('INVALID_TRANSITION', `Box ${formatBoxCode(box.code)} is ${box.lifecycle}`)
  const d = newDeltas()
  const added = await addHold(c, box, kind, reason, { type: 'HOLD_ADDED', actor: who.actor, reasonCode: kind }, d)
  const short = await applyLineDeltas(c, d, who.actor, `Box ${formatBoxCode(box.code)}: ${kind.replace('_', ' ')}`)
  return { added, shortfall: short }
}

/** Releases one kind of hold. Each kind is separate: releasing one never releases another. */
export async function releaseManualHold(c, box, kind, { reason }, who) {
  if (!HOLD_KINDS.includes(kind)) throw whError('VALIDATION_ERROR', `Unknown hold ${kind}`, 400)
  if (!can(who.role, RELEASABLE[kind])) throw whError('FORBIDDEN', `Your role cannot release a ${kind.replace('_', ' ')}`, 403)
  if (kind === 'qc_hold' && box.quality !== 'passed') throw whError('QC_NOT_PASSED', `Box ${formatBoxCode(box.code)} has not passed QC: scan it in a QC session`)
  if (kind === 'return_hold' && box.lifecycle === 'returned') throw whError('INVALID_TRANSITION', 'Use Restock to put a returned box back, or write it off')
  if (kind === 'recall_hold') throw whError('INVALID_TRANSITION', 'Recall holds are released with the recall')
  const d = newDeltas()
  const released = await releaseHold(c, box, kind, reason, { type: 'HOLD_RELEASED', actor: who.actor, reasonCode: kind }, d)
  if (!released) throw whError('NOT_FOUND', `Box ${formatBoxCode(box.code)} has no ${kind.replace('_', ' ')}`, 404)
  await applyLineDeltas(c, d, who.actor, `Box ${formatBoxCode(box.code)}: ${kind.replace('_', ' ')} released`)
  return true
}

/** Records a box's weighed weight; outside the product's tolerance a passed box goes to review. */
export async function measureBox(c, box, { weightG, fruitCount = null }, who) {
  const p = (await c.query('SELECT weight_tolerance_pct FROM products WHERE sku = $1', [box.sku])).rows[0]
  const off = (Math.abs(weightG - box.nominal_weight_g) / box.nominal_weight_g) * 100
  const out = off > Number(p.weight_tolerance_pct)
  const changes = { measured_weight_g: weightG, ...(fruitCount ? { fruit_count: fruitCount } : {}) }
  if (out && box.quality === 'passed' && box.lifecycle === 'in_stock') changes.quality = 'needs_review'
  const d = newDeltas()
  const after = await changeBox(c, box, changes, { type: 'WEIGHED', actor: who.actor, reasonCode: out ? 'out_of_tolerance' : null, meta: { weightG, offPct: Math.round(off * 10) / 10 } }, d)
  const short = await applyLineDeltas(c, d, who.actor, `Box ${formatBoxCode(box.code)} weighed out of tolerance`)
  return { box: after, outOfTolerance: out, shortfall: short }
}

/**
 * A returned box back into stock (D7: only for products that allow it). It
 * comes back as needs_review in the returns area: QC must pass it and it must
 * be moved to storage before it counts as stock again.
 */
export async function restockReturned(c, box, { reason }, who) {
  if (box.lifecycle !== 'returned') throw whError('INVALID_TRANSITION', `Box ${formatBoxCode(box.code)} is not a returned box`)
  const p = (await c.query('SELECT restockable_returns FROM products WHERE sku = $1', [box.sku])).rows[0]
  if (!p?.restockable_returns) throw whError('RETURNS_NOT_RESTOCKABLE', `${box.sku_name} returns are not resold (they are written off)`)
  if (box.holds.includes('investigation_hold') || box.holds.includes('recall_hold')) throw whError('BOX_ON_HOLD', `Box ${formatBoxCode(box.code)} is held: clear the investigation or recall first`)
  const d = newDeltas()
  let b = await changeBox(c, box, { lifecycle: 'in_stock', quality: 'needs_review' }, { type: 'RESTOCKED', actor: who.actor, reasonCode: 'return_restock', reason }, d)
  b = await lockBox(c, b.id)
  await releaseHold(c, b, 'return_hold', reason, { type: 'HOLD_RELEASED', actor: who.actor, reasonCode: 'return_restock' }, d)
  await addHold(c, await lockBox(c, b.id), 'qc_hold', 'Returned: QC again before resale', { type: 'HOLD_ADDED', actor: who.actor }, d)
  await applyLineDeltas(c, d, who.actor, `Box ${formatBoxCode(box.code)} restocked from a return`)
  return true
}

// ---------------------------------------------------------------- write-offs

const sizeOf = (boxes) => ({ n: boxes.length, grams: boxes.reduce((g, b) => g + (b.measured_weight_g ?? b.nominal_weight_g), 0) })

async function writeOffBoxes(c, wo, boxIds, who) {
  const boxes = await lockBoxes(c, boxIds)
  if (boxes.size !== boxIds.length) throw whError('NOT_FOUND', 'A box in this write-off was not found', 404)
  const d = newDeltas()
  for (const b of boxes.values()) {
    if (b.warehouse_id !== wo.warehouse_id) throw whError('NOT_FOUND', 'A box in this write-off was not found', 404)
    if (!['in_stock', 'returned', 'missing'].includes(b.lifecycle)) {
      throw whError('INVALID_TRANSITION', `Box ${b.code} is ${b.lifecycle}: ${b.order_id ? 'take it off its order first' : 'it cannot be written off'}`)
    }
    await changeBox(c, b, { lifecycle: 'disposed', location_id: null }, { type: 'WRITTEN_OFF', actor: who.actor, reasonCode: wo.reason_code, reason: wo.reason, meta: { writeOffId: wo.id } }, d)
  }
  return applyLineDeltas(c, d, who.actor, `Write-off ${wo.id}: ${wo.reason}`, { reasonCode: 'BOX_WRITE_OFF' })
}

/** Writes boxes off now (small) or asks for a second person's approval (over WRITE_OFF_LIMIT). */
export async function requestWriteOff(c, { boxIds, reasonCode, reason }, who) {
  const ids = [...new Set(boxIds)]
  const boxes = await lockBoxes(c, ids)
  if (boxes.size !== ids.length || [...boxes.values()].some((b) => b.warehouse_id !== who.warehouseId)) throw whError('NOT_FOUND', 'A box in this write-off was not found', 404)
  for (const b of boxes.values()) {
    if (!['in_stock', 'returned', 'missing'].includes(b.lifecycle)) throw whError('INVALID_TRANSITION', `Box ${b.code} is ${b.lifecycle}: it cannot be written off`)
  }
  const { n, grams } = sizeOf([...boxes.values()])
  const big = n > WRITE_OFF_LIMIT.boxes || grams > WRITE_OFF_LIMIT.grams
  const wo = { id: newId('wof'), warehouse_id: who.warehouseId, reason_code: reasonCode, reason }
  await c.query(
    `INSERT INTO wh_writeoffs (id, warehouse_id, box_ids, reason_code, reason, status, requested_by, requested_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [wo.id, who.warehouseId, ids, reasonCode, reason, big ? 'pending' : 'applied', who.actor.id, now()],
  )
  if (big) return { id: wo.id, status: 'pending', boxes: n, grams }
  const short = await writeOffBoxes(c, wo, ids, who)
  return { id: wo.id, status: 'applied', boxes: n, grams, shortfall: short }
}

export async function decideWriteOff(c, id, approve, who) {
  const { rows } = await c.query('SELECT * FROM wh_writeoffs WHERE id = $1 AND warehouse_id = $2 FOR UPDATE', [id, who.warehouseId])
  const wo = rows[0]
  if (!wo) throw whError('NOT_FOUND', 'Write-off not found', 404)
  if (wo.status !== 'pending') throw whError('INVALID_TRANSITION', `This write-off is already ${wo.status}`)
  if (wo.requested_by === who.actor.id) throw whError('SELF_APPROVAL', 'Someone else must approve your write-off', 403)
  let short = null
  if (approve) short = await writeOffBoxes(c, wo, wo.box_ids, who)
  await c.query('UPDATE wh_writeoffs SET status = $2, decided_by = $3, decided_at = $4 WHERE id = $1', [id, approve ? 'applied' : 'rejected', who.actor.id, now()])
  return { id, status: approve ? 'applied' : 'rejected', shortfall: short }
}

export async function listWriteOffs(c, who, status = null) {
  const { rows } = await c.query(
    `SELECT w.*, r.email AS requested_email, d.email AS decided_email FROM wh_writeoffs w
       LEFT JOIN admin_users r ON r.id = w.requested_by LEFT JOIN admin_users d ON d.id = w.decided_by
      WHERE w.warehouse_id = $1 AND ($2::text IS NULL OR w.status = $2) ORDER BY w.requested_at DESC LIMIT 200`,
    [who.warehouseId, status],
  )
  return rows.map((w) => ({
    id: w.id, boxes: w.box_ids.length, boxIds: w.box_ids, reasonCode: w.reason_code, reason: w.reason, status: w.status,
    requestedBy: w.requested_email, requestedAt: w.requested_at, decidedBy: w.decided_email, decidedAt: w.decided_at,
    mine: w.requested_by === who.actor.id,
  }))
}

// ---------------------------------------------------------------- bulk actions on a lot

/** Boxes a lot-wide action changes per request; the response says whether to call again (`more`). */
export const BULK_CHUNK = 400

/**
 * QC a whole lot at once (bulk-first): every received box still waiting for QC passes, except those named.
 * Boxes made by a repack are QC'd one by one (scan), never by the lot's sample.
 */
export async function qcLot(c, lot, { exceptBoxIds = [], note = null }, who) {
  const { rows } = await c.query(
    `SELECT id FROM boxes WHERE lot_id = $1 AND quality = 'pending' AND lifecycle = 'in_stock' AND parent_box_ids = '{}' AND NOT (id = ANY($2::uuid[])) ORDER BY id LIMIT $3`,
    [lot.id, exceptBoxIds, BULK_CHUNK + 1],
  )
  const more = rows.length > BULK_CHUNK
  rows.length = Math.min(rows.length, BULK_CHUNK)
  const d = newDeltas()
  let passed = 0
  for (const b of (await lockBoxes(c, rows.map((r) => r.id))).values()) {
    if (b.quality !== 'pending' || b.lifecycle !== 'in_stock') continue
    const after = await changeBox(c, b, { quality: 'passed' }, { type: 'QC_PASSED', actor: who.actor, reasonCode: 'lot_qc', reason: note, meta: { lot: lot.code } }, d)
    await releaseHold(c, after, 'qc_hold', 'QC passed (whole lot)', { type: 'HOLD_RELEASED', actor: who.actor, reasonCode: 'lot_qc' }, d)
    passed++
  }
  await applyLineDeltas(c, d, who.actor, `Lot ${lot.code}: QC passed`)
  const waiting = (await c.query(`SELECT count(*)::int AS n FROM boxes WHERE lot_id = $1 AND quality = 'pending' AND lifecycle <> 'voided' AND parent_box_ids = '{}'`, [lot.id])).rows[0].n
  return { passed, stillPending: waiting, more }
}

/** Put a whole lot away (bulk-first): every box of the lot still at `fromType` places moves to the location. */
export async function putAwayLot(c, lot, { locationId, fromLocationId = null }, who) {
  const loc = (await c.query('SELECT * FROM wh_locations WHERE id = $1 AND warehouse_id = $2', [locationId, who.warehouseId])).rows[0]
  if (!loc) throw whError('NOT_FOUND', 'Location not found', 404)
  const { rows } = await c.query(
    `SELECT b.id FROM boxes b JOIN wh_locations l ON l.id = b.location_id
      WHERE b.lot_id = $1 AND b.lifecycle = 'in_stock' AND b.location_id <> $2
        AND (($3::text IS NULL AND l.type = 'receiving') OR b.location_id = $3) ORDER BY b.id LIMIT $4`,
    [lot.id, loc.id, fromLocationId, BULK_CHUNK + 1],
  )
  const more = rows.length > BULK_CHUNK
  rows.length = Math.min(rows.length, BULK_CHUNK)
  const d = newDeltas()
  let moved = 0
  const skipped = []
  for (const b of (await lockBoxes(c, rows.map((r) => r.id))).values()) {
    const p = moveProblem(b, loc)
    if (p) {
      skipped.push({ code: formatBoxCode(b.code), reason: p[1] })
      continue
    }
    await changeBox(c, b, { location_id: loc.id }, { type: 'MOVED', actor: who.actor, reasonCode: 'lot_put_away', meta: { lot: lot.code } }, d)
    moved++
  }
  const short = await applyLineDeltas(c, d, who.actor, `Lot ${lot.code} put away in ${loc.name}`)
  return { moved, skipped, shortfall: short, more }
}

// ---------------------------------------------------------------- locations

export const LOCATION_TYPES = ['receiving', 'ripening', 'cold_storage', 'storage', 'qc_hold', 'pick_staging', 'packing', 'dispatch_bay', 'returns', 'disposal']

export const locationView = (l, extra = {}) => ({
  id: l.id, warehouseId: l.warehouse_id, zone: l.zone, name: l.name, type: l.type, active: l.active, pickable: PICKABLE_TYPES.includes(l.type),
  createdAt: l.created_at, ...extra,
})

export async function listLocations(c, warehouseId) {
  const { rows } = await c.query(
    `SELECT l.*, (SELECT count(*)::int FROM boxes b WHERE b.location_id = l.id AND b.lifecycle NOT IN ('dispatched', 'voided', 'disposed', 'repacked')) AS boxes
       FROM wh_locations l WHERE l.warehouse_id = $1 ORDER BY l.type, l.zone, l.name`,
    [warehouseId],
  )
  return rows.map((l) => locationView(l, { boxes: l.boxes }))
}

export async function createLocation(c, { zone = '', name, type }, who) {
  const id = newId('loc')
  try {
    const { rows } = await c.query(
      `INSERT INTO wh_locations (id, warehouse_id, zone, name, type, label_token, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, who.warehouseId, zone, name, type, newToken(), now()],
    )
    return locationView(rows[0])
  } catch (err) {
    if (err.code === '23505') throw whError('VALIDATION_ERROR', `There is already a location called ${name}${zone ? ` in zone ${zone}` : ''}`, 400)
    throw err
  }
}

/** Renames or switches a location on or off. A location holding boxes cannot be switched off or change type. */
export async function updateLocation(c, id, patch, who) {
  const { rows } = await c.query('SELECT * FROM wh_locations WHERE id = $1 AND warehouse_id = $2 FOR UPDATE', [id, who.warehouseId])
  const loc = rows[0]
  if (!loc) throw whError('NOT_FOUND', 'Location not found', 404)
  const holding = (await c.query(`SELECT count(*)::int AS n FROM boxes WHERE location_id = $1 AND lifecycle NOT IN ('dispatched', 'voided', 'disposed', 'repacked')`, [id])).rows[0].n
  if (holding && ((patch.active === false && loc.active) || (patch.type && patch.type !== loc.type))) {
    throw whError('LOCATION_NOT_EMPTY', `${loc.name} holds ${holding} ${holding === 1 ? 'box' : 'boxes'}. Move them first.`)
  }
  const next = { zone: patch.zone ?? loc.zone, name: patch.name ?? loc.name, type: patch.type ?? loc.type, active: patch.active ?? loc.active }
  try {
    const upd = await c.query('UPDATE wh_locations SET zone = $2, name = $3, type = $4, active = $5, updated_at = $6 WHERE id = $1 RETURNING *', [
      id, next.zone, next.name, next.type, next.active, now(),
    ])
    return locationView(upd.rows[0])
  } catch (err) {
    if (err.code === '23505') throw whError('VALIDATION_ERROR', `There is already a location called ${next.name}`, 400)
    throw err
  }
}
