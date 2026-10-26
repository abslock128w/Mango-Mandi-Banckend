// Stocktake (cycle count) of one location (docs/warehouse/STOCKTAKE.md).
//
// A count is a staged scan session: it records the time it started (the
// snapshot), staff scan every box physically there, and nothing changes until
// Finish. Finish locks every box recorded there or scanned, then:
//   - boxes changed by anyone else after the snapshot are ignored (listed);
//   - scanned boxes recorded elsewhere get their location corrected;
//   - scanned boxes recorded missing come back in stock here;
//   - scanned boxes recorded as gone (dispatched, disposed, voided, repacked,
//     never received) get an investigation hold;
//   - boxes in stock here but not scanned are only *proposed* missing.
// A supervisor (warehouse.stocktake) reviews the proposals. Marking more than
// the D8 limit missing waits for a second person with adjust.approve, never
// the counter or the reviewer. Every applied change goes through changeBox, so
// on_hand keeps equal to the sellable boxes.
import { now } from '../clock.js'
import { newId } from '../ids.js'
import { WRITE_OFF_LIMIT } from './boxes.js'
import { formatBoxCode } from './codes.js'
import { addHold, applyLineDeltas, changeBox, lockBoxes, newDeltas, whError } from './core.js'

/** Lifecycles of a box that is physically here and has a recorded place. */
export const ON_FLOOR = ['in_stock', 'returned', 'picked', 'packed']
/** Recorded as having left for good (or never arrived): finding one is an investigation. */
const GONE = ['dispatched', 'disposed', 'voided', 'repacked', 'generated']

/** Context for a new count: the location, fixed, and the snapshot time. */
export async function stocktakeContext(c, context, who, at) {
  if (!context.locationId) throw whError('VALIDATION_ERROR', 'Choose the location you are counting', 400)
  const loc = (await c.query('SELECT * FROM wh_locations WHERE id = $1 AND warehouse_id = $2', [context.locationId, who.warehouseId])).rows[0]
  if (!loc) throw whError('NOT_FOUND', 'Location not found', 404)
  if (!loc.active) throw whError('LOCATION_INACTIVE', `${loc.name} is switched off`)
  const recorded = (await c.query(`SELECT count(*)::int AS n FROM boxes WHERE location_id = $1 AND lifecycle = ANY($2)`, [loc.id, ON_FLOOR])).rows[0].n
  return { locationId: loc.id, locationName: loc.name, locationType: loc.type, snapshotAt: at.toISOString(), recorded }
}

