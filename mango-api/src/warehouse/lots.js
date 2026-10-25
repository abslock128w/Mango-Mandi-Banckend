// Box intake: one lot per product per delivery (docs/warehouse/INTAKE.md).
//
// Staff enter the delivery once; the server creates every box (lifecycle
// generated) with its code and label token, then staff print the labels,
// verify receipt (scanning, or a supervisor's count) and close the lot.
// A lot existing never makes stock sellable: boxes count as stock only once
// they are received, QC-passed and put in a pickable place.
import { addDays, now, todayIST } from '../clock.js'
import { getConfig } from '../config.js'
import { env } from '../env.js'
import { newId } from '../ids.js'
import { logger } from '../logger.js'
import { findProduct } from '../products.js'
import { ALPHABET, formatBoxCode, newBoxCode, newToken } from './codes.js'
import { applyLineDeltas, changeBox, lockBoxes, newDeltas, whError } from './core.js'

/** Up to this many boxes are generated in the request's own transaction; more go in resumable chunks. */
export const SINGLE_TX_LIMIT = 2000
export const INSERT_CHUNK = 500
/** Boxes generated per continue call. */
export const CONTINUE_CHUNK = 1000

const MAX_SKEW_MS = 10 * 60_000

/** A short human code for a lot: L + yymm + SKU + 2 random symbols, e.g. L2610-ALP3-7K. */
function lotCode(sku, today) {
  const rnd = ALPHABET[Math.floor(Math.random() * 32)] + ALPHABET[Math.floor(Math.random() * 32)]
  return `L${today.slice(2, 4)}${today.slice(5, 7)}-${sku.replace(/[^0-9A-Z]/gi, '').toUpperCase().slice(0, 6)}-${rnd}`
}

/**
 * Checks an intake request against the rules (brief 8.1) and works out the
 * dates. Throws 400 VALIDATION_ERROR with the first problem. Returns
 * { product, receivedOn, pluckedOn, bestBefore, nominalWeightG }.
 */
export function checkIntake(body, { at = now() } = {}) {
  const product = findProduct(body.sku)
  if (!product) throw whError('VALIDATION_ERROR', `Unknown product ${body.sku}`, 400)
  if (!product.active) throw whError('VALIDATION_ERROR', `${product.name} has been removed from sale`, 400)
  if (body.expectedCount < 1 || body.expectedCount > env.WAREHOUSE_MAX_LOT) {
    throw whError('VALIDATION_ERROR', `Box count must be between 1 and ${env.WAREHOUSE_MAX_LOT}`, 400)
  }
  const nominal = body.nominalWeightG ?? product.nominalWeightG
  if (!nominal || nominal < 1) throw whError('VALIDATION_ERROR', 'Give the nominal box weight in grams', 400)
  const latest = todayIST(new Date(at.getTime() + MAX_SKEW_MS))
  const receivedOn = body.receivedOn ?? todayIST(at)
  if (receivedOn > latest) throw whError('VALIDATION_ERROR', 'The received date cannot be in the future', 400)
  const pluckedOn = body.harvestedOn
  if (pluckedOn > receivedOn) throw whError('VALIDATION_ERROR', 'The harvest date must be on or before the received date', 400)
  const life = product.shelfLifeDays ?? getConfig().maxSellableAge
  const bestBefore = addDays(pluckedOn, life)
  if (bestBefore <= receivedOn) {
    throw whError('VALIDATION_ERROR', `Fruit harvested on ${pluckedOn} is past its ${life}-day sale limit on ${receivedOn}`, 400)
  }
  return { product, receivedOn, pluckedOn, bestBefore, nominalWeightG: nominal }
}

/**
 * Inserts boxes seq from..to for a lot (ON CONFLICT on (lot_id, seq) does
 * nothing, so a retried chunk never duplicates), with their labels, the QC
 * hold where the product needs QC, and a GENERATED event each. Returns how
 * many were new.
 */
