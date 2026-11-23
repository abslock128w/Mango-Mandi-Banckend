// The pre-order plan (migrations 078, 079, 080): expected kg a day PER VARIETY, the recalculation when the plan
// changes (oldest first, frozen weeks, dry run equals apply, one message per move), delays and the customer's right to
// cancel a delayed pre-order for a full refund until it is packed, the allocator's move on the same delayed path, the
// panel's preview/apply and bookings list, and Needs attention.
import { adminToken, client, closeAll, customerToken, forceOrderState, makeBatch, resetDb, signWebhook, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, test } from 'node:test'
import { addDays, now, setNow, todayIST } from '../src/clock.js'
import { currentConfig, loadConfig, saveConfig } from '../src/config.js'
import { query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'
import { runPreorderJobs } from '../src/maintenance.js'
import { weekWords } from '../src/notify.js'
import { formatOrderNumber } from '../src/order-number.js'
import { recalculatePreorders } from '../src/preorder-plan.js'
import { deliveryWeeks, refundPreorder } from '../src/preorders.js'
import { preorderCapacityDrift } from '../src/stock-watch.js'

let srv
let api
let admin

before(async () => {
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  await srv.close()
  await closeAll()
})
beforeEach(async () => {
  await resetDb()
  admin = await adminToken(api)
})

function openWeek() {
  let d = addDays(todayIST(), 6)
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1)
  return d
}
/** The plan: kg a day per variety (Alphonso and Badami in the test catalogue), the rest by `other`. */
const setPlan = (dayKg, other = 1000) => saveConfig({ ...currentConfig().rules, preorderVarietyDayKg: dayKg, preorderOtherVarietyDayKg: other }, 'test')
const book = (token, extra = {}) =>
  api.post(
    '/v1/preorders',
    { sku: 'ALP-5', stage: 'SEMI_RIPE', qty: 2, pincode: '560034', address: '12, 4th Cross, Koramangala, Bengaluru', ...extra },
    { token, headers: { 'Idempotency-Key': newId('idem') } },
  )
const pre = async (id) => (await query('SELECT * FROM preorders WHERE id = $1', [id])).rows[0]
async function payLink(p) {
  const { raw, signature } = signWebhook({
    event: 'payment_link.paid',
    payload: {
      payment_link: { entity: { id: p.payment_link_id, notes: { preorderId: p.id }, status: 'paid' } },
      payment: { entity: { id: `pay_${p.id}`, amount: p.total, method: 'upi' } },
    },
  })
  const r = await api.raw('POST', '/webhooks/razorpay', { raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature } })
  assert.equal(r.status, 200, JSON.stringify(r.body))
}
/** A paid booking of `extra` (default 2 x Alphonso 5 kg = 10 kg), one second after the last: the order they are delivered in. */
let tick = 0
async function paid(extra = {}, { pay = true } = {}) {
  setNow(new Date(now().getTime() + 1000 + tick++))
  const t = await customerToken(api)
  const r = await book(t.accessToken, extra)
  assert.equal(r.status, 201, JSON.stringify(r.body))
  if (pay) await payLink(await pre(r.body.id))
  return { id: r.body.id, token: t.accessToken }
}
const weekOf = async (ids) => (await query('SELECT id, week_start FROM preorders WHERE id = ANY($1)', [ids])).rows.reduce((m, r) => ({ ...m, [r.id]: r.week_start }), {})
const kinds = async (id) => (await query('SELECT kind FROM notifications WHERE preorder_id = $1 ORDER BY created_at, kind', [id])).rows.map((r) => r.kind)
const kgOf = async (week, variety = 'Alphonso') =>
  Number((await query('SELECT reserved_kg FROM preorder_variety_week_kg WHERE week_start = $1 AND variety = $2', [week, variety])).rows[0]?.reserved_kg ?? 0)
const migration = async (file) => readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', file), 'utf8')

