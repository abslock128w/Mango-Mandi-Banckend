// Who gets which stop (docs/rider-app/README.md): each unassigned stop goes to the
// rider nearest to it, who collects it from the warehouse that makes his trip
// shortest (rider → warehouse → customer).
//
// Where things are: a rider is where the rider app last reported him (within the
// last 3 hours: the app reports while it is open and signed in); a stop is at its
// pincode's centre (addresses are free text, without coordinates); a warehouse is
// where it was set (warehouses.lat/lng). Distances are straight lines (haversine),
// enough to pick between riders across a city, not a road route.
//
// A rider with no recent position is only used when no rider has one; then the
// stop goes to the rider with the fewest stops that day. Stops a rider already
// has are left alone.
import { now } from './clock.js'
import { addEvent } from './orders.js'

/** How old a rider's last position may be and still count. */
export const POSITION_FRESH_MS = 3 * 3_600_000
/** Order states that can still be given to a rider before they go out. */
const ASSIGNABLE = ['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERY_FAILED']

const EARTH_KM = 6371
const rad = (d) => (d * Math.PI) / 180
/** Straight-line distance in km between two { lat, lng }. */
export function km(a, b) {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

const point = (lat, lng) => (lat === null || lat === undefined || lng === null || lng === undefined ? null : { lat: Number(lat), lng: Number(lng) })

/**
 * The choice for one stop (pure, for tests): the nearest rider with a position,
 * else the one with the fewest stops; and the warehouse that makes rider →
 * warehouse → stop shortest (or nearest the stop when the rider's place is unknown).
 * riders: [{ id, pos, stops }]; warehouses: [{ id, pos }]; stop: { pos }.
 */
export function choose(stop, riders, warehouses) {
  if (!riders.length) return null
  const placed = stop.pos ? riders.filter((r) => r.pos) : []
  let rider
  let riderKm = null
  if (placed.length) {
    const ranked = placed.map((r) => ({ r, d: km(r.pos, stop.pos) })).sort((a, b) => a.d - b.d || a.r.stops - b.r.stops)
    rider = ranked[0].r
    riderKm = ranked[0].d
  } else {
    rider = [...riders].sort((a, b) => a.stops - b.stops || a.id.localeCompare(b.id))[0]
  }
  const sites = warehouses.filter((w) => w.pos)
  let warehouse = null
  let tripKm = null
  if (sites.length && stop.pos) {
    const trip = (w) => (rider.pos ? km(rider.pos, w.pos) : 0) + km(w.pos, stop.pos)
    const best = sites.map((w) => ({ w, d: trip(w) })).sort((a, b) => a.d - b.d)[0]
    warehouse = best.w
    tripKm = best.d
  }
  return { rider, riderKm, warehouse, tripKm }
}

/**
 * Gives every unassigned stop on the date (or only orderIds) to its nearest rider,
 * with the pickup warehouse, and notes why on the order's history.
 * Returns [{ orderId, number, riderId, riderName, riderKm, warehouseId, warehouseName, tripKm }].
 */
export async function assignNearest(c, date, actor, { orderIds = null } = {}) {
  const { rows: stops } = await c.query(
    `SELECT o.id, o.number, o.status, p.lat, p.lng FROM orders o LEFT JOIN pincodes p ON p.pincode = o.pincode
      WHERE o.delivery_date = $1 AND o.rider_id IS NULL AND o.status = ANY($2) ${orderIds ? 'AND o.id = ANY($3)' : ''}
      ORDER BY o.slot_id NULLS LAST, o.number FOR UPDATE OF o`,
    orderIds ? [date, ASSIGNABLE, orderIds] : [date, ASSIGNABLE],
  )
  if (!stops.length) return []
  const { rows: riderRows } = await c.query(
    `SELECT u.id, u.display_name, u.email,
            (SELECT COUNT(*)::int FROM orders x WHERE x.rider_id = u.id AND x.delivery_date = $1 AND x.status <> 'CANCELLED') AS stops,
            l.lat, l.lng, l.at
       FROM admin_users u
       LEFT JOIN LATERAL (SELECT lat, lng, at FROM rider_locations WHERE rider_id = u.id ORDER BY at DESC LIMIT 1) l ON TRUE
      WHERE u.role = 'RIDER' ORDER BY u.id`,
    [date],
  )
  const fresh = new Date(now().getTime() - POSITION_FRESH_MS)
  const riders = riderRows.map((r) => ({
    id: r.id, name: r.display_name ?? r.email, stops: r.stops, pos: r.at && r.at >= fresh ? point(r.lat, r.lng) : null,
  }))
  const { rows: whRows } = await c.query('SELECT id, name, lat, lng FROM warehouses WHERE active ORDER BY id')
  const warehouses = whRows.map((w) => ({ id: w.id, name: w.name, pos: point(w.lat, w.lng) }))
  const out = []
  for (const s of stops) {
    const pick = choose({ pos: point(s.lat, s.lng) }, riders, warehouses)
    if (!pick) break
    await c.query('UPDATE orders SET rider_id = $2, pickup_warehouse_id = COALESCE($3, pickup_warehouse_id) WHERE id = $1', [s.id, pick.rider.id, pick.warehouse?.id ?? null])
    pick.rider.stops++
    const why = pick.riderKm === null ? `${pick.rider.name} (no rider's position known: fewest stops)` : `${pick.rider.name}, ${pick.riderKm.toFixed(1)} km away`
    await addEvent(c, s.id, s.status, s.status, actor, `Given to the nearest rider: ${why}${pick.warehouse ? `; pick up at ${pick.warehouse.name}` : ''}`)
    out.push({
      orderId: s.id, number: s.number, riderId: pick.rider.id, riderName: pick.rider.name,
      riderKm: pick.riderKm === null ? null : Math.round(pick.riderKm * 10) / 10,
      warehouseId: pick.warehouse?.id ?? null, warehouseName: pick.warehouse?.name ?? null,
      tripKm: pick.tripKm === null ? null : Math.round(pick.tripKm * 10) / 10,
    })
  }
  return out
}