/** A scan in a count: every box is staged; the message says what Finish will do with it. */
export async function stocktakeScan(c, op, box, s) {
  await c.query('INSERT INTO wh_staged (operation_id, box_id, scan_id, staged_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [op.id, box.id, s.scanId, now()])
  const counts = await stocktakeCounts(c, op)
  const code = formatBoxCode(box.code)
  if (box.lifecycle === 'missing') {
    return { result: 'warning', code: 'FOUND_MISSING', message: `${code} was recorded missing. It goes back in stock here when you finish.`, detail: counts }
  }
  if (GONE.includes(box.lifecycle)) {
    const was = box.lifecycle === 'generated' ? 'never received' : box.lifecycle
    return { result: 'warning', code: 'RECORDED_GONE', message: `${code} is recorded as ${was}. Set it aside: it is held for a supervisor when you finish.`, detail: counts }
  }
  if (box.location_id !== op.location_id) {
    return { result: 'warning', code: 'FOUND_ELSEWHERE', message: `${code} is recorded in ${box.location_name ?? 'another place'}. Its location is corrected to here when you finish.`, detail: counts }
  }
  return { message: `${code} counted (${counts.staged} scanned, ${counts.needed} recorded here).`, detail: counts }
}

/** Scanned so far, and boxes recorded at the location now. */
export async function stocktakeCounts(c, op) {
  const { rows } = await c.query(
    `SELECT (SELECT count(*)::int FROM wh_staged WHERE operation_id = $1) AS staged,
            (SELECT count(*)::int FROM boxes WHERE location_id = $2 AND lifecycle = ANY($3)) AS needed`,
    [op.id, op.location_id, ON_FLOOR],
  )
  return rows[0]
}

/**
 * Finishes a count (inside the caller's transaction, the session row already
 * locked). Applies what is certain, records every discrepancy as a line and
 * returns the summary stored on the session.
 */
export async function finalizeStocktake(c, op, who) {
  const snapshot = new Date(op.context.snapshotAt ?? op.started_at)
  const staged = new Set((await c.query('SELECT box_id FROM wh_staged WHERE operation_id = $1', [op.id])).rows.map((r) => r.box_id))
  const here = (await c.query('SELECT id FROM boxes WHERE location_id = $1 AND lifecycle = ANY($2)', [op.location_id, ON_FLOOR])).rows.map((r) => r.id)
  const boxes = [...(await lockBoxes(c, [...staged, ...here])).values()].sort((a, b) => (a.id < b.id ? -1 : 1))
  const loc = (await c.query('SELECT * FROM wh_locations WHERE id = $1', [op.location_id])).rows[0]
  // Read after the locks, so a change committed just before is seen.
  const changed = new Set((await c.query(
    `SELECT DISTINCT box_id FROM box_events
      WHERE box_id = ANY($1::uuid[]) AND created_at > $2 AND operation_id IS DISTINCT FROM $3
        AND (from_location IS DISTINCT FROM to_location OR from_lifecycle IS DISTINCT FROM to_lifecycle)`,
    [boxes.map((b) => b.id), snapshot, op.id],
  )).rows.map((r) => r.box_id))

  const deltas = newDeltas()
  const ev = (type, extra = {}) => ({ type, actor: who.actor, operationId: op.id, reasonCode: 'stocktake', ...extra })
  const lines = []
  const out = { matched: 0, foundElsewhere: 0, foundMissing: 0, foundGone: 0, notFound: 0, notFoundAllocated: 0, movedAfterSnapshot: 0 }
  for (const b of boxes) {
    const scanned = staged.has(b.id)
    const recordedHere = b.location_id === loc.id && ON_FLOOR.includes(b.lifecycle)
    if (!scanned && !recordedHere) continue // moved away and not seen: nothing to say
    const line = { box: b, recordedLocation: b.location_id, recordedLifecycle: b.lifecycle }
    if (changed.has(b.id)) {
      lines.push({ ...line, kind: 'moved_after_snapshot', status: 'ignored' })
      out.movedAfterSnapshot++
      continue
    }
    if (scanned) {
      if (b.lifecycle === 'missing') {
        await changeBox(c, b, { lifecycle: 'in_stock', location_id: loc.id }, ev('FOUND', { reason: `Found in a count of ${loc.name}` }), deltas)
        lines.push({ ...line, kind: 'found_missing', status: 'applied' })
        out.foundMissing++
      } else if (GONE.includes(b.lifecycle)) {
        await addHold(c, b, 'investigation_hold', `Found in a count of ${loc.name} but recorded as ${b.lifecycle}`, ev('HOLD_ADDED'), deltas)
        lines.push({ ...line, kind: 'found_gone', status: 'applied' })
        out.foundGone++
      } else if (!recordedHere) {
        await changeBox(c, b, { location_id: loc.id }, ev('LOCATION_CORRECTED', { reason: `Counted in ${loc.name}` }), deltas)
        lines.push({ ...line, kind: 'found_elsewhere', status: 'applied' })
        out.foundElsewhere++
      } else {
        out.matched++
      }
      continue
    }
    // Recorded here, not scanned: a proposal for the review, nothing changes now.
    if (b.lifecycle === 'in_stock') {
      lines.push({ ...line, kind: 'not_found', status: 'proposed' })
      out.notFound++
    } else {
      lines.push({ ...line, kind: 'not_found_allocated', status: 'proposed' })
      out.notFoundAllocated++
    }
  }
  for (const l of lines) {
    await c.query(
      `INSERT INTO wh_stocktake_lines (operation_id, box_id, kind, status, recorded_location_id, recorded_lifecycle, box_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [op.id, l.box.id, l.kind, l.status, l.recordedLocation ?? null, l.recordedLifecycle, l.box.version],
    )
  }
  const shortfall = await applyLineDeltas(c, deltas, who.actor, `Stocktake of ${loc.name}`)
  return {
    locationId: loc.id, locationName: loc.name, snapshotAt: snapshot.toISOString(), counted: staged.size, ...out,
    toReview: out.notFound + out.notFoundAllocated, ...(shortfall.atRisk.length || shortfall.moved.length || shortfall.refilled.length ? { shortfall } : {}),
  }
}

// ---------------------------------------------------------------- review

async function lockStocktake(c, opId, who) {
  const op = (await c.query(`SELECT * FROM wh_operations WHERE id = $1 AND warehouse_id = $2 AND type = 'stocktake' FOR UPDATE`, [opId, who.warehouseId])).rows[0]
  if (!op) throw whError('NOT_FOUND', 'Stocktake not found', 404)
  return op
}

/**
 * Marks the review's boxes missing, each only if nothing changed since the
 * count finished (same version, still in stock at the counted place);
 * otherwise the line is superseded and the box left alone.
 */
async function applyMissing(c, op, lines, review, who) {
  const boxes = await lockBoxes(c, lines.map((l) => l.box_id))
  const deltas = newDeltas()
  const applied = []
  const superseded = []
  for (const l of [...lines].sort((a, b) => (a.box_id < b.box_id ? -1 : 1))) {
    const b = boxes.get(l.box_id)
    const same = b && b.version === l.box_version && b.lifecycle === 'in_stock' && b.location_id === l.recorded_location_id
    if (!same) {
      superseded.push(l.box_id)
      await c.query(`UPDATE wh_stocktake_lines SET status = 'superseded', decided_by = $3, decided_at = $4 WHERE operation_id = $1 AND box_id = $2`, [op.id, l.box_id, who.actor.id, now()])
      continue
    }
    await changeBox(
      c, b, { lifecycle: 'missing', location_id: null },
      { type: 'MISSING', actor: who.actor, operationId: op.id, reasonCode: 'stocktake', reason: review.note ?? `Not found in a count of ${op.context.locationName}`, meta: { reviewId: review.id } },
      deltas,
    )
    await c.query(`UPDATE wh_stocktake_lines SET status = 'missing', decided_by = $3, decided_at = $4 WHERE operation_id = $1 AND box_id = $2`, [op.id, l.box_id, who.actor.id, now()])
    applied.push(formatBoxCode(b.code))
  }
  const shortfall = await applyLineDeltas(c, deltas, who.actor, `Stocktake of ${op.context.locationName}: boxes missing`)
  return { missing: applied, superseded: superseded.length, shortfall }
}

/**
 * Kept boxes that were on an order (or returned) and not found where they
 * were recorded get an investigation hold, so the order shows in the
 * exceptions queue (a held box on an order) until someone finds the box.
 * Only boxes unchanged since the count; one that moved on is left alone.
 */
async function holdKeptAllocated(c, op, lines, who) {
  if (!lines.length) return 0
  const boxes = await lockBoxes(c, lines.map((l) => l.box_id))
  const deltas = newDeltas()
  let held = 0
  for (const l of [...lines].sort((a, b) => (a.box_id < b.box_id ? -1 : 1))) {
    const b = boxes.get(l.box_id)
    if (!b || b.version !== l.box_version || b.lifecycle !== l.recorded_lifecycle || b.location_id !== l.recorded_location_id) continue
    const order = b.order_id ? (await c.query('SELECT number FROM orders WHERE id = $1', [b.order_id])).rows[0]?.number : null
    const why = `Not found in a count of ${op.context.locationName}${order ? ` while on order ${order}` : ''}`
    if (await addHold(c, b, 'investigation_hold', why, { type: 'HOLD_ADDED', actor: who.actor, operationId: op.id, reasonCode: 'stocktake', meta: { orderId: b.order_id ?? null } }, deltas)) held++
  }
  await applyLineDeltas(c, deltas, who.actor, `Stocktake of ${op.context.locationName}: boxes to look for`)
  return held
}

/**
 * A supervisor's decision on every proposed line of a finished count: each
 * box is either marked missing or kept as recorded. `rest` ('missing' or
 * 'keep') decides every line not listed, so a big count is reviewed with a
 * short request; `rest: 'missing'` keeps the boxes that can only be kept. A
 * box on an order can only be kept (take it off the order first); a kept one
 * gets an investigation hold. Over the D8 limit, the missing part waits for a
 * second person. Only a manager may review a count they did themselves.
 */
export async function reviewStocktake(c, opId, { missing: listedMissing = [], keep: listedKeep = [], rest = null, note = null }, who) {
  const op = await lockStocktake(c, opId, who)
  if (op.status !== 'completed') throw whError('INVALID_TRANSITION', 'Finish the count before reviewing it')
  if (op.owner_id === who.actor.id && who.role !== 'MANAGER') throw whError('SELF_REVIEW', 'Someone who did not count this must review it (or a manager)', 403)
  if ((await c.query('SELECT 1 FROM wh_stocktake_reviews WHERE operation_id = $1', [op.id])).rowCount) throw whError('INVALID_TRANSITION', 'This count has already been reviewed')
  const lines = (await c.query(`SELECT * FROM wh_stocktake_lines WHERE operation_id = $1 AND status = 'proposed' ORDER BY box_id FOR UPDATE`, [op.id])).rows
  if (!lines.length) throw whError('NOTHING_TO_REVIEW', 'Nothing in this count needs a review')
  const byBox = new Map(lines.map((l) => [l.box_id, l]))
  const listed = [...listedMissing, ...listedKeep]
  if (new Set(listed).size !== listed.length) throw whError('VALIDATION_ERROR', 'A box is listed twice', 400)
  if (listed.some((id) => !byBox.has(id))) throw whError('VALIDATION_ERROR', 'A box listed is not waiting for review in this count', 400)
  if (listedMissing.some((id) => byBox.get(id).kind !== 'not_found')) {
    throw whError('VALIDATION_ERROR', 'A box on an order or a returned box cannot be marked missing here: take it off the order or write it off', 400)
  }
  const decided = new Set(listed)
  const undecided = lines.filter((l) => !decided.has(l.box_id))
  if (undecided.length && !rest) throw whError('VALIDATION_ERROR', `Decide every box: ${undecided.length} not decided yet`, 400)
  const missing = [...listedMissing, ...(rest === 'missing' ? undecided.filter((l) => l.kind === 'not_found').map((l) => l.box_id) : [])]
  const keep = [...listedKeep, ...undecided.filter((l) => rest === 'keep' || l.kind !== 'not_found').map((l) => l.box_id)]
  const boxes = await lockBoxes(c, missing)
  const grams = [...boxes.values()].reduce((g, b) => g + (b.measured_weight_g ?? b.nominal_weight_g), 0)
  const big = missing.length > WRITE_OFF_LIMIT.boxes || grams > WRITE_OFF_LIMIT.grams
  const review = { id: newId('str'), note }
  await c.query(
    `INSERT INTO wh_stocktake_reviews (id, operation_id, warehouse_id, missing_count, missing_grams, kept_count, note, status, reviewed_by, reviewed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [review.id, op.id, op.warehouse_id, missing.length, grams, keep.length, note, big ? 'pending_approval' : 'applied', who.actor.id, now()],
  )
  await c.query(
    `UPDATE wh_stocktake_lines SET status = 'kept', review_id = $3, decided_by = $4, decided_at = $5 WHERE operation_id = $1 AND box_id = ANY($2::uuid[])`,
    [op.id, keep, review.id, who.actor.id, now()],
  )
  await c.query(`UPDATE wh_stocktake_lines SET review_id = $3 WHERE operation_id = $1 AND box_id = ANY($2::uuid[])`, [op.id, missing, review.id])
  const heldToFind = await holdKeptAllocated(c, op, keep.map((id) => byBox.get(id)).filter((l) => l.kind === 'not_found_allocated'), who)
  if (big) {
    await c.query(`UPDATE wh_stocktake_lines SET status = 'pending_approval' WHERE operation_id = $1 AND box_id = ANY($2::uuid[])`, [op.id, missing])
    return { reviewId: review.id, status: 'pending_approval', missing: missing.length, grams, kept: keep.length, heldToFind }
  }
  const r = await applyMissing(c, op, missing.map((id) => byBox.get(id)), review, who)
  return { reviewId: review.id, status: 'applied', missing: r.missing.length, superseded: r.superseded, kept: keep.length, heldToFind, grams, shortfall: r.shortfall }
}

/** The second person's decision on a big review (D8): apply the missing boxes, or leave them as recorded. */
export async function decideStocktakeReview(c, opId, approve, who) {
  const op = await lockStocktake(c, opId, who)
  const review = (await c.query('SELECT * FROM wh_stocktake_reviews WHERE operation_id = $1 FOR UPDATE', [op.id])).rows[0]
  if (!review) throw whError('NOT_FOUND', 'This count has no review waiting', 404)
  if (review.status !== 'pending_approval') throw whError('INVALID_TRANSITION', `This review is already ${review.status.replace('_', ' ')}`)
  if (review.reviewed_by === who.actor.id || op.owner_id === who.actor.id) throw whError('SELF_APPROVAL', 'Someone who did not count or review this must approve it', 403)
  const lines = (await c.query(`SELECT * FROM wh_stocktake_lines WHERE operation_id = $1 AND status = 'pending_approval' ORDER BY box_id FOR UPDATE`, [op.id])).rows
  let r = null
  if (approve) r = await applyMissing(c, op, lines, review, who)
  else {
    await c.query(`UPDATE wh_stocktake_lines SET status = 'rejected', decided_by = $2, decided_at = $3 WHERE operation_id = $1 AND status = 'pending_approval'`, [op.id, who.actor.id, now()])
  }
  await c.query('UPDATE wh_stocktake_reviews SET status = $2, decided_by = $3, decided_at = $4 WHERE id = $1', [review.id, approve ? 'applied' : 'rejected', who.actor.id, now()])
  return { reviewId: review.id, status: approve ? 'applied' : 'rejected', missing: r?.missing.length ?? 0, superseded: r?.superseded ?? 0, shortfall: r?.shortfall ?? null }
}

// ---------------------------------------------------------------- read

const reviewView = (r) => r && ({
  id: r.id, status: r.status, missing: r.missing_count, grams: r.missing_grams, kept: r.kept_count, note: r.note, reviewedBy: r.reviewed_email ?? null,
  reviewedAt: r.reviewed_at, decidedBy: r.decided_email ?? null, decidedAt: r.decided_at,
})

export async function listStocktakes(c, who) {
  const { rows } = await c.query(
    `SELECT o.*, a.email AS owner_email, r.status AS review_status,
            (SELECT count(*)::int FROM wh_stocktake_lines l WHERE l.operation_id = o.id AND l.status = 'proposed') AS to_review,
            (SELECT count(*)::int FROM wh_stocktake_lines l WHERE l.operation_id = o.id AND l.status = 'pending_approval') AS to_approve
       FROM wh_operations o LEFT JOIN admin_users a ON a.id = o.owner_id LEFT JOIN wh_stocktake_reviews r ON r.operation_id = o.id
      WHERE o.warehouse_id = $1 AND o.type = 'stocktake' ORDER BY o.started_at DESC LIMIT 100`,
    [who.warehouseId],
  )
  return rows.map((o) => ({
    id: o.id, status: o.status, locationId: o.location_id, locationName: o.context.locationName, snapshotAt: o.context.snapshotAt, owner: o.owner_email,
    mine: o.owner_id === who.actor.id, startedAt: o.started_at, finishedAt: o.finished_at, result: o.result, reviewStatus: o.review_status ?? null,
    toReview: o.to_review, toApprove: o.to_approve,
  }))
}

export async function getStocktake(c, opId, who) {
  const op = (await c.query(
    `SELECT o.*, a.email AS owner_email FROM wh_operations o LEFT JOIN admin_users a ON a.id = o.owner_id
      WHERE o.id = $1 AND o.warehouse_id = $2 AND o.type = 'stocktake'`,
    [opId, who.warehouseId],
  )).rows[0]
  if (!op) throw whError('NOT_FOUND', 'Stocktake not found', 404)
  const lines = (await c.query(
    `SELECT l.*, b.code, b.sku_name, b.lifecycle, b.location_id, cur.name AS location_name, rec.name AS recorded_location_name,
            (SELECT coalesce(array_agg(h.kind ORDER BY h.kind), '{}') FROM box_holds h WHERE h.box_id = b.id AND h.released_at IS NULL) AS holds,
            o.number AS order_number
       FROM wh_stocktake_lines l JOIN boxes b ON b.id = l.box_id
       LEFT JOIN wh_locations cur ON cur.id = b.location_id LEFT JOIN wh_locations rec ON rec.id = l.recorded_location_id
       LEFT JOIN orders o ON o.id = b.order_id
      WHERE l.operation_id = $1 ORDER BY l.kind, b.code`,
    [op.id],
  )).rows
  const review = (await c.query(
    `SELECT r.*, a.email AS reviewed_email, d.email AS decided_email FROM wh_stocktake_reviews r
       LEFT JOIN admin_users a ON a.id = r.reviewed_by LEFT JOIN admin_users d ON d.id = r.decided_by WHERE r.operation_id = $1`,
    [op.id],
  )).rows[0]
  return {
    id: op.id, status: op.status, locationId: op.location_id, locationName: op.context.locationName, snapshotAt: op.context.snapshotAt, owner: op.owner_email,
    mine: op.owner_id === who.actor.id, startedAt: op.started_at, finishedAt: op.finished_at, result: op.result,
    review: review ? { ...reviewView(review), mine: review.reviewed_by === who.actor.id } : null,
    lines: lines.map((l) => ({
      boxId: l.box_id, code: formatBoxCode(l.code), skuName: l.sku_name, kind: l.kind, status: l.status, recordedLifecycle: l.recorded_lifecycle,
      recordedLocation: l.recorded_location_name, lifecycle: l.lifecycle, location: l.location_name, holds: l.holds, orderNumber: l.order_number,
      decidedAt: l.decided_at,
    })),
  }
}
