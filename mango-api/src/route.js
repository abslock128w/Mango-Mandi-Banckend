// The order a rider's stops run in, shared by the manifest (the rider's list)
// and live tracking (how many stops before yours), so the two always agree.
// There is no GPS: "N stops away" is counted along this order, over the stops
// the rider still has out for delivery. docs/app-feel.md.
import { getConfig } from './config.js'

/** Slots in order, then zone and pincode, then order number. Needs orders o, delivery_slots s and pincodes p. */
export const ROUTE_ORDER = 's.sort NULLS LAST, s.starts_at NULLS LAST, p.zone NULLS LAST, o.pincode, o.number'

/**
 * Stops before this order on its rider's run: the rider's other orders still
 * out for delivery that day, earlier in route order. Orders to the same address
 * count once, and orders to this order's own address not at all. Only a count
 * leaves here, never which orders or where.
 * Returns null when the order is not out for delivery with a rider.
 */
export async function stopsAhead(c, order) {
  if (order.status !== 'OUT_FOR_DELIVERY' || !order.rider_id) return null
  const { rows } = await c.query(
    `WITH run AS (
       SELECT o.id, o.pincode || '|' || lower(regexp_replace(btrim(o.delivery_address), '\\s+', ' ', 'g')) AS place,
              row_number() OVER (ORDER BY ${ROUTE_ORDER}) AS n
         FROM orders o LEFT JOIN delivery_slots s ON s.id = o.slot_id LEFT JOIN pincodes p ON p.pincode = o.pincode
        WHERE o.rider_id = $1 AND o.delivery_date = $2 AND o.status = 'OUT_FOR_DELIVERY'
     )
     SELECT COUNT(DISTINCT r.place)::int AS ahead
       FROM run me JOIN run r ON r.n < me.n AND r.place <> me.place
      WHERE me.id = $3`,
    [order.rider_id, order.delivery_date, order.id],
  )
  return rows[0]?.ahead ?? 0
}

/**
 * What the shop's order page shows while the rider is out: stops before yours
 * and a rough time (minutes per stop, a selling rule), for yours included.
 */
export async function trackingFor(c, order) {
  const ahead = await stopsAhead(c, order)
  if (ahead == null) return null
  const minutesPerStop = getConfig().minutesPerStop
  return { stopsAway: ahead, minutesPerStop, etaMinutes: (ahead + 1) * minutesPerStop }
}
