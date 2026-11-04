// Mango Ops v2 (docs/design/ops-dashboard-v2.md): the control tower's reads (/day, /live,
// /riders/:id/trail, /analytics/ops), the event stream (/events) and who may call them.
import { adminToken, checkout, client, closeAll, customerToken, forceOrderState, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { now } from '../src/clock.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { changesSince, eventsMode, stopEvents } from '../src/events.js'
import { newId } from '../src/ids.js'
import { DISPATCH_LEAD_MINUTES, PACK_LEAD_MINUTES } from '../src/admin/ops-v2.js'

let srv
let api
let admin
const tokens = {}
const DATE = '2026-10-16'

before(async () => {
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  await stopEvents()
  await srv.close()
  await closeAll()
})

async function makeRider(name) {
  const id = newId('adm')
  await query("INSERT INTO admin_users (id, email, password_hash, role, display_name) VALUES ($1, $2, 'x', 'RIDER', $3)", [id, `${id}@mandimangoes.test`, name])
  return id
}

async function makeOrder({ token, pincode = '560034', slotId = 'slt_am', qty = 1 } = {}) {
  const cust = token ?? (await customerToken(api)).accessToken
  const o = await checkout(api, cust, [{ sku: 'ALP-3', stage: 'RIPE', qty }], { pincode, slotId, deliveryDate: DATE })
  assert.equal(o.status, 201, JSON.stringify(o.body))
  const pay = await api.post('/v1/dev/pay', { orderId: o.body.orderId, outcome: 'captured' })
  assert.equal(pay.status, 200, JSON.stringify(pay.body))
  return { id: o.body.orderId, number: o.body.number, token: cust }
}

const istIso = (date, time) => new Date(`${date}T${time}:00+05:30`).toISOString()
const event = (orderId, from, to, at) =>
  query("INSERT INTO order_events (id, order_id, from_status, status, actor, created_at) VALUES ($1, $2, $3, $4, 'test', $5)", [newId('evt'), orderId, from, to, at])

describe('Mango Ops v2 reads', () => {
  let orders
  let riders

  before(async () => {
    await resetDb()
    admin = await adminToken(api)
    tokens.OPERATOR = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    tokens.PACKER = await adminToken(api, 'packer@mandimangoes.test', 'packer123')
    tokens.QC = await adminToken(api, 'qc@mandimangoes.test', 'qc123')
    const r = await api.post('/admin/v1/staff', { email: 'rider@mandimangoes.test', role: 'RIDER', password: 'rider-pass-123' }, { token: admin })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    tokens.RIDER = await adminToken(api, 'rider@mandimangoes.test', 'rider-pass-123')
    await query(
      `INSERT INTO delivery_slots (id, label, starts_at, ends_at, max_boxes, sort) VALUES ('slt_am', 'Morning', '07:00', '11:00', 10, 1), ('slt_pm', 'Evening', '16:00', '20:00', 4, 2)`,
    )
    await query("UPDATE warehouses SET lat = 13.0285, lng = 77.5409, address = 'APMC Yard' WHERE id = 'wh_main'")
    await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 100 } })
    riders = { ravi: await makeRider('Ravi Kumar'), idle: await makeRider('Idle Rider') }
    // Ravi has a trail for the day (and one point the day before, which the trail leaves out).
    for (const [lat, lng, at] of [[12.93, 77.61, istIso(DATE, '08:00')], [12.94, 77.62, istIso(DATE, '08:10')], [12.95, 77.63, istIso('2026-10-15', '23:50')]]) {
      await query('INSERT INTO rider_locations (id, rider_id, lat, lng, accuracy, at) VALUES ($1, $2, $3, $4, 8, $5)', [newId('loc'), riders.ravi, lat, lng, at])
    }
    const first = await makeOrder({ qty: 2 })
    orders = [
      first, // morning, delivered on time by Ravi
      await makeOrder({ token: first.token }), // morning, same customer: waiting
      await makeOrder({ pincode: '560001' }), // morning, delivered late by Ravi
      await makeOrder({ slotId: 'slt_pm', pincode: '560008' }), // evening, packed, no rider
    ]
    await forceOrderState("UPDATE orders SET status = 'DELIVERED', rider_id = $2 WHERE id = ANY($1)", [[orders[0].id, orders[2].id], riders.ravi])
    await forceOrderState("UPDATE orders SET status = 'PACKED' WHERE id = $1", [orders[3].id])
    await event(orders[0].id, 'SHIPPED', 'OUT_FOR_DELIVERY', istIso(DATE, '08:00'))
    await event(orders[0].id, 'OUT_FOR_DELIVERY', 'DELIVERED', istIso(DATE, '08:30'))
    await event(orders[2].id, 'SHIPPED', 'OUT_FOR_DELIVERY', istIso(DATE, '09:00'))
    await event(orders[2].id, 'OUT_FOR_DELIVERY', 'DELIVERED', istIso(DATE, '23:00'))
  })

  test('/day: each slot with its clock in IST and its orders by state', async () => {
    const r = await api.get(`/admin/v1/day?date=${DATE}`, { token: tokens.OPERATOR })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.date, DATE)
    assert.deepEqual(r.body.rules, { packLeadMinutes: PACK_LEAD_MINUTES, dispatchLeadMinutes: DISPATCH_LEAD_MINUTES, orderCutoff: '18:00 the day before' })
    const [am, pm] = r.body.slots
    assert.equal(am.label, 'Morning')
    assert.equal(am.windowStartAt, istIso(DATE, '07:00'))
    assert.equal(am.windowEndAt, istIso(DATE, '11:00'))
    assert.equal(am.packByAt, istIso(DATE, '06:00'))
    assert.equal(am.dispatchByAt, istIso(DATE, '06:45'))
    assert.equal(am.orderCutoffAt, istIso('2026-10-15', '18:00'))
    assert.deepEqual(am.counts, { waiting: 1, packed: 0, out: 0, delivered: 2, failed: 0 })
    assert.equal(am.orders, 3)
    assert.equal(am.boxes, 4)
    assert.equal(am.unassigned, 1)
    assert.equal(am.capacityBoxes, 10)
    assert.deepEqual(pm.counts, { waiting: 0, packed: 1, out: 0, delivered: 0, failed: 0 })
    assert.equal(pm.unassigned, 1)
    assert.equal(r.body.unslotted, null)
    // A day without orders still shows the slots.
    const empty = await api.get('/admin/v1/day?date=2026-10-20', { token: admin })
    assert.equal(empty.body.slots.length, 2)
    assert.equal(empty.body.slots[0].orders, 0)
    assert.equal((await api.get('/admin/v1/day?date=2026-02-30', { token: admin })).status, 400)
  })

  test('/live: every rider (idle ones too) with the last position, stops at their pincode centre, warehouses', async () => {
    const r = await api.get(`/admin/v1/live?date=${DATE}`, { token: tokens.OPERATOR })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const ravi = r.body.riders.find((x) => x.id === riders.ravi)
    assert.equal(ravi.name, 'Ravi Kumar')
    assert.equal(ravi.lat, 12.94)
    assert.equal(ravi.lastAt, istIso(DATE, '08:10'))
    assert.equal(ravi.stopsDone, 2)
    assert.equal(ravi.stopsLeft, 0)
    const idle = r.body.riders.find((x) => x.id === riders.idle)
    assert.deepEqual([idle.lastAt, idle.lat, idle.lng, idle.stopsLeft], [null, null, null, 0])
    assert.equal(r.body.stops.length, 4)
    const stop = r.body.stops.find((s) => s.orderId === orders[2].id)
    assert.equal(stop.pincode, '560001')
    assert.equal(stop.area, 'Central')
    assert.equal(stop.lat, 12.9757)
    assert.equal(stop.riderId, riders.ravi)
    assert.equal(stop.dueAt, istIso(DATE, '11:00'))
    assert.equal(r.body.stops.find((s) => s.orderId === orders[0].id).boxes, 2)
    const wh = r.body.warehouses.find((w) => w.id === 'wh_main')
    assert.deepEqual([wh.lat, wh.lng, wh.address], [13.0285, 77.5409, 'APMC Yard'])
  })

  test('/riders/:id/trail: that IST day only, oldest first; not a rider is 404', async () => {
    const r = await api.get(`/admin/v1/riders/${riders.ravi}/trail?date=${DATE}`, { token: admin })
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.points.map((p) => p.at), [istIso(DATE, '08:00'), istIso(DATE, '08:10')])
    assert.equal(r.body.points[0].accuracy, 8)
    const before = await api.get(`/admin/v1/riders/${riders.ravi}/trail?date=2026-10-15`, { token: admin })
    assert.equal(before.body.points.length, 1)
    const { rows } = await query("SELECT id FROM admin_users WHERE role = 'MANAGER' LIMIT 1")
    assert.equal((await api.get(`/admin/v1/riders/${rows[0].id}/trail?date=${DATE}`, { token: admin })).status, 404)
  })

  test('/analytics/ops: on time, minutes per stop, riders, slot fill, pincodes, varieties, repeat customers', async () => {
    const r = await api.get(`/admin/v1/analytics/ops?from=${DATE}&to=${DATE}`, { token: tokens.OPERATOR })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual(r.body.onTime, { delivered: 2, onTime: 1, rate: 0.5 })
    // 30 minutes and 14 hours: the median of two is their mean.
    assert.deepEqual(r.body.minutesPerStop, { median: 435, stops: 2 })
    const ravi = r.body.riders[0]
    assert.deepEqual([ravi.id, ravi.delivered, ravi.failed, ravi.medianMinutes, ravi.flagged], [riders.ravi, 2, 0, 435, 0])
    const am = r.body.slotFill.find((s) => s.slotId === 'slt_am')
    assert.deepEqual([am.orders, am.boxes, am.days, am.capacityBoxes, am.fill], [3, 4, 1, 10, 0.4])
    assert.equal(r.body.pincodes[0].pincode, '560034')
    assert.deepEqual([r.body.pincodes[0].orders, r.body.pincodes[0].boxes], [2, 3])
    assert.deepEqual(r.body.varieties, [{ variety: 'Alphonso', boxes: 5, orders: 4 }])
    assert.deepEqual(r.body.repeat, { customers: 3, repeatCustomers: 1, rate: 0.333 })
    assert.deepEqual(r.body.daily, [{ date: DATE, orders: 4, delivered: 2, failed: 0 }])
    const backwards = await api.get(`/admin/v1/analytics/ops?from=${DATE}&to=2026-10-01`, { token: admin })
    assert.equal(backwards.status, 400)
    assert.equal(backwards.body.error.code, 'INVALID_DATE')
    const dflt = await api.get('/admin/v1/analytics/ops', { token: admin })
    assert.equal(dflt.status, 200)
    assert.equal(dflt.body.daily.length, 7)
  })

  test('only managers and operators: packers, QC and riders are refused every new route', async () => {
    const paths = ['/day', '/live', `/riders/${riders.ravi}/trail`, '/analytics/ops', '/events']
    for (const role of ['PACKER', 'QC', 'RIDER']) {
      for (const p of paths) assert.equal((await api.get(`/admin/v1${p}`, { token: tokens[role] })).status, 403, `${role} ${p}`)
    }
    for (const p of paths) assert.equal((await api.get(`/admin/v1${p}`)).status, 401, `anonymous ${p}`)
  })

  test('/events: hello, then order steps and rider positions as they commit, heartbeats, bye', async () => {
    const was = { stream: env.EVENTS_STREAM_MS, heartbeat: env.EVENTS_HEARTBEAT_MS }
    env.EVENTS_STREAM_MS = 4_000
    env.EVENTS_HEARTBEAT_MS = 300
    const ac = new AbortController()
    try {
      const res = await fetch(`${srv.base}/admin/v1/events`, { headers: { Authorization: `Bearer ${tokens.OPERATOR}` }, signal: ac.signal })
      assert.equal(res.status, 200)
      assert.match(res.headers.get('content-type'), /text\/event-stream/)
      assert.equal(res.headers.get('cache-control'), 'no-cache, no-transform')
      const reader = res.body.getReader()
      const seen = []
      let buf = ''
      const decoder = new TextDecoder()
      async function until(pred, ms = 5_000) {
        const end = Date.now() + ms
        for (;;) {
          const hit = seen.find(pred)
          if (hit) return hit
          if (Date.now() > end) throw new Error(`no such event; saw ${JSON.stringify(seen.map((e) => e.type))}`)
          const { value, done } = await reader.read()
          if (done) throw new Error('stream ended')
          buf += decoder.decode(value, { stream: true })
          let i
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i)
            buf = buf.slice(i + 2)
            const type = /^event: (.*)$/m.exec(block)?.[1]
            const id = /^id: (.*)$/m.exec(block)?.[1]
            const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null')
            seen.push({ type, id, data })
          }
        }
      }
      const hello = await until((e) => e.type === 'hello')
      assert.equal(hello.id, '1')
      await until((e) => e.type === 'attention.changed' && typeof e.data.count === 'number')
      // The LISTEN connection comes up beside the first stream.
      for (let i = 0; i < 50 && eventsMode() !== 'listening'; i++) await new Promise((r) => setTimeout(r, 100))
      assert.equal(eventsMode(), 'listening')

      const step = await api.patch(`/admin/v1/orders/${orders[1].id}/status`, { status: 'PROCESSING' }, { token: tokens.OPERATOR })
      assert.equal(step.status < 300, true, JSON.stringify(step.body))
      const changed = await until((e) => e.type === 'order.changed' && e.data.id === orders[1].id)
      assert.deepEqual(changed.data, { id: orders[1].id, number: orders[1].number, status: 'PROCESSING', date: DATE })

      const spot = await api.post('/admin/v1/rider/location', { lat: 12.97, lng: 77.6 }, { token: tokens.RIDER })
      assert.equal(spot.body.stored, true)
      const moved = await until((e) => e.type === 'rider.position')
      const { rows } = await query("SELECT id FROM admin_users WHERE email = 'rider@mandimangoes.test'")
      assert.equal(moved.data.riderId, rows[0].id)
      assert.ok(new Date(moved.data.at) <= now())

      await until((e) => e.type === 'heartbeat')
      await until((e) => e.type === 'bye', 10_000)
      const ids = seen.map((e) => Number(e.id))
      assert.deepEqual(ids, ids.map((_, i) => i + 1), 'ids count up from 1')
    } finally {
      ac.abort()
      env.EVENTS_STREAM_MS = was.stream
      env.EVENTS_HEARTBEAT_MS = was.heartbeat
    }
  })

  test('/events: a rolled-back step sends nothing', async () => {
    const was = env.EVENTS_STREAM_MS
    env.EVENTS_STREAM_MS = 2_500
    try {
      const res = await fetch(`${srv.base}/admin/v1/events`, { headers: { Authorization: `Bearer ${admin}` } })
      const text = res.text()
      for (let i = 0; i < 50 && eventsMode() !== 'listening'; i++) await new Promise((r) => setTimeout(r, 100))
      // An order step that fails (an order the operator cannot move backwards) rolls back with its notify.
      const bad = await api.patch(`/admin/v1/orders/${orders[0].id}/status`, { status: 'CONFIRMED' }, { token: tokens.OPERATOR })
      assert.ok(bad.status >= 400)
      const body = await text
      assert.doesNotMatch(body, new RegExp(orders[0].id))
      assert.match(body, /event: bye/)
    } finally {
      env.EVENTS_STREAM_MS = was
    }
  })

  test('without LISTEN, a stream polls: what changed after its cursor, newest step per order, then positions', async () => {
    const since = new Date(now().getTime() - 1)
    const moved = await api.patch(`/admin/v1/orders/${orders[3].id}/status`, { status: 'SHIPPED' }, { token: tokens.OPERATOR })
    assert.ok(moved.status < 300, JSON.stringify(moved.body))
    await api.post('/admin/v1/rider/location', { lat: 12.98, lng: 77.61 }, { token: tokens.RIDER }).catch(() => {})
    const r = await changesSince(since)
    const step = r.events.find((e) => e.type === 'order.changed' && e.data.id === orders[3].id)
    assert.deepEqual(step.data, { id: orders[3].id, number: orders[3].number, status: 'SHIPPED', date: DATE })
    assert.ok(r.cursor >= since)
    assert.deepEqual((await changesSince(r.cursor)).events, [])
  })
})