export async function insertBoxes(c, lot, from, to, actor) {
  let made = 0
  for (let start = from; start <= to; start += INSERT_CHUNK) {
    const end = Math.min(to, start + INSERT_CHUNK - 1)
    const seqs = []
    for (let s = start; s <= end; s++) seqs.push(s)
    for (let attempt = 0; ; attempt++) {
      const codes = seqs.map(() => newBoxCode())
      const tokens = seqs.map(() => newToken())
      await c.query('SAVEPOINT gen')
      try {
        made += await insertChunk(c, lot, seqs, codes, tokens, actor)
        await c.query('RELEASE SAVEPOINT gen')
        break
      } catch (err) {
        await c.query('ROLLBACK TO SAVEPOINT gen')
        // A random code or token that already exists (vanishingly rare): new ones, try again.
        if (err.code !== '23505' || attempt >= 3 || !/code|token/.test(err.constraint ?? '')) throw err
        logger.warn({ lotId: lot.id, constraint: err.constraint }, 'box code collision, regenerating the chunk')
      }
    }
  }
  return made
}

async function insertChunk(c, lot, seqs, codes, tokens, actor) {
  const p = findProduct(lot.sku)
  const at = now()
  const quality = p?.requiresQc === false ? 'passed' : 'pending'
  const { rows } = await c.query(
    `INSERT INTO boxes (code, label_token, lot_id, line_id, batch_id, sku, sku_name, seq, warehouse_id, lifecycle, quality,
                        nominal_weight_g, best_before, created_at, updated_at)
     SELECT x.code, x.token, $1, $2, $3, $4, $5, x.seq, $6, 'generated', $7, $8, $9, $10, $10
       FROM unnest($11::text[], $12::text[], $13::int[]) AS x (code, token, seq)
     ON CONFLICT (lot_id, seq) DO NOTHING
     RETURNING id, label_token`,
    [lot.id, lot.line_id, lot.batch_id, lot.sku, p?.name ?? lot.sku, lot.warehouse_id, quality, lot.nominal_weight_g, lot.best_before, at, codes, tokens, seqs],
  )
  if (!rows.length) return 0
  const ids = rows.map((r) => r.id)
  await c.query(
    `INSERT INTO box_labels (token, box_id, issued_at, issued_by) SELECT t, i, $3, $4 FROM unnest($1::text[], $2::uuid[]) AS x (t, i)`,
    [rows.map((r) => r.label_token), ids, at, actor.id],
  )
  if (quality === 'pending') {
    await c.query(
      `INSERT INTO box_holds (id, box_id, kind, reason, added_by, added_at)
       SELECT 'bho_' || replace(gen_random_uuid()::text, '-', ''), i, 'qc_hold', 'Waiting for QC', $2, $3 FROM unnest($1::uuid[]) AS i`,
      [ids, actor.id, at],
    )
  }
  await c.query(
    `INSERT INTO box_events (id, box_id, type, actor_id, created_at, to_lifecycle, to_quality, hold_added, meta)
     SELECT 'bev_' || replace(gen_random_uuid()::text, '-', ''), i, 'GENERATED', $2, $3, 'generated', $4, $5, $6 FROM unnest($1::uuid[]) AS i`,
    [ids, actor.id, at, quality, quality === 'pending' ? 'qc_hold' : null, { lot: lot.code }],
  )
  return rows.length
}

/**
 * Creates the lot (and the batch and line when this is a new delivery) and
 * generates its boxes: all of them when there are SINGLE_TX_LIMIT or fewer,
 * else the first chunk, with the lot left 'generating' for continue calls.
 */