describe('the plan per variety (migration 078)', () => {
  test('each variety has its own weekly kg: a full Alphonso week sends Alphonso to the next week, Badami still gets the first', async () => {
    const week = openWeek()
    await setPlan({ Alphonso: 20 / 7, Badami: 6 / 7 }) // Alphonso 20 kg a week, Badami 6 kg
    const a = await paid({ qty: 2 }) // 10 kg
    const b = await paid({ qty: 2 }) // 10 kg: Alphonso's first week full
    const c = await paid({ qty: 1 }) // 5 kg: next week
    const d = await paid({ sku: 'BAD-3', qty: 2 }) // Badami 6 kg: its own first week
    const w = await weekOf([a.id, b.id, c.id, d.id])
    assert.deepEqual([w[a.id], w[b.id], w[c.id], w[d.id]], [week, week, addDays(week, 7), week])
    assert.deepEqual([await kgOf(week), await kgOf(addDays(week, 7)), await kgOf(week, 'Badami')], [20, 5, 6])
    assert.equal((await pre(d.id)).variety, 'Badami')
    // The shop: each box's own week, the earliest any box can get, and each variety's weeks.
    const shop = (await api.get('/v1/preorders/weeks')).body
    assert.deepEqual(shop.boxes.find((x) => x.sku === 'ALP-3').nextWeek, { weekStart: addDays(week, 7), limit: 20, remaining: 15 })
    assert.deepEqual(shop.boxes.find((x) => x.sku === 'BAD-3').nextWeek, { weekStart: addDays(week, 7), limit: 6, remaining: 6 }) // 6 of 6 kg in week 1
    assert.equal(shop.nextWeek.weekStart, addDays(week, 7)) // no box has room in week 1 any more
  })

  test('a variety not listed takes the number for other varieties; a week override is per variety', async () => {
    const week = openWeek()
    await setPlan({ Alphonso: 10 / 7 }, 3 / 7) // Badami not listed: 3 kg a week
    const shop = (await api.get('/v1/preorders/weeks')).body
    assert.deepEqual(shop.varieties.map((v) => [v.variety, Math.round(v.dayKg * 7)]), [['Alphonso', 10], ['Badami', 3]])
    const put = await api.put(`/admin/v1/preorder-weeks/${week}`, { limitKg: 30, variety: 'Badami' }, { token: admin })
    assert.deepEqual([put.status, put.body.limit, put.body.own], [200, 30, 30])
    const r = await paid({ sku: 'BAD-5', qty: 2 })
    assert.equal((await pre(r.id)).week_start, week) // 10 kg fit Badami's own 30 kg
    const panel = (await api.get('/admin/v1/preorder-weeks', { token: admin })).body
    const first = panel.weeks[0].varieties
    assert.deepEqual(first.map((v) => [v.variety, v.limit, v.booked]), [['Alphonso', 10, 0], ['Badami', 30, 10]])
    assert.deepEqual(panel.varieties.map((v) => [v.variety, v.listed, v.weekKg]), [['Alphonso', true, 10], ['Badami', false, 3]])
  })

  test('migration 078 on a live-shaped database: variety counters rebuilt from the bookings, 20 kg a day for each variety once, overrides split', async () => {
    const week = openWeek()
    const ids = []
    for (const extra of [{ qty: 1 }, { qty: 2 }, { sku: 'BAD-3', qty: 3 }]) ids.push((await paid(extra, { pay: false })).id)
    await query(`UPDATE preorders SET status = 'CANCELLED' WHERE id = $1`, [ids[1]])
    // As 074 to 077 left it: no variety on bookings, no variety counters, a week's own kg for all boxes, rules without the plan.
    await query('UPDATE preorders SET variety = NULL')
    await query('DROP TABLE preorder_variety_week_kg')
    await query('UPDATE preorder_week_kg SET limit_kg = 9000 WHERE week_start = $1', [week])
    const { preorderVarietyDayKg: _a, preorderOtherVarietyDayKg: _b, ...older } = currentConfig().rules
    const v0 = (await query('SELECT MAX(version)::int AS v FROM app_config')).rows[0].v
    await query(`INSERT INTO app_config (version, value, changed_by) VALUES ($1, $2, 'manager@x')`, [v0 + 1, older])
    const sql = await migration('078_preorder_variety_plan.sql')
    await tx((c) => c.query(sql))
    await tx(async (c) => c.query(await migration('083_planned_orders.sql'))) // the table was rebuilt: its later column
    assert.deepEqual((await query('SELECT variety FROM preorders ORDER BY created_at')).rows.map((r) => r.variety), ['Alphonso', 'Alphonso', 'Badami'])
    assert.deepEqual([await kgOf(week), await kgOf(week, 'Badami')], [5, 9]) // the cancelled one holds nothing
    const own = (await query('SELECT variety, limit_kg FROM preorder_variety_week_kg WHERE week_start = $1 ORDER BY variety', [week])).rows
    assert.deepEqual(own.map((r) => [r.variety, Number(r.limit_kg)]), [['Alphonso', 4500], ['Badami', 4500]])
    const live = (await query('SELECT version, value, changed_by FROM app_config ORDER BY version DESC LIMIT 1')).rows[0]
    assert.deepEqual([live.version, live.changed_by, live.value.preorderVarietyDayKg, live.value.preorderOtherVarietyDayKg, live.value.preorderDayKg], [v0 + 2, 'system', { Alphonso: 20, Badami: 20 }, 20, 1000])
    await loadConfig()
    assert.equal((await api.get('/v1/preorders/weeks')).body.varieties[0].weeks[0].limit, 4500)
    // Run again: nothing more.
    await tx((c) => c.query(sql))
    assert.equal((await query('SELECT MAX(version)::int AS v FROM app_config')).rows[0].v, v0 + 2)
    assert.equal(await kgOf(week), 5)
  })
})

