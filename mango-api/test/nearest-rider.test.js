// Nearest-rider assignment (docs/qa/nearest-rider.md): property-style runs with seeded
// random riders and addresses around Bengaluru against the real API and database, and
// each edge case from the brief. The oracle below restates the rule on its own, so a
// change in nearest.js that drifts from the documented rule fails here.
import { adminToken, checkout, client, closeAll, customerToken, makeBatch, resetDb, startServer, T0 } from './helpers.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { now, setNow } from '../src/clock.js'
import { query, tx } from '../src/db.js'
import { newId } from '../src/ids.js'
import { assignNearest, km, POSITION_FRESH_MS } from '../src/nearest.js'

let srv
let api
let admin
/** The date every order in a describe block is delivered on (checkout's earliest). */
let date
let slots

before(async () => {
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  await srv.close()
  await closeAll()
})

// ---------------------------------------------------------------- helpers

/** mulberry32: a small seeded PRNG, so a failing run can be replayed by its seed. */
function rng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { next, int: (n) => Math.floor(next() * n), pick: (xs) => xs[Math.floor(next() * xs.length)], chance: (p) => next() < p }
}

/** Somewhere in greater Bengaluru (about 12.80–13.15 N, 77.45–77.80 E). */
const bengaluru = (r) => ({ lat: Math.round((12.8 + r.next() * 0.35) * 1e6) / 1e6, lng: Math.round((77.45 + r.next() * 0.35) * 1e6) / 1e6 })

const PINS = ['560001', '560008', '560034', '560038', '560066', '560076', '560095', '560102']

let riderSeq = 0
/** A rider account straight into the table (no sign-in needed to be a candidate). */
async function makeRider(name = `Rider ${++riderSeq}`) {
  const id = newId('adm')
  await query("INSERT INTO admin_users (id, email, password_hash, role, display_name) VALUES ($1, $2, 'x', 'RIDER', $3)", [id, `${id}@mandimangoes.test`, name])
  return { id, name }
}

/** A position row for a rider, `ageMs` before now (server time, as the location route stores it). */
async function placeRider(riderId, pos, ageMs = 0, accuracy = null) {
  await query('INSERT INTO rider_locations (id, rider_id, lat, lng, accuracy, at) VALUES ($1, $2, $3, $4, $5, $6)', [
    newId('loc'), riderId, pos.lat, pos.lng, accuracy, new Date(now().getTime() - ageMs),
  ])
}

/** A paid order (CONFIRMED: assignable) for a customer at `pincode`, on the earliest delivery date unless given. */
async function makeOrder({ pincode = '560034', slotId, deliveryDate } = {}) {
  const cust = await customerToken(api)
  const o = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }], { pincode, slotId, deliveryDate })
  assert.equal(o.status, 201, JSON.stringify(o.body))
  const pay = await api.post('/v1/dev/pay', { orderId: o.body.orderId, outcome: 'captured' })
  assert.equal(pay.status, 200, JSON.stringify(pay.body))
  return { id: o.body.orderId, number: o.body.number, date: o.body.deliveryDate, pincode }
}

/** The demo data's second warehouse (not seeded in tests), placed as in the seed. */
const secondWarehouse = () => query("INSERT INTO warehouses (id, name, lat, lng) VALUES ('wh_south', 'Electronic City hub', 12.8452, 77.6602) ON CONFLICT (id) DO NOTHING")

const autoAssign = (body) => api.post('/admin/v1/manifest/auto-assign', body, { token: admin })
const manualAssign = (body) => api.post('/admin/v1/manifest/assign', body, { token: admin })

async function orderRow(id) {
  const { rows } = await query('SELECT id, number, status, rider_id, pickup_warehouse_id, slot_id, pincode FROM orders WHERE id = $1', [id])
  return rows[0]
}
async function lastReason(id) {
  const { rows } = await query("SELECT reason FROM order_events WHERE order_id = $1 AND reason LIKE 'Given to the nearest rider%' ORDER BY created_at DESC, ctid DESC LIMIT 1", [id])
  return rows[0]?.reason ?? null
}

/**
 * The oracle: the documented rule, restated from the database as it stands, for the
 * unassigned stops of `date` in the order the API handles them. Returns a map
 * orderId → { riderId, warehouseId, riderKm, fallback }.
 */
