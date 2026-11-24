// The planned-order side of a week's kg budget (migration 083, plan-orders.js): preorder_variety_week_kg.planned_kg.
// A variety's week has ONE budget: room = expected kg - pre-order kg (reserved_kg) - planned-order kg (planned_kg).
// This file holds only the counter moves, with nothing that needs orders.js or preorders.js, so both can use it.
import { addDays } from './clock.js'
import { boxKg, findProduct } from './products.js'

const roundKg = (x) => Math.round(Number(x) * 1000) / 1000

/** The Monday on or before a date (YYYY-MM-DD). */
export const mondayOf = (d) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7))
/** The variety a box counts against in the plan (a Mixed Box is its own line). */
export const planVarietyOf = (sku) => findProduct(sku)?.variety ?? sku
/** What one order line takes from the plan, in kg. */
export const lineKg = (l) => roundKg(l.qty * boxKg(l.sku))
/** [{ variety, kg }] of these lines ({ sku, qty }), by variety in code-point order (the order week rows are taken in). */
export function planRows(lines) {
  const by = new Map()
  for (const l of lines) by.set(planVarietyOf(l.sku), roundKg((by.get(planVarietyOf(l.sku)) ?? 0) + lineKg(l)))
  return [...by].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([variety, kg]) => ({ variety, kg }))
}

/** What an order holds of the plan, from its items: [{ variety, kg }], in code-point order. */
export async function orderPlanRows(c, orderId) {
  const { rows } = await c.query(
    `SELECT plan_variety AS variety, SUM(plan_kg) AS kg FROM order_items WHERE order_id = $1 AND plan_kg IS NOT NULL GROUP BY plan_variety ORDER BY plan_variety COLLATE "C"`,
    [orderId],
  )
  return rows.map((r) => ({ variety: r.variety, kg: roundKg(r.kg) }))
}

/**
 * Adds `rows` to a week in one conditional write per variety, or returns false when a variety's budget would go over
 * (the caller's transaction is then rolled back, or nothing else was changed for that variety). Two orders, or an order
 * and a pre-order, queue on the row, and ON CONFLICT re-checks against the latest counts. `limitOf(variety)`: the kg a
 * week without its own number takes. `force`: always taken (a payment after its hold ran out, a move we made).
 */
export async function takePlanKg(c, week, rows, { force = false, limitOf = null } = {}) {
  for (const { variety, kg } of rows) {
    const r = await c.query(
      `INSERT INTO preorder_variety_week_kg AS k (week_start, variety, planned_kg)
       SELECT $1::date, $2, $3::numeric
        WHERE $4::boolean OR $3::numeric <= COALESCE((SELECT limit_kg FROM preorder_variety_week_kg WHERE week_start = $1 AND variety = $2), $5::numeric)
       ON CONFLICT (week_start, variety) DO UPDATE SET planned_kg = k.planned_kg + EXCLUDED.planned_kg
        WHERE $4::boolean OR k.reserved_kg + k.planned_kg + EXCLUDED.planned_kg <= COALESCE(k.limit_kg, $5::numeric)`,
      [week, variety, kg, force, force ? null : limitOf(variety)],
    )
    if (!r.rowCount) return false
  }
  return true
}

const givePlanKg = async (c, week, rows) => {
  for (const { variety, kg } of rows) {
    await c.query('UPDATE preorder_variety_week_kg SET planned_kg = GREATEST(planned_kg - $3::numeric, 0) WHERE week_start = $1 AND variety = $2', [week, variety, kg])
  }
}

/** A cancelled order gives its kg back to its week, once (plan_week is cleared). */
export async function releaseOrderPlan(c, orderId) {
  const { rows } = await c.query('SELECT plan_week FROM orders WHERE id = $1', [orderId])
  if (!rows[0]?.plan_week) return
  await c.query('UPDATE orders SET plan_week = NULL WHERE id = $1', [orderId])
  await givePlanKg(c, rows[0].plan_week, await orderPlanRows(c, orderId))
}

/** A payment that lands after the order was cancelled: the order takes its week's kg back, over the budget if it must. */
export async function retakeOrderPlan(c, o) {
  if (!o.planned || o.plan_week) return
  const week = mondayOf(o.delivery_date)
  await takePlanKg(c, week, await orderPlanRows(c, o.id), { force: true })
  await c.query('UPDATE orders SET plan_week = $2 WHERE id = $1', [o.id, week])
  o.plan_week = week
}

/**
 * Moves an order's kg to another week. The week rows are locked first, earliest week first (the order a recalculation
 * takes them in). false when the new week has no room (nothing changed); `force` takes it anyway.
 */
export async function movePlanWeek(c, o, to, { force = false, limitOf = null } = {}) {
  const from = o.plan_week
  if (!from || from === to) return true
  const rows = await orderPlanRows(c, o.id)
  const names = rows.map((r) => r.variety)
  await c.query(
    `INSERT INTO preorder_variety_week_kg (week_start, variety) SELECT $1::date, v FROM unnest($2::text[]) AS v ORDER BY v ON CONFLICT DO NOTHING`,
    [to, names],
  )
  await c.query(
    `SELECT 1 FROM preorder_variety_week_kg WHERE week_start = ANY($1::date[]) AND variety = ANY($2) ORDER BY week_start, variety COLLATE "C" FOR UPDATE`,
    [[from, to], names],
  )
  await c.query('SAVEPOINT plan_week')
  if (!(await takePlanKg(c, to, rows, { force, limitOf }))) {
    await c.query('ROLLBACK TO SAVEPOINT plan_week')
    return false
  }
  await c.query('RELEASE SAVEPOINT plan_week')
  await givePlanKg(c, from, rows)
  await c.query('UPDATE orders SET plan_week = $2 WHERE id = $1', [o.id, to])
  o.plan_week = to
  return true
}
