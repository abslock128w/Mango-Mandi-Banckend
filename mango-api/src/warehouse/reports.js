// What the warehouse knows, read back: overview, pick lists, exceptions,
// reconciliation, trace, recalls, product settings and CSV exports
// (docs/warehouse/REPORTS.md). Everything here is computed from the boxes,
// their events and the stock counters at request time.
import { addDays, now, todayIST } from '../clock.js'
import { newId } from '../ids.js'
import { auditLedger } from '../inventory.js'
import { loadProducts } from '../products.js'
import { formatBoxCode } from './codes.js'
import { addHold, applyLineDeltas, lockBoxes, newDeltas, releaseHold, whError } from './core.js'
import { boxView } from './boxes.js'
import { can } from './permissions.js'

/**
 * Every box of the given lots and every box made from them by repacks, at
 * most 10 repack generations down, each once (its shallowest depth). $1 is the
 * lot id array. A box whose fruit came from a lot (box_origins) counts even
 * when it sits on another lot's line.
 */
const LINEAGE_DOWN = `WITH RECURSIVE down (id, depth) AS (
    SELECT id, 0 FROM boxes WHERE lot_id = ANY($1)
    UNION SELECT box_id, 0 FROM box_origins WHERE lot_id = ANY($1)
    UNION SELECT b.id, d.depth + 1 FROM boxes b JOIN down d ON b.parent_box_ids @> ARRAY[d.id] WHERE d.depth < 10),
  lineage AS (SELECT id, min(depth) AS depth FROM down GROUP BY id)`

/** Boxes still physically here (not gone for good, not out on a delivery). */
const ON_SITE = `b.lifecycle IN ('generated', 'in_stock', 'picked', 'packed', 'returned')`

export async function overview(c, warehouseId) {
  const today = todayIST()
  const [{ rows: states }, { rows: lots }, { rows: ops }, queue, { rows: expiring }] = await Promise.all([
    c.query(
      `SELECT b.lifecycle, b.quality, count(*)::int AS n, count(*) FILTER (WHERE box_shelf_sellable(b.id))::int AS sellable
         FROM boxes b WHERE b.warehouse_id = $1 AND ${ON_SITE} GROUP BY b.lifecycle, b.quality`,
      [warehouseId],
    ),
    c.query(`SELECT status, count(*)::int AS n FROM box_lots WHERE warehouse_id = $1 AND status IN ('generating', 'receiving', 'received') GROUP BY status`, [warehouseId]),
    c.query(`SELECT type, count(*)::int AS n FROM wh_operations WHERE warehouse_id = $1 AND status = 'open' GROUP BY type`, [warehouseId]),
    pickQueueRows(c, { limit: 500 }),
    c.query(`SELECT count(*)::int AS n FROM boxes WHERE warehouse_id = $1 AND lifecycle = 'in_stock' AND best_before BETWEEN $2 AND $3`, [warehouseId, today, addDays(today, 2)]),
  ])
  const sum = (f) => states.filter(f).reduce((n, r) => n + r.n, 0)
  return {
    today,
    boxes: {
      awaitingReceipt: sum((r) => r.lifecycle === 'generated'),
      inStock: sum((r) => r.lifecycle === 'in_stock'),
      sellable: states.reduce((n, r) => n + r.sellable, 0),
      awaitingQc: sum((r) => r.lifecycle === 'in_stock' && r.quality === 'pending'),
      failedOrReview: sum((r) => ['failed', 'needs_review'].includes(r.quality) && r.lifecycle !== 'generated'),
      picked: sum((r) => r.lifecycle === 'picked'),
      packed: sum((r) => r.lifecycle === 'packed'),
      returned: sum((r) => r.lifecycle === 'returned'),
      expiringIn2Days: expiring[0].n,
    },
    lots: Object.fromEntries(lots.map((r) => [r.status, r.n])),
    openSessions: Object.fromEntries(ops.map((r) => [r.type, r.n])),
    ordersToPick: queue.length,
  }
}

// ---------------------------------------------------------------- picking

async function pickQueueRows(c, { date = null, limit = 200 } = {}) {
  const { rows } = await c.query(
    `SELECT o.id, o.number, o.status, o.delivery_date, o.slot_id, o.at_risk,
            sum(s.quantity) FILTER (WHERE s.state = 'committed')::int AS to_pick,
            (SELECT count(*)::int FROM boxes b WHERE b.order_id = o.id AND b.lifecycle = 'picked') AS picked
       FROM orders o JOIN order_stock s ON s.order_id = o.id JOIN products p ON p.sku = s.sku
      WHERE o.status IN ('CONFIRMED', 'PROCESSING') AND (o.payment_status = 'SUCCEEDED' OR o.replacement_for IS NOT NULL)
        AND s.state = 'committed' AND p.box_tracking_enabled AND ($1::date IS NULL OR o.delivery_date = $1)
      GROUP BY o.id ORDER BY o.delivery_date, o.number LIMIT $2`,
    [date, limit],
  )
  return rows
}

export async function pickQueue(c, { date = null } = {}) {
  return (await pickQueueRows(c, { date })).map((r) => ({
    orderId: r.id, number: r.number, status: r.status, deliveryDate: r.delivery_date, atRisk: r.at_risk, toPick: r.to_pick, picked: r.picked,
  }))
}

/**
 * What to pick for an order: per item, how many are left and the boxes to
 * take, oldest reserved batch first (FEFO), with where they are.
 */
