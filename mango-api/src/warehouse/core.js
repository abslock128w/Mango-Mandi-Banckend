// Box state changes: the one place a box row changes (docs/warehouse/MODEL.md).
//
// Every change goes through changeBox(): it bumps the box's version (the
// update only lands if nobody changed the box since it was read), writes the
// box_events row, and notes how the change moved the box in or out of the
// shelf-sellable set. applyLineDeltas() then moves batch_lines.on_hand by
// exactly that difference, in the same transaction, so for a product with box
// tracking on the stock counter always equals its sellable boxes.
//
// Lock order, everywhere (deadlock avoidance, brief 11.2):
//   orders (oldest first) → order_stock rows → boxes (sorted by id) → batch_lines (sorted by id)
// The existing stock engine already locks orders before batch lines; boxes
// sit between the two.
import { now, todayIST } from '../clock.js'
import { env } from '../env.js'
import { HttpError } from '../errors.js'
import { newId } from '../ids.js'
import { ledger } from '../inventory.js'
import { recordShortArrival } from '../orders.js'

export const PICKABLE_TYPES = ['storage', 'cold_storage', 'ripening']
/** Where a box that is held or failed QC may go: never a pickable place. */
export const QUARANTINE_TYPES = ['qc_hold', 'returns', 'disposal']
export const TERMINAL = ['voided', 'disposed', 'repacked']
export const HOLD_KINDS = ['qc_hold', 'recall_hold', 'damage_hold', 'investigation_hold', 'return_hold']

/** An error a scan or request reports with one of the catalogue codes (docs/warehouse/API.md). */
export class WhError extends HttpError {
  constructor(code, message, status = 409, extra) {
    super(status, code, message, extra)
  }
}
export const whError = (code, message, status = 409, extra) => new WhError(code, message, status, extra)

const BOX_COLUMNS = `b.*, l.type AS location_type, l.name AS location_name, l.active AS location_active,
  (SELECT coalesce(array_agg(h.kind ORDER BY h.kind), '{}') FROM box_holds h WHERE h.box_id = b.id AND h.released_at IS NULL) AS holds`

