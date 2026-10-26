// Repack, split, merge and partial damage (docs/warehouse/REPACK.md).
//
// A repack is a staged scan session: staff scan the boxes going in (in stock,
// not on an order; held boxes are allowed), then Finish with the new boxes'
// weights and what was taken out. Finish, in one transaction under locks:
//   - re-checks every source (still in stock, still unallocated);
//   - creates the new boxes with new codes and labels, parent_box_ids = the
//     sources, the earliest best-before of the sources, on the stock line of
//     the source with that date, and links every source lot and batch
//     (box_origins), so trace and recalls follow them;
//   - carries recall and investigation holds over (a recall still finds and
//     releases them); new boxes need QC again when the product requires it or
//     any source had not passed;
//   - checks the weights add up: what went in = new boxes + weight taken out,
//     within the product's weighing tolerance;
//   - ends the sources as repacked.
// Fruit from a condemned or exhausted batch never goes into a repack (it would
// come out as sellable stock on another batch), and when a batch is condemned
// later, boxes holding its fruit are held (holdFruitOfBatch).
// Partial damage without a repack adjusts a box's weight and fruit count with
// an event; below the product's tolerance the box goes to review.
import { now } from '../clock.js'
import { logger } from '../logger.js'
import { formatBoxCode, newBoxCode, newToken } from './codes.js'
import { addHold, applyLineDeltas, changeBox, HOLD_KINDS, lockBoxes, newDeltas, releaseHold, whError, writeEvent } from './core.js'
import { REPACK_SEQ_BASE, refreshLotCounts } from './lots.js'

export const REPACK_REASONS = ['spoiled_fruit', 'damaged_box', 'merge_partials', 'split', 'other']
export const DAMAGE_REASONS = ['spoiled_fruit', 'damaged_box', 'other']
/** Where a repack bench may be: a place that is not stock (new boxes are not sellable until put away). */
export const REPACK_PLACES = ['receiving', 'qc_hold', 'packing', 'returns']
/** Holds that follow the fruit into the new boxes. A damage or QC hold is what the repack deals with. */
export const CARRIED_HOLDS = ['recall_hold', 'investigation_hold']
export const MAX_SOURCES = 50
export const MAX_OUTPUTS = 20
/**
 * New boxes join the lot of their oldest source, numbered from
 * REPACK_SEQ_BASE (lots.js), so intake numbering never meets them. They do
 * count in the lot's label counts (target, generated, verified), the same way
 * the previous release counts every box of a lot, so its checks keep holding
 * if it runs on this data.
 */
export { REPACK_SEQ_BASE }
/** The schema's ceiling on a lot's label count (034 box_lots.target_count). */
const LOT_LABEL_CEILING = 20_000
/** Batches whose fruit is off sale for good. */
const OUT_OF_SERVICE = ['CONDEMNED', 'EXHAUSTED']

const reject = (code, message, extra) => {
  throw whError(code, message, 409, extra)
}

/** Context for a new repack: the bench where the new boxes are made, and why. */
export async function repackContext(c, context, who) {
  if (!context.locationId) throw whError('VALIDATION_ERROR', 'Choose where you are repacking (the new boxes start there)', 400)
  if (!REPACK_REASONS.includes(context.reasonCode)) throw whError('VALIDATION_ERROR', `Choose a reason: ${REPACK_REASONS.join(', ')}`, 400)
  const reason = String(context.reason ?? '').trim().slice(0, 300)
  if (reason.length < 3) throw whError('VALIDATION_ERROR', 'Say what is being repacked and why', 400)
  const loc = (await c.query('SELECT * FROM wh_locations WHERE id = $1 AND warehouse_id = $2', [context.locationId, who.warehouseId])).rows[0]
  if (!loc) throw whError('NOT_FOUND', 'Location not found', 404)
  if (!loc.active) throw whError('LOCATION_INACTIVE', `${loc.name} is switched off`)
  if (!REPACK_PLACES.includes(loc.type)) throw whError('LOCATION_TYPE_NOT_ALLOWED', 'Repack at a receiving, QC hold, packing or returns place, not on a storage shelf')
  return { locationId: loc.id, locationName: loc.name, locationType: loc.type, reasonCode: context.reasonCode, reason }
}