export async function createLot(c, body, checked, actor, warehouseId) {
  const at = now()
  const { product, receivedOn, pluckedOn, bestBefore, nominalWeightG } = checked
  let batchId = body.batchId ?? null
  let lineId = null
  if (batchId) {
    const { rows } = await c.query('SELECT * FROM batches WHERE id = $1 FOR UPDATE', [batchId])
    const b = rows[0]
    if (!b) throw whError('NOT_FOUND', 'Batch not found', 404)
    if (['EXHAUSTED', 'CONDEMNED'].includes(b.status)) throw whError('INVALID_TRANSITION', `Batch ${b.id} is ${b.status.toLowerCase()}`)
    if (b.variety !== product.variety) throw whError('VALIDATION_ERROR', `${product.name} is not a ${b.variety} product`, 400)
    if (b.plucked_on !== pluckedOn) throw whError('VALIDATION_ERROR', `Batch ${b.id} was harvested on ${b.plucked_on}`, 400)
    const line = (await c.query('SELECT * FROM batch_lines WHERE batch_id = $1 AND sku = $2 FOR UPDATE', [batchId, product.sku])).rows[0]
    if (line) {
      if ((await c.query('SELECT 1 FROM box_lots WHERE line_id = $1', [line.id])).rowCount) {
        throw whError('VALIDATION_ERROR', `Batch ${batchId} already has a box intake for ${product.name}`, 400)
      }
      // Existing counted stock gets labels through a legacy lot (ROLLOUT.md), never a new intake.
      if (!body.legacy && line.on_hand > 0) throw whError('VALIDATION_ERROR', 'This batch line already has counted stock: label it with a legacy intake', 400)
      lineId = line.id
    }
  } else {
    if (body.legacy) throw whError('VALIDATION_ERROR', 'A legacy intake labels stock already on a batch: choose the batch', 400)
    batchId = newId('bat')
    await c.query(
      `INSERT INTO batches (id, variety, plucked_on, farm, status, eta_date, arrived_at, created_at) VALUES ($1, $2, $3, $4, 'ARRIVED', $5, $6, $6)`,
      [batchId, product.variety, pluckedOn, body.supplier || null, receivedOn, at],
    )
    await c.query(`INSERT INTO batch_ledger (id, batch_id, event_type, sku, delta, actor_type, actor_id, reason, created_at)
                   VALUES ($1, $2, 'STATUS', NULL, 0, $3, $4, 'Received in the warehouse (box intake)', $5)`, [newId('led'), batchId, actor.type, actor.id, at])
  }
  if (!lineId) {
    lineId = newId('bl')
    await c.query('INSERT INTO batch_lines (id, batch_id, sku, on_hand) VALUES ($1, $2, $3, 0)', [lineId, batchId, product.sku])
  }
  if (!body.legacy && !product.boxTrackingEnabled) {
    throw whError('VALIDATION_ERROR', `Box tracking is off for ${product.name}. Turn it on (Warehouse → Products) or record this delivery on the Batches page.`, 400)
  }
  const lot = {
    id: newId('lot'), line_id: lineId, batch_id: batchId, sku: product.sku, warehouse_id: warehouseId, code: lotCode(product.sku, receivedOn),
    nominal_weight_g: nominalWeightG, best_before: bestBefore,
  }
  const target = body.expectedCount
  for (let attempt = 0; ; attempt++) {
    try {
      await c.query('SAVEPOINT lotcode')
      await c.query(
        `INSERT INTO box_lots (id, line_id, batch_id, sku, warehouse_id, code, supplier, expected_count, target_count, nominal_weight_g,
                               harvested_on, received_on, best_before, qc_notes, status, is_legacy, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11, $12, $13, 'generating', $14, $15, $16)`,
        [lot.id, lineId, batchId, product.sku, warehouseId, lot.code, body.supplier || null, target, nominalWeightG, pluckedOn, receivedOn, bestBefore,
          body.qcNotes || null, Boolean(body.legacy), actor.id, at],
      )
      await c.query('RELEASE SAVEPOINT lotcode')
      break
    } catch (err) {
      await c.query('ROLLBACK TO SAVEPOINT lotcode')
      if (err.code !== '23505' || err.constraint !== 'box_lots_code_key' || attempt >= 5) throw err
      lot.code = lotCode(product.sku, receivedOn)
    }
  }
  await generateMore(c, lot.id, actor, target <= SINGLE_TX_LIMIT ? target : CONTINUE_CHUNK)
  return lot.id
}