export async function pickList(c, orderId, warehouseId) {
  const o = (await c.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0]
  if (!o) throw whError('NOT_FOUND', 'Order not found', 404)
  const items = (await c.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY sku, stage', [o.id])).rows
  const stock = (await c.query(
    `SELECT s.*, bt.plucked_on, l.code AS lot_code FROM order_stock s JOIN batches bt ON bt.id = s.batch_id LEFT JOIN box_lots l ON l.line_id = s.line_id
      WHERE s.order_id = $1 AND s.state IN ('committed', 'packed') ORDER BY bt.plucked_on, s.id`,
    [o.id],
  )).rows
  const picked = (await c.query(`SELECT b.*, NULL AS holds FROM boxes b WHERE b.order_id = $1 ORDER BY b.updated_at`, [o.id])).rows
  const today = todayIST()
  const out = []
  for (const i of items) {
    const rows = stock.filter((s) => s.sku === i.sku && s.stage === i.stage)
    const toPick = rows.filter((r) => r.state === 'committed').reduce((n, r) => n + r.quantity, 0)
    const suggestions = []
    for (const r of rows.filter((x) => x.state === 'committed')) {
      const { rows: boxes } = await c.query(
        `SELECT b.id, b.code, b.best_before, loc.name AS location_name, loc.zone FROM boxes b JOIN wh_locations loc ON loc.id = b.location_id
          WHERE b.line_id = $1 AND b.warehouse_id = $2 AND box_pickable(b.id, $3) ORDER BY b.best_before, loc.zone, loc.name, b.seq LIMIT $4`,
        [r.line_id, warehouseId, today, r.quantity],
      )
      suggestions.push({ lot: r.lot_code, quantity: r.quantity, boxes: boxes.map((b) => ({ id: b.id, code: formatBoxCode(b.code), location: b.zone ? `${b.zone} / ${b.location_name}` : b.location_name, bestBefore: b.best_before })) })
    }
    out.push({
      itemId: i.id, sku: i.sku, stage: i.stage, quantity: i.quantity, toPick,
      picked: picked.filter((b) => b.order_item_id === i.id).map((b) => ({ id: b.id, code: formatBoxCode(b.code), lifecycle: b.lifecycle })),
      suggestions,
    })
  }
  return { orderId: o.id, number: o.number, status: o.status, deliveryDate: o.delivery_date, atRisk: o.at_risk, atRiskReason: o.at_risk_reason, items: out }
}

// ---------------------------------------------------------------- exceptions

/** Everything someone should look at, grouped. Each group is capped; counts say how many there are. */
export async function exceptions(c, warehouseId) {
  const at = now()
  const today = todayIST()
  const cap = 50
  const q = async (sql, params) => (await c.query(sql, params)).rows
  const [atRisk, heldOnOrders, unverified, staleOps, expiring, failedNotes, pendingWo, staging, investigations, counts, missing] = await Promise.all([
    q(`SELECT o.id, o.number, o.status, o.delivery_date, o.at_risk_reason FROM orders o
        WHERE o.at_risk AND o.status IN ('CONFIRMED', 'PROCESSING', 'PACKED')
          AND EXISTS (SELECT 1 FROM order_items i JOIN products p ON p.sku = i.sku WHERE i.order_id = o.id AND p.box_tracking_enabled)
        ORDER BY o.delivery_date LIMIT $1`, [cap]),
    q(`SELECT b.id, b.code, b.order_id, o.number, array_agg(h.kind) AS holds FROM boxes b JOIN box_holds h ON h.box_id = b.id AND h.released_at IS NULL
         JOIN orders o ON o.id = b.order_id WHERE b.warehouse_id = $1 AND b.lifecycle IN ('picked', 'packed') GROUP BY b.id, o.number LIMIT $2`, [warehouseId, cap]),
    q(`SELECT l.id, l.code, l.created_at, count(b.id)::int AS waiting FROM box_lots l JOIN boxes b ON b.lot_id = l.id AND b.lifecycle = 'generated'
        WHERE l.warehouse_id = $1 AND l.created_at < $2 AND l.status IN ('receiving', 'received', 'generating') GROUP BY l.id ORDER BY l.created_at LIMIT $3`,
      [warehouseId, new Date(at.getTime() - 24 * 3_600_000), cap]),
    q(`SELECT o.id, o.type, o.owner_id, a.email, o.last_activity_at FROM wh_operations o LEFT JOIN admin_users a ON a.id = o.owner_id
        WHERE o.warehouse_id = $1 AND o.status = 'open' AND o.class = 'staged' AND o.last_activity_at < $2 ORDER BY o.last_activity_at LIMIT $3`,
      [warehouseId, new Date(at.getTime() - 15 * 60_000), cap]),
    q(`SELECT b.lot_id, l.code, count(*)::int AS boxes, min(b.best_before) AS best_before FROM boxes b JOIN box_lots l ON l.id = b.lot_id
        WHERE b.warehouse_id = $1 AND b.lifecycle = 'in_stock' AND b.best_before <= $2 GROUP BY b.lot_id, l.code ORDER BY min(b.best_before) LIMIT $3`,
      [warehouseId, addDays(today, 2), cap]),
    q(`SELECT n.id, n.kind, o.number, n.last_error FROM notifications n JOIN orders o ON o.id = n.order_id
        WHERE n.status = 'FAILED' AND n.created_at > $1 ORDER BY n.created_at DESC LIMIT $2`, [new Date(at.getTime() - 3 * 86_400_000), cap]),
    q(`SELECT id, cardinality(box_ids) AS boxes, reason, requested_at FROM wh_writeoffs WHERE warehouse_id = $1 AND status = 'pending' ORDER BY requested_at LIMIT $2`, [warehouseId, cap]),
    q(`SELECT b.id, b.code, b.sku_name, b.updated_at FROM boxes b JOIN wh_locations l ON l.id = b.location_id
        WHERE b.warehouse_id = $1 AND b.lifecycle = 'in_stock' AND l.type IN ('pick_staging', 'packing', 'receiving') AND b.quality = 'passed'
          AND NOT EXISTS (SELECT 1 FROM box_holds h WHERE h.box_id = b.id AND h.released_at IS NULL) AND b.updated_at < $2
        ORDER BY b.updated_at LIMIT $3`, [warehouseId, new Date(at.getTime() - 2 * 3_600_000), cap]),
    q(`SELECT b.id, b.code, h.reason, h.added_at FROM box_holds h JOIN boxes b ON b.id = h.box_id
        WHERE b.warehouse_id = $1 AND h.kind = 'investigation_hold' AND h.released_at IS NULL ORDER BY h.added_at LIMIT $2`, [warehouseId, cap]),
    // Counts with boxes waiting for a supervisor's review, or a second person's approval.
    q(`SELECT o.id, o.context->>'locationName' AS location_name, o.finished_at,
              count(*) FILTER (WHERE l.status = 'proposed')::int AS to_review, count(*) FILTER (WHERE l.status = 'pending_approval')::int AS to_approve
         FROM wh_operations o JOIN wh_stocktake_lines l ON l.operation_id = o.id
        WHERE o.warehouse_id = $1 AND o.type = 'stocktake' AND l.status IN ('proposed', 'pending_approval')
        GROUP BY o.id ORDER BY o.finished_at LIMIT $2`, [warehouseId, cap]),
    q(`SELECT b.id, b.code, b.sku_name, b.updated_at FROM boxes b WHERE b.warehouse_id = $1 AND b.lifecycle = 'missing' ORDER BY b.updated_at LIMIT $2`, [warehouseId, cap]),
  ])
  const fmt = (r) => ({ ...r, ...(r.code && /^[0-9A-Z]{9}$/.test(r.code) ? { code: formatBoxCode(r.code) } : {}) })
  return {
    shortfallOrders: atRisk.map((r) => ({ orderId: r.id, number: r.number, status: r.status, deliveryDate: r.delivery_date, reason: r.at_risk_reason })),
    heldBoxesOnOrders: heldOnOrders.map((r) => ({ boxId: r.id, code: formatBoxCode(r.code), orderId: r.order_id, number: r.number, holds: r.holds })),
    unreceivedLots: unverified.map((r) => ({ lotId: r.id, code: r.code, createdAt: r.created_at, waiting: r.waiting })),
    staleSessions: staleOps.map((r) => ({ operationId: r.id, type: r.type, owner: r.email, lastActivityAt: r.last_activity_at })),
    expiringSoon: expiring.map((r) => ({ lotId: r.lot_id, code: r.code, boxes: r.boxes, bestBefore: r.best_before })),
    failedMessages: failedNotes.map((r) => ({ id: r.id, kind: r.kind, number: r.number, error: r.last_error })),
    pendingWriteOffs: pendingWo.map((r) => ({ id: r.id, boxes: r.boxes, reason: r.reason, requestedAt: r.requested_at })),
    boxesToPutAway: staging.map(fmt).map((r) => ({ boxId: r.id, code: r.code, skuName: r.sku_name, since: r.updated_at })),
    investigations: investigations.map((r) => ({ boxId: r.id, code: formatBoxCode(r.code), reason: r.reason, since: r.added_at })),
    stocktakeReviews: counts.map((r) => ({ operationId: r.id, locationName: r.location_name, finishedAt: r.finished_at, toReview: r.to_review, toApprove: r.to_approve })),
    missingBoxes: missing.map((r) => ({ boxId: r.id, code: formatBoxCode(r.code), skuName: r.sku_name, since: r.updated_at })),
  }
}

// ---------------------------------------------------------------- reconciliation

/**
 * Checks the books against the boxes. Clean means: every tracked line's
 * on_hand equals its shelf-sellable boxes, every picked or packed box has a
 * packed stock unit on its order (and the other way round), no box is in an
 * impossible state, every lot's counts match its boxes, and the ledger
 * audit balances.
 */
export async function reconciliation(c, warehouseId) {
  const q = async (sql, params = []) => (await c.query(sql, params)).rows
  const [lines, units, states, lots, ledgerDrift] = await Promise.all([
    q(`SELECT l.id, l.batch_id, l.sku, l.on_hand,
              (SELECT count(*)::int FROM boxes b WHERE b.line_id = l.id AND box_shelf_sellable(b.id)) AS sellable_boxes
         FROM batch_lines l JOIN products p ON p.sku = l.sku JOIN batches bt ON bt.id = l.batch_id
        WHERE p.box_tracking_enabled AND bt.status NOT IN ('EXHAUSTED', 'CONDEMNED')`),
    q(`SELECT x.order_id, x.line_id, x.boxes, x.units, o.number FROM (
          SELECT coalesce(b.order_id, s.order_id) AS order_id, coalesce(b.line_id, s.line_id) AS line_id, coalesce(b.n, 0) AS boxes, coalesce(s.n, 0) AS units
            FROM (SELECT order_id, line_id, count(*)::int AS n FROM boxes WHERE lifecycle IN ('picked', 'packed', 'dispatched') GROUP BY order_id, line_id) b
            FULL JOIN (SELECT s.order_id, s.line_id, sum(s.quantity)::int AS n FROM order_stock s JOIN products p ON p.sku = s.sku
                        WHERE s.state = 'packed' AND p.box_tracking_enabled GROUP BY s.order_id, s.line_id) s
              ON s.order_id = b.order_id AND s.line_id = b.line_id) x
         JOIN orders o ON o.id = x.order_id
        WHERE x.boxes <> x.units AND NOT (o.status IN ('DELIVERED', 'CANCELLED', 'RTO') AND x.units = 0)`),
    q(`SELECT b.id, b.code, b.lifecycle, o.status AS order_status, o.number,
              CASE WHEN b.lifecycle IN ('picked', 'packed') AND o.status NOT IN ('CONFIRMED', 'PROCESSING', 'PACKED') THEN 'on a ' || lower(o.status) || ' order'
                   WHEN b.lifecycle = 'dispatched' AND o.status IN ('CONFIRMED', 'PROCESSING', 'PACKED') THEN 'dispatched but the order is not shipped'
                   WHEN b.lifecycle = 'packed' AND o.status IN ('CONFIRMED') THEN 'packed on an unpicked order' END AS problem
         FROM boxes b JOIN orders o ON o.id = b.order_id
        WHERE b.warehouse_id = $1 AND (
              (b.lifecycle IN ('picked', 'packed') AND o.status NOT IN ('CONFIRMED', 'PROCESSING', 'PACKED'))
           OR (b.lifecycle = 'dispatched' AND o.status IN ('CONFIRMED', 'PROCESSING', 'PACKED'))
           OR (b.lifecycle = 'packed' AND o.status = 'CONFIRMED')) LIMIT 200`, [warehouseId]),
    q(`SELECT l.id, l.code, l.generated_count, l.verified_count, l.voided_count, x.generated, x.verified, x.voided FROM box_lots l
         JOIN (SELECT lot_id, count(*)::int AS generated, count(*) FILTER (WHERE verification IS NOT NULL)::int AS verified,
                      count(*) FILTER (WHERE lifecycle = 'voided')::int AS voided FROM boxes GROUP BY lot_id) x ON x.lot_id = l.id
        WHERE l.warehouse_id = $1 AND (l.generated_count <> x.generated OR l.verified_count <> x.verified OR l.voided_count <> x.voided)`, [warehouseId]),
    auditLedger(c),
  ])
  const stock = lines.filter((l) => l.on_hand !== l.sellable_boxes)
  const report = {
    checkedAt: now(),
    clean: !stock.length && !units.length && !states.length && !lots.length && !ledgerDrift.length,
    trackedLines: lines.length,
    stockMismatches: stock.map((l) => ({ lineId: l.id, batchId: l.batch_id, sku: l.sku, onHand: l.on_hand, sellableBoxes: l.sellable_boxes })),
    orderUnitMismatches: units.map((u) => ({ orderId: u.order_id, number: u.number, lineId: u.line_id, boxes: u.boxes, packedUnits: u.units })),
    impossibleStates: states.map((s) => ({ boxId: s.id, code: formatBoxCode(s.code), lifecycle: s.lifecycle, number: s.number, problem: s.problem })),
    lotCountMismatches: lots.map((l) => ({ lotId: l.id, code: l.code, stored: [l.generated_count, l.verified_count, l.voided_count], actual: [l.generated, l.verified, l.voided] })),
    ledgerDrift,
  }
  return report
}

// ---------------------------------------------------------------- trace

/** A box's full story: where it came from (lot, batch, supplier, parents) and every event. */
export async function traceBox(c, box, who) {
  const lot = (await c.query('SELECT * FROM box_lots WHERE id = $1', [box.lot_id])).rows[0]
  const batch = (await c.query('SELECT id, variety, plucked_on, farm, status, arrived_at FROM batches WHERE id = $1', [box.batch_id])).rows[0]
  const parents = box.parent_box_ids?.length
    ? (await c.query(
        `WITH RECURSIVE up (id, depth) AS (SELECT unnest($1::uuid[]), 1 UNION SELECT unnest(b.parent_box_ids), u.depth + 1 FROM boxes b JOIN up u ON b.id = u.id WHERE u.depth < 10)
         SELECT b.id, b.code, b.lot_id, u.depth FROM up u JOIN boxes b ON b.id = u.id ORDER BY u.depth`,
        [box.parent_box_ids],
      )).rows.map((p) => ({ id: p.id, code: formatBoxCode(p.code), lotId: p.lot_id, depth: p.depth }))
    : []
  // Backward: every lot and batch the fruit came from (a merged box has several). Forward: boxes made from this one.
  const origins = (await c.query(
    `SELECT DISTINCT l.id, l.code, l.supplier, l.received_on, bt.id AS batch_id, bt.variety, bt.plucked_on, bt.farm
       FROM (SELECT lot_id FROM box_origins WHERE box_id = $1 UNION SELECT $2::text) o JOIN box_lots l ON l.id = o.lot_id JOIN batches bt ON bt.id = l.batch_id
      ORDER BY l.code`,
    [box.id, box.lot_id],
  )).rows
  const descendants = (await c.query(
    `WITH RECURSIVE down (id, depth) AS (SELECT $1::uuid, 0 UNION SELECT b.id, d.depth + 1 FROM boxes b JOIN down d ON b.parent_box_ids @> ARRAY[d.id] WHERE d.depth < 10)
     SELECT b.id, b.code, b.lifecycle, b.order_id, min(d.depth) AS depth FROM down d JOIN boxes b ON b.id = d.id WHERE d.depth > 0
      GROUP BY b.id ORDER BY min(d.depth), b.code`,
    [box.id],
  )).rows
  const events = (await c.query(
    `SELECT e.*, a.email AS actor_email FROM box_events e LEFT JOIN admin_users a ON a.id = e.actor_id WHERE e.box_id = $1 ORDER BY e.created_at, e.id`,
    [box.id],
  )).rows
  const orderIds = [...new Set([...events.map((e) => e.order_id), ...descendants.map((d) => d.order_id)].filter(Boolean))]
  return {
    box: boxView(box),
    lot: lot && { id: lot.id, code: lot.code, supplier: lot.supplier, harvestedOn: lot.harvested_on, receivedOn: lot.received_on, bestBefore: lot.best_before, isLegacy: lot.is_legacy },
    batch: batch && { id: batch.id, variety: batch.variety, pluckedOn: batch.plucked_on, farm: batch.farm, status: batch.status },
    parents,
    origins: origins.map((o) => ({ lotId: o.id, lotCode: o.code, supplier: o.supplier, receivedOn: o.received_on, batchId: o.batch_id, variety: o.variety, pluckedOn: o.plucked_on, farm: o.farm })),
    descendants: descendants.map((d) => ({ id: d.id, code: formatBoxCode(d.code), lifecycle: d.lifecycle, orderId: d.order_id, depth: d.depth })),
    orders: await ordersFor(c, orderIds, who),
    events: events.map((e) => ({ type: e.type, at: e.created_at, actor: e.actor_email, fromLifecycle: e.from_lifecycle, toLifecycle: e.to_lifecycle, fromLocation: e.from_location, toLocation: e.to_location, quality: e.to_quality, fromQuality: e.from_quality, toQuality: e.to_quality, holdAdded: e.hold_added, holdReleased: e.hold_released, orderId: e.order_id, reasonCode: e.reason_code, reason: e.reason })),
  }
}

/** Order numbers, with customer details only for roles holding recall.view_customers. */
async function ordersFor(c, ids, who) {
  if (!ids.length) return []
  const withPeople = can(who.role, 'recall.view_customers')
  const { rows } = await c.query(`SELECT id, number, status, delivery_date, customer_name, phone FROM orders WHERE id = ANY($1) ORDER BY number`, [ids])
  return rows.map((o) => ({ id: o.id, number: o.number, status: o.status, deliveryDate: o.delivery_date, ...(withPeople ? { customerName: o.customer_name, phone: o.phone } : {}) }))
}

/** Where a lot's boxes went: counts by state, every box, and the orders they went to (repack descendants included). */
export async function traceLot(c, lotId, who) {
  const lot = (await c.query('SELECT * FROM box_lots WHERE id = $1 AND warehouse_id = $2', [lotId, who.warehouseId])).rows[0]
  if (!lot) throw whError('NOT_FOUND', 'Lot not found', 404)
  const { rows: boxes } = await c.query(
    `${LINEAGE_DOWN}
     SELECT b.id, b.code, b.lifecycle, b.quality, b.order_id, b.location_id, l.name AS location_name,
            CASE WHEN b.parent_box_ids <> '{}' THEN greatest(d.depth, 1) ELSE d.depth END AS depth,
            (SELECT e.order_id FROM box_events e WHERE e.box_id = b.id AND e.order_id IS NOT NULL ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS last_order_id,
            (SELECT coalesce(array_agg(h.kind), '{}') FROM box_holds h WHERE h.box_id = b.id AND h.released_at IS NULL) AS holds
       FROM lineage d JOIN boxes b ON b.id = d.id LEFT JOIN wh_locations l ON l.id = b.location_id ORDER BY 8, b.code`,
    [[lot.id]],
  )
  const byState = {}
  for (const b of boxes) byState[b.lifecycle] = (byState[b.lifecycle] ?? 0) + 1
  const orderIds = [...new Set(boxes.map((b) => b.order_id ?? (b.lifecycle === 'returned' ? b.last_order_id : null)).filter(Boolean))]
  return {
    lot: { id: lot.id, code: lot.code, sku: lot.sku, supplier: lot.supplier, harvestedOn: lot.harvested_on, receivedOn: lot.received_on, bestBefore: lot.best_before, status: lot.status },
    byState,
    boxes: boxes.map((b) => ({ id: b.id, code: formatBoxCode(b.code), lifecycle: b.lifecycle, quality: b.quality, holds: b.holds, location: b.location_name, orderId: b.order_id ?? b.last_order_id, descendant: b.depth > 0 })),
    orders: await ordersFor(c, orderIds, who),
  }
}

// ---------------------------------------------------------------- recalls

const RECALL_CHUNK = 200

/** Lifecycles a recall holds: the box has not left for good. */
const RECALL_REACH = ['generated', 'in_stock', 'picked', 'packed', 'returned', 'missing']

/** The boxes a recall holds: every box of its lots (and repack descendants) still here and not yet held by it. */
const recallTargets = (c, recall, limit) =>
  c.query(
    `${LINEAGE_DOWN}
     SELECT b.id FROM lineage d JOIN boxes b ON b.id = d.id
      WHERE b.lifecycle = ANY($3)
        AND NOT EXISTS (SELECT 1 FROM box_holds h WHERE h.box_id = b.id AND h.kind = 'recall_hold' AND h.released_at IS NULL)
      ORDER BY b.id LIMIT $2`,
    [recall.lot_ids, limit, RECALL_REACH],
  )

/** Starts a recall: holds the first chunk of boxes now; continueRecall holds the rest. */
export async function startRecall(c, { lotIds, reason }, who) {
  const ids = [...new Set(lotIds)]
  const { rows } = await c.query('SELECT id FROM box_lots WHERE id = ANY($1) AND warehouse_id = $2', [ids, who.warehouseId])
  if (rows.length !== ids.length) throw whError('NOT_FOUND', 'A lot in this recall was not found', 404)
  const recall = { id: newId('rcl'), lot_ids: ids, reason }
  await c.query(
    `INSERT INTO wh_recalls (id, warehouse_id, lot_ids, reason, status, created_by, created_at) VALUES ($1, $2, $3, $4, 'running', $5, $6)`,
    [recall.id, who.warehouseId, ids, reason, who.actor.id, now()],
  )
  return continueRecall(c, recall.id, who)
}

export async function continueRecall(c, id, who) {
  const recall = (await c.query('SELECT * FROM wh_recalls WHERE id = $1 AND warehouse_id = $2 FOR UPDATE', [id, who.warehouseId])).rows[0]
  if (!recall) throw whError('NOT_FOUND', 'Recall not found', 404)
  if (recall.status !== 'running') return recallView(c, recall, who)
  const { rows } = await recallTargets(c, recall, RECALL_CHUNK)
  const d = newDeltas()
  let held = 0
  for (const b of (await lockBoxes(c, rows.map((r) => r.id))).values()) {
    if (await addHold(c, b, 'recall_hold', `Recall: ${recall.reason}`, { type: 'HOLD_ADDED', actor: who.actor, reasonCode: 'recall', meta: { recallId: recall.id } }, d, { recallId: recall.id })) held++
  }
  await applyLineDeltas(c, d, who.actor, `Recall ${recall.id}: ${recall.reason}`)
  const more = rows.length === RECALL_CHUNK
  const { rows: upd } = await c.query(
    `UPDATE wh_recalls SET held_count = held_count + $2, status = $3, finished_at = CASE WHEN $3 = 'done' THEN $4 ELSE finished_at END WHERE id = $1 RETURNING *`,
    [recall.id, held, more ? 'running' : 'done', now()],
  )
  return recallView(c, upd[0], who)
}

/**
 * Ends a recall: releases only the recall holds it placed (other holds stay).
 * A box has one recall hold however many recalls reach it (a box of a lot in
 * two recalls, or a box merged from two recalled lots), so a box still within
 * another recall in force is handed to that recall instead of being freed.
 */
export async function releaseRecall(c, id, { reason }, who) {
  // This recall and every other one in force, locked in id order (two releases at once never deadlock).
  const locked = (await c.query(
    `SELECT * FROM wh_recalls WHERE warehouse_id = $1 AND (id = $2 OR status IN ('running', 'done')) ORDER BY id FOR UPDATE`,
    [who.warehouseId, id],
  )).rows
  const recall = locked.find((r) => r.id === id)
  if (!recall) throw whError('NOT_FOUND', 'Recall not found', 404)
  if (recall.status === 'released') return recallView(c, recall, who)
  const { rows } = await c.query(`SELECT box_id FROM box_holds WHERE recall_id = $1 AND kind = 'recall_hold' AND released_at IS NULL ORDER BY box_id`, [id])
  const heldIds = rows.map((r) => r.box_id)
  // The other recalls in force, oldest first: which of these boxes each still reaches.
  const others = locked.filter((r) => r.id !== id).sort((x, y) => (x.created_at - y.created_at) || (x.id < y.id ? -1 : 1))
  const handOver = new Map()
  for (const o of others) {
    if (handOver.size === heldIds.length) break
    const left = heldIds.filter((x) => !handOver.has(x))
    const { rows: reach } = await c.query(
      `${LINEAGE_DOWN} SELECT b.id FROM lineage d JOIN boxes b ON b.id = d.id WHERE b.id = ANY($2::uuid[]) AND b.lifecycle = ANY($3)`,
      [o.lot_ids, left, RECALL_REACH],
    )
    for (const r of reach) handOver.set(r.id, o)
  }
  const d = newDeltas()
  const handed = new Map()
  for (const b of (await lockBoxes(c, heldIds)).values()) {
    await releaseHold(c, b, 'recall_hold', `Recall released: ${reason}`, { type: 'HOLD_RELEASED', actor: who.actor, reasonCode: 'recall', meta: { recallId: id } }, d)
    const next = handOver.get(b.id)
    if (next && (await addHold(c, b, 'recall_hold', `Recall: ${next.reason}`, { type: 'HOLD_ADDED', actor: who.actor, reasonCode: 'recall', meta: { recallId: next.id, from: id } }, d, { recallId: next.id }))) {
      handed.set(next.id, (handed.get(next.id) ?? 0) + 1)
    }
  }
  for (const [rid, n] of handed) await c.query('UPDATE wh_recalls SET held_count = held_count + $2 WHERE id = $1', [rid, n])
  await applyLineDeltas(c, d, who.actor, `Recall ${id} released`)
  const { rows: upd } = await c.query(
    `UPDATE wh_recalls SET status = 'released', released_by = $2, released_at = $3, release_reason = $4 WHERE id = $1 RETURNING *`,
    [id, who.actor.id, now(), reason],
  )
  return recallView(c, upd[0], who)
}

/** A recall's reach: its lots' boxes and their repack descendants, by state, and every order any of them left on. */
export async function recallView(c, r, who) {
  const { rows } = await c.query(
    `${LINEAGE_DOWN}
     SELECT b.lifecycle, count(*)::int AS n FROM lineage d JOIN boxes b ON b.id = d.id GROUP BY b.lifecycle`,
    [r.lot_ids],
  )
  const gone = (await c.query(
    `${LINEAGE_DOWN}
     SELECT DISTINCT b.order_id FROM lineage d JOIN boxes b ON b.id = d.id WHERE b.lifecycle = 'dispatched'
     UNION SELECT DISTINCT e.order_id FROM lineage d JOIN box_events e ON e.box_id = d.id WHERE e.type = 'DISPATCHED'`,
    [r.lot_ids],
  )).rows.map((x) => x.order_id).filter(Boolean)
  return {
    id: r.id, lotIds: r.lot_ids, reason: r.reason, status: r.status, held: r.held_count, createdAt: r.created_at, finishedAt: r.finished_at,
    releasedAt: r.released_at, releaseReason: r.release_reason, byState: Object.fromEntries(rows.map((x) => [x.lifecycle, x.n])),
    dispatchedOrders: await ordersFor(c, gone, who),
  }
}

export async function listRecalls(c, who) {
  const { rows } = await c.query('SELECT * FROM wh_recalls WHERE warehouse_id = $1 ORDER BY created_at DESC LIMIT 100', [who.warehouseId])
  return rows.map((r) => ({ id: r.id, lotIds: r.lot_ids, reason: r.reason, status: r.status, held: r.held_count, createdAt: r.created_at }))
}

// ---------------------------------------------------------------- product settings

export const productSettings = (p) => ({
  sku: p.sku, name: p.name, variety: p.variety, active: p.active, boxTrackingEnabled: p.box_tracking_enabled, nominalWeightG: p.nominal_weight_g,
  weightTolerancePct: Number(p.weight_tolerance_pct), requiresQc: p.requires_qc, restockableReturns: p.restockable_returns,
  shelfLifeDays: p.shelf_life_days, qcChecklist: p.qc_checklist,
})

/**
 * Changes a product's warehouse rules. Turning box tracking on needs every
 * open batch line of the product to match its labelled, shelf-sellable boxes
 * exactly, and no packed stock on open orders (it was packed without boxes).
 */
export async function updateProductSettings(c, sku, patch, who) {
  const p = (await c.query('SELECT * FROM products WHERE sku = $1 FOR UPDATE', [sku])).rows[0]
  if (!p) throw whError('NOT_FOUND', 'Product not found', 404)
  if (patch.boxTrackingEnabled === true && !p.box_tracking_enabled) {
    const lines = (await c.query(
      `SELECT l.id, l.on_hand, l.batch_id FROM batch_lines l JOIN batches b ON b.id = l.batch_id WHERE l.sku = $1 AND b.status NOT IN ('EXHAUSTED', 'CONDEMNED') ORDER BY l.id FOR UPDATE OF l`,
      [sku],
    )).rows
    const off = []
    for (const l of lines) {
      const n = (await c.query('SELECT count(*)::int AS n FROM boxes b WHERE b.line_id = $1 AND box_shelf_sellable(b.id)', [l.id])).rows[0].n
      if (n !== l.on_hand) off.push({ lineId: l.id, batchId: l.batch_id, onHand: l.on_hand, sellableBoxes: n })
    }
    if (off.length) throw whError('RECONCILIATION_NEEDED', `${off.length} ${off.length === 1 ? 'batch does' : 'batches do'} not match their labelled boxes. Label the stock (legacy intake), QC and put it away first.`, 409, { lines: off })
    const packed = (await c.query(
      `SELECT count(*)::int AS n FROM order_stock s JOIN orders o ON o.id = s.order_id WHERE s.sku = $1 AND s.state = 'packed' AND o.status IN ('CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED')`,
      [sku],
    )).rows[0].n
    if (packed) throw whError('RECONCILIATION_NEEDED', `${packed} boxes of this product are packed on open orders without labels. Turn tracking on once they are delivered.`)
  }
  const cols = {
    boxTrackingEnabled: 'box_tracking_enabled', nominalWeightG: 'nominal_weight_g', weightTolerancePct: 'weight_tolerance_pct', requiresQc: 'requires_qc',
    restockableReturns: 'restockable_returns', shelfLifeDays: 'shelf_life_days', qcChecklist: 'qc_checklist',
  }
  const set = Object.entries(cols).filter(([k]) => patch[k] !== undefined)
  if (!set.length) return productSettings(p)
  const values = set.map(([k]) => (k === 'qcChecklist' ? JSON.stringify(patch[k]) : patch[k]))
  const { rows } = await c.query(
    `UPDATE products SET ${set.map(([, col], i) => `${col} = $${i + 2}`).concat(`updated_at = $${set.length + 2}`).join(', ')} WHERE sku = $1 RETURNING *`,
    [sku, ...values, now()],
  )
  await c.query(
    `INSERT INTO staff_audit (id, admin_id, email, role, action, target, detail, request_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [newId('aud'), who.actor.id, who.actor.label ?? null, who.role, 'PATCH /warehouse/products/:sku', sku, { ...patch, before: productSettings(p) }, who.requestId ?? null, now()],
  )
  return productSettings(rows[0])
}

export async function listProductSettings(c) {
  const { rows } = await c.query('SELECT * FROM products ORDER BY sort_order, name')
  return rows.map(productSettings)
}

export const reloadProducts = () => loadProducts()

// ---------------------------------------------------------------- CSV

/** One CSV cell: quoted, and a leading = + - @ tab or CR made inert (spreadsheet formula injection). */
export function csvCell(v) {
  if (v === null || v === undefined) return ''
  let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}
export const csv = (header, rows) => [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n'

export const EXPORTS = ['boxes', 'events', 'lots', 'reconciliation']

export async function exportReport(c, report, { from = null, to = null } = {}, who) {
  if (report === 'boxes') {
    const { rows } = await c.query(
      `SELECT b.code, b.sku, b.sku_name, l.code AS lot, b.lifecycle, b.quality, loc.name AS location, b.best_before, b.verification,
              (SELECT string_agg(h.kind, ' ') FROM box_holds h WHERE h.box_id = b.id AND h.released_at IS NULL) AS holds, o.number AS order_number, b.updated_at
         FROM boxes b JOIN box_lots l ON l.id = b.lot_id LEFT JOIN wh_locations loc ON loc.id = b.location_id LEFT JOIN orders o ON o.id = b.order_id
        WHERE b.warehouse_id = $1 ORDER BY l.code, b.seq LIMIT 100000`,
      [who.warehouseId],
    )
    return csv(['box', 'sku', 'product', 'lot', 'lifecycle', 'quality', 'location', 'best_before', 'verification', 'holds', 'order', 'updated_at'],
      rows.map((r) => [formatBoxCode(r.code), r.sku, r.sku_name, r.lot, r.lifecycle, r.quality, r.location, r.best_before, r.verification, r.holds, r.order_number, r.updated_at]))
  }
  if (report === 'events') {
    const start = from ?? addDays(todayIST(), -7)
    const end = to ?? todayIST()
    const { rows } = await c.query(
      `SELECT e.created_at, b.code, e.type, a.email, e.from_lifecycle, e.to_lifecycle, fl.name AS from_location, tl.name AS to_location,
              e.to_quality, e.hold_added, e.hold_released, o.number, e.reason_code, e.reason
         FROM box_events e JOIN boxes b ON b.id = e.box_id LEFT JOIN admin_users a ON a.id = e.actor_id
         LEFT JOIN wh_locations fl ON fl.id = e.from_location LEFT JOIN wh_locations tl ON tl.id = e.to_location LEFT JOIN orders o ON o.id = e.order_id
        WHERE b.warehouse_id = $1 AND e.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND e.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
        ORDER BY e.created_at, e.id LIMIT 200000`,
      [who.warehouseId, start, end],
    )
    return csv(['at', 'box', 'event', 'by', 'from_lifecycle', 'to_lifecycle', 'from_location', 'to_location', 'quality', 'hold_added', 'hold_released', 'order', 'reason_code', 'reason'],
      rows.map((r) => [r.created_at, formatBoxCode(r.code), r.type, r.email, r.from_lifecycle, r.to_lifecycle, r.from_location, r.to_location, r.to_quality, r.hold_added, r.hold_released, r.number, r.reason_code, r.reason]))
  }
  if (report === 'lots') {
    const { rows } = await c.query('SELECT * FROM box_lots WHERE warehouse_id = $1 ORDER BY created_at DESC LIMIT 10000', [who.warehouseId])
    return csv(['lot', 'sku', 'supplier', 'expected', 'labels', 'verified', 'voided', 'harvested_on', 'received_on', 'best_before', 'status', 'legacy'],
      rows.map((l) => [l.code, l.sku, l.supplier, l.expected_count, l.generated_count, l.verified_count, l.voided_count, l.harvested_on, l.received_on, l.best_before, l.status, l.is_legacy]))
  }
  if (report === 'reconciliation') {
    const r = await reconciliation(c, who.warehouseId)
    const rows = [
      ...r.stockMismatches.map((m) => ['stock', m.sku, m.batchId, `on_hand ${m.onHand}`, `sellable boxes ${m.sellableBoxes}`]),
      ...r.orderUnitMismatches.map((m) => ['order', m.number, m.lineId, `boxes ${m.boxes}`, `packed units ${m.packedUnits}`]),
      ...r.impossibleStates.map((m) => ['box', m.code, m.number, m.lifecycle, m.problem]),
      ...r.lotCountMismatches.map((m) => ['lot', m.code, '', m.stored.join('/'), m.actual.join('/')]),
    ]
    return csv(['kind', 'what', 'where', 'books', 'boxes'], rows)
  }
  throw whError('NOT_FOUND', 'Unknown report', 404)
}