/** Locks boxes in id order (the lock order) and returns them by id. */
export async function lockBoxes(c, ids) {
  const sorted = [...new Set(ids)].sort()
  if (!sorted.length) return new Map()
  const { rows } = await c.query(`SELECT id FROM boxes WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [sorted])
  if (!rows.length) return new Map()
  const { rows: full } = await c.query(
    `SELECT ${BOX_COLUMNS} FROM boxes b LEFT JOIN wh_locations l ON l.id = b.location_id WHERE b.id = ANY($1::uuid[])`,
    [sorted],
  )
  return new Map(full.map((r) => [r.id, r]))
}

export async function lockBox(c, id) {
  return (await lockBoxes(c, [id])).get(id) ?? null
}

export async function readBox(c, id) {
  const { rows } = await c.query(`SELECT ${BOX_COLUMNS} FROM boxes b LEFT JOIN wh_locations l ON l.id = b.location_id WHERE b.id = $1`, [id])
  return rows[0] ?? null
}

const sellable = async (c, id) => (await c.query('SELECT box_shelf_sellable($1) AS s', [id])).rows[0].s

/** Line → net change in shelf-sellable boxes, collected over a transaction. */
export const newDeltas = () => new Map()

/**
 * Applies `changes` (column → value) to a locked box, writes its event and
 * records the sellable delta. `ev` is the event: { type, actor, operationId,
 * scanId, reasonCode, reason, meta, holdAdded, holdReleased }. Returns the new row.
 * `skipStock`: the caller accounts for the stock itself (pick and unpick).
 */
export async function changeBox(c, box, changes, ev, deltas, { skipStock = false } = {}) {
  const before = skipStock ? false : await sellable(c, box.id)
  const cols = Object.keys(changes)
  const sets = cols.map((k, i) => `${k} = $${i + 3}`)
  const at = now()
  const { rows } = await c.query(
    `UPDATE boxes SET ${[...sets, `version = version + 1`, `updated_at = $${cols.length + 3}`].join(', ')}
      WHERE id = $1 AND version = $2 RETURNING *`,
    [box.id, box.version, ...cols.map((k) => changes[k]), at],
  )
  if (!rows.length) throw whError('CONFLICT_RETRY_EXHAUSTED', 'This box was just changed by someone else. Scan it again.')
  const after = skipStock ? false : await sellable(c, box.id)
  await writeEvent(c, box, rows[0], ev, at)
  if (!skipStock && before !== after) deltas.set(box.line_id, (deltas.get(box.line_id) ?? 0) + (after ? 1 : -1))
  // Keep the caller's copy current (as bumpAndLog does), so a hold change right after uses the new version.
  Object.assign(box, rows[0])
  return { ...box }
}

export async function writeEvent(c, before, after, ev, at = now()) {
  await c.query(
    `INSERT INTO box_events (id, box_id, type, operation_id, scan_id, actor_id, created_at, from_lifecycle, to_lifecycle,
                             from_location, to_location, from_quality, to_quality, hold_added, hold_released, order_id,
                             reason_code, reason, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    [
      newId('bev'), before.id, ev.type, ev.operationId ?? null, ev.scanId ?? null, ev.actor.id, at,
      before.lifecycle, after.lifecycle, before.location_id ?? null, after.location_id ?? null, before.quality, after.quality,
      ev.holdAdded ?? null, ev.holdReleased ?? null, after.order_id ?? before.order_id ?? ev.orderId ?? null,
      ev.reasonCode ?? null, ev.reason ?? null, ev.meta ?? null,
    ],
  )
}

/** Adds a hold (no-op if that kind is already on). Returns true when added. */
export async function addHold(c, box, kind, reason, ev, deltas, { recallId = null } = {}) {
  const before = await sellable(c, box.id)
  const ins = await c.query(
    `INSERT INTO box_holds (id, box_id, kind, reason, added_by, added_at, recall_id) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (box_id, kind) WHERE released_at IS NULL DO NOTHING`,
    [newId('bho'), box.id, kind, reason, ev.actor.id, now(), recallId],
  )
  if (!ins.rowCount) return false
  await bumpAndLog(c, box, { ...ev, holdAdded: kind, reason: ev.reason ?? reason }, deltas, before)
  return true
}

/** Releases one kind of hold, never any other. Returns true when one was released. */
export async function releaseHold(c, box, kind, reason, ev, deltas) {
  const before = await sellable(c, box.id)
  const upd = await c.query(
    `UPDATE box_holds SET released_at = $3, released_by = $4, release_reason = $5 WHERE box_id = $1 AND kind = $2 AND released_at IS NULL`,
    [box.id, kind, now(), ev.actor.id, reason],
  )
  if (!upd.rowCount) return false
  await bumpAndLog(c, box, { ...ev, holdReleased: kind, reason: ev.reason ?? reason }, deltas, before)
  return true
}

async function bumpAndLog(c, box, ev, deltas, before) {
  const at = now()
  const { rows } = await c.query('UPDATE boxes SET version = version + 1, updated_at = $3 WHERE id = $1 AND version = $2 RETURNING *', [box.id, box.version, at])
  if (!rows.length) throw whError('CONFLICT_RETRY_EXHAUSTED', 'This box was just changed by someone else. Scan it again.')
  Object.assign(box, rows[0])
  await writeEvent(c, box, rows[0], ev, at)
  const after = await sellable(c, box.id)
  if (before !== after) deltas.set(box.line_id, (deltas.get(box.line_id) ?? 0) + (after ? 1 : -1))
}

/** True when the Warehouse is on and the line's product has box tracking on (its stock follows its boxes). */
export async function trackedLine(c, lineId) {
  if (!env.WAREHOUSE_V2) return false
  const { rows } = await c.query(
    `SELECT p.box_tracking_enabled AS t FROM batch_lines l JOIN products p ON p.sku = l.sku WHERE l.id = $1`,
    [lineId],
  )
  return Boolean(rows[0]?.t)
}

const REASON = { 1: 'BOX_AVAILABLE', '-1': 'BOX_UNAVAILABLE' }

/**
 * Moves each tracked line's on_hand by its net change. A rise is a plain
 * ADJUST. A fall that leaves room for what is promised is a plain ADJUST too;
 * a fall below what is promised goes through the short-arrival path, which
 * gives the youngest orders' boxes back and refills, moves or flags them
 * (orders.js recordShortArrival). Lines in id order (the lock order).
 * Returns the order numbers the shortfall touched.
 */
export async function applyLineDeltas(c, deltas, actor, why, { reasonCode = null } = {}) {
  const out = { refilled: [], moved: [], atRisk: [] }
  for (const lineId of [...deltas.keys()].sort()) {
    const delta = deltas.get(lineId)
    if (!delta || !(await trackedLine(c, lineId))) continue
    // A condemned or exhausted batch's stock was written off with it.
    const st = (await c.query('SELECT b.status FROM batch_lines l JOIN batches b ON b.id = l.batch_id WHERE l.id = $1', [lineId])).rows[0]?.status
    if (['EXHAUSTED', 'CONDEMNED'].includes(st)) continue
    const code = reasonCode ?? REASON[Math.sign(delta)]
    const upd = await c.query(
      `UPDATE batch_lines SET on_hand = on_hand + $2
        WHERE id = $1 AND on_hand + $2 >= 0 AND on_hand + $2 - held - committed - reserve_buffer >= 0
        RETURNING batch_id, sku`,
      [lineId, delta],
    )
    if (upd.rowCount) {
      await ledger(c, { batchId: upd.rows[0].batch_id, eventType: 'ADJUST', sku: upd.rows[0].sku, delta, actorType: actor.type, actorId: actor.id, reason: why, reasonCode: code })
      continue
    }
    // Fewer sellable boxes than are promised: the shortfall path.
    const { rows } = await c.query('SELECT batch_id FROM batch_lines WHERE id = $1', [lineId])
    const r = await recordShortArrival(c, { batchId: rows[0].batch_id, lineId, delta, reason: why, reasonCode: code }, actor)
    out.refilled.push(...r.refilled)
    out.moved.push(...r.moved)
    out.atRisk.push(...r.atRisk)
  }
  deltas.clear()
  return out
}

// ---------------------------------------------------------------- the pickable rule, explained

/**
 * Why a box can't be picked today (or null when it can): the same rule as the
 * SQL function box_pickable(), in the order staff should fix things.
 */
export function pickProblem(box, { trackingOn, today = todayIST() } = {}) {
  if (box.lifecycle !== 'in_stock') {
    if (box.lifecycle === 'picked' || box.lifecycle === 'packed') return ['ALLOCATED_TO_OTHER_ORDER', 'Belongs to another order.']
    if (box.lifecycle === 'dispatched') return ['ALREADY_DISPATCHED', 'Already dispatched.']
    return ['INVALID_TRANSITION', `Box is ${box.lifecycle.replace('_', ' ')}; it cannot be picked.`]
  }
  if (box.holds?.length) return ['BOX_ON_HOLD', `On hold (${box.holds.map((h) => h.replace('_hold', '')).join(', ')}). Move it to the QC hold area.`]
  if (box.quality !== 'passed') return ['QC_NOT_PASSED', `Not QC-passed (${box.quality.replace('_', ' ')}).`]
  if (box.best_before < today) return ['EXPIRED', 'Expired. Move it to the disposal area.']
  if (!box.location_id || !box.location_active || !PICKABLE_TYPES.includes(box.location_type)) {
    return ['LOCATION_TYPE_NOT_ALLOWED', `Not in a pickable place (it is in ${box.location_name ?? 'no location'}). Move it to storage first.`]
  }
  if (!trackingOn) return ['INVALID_TRANSITION', 'Box tracking is off for this product.']
  return null
}

/** Where a box may be moved, by its state (brief 10.B). Returns an error code, or null. */
export function moveProblem(box, loc) {
  if (!loc.active) return ['LOCATION_INACTIVE', 'Cannot place this box here: the location is switched off.']
  if (loc.warehouse_id !== box.warehouse_id) return ['WRONG_WAREHOUSE', 'Not in this warehouse.']
  if (TERMINAL.includes(box.lifecycle) || box.lifecycle === 'dispatched' || box.lifecycle === 'generated') {
    return ['INVALID_TRANSITION', `Box is ${box.lifecycle}; it cannot be moved.`]
  }
  if (box.lifecycle === 'picked' && !['pick_staging', 'packing'].includes(loc.type)) {
    return ['LOCATION_TYPE_NOT_ALLOWED', 'A picked box can only go to pick staging or packing.']
  }
  if (box.lifecycle === 'packed' && !['packing', 'dispatch_bay'].includes(loc.type)) {
    return ['LOCATION_TYPE_NOT_ALLOWED', 'A packed box can only go to packing or the dispatch bay.']
  }
  const restricted = box.holds?.length || ['failed', 'needs_review'].includes(box.quality) || ['returned', 'missing'].includes(box.lifecycle)
  if (restricted && !QUARANTINE_TYPES.includes(loc.type)) {
    return ['LOCATION_TYPE_NOT_ALLOWED', 'This box is held or not QC-passed: it can only go to QC hold, returns or disposal.']
  }
  return null
}