/**
 * Generates up to `n` more boxes for a lot that is still generating (its own
 * transaction: a killed request loses at most this chunk, and the next call
 * picks up where generated_count says). Returns the lot row.
 */
export async function generateMore(c, lotId, actor, n = CONTINUE_CHUNK) {
  const { rows } = await c.query('SELECT * FROM box_lots WHERE id = $1 FOR UPDATE', [lotId])
  const lot = rows[0]
  if (!lot) throw whError('NOT_FOUND', 'Lot not found', 404)
  if (lot.status !== 'generating' && lot.generated_count >= lot.target_count) return lot
  // The real count, in case an earlier chunk committed boxes but died before updating the lot.
  const have = (await c.query('SELECT coalesce(max(seq), 0)::int AS n FROM boxes WHERE lot_id = $1', [lotId])).rows[0].n
  const to = Math.min(lot.target_count, have + n)
  if (to > have) await insertBoxes(c, lot, have + 1, to, actor)
  const generated = (await c.query('SELECT count(*)::int AS n FROM boxes WHERE lot_id = $1', [lotId])).rows[0].n
  const status = lot.status === 'generating' && generated >= lot.target_count ? 'receiving' : lot.status
  const upd = await c.query('UPDATE box_lots SET generated_count = $2, status = $3, updated_at = $4 WHERE id = $1 RETURNING *', [lotId, generated, status, now()])
  return upd.rows[0]
}

/** Lot counts recomputed from its boxes (the truth), saved on the lot. */
export async function refreshLotCounts(c, lotId) {
  const { rows } = await c.query(
    `UPDATE box_lots l SET
        generated_count = x.generated, verified_count = x.verified, voided_count = x.voided, updated_at = $2
       FROM (SELECT count(*)::int AS generated,
                    count(*) FILTER (WHERE verification IS NOT NULL)::int AS verified,
                    count(*) FILTER (WHERE lifecycle = 'voided')::int AS voided
               FROM boxes WHERE lot_id = $1) x
      WHERE l.id = $1 RETURNING l.*`,
    [lotId, now()],
  )
  return rows[0]
}

export async function lockLot(c, lotId, warehouseId) {
  const { rows } = await c.query('SELECT * FROM box_lots WHERE id = $1 AND warehouse_id = $2 FOR UPDATE', [lotId, warehouseId])
  if (!rows.length) throw whError('NOT_FOUND', 'Lot not found', 404)
  return rows[0]
}

/**
 * A supervisor confirms `count` boxes arrived without scanning each: the
 * lowest-numbered unverified boxes become in_stock (count_confirmed) at
 * `locationId`. Reports always tell these from scanned boxes.
 */
export async function confirmCount(c, lot, { count, locationId, reason }, actor) {
  if (!['receiving', 'received'].includes(lot.status)) throw whError('INVALID_TRANSITION', `This lot is ${lot.status}`)
  const loc = await receivingPlace(c, lot.warehouse_id, locationId)
  const { rows } = await c.query(`SELECT id FROM boxes WHERE lot_id = $1 AND lifecycle = 'generated' ORDER BY seq LIMIT $2`, [lot.id, count])
  if (rows.length < count) throw whError('VALIDATION_ERROR', `Only ${rows.length} boxes on this lot are still waiting to be received`, 400)
  const deltas = newDeltas()
  const boxes = await lockBoxes(c, rows.map((r) => r.id))
  for (const box of boxes.values()) {
    if (box.lifecycle !== 'generated') continue
    await changeBox(c, box, { lifecycle: 'in_stock', location_id: loc.id, verification: 'count_confirmed' }, { type: 'RECEIVED', actor, reasonCode: 'count_confirmed', reason }, deltas)
  }
  await applyLineDeltas(c, deltas, actor, `Lot ${lot.code}: count confirmed`, { reasonCode: 'BOX_RECEIVED' })
  return finishReceiving(c, lot.id)
}