/** Why a box cannot go into a repack (or null). */
function sourceProblem(box) {
  if (box.order_id || ['picked', 'packed', 'dispatched'].includes(box.lifecycle)) {
    return ['INVALID_TRANSITION', `${formatBoxCode(box.code)} is on an order. Take it off the order first.`]
  }
  if (box.lifecycle !== 'in_stock') return ['INVALID_TRANSITION', `${formatBoxCode(box.code)} is ${box.lifecycle.replace('_', ' ')}; only boxes in stock can be repacked.`]
  return null
}

/**
 * Boxes (of those given) holding fruit from a condemned or exhausted batch:
 * their own batch or any batch their fruit came from. id → batch row.
 */
async function outOfServiceFruit(c, boxIds) {
  const { rows } = await c.query(
    `SELECT DISTINCT ON (x.box_id) x.box_id, bt.id AS batch_id, bt.status FROM (
        SELECT id AS box_id, batch_id FROM boxes WHERE id = ANY($1::uuid[])
        UNION SELECT box_id, batch_id FROM box_origins WHERE box_id = ANY($1::uuid[])) x
       JOIN batches bt ON bt.id = x.batch_id
      WHERE bt.status = ANY($2) ORDER BY x.box_id, bt.id`,
    [boxIds, OUT_OF_SERVICE],
  )
  return new Map(rows.map((r) => [r.box_id, r]))
}

const outOfServiceMessage = (box, batch) =>
  `${formatBoxCode(box.code)} holds fruit from batch ${batch.batch_id}, which is ${batch.status.toLowerCase()}. It cannot be repacked: write it off.`