async function expectedAssignment(date, orderIds = null) {
  const fresh = now().getTime() - POSITION_FRESH_MS
  const { rows: riderRows } = await query(
    `SELECT u.id, l.lat, l.lng, l.at,
            (SELECT COUNT(*)::int FROM orders x WHERE x.rider_id = u.id AND x.delivery_date = $1 AND x.status <> 'CANCELLED') AS stops
       FROM admin_users u
       LEFT JOIN LATERAL (SELECT lat, lng, at FROM rider_locations WHERE rider_id = u.id ORDER BY at DESC LIMIT 1) l ON TRUE
      WHERE u.role = 'RIDER'`,
    [date],
  )
  const riders = riderRows.map((r) => ({
    id: r.id, stops: r.stops, pos: r.at && r.at.getTime() >= fresh ? { lat: Number(r.lat), lng: Number(r.lng) } : null,
  }))
  const { rows: whRows } = await query('SELECT id, lat, lng FROM warehouses WHERE active AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY id')
  const warehouses = whRows.map((w) => ({ id: w.id, pos: { lat: Number(w.lat), lng: Number(w.lng) } }))
  const { rows: stops } = await query(
    `SELECT o.id, o.pickup_warehouse_id, p.lat, p.lng FROM orders o LEFT JOIN pincodes p ON p.pincode = o.pincode
      WHERE o.delivery_date = $1 AND o.rider_id IS NULL ${orderIds ? 'AND o.id = ANY($2)' : ''}
        AND o.status IN ('CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED')
      ORDER BY o.slot_id NULLS LAST, o.number`,
    orderIds ? [date, orderIds] : [date],
  )
  const out = new Map()
  for (const s of stops) {
    if (!riders.length) break
    const stopPos = s.lat === null || s.lng === null ? null : { lat: Number(s.lat), lng: Number(s.lng) }
    const byLoad = (a, b) => a.stops - b.stops || (a.id < b.id ? -1 : 1)
    let rider
    let riderKm = null
    const placed = stopPos ? riders.filter((r) => r.pos) : []
    if (placed.length) {
      let best = null
      for (const r of placed) {
        const d = km(r.pos, stopPos)
        if (!best || d < best.d || (d === best.d && byLoad(r, best.r) < 0)) best = { r, d }
      }
      rider = best.r
      riderKm = best.d
    } else rider = [...riders].sort(byLoad)[0]
    let warehouseId = s.pickup_warehouse_id
    if (stopPos && warehouses.length) {
      let best = null
      for (const w of warehouses) {
        const d = (rider.pos ? km(rider.pos, w.pos) : 0) + km(w.pos, stopPos)
        if (!best || d < best.d) best = { w, d }
      }
      warehouseId = best.w.id
    }
    rider.stops++
    out.set(s.id, { riderId: rider.id, warehouseId, riderKm, fallback: riderKm === null, stopPlaced: Boolean(stopPos) })
  }
  return out
}

/** Asserts the API's answer and the rows match the oracle for every stop it handled. */
async function assertMatchesRule(expected, assigned, label) {
  assert.equal(assigned.length, expected.size, `${label}: ${assigned.length} assigned, oracle expected ${expected.size}`)
  for (const a of assigned) {
    const e = expected.get(a.orderId)
    assert.ok(e, `${label}: ${a.number} was assigned but the rule has no stop by that id`)
    assert.equal(a.riderId, e.riderId, `${label}: ${a.number} went to ${a.riderId}, the rule says ${e.riderId}`)
    assert.equal(a.warehouseId, e.warehouseId === undefined ? null : e.warehouseId, `${label}: ${a.number} warehouse`)
    if (e.riderKm === null) assert.equal(a.riderKm, null, `${label}: ${a.number} km should be unknown`)
    else assert.ok(Math.abs(a.riderKm - e.riderKm) <= 0.051, `${label}: ${a.number} km ${a.riderKm} vs ${e.riderKm}`)
    const row = await orderRow(a.orderId)
    assert.equal(row.rider_id, e.riderId, `${label}: ${a.number} row rider`)
    assert.equal(row.pickup_warehouse_id, e.warehouseId ?? null, `${label}: ${a.number} row warehouse`)
    const reason = await lastReason(a.orderId)
    assert.match(reason, /^Given to the nearest rider: /, `${label}: ${a.number} history`)
    if (e.fallback) assert.match(reason, e.stopPlaced ? /no rider's position known: fewest stops/ : /stop's place unknown|position unknown|fewest stops/, `${label}: ${a.number} history reason`)
    else assert.match(reason, /\d+\.\d km away/, `${label}: ${a.number} history km`)
  }
}

// ---------------------------------------------------------------- property runs