describe('recalculation (preorder-plan.js)', () => {
  /** The owner's example scaled down: Alphonso 10 kg a day (70 kg a week), 10 kg bookings, two weeks full. */
  async function twoFullWeeks() {
    const week = openWeek()
    await setPlan({ Alphonso: 10 }, 10)
    const list = []
    for (let i = 0; i < 14; i++) list.push(await paid({}, { pay: i !== 5 })) // the 6th stays unpaid
    const w = await weekOf(list.map((x) => x.id))
    assert.deepEqual(list.map((x) => w[x.id]), [...Array(7).fill(week), ...Array(7).fill(addDays(week, 7))])
    return { week, list }
  }
  const preview = (body) => api.post('/admin/v1/preorder-plan/preview', body, { token: admin })
  const apply = (body) => api.post('/admin/v1/preorder-plan/apply', { ...body, confirmCode: 'manager123' }, { token: admin })

  test('10 kg a day down to 7: oldest first stay, the newest move later, delayed with one message each; dry run equals apply; again changes nothing', async () => {
    const { week, list } = await twoFullWeeks()
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    assert.equal((await api.post('/admin/v1/preorder-plan/preview', { dayKg: { Alphonso: 7 } }, { token: ops })).status, 403)
    const dry = await preview({ dayKg: { Alphonso: 7 } })
    assert.equal(dry.status, 200, JSON.stringify(dry.body))
    // 49 kg a week: 4 bookings a week. Week 1 keeps the first 4; 3 move to week 2; week 2's 7 + 3 spread over weeks 2 to 4.
    assert.deepEqual([dry.body.delayed.bookings, dry.body.delayed.kg, dry.body.delayed.paid, dry.body.earlier.bookings], [9, 90, 8, 0])
    assert.deepEqual(dry.body.moves, []) // a preview gives counts and weeks
    assert.equal((await pre(list[13].id)).week_start, addDays(week, 7)) // nothing written
    assert.equal((await query(`SELECT COUNT(*)::int AS n FROM notifications WHERE kind = 'PREORDER_DELAYED'`)).rows[0].n, 0)
    // Apply needs the manager's password (a rules change).
    assert.equal((await api.post('/admin/v1/preorder-plan/apply', { dayKg: { Alphonso: 7 } }, { token: admin })).body.error.code, 'REAUTH_REQUIRED')
    const done = await apply({ dayKg: { Alphonso: 7 } })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.deepEqual([done.body.delayed, done.body.earlier, done.body.noRoom], [dry.body.delayed, dry.body.earlier, dry.body.noRoom])
    assert.deepEqual(done.body.weeks, dry.body.weeks)
    assert.equal(currentConfig().rules.preorderVarietyDayKg.Alphonso, 7)
    const w = await weekOf(list.map((x) => x.id))
    const expected = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3].map((n) => addDays(week, 7 * n))
    assert.deepEqual(list.map((x) => w[x.id]), expected)
    assert.deepEqual([await kgOf(week), await kgOf(addDays(week, 7)), await kgOf(addDays(week, 14)), await kgOf(addDays(week, 21))], [40, 40, 40, 20])
    // A paid booking moved later: delayed (first week kept), its message queued with the weeks and the link; unpaid: neither.
    const moved = await pre(list[4].id)
    assert.deepEqual([moved.delayed_from_week, moved.delay_count, Boolean(moved.delayed_at)], [week, 1, true])
    const msg = (await query(`SELECT * FROM notifications WHERE preorder_id = $1 AND kind = 'PREORDER_DELAYED'`, [moved.id])).rows[0]
    assert.deepEqual(msg.params, [moved.customer_name?.trim() || 'there', formatOrderNumber(moved.number), weekWords(week), weekWords(addDays(week, 7)), `${env.CUSTOMER_ORIGIN.split(',')[0].trim().replace(/\/$/, '')}/preorders/${moved.id}`])
    const unpaid = await pre(list[5].id)
    assert.deepEqual([unpaid.week_start, unpaid.delayed_at, await kinds(unpaid.id)], [addDays(week, 7), null, []])
    assert.deepEqual(await kinds(list[0].id), ['PREORDER_BOOKED']) // never moved: no message
    const view = (await api.get(`/v1/preorders/${moved.id}`, { token: list[4].token })).body
    assert.deepEqual([view.delayed.fromWeek, view.delayed.toWeek, view.delayed.count, view.canCancel, view.cancelUntil], [week, addDays(week, 7), 1, true, 'PACKED'])
    // Applying the same plan again moves nothing and sends nothing.
    const msgs = (await query('SELECT COUNT(*)::int AS n FROM notifications')).rows[0].n
    const again = await apply({})
    assert.deepEqual([again.body.delayed.bookings, again.body.earlier.bookings], [0, 0])
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM notifications')).rows[0].n, msgs)
    assert.deepEqual(await preorderCapacityDrift({ query }), [])
    // Back up to 10 kg: delayed bookings keep their week for good; only the two never delayed (one unpaid) move earlier, ahead of them.
    const dryUp = await preview({ dayKg: { Alphonso: 10 } })
    assert.deepEqual([dryUp.body.earlier.bookings, dryUp.body.delayed.bookings, dryUp.body.delayedStay], [2, 0, { bookings: 8, kg: 80, overtakenBy: 2 }])
    const up = await apply({ dayKg: { Alphonso: 10 } })
    assert.deepEqual([up.body.earlier, up.body.delayed, up.body.delayedStay, up.body.weeks], [dryUp.body.earlier, dryUp.body.delayed, dryUp.body.delayedStay, dryUp.body.weeks])
    const after = await weekOf(list.map((x) => x.id))
    assert.deepEqual(list.map((x) => after[x.id]), [0, 0, 0, 0, 1, 0, 1, 0, 2, 2, 2, 2, 3, 3].map((n) => addDays(week, 7 * n)))
    const stays = await pre(list[4].id)
    assert.deepEqual([stays.week_start, Boolean(stays.delayed_at), stays.delayed_from_week, stays.delay_count], [addDays(week, 7), true, week, 1])
    assert.deepEqual(await kinds(stays.id), ['PREORDER_BOOKED', 'PREORDER_DELAYED']) // no "earlier" message
    assert.deepEqual(await kinds(list[7].id), ['PREORDER_BOOKED', 'PREORDER_EARLIER']) // never delayed: good news
    const shown = (await api.get(`/v1/preorders/${stays.id}`, { token: list[4].token })).body
    assert.deepEqual([shown.canCancel, shown.delayed.toWeek, shown.cancelUntil], [true, addDays(week, 7), 'PACKED'])
    assert.equal((await api.get(`/v1/preorders/${list[0].id}`, { token: list[0].token })).body.canCancel, false) // never delayed, paid: still no cancel
    // Again: nothing moves. A manager can't bring it forward; a further delay still works and is told.
    const n = (await query('SELECT COUNT(*)::int AS n FROM notifications')).rows[0].n
    assert.equal((await apply({})).body.earlier.bookings, 0)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM notifications')).rows[0].n, n)
    const earlier = await api.post(`/admin/v1/preorders/${stays.id}/move`, { weekStart: week, reason: 'room opened' }, { token: admin })
    assert.equal(earlier.status, 409, JSON.stringify(earlier.body))
    assert.equal(earlier.body.error.code, 'DELAYED_NOT_EARLIER')
    const later = await api.post(`/admin/v1/preorders/${stays.id}/move`, { weekStart: addDays(week, 28), reason: 'fruit late' }, { token: admin })
    assert.equal(later.status, 200, JSON.stringify(later.body))
    const further = await pre(stays.id)
    assert.deepEqual([further.week_start, further.delayed_from_week, further.delay_count], [addDays(week, 28), week, 2])
    assert.deepEqual(await kinds(stays.id), ['PREORDER_BOOKED', 'PREORDER_DELAYED', 'PREORDER_DELAYED'])
    assert.deepEqual(await preorderCapacityDrift({ query }), [])
  })

  test('a frozen week (its bookings are being delivered) is left as it is; the plan refills from the first open week', async () => {
    const { week, list } = await twoFullWeeks()
    // One booking of week 1 is already a delivery order: week 1 is frozen.
    await query(`UPDATE preorders SET status = 'CONVERTED' WHERE id = $1`, [list[0].id])
    const r = await recalculatePreorders({ rules: { ...currentConfig().rules, preorderVarietyDayKg: { Alphonso: 7 } }, dryRun: true })
    assert.deepEqual([r.frozenWeeks, r.firstOpenWeek], [[week], addDays(week, 7)])
    await saveConfig({ ...currentConfig().rules, preorderVarietyDayKg: { Alphonso: 7 } }, 'test')
    const done = await recalculatePreorders({})
    assert.equal(done.delayed.bookings, 3) // only week 2's newest 3 (7 x 10 kg in 49 kg)
    const w = await weekOf(list.map((x) => x.id))
    assert.deepEqual(list.slice(0, 7).map((x) => w[x.id]), Array(7).fill(week)) // week 1 untouched, over its new limit
    assert.deepEqual(list.slice(7).map((x) => w[x.id]), [1, 1, 1, 1, 2, 2, 2].map((n) => addDays(week, 7 * n)))
    // Inside the allocator's horizon a week is frozen too.
    setNow(`${addDays(week, -4)}T04:30:00Z`)
    const late = await recalculatePreorders({ dryRun: true })
    assert.ok(late.firstOpenWeek > week, late.firstOpenWeek)
  })

  test('a week override below what is booked: the preview names it, apply moves the newest out', async () => {
    const { week, list } = await twoFullWeeks()
    const change = { weeks: [{ weekStart: week, variety: 'Alphonso', limitKg: 50 }] }
    const dry = await preview(change)
    assert.deepEqual([dry.body.delayed.bookings, dry.body.weeks.find((x) => x.weekStart === week)], [4, { weekStart: week, variety: 'Alphonso', limit: 50, before: 70, after: 50 }])
    const done = await apply(change) // no rules change: no password asked
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.equal(done.body.rulesChanged, false)
    const w = await weekOf(list.map((x) => x.id))
    assert.deepEqual([w[list[4].id], w[list[5].id], w[list[6].id]], [week, addDays(week, 7), addDays(week, 7)])
    assert.equal((await api.post('/admin/v1/preorder-plan/preview', { weeks: [{ weekStart: addDays(week, -7), variety: 'Alphonso', limitKg: 1 }] }, { token: admin })).body.error.code, 'INVALID_WEEK')
  })

  test('thousands of bookings recalculate in bounded statements, and a booking made meanwhile keeps the counters right', async () => {
    await setPlan({ Alphonso: 3000 / 7 }, 3000 / 7)
    // 3,000 paid bookings of 3 kg written straight in (3 weeks of 3,000 kg), and their counters.
    const weeks = (await tx((c) => deliveryWeeks(c))).slice(0, 3)
    const base = now().getTime()
    await customerToken(api)
    const who = (await query('SELECT id FROM customers ORDER BY created_at LIMIT 1')).rows[0].id
    await query(
      `INSERT INTO preorders (id, number, customer_id, customer_name, phone, sku, stage, qty, unit_price, total, week_start, pincode, delivery_address, channel, status,
                              payment_status, paid_amount, created_at, booked_at, non_refundable, load_kg, variety)
       SELECT 'pre_bulk_' || g, 'P' || (900000000 + g), $3, 'Bulk ' || g, '98' || lpad(g::text, 8, '0'), 'ALP-3', 'SEMI_RIPE', 1, 100, 100,
              ($1::date[])[1 + (g - 1) / 1000], '560034', 'x', 'app', 'BOOKED', 'SUCCEEDED', 100,
              to_timestamp($2::bigint / 1000.0 + g), to_timestamp($2::bigint / 1000.0 + g), true, 3, 'Alphonso'
         FROM generate_series(1, 3000) g`,
      [weeks, base, who],
    )
    for (const w of weeks) await query(`INSERT INTO preorder_variety_week_kg (week_start, variety, reserved_kg) VALUES ($1, 'Alphonso', 3000)`, [w])
    for (const w of weeks) await query(`INSERT INTO preorder_week_kg (week_start, reserved_kg) VALUES ($1, 3000) ON CONFLICT (week_start) DO UPDATE SET reserved_kg = 3000`, [w])
    for (const w of weeks) await query(`INSERT INTO preorder_weeks (week_start, reserved) VALUES ($1, 1000) ON CONFLICT (week_start) DO UPDATE SET reserved = 1000`, [w])
    for (const w of weeks) await query(`INSERT INTO preorder_capacity (sku, week_start, capacity, reserved) VALUES ('ALP-3', $1, 0, 1000)`, [w])
    assert.deepEqual(await preorderCapacityDrift({ query }), [])
    await saveConfig({ ...currentConfig().rules, preorderVarietyDayKg: { Alphonso: 2000 / 7 } }, 'test')
    const started = Date.now()
    const [r, extra] = await Promise.all([recalculatePreorders({}), paid({ sku: 'ALP-3', qty: 1 }, { pay: false })])
    assert.ok(Date.now() - started < 20_000, `took ${Date.now() - started} ms`)
    // 9,000 kg in 2,000 kg weeks (666 bookings): 998 keep their week, 2,002 paid ones move later (the unpaid one made meanwhile may too).
    assert.equal(r.delayed.paid, 2002)
    assert.ok((await pre(extra.id)).week_start)
    assert.equal((await query(`SELECT COUNT(*)::int AS n FROM notifications WHERE kind = 'PREORDER_DELAYED'`)).rows[0].n, r.delayed.paid)
    assert.deepEqual(await preorderCapacityDrift({ query }), [])
  })
})