/** A scan in a repack: the box goes in, if it can. Staging changes nothing yet. */
export async function repackScan(c, op, box, s) {
  const p = sourceProblem(box)
  if (p) reject(...p)
  const condemned = (await outOfServiceFruit(c, [box.id])).get(box.id)
  if (condemned) reject('BATCH_OUT_OF_SERVICE', outOfServiceMessage(box, condemned))
  const staged = (await c.query('SELECT b.sku, b.sku_name FROM wh_staged st JOIN boxes b ON b.id = st.box_id WHERE st.operation_id = $1', [op.id])).rows
  const other = staged.find((x) => x.sku !== box.sku)
  if (other) reject('WRONG_VARIANT', `${formatBoxCode(box.code)} is ${box.sku_name}; this repack is ${other.sku_name}. One product per box.`)
  if (staged.length >= MAX_SOURCES) reject('VALIDATION_ERROR', `At most ${MAX_SOURCES} boxes go into one repack. Finish this one first.`)
  const elsewhere = (await c.query(
    `SELECT 1 FROM wh_staged st JOIN wh_operations o ON o.id = st.operation_id WHERE st.box_id = $1 AND st.operation_id <> $2 AND o.status = 'open' AND o.type = 'repack'`,
    [box.id, op.id],
  )).rowCount
  await c.query('INSERT INTO wh_staged (operation_id, box_id, scan_id, staged_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [op.id, box.id, s.scanId, now()])
  const counts = { staged: staged.length + 1, needed: 0 }
  const held = box.holds?.length ? ` (held: ${box.holds.map((h) => h.replace('_hold', '')).join(', ')})` : ''
  if (elsewhere) return { result: 'warning', code: 'STAGED_ELSEWHERE', message: `${formatBoxCode(box.code)} is also in another open repack. The first to finish gets it.`, detail: counts }
  return { message: `${formatBoxCode(box.code)} goes in${held}. ${counts.staged} ${counts.staged === 1 ? 'box' : 'boxes'} in.`, detail: counts }
}

const grams = (b) => b.measured_weight_g ?? b.nominal_weight_g
const outOfTolerance = (w, nominal, pct) => (Math.abs(w - nominal) / nominal) * 100 > pct

async function insertOutput(c, row) {
  for (let attempt = 0; ; attempt++) {
    const code = newBoxCode()
    const token = newToken()
    await c.query('SAVEPOINT repack_box')
    try {
      const { rows } = await c.query(
        `INSERT INTO boxes (code, label_token, lot_id, line_id, batch_id, sku, sku_name, seq, warehouse_id, location_id, lifecycle, quality, verification,
                            nominal_weight_g, measured_weight_g, fruit_count, best_before, parent_box_ids, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'in_stock', $11, $12, $13, $14, $15, $16, $17, $18, $18) RETURNING *`,
        [code, token, row.lot_id, row.line_id, row.batch_id, row.sku, row.sku_name, row.seq, row.warehouse_id, row.location_id, row.quality, row.verification,
          row.nominal_weight_g, row.measured_weight_g, row.fruit_count, row.best_before, row.parent_box_ids, row.at],
      )
      await c.query('RELEASE SAVEPOINT repack_box')
      return rows[0]
    } catch (err) {
      await c.query('ROLLBACK TO SAVEPOINT repack_box')
      if (err.code !== '23505' || attempt >= 3 || !/code|token/.test(err.constraint ?? '')) throw err
      logger.warn({ constraint: err.constraint }, 'repack: box code collision, trying another')
    }
  }
}

/**
 * Finishes a repack (inside the caller's transaction, session row locked).
 * `body`: { outputs: [{ weightG, fruitCount? }], fruitRemoved, weightLostG, note? }.
 * A source that changed since it was scanned stops the finish with STALE_SCAN
 * (extra.unstage lists them, so the caller can drop them from the session).
 */
export async function finalizeRepack(c, op, who, body) {
  const outputs = Array.isArray(body?.outputs) ? body.outputs : []
  if (!outputs.length || outputs.length > MAX_OUTPUTS) throw whError('VALIDATION_ERROR', `Give between 1 and ${MAX_OUTPUTS} new boxes`, 400)
  for (const o of outputs) {
    if (!Number.isInteger(o.weightG) || o.weightG < 1 || o.weightG > 100_000) throw whError('VALIDATION_ERROR', 'Weigh every new box (grams)', 400)
    if (o.fruitCount != null && (!Number.isInteger(o.fruitCount) || o.fruitCount < 1 || o.fruitCount > 200)) throw whError('VALIDATION_ERROR', 'Fruit count must be 1 to 200', 400)
  }
  const fruitRemoved = Number(body.fruitRemoved ?? 0)
  const declaredLostG = body.weightLostG == null ? null : Number(body.weightLostG)
  if (!Number.isInteger(fruitRemoved) || fruitRemoved < 0 || (declaredLostG !== null && (!Number.isInteger(declaredLostG) || declaredLostG < 0))) {
    throw whError('VALIDATION_ERROR', 'Fruit removed and weight lost are whole numbers, 0 or more', 400)
  }
  const ids = (await c.query('SELECT box_id FROM wh_staged WHERE operation_id = $1', [op.id])).rows.map((r) => r.box_id)
  if (!ids.length) throw whError('INCOMPLETE_SET', 'Scan the boxes going into the repack first.')
  const sources = [...(await lockBoxes(c, ids)).values()].sort((a, b) => (a.id < b.id ? -1 : 1))
  const stale = sources.filter((b) => sourceProblem(b))
  if (stale.length) {
    const codes = stale.map((b) => formatBoxCode(b.code))
    throw whError('STALE_SCAN', `${codes.join(', ')} changed since ${codes.length === 1 ? 'it was' : 'they were'} scanned and cannot go in. They are taken out of this repack.`, 409, {
      boxes: codes, unstage: stale.map((b) => b.id),
    })
  }
  // A batch condemned (or retired) after the scan: its fruit stays out.
  const condemned = await outOfServiceFruit(c, sources.map((b) => b.id))
  if (condemned.size) {
    const bad = sources.filter((b) => condemned.has(b.id))
    throw whError('BATCH_OUT_OF_SERVICE', `${bad.map((b) => outOfServiceMessage(b, condemned.get(b.id))).join(' ')} ${bad.length === 1 ? 'It is' : 'They are'} taken out of this repack.`, 409, {
      boxes: bad.map((b) => formatBoxCode(b.code)), unstage: bad.map((b) => b.id),
    })
  }
  if (new Set(sources.map((b) => b.sku)).size > 1) throw whError('WRONG_VARIANT', 'The boxes going in are different products. One product per box.')
  const loc = (await c.query('SELECT * FROM wh_locations WHERE id = $1', [op.location_id])).rows[0]
  if (!loc?.active || !REPACK_PLACES.includes(loc.type)) throw whError('LOCATION_INACTIVE', `${loc?.name ?? 'The repack place'} can no longer take boxes. Start a new repack.`)
  const product = (await c.query('SELECT name, requires_qc, nominal_weight_g, weight_tolerance_pct FROM products WHERE sku = $1', [sources[0].sku])).rows[0]
  const tol = Number(product.weight_tolerance_pct)
  const inGrams = sources.reduce((g, b) => g + grams(b), 0)
  const outGrams = outputs.reduce((g, o) => g + o.weightG, 0)
  // Scales differ a little: the product's weight tolerance of what went in.
  const slack = Math.round((inGrams * tol) / 100)
  if (outGrams > inGrams + slack) {
    throw whError('VALIDATION_ERROR', `The new boxes weigh ${outGrams} g, more than the ${inGrams} g that went in. Weigh them again.`, 400)
  }
  // Weight taken out not given: it is what the scales say went missing.
  const weightLostG = declaredLostG ?? Math.max(0, inGrams - outGrams)
  if (Math.abs(inGrams - outGrams - weightLostG) > slack) {
    throw whError(
      'WEIGHT_MISMATCH',
      `${inGrams} g went in, but the new boxes (${outGrams} g) and the weight taken out (${weightLostG} g) come to ${outGrams + weightLostG} g. Weigh again, or record what was taken out.`,
      400,
      { inGrams, outGrams, weightLostG, toleranceG: slack },
    )
  }
  // Fruit counts, when every box going in and coming out has one, must add up too.
  const inFruit = sources.every((b) => b.fruit_count != null) ? sources.reduce((n, b) => n + b.fruit_count, 0) : null
  const outFruit = outputs.every((o) => o.fruitCount != null) ? outputs.reduce((n, o) => n + o.fruitCount, 0) : null
  if (inFruit !== null && outFruit !== null && inFruit - fruitRemoved !== outFruit) {
    throw whError('FRUIT_MISMATCH', `${inFruit} fruit went in and ${fruitRemoved} were taken out, so the new boxes should hold ${inFruit - fruitRemoved}, not ${outFruit}. Count again.`, 400, { inFruit, outFruit, fruitRemoved })
  }

  // The oldest fruit decides the date and the stock line (FEFO keeps working).
  const primary = [...sources].sort((a, b) => (a.best_before < b.best_before ? -1 : a.best_before > b.best_before ? 1 : a.id < b.id ? -1 : 1))[0]
  const holds = (await c.query(
    `SELECT DISTINCT ON (kind) kind, reason, recall_id FROM box_holds WHERE box_id = ANY($1::uuid[]) AND released_at IS NULL AND kind = ANY($2) ORDER BY kind, added_at`,
    [sources.map((b) => b.id), CARRIED_HOLDS],
  )).rows
  const needsQc = product.requires_qc || sources.some((b) => b.quality !== 'passed')
  const nominal = product.nominal_weight_g ?? primary.nominal_weight_g
  // New sequence numbers on the primary lot (locked, so two repacks into one lot never collide).
  const lot = (await c.query('SELECT id, target_count FROM box_lots WHERE id = $1 FOR UPDATE', [primary.lot_id])).rows[0]
  if (lot.target_count + outputs.length > LOT_LABEL_CEILING) {
    throw whError('VALIDATION_ERROR', `The lot of the oldest box already has ${lot.target_count} labels; it cannot take ${outputs.length} more.`, 409)
  }
  let seq = (await c.query('SELECT coalesce(max(seq), $2)::int AS n FROM boxes WHERE lot_id = $1 AND seq > $2', [primary.lot_id, REPACK_SEQ_BASE])).rows[0].n
  const origins = (await c.query(
    `SELECT lot_id, batch_id FROM boxes WHERE id = ANY($1::uuid[]) UNION SELECT lot_id, batch_id FROM box_origins WHERE box_id = ANY($1::uuid[])`,
    [sources.map((b) => b.id)],
  )).rows
  const kind = sources.length === 1 && outputs.length > 1 ? 'split' : sources.length > 1 && outputs.length === 1 ? 'merge' : 'repack'
  const at = now()
  const deltas = newDeltas()
  const ev = (type, extra = {}) => ({ type, actor: who.actor, operationId: op.id, reasonCode: op.context.reasonCode, reason: op.context.reason, ...extra })
  const made = []
  for (const o of outputs) {
    const quality = needsQc ? 'pending' : outOfTolerance(o.weightG, nominal, tol) ? 'needs_review' : 'passed'
    const row = await insertOutput(c, {
      lot_id: primary.lot_id, line_id: primary.line_id, batch_id: primary.batch_id, sku: primary.sku, sku_name: primary.sku_name, seq: ++seq,
      warehouse_id: primary.warehouse_id, location_id: loc.id, quality, verification: primary.verification ?? 'scanned', nominal_weight_g: nominal, measured_weight_g: o.weightG,
      fruit_count: o.fruitCount ?? null, best_before: primary.best_before, parent_box_ids: sources.map((b) => b.id), at,
    })
    await c.query('INSERT INTO box_labels (token, box_id, issued_at, issued_by) VALUES ($1, $2, $3, $4)', [row.label_token, row.id, at, who.actor.id])
    await writeEvent(c, { id: row.id, lifecycle: null, location_id: null, quality: null }, row, ev('REPACK_CREATED', {
      meta: { kind, parents: sources.map((b) => formatBoxCode(b.code)), weightG: o.weightG, fruitCount: o.fruitCount ?? null },
    }), at)
    for (const og of origins) {
      await c.query('INSERT INTO box_origins (box_id, lot_id, batch_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [row.id, og.lot_id, og.batch_id])
    }
    const box = { ...row, holds: [] }
    if (quality === 'pending') await addHold(c, box, 'qc_hold', 'Repacked: QC again', ev('HOLD_ADDED'), deltas)
    for (const h of holds) await addHold(c, box, h.kind, h.reason, ev('HOLD_ADDED'), deltas, { recallId: h.recall_id })
    // A new box at a repack bench is never shelf stock; checked rather than assumed.
    if ((await c.query('SELECT box_shelf_sellable($1) AS s', [row.id])).rows[0].s) deltas.set(row.line_id, (deltas.get(row.line_id) ?? 0) + 1)
    made.push({ id: row.id, code: formatBoxCode(row.code), quality, weightG: o.weightG })
  }
  // The new labels count on the lot like any other (target, generated, verified), so lot checks hold in every release.
  await c.query('UPDATE box_lots SET target_count = target_count + $2, updated_at = $3 WHERE id = $1', [lot.id, made.length, at])
  await refreshLotCounts(c, lot.id)
  const into = made.map((m) => m.code)
  for (const b of sources) {
    const kinds = [...b.holds]
    const after = await changeBox(c, b, { lifecycle: 'repacked', location_id: null }, ev('REPACKED', { meta: { kind, into, fruitRemoved, weightLostG } }), deltas)
    // The box has ended; its holds moved with the fruit (recall, investigation) or are dealt with by the repack.
    for (const k of kinds) {
      if (HOLD_KINDS.includes(k)) await releaseHold(c, after, k, `Repacked into ${into.join(', ')}`, ev('HOLD_RELEASED'), deltas)
    }
  }
  await c.query(
    `INSERT INTO wh_repacks (operation_id, warehouse_id, kind, source_box_ids, output_box_ids, fruit_removed, weight_lost_g, reason_code, reason, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [op.id, op.warehouse_id, kind, sources.map((b) => b.id), made.map((m) => m.id), fruitRemoved, weightLostG, op.context.reasonCode,
      body.note ? `${op.context.reason} (${String(body.note).slice(0, 200)})` : op.context.reason, who.actor.id, at],
  )
  const shortfall = await applyLineDeltas(c, deltas, who.actor, `Repack ${op.id} (${op.context.reason})`)
  return {
    kind, locationName: loc.name, sources: sources.map((b) => formatBoxCode(b.code)), outputs: made, fruitRemoved, weightLostG,
    needsQc, carriedHolds: holds.map((h) => h.kind),
    ...(shortfall.atRisk.length || shortfall.moved.length || shortfall.refilled.length ? { shortfall } : {}),
  }
}

// ---------------------------------------------------------------- condemned fruit in repacked boxes

/** Lifecycles of a box that has not left for good (as a recall reaches). */
const NOT_LEFT = ['generated', 'in_stock', 'picked', 'packed', 'returned', 'missing']

const mixedIn = (c, batchId) =>
  c.query(
    `SELECT DISTINCT b.id, b.batch_id FROM box_origins o JOIN boxes b ON b.id = o.box_id
      WHERE o.batch_id = $1 AND b.batch_id <> $1 AND b.lifecycle = ANY($2) ORDER BY b.id`,
    [batchId, NOT_LEFT],
  )

/**
 * The other batches whose stock lines carry boxes with this batch's fruit (a
 * repack mixed it in). Their orders are locked before the batch when it is
 * condemned, the usual order (INV-03).
 */
export async function batchesCarryingFruitOf(c, batchId) {
  return [...new Set((await mixedIn(c, batchId)).rows.map((r) => r.batch_id))]
}

/**
 * When a batch is condemned: every box still here that holds its fruit but
 * sits on another batch's line (a merge put it there) gets an investigation
 * hold, so it leaves stock until someone looks at it. The condemned batch's
 * own boxes already stop being sellable with the batch. Returns how many were held.
 */
export async function holdFruitOfBatch(c, batchId, actor, why = null) {
  const ids = (await mixedIn(c, batchId)).rows.map((r) => r.id)
  if (!ids.length) return 0
  const reason = `Holds fruit from condemned batch ${batchId}${why ? `: ${why}` : ''}`.slice(0, 300)
  const d = newDeltas()
  let held = 0
  for (const b of (await lockBoxes(c, ids)).values()) {
    if (await addHold(c, b, 'investigation_hold', reason, { type: 'HOLD_ADDED', actor, reasonCode: 'condemned', meta: { batchId } }, d)) held++
  }
  await applyLineDeltas(c, d, actor, `Batch ${batchId} condemned: repacked boxes with its fruit held`)
  return held
}

// ---------------------------------------------------------------- partial damage

/**
 * Fruit taken out of a box without repacking it: the measured weight (and
 * fruit count, when known) go down with an event. Below the product's weight
 * tolerance a QC-passed box goes to review (it stops being stock until QC
 * looks again). Only for boxes in stock and not on an order.
 */
export async function recordDamage(c, box, { fruitRemoved = 0, weightLostG = 0, reasonCode, reason }, who) {
  if (!fruitRemoved && !weightLostG) throw whError('VALIDATION_ERROR', 'Say how much fruit or weight was taken out', 400)
  const p = sourceProblem(box)
  if (p) throw whError(...p)
  if (!weightLostG && box.fruit_count == null) {
    throw whError('VALIDATION_ERROR', 'This box has no fruit count, so weigh it: say how much weight was taken out.', 400)
  }
  const product = (await c.query('SELECT weight_tolerance_pct FROM products WHERE sku = $1', [box.sku])).rows[0]
  const before = grams(box)
  const weightAfter = before - weightLostG
  if (weightAfter < 1) throw whError('VALIDATION_ERROR', `That is all of the box (${before} g). Write it off instead.`, 400)
  if (box.fruit_count != null && fruitRemoved >= box.fruit_count) throw whError('VALIDATION_ERROR', `The box had ${box.fruit_count} fruit. Write it off instead.`, 400)
  const tol = Number(product.weight_tolerance_pct)
  const below = ((box.nominal_weight_g - weightAfter) / box.nominal_weight_g) * 100 > tol
  const changes = {}
  if (weightLostG) changes.measured_weight_g = weightAfter
  if (fruitRemoved && box.fruit_count != null) changes.fruit_count = box.fruit_count - fruitRemoved
  if (below && box.quality === 'passed') changes.quality = 'needs_review'
  const d = newDeltas()
  const after = await changeBox(c, box, changes, {
    type: 'PARTIAL_DAMAGE', actor: who.actor, reasonCode, reason,
    meta: { fruitRemoved, weightLostG, weightBeforeG: before, weightAfterG: weightAfter, belowTolerance: below },
  }, d)
  const shortfall = await applyLineDeltas(c, d, who.actor, `Box ${formatBoxCode(box.code)}: fruit taken out (${reason})`)
  return { box: after, belowTolerance: below, needsReview: changes.quality === 'needs_review', shortfall }
}

// ---------------------------------------------------------------- read

export async function listRepacks(c, who) {
  const { rows } = await c.query(
    `SELECT o.id, o.status, o.context, o.started_at, o.finished_at, o.owner_id, a.email AS owner_email, r.kind, r.fruit_removed, r.weight_lost_g,
            cardinality(r.source_box_ids) AS sources, cardinality(r.output_box_ids) AS outputs,
            (SELECT count(*)::int FROM wh_staged st WHERE st.operation_id = o.id) AS staged
       FROM wh_operations o LEFT JOIN wh_repacks r ON r.operation_id = o.id LEFT JOIN admin_users a ON a.id = o.owner_id
      WHERE o.warehouse_id = $1 AND o.type = 'repack' ORDER BY o.started_at DESC LIMIT 100`,
    [who.warehouseId],
  )
  return rows.map((r) => ({
    id: r.id, status: r.status, kind: r.kind ?? null, locationName: r.context.locationName, reasonCode: r.context.reasonCode, reason: r.context.reason,
    owner: r.owner_email, mine: r.owner_id === who.actor.id, startedAt: r.started_at, finishedAt: r.finished_at,
    sources: r.sources ?? r.staged, outputs: r.outputs ?? 0, fruitRemoved: r.fruit_removed ?? null, weightLostG: r.weight_lost_g ?? null,
  }))
}

const brief = (b) => ({ id: b.id, code: formatBoxCode(b.code), lifecycle: b.lifecycle, quality: b.quality, bestBefore: b.best_before, weightG: b.measured_weight_g ?? b.nominal_weight_g, locationName: b.location_name ?? null, holds: b.holds ?? [] })

export async function getRepack(c, opId, who) {
  const op = (await c.query(`SELECT * FROM wh_operations WHERE id = $1 AND warehouse_id = $2 AND type = 'repack'`, [opId, who.warehouseId])).rows[0]
  if (!op) throw whError('NOT_FOUND', 'Repack not found', 404)
  const r = (await c.query('SELECT * FROM wh_repacks WHERE operation_id = $1', [op.id])).rows[0]
  const ids = r ? [...r.source_box_ids, ...r.output_box_ids] : (await c.query('SELECT box_id FROM wh_staged WHERE operation_id = $1', [op.id])).rows.map((x) => x.box_id)
  const boxes = (await c.query(
    `SELECT b.*, l.name AS location_name,
            (SELECT coalesce(array_agg(h.kind ORDER BY h.kind), '{}') FROM box_holds h WHERE h.box_id = b.id AND h.released_at IS NULL) AS holds
       FROM boxes b LEFT JOIN wh_locations l ON l.id = b.location_id WHERE b.id = ANY($1::uuid[]) ORDER BY b.code`,
    [ids],
  )).rows
  const pick = (list) => boxes.filter((b) => list.includes(b.id)).map(brief)
  const origins = r ? (await c.query(
    `SELECT DISTINCT l.id, l.code, l.batch_id FROM box_origins o JOIN box_lots l ON l.id = o.lot_id WHERE o.box_id = ANY($1::uuid[]) ORDER BY l.code`,
    [r.output_box_ids],
  )).rows : []
  return {
    id: op.id, status: op.status, mine: op.owner_id === who.actor.id, kind: r?.kind ?? null, locationName: op.context.locationName, reasonCode: op.context.reasonCode, reason: r?.reason ?? op.context.reason,
    startedAt: op.started_at, finishedAt: op.finished_at, fruitRemoved: r?.fruit_removed ?? null, weightLostG: r?.weight_lost_g ?? null,
    sources: r ? pick(r.source_box_ids) : boxes.map(brief), outputs: r ? pick(r.output_box_ids) : [],
    lots: origins.map((o) => ({ id: o.id, code: o.code, batchId: o.batch_id })),
  }
}

/** The new boxes of a finished repack, with their lot code and intake date, for the label PDF. */
export async function repackOutputsForLabels(c, opId, who) {
  const r = (await c.query('SELECT output_box_ids FROM wh_repacks WHERE operation_id = $1 AND warehouse_id = $2', [opId, who.warehouseId])).rows[0]
  if (!r) throw whError('NOT_FOUND', 'Repack not found or not finished', 404)
  return (await c.query(
    `SELECT b.*, l.received_on, l.code AS lot_code FROM boxes b JOIN box_lots l ON l.id = b.lot_id WHERE b.id = ANY($1::uuid[]) ORDER BY b.seq`,
    [r.output_box_ids],
  )).rows
}
