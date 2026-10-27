// How box picks meet the existing reservation model (docs/warehouse/INVENTORY.md).
//
// A pick turns one committed unit of the order's order_stock into a packed
// unit (the existing PACK step: committed −1, on_hand −1), so free stock does
// not change and the unit is pinned to the order (rebalancing never swaps
// packed stock). An unpick releases that packed unit without touching on_hand:
// the box is back in the warehouse but at pick staging, which is not a
// pickable place, so it is not shelf stock until someone puts it away (and
// the put-away adds it back through the usual box delta). The order is then
// rebalanced, which reserves the unit again (FEFO).
import { now } from '../clock.js'
import { newId } from '../ids.js'
import { ledger, restock } from '../inventory.js'
import { changeBox, lockBoxes, newDeltas, trackedLine, whError } from './core.js'

/** Takes one committed unit of `row` and makes it packed for a picked box. Returns the packed row id. */
export async function pickUnit(c, row, actor, why) {
  const upd = await c.query(
    `UPDATE batch_lines SET committed = committed - 1, on_hand = on_hand - 1 WHERE id = $1 AND committed >= 1 AND on_hand >= 1 RETURNING id`,
    [row.line_id],
  )
  if (!upd.rowCount) throw whError('CONFLICT_RETRY_EXHAUSTED', 'The stock counters changed under this pick. Scan again.')
  const id = await splitOne(c, row, 'packed')
  await ledger(c, { batchId: row.batch_id, eventType: 'PACK', sku: row.sku, delta: -1, actorType: actor.type, actorId: actor.id, reason: why, reasonCode: 'BOX_PICK' })
  return id
}

/** Releases one packed unit of `row` (a box unpicked); on_hand is unchanged (see above). */
export async function unpickUnit(c, row, actor, why) {
  await splitOne(c, row, 'released')
  await ledger(c, { batchId: row.batch_id, eventType: 'RELEASE', sku: row.sku, delta: 0, actorType: actor.type, actorId: actor.id, reason: why, reasonCode: 'BOX_UNPICK' })
}

/** Moves one unit of an order_stock row to `state`: the row itself when it holds one, else a new one-unit row. */
async function splitOne(c, row, state) {
  if (row.quantity === 1) {
    await c.query('UPDATE order_stock SET state = $2 WHERE id = $1', [row.id, state])
    return row.id
  }
  await c.query('UPDATE order_stock SET quantity = quantity - 1 WHERE id = $1', [row.id])
  const id = newId('ost')
  await c.query(
    `INSERT INTO order_stock (id, order_id, batch_id, line_id, sku, stage, quantity, state) VALUES ($1, $2, $3, $4, $5, $6, 1, $7)`,
    [id, row.order_id, row.batch_id, row.line_id, row.sku, row.stage, state],
  )
  return id
}

/** The pick-staging location boxes go back to when they leave an order. */
export async function stagingPlace(c, warehouseId) {
  const { rows } = await c.query(
    `SELECT * FROM wh_locations WHERE warehouse_id = $1 AND type = 'pick_staging' AND active ORDER BY created_at, id LIMIT 1`,
    [warehouseId],
  )
  return rows[0] ?? null
}

/**
 * Unbinds boxes picked or packed for an order (cancelled, moved to another
 * date, or a box taken out): each goes back to in_stock at pick staging, and
 * one packed unit per box is released. Boxes already dispatched are left
 * alone (they come back through a return scan). Caller holds the order lock.
 * Returns the number of boxes per line.
 */
export async function unbindOrderBoxes(c, order, actor, why, { lineId = null } = {}) {
  const { rows } = await c.query(
    `SELECT id FROM boxes WHERE order_id = $1 AND lifecycle IN ('picked', 'packed') AND ($2::text IS NULL OR line_id = $2)`,
    [order.id, lineId],
  )
  const perLine = new Map()
  if (!rows.length) return perLine
  const boxes = await lockBoxes(c, rows.map((r) => r.id))
  const deltas = newDeltas()
  for (const box of boxes.values()) {
    if (box.order_id !== order.id || !['picked', 'packed'].includes(box.lifecycle)) continue
    const staging = await stagingPlace(c, box.warehouse_id)
    const packed = (await c.query(`SELECT * FROM order_stock WHERE order_id = $1 AND line_id = $2 AND state = 'packed' ORDER BY id LIMIT 1`, [order.id, box.line_id])).rows[0]
    if (packed) await unpickUnit(c, packed, actor, `${order.number}: ${why}`)
    // A pack or dispatch scan waiting to be finalized no longer counts this box.
    await c.query('DELETE FROM wh_staged WHERE box_id = $1', [box.id])
    await changeBox(
      c, box, { lifecycle: 'in_stock', order_id: null, order_item_id: null, location_id: staging?.id ?? box.location_id },
      { type: 'UNPICKED', actor, orderId: order.id, reasonCode: 'order_changed', reason: why }, deltas, { skipStock: true },
    )
    perLine.set(box.line_id, (perLine.get(box.line_id) ?? 0) + 1)
  }
  return perLine
}

/**
 * The existing restock step (packed stock back on the shelf), box aware. For
 * a tracked line every packed unit belongs to a picked or packed box (stock
 * on a tracked line is only packed by a pick scan, and tracking can only be
 * turned on when the product has no packed stock: warehouse/products.js), so
 * the boxes are unbound instead: they are physically at packing, not on the
 * shelf, and count as stock again once put away. Safe to call once per
 * packed row: the first call unbinds every box on the line.
 */
export async function restockPacked(c, order, row, actor, why, reasonCode = null) {
  if (!(await trackedLine(c, row.line_id))) {
    await restock(c, row, actor, why, reasonCode)
    return
  }
  await unbindOrderBoxes(c, order, actor, why, { lineId: row.line_id })
}

/** The orders.js step that packs committed stock, refused for tracked lines (their boxes are picked by scan). */
export async function assertNoTrackedCommitted(c, orderId) {
  const { rows } = await c.query(`SELECT DISTINCT line_id, sku FROM order_stock WHERE order_id = $1 AND state = 'committed'`, [orderId])
  for (const r of rows) {
    if (await trackedLine(c, r.line_id)) {
      throw whError('PICK_BY_SCAN', `${r.sku} boxes are labelled: pick them with the scanner (Warehouse → Scan → Pick).`)
    }
  }
}

/** Refuses a status move the warehouse makes by scan: PACKED needs a pack finalize, SHIPPED a dispatch finalize. */
export async function assertBoxesReadyFor(c, orderId, to) {
  if (!['PACKED', 'SHIPPED'].includes(to)) return
  const want = to === 'PACKED' ? 'packed' : 'dispatched'
  const { rows } = await c.query(
    `SELECT b.lifecycle, count(*)::int AS n FROM boxes b WHERE b.order_id = $1 AND b.lifecycle <> $2 GROUP BY b.lifecycle`,
    [orderId, want],
  )
  const waiting = rows.filter((r) => (to === 'PACKED' ? r.lifecycle === 'picked' : ['picked', 'packed'].includes(r.lifecycle)))
  if (waiting.length) {
    const n = waiting.reduce((s, r) => s + r.n, 0)
    throw whError(to === 'PACKED' ? 'PACK_BY_SCAN' : 'DISPATCH_BY_SCAN', `${n} labelled ${n === 1 ? 'box is' : 'boxes are'} not ${want} yet: finish ${to === 'PACKED' ? 'packing' : 'dispatch'} in Warehouse → Scan.`)
  }
}

export const nowIso = () => now().toISOString()