describe('nearest rider: seeded random riders and addresses', () => {
  let orders
  let riders
  before(async () => {
    await resetDb()
    admin = await adminToken(api)
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 200 } })
    slots = (await query('SELECT id FROM delivery_slots ORDER BY sort')).rows.map((s) => s.id)
    await secondWarehouse()
    orders = []
    for (let i = 0; i < 12; i++) orders.push(await makeOrder({ pincode: PINS[i % PINS.length], slotId: slots[i % 2] }))
    date = orders[0].date
    assert.ok(orders.every((o) => o.date === date))
    riders = []
    for (let i = 0; i < 20; i++) riders.push(await makeRider())
  })

  /** One run: random riders on duty, positions (fresh, stale or none), warehouses, stop places and prior stops. */
  async function runSeed(seed) {
    const r = rng(seed)
    setNow(T0)
    await query('DELETE FROM rider_locations')
    await query("DELETE FROM order_events WHERE reason LIKE 'Given to the nearest rider%'")
    await query('UPDATE orders SET rider_id = NULL, pickup_warehouse_id = NULL WHERE delivery_date = $1', [date])
    const onDuty = riders.slice(0, 1 + r.int(20))
    await query("UPDATE admin_users SET role = CASE WHEN id = ANY($1) THEN 'RIDER' ELSE 'OPERATOR' END WHERE id = ANY($2)", [onDuty.map((x) => x.id), riders.map((x) => x.id)])
    for (const rd of onDuty) {
      const kind = r.next()
      if (kind < 0.15) continue // never reported
      if (kind < 0.3) await placeRider(rd.id, bengaluru(r), POSITION_FRESH_MS + 60_000 + r.int(86_400_000)) // hours old
      else {
        // A few rows, the last one fresh (or exactly on the edge); some clustered on one spot to force near-ties.
        const spot = r.chance(0.3) ? { lat: 12.9279 + 0.001 * r.int(3), lng: 77.6271 + 0.001 * r.int(3) } : bengaluru(r)
        await placeRider(rd.id, bengaluru(r), 7_200_000)
        await placeRider(rd.id, spot, r.chance(0.1) ? POSITION_FRESH_MS - 30_000 : r.int(3_600_000), r.chance(0.2) ? 5000 : 20)
      }
    }
    for (const pin of PINS) {
      const pos = bengaluru(r)
      await query('UPDATE pincodes SET lat = $2, lng = $3 WHERE pincode = $1', [pin, r.chance(0.05) ? null : pos.lat, r.chance(0.05) ? null : pos.lng])
    }
    await query('UPDATE warehouses SET active = $2, lat = $3, lng = $4 WHERE id = $1', ['wh_south', r.chance(0.7), ...Object.values(bengaluru(r))])
    await query('UPDATE warehouses SET lat = $2, lng = $3 WHERE id = $1', ['wh_main', ...(r.chance(0.1) ? [null, null] : Object.values(bengaluru(r)))])
    // Some stops already given out by hand (they count as the rider's load and must not move).
    const manual = new Map()
    for (const o of orders) if (r.chance(0.3)) manual.set(o.id, r.pick(onDuty).id)
    for (const [id, riderId] of manual) await query('UPDATE orders SET rider_id = $2 WHERE id = $1', [id, riderId])
    const onlySome = r.chance(0.3) ? orders.filter(() => r.chance(0.5)).map((o) => o.id) : null
    const expected = await expectedAssignment(date, onlySome)
    const res = await autoAssign(onlySome?.length ? { date, orderIds: onlySome } : { date })
    assert.equal(res.status, 200, `seed ${seed}: ${JSON.stringify(res.body)}`)
    await assertMatchesRule(expected, res.body.assigned, `seed ${seed}`)
    for (const [id, riderId] of manual) assert.equal((await orderRow(id)).rider_id, riderId, `seed ${seed}: a manual assignment moved`)
    // Running it again changes nothing: every stop in scope has a rider now.
    const again = await autoAssign(onlySome?.length ? { date, orderIds: onlySome } : { date })
    assert.deepEqual(again.body.assigned, [], `seed ${seed}: second run reassigned`)
    return res.body.assigned
  }

  test('property: the chosen rider is the nearest by the rule, 300 seeded runs', async () => {
    let assignedTotal = 0
    let fallbackRuns = 0
    for (let seed = 1; seed <= 300; seed++) {
      const assigned = await runSeed(seed)
      assignedTotal += assigned.length
      if (assigned.some((a) => a.riderKm === null)) fallbackRuns++
    }
    assert.ok(assignedTotal > 1500, `only ${assignedTotal} assignments across the runs`)
    assert.ok(fallbackRuns > 10, `only ${fallbackRuns} runs exercised the fewest-stops fallback`)
  })

  test('20 riders: the nearest of twenty wins, whatever the order they were added in', async () => {
    setNow(T0)
    await query('DELETE FROM rider_locations')
    await query('UPDATE orders SET rider_id = NULL, pickup_warehouse_id = NULL WHERE delivery_date = $1', [date])
    await query("UPDATE admin_users SET role = 'RIDER' WHERE id = ANY($1)", [riders.map((x) => x.id)])
    await query('UPDATE pincodes SET lat = 12.9279, lng = 77.6271 WHERE pincode = $1', ['560034'])
    const r = rng(777)
    const ring = riders.map((rd, i) => ({ rd, pos: { lat: 12.9279 + 0.03 * Math.cos((i / 20) * 2 * Math.PI), lng: 77.6271 + 0.03 * Math.sin((i / 20) * 2 * Math.PI) } }))
    const winner = ring[r.int(20)]
    winner.pos = { lat: 12.9279 + 0.004, lng: 77.6271 }
    for (const { rd, pos } of ring) await placeRider(rd.id, pos)
    const one = orders.find((o) => o.pincode === '560034')
    const res = await autoAssign({ date, orderIds: [one.id] })
    assert.equal(res.body.assigned[0].riderId, winner.rd.id)
    assert.ok(res.body.assigned[0].riderKm < 0.5)
  })
})