describe('delays and the cancel right (migration 079)', () => {
  test('only a delayed paid pre-order can be cancelled, for a full refund; it frees its kg', async () => {
    const week = openWeek()
    await setPlan({ Alphonso: 10 / 7 }, 10 / 7)
    const a = await paid()
    const b = await paid()
    // Not delayed: still non-refundable.
    assert.equal((await api.post(`/v1/preorders/${a.id}/cancel`, {}, { token: a.token })).body.error.code, 'PREORDER_NON_REFUNDABLE')
    assert.equal((await api.get(`/v1/preorders/${a.id}`, { token: a.token })).body.canCancel, false)
    const r = await recalculatePreorders({ overrides: [{ weekStart: week, variety: 'Alphonso', limitKg: 0 }] })
    assert.equal(r.delayed.bookings, 2)
    const v = (await api.get(`/v1/preorders/${a.id}`, { token: a.token })).body
    assert.deepEqual([v.canCancel, v.delayed.fromWeek, v.delayed.toWeek], [true, week, addDays(week, 7)])
    const cancel = await api.post(`/v1/preorders/${a.id}/cancel`, {}, { token: a.token })
    assert.equal(cancel.status, 204, JSON.stringify(cancel.body))
    const gone = await pre(a.id)
    assert.deepEqual([gone.status, gone.payment_status, Boolean(gone.delay_cancelled_at)], ['CANCELLED', 'REFUNDED', true])
    assert.equal(await kgOf(addDays(week, 7)), 0) // b moved to week 3, a's kg freed
    assert.equal((await pre(b.id)).week_start, addDays(week, 14))
    // The panel's list: Cancelled after delay, and Delayed.
    const list = (f) => api.get(`/admin/v1/preorders?filter=${f}`, { token: admin })
    assert.deepEqual((await list('cancelledAfterDelay')).body.map((x) => x.id), [a.id])
    const del = (await list('delayed')).body
    assert.deepEqual(del.map((x) => [x.id, x.delayCount, x.message.kind]), [[b.id, 1, 'PREORDER_DELAYED']])
    assert.equal((await api.get(`/admin/v1/preorders?q=${encodeURIComponent(formatOrderNumber(gone.number).toLowerCase())}`, { token: admin })).body[0].id, a.id)
    // Needs attention: nothing owed (the dev gateway refunded at once).
    assert.deepEqual((await api.get('/admin/v1/attention', { token: admin })).body.delayRefunds, [])
  })

  test('the order a delayed pre-order became can be cancelled for a full refund until it is packed, not after', async () => {
    const week = openWeek()
    setNow(`${addDays(week, -6)}T04:30:00Z`)
    await setPlan({ Alphonso: 100 }, 100)
    const a = await paid({ sku: 'ALP-3', qty: 1 })
    const b = await paid({ sku: 'ALP-3', qty: 1 })
    // The first week passes without fruit: the allocator moves both, on the delayed path.
    setNow(`${addDays(week, 7)}T04:30:00Z`)
    assert.equal((await runPreorderJobs()).moved, 2)
    const moved = await pre(a.id)
    assert.deepEqual([moved.week_start, moved.delayed_from_week, moved.delay_count], [addDays(week, 7), week, 1])
    assert.deepEqual(await kinds(a.id), ['PREORDER_BOOKED', 'PREORDER_DELAYED'])
    // Fruit comes: both become delivery orders.
    await makeBatch({ age: 0, rating: 'RAW', lines: { 'ALP-3': 10 } })
    assert.equal((await runPreorderJobs()).converted, 2)
    const [oa, ob] = [(await pre(a.id)).order_id, (await pre(b.id)).order_id]
    const view = (await api.get(`/v1/orders/${oa}`, { token: a.token })).body
    assert.deepEqual([view.canCancel, view.cancelUntil, view.delayed.fromWeek], [true, 'PACKED', week])
    const listed = (await api.get('/v1/orders', { token: a.token })).body.find((o) => o.id === oa)
    assert.deepEqual([listed.delayed.toWeek, listed.canCancelDelayed], [addDays(week, 7), true])
    // B's order is packed: refused, with the reason.
    await forceOrderState(`UPDATE orders SET status = 'PACKED' WHERE id = $1`, [ob])
    const refused = await api.post(`/v1/preorders/${b.id}/cancel`, {}, { token: b.token })
    assert.deepEqual([refused.status, refused.body.error.code], [409, 'NOT_CANCELLABLE'])
    assert.match(refused.body.error.message, /already packed/)
    assert.equal((await api.get(`/v1/preorders/${b.id}`, { token: b.token })).body.canCancel, false)
    // A's order (CONFIRMED, placed days after the 4-hour window would have closed) is cancelled and refunded in full.
    setNow(`${addDays(week, 9)}T04:30:00Z`)
    const ok = await api.post(`/v1/orders/${oa}/cancel`, {}, { token: a.token })
    assert.ok(ok.status < 300, JSON.stringify(ok.body))
    const o = (await query('SELECT status, payment_status FROM orders WHERE id = $1', [oa])).rows[0]
    assert.deepEqual(o, { status: 'CANCELLED', payment_status: 'REFUNDED' })
    assert.ok((await pre(a.id)).delay_cancelled_at)
  })

  test('one person of a paid gift for several people is delayed and cancelled alone, refunded their own amount', async () => {
    const saved = env.MULTI_GIFT
    env.MULTI_GIFT = true
    try {
      const week = openWeek()
      await setPlan({ Alphonso: 20 / 7 }, 20 / 7)
      const t = await customerToken(api)
      const person = (i, qty) => ({
        sku: 'ALP-5', stage: 'SEMI_RIPE', qty, pincode: '560034', address: `${i}, 4th Cross, Koramangala, Bengaluru`,
        gift: { recipientName: `Friend ${i}`, recipientPhone: `98450 1234${i}`, message: null },
      })
      const g = await api.post('/v1/preorders/groups', { recipients: [person(1, 2), person(2, 2)] }, { token: t.accessToken, headers: { 'Idempotency-Key': newId('idem') } })
      assert.equal(g.status, 201, JSON.stringify(g.body))
      const members = (await query('SELECT * FROM preorders WHERE group_id = $1 ORDER BY group_position', [g.body.id])).rows
      const grp = (await query('SELECT * FROM preorder_groups WHERE id = $1', [g.body.id])).rows[0]
      const { raw, signature } = signWebhook({
        event: 'payment_link.paid',
        payload: { payment_link: { entity: { id: members[0].payment_link_id, notes: { preorderId: members[0].id }, status: 'paid' } }, payment: { entity: { id: 'pay_grp', amount: grp.total, method: 'upi' } } },
      })
      await api.raw('POST', '/webhooks/razorpay', { raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature } })
      // 20 kg a week, down to 10: person 2 moves to week 2.
      await recalculatePreorders({ overrides: [{ weekStart: week, variety: 'Alphonso', limitKg: 10 }] })
      const [one, two] = (await query('SELECT * FROM preorders WHERE group_id = $1 ORDER BY group_position', [g.body.id])).rows
      assert.deepEqual([one.week_start, two.week_start, Boolean(two.delayed_at)], [week, addDays(week, 7), true])
      const mine = (await api.get('/v1/preorders', { token: t.accessToken })).body.sort((x, y) => x.gift.recipientName.localeCompare(y.gift.recipientName))
      assert.deepEqual(mine.map((p) => [p.gift.recipientName, Boolean(p.delayed), p.canCancel]), [['Friend 1', false, false], ['Friend 2', true, true]])
      assert.equal((await api.post(`/v1/preorders/${two.id}/cancel`, {}, { token: t.accessToken })).status, 204)
      await refundPreorder(two.id)
      const after2 = (await query('SELECT status, payment_status, paid_amount, total FROM preorders WHERE group_id = $1 ORDER BY group_position', [g.body.id])).rows
      assert.deepEqual(after2.map((p) => [p.status, p.payment_status]), [['BOOKED', 'SUCCEEDED'], ['CANCELLED', 'REFUNDED']])
      assert.equal(after2[1].paid_amount, after2[1].total)
    } finally {
      env.MULTI_GIFT = saved
    }
  })

  test('Needs attention: bookings delayed more than twice, and weeks over a variety limit', async () => {
    const week = openWeek()
    await setPlan({ Alphonso: 10 / 7 }, 10 / 7)
    const a = await paid()
    // Delayed three times already (its first week was a month earlier).
    await query('UPDATE preorders SET delay_count = 3, delayed_at = $2, delayed_from_week = $3 WHERE id = $1', [a.id, now(), addDays(week, -28)])
    await api.put(`/admin/v1/preorder-weeks/${week}`, { limitKg: 4, variety: 'Alphonso' }, { token: admin })
    const att = (await api.get('/admin/v1/attention', { token: admin })).body
    assert.deepEqual(att.preorderDelayedOften.map((x) => [x.id, x.delayCount]), [[a.id, 3]])
    assert.deepEqual(att.preorderWeeksOver, [{ weekStart: week, variety: 'Alphonso', limit: 4, booked: 10, over: 6 }])
  })
})