/** The lot's status once every box is received or voided: 'received'. */
export async function finishReceiving(c, lotId) {
  const lot = await refreshLotCounts(c, lotId)
  if (lot.status === 'receiving' && lot.verified_count + lot.voided_count >= lot.target_count) {
    return (await c.query(`UPDATE box_lots SET status = 'received', updated_at = $2 WHERE id = $1 RETURNING *`, [lotId, now()])).rows[0]
  }
  return lot
}

export async function receivingPlace(c, warehouseId, locationId) {
  const { rows } = await c.query(
    locationId
      ? 'SELECT * FROM wh_locations WHERE id = $1 AND warehouse_id = $2'
      : `SELECT * FROM wh_locations WHERE warehouse_id = $2 AND type = 'receiving' AND active AND $1::text IS NULL ORDER BY created_at, id LIMIT 1`,
    [locationId ?? null, warehouseId],
  )
  const loc = rows[0]
  if (!loc) throw whError(locationId ? 'NOT_FOUND' : 'LOCATION_INACTIVE', locationId ? 'Location not found' : 'No active receiving location. Add one on the Locations page.', locationId ? 404 : 409)
  if (!loc.active) throw whError('LOCATION_INACTIVE', `${loc.name} is switched off`)
  return loc
}

/**
 * Voids unverified boxes (fewer arrived than labelled): the highest-numbered
 * generated boxes, or the ones named. Their labels are revoked; nothing is deleted.
 */
export async function voidBoxes(c, lot, { count = null, boxIds = null, reason }, actor) {
  if (['closed', 'voided'].includes(lot.status)) throw whError('INVALID_TRANSITION', `This lot is ${lot.status}`)
  const { rows } = boxIds
    ? await c.query(`SELECT id FROM boxes WHERE lot_id = $1 AND id = ANY($2::uuid[])`, [lot.id, boxIds])
    : await c.query(`SELECT id FROM boxes WHERE lot_id = $1 AND lifecycle = 'generated' ORDER BY seq DESC LIMIT $2`, [lot.id, count])
  if (boxIds && rows.length !== boxIds.length) throw whError('NOT_FOUND', 'A box named is not on this lot', 404)
  const boxes = await lockBoxes(c, rows.map((r) => r.id))
  const deltas = newDeltas()
  for (const box of boxes.values()) {
    if (box.lifecycle !== 'generated') throw whError('INVALID_TRANSITION', `Box ${formatBoxCode(box.code)} was received; write it off instead of voiding it`)
    await changeBox(c, box, { lifecycle: 'voided' }, { type: 'VOIDED', actor, reasonCode: 'not_arrived', reason }, deltas)
    await c.query('UPDATE box_labels SET revoked_at = $2, revoked_by = $3, revoke_reason = $4 WHERE box_id = $1 AND revoked_at IS NULL', [box.id, now(), actor.id, `Voided: ${reason}`])
  }
  await applyLineDeltas(c, deltas, actor, `Lot ${lot.code}: boxes voided`)
  return finishReceiving(c, lot.id)
}