// ---------------------------------------------------------------- edge cases

describe('nearest rider: edge cases', () => {
  const KORAMANGALA = { lat: 12.9279, lng: 77.6271 }
  let order
  beforeEach(async () => {
    await resetDb()
    admin = await adminToken(api)
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 100 } })
    slots = (await query('SELECT id FROM delivery_slots ORDER BY sort')).rows.map((s) => s.id)
    await secondWarehouse()
    await query('UPDATE pincodes SET lat = 12.9279, lng = 77.6271 WHERE pincode = $1', ['560034'])
    order = await makeOrder({ pincode: '560034', slotId: slots[0] })
    date = order.date
  })

  test('one rider gets every stop, with or without a position', async () => {
    const solo = await makeRider('Solo')
    const second = await makeOrder({ pincode: '560066' })
    const res = await autoAssign({ date })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.assigned.map((a) => [a.orderId, a.riderId, a.riderKm]).sort(), [[order.id, solo.id, null], [second.id, solo.id, null]].sort())
    assert.match(await lastReason(order.id), /no rider's position known: fewest stops/)
    // Now with a position: the same rider, with a distance.
    await query('UPDATE orders SET rider_id = NULL WHERE delivery_date = $1', [date])
    await placeRider(solo.id, { lat: 12.95, lng: 77.6271 })
    const again = await autoAssign({ date })
    assert.ok(again.body.assigned.every((a) => a.riderId === solo.id && a.riderKm > 0))
  })

  test('no riders at all: nothing is assigned and the answer says so', async () => {
    const res = await autoAssign({ date })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.assigned, [])
    assert.equal(res.body.riders, 0, 'the panel needs to tell "no riders" from "nothing left to assign"')
    const solo = await makeRider('Solo')
    await manualAssign({ date, orderIds: [order.id], riderId: solo.id })
    const done = await autoAssign({ date })
    assert.deepEqual(done.body.assigned, [])
    assert.equal(done.body.riders, 1)
  })

  test('an exact tie goes to the rider with fewer stops, then the lower id', async () => {
    const a = await makeRider('A')
    const b = await makeRider('B')
    // Same latitude, same longitude offset east and west: the same haversine distance exactly.
    await placeRider(a.id, { lat: KORAMANGALA.lat, lng: KORAMANGALA.lng + 0.01 })
    await placeRider(b.id, { lat: KORAMANGALA.lat, lng: KORAMANGALA.lng - 0.01 })
    assert.equal(km({ lat: KORAMANGALA.lat, lng: KORAMANGALA.lng + 0.01 }, KORAMANGALA), km({ lat: KORAMANGALA.lat, lng: KORAMANGALA.lng - 0.01 }, KORAMANGALA))
    const lower = a.id < b.id ? a : b
    const higher = lower === a ? b : a
    const res = await autoAssign({ date })
    assert.equal(res.body.assigned[0].riderId, lower.id, 'tie with equal load: the lower id')
    // Give the lower-id rider a stop elsewhere today: the tie now goes to the other.
    await query('UPDATE orders SET rider_id = NULL WHERE delivery_date = $1', [date])
    const other = await makeOrder({ pincode: '560066' })
    await manualAssign({ date, orderIds: [other.id], riderId: lower.id })
    const res2 = await autoAssign({ date, orderIds: [order.id] })
    assert.equal(res2.body.assigned[0].riderId, higher.id, 'tie: fewer stops wins')
  })

  test('a rider with no position is skipped while another has one, and used when none has', async () => {
    const placed = await makeRider('Placed')
    const unknown = await makeRider('Unknown')
    await placeRider(placed.id, { lat: 13.1, lng: 77.75 }) // the far side of the city
    // Give the placed rider six stops already: still his, by the rule.
    for (let i = 0; i < 6; i++) await manualAssign({ date, orderIds: [(await makeOrder({ pincode: '560066' })).id], riderId: placed.id })
    const res = await autoAssign({ date, orderIds: [order.id] })
    assert.equal(res.body.assigned[0].riderId, placed.id)
    assert.ok(res.body.assigned[0].riderKm > 15)
    // Nobody placed: the rider with fewer stops (Unknown, 0 against 7).
    await query('DELETE FROM rider_locations')
    await query('UPDATE orders SET rider_id = NULL WHERE id = $1', [order.id])
    const res2 = await autoAssign({ date, orderIds: [order.id] })
    assert.equal(res2.body.assigned[0].riderId, unknown.id)
    assert.equal(res2.body.assigned[0].riderKm, null)
  })

  test('a position older than 3 hours does not count; one just inside the window does', async () => {
    const near = await makeRider('Near')
    const far = await makeRider('Far')
    await placeRider(near.id, { lat: 12.93, lng: 77.6271 }, POSITION_FRESH_MS + 1000)
    await placeRider(far.id, { lat: 13.1, lng: 77.75 }, 60_000)
    const res = await autoAssign({ date, orderIds: [order.id] })
    assert.equal(res.body.assigned[0].riderId, far.id, 'a stale position is as good as none')
    await query('UPDATE orders SET rider_id = NULL WHERE id = $1', [order.id])
    await query('DELETE FROM rider_locations WHERE rider_id = $1', [near.id])
    await placeRider(near.id, { lat: 12.93, lng: 77.6271 }, POSITION_FRESH_MS - 60_000)
    const res2 = await autoAssign({ date, orderIds: [order.id] })
    assert.equal(res2.body.assigned[0].riderId, near.id, '2h59 old still counts')
    // Only the latest row counts: a fresh far position after a stale near one is where he is.
    await query('UPDATE orders SET rider_id = NULL WHERE id = $1', [order.id])
    await placeRider(near.id, { lat: 13.14, lng: 77.78 }, 0)
    const res3 = await autoAssign({ date, orderIds: [order.id] })
    assert.equal(res3.body.assigned[0].riderId, far.id)
  })

  test('the location route stores at most one position per 20 seconds and the newest wins', async () => {
    const add = await api.post('/admin/v1/staff', { email: 'live@mandimangoes.test', role: 'RIDER', password: 'long-enough-1' }, { token: admin })
    assert.equal(add.status, 201)
    const tok = await adminToken(api, 'live@mandimangoes.test', 'long-enough-1')
    const far = await makeRider('Far')
    await placeRider(far.id, { lat: 13.1, lng: 77.75 })
    assert.equal((await api.post('/admin/v1/rider/location', { lat: 12.93, lng: 77.6271, accuracy: 12 }, { token: tok })).body.stored, true)
    // Nineteen seconds later, moved to the far side of town: dropped, so he still counts as near.
    setNow(new Date(now().getTime() + 19_000).toISOString())
    assert.equal((await api.post('/admin/v1/rider/location', { lat: 13.14, lng: 77.78 }, { token: tok })).body.stored, false)
    const res = await autoAssign({ date, orderIds: [order.id] })
    assert.equal(res.body.assigned[0].riderId, add.body.id)
    assert.ok(res.body.assigned[0].riderKm < 1)
  })

  test("a rider's stops on another day or slot do not matter; only the date asked for is assigned", async () => {
    const a = await makeRider('A')
    const b = await makeRider('B')
    // No positions: the fewest-stops rule. A has stops tomorrow, B has one today in the other slot.
    const tomorrow = await makeOrder({ pincode: '560066', deliveryDate: '2026-10-17' })
    await manualAssign({ date: '2026-10-17', orderIds: [tomorrow.id], riderId: a.id })
    const evening = await makeOrder({ pincode: '560066', slotId: slots[1] })
    await manualAssign({ date, orderIds: [evening.id], riderId: b.id })
    const res = await autoAssign({ date, orderIds: [order.id] })
    assert.equal(res.body.assigned[0].riderId, a.id, "tomorrow's stops are not today's load; today's other slot is")
    assert.equal((await orderRow(tomorrow.id)).rider_id, a.id)
    // Asking for today never touches tomorrow's unassigned stops, even by id.
    await query('UPDATE orders SET rider_id = NULL WHERE id = $1', [tomorrow.id])
    const res2 = await autoAssign({ date, orderIds: [tomorrow.id] })
    assert.deepEqual(res2.body.assigned, [])
    assert.equal((await orderRow(tomorrow.id)).rider_id, null)
  })

  test('a signed-out or revoked rider is still a candidate while his position is fresh (rule as documented, Q2)', async () => {
    const add = await api.post('/admin/v1/staff', { email: 'gone@mandimangoes.test', role: 'RIDER', password: 'long-enough-1' }, { token: admin })
    const gone = add.body.id
    const far = await makeRider('Far')
    await placeRider(gone, { lat: 12.93, lng: 77.6271 })
    await placeRider(far.id, { lat: 13.1, lng: 77.75 })
    // A phone bound to the account, then revoked by a manager.
    await query("INSERT INTO rider_devices (id, rider_id, device_id, created_at) VALUES ($1, $2, 'device-aaaaaaaa', $3)", [newId('dev'), gone, now()])
    await query('UPDATE rider_devices SET revoked_at = $2, revoked_by = $3 WHERE rider_id = $1', [gone, now(), 'signed out'])
    const res = await autoAssign({ date, orderIds: [order.id] })
    assert.equal(res.body.assigned[0].riderId, gone)
    // A rider who is no longer a rider (role changed) is not a candidate, and a deleted one frees his stops.
    await query("UPDATE admin_users SET role = 'OPERATOR' WHERE id = $1", [gone])
    await query('UPDATE orders SET rider_id = NULL WHERE id = $1', [order.id])
    const res2 = await autoAssign({ date, orderIds: [order.id] })
    assert.equal(res2.body.assigned[0].riderId, far.id)
  })

  test('the rider next to the customer wins over the rider at the warehouse (rule as documented, Q1)', async () => {
    await query("UPDATE warehouses SET lat = 13.0285, lng = 77.5409 WHERE id = 'wh_main'")
    await query("UPDATE warehouses SET active = FALSE WHERE id <> 'wh_main'")
    const atWarehouse = await makeRider('At warehouse')
    const atDoor = await makeRider('At door')
    await placeRider(atWarehouse.id, { lat: 13.0285, lng: 77.5409 })
    await placeRider(atDoor.id, { lat: 12.9285, lng: 77.6275 })
    const res = await autoAssign({ date, orderIds: [order.id] })
    const a = res.body.assigned[0]
    assert.equal(a.riderId, atDoor.id)
    assert.equal(a.warehouseId, 'wh_main')
    // His trip (door → warehouse → door) is about twice the other rider's (warehouse → door).
    assert.ok(a.tripKm > 25 && a.tripKm < 30, String(a.tripKm))
  })

  test('the pickup warehouse is the one that makes rider → warehouse → stop shortest, and is kept when none is placed', async () => {
    await query("UPDATE warehouses SET lat = 13.0285, lng = 77.5409 WHERE id = 'wh_main'")
    await query("UPDATE warehouses SET lat = 12.8452, lng = 77.6602 WHERE id = 'wh_south'")
    const north = await makeRider('North')
    await placeRider(north.id, { lat: 13.02, lng: 77.55 }) // next to the north warehouse, stop in the south
    const res = await autoAssign({ date, orderIds: [order.id] })
    assert.equal(res.body.assigned[0].warehouseId, 'wh_main', 'the north warehouse is on his way')
    // An inactive warehouse, or one without a place, is never picked; with none, the stop keeps its old pickup.
    await query('UPDATE orders SET rider_id = NULL WHERE id = $1', [order.id])
    await query("UPDATE warehouses SET active = FALSE WHERE id = 'wh_main'")
    assert.equal((await autoAssign({ date, orderIds: [order.id] })).body.assigned[0].warehouseId, 'wh_south')
    await query('UPDATE orders SET rider_id = NULL WHERE id = $1', [order.id])
    await query('UPDATE warehouses SET lat = NULL, lng = NULL')
    const none = await autoAssign({ date, orderIds: [order.id] })
    assert.equal(none.body.assigned[0].warehouseId, null)
    assert.equal((await orderRow(order.id)).pickup_warehouse_id, 'wh_south', 'the earlier pickup is kept')
    assert.doesNotMatch(await lastReason(order.id), /pick up at/)
  })

  test('a position from before IST midnight still counts after it', async () => {
    const near = await makeRider('Near')
    const far = await makeRider('Far')
    setNow('2026-10-15T18:20:00Z') // 23:50 IST on the 15th
    await placeRider(near.id, { lat: 12.93, lng: 77.6271 })
    setNow('2026-10-15T18:40:00Z') // 00:10 IST on the 16th, the delivery date
    await placeRider(far.id, { lat: 13.1, lng: 77.75 })
    const res = await autoAssign({ date, orderIds: [order.id] })
    assert.equal(res.body.assigned[0].riderId, near.id)
    // And at 01:30 IST a 02:00-old position is fine, a 3:01-old one is not.
    await query('UPDATE orders SET rider_id = NULL WHERE id = $1', [order.id])
    setNow('2026-10-15T21:21:00Z')
    const res2 = await autoAssign({ date, orderIds: [order.id] })
    assert.equal(res2.body.assigned[0].riderId, far.id, 'the position from 23:50 is now 3h31 old')
  })

  test('a stop 140 km away still goes to its nearest rider; a pincode without coordinates goes to the least-loaded rider and says so', async () => {
    await query("INSERT INTO pincodes (pincode, city, zone, active, lat, lng) VALUES ('571401', 'Mandya', 'Outside', TRUE, 12.5218, 76.8951)")
    await query("INSERT INTO pincodes (pincode, city, zone, active) VALUES ('560300', 'Bengaluru', 'New', TRUE)")
    const mandya = await makeOrder({ pincode: '571401' })
    const nowhere = await makeOrder({ pincode: '560300' })
    const west = await makeRider('West')
    const east = await makeRider('East')
    await placeRider(west.id, { lat: 12.9, lng: 77.5 })
    await placeRider(east.id, { lat: 12.9, lng: 77.7 })
    const res = await autoAssign({ date, orderIds: [mandya.id, nowhere.id] })
    const byId = Object.fromEntries(res.body.assigned.map((a) => [a.orderId, a]))
    assert.equal(byId[mandya.id].riderId, west.id)
    assert.ok(byId[mandya.id].riderKm > 60 && byId[mandya.id].riderKm < 90, String(byId[mandya.id].riderKm))
    // Nobody knows where 560300 is: the rider with fewer stops (East, 0 against West's 1), with the right reason.
    assert.equal(byId[nowhere.id].riderId, east.id)
    assert.equal(byId[nowhere.id].riderKm, null)
    assert.equal(byId[nowhere.id].warehouseId, null)
    const reason = await lastReason(nowhere.id)
    assert.doesNotMatch(reason, /no rider's position known/, `the riders are placed; it is the stop that is not: ${reason}`)
    assert.match(reason, /560300/, `the history should say the pincode has no place: ${reason}`)
  })

  test('a rider already carrying 12 stops still gets the next one if nearest (no load limit, Q3)', async () => {
    const busy = await makeRider('Busy')
    const idle = await makeRider('Idle')
    await placeRider(busy.id, { lat: 12.93, lng: 77.6271 })
    await placeRider(idle.id, { lat: 12.94, lng: 77.6271 })
    for (let i = 0; i < 12; i++) await manualAssign({ date, orderIds: [(await makeOrder({ pincode: '560066' })).id], riderId: busy.id })
    const res = await autoAssign({ date, orderIds: [order.id] })
    assert.equal(res.body.assigned[0].riderId, busy.id)
  })

  test('assigned stops do not move when the nearest rider moves away or a nearer one appears', async () => {
    const a = await makeRider('A')
    await placeRider(a.id, { lat: 12.93, lng: 77.6271 })
    assert.equal((await autoAssign({ date })).body.assigned[0].riderId, a.id)
    const b = await makeRider('B')
    await placeRider(b.id, { lat: 12.928, lng: 77.6271 })
    setNow(new Date(now().getTime() + 600_000).toISOString())
    await placeRider(a.id, { lat: 13.14, lng: 77.78 })
    assert.deepEqual((await autoAssign({ date })).body.assigned, [])
    assert.equal((await orderRow(order.id)).rider_id, a.id)
    // Only clearing it by hand puts it back in the pool.
    await manualAssign({ date, orderIds: [order.id], riderId: null })
    assert.equal((await autoAssign({ date })).body.assigned[0].riderId, b.id)
  })

  test("a manager's assignment is never overwritten, even when auto-assign runs at the same time", async () => {
    const near = await makeRider('Near')
    const chosen = await makeRider('Chosen by hand')
    await placeRider(near.id, { lat: 12.93, lng: 77.6271 })
    await placeRider(chosen.id, { lat: 13.1, lng: 77.75 })
    const stops = []
    for (let i = 0; i < 8; i++) stops.push(await makeOrder({ pincode: '560034' }))
    // Hand out half by hand, then run both at once, twenty times over.
    for (let round = 0; round < 20; round++) {
      await query('UPDATE orders SET rider_id = NULL WHERE delivery_date = $1', [date])
      const mine = stops.filter((_, i) => (i + round) % 2 === 0).map((s) => s.id)
      const [m, a] = await Promise.all([manualAssign({ date, orderIds: mine, riderId: chosen.id }), autoAssign({ date })])
      assert.equal(m.status, 200)
      assert.equal(a.status, 200)
      for (const s of stops) {
        const row = await orderRow(s.id)
        assert.equal(row.rider_id, mine.includes(s.id) ? chosen.id : near.id, `round ${round}: ${s.number}`)
      }
    }
  })

  test('two auto-assigns at once give nothing twice and spread the fewest-stops fallback', async () => {
    const a = await makeRider('A')
    const b = await makeRider('B')
    const stops = [order]
    for (let i = 0; i < 5; i++) stops.push(await makeOrder({ pincode: '560066' }))
    // The same date twice at once: every stop is given exactly once.
    const [x, y] = await Promise.all([autoAssign({ date }), autoAssign({ date })])
    assert.equal(x.status, 200)
    assert.equal(y.status, 200)
    const all = [...x.body.assigned, ...y.body.assigned]
    assert.equal(all.length, stops.length)
    assert.equal(new Set(all.map((o) => o.orderId)).size, stops.length)
    // No positions: the six stops spread three and three, however many calls hand them out at once
    // (the panel's button and a second manager's, or one per stop): each call must see the others' stops.
    for (let round = 0; round < 8; round++) {
      await query('UPDATE orders SET rider_id = NULL WHERE delivery_date = $1', [date])
      const results = await Promise.all(stops.map((s) => autoAssign({ date, orderIds: [s.id] })))
      assert.ok(results.every((r) => r.status === 200 && r.body.assigned.length === 1))
      const { rows } = await query('SELECT rider_id, COUNT(*)::int AS n FROM orders WHERE delivery_date = $1 GROUP BY rider_id ORDER BY rider_id', [date])
      assert.deepEqual(rows.map((r) => r.n), [3, 3], `round ${round}: the load should be even: ${JSON.stringify(rows)} (${a.id}, ${b.id})`)
    }
  })

  test('a stop out for delivery whose rider was removed can be given to the nearest rider again', async () => {
    const add = await api.post('/admin/v1/staff', { email: 'left@mandimangoes.test', role: 'RIDER', password: 'long-enough-1' }, { token: admin })
    const left = add.body.id
    await api.patch(`/admin/v1/orders/${order.id}/status`, { status: 'PROCESSING' }, { token: admin })
    assert.equal((await api.post(`/admin/v1/orders/${order.id}/allocate`, undefined, { token: admin })).status, 204)
    assert.equal((await api.patch(`/admin/v1/orders/${order.id}/status`, { status: 'PACKED' }, { token: admin })).status, 204)
    const sent = await api.post('/admin/v1/manifest/dispatch', { date, riderId: left }, { token: admin })
    assert.equal(sent.status, 200, JSON.stringify(sent.body))
    assert.equal((await orderRow(order.id)).status, 'OUT_FOR_DELIVERY')
    const del = await api.raw('DELETE', `/admin/v1/staff/${left}`, { token: admin, headers: { 'Content-Type': 'application/json' }, raw: JSON.stringify({ confirmCode: 'manager123' }) })
    assert.ok([204, 200].includes(del.status), JSON.stringify(del.body))
    assert.equal((await orderRow(order.id)).rider_id, null, 'his stops went back to the pool')
    const near = await makeRider('Near')
    await placeRider(near.id, { lat: 12.93, lng: 77.6271 })
    const res = await autoAssign({ date })
    assert.equal(res.body.assigned.length, 1, 'a stop with no rider that is already out still needs one')
    assert.equal(res.body.assigned[0].riderId, near.id)
  })

  test('the manifest for the rider and for staff carries the rider and the pickup warehouse', async () => {
    await query("UPDATE warehouses SET lat = 13.0285, lng = 77.5409 WHERE id = 'wh_main'")
    await query("UPDATE warehouses SET lat = 12.8452, lng = 77.6602, address = 'Phase 1, Electronic City' WHERE id = 'wh_south'")
    const add = await api.post('/admin/v1/staff', { email: 'ravi@mandimangoes.test', role: 'RIDER', password: 'long-enough-1' }, { token: admin })
    await api.patch(`/admin/v1/staff/${add.body.id}`, { displayName: 'Ravi Kumar' }, { token: admin })
    const tok = await adminToken(api, 'ravi@mandimangoes.test', 'long-enough-1')
    assert.equal((await api.post('/admin/v1/rider/location', { lat: 12.93, lng: 77.6271 }, { token: tok })).status, 200)
    const res = await autoAssign({ date })
    assert.deepEqual([res.body.assigned[0].riderName, res.body.assigned[0].warehouseName], ['Ravi Kumar', 'Electronic City hub'])
    const staffView = (await api.get(`/admin/v1/manifest?date=${date}`, { token: admin })).body.runs[0].stops[0].orders[0]
    assert.deepEqual(staffView.rider, { id: add.body.id, email: 'ravi@mandimangoes.test', name: 'Ravi Kumar', firstName: 'Ravi' })
    assert.equal(staffView.pickupWarehouse.name, 'Electronic City hub')
    const riderView = (await api.get(`/admin/v1/manifest?date=${date}`, { token: tok })).body.runs[0].stops[0].orders[0]
    assert.deepEqual(riderView.pickupWarehouse, { id: 'wh_south', name: 'Electronic City hub', address: 'Phase 1, Electronic City', lat: 12.8452, lng: 77.6602 })
    // The panel's rider list names riders, so the picker can show who got the stop.
    const list = (await api.get('/admin/v1/riders', { token: admin })).body
    assert.deepEqual(list, [{ id: add.body.id, email: 'ravi@mandimangoes.test', name: 'Ravi Kumar' }])
  })

  test('direct: assignNearest in a transaction handles an empty date and bad ids quietly', async () => {
    assert.deepEqual(await tx((c) => assignNearest(c, '2026-10-20', { type: 'admin', id: 'x', label: 'x' })), [])
    assert.deepEqual(await tx((c) => assignNearest(c, date, { type: 'admin', id: 'x', label: 'x' }, { orderIds: ['nope'] })), [])
    assert.equal((await autoAssign({ date: 'yesterday' })).status, 400)
    assert.equal((await autoAssign({ date, orderIds: [] })).status, 400)
  })
})