/** More boxes arrived than expected: extend the lot (the sequence continues). */
export async function addBoxes(c, lot, { count, reason }, actor) {
  if (['closed', 'voided'].includes(lot.status)) throw whError('INVALID_TRANSITION', `This lot is ${lot.status}; it takes no new boxes`)
  if (lot.target_count + count > env.WAREHOUSE_MAX_LOT) throw whError('VALIDATION_ERROR', `A lot holds at most ${env.WAREHOUSE_MAX_LOT} boxes`, 400)
  const from = (await c.query('SELECT coalesce(max(seq), 0)::int AS n FROM boxes WHERE lot_id = $1', [lot.id])).rows[0].n + 1
  await c.query(`UPDATE box_lots SET target_count = target_count + $2, status = CASE WHEN status = 'received' THEN 'receiving' ELSE status END, updated_at = $3 WHERE id = $1`, [
    lot.id, count, now(),
  ])
  const fresh = (await c.query('SELECT * FROM box_lots WHERE id = $1', [lot.id])).rows[0]
  await insertBoxes(c, fresh, from, from + count - 1, actor)
  await c.query(
    `INSERT INTO box_events (id, box_id, type, actor_id, created_at, reason_code, reason)
     SELECT 'bev_' || replace(gen_random_uuid()::text, '-', ''), id, 'ADDED_TO_LOT', $2, $3, 'extra_boxes', $4 FROM boxes WHERE lot_id = $1 AND seq >= $5`,
    [lot.id, actor.id, now(), reason, from],
  )
  return refreshLotCounts(c, lot.id)
}

/** Closes a lot: every box received or voided. Closed lots take no new boxes. */
export async function closeLot(c, lot) {
  if (lot.status === 'closed') return lot
  if (!['receiving', 'received'].includes(lot.status)) throw whError('INVALID_TRANSITION', `This lot is ${lot.status}`)
  const waiting = (await c.query(`SELECT count(*)::int AS n FROM boxes WHERE lot_id = $1 AND lifecycle = 'generated'`, [lot.id])).rows[0].n
  if (waiting) throw whError('INCOMPLETE_SET', `${waiting} ${waiting === 1 ? 'box is' : 'boxes are'} not received yet. Receive or void them first.`)
  return (await c.query(`UPDATE box_lots SET status = 'closed', closed_at = $2, updated_at = $2 WHERE id = $1 RETURNING *`, [lot.id, now()])).rows[0]
}

/**
 * Corrects a lot's supplier (any time before a box leaves stock) or product
 * (only while no box is received: labels show the product, so all must be reprinted).
 */
export async function correctLot(c, lot, { supplier, sku, reason }, actor) {
  const { rows } = await c.query(
    `SELECT count(*) FILTER (WHERE lifecycle NOT IN ('generated', 'in_stock', 'voided'))::int AS gone,
            count(*) FILTER (WHERE lifecycle = 'in_stock')::int AS in_stock FROM boxes WHERE lot_id = $1`,
    [lot.id],
  )
  if (rows[0].gone) throw whError('INVALID_TRANSITION', 'Boxes from this lot have been picked or written off. Use a repack or an adjustment instead.')
  const changes = []
  if (supplier !== undefined && supplier !== lot.supplier) {
    await c.query('UPDATE box_lots SET supplier = $2, updated_at = $3 WHERE id = $1', [lot.id, supplier || null, now()])
    await c.query('UPDATE batches SET farm = $2 WHERE id = $1', [lot.batch_id, supplier || null])
    changes.push(`supplier ${lot.supplier ?? '-'} → ${supplier || '-'}`)
  }
  let reprint = false
  if (sku && sku !== lot.sku) {
    if (rows[0].in_stock) throw whError('INVALID_TRANSITION', 'Boxes on this lot are already received; the product can only be corrected before receiving')
    const p = findProduct(sku)
    if (!p?.active) throw whError('VALIDATION_ERROR', `Unknown product ${sku}`, 400)
    const old = findProduct(lot.sku)
    if (p.variety !== old?.variety) throw whError('VALIDATION_ERROR', `${p.name} is not the same variety`, 400)
    const line = (await c.query('SELECT * FROM batch_lines WHERE id = $1 FOR UPDATE', [lot.line_id])).rows[0]
    if (line.on_hand || line.held || line.committed) throw whError('INVALID_TRANSITION', 'This line already has stock; the product cannot change')
    if ((await c.query('SELECT 1 FROM batch_lines WHERE batch_id = $1 AND sku = $2', [lot.batch_id, sku])).rowCount) {
      throw whError('VALIDATION_ERROR', `Batch ${lot.batch_id} already has a ${p.name} line`, 400)
    }
    await c.query('UPDATE batch_lines SET sku = $2 WHERE id = $1', [lot.line_id, sku])
    await c.query('UPDATE box_lots SET sku = $2, updated_at = $3 WHERE id = $1', [lot.id, sku, now()])
    const { rows: boxes } = await c.query('SELECT id FROM boxes WHERE lot_id = $1 ORDER BY id FOR UPDATE', [lot.id])
    await c.query('UPDATE boxes SET sku = $2, sku_name = $3, version = version + 1, updated_at = $4 WHERE lot_id = $1', [lot.id, sku, p.name, now()])
    await c.query(
      `INSERT INTO box_events (id, box_id, type, actor_id, created_at, reason_code, reason, meta)
       SELECT 'bev_' || replace(gen_random_uuid()::text, '-', ''), i, 'CORRECTED', $2, $3, 'wrong_product', $4, $5 FROM unnest($1::uuid[]) AS i`,
      [boxes.map((b) => b.id), actor.id, now(), reason, { from: lot.sku, to: sku }],
    )
    changes.push(`product ${lot.sku} → ${sku}`)
    reprint = true
  }
  return { changes, reprintAll: reprint }
}

/** Voids a whole lot: allowed only while no box has gone beyond in_stock. */
export async function voidLot(c, lot, { reason }, actor) {
  if (lot.status === 'voided') return lot
  const { rows } = await c.query(`SELECT id FROM boxes WHERE lot_id = $1 AND lifecycle NOT IN ('generated', 'in_stock', 'voided')`, [lot.id])
  if (rows.length) throw whError('INVALID_TRANSITION', 'Boxes from this lot have been picked or written off; the lot cannot be voided')
  const { rows: ids } = await c.query(`SELECT id FROM boxes WHERE lot_id = $1 AND lifecycle IN ('generated', 'in_stock')`, [lot.id])
  const deltas = newDeltas()
  for (const box of (await lockBoxes(c, ids.map((r) => r.id))).values()) {
    await changeBox(c, box, { lifecycle: 'voided', location_id: null }, { type: 'VOIDED', actor, reasonCode: 'lot_voided', reason }, deltas)
  }
  await c.query('UPDATE box_labels SET revoked_at = $2, revoked_by = $3, revoke_reason = $4 WHERE box_id IN (SELECT id FROM boxes WHERE lot_id = $1) AND revoked_at IS NULL', [
    lot.id, now(), actor.id, `Lot voided: ${reason}`,
  ])
  await applyLineDeltas(c, deltas, actor, `Lot ${lot.code} voided: ${reason}`)
  await refreshLotCounts(c, lot.id)
  return (await c.query(`UPDATE box_lots SET status = 'voided', closed_at = $2, updated_at = $2 WHERE id = $1 RETURNING *`, [lot.id, now()])).rows[0]
}

export const lotView = (l, extra = {}) => ({
  id: l.id, code: l.code, sku: l.sku, productName: findProduct(l.sku)?.name ?? l.sku, batchId: l.batch_id, lineId: l.line_id, supplier: l.supplier,
  expectedCount: l.expected_count, targetCount: l.target_count, generatedCount: l.generated_count, verifiedCount: l.verified_count,
  voidedCount: l.voided_count, nominalWeightG: l.nominal_weight_g, harvestedOn: l.harvested_on, receivedOn: l.received_on, bestBefore: l.best_before,
  qcNotes: l.qc_notes, status: l.status, isLegacy: l.is_legacy, createdBy: l.created_by, createdAt: l.created_at, closedAt: l.closed_at, ...extra,
})
