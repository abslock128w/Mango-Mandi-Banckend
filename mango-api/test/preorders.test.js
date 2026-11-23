// Preorders: the one weekly limit and automatic weeks (migration 074), waitlist, payment links, the
// allocator, moves and refunds, the season phase and its dates (migration 075), the non-refundable rule
// (migration 064), and gift bookings (migrations 070, 071).
import { adminToken, client, closeAll, customerToken, makeBatch, resetDb, signWebhook, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, test } from 'node:test'
import { addDays, now, setNow, todayIST } from '../src/clock.js'
import { currentConfig, DEFAULT_RULES, getConfig, loadConfig, rulesSchema, saveConfig } from '../src/config.js'
import { query, tx } from '../src/db.js'
import { newId } from '../src/ids.js'
import { runPreorderJobs } from '../src/maintenance.js'
import { eraseCustomer } from '../src/privacy.js'
import { env } from '../src/env.js'
import { deliveryWeeks, refundPreorder } from '../src/preorders.js'
import { preorderCapacityDrift } from '../src/stock-watch.js'
import { seasonPhase } from '../src/season-phase.js'

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

/** The first Monday after the regular booking horizon (today + 5 days before the cutoff). */
function openWeek() {
  let d = addDays(todayIST(), 6)
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1)
  return d
}
const setCapacity = (week, capacity, token = admin) => api.put(`/admin/v1/preorder-capacity/${week}/ALP-3`, { capacity }, { token })
const book = (token, week, extra = {}) =>
  api.post(
    '/v1/preorders',
    { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2, weekStart: week, pincode: '560034', address: '12, 4th Cross, Koramangala, Bengaluru', ...extra },
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
  return r.body
}
/** A booking sold before pre-orders became non-refundable (migration 064): it keeps its refund. */
const makeOld = (id) => query('UPDATE preorders SET non_refundable = false WHERE id = $1', [id])
const setSeason = (seasonStartsOn, preorderOpensOn = null) => saveConfig({ ...currentConfig().rules, seasonStartsOn, preorderOpensOn }, 'test')
/** The default weekly limit for every box, in kg (migrations 074, 076): mangoes expected per day (preorderDayKg) x 7. */
const setLimit = (kg, more = {}) => saveConfig({ ...currentConfig().rules, preorderDayKg: kg / 7, preorderVarietyDayKg: {}, preorderOtherVarietyDayKg: kg / 7, ...more }, 'test')
/** What a week's kg counter holds (preorder_week_kg.reserved_kg). */
const taken = async (week) => Number((await query('SELECT reserved_kg FROM preorder_week_kg WHERE week_start = $1', [week])).rows[0]?.reserved_kg ?? 0)
/** Migration 074's one-per-booking count (kept for a rollback; decides nothing since 076). */
const orders = async (week) => (await query('SELECT reserved FROM preorder_weeks WHERE week_start = $1', [week])).rows[0]?.reserved ?? 0
const migration = async (file) => readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', file), 'utf8')
/** Alphonso's own weeks in GET /v1/preorders/weeks (the plan is per variety, migration 078). */
const alp = (body) => body.varieties.find((v) => v.variety === 'Alphonso').weeks
const kinds = async (id) => (await query('SELECT kind FROM notifications WHERE preorder_id = $1 ORDER BY created_at', [id])).rows.map((r) => r.kind)

describe('preorders', () => {
  test('weeks exist with no staff setup, every box shares one weekly limit in kg, and a booking that does not fit goes to the next week', async () => {
    const week = openWeek()
    const week2 = addDays(week, 7)
    await setLimit(12) // 12 kg a week: Alphonso 3 kg and 5 kg boxes
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM preorder_capacity')).rows[0].n, 0) // nothing set up by staff
    const weeks = (await api.get('/v1/preorders/weeks')).body
    assert.deepEqual([weeks.nextWeek, weeks.firstWeek, weeks.limit, weeks.countsBy], [{ weekStart: week, limit: 12, remaining: 12 }, week, 12, 'kg'])
    assert.equal(Math.round(weeks.dayKg * 7), 12)
    // No season end set: 26 weeks, week after week.
    assert.equal(weeks.deliveryWeeks.length, 26)
    // Per variety (migration 078): Alphonso's own weeks; deliveryWeeks adds every variety up.
    assert.deepEqual(alp(weeks).slice(0, 2), [{ weekStart: week, limit: 12, remaining: 12 }, { weekStart: week2, limit: 12, remaining: 12 }])
    assert.equal(weeks.deliveryWeeks[0].limit, 12 * weeks.varieties.length)
    assert.deepEqual(weeks.boxes.find((x) => x.sku === 'ALP-3'), { sku: 'ALP-3', variety: 'Alphonso', nextWeek: { weekStart: week, limit: 12, remaining: 12 } })
    assert.equal(weeks.deliveryWeeks.at(-1).weekStart, addDays(week, 25 * 7))
    // As before: one entry per box on sale, with the week's room (kg) and the box's locked price.
    const w = weeks.weeks.find((x) => x.sku === 'ALP-3')
    assert.deepEqual({ sku: w.sku, weekStart: w.weekStart, capacity: w.capacity, remaining: w.remaining }, { sku: 'ALP-3', weekStart: week, capacity: 12, remaining: 12 })
    assert.ok(w.name && w.boxSize && w.price > 0, JSON.stringify(w))
    assert.ok(weeks.weeks.some((x) => x.sku === 'ALP-5'))
    assert.deepEqual([...new Set(weeks.weeks.map((x) => x.weekStart))], [week])
    assert.deepEqual((await api.get('/v1/preorders/weeks?sku=ALP-5')).body.weeks.map((x) => x.sku), ['ALP-5'])

    // A week inside the regular booking horizon can't be preordered.
    const a = await customerToken(api)
    assert.equal((await book(a.accessToken, addDays(week, -7))).body.error.code, 'INVALID_WEEK')
    assert.equal((await book(a.accessToken, addDays(week, 1))).body.error.code, 'INVALID_WEEK') // not a Monday

    // 3 kg + 3 kg + 5 kg: 11 of 12 kg taken.
    const first = await book(a.accessToken, week, { qty: 1 })
    assert.equal(first.status, 201, JSON.stringify(first.body))
    assert.deepEqual([first.body.status, first.body.weekStart, first.body.total], ['PAYMENT_PENDING', week, first.body.unitPrice])
    assert.match(first.body.paymentUrl, /^https:\/\/rzp\.io\/i\/plink_dev_/)
    for (const extra of [{ qty: 1 }, { sku: 'ALP-5', qty: 1 }]) {
      const r = await book((await customerToken(api)).accessToken, week, extra)
      assert.deepEqual([r.status, r.body.weekStart], [201, week], JSON.stringify(r.body))
    }
    assert.equal(await taken(week), 11)
    assert.deepEqual((await query('SELECT load_kg FROM preorders ORDER BY created_at')).rows.map((r) => Number(r.load_kg)), [3, 3, 5])
    const full = (await api.get('/v1/preorders/weeks')).body
    assert.deepEqual(full.boxes.find((x) => x.sku === 'ALP-3').nextWeek, { weekStart: week2, limit: 12, remaining: 12 }) // 1 kg of Alphonso left: no box fits
    assert.deepEqual(full.nextWeek, { weekStart: week, limit: 12, remaining: 12 }) // another variety still has the first week
    assert.deepEqual([...new Set(full.weeks.filter((x) => x.variety === 'Alphonso').map((x) => x.weekStart))], [week, week2])
    assert.equal(full.weeks.find((x) => x.weekStart === week && x.variety === 'Alphonso').remaining, 1)
    assert.equal(full.weeks.find((x) => x.weekStart === week && x.variety !== 'Alphonso').remaining, 12) // varieties never share

    // The shop showed the first week for a 3 kg box; it no longer fits: told the week they would get, nothing booked.
    const d = await customerToken(api)
    const late = await book(d.accessToken, week, { qty: 1 })
    assert.deepEqual([late.status, late.body.error.code, late.body.error.weekStart, late.body.error.requested], [409, 'PREORDER_FULL', week2, week])
    assert.match(late.body.error.message, /just filled up\. Your order would be delivered in the week of /)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM preorders')).rows[0].n, 3)
    assert.equal(await taken(week2), 0)
    // Booked for the week it was shown: the second.
    const second = await book(d.accessToken, week2, { qty: 1 })
    assert.deepEqual([second.status, second.body.weekStart], [201, week2])
    // Without a week the API takes the earliest week with room for its kg and says which.
    const e = await customerToken(api)
    const any = await book(e.accessToken, undefined, { sku: 'ALP-5', qty: 1 })
    assert.deepEqual([any.status, any.body.weekStart], [201, week2], JSON.stringify(any.body))
    assert.deepEqual([await taken(week), await taken(week2)], [11, 8])
    // The box's own count and 074's one-per-booking count are kept; they decide nothing.
    assert.equal((await query(`SELECT reserved FROM preorder_capacity WHERE sku = 'ALP-5' AND week_start = $1`, [week])).rows[0].reserved, 1)
    assert.deepEqual([await orders(week), await orders(week2)], [3, 2])

    // Payment books it, once.
    const p = await pre(first.body.id)
    await payLink(p)
    await payLink(p) // a replayed webhook changes nothing
    const paid = await api.get(`/v1/preorders/${p.id}`, { token: a.accessToken })
    assert.deepEqual([paid.body.status, paid.body.paymentStatus], ['BOOKED', 'SUCCEEDED'])
    assert.deepEqual(await kinds(p.id), ['PREORDER_BOOKED'])
    assert.equal(await taken(week), 11)

    // The panel: each week with booked / limit in kg; operators see it.
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    const panel = await api.get('/admin/v1/preorder-weeks', { token: ops })
    assert.equal(panel.status, 200)
    assert.deepEqual([panel.body.limit, panel.body.countsBy, panel.body.nextWeek, panel.body.waitlisted], [12, 'kg', week, 0]) // other varieties still have the first week
    const alpWeek = (w) => w.varieties.find((v) => v.variety === 'Alphonso')
    assert.deepEqual(alpWeek(panel.body.weeks[0]), { variety: 'Alphonso', limit: 12, own: null, booked: 11, remaining: 1, over: 0, orders: 3 })
    assert.deepEqual(alpWeek(panel.body.weeks[1]), { variety: 'Alphonso', limit: 12, own: null, booked: 8, remaining: 4, over: 0, orders: 2 })
    assert.deepEqual([panel.body.weeks[0].booked, panel.body.weeks[0].orders, panel.body.weeks[0].boxes, panel.body.weeks[0].unpaid, panel.body.weeks[0].frozen], [11, 3, 3, 2, false])
    assert.deepEqual(panel.body.varieties.find((v) => v.variety === 'Alphonso'), { variety: 'Alphonso', dayKg: 1.714, listed: false, weekKg: 12, onSale: true, bookedKg: 19, bookings: 5 })
    assert.equal(panel.body.weeks.length, 26)
    assert.deepEqual(await preorderCapacityDrift({ query }), [])
  })

  test('a booking that does not fit goes to the next week, and a lighter one booked after it may still fit the earlier week', async () => {
    const week = openWeek()
    await setLimit(11)
    for (const extra of [{ qty: 1 }, { qty: 1 }]) await book((await customerToken(api)).accessToken, undefined, extra) // 6 of 11 kg
    const six = await book((await customerToken(api)).accessToken, undefined, { qty: 2 }) // 6 kg: 5 left, does not fit
    assert.equal(six.body.weekStart, addDays(week, 7))
    const five = await book((await customerToken(api)).accessToken, undefined, { sku: 'ALP-5', qty: 1 }) // 5 kg: fits the first week
    assert.equal(five.body.weekStart, week)
    assert.deepEqual([await taken(week), await taken(addDays(week, 7))], [11, 6])
  })

  test('a booking heavier than a whole week is refused at once, never looped over', async () => {
    const week = openWeek()
    await setLimit(5)
    const a = await customerToken(api)
    const big = await book(a.accessToken, week) // 2 x 3 kg = 6 kg
    assert.deepEqual([big.status, big.body.error.code, big.body.error.kg, big.body.error.limit], [409, 'PREORDER_TOO_BIG', 6, 5])
    assert.equal((await book(a.accessToken, week, { waitlist: true })).body.error.code, 'PREORDER_TOO_BIG') // nor waitlisted
    assert.equal((await book(a.accessToken, week, { sku: 'ALP-5', qty: 1 })).status, 201) // 5 kg fits
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM preorders')).rows[0].n, 1)
  })

  test('an unpaid hold that runs out frees its week: the next booking takes the first week again; a late payment still books', async () => {
    const week = openWeek()
    await setLimit(6)
    const a = await customerToken(api)
    const held = await book(a.accessToken, week)
    assert.equal(held.body.weekStart, week)
    const b = await customerToken(api)
    const second = await book(b.accessToken, undefined)
    assert.equal(second.body.weekStart, addDays(week, 7)) // the first week is held

    setNow(new Date(now().getTime() + 13 * 60_000).toISOString()) // A's 10-minute hold ran out, and the 2-minute gateway grace too
    const c = await customerToken(api)
    const again = await book(c.accessToken, week) // the lazy expiry frees the first week at booking
    assert.deepEqual([again.status, again.body.weekStart], [201, week], JSON.stringify(again.body))
    assert.equal((await pre(held.body.id)).status, 'CANCELLED')
    assert.deepEqual([await taken(week), await taken(addDays(week, 7))], [6, 6])

    // A pays after their hold ran out: still booked, even over the limit (as before).
    await payLink(await pre(held.body.id))
    assert.equal((await pre(held.body.id)).status, 'BOOKED')
    assert.equal(await taken(week), 12)
    assert.deepEqual(await preorderCapacityDrift({ query }), [])
  })

  test('the allocator turns a paid preorder into an order before regular shoppers can book that date', async () => {
    const week = openWeek()
    setNow(`${addDays(week, -6)}T04:30:00Z`) // 10:00 IST six days before: the horizon ends on Sunday
    await setCapacity(week, 10)
    const a = await customerToken(api)
    const booked = await book(a.accessToken, week)
    await payLink(await pre(booked.body.id))
    assert.equal((await runPreorderJobs()).converted, 0) // no stock yet

    await makeBatch({ age: 0, rating: 'RAW', lines: { 'ALP-3': 10 } }) // semi-ripe (age 6) on Monday
    const jobs = await runPreorderJobs()
    assert.equal(jobs.converted, 1)
    const p = await pre(booked.body.id)
    assert.equal(p.status, 'CONVERTED')
    const o = (await query('SELECT * FROM orders WHERE id = $1', [p.order_id])).rows[0]
    assert.equal(o.delivery_date, week)
    assert.equal(o.status, 'CONFIRMED')
    assert.equal(o.preorder_id, p.id)
    assert.equal(o.payment_id, p.payment_id)
    assert.equal(o.total, p.total)
    // A pre-order for yourself is P, and its delivery order keeps that number (order-number.js).
    assert.match(p.number, /^P\d{9}$/)
    assert.equal(o.number, p.number)
    const n = await query('SELECT kind FROM notifications WHERE order_id = $1', [o.id])
    // Semi-ripe boxes: the ripeness guide follows the confirmation (nothing is sold ripe now).
    assert.deepEqual(n.rows.map((r) => r.kind).sort(), ['ORDER_CONFIRMED', 'RIPENESS_GUIDE'])

    // A non-refundable pre-order's order can't be cancelled by the customer, from either side.
    const view = (await api.get(`/v1/orders/${o.id}`, { token: a.accessToken })).body
    assert.equal(view.canCancel, false)
    assert.deepEqual(view.preorder, { id: p.id, number: p.number, nonRefundable: true })
    const viaPre = await api.post(`/v1/preorders/${p.id}/cancel`, {}, { token: a.accessToken })
    assert.equal(viaPre.status, 409)
    assert.equal(viaPre.body.error.code, 'PREORDER_NON_REFUNDABLE')
    assert.equal(viaPre.body.error.message, "Pre-orders can't be cancelled once paid, unless we delay them. If something is wrong, message us.")
    const viaOrder = await api.post(`/v1/orders/${o.id}/cancel`, {}, { token: a.accessToken })
    assert.equal(viaOrder.status, 409)
    assert.equal(viaOrder.body.error.code, 'PREORDER_NON_REFUNDABLE')
    assert.equal((await query('SELECT status FROM orders WHERE id = $1', [o.id])).rows[0].status, 'CONFIRMED')

    // A booking sold before the rule keeps its promise: cancelling it cancels its order, with the full refund.
    await makeOld(p.id)
    assert.equal((await api.get(`/v1/orders/${o.id}`, { token: a.accessToken })).body.canCancel, true)
    const cancel = await api.post(`/v1/preorders/${p.id}/cancel`, {}, { token: a.accessToken })
    assert.equal(cancel.status, 204)
    const after = (await query('SELECT status, payment_status FROM orders WHERE id = $1', [o.id])).rows[0]
    assert.deepEqual(after, { status: 'CANCELLED', payment_status: 'REFUNDED' })
  })

  test("a manager's cancel of a converted non-refundable pre-order still refunds its order in full", async () => {
    const week = openWeek()
    setNow(`${addDays(week, -6)}T04:30:00Z`)
    await setCapacity(week, 10)
    const a = await customerToken(api)
    const booked = await book(a.accessToken, week)
    await payLink(await pre(booked.body.id))
    await makeBatch({ age: 0, rating: 'RAW', lines: { 'ALP-3': 10 } })
    assert.equal((await runPreorderJobs()).converted, 1)
    const p = await pre(booked.body.id)
    assert.equal(p.non_refundable, true)
    const r = await api.post(`/admin/v1/preorders/${p.id}/cancel`, { reason: 'crop failure', confirmCode: 'manager123' }, { token: admin })
    assert.ok(r.status < 300, JSON.stringify(r.body))
    const after = (await query('SELECT status, payment_status FROM orders WHERE id = $1', [p.order_id])).rows[0]
    assert.deepEqual(after, { status: 'CANCELLED', payment_status: 'REFUNDED' })
  })

  test('a week that passes without stock moves the preorder to the next week and tells the customer', async () => {
    const week = openWeek()
    await setCapacity(week, 10)
    const a = await customerToken(api)
    const booked = await book(a.accessToken, week)
    await payLink(await pre(booked.body.id))
    setNow(`${addDays(week, 7)}T04:30:00Z`)
    const jobs = await runPreorderJobs()
    assert.equal(jobs.moved, 1)
    const p = await pre(booked.body.id)
    assert.equal(p.status, 'BOOKED')
    assert.equal(p.week_start, addDays(week, 7))
    assert.equal(p.moved_count, 1)
    assert.deepEqual(await kinds(p.id), ['PREORDER_BOOKED', 'PREORDER_DELAYED']) // the delayed path (migration 079): flag, message, cancel right
  })

  test('a paid pre-order is non-refundable: the customer cancel is refused and nothing changes', async () => {
    const week = openWeek()
    await setCapacity(week, 2)
    const a = await customerToken(api)
    const booked = await book(a.accessToken, week)
    assert.equal(booked.body.nonRefundable, true)
    assert.equal(booked.body.canCancel, true) // unpaid: still the customer's to drop
    await payLink(await pre(booked.body.id))
    const view = (await api.get(`/v1/preorders/${booked.body.id}`, { token: a.accessToken })).body
    assert.deepEqual({ status: view.status, nonRefundable: view.nonRefundable, canCancel: view.canCancel }, { status: 'BOOKED', nonRefundable: true, canCancel: false })
    const r = await api.post(`/v1/preorders/${booked.body.id}/cancel`, {}, { token: a.accessToken })
    assert.equal(r.status, 409)
    assert.equal(r.body.error.code, 'PREORDER_NON_REFUNDABLE')
    const p = await pre(booked.body.id)
    assert.deepEqual({ status: p.status, payment_status: p.payment_status, refund_requested_at: p.refund_requested_at }, { status: 'BOOKED', payment_status: 'SUCCEEDED', refund_requested_at: null })
    assert.equal((await query('SELECT reserved FROM preorder_capacity WHERE sku = $1 AND week_start = $2', ['ALP-3', week])).rows[0].reserved, 2)
    assert.deepEqual(await kinds(p.id), ['PREORDER_BOOKED'])
  })

  test('unpaid and waitlisted pre-orders can still be dropped by the customer', async () => {
    const week = openWeek()
    await setLimit(6, { seasonEndsOn: addDays(week, 3) }) // one week of 6 kg (one 2 x 3 kg booking): the next one waits
    const a = await customerToken(api)
    const held = await book(a.accessToken, week)
    const b = await customerToken(api)
    const waiting = await book(b.accessToken, week, { waitlist: true })
    assert.equal(waiting.body.canCancel, true)
    assert.equal((await api.post(`/v1/preorders/${waiting.body.id}/cancel`, {}, { token: b.accessToken })).status, 204)
    assert.equal((await pre(waiting.body.id)).status, 'CANCELLED')
    assert.equal((await api.post(`/v1/preorders/${held.body.id}/cancel`, {}, { token: a.accessToken })).status, 204)
    const p = await pre(held.body.id)
    assert.deepEqual({ status: p.status, payment_status: p.payment_status, refund_requested_at: p.refund_requested_at }, { status: 'CANCELLED', payment_status: 'CANCELLED', refund_requested_at: null })
    assert.equal((await query('SELECT reserved FROM preorder_capacity WHERE sku = $1 AND week_start = $2', ['ALP-3', week])).rows[0].reserved, 0)
    assert.equal(await taken(week), 0)
    // A payment that lands after the customer dropped it is still refunded automatically.
    await payLink(p)
    const late = await pre(held.body.id)
    assert.equal(late.status, 'CANCELLED')
    assert.ok(late.refund_requested_at, 'the late payment is due back in full') // sent after the webhook answers
  })

  test("a manager's cancel of a paid non-refundable pre-order refunds it in full", async () => {
    const week = openWeek()
    await setCapacity(week, 2)
    const a = await customerToken(api)
    const booked = await book(a.accessToken, week)
    await payLink(await pre(booked.body.id))
    const r = await api.post(`/admin/v1/preorders/${booked.body.id}/cancel`, { reason: 'crop failure', confirmCode: 'manager123' }, { token: admin })
    assert.ok(r.status < 300, JSON.stringify(r.body))
    const p = await pre(booked.body.id)
    assert.equal(p.status, 'CANCELLED')
    assert.equal(p.payment_status, 'REFUNDED')
    assert.deepEqual(await kinds(p.id), ['PREORDER_BOOKED', 'REFUNDED'])
    // The panel's list shows it as non-refundable.
    const list = (await api.get('/admin/v1/preorders', { token: admin })).body
    assert.equal(list.find((x) => x.id === p.id).nonRefundable, true)
  })

  test('an older paid preorder (sold as refundable) cancelled before its week is refunded in full and frees its spot', async () => {
    const week = openWeek()
    await setLimit(6, { seasonEndsOn: addDays(week, 3) }) // one week of 6 kg (one 2 x 3 kg booking)
    const a = await customerToken(api)
    const booked = await book(a.accessToken, week)
    await payLink(await pre(booked.body.id))
    await makeOld(booked.body.id)
    const b = await customerToken(api)
    const waiting = await book(b.accessToken, week, { waitlist: true })

    assert.equal((await api.get(`/v1/preorders/${booked.body.id}`, { token: a.accessToken })).body.canCancel, true)
    assert.equal((await api.post(`/v1/preorders/${booked.body.id}/cancel`, {}, { token: b.accessToken })).status, 404)
    assert.equal((await api.post(`/v1/preorders/${booked.body.id}/cancel`, {}, { token: a.accessToken })).status, 204)
    const p = await pre(booked.body.id)
    assert.equal(p.status, 'CANCELLED')
    assert.equal(p.payment_status, 'REFUNDED')
    assert.match(p.refund_id, /^rfnd_dev_/)
    assert.deepEqual(await kinds(p.id), ['PREORDER_BOOKED', 'REFUNDED'])
    assert.equal((await runPreorderJobs()).promoted, 1)
    assert.equal((await pre(waiting.body.id)).status, 'PAYMENT_PENDING')
  })

  test('the dev payment route books a preorder, and a cancel after paying is refused as non-refundable', async () => {
    const week = openWeek()
    await setCapacity(week, 5)
    const a = await customerToken(api)
    const p = (await book(a.accessToken, week)).body
    assert.equal(p.address, '12, 4th Cross, Koramangala, Bengaluru')
    assert.equal((await api.post('/v1/dev/pay-preorder', { preorderId: p.id, outcome: 'failed' })).body.result, 'ignored')
    assert.equal((await api.get(`/v1/preorders/${p.id}`, { token: a.accessToken })).body.status, 'PAYMENT_PENDING')
    assert.equal((await api.post('/v1/dev/pay-preorder', { preorderId: p.id, outcome: 'captured' })).body.result, 'booked')
    const booked = (await api.get(`/v1/preorders/${p.id}`, { token: a.accessToken })).body
    assert.equal(booked.status, 'BOOKED')
    assert.equal(booked.paymentUrl, null)
    assert.equal(booked.nonRefundable, true)
    assert.equal((await api.post(`/v1/preorders/${p.id}/cancel`, {}, { token: a.accessToken })).body.error.code, 'PREORDER_NON_REFUNDABLE')
    const kept = (await api.get(`/v1/preorders/${p.id}`, { token: a.accessToken })).body
    assert.equal(kept.status, 'BOOKED')
    assert.equal(kept.refund, null)
  })
})

describe('season phase', () => {
  test('seasonPhase: OPEN without a start or from it, PREORDER before it once pre-orders open, BEFORE until then', () => {
    assert.equal(seasonPhase('2026-11-11', {}), 'OPEN')
    assert.equal(seasonPhase('2026-11-11', { seasonStartsOn: null, preorderOpensOn: '2027-01-01' }), 'OPEN')
    const cfg = { seasonStartsOn: '2027-03-01', preorderOpensOn: '2027-01-01' }
    assert.equal(seasonPhase('2026-12-31', cfg), 'BEFORE')
    assert.equal(seasonPhase('2027-01-01', cfg), 'PREORDER')
    assert.equal(seasonPhase('2027-02-28', cfg), 'PREORDER')
    assert.equal(seasonPhase('2027-03-01', cfg), 'OPEN')
    assert.equal(seasonPhase('2027-07-01', cfg), 'OPEN')
    // No opening day: pre-orders any day before the season.
    assert.equal(seasonPhase('2026-06-01', { seasonStartsOn: '2027-03-01', preorderOpensOn: null }), 'PREORDER')
  })

  test('the rules refuse pre-orders opening on or after the start, and a start on or after the end', () => {
    const base = currentConfig().rules
    assert.equal(rulesSchema.safeParse({ ...base, seasonStartsOn: '2027-03-01', preorderOpensOn: '2027-01-01' }).success, true)
    assert.equal(rulesSchema.safeParse({ ...base, seasonStartsOn: '2027-03-01', preorderOpensOn: '2027-03-01' }).success, false)
    assert.equal(rulesSchema.safeParse({ ...base, seasonStartsOn: '2027-03-01', seasonEndsOn: '2027-02-01' }).success, false)
    assert.equal(rulesSchema.safeParse({ ...base, seasonStartsOn: '2027-03-01', seasonEndsOn: '2027-07-31' }).success, true)
    assert.equal(rulesSchema.safeParse({ ...base, preorderOpensOn: '2027-01-01' }).success, true)
    assert.equal(base.seasonStartsOn, null)
    assert.equal(base.preorderOpensOn, null)
  })

  test('the catalogue and the weeks carry the season; booking is refused only before pre-orders open', async () => {
    const week = openWeek()
    await setCapacity(week, 5)
    const a = await customerToken(api)
    // Defaults: in season, and booking ahead works as before.
    assert.deepEqual((await api.get('/v1/catalogue?pincode=560034')).body.season, { phase: 'OPEN', startsOn: null, preorderOpensOn: null })
    const weeks0 = (await api.get('/v1/preorders/weeks')).body
    assert.deepEqual(weeks0.season, { phase: 'OPEN', startsOn: null, preorderOpensOn: null })
    assert.match(weeks0.cancelPolicy, /can’t be cancelled once you pay, unless we delay it: then you can cancel it for a full refund until it is packed\./)

    const today = todayIST()
    const first = addDays(week, 7) // the season starts on the Monday after `week`
    await setCapacity(first, 5)
    await setSeason(first, addDays(today, 1)) // before pre-orders open
    const before = { phase: 'BEFORE', startsOn: first, preorderOpensOn: addDays(today, 1) }
    assert.deepEqual((await api.get('/v1/catalogue?pincode=560034')).body.season, before)
    assert.deepEqual((await api.get('/v1/catalogue?pincode=999999')).body.season, before) // not served: still told
    assert.deepEqual((await api.get('/v1/preorders/weeks')).body.season, before)
    const refused = await book(a.accessToken, first)
    assert.equal(refused.status, 409)
    assert.equal(refused.body.error.code, 'PREORDERS_NOT_OPEN')
    assert.match(refused.body.error.message, /^Pre-orders open on /)

    await setSeason(first, today) // pre-orders open today
    const open = (await api.get('/v1/preorders/weeks')).body
    assert.equal(open.season.phase, 'PREORDER')
    // A week that ends before the season starts is not offered, whatever capacity it has.
    assert.deepEqual([...new Set(open.weeks.map((w) => w.weekStart))], [first])
    const early = await book(a.accessToken, week)
    assert.equal(early.status, 400)
    assert.equal(early.body.error.code, 'INVALID_WEEK')
    const ok = await book(a.accessToken, first)
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    assert.equal(ok.body.nonRefundable, true)
  })

  test('a pre-order can be booked as a gift, and the order it becomes carries the recipient', async () => {
    const week = openWeek()
    setNow(`${addDays(week, -6)}T04:30:00Z`)
    await setCapacity(week, 10)
    const a = await customerToken(api)
    const gift = { recipientName: '  Meera Iyer ', recipientPhone: '98450 12345', message: 'Happy birthday, Amma!' }
    const want = { recipientName: 'Meera Iyer', recipientPhone: '+919845012345', message: 'Happy birthday, Amma!' }

    // Checked as the checkout's gift.
    const badPhone = await book(a.accessToken, week, { gift: { ...gift, recipientPhone: '123' } })
    assert.equal(badPhone.status, 400)
    assert.match(badPhone.body.error.message, /gift\.recipientPhone/)
    const noName = await book(a.accessToken, week, { gift: { ...gift, recipientName: '   ' } })
    assert.equal(noName.status, 400)
    assert.match(noName.body.error.message, /gift\.recipientName: Enter the recipient's name/)
    const long = await book(a.accessToken, week, { gift: { ...gift, message: 'x'.repeat(201) } })
    assert.equal(long.status, 400)
    assert.match(long.body.error.message, /gift\.message/)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM preorders')).rows[0].n, 0)

    const plain = await book(a.accessToken, week, { qty: 1 })
    assert.equal(plain.status, 201, JSON.stringify(plain.body))
    assert.equal(plain.body.gift, null)
    await payLink(await pre(plain.body.id)) // one unpaid booking at a time
    const booked = await book(a.accessToken, week, { gift })
    assert.equal(booked.status, 201, JSON.stringify(booked.body))
    assert.deepEqual(booked.body.gift, want)
    const row = await pre(booked.body.id)
    assert.deepEqual([row.gift_recipient_name, row.gift_recipient_phone, row.gift_message], ['Meera Iyer', '+919845012345', 'Happy birthday, Amma!'])

    assert.deepEqual((await api.get(`/v1/preorders/${booked.body.id}`, { token: a.accessToken })).body.gift, want)
    const mine = (await api.get('/v1/preorders', { token: a.accessToken })).body
    assert.deepEqual(Object.fromEntries(mine.map((x) => [x.id, x.gift])), { [plain.body.id]: null, [booked.body.id]: want })
    const staff = (await api.get('/admin/v1/preorders', { token: admin })).body
    assert.deepEqual(staff.find((x) => x.id === booked.body.id).gift, want)
    assert.equal(staff.find((x) => x.id === plain.body.id).gift, null)

    await payLink(await pre(booked.body.id))
    await makeBatch({ age: 0, rating: 'RAW', lines: { 'ALP-3': 10 } })
    assert.equal((await runPreorderJobs()).converted, 2)
    const p = await pre(booked.body.id)
    const o = (await query('SELECT * FROM orders WHERE id = $1', [p.order_id])).rows[0]
    assert.deepEqual([o.gift_recipient_name, o.gift_recipient_phone, o.gift_message], ['Meera Iyer', '+919845012345', 'Happy birthday, Amma!'])
    assert.deepEqual((await api.get(`/v1/orders/${o.id}`, { token: a.accessToken })).body.gift, want)
    const plainOrder = (await query('SELECT gift_recipient_name FROM orders WHERE id = $1', [(await pre(plain.body.id)).order_id])).rows[0]
    assert.equal(plainOrder.gift_recipient_name, null)

    // A pre-order never fills the buyer's address book, gift or not.
    assert.deepEqual((await api.get('/v1/me/addresses', { token: a.accessToken })).body, [])
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM customer_addresses')).rows[0].n, 0)
  })

  test('a gift booking with no message stores null, and deleting the account blanks the recipient', async () => {
    const week = openWeek()
    await setCapacity(week, 10)
    const a = await customerToken(api)
    const r = await book(a.accessToken, week, { gift: { recipientName: 'Ravi', recipientPhone: '+91 98450 54321', message: '' } })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.deepEqual(r.body.gift, { recipientName: 'Ravi', recipientPhone: '+919845054321', message: null })
    const row = await pre(r.body.id)
    await tx((c) => eraseCustomer(c, row.customer_id, { force: true }))
    const gone = await pre(r.body.id)
    assert.deepEqual([gone.gift_recipient_name, gone.gift_recipient_phone, gone.gift_message], [null, null, null])
  })
})

// A gift for several people as pre-orders (migration 071, docs/gifting.md "Before the season"):
// one gift pre-order per person, booked together, paid once.
describe('gift pre-orders for several people', () => {
  const saved = env.MULTI_GIFT
  beforeEach(() => { env.MULTI_GIFT = true })
  after(() => { env.MULTI_GIFT = saved })

  const person = (week, i, extra = {}) => ({
    sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1, weekStart: week, pincode: '560034', address: `${i}, 4th Cross, Koramangala, Bengaluru`,
    gift: { recipientName: `Friend ${i}`, recipientPhone: `98450 1234${i}`, message: i === 1 ? 'Happy summer!' : null }, ...extra,
  })
  const bookGroup = (token, recipients, key = newId('idem')) => api.post('/v1/preorders/groups', { recipients }, { token, headers: { 'Idempotency-Key': key } })
  const capOf = async (week, sku = 'ALP-3') => (await query('SELECT reserved FROM preorder_capacity WHERE sku = $1 AND week_start = $2', [sku, week])).rows[0]?.reserved ?? 0
  const members = async (groupId) => (await query('SELECT * FROM preorders WHERE group_id = $1 ORDER BY group_position', [groupId])).rows
  const groupRow = async (id) => (await query('SELECT * FROM preorder_groups WHERE id = $1', [id])).rows[0]
  async function payGroup(groupId, paymentId = `pay_${groupId}`) {
    const [lead] = await members(groupId)
    const g = await groupRow(groupId)
    const { raw, signature } = signWebhook({
      event: 'payment_link.paid',
      payload: {
        payment_link: { entity: { id: lead.payment_link_id, notes: { preorderId: lead.id }, status: 'paid' } },
        payment: { entity: { id: paymentId, amount: g.total, method: 'upi' } },
      },
    })
    const r = await api.raw('POST', '/webhooks/razorpay', { raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return r.body
  }
  async function setup() {
    const week = openWeek()
    setNow(`${addDays(week, -6)}T04:30:00Z`)
    await setCapacity(week, 10)
    assert.equal((await api.put(`/admin/v1/preorder-capacity/${week}/ALP-5`, { capacity: 10 }, { token: admin })).status, 200)
    return { week, a: await customerToken(api) }
  }

  test('booked together for 3 people, paid once: every booking BOOKED; converted with each recipient', async () => {
    const { week, a } = await setup()
    const people = [person(week, 1, { qty: 2 }), person(week, 2, { sku: 'ALP-5' }), person(week, 3)]
    const key = newId('idem')
    const r = await bookGroup(a.accessToken, people, key)
    assert.equal(r.status, 201, JSON.stringify(r.body))
    const g = r.body
    // The group and every booking in it: G numbers, all from the one G sequence (order-number.js).
    assert.match(g.number, /^G\d{9}$/)
    assert.deepEqual([g.status, g.paymentStatus, g.recipientCount, g.boxes, g.nonRefundable, g.canCancel], ['PAYMENT_PENDING', 'INITIATED', 3, 4, true, true])
    assert.equal(g.preorders.length, 3)
    assert.equal(g.total, g.preorders.reduce((t, p) => t + p.total, 0))
    assert.deepEqual(g.preorders.map((p) => [p.status, p.weekStart, p.gift.recipientName, p.nonRefundable, p.group.number, p.group.people]), [
      ['PAYMENT_PENDING', week, 'Friend 1', true, g.number, 3], ['PAYMENT_PENDING', week, 'Friend 2', true, g.number, 3], ['PAYMENT_PENDING', week, 'Friend 3', true, g.number, 3],
    ])
    assert.ok(g.paymentUrl)
    const rows = await members(g.id)
    // One link for the whole group, on every booking; each week's capacity taken.
    assert.equal(new Set(rows.map((p) => p.payment_link_id)).size, 1)
    assert.equal(rows[0].payment_link_id, (await groupRow(g.id)).payment_link_id)
    assert.deepEqual([await capOf(week), await capOf(week, 'ALP-5')], [3, 1])
    // The same key again: the same group, not a second one.
    const again = await bookGroup(a.accessToken, people, key)
    assert.deepEqual([again.status, again.body.id], [200, g.id])
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM preorder_groups')).rows[0].n, 1)

    // The shop's lists show each booking with the group.
    const mine = (await api.get('/v1/preorders', { token: a.accessToken })).body
    assert.deepEqual(mine.map((p) => p.group?.number).filter(Boolean).length, 3)
    assert.equal(mine[0].group.total, g.total)
    const staff = (await api.get('/admin/v1/preorders', { token: admin })).body
    assert.deepEqual(staff.filter((p) => p.group).map((p) => [p.gift.recipientName, p.group.people]), [['Friend 1', 3], ['Friend 2', 3], ['Friend 3', 3]])

    // One payment books them all; each booking records its own amount; the payment id stays on the group.
    await payGroup(g.id)
    const paid = await members(g.id)
    assert.deepEqual(paid.map((p) => [p.status, p.payment_status, p.paid_amount, p.payment_id]), paid.map((p) => ['BOOKED', 'SUCCEEDED', p.total, null]))
    const gr = await groupRow(g.id)
    assert.deepEqual([gr.status, gr.payment_status, gr.payment_id, gr.paid_amount], ['PAID', 'SUCCEEDED', `pay_${g.id}`, g.total])
    // A replay changes nothing; a second payment is a duplicate (refunded), not a second booking.
    await payGroup(g.id)
    await payGroup(g.id, 'pay_second')
    assert.equal((await query(`SELECT COUNT(*)::int AS n FROM duplicate_payments WHERE payment_id = 'pay_second'`)).rows[0].n, 1)
    const view = (await api.get(`/v1/preorders/groups/${g.id}`, { token: a.accessToken })).body
    assert.deepEqual([view.status, view.canCancel, view.paymentUrl], ['PAID', false, null])
    // Paid: non-refundable for the buyer.
    const no = await api.post(`/v1/preorders/${paid[1].id}/cancel`, {}, { token: a.accessToken })
    assert.deepEqual([no.status, no.body.error.code], [409, 'PREORDER_NON_REFUNDABLE'])

    // The allocator turns each into a delivery order carrying its own recipient.
    await makeBatch({ age: 0, rating: 'RAW', lines: { 'ALP-3': 10, 'ALP-5': 10 } })
    const jobs = await runPreorderJobs()
    assert.equal(jobs.converted, 3, JSON.stringify([jobs, (await members(g.id)).map((p) => [p.sku, p.stage, p.status])]))
    for (const [i, p] of (await members(g.id)).entries()) {
      assert.equal(p.status, 'CONVERTED')
      const o = (await query('SELECT * FROM orders WHERE id = $1', [p.order_id])).rows[0]
      assert.deepEqual([o.gift_recipient_name, o.gift_recipient_phone, o.preorder_id], [`Friend ${i + 1}`, `+91984501234${i + 1}`, p.id])
      // Each person's delivery order keeps their booking's own G number: one number from booking to doorstep.
      assert.match(p.number, /^G\d{9}$/)
      assert.equal(o.number, p.number)
    }
    const gs = [g.number, ...(await members(g.id)).map((p) => p.number)]
    assert.equal(new Set(gs).size, 4, gs.join())
    // Someone else's group answers 404.
    const b = await customerToken(api)
    assert.equal((await api.get(`/v1/preorders/groups/${g.id}`, { token: b.accessToken })).status, 404)
  })

  test('an unpaid group is one unpaid booking; cancelling before paying cancels the whole group and frees its weeks', async () => {
    const { week, a } = await setup()
    const g = (await bookGroup(a.accessToken, [person(week, 1), person(week, 2, { qty: 2 })])).body
    assert.equal(await capOf(week), 3)
    const single = await book(a.accessToken, week, { qty: 1 })
    assert.equal(single.body.error.code, 'UNPAID_PREORDER_EXISTS')
    const second = await bookGroup(a.accessToken, [person(week, 3)])
    assert.equal(second.body.error.code, 'UNPAID_PREORDER_EXISTS')
    const [, two] = await members(g.id)
    assert.equal((await api.post(`/v1/preorders/${two.id}/cancel`, {}, { token: a.accessToken })).status, 204)
    assert.deepEqual((await members(g.id)).map((p) => [p.status, p.payment_status]), [['CANCELLED', 'CANCELLED'], ['CANCELLED', 'CANCELLED']])
    assert.equal(await capOf(week), 0)
    assert.equal((await api.get(`/v1/preorders/groups/${g.id}`, { token: a.accessToken })).body.status, 'CANCELLED')
    // Now another booking may be made.
    assert.equal((await book(a.accessToken, week, { qty: 1 })).status, 201)
    // A payment that lands after the cancel is refunded, booking by booking.
    await payGroup(g.id)
    const after1 = await members(g.id)
    assert.ok(after1.every((p) => p.status === 'CANCELLED' && p.refund_requested_at), JSON.stringify(after1.map((p) => [p.status, p.refund_requested_at])))
  })

  test('a hold that runs out frees every week; a late payment still books them all', async () => {
    const { week, a } = await setup()
    const g = (await bookGroup(a.accessToken, [person(week, 1), person(week, 2, { sku: 'ALP-5' })])).body
    assert.deepEqual([await capOf(week), await capOf(week, 'ALP-5')], [1, 1])
    setNow(new Date(now().getTime() + 60 * 60_000))
    await runPreorderJobs()
    assert.deepEqual((await members(g.id)).map((p) => p.status), ['CANCELLED', 'CANCELLED'])
    assert.deepEqual([await capOf(week), await capOf(week, 'ALP-5')], [0, 0])
    assert.equal((await api.get(`/v1/preorders/groups/${g.id}`, { token: a.accessToken })).body.status, 'CANCELLED')
    // Not an unpaid booking any more.
    assert.equal((await book(a.accessToken, week, { qty: 1 })).status, 201)
    await payGroup(g.id)
    assert.deepEqual((await members(g.id)).map((p) => p.status), ['BOOKED', 'BOOKED'])
    assert.deepEqual([await capOf(week), await capOf(week, 'ALP-5')], [2, 1])
  })

  test('a group straddles two weeks by kg; a week that filled since the shop showed it fails the whole group, naming the person', async () => {
    const { week, a } = await setup()
    const week2 = addDays(week, 7)
    await setLimit(9)
    // Someone else takes 3 kg of the first week.
    assert.equal((await book((await customerToken(api)).accessToken, week, { qty: 1 })).status, 201)
    // Shown: everyone in the first week, but the third person's 3 kg no longer fits (3 + 3 + 3 = 9).
    const stale = await bookGroup(a.accessToken, [person(week, 1), person(week, 2), person(week, 3)])
    assert.deepEqual([stale.status, stale.body.error.code, stale.body.error.row, stale.body.error.weekStart], [409, 'PREORDER_FULL', 3, week2])
    assert.match(stale.body.error.message, /^Person 3: /)
    assert.deepEqual([await taken(week), await taken(week2)], [3, 0]) // nothing kept
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM preorder_groups')).rows[0].n, 0)
    // Person 2's 5 kg box does not fit what is left (3 kg after person 1), so it goes to the next week; person 3's
    // 3 kg box still fits the first week. Each person's boxes stay together.
    const ok = await bookGroup(a.accessToken, [person(week, 1), person(week2, 2, { sku: 'ALP-5' }), person(week, 3)])
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    assert.deepEqual(ok.body.preorders.map((p) => p.weekStart), [week, week2, week])
    assert.deepEqual([await taken(week), await taken(week2)], [9, 5])
    // Cancelled before paying: every person's week gets its kg back.
    assert.equal((await api.post(`/v1/preorders/${ok.body.preorders[0].id}/cancel`, {}, { token: a.accessToken })).status, 204)
    assert.deepEqual([await taken(week), await taken(week2)], [3, 0])
    // Checked as any gift: a bad mobile is refused with its field.
    const bad = await bookGroup(a.accessToken, [person(week, 1, { gift: { recipientName: 'X', recipientPhone: '123' } })])
    assert.equal(bad.status, 400)
    assert.match(bad.body.error.message, /recipients\.0\.gift\.recipientPhone/)
    assert.equal((await api.post('/v1/preorders/groups', { recipients: [person(week, 1)] }, { token: a.accessToken })).body.error.code, 'IDEMPOTENCY_KEY_REQUIRED')
  })

  test('a group without weeks: each person gets the earliest week with room, in list order', async () => {
    const { week, a } = await setup()
    await setLimit(6) // two 3 kg boxes a week
    const r = await bookGroup(a.accessToken, [1, 2, 3, 4, 5].map((i) => person(null, i)))
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.deepEqual(r.body.preorders.map((p) => p.weekStart), [week, week, addDays(week, 7), addDays(week, 7), addDays(week, 14)])
  })

  test('staff cancel of one paid booking refunds its own amount from the group payment; MULTI_GIFT off answers 404', async () => {
    const { week, a } = await setup()
    const g = (await bookGroup(a.accessToken, [person(week, 1), person(week, 2, { qty: 3 })])).body
    await payGroup(g.id)
    const [, two] = await members(g.id)
    const r = await api.post(`/admin/v1/preorders/${two.id}/cancel`, { reason: 'Week closed', confirmCode: 'manager123' }, { token: admin })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    await refundPreorder(two.id)
    const after2 = await members(g.id)
    assert.deepEqual(after2.map((p) => p.status), ['BOOKED', 'CANCELLED'])
    assert.equal(after2[1].payment_status, 'REFUNDED')
    assert.equal(after2[1].paid_amount, two.total)
    env.MULTI_GIFT = false
    assert.equal((await bookGroup(a.accessToken, [person(week, 1)])).status, 404)
    assert.equal((await api.get(`/v1/preorders/groups/${g.id}`, { token: a.accessToken })).status, 404)
  })
})

// One weekly limit for every box, weeks that exist by themselves (migration 074), and the season's dates (075).
describe('delivery weeks', () => {
  test('bookings at once never take a week past its limit; the rest go to the next weeks in order', async () => {
    const week = openWeek()
    await setLimit(9) // three 3 kg boxes a week
    const people = await Promise.all(Array.from({ length: 8 }, () => customerToken(api)))
    const all = await Promise.all(people.map((t) => book(t.accessToken, undefined, { qty: 1 })))
    assert.ok(all.every((r) => r.status === 201), JSON.stringify(all.map((r) => r.body)))
    const count = (w) => all.filter((r) => r.body.weekStart === w).length
    assert.deepEqual([count(week), count(addDays(week, 7)), count(addDays(week, 14))], [3, 3, 2])
    assert.deepEqual([await taken(week), await taken(addDays(week, 7)), await taken(addDays(week, 14))], [9, 9, 6])
    // The same with the week the shop showed (2 of 3 taken): exactly one more gets it, the rest are told the next week.
    const more = await Promise.all(Array.from({ length: 5 }, () => customerToken(api)))
    const shown = addDays(week, 14)
    const tries = await Promise.all(more.map((t) => book(t.accessToken, shown, { qty: 1 })))
    assert.deepEqual(tries.map((r) => r.status).sort(), [201, 409, 409, 409, 409])
    assert.ok(tries.filter((r) => r.status === 409).every((r) => r.body.error.code === 'PREORDER_FULL' && r.body.error.weekStart === addDays(week, 21)))
    assert.equal(await taken(shown), 9)
    assert.deepEqual(await preorderCapacityDrift({ query }), [])
  })

  test('cancel, hold expiry and a move for want of stock keep the week counters right', async () => {
    const week = openWeek()
    const week2 = addDays(week, 7)
    await setLimit(12)
    const a = await customerToken(api)
    const paid = await book(a.accessToken, week)
    await payLink(await pre(paid.body.id))
    const b = await customerToken(api)
    const unpaid = await book(b.accessToken, week)
    assert.equal(await taken(week), 12)
    // The customer drops an unpaid booking: its kg goes back.
    assert.equal((await api.post(`/v1/preorders/${unpaid.body.id}/cancel`, {}, { token: b.accessToken })).status, 204)
    assert.equal(await taken(week), 6)
    // A manager cancels a booking (here unpaid, by the shop): its kg goes back too.
    const c = await customerToken(api)
    const third = await book(c.accessToken, week)
    assert.equal(await taken(week), 12)
    const r = await api.post(`/admin/v1/preorders/${third.body.id}/cancel`, { reason: 'test', confirmCode: 'manager123' }, { token: admin })
    assert.ok(r.status < 300, JSON.stringify(r.body))
    assert.equal(await taken(week), 6)
    // The hold job frees a hold that ran out.
    const d = await customerToken(api)
    await book(d.accessToken, week)
    assert.equal(await taken(week), 12)
    setNow(new Date(now().getTime() + 13 * 60_000).toISOString())
    assert.equal((await runPreorderJobs()).expired, 1)
    assert.equal(await taken(week), 6)
    // The week passes without stock: the paid booking moves to the next week, its kg with it.
    setNow(`${addDays(week, 7)}T04:30:00Z`)
    assert.equal((await runPreorderJobs()).moved, 1)
    assert.equal((await pre(paid.body.id)).week_start, week2)
    assert.deepEqual([await taken(week), await taken(week2)], [0, 6])
    assert.deepEqual([await orders(week), await orders(week2)], [0, 1])
    assert.deepEqual(await preorderCapacityDrift({ query }), [])
  })

  test('the waitlist opens only when every week to the season end is full, and a freed place goes to it', async () => {
    const week = openWeek()
    const week2 = addDays(week, 7)
    await setLimit(6, { seasonEndsOn: addDays(week2, 2) }) // two weeks this season, one 6 kg booking each
    assert.deepEqual(await tx((c) => deliveryWeeks(c)), [week, week2])
    const a = await customerToken(api)
    const first = await book(a.accessToken, undefined)
    const b = await customerToken(api)
    // The first week is full but the second has room: booked there, never the waitlist.
    const second = await book(b.accessToken, week, { waitlist: true })
    assert.deepEqual([second.status, second.body.error.code, second.body.error.weekStart], [409, 'PREORDER_FULL', week2])
    const ok = await book(b.accessToken, week2, { waitlist: true })
    assert.deepEqual([ok.status, ok.body.status, ok.body.weekStart], [201, 'PAYMENT_PENDING', week2])
    // Now every week is full.
    const weeks = (await api.get('/v1/preorders/weeks')).body
    assert.equal(weeks.boxes.find((x) => x.sku === 'ALP-3').nextWeek, null) // Alphonso is full; other varieties still have room
    assert.deepEqual(alp(weeks).map((w) => w.remaining), [0, 0])
    assert.deepEqual([...new Set(weeks.weeks.filter((w) => w.variety === 'Alphonso').map((w) => w.weekStart))], [week]) // the first week only, full: the shop offers the waitlist
    const c = await customerToken(api)
    const refused = await book(c.accessToken, week)
    assert.deepEqual([refused.status, refused.body.error.code, refused.body.error.weekStart], [409, 'PREORDER_FULL', null])
    assert.match(refused.body.error.message, /Every delivery week of Alphonso this season is fully booked/)
    const wait = await book(c.accessToken, week, { waitlist: true })
    assert.deepEqual([wait.status, wait.body.status, wait.body.paymentUrl], [201, 'WAITLISTED', null])
    assert.equal(wait.body.weekStart, week2) // held on the season's last week until a spot opens
    assert.equal((await api.get('/admin/v1/preorder-weeks', { token: admin })).body.waitlisted, 1)
    // A drops their unpaid booking: the first week's place goes to the waitlist, in that week.
    assert.equal((await api.post(`/v1/preorders/${first.body.id}/cancel`, {}, { token: a.accessToken })).status, 204)
    assert.equal((await runPreorderJobs()).promoted, 1)
    const promoted = await pre(wait.body.id)
    assert.deepEqual([promoted.status, promoted.week_start], ['PAYMENT_PENDING', week])
    assert.ok(promoted.payment_link_url)
    assert.deepEqual(await kinds(promoted.id), ['PREORDER_SPOT_OPEN'])
    assert.deepEqual([await taken(week), await taken(week2)], [6, 6])
  })

  test('before the season: the first week is the one holding the season start, then week after week to its end', async () => {
    const today = todayIST()
    let start = addDays(today, 40)
    while (new Date(`${start}T00:00:00Z`).getUTCDay() !== 3) start = addDays(start, 1) // a Wednesday
    const monday = addDays(start, -2)
    await saveConfig({ ...currentConfig().rules, seasonStartsOn: start, preorderOpensOn: today, seasonEndsOn: addDays(start, 30) }, 'test')
    const weeks = await tx((c) => deliveryWeeks(c))
    assert.deepEqual(weeks, [0, 1, 2, 3, 4].map((i) => addDays(monday, 7 * i)))
    const body = (await api.get('/v1/preorders/weeks')).body
    assert.deepEqual([body.season.phase, body.firstWeek, body.nextWeek.weekStart], ['PREORDER', monday, monday])
    const a = await customerToken(api)
    const r = await book(a.accessToken, undefined)
    assert.deepEqual([r.status, r.body.weekStart], [201, monday])
    // A season that has ended leaves no week: booking is refused.
    await saveConfig({ ...currentConfig().rules, seasonStartsOn: null, preorderOpensOn: null, seasonEndsOn: addDays(today, 1) }, 'test')
    assert.deepEqual((await api.get('/v1/preorders/weeks')).body.weeks, [])
    assert.equal((await book((await customerToken(api)).accessToken, undefined)).body.error.code, 'INVALID_WEEK')
  })

  test('a week counter that drifts shows on Needs attention as all boxes and a manager recounts it', async () => {
    const week = openWeek()
    const a = await customerToken(api)
    await book(a.accessToken, week)
    await query('UPDATE preorder_week_kg SET reserved_kg = 15.5 WHERE week_start = $1', [week])
    assert.deepEqual(await preorderCapacityDrift({ query }), [{ sku: 'ALL', weekStart: week, reserved: 15.5, booked: 6 }])
    const r = await api.post(`/admin/v1/preorder-capacity/${week}/ALL/recount`, { reason: 'checked the bookings', reserved: 15.5, booked: 6 }, { token: admin })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual([r.body.recounted, r.body.before, r.body.reserved], [true, 15.5, 6])
    assert.equal(await taken(week), 6)
    assert.deepEqual(await preorderCapacityDrift({ query }), [])
  })

  test('migration 074 backfills each week from the bookings that hold it, one per booking', async () => {
    const week = openWeek()
    const ids = []
    for (const qty of [1, 3, 2]) ids.push((await book((await customerToken(api)).accessToken, undefined, { qty })).body.id)
    await payLink(await pre(ids[0]))
    await query(`UPDATE preorders SET status = 'CANCELLED' WHERE id = $1`, [ids[2]])
    // As on a database from before 074: one booking in a later week, a waitlisted one, no counters.
    await query(`UPDATE preorders SET week_start = $2 WHERE id = $1`, [ids[1], addDays(week, 14)])
    await query('DROP TABLE preorder_weeks')
    await tx(async (c) => c.query(await migration('074_preorder_weeks.sql')))
    assert.deepEqual((await query('SELECT week_start, reserved FROM preorder_weeks ORDER BY week_start')).rows, [
      { week_start: week, reserved: 1 }, { week_start: addDays(week, 14), reserved: 1 },
    ])
    // Run again: the same counts.
    await tx(async (c) => c.query(await migration('074_preorder_weeks.sql')))
    assert.equal(await orders(week), 1)
  })

  test('migration 075 sets the season dates only when the live rules have no start, and once', async () => {
    const sql = await migration('075_season_dates.sql')
    const latest = async () => (await query('SELECT version, value, changed_by FROM app_config ORDER BY version DESC LIMIT 1')).rows[0]
    const v0 = (await latest()).version
    // Live rules with no season start (and last season's end): dates set, the stale end cleared, the rest kept.
    await query(`INSERT INTO app_config (version, value, changed_by) VALUES ($1, $2, 'manager@x')`, [v0 + 1, { ...DEFAULT_RULES, holdMinutes: 7, seasonEndsOn: '2026-07-31' }])
    await tx(async (c) => c.query(sql))
    const now1 = await latest()
    assert.deepEqual([now1.version, now1.changed_by], [v0 + 2, 'system'])
    assert.deepEqual([now1.value.seasonStartsOn, now1.value.preorderOpensOn, now1.value.seasonEndsOn, now1.value.holdMinutes], ['2027-03-01', '2026-11-01', null, 7])
    await loadConfig()
    assert.equal(getConfig().seasonStartsOn, '2027-03-01')
    // Again: nothing.
    await tx(async (c) => c.query(sql))
    assert.equal((await latest()).version, v0 + 2)
    // Missing keys (an old version): set; a later season end is kept.
    const { seasonStartsOn, preorderOpensOn, ...old } = DEFAULT_RULES
    void seasonStartsOn
    void preorderOpensOn
    await query(`INSERT INTO app_config (version, value, changed_by) VALUES ($1, $2, 'manager@x')`, [v0 + 3, { ...old, seasonEndsOn: '2027-07-31' }])
    await tx(async (c) => c.query(sql))
    const now2 = await latest()
    assert.deepEqual([now2.version, now2.value.seasonStartsOn, now2.value.preorderOpensOn, now2.value.seasonEndsOn], [v0 + 4, '2027-03-01', '2026-11-01', '2027-07-31'])
    // A start a manager chose is left alone.
    await query(`INSERT INTO app_config (version, value, changed_by) VALUES ($1, $2, 'manager@x')`, [v0 + 5, { ...DEFAULT_RULES, seasonStartsOn: '2027-04-01', preorderOpensOn: null }])
    await tx(async (c) => c.query(sql))
    assert.equal((await latest()).version, v0 + 5)
    // A fresh database (no rules saved yet): nothing.
    await query('DELETE FROM app_config')
    await tx(async (c) => c.query(sql))
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM app_config')).rows[0].n, 0)
    await loadConfig()
  })

  test('the live case: season dates set by 075, old per-box rows only, and every box can be pre-ordered with no staff action', async () => {
    // Two old capacity rows, as on the live database; no week counters.
    const old = addDays(openWeek(), 7 * 20)
    await setCapacity(old, 5)
    await query(`UPDATE app_config SET value = value - 'seasonStartsOn' - 'preorderOpensOn'`)
    await tx(async (c) => c.query(await migration('075_season_dates.sql')))
    await loadConfig()
    setNow('2026-11-18T04:30:00Z')
    const body = (await api.get('/v1/preorders/weeks')).body
    assert.deepEqual([body.season.phase, body.firstWeek, body.nextWeek?.weekStart], ['PREORDER', '2027-03-01', '2027-03-01'])
    const skus = (await query('SELECT sku FROM products WHERE active ORDER BY sku')).rows.map((r) => r.sku)
    assert.deepEqual([...new Set(body.weeks.map((w) => w.sku))].sort(), skus)
    for (const sku of skus) {
      const r = await book((await customerToken(api)).accessToken, '2027-03-01', { sku, qty: 1 })
      assert.deepEqual([r.status, r.body.weekStart], [201, '2027-03-01'], `${sku}: ${JSON.stringify(r.body)}`)
    }
  })
})

// The limit in kg (migration 076): the daily amount x 7, a week's own expected kg, and staff moves.
describe('delivery weeks in kg', () => {
  test("migration 076 records each booking's kg, recounts each week in kg, and adds the daily rule once", async () => {
    const week = openWeek()
    const ids = []
    for (const extra of [{ qty: 1 }, { qty: 2 }, { sku: 'ALP-5', qty: 3 }]) ids.push((await book((await customerToken(api)).accessToken, undefined, extra)).body.id)
    await payLink(await pre(ids[0]))
    await query(`UPDATE preorders SET status = 'CANCELLED' WHERE id = $1`, [ids[1]])
    await query(`UPDATE preorders SET week_start = $2 WHERE id = $1`, [ids[2], addDays(week, 7)])
    // As on a database from before 076: no kg on bookings, no kg counters, rules without the daily amount.
    await query('UPDATE preorders SET load_kg = NULL')
    await query('DROP TABLE preorder_week_kg')
    const { preorderDayKg, ...older } = currentConfig().rules
    void preorderDayKg
    const v0 = (await query('SELECT MAX(version)::int AS v FROM app_config')).rows[0].v
    await query(`INSERT INTO app_config (version, value, changed_by) VALUES ($1, $2, 'manager@x')`, [v0 + 1, { ...older, preorderWeekLimit: 1000 }])
    const sql = await migration('076_preorder_week_kg.sql')
    await tx(async (c) => c.query(sql))
    assert.deepEqual((await query('SELECT load_kg FROM preorders ORDER BY created_at')).rows.map((r) => Number(r.load_kg)), [3, 6, 15])
    assert.deepEqual([await taken(week), await taken(addDays(week, 7))], [3, 15])
    const live = (await query('SELECT version, value, changed_by FROM app_config ORDER BY version DESC LIMIT 1')).rows[0]
    assert.deepEqual([live.version, live.changed_by, live.value.preorderDayKg, live.value.preorderWeekLimit], [v0 + 2, 'system', 1000, 1000])
    await loadConfig()
    assert.equal((await api.get('/v1/preorders/weeks')).body.limit, 140) // 20 kg a day for a variety not listed (078); 076's daily kg decides nothing now
    // Run again: nothing more.
    await tx(async (c) => c.query(sql))
    assert.equal((await query('SELECT MAX(version)::int AS v FROM app_config')).rows[0].v, v0 + 2)
    assert.equal(await taken(week), 3)
    // A fresh database (no rules yet): no rules version is added.
    await query('DELETE FROM app_config')
    await tx(async (c) => c.query(sql))
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM app_config')).rows[0].n, 0)
    await loadConfig()
  })

  test("a week's own expected kg: set by managers, lowered below what is booked, raised to reopen, back to the default", async () => {
    const week = openWeek()
    const week2 = addDays(week, 7)
    const week3 = addDays(week, 14)
    await setLimit(6) // default: one 2 x 3 kg booking a week
    const setWeek = (weekStart, limitKg, token = admin) => api.put(`/admin/v1/preorder-weeks/${weekStart}`, { limitKg, variety: 'Alphonso' }, { token })
    // Roles and checks.
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    assert.equal((await setWeek(week, 12, ops)).status, 403)
    assert.equal((await setWeek(week, -1)).status, 400)
    assert.equal((await api.put(`/admin/v1/preorder-weeks/${week}`, { limitKg: 12, extra: 1 }, { token: admin })).status, 400)
    assert.equal((await setWeek(addDays(week, 1), 12)).status, 400) // not a Monday
    assert.equal((await setWeek(addDays(week, -7), 12)).body.error.code, 'INVALID_WEEK') // not a delivery week
    // More fruit expected in the first week: 12 kg there, 6 kg elsewhere.
    const set = await setWeek(week, 12)
    assert.equal(set.status, 200, JSON.stringify(set.body))
    assert.deepEqual([set.body.limit, set.body.own, set.body.remaining], [12, 12, 12])
    const pub = alp((await api.get('/v1/preorders/weeks')).body).slice(0, 2)
    assert.deepEqual(pub, [{ weekStart: week, limit: 12, remaining: 12 }, { weekStart: week2, limit: 6, remaining: 6 }])
    const ids = []
    for (let i = 0; i < 3; i++) {
      const r = await book((await customerToken(api)).accessToken, undefined)
      ids.push(r.body.id)
      assert.equal(r.body.weekStart, [week, week, week2][i])
    }
    // The harvest comes in short: lowered below what is booked. Allowed; new pre-orders skip it; nothing moves.
    const short = await setWeek(week, 9)
    assert.deepEqual([short.body.limit, short.body.booked, short.body.remaining, short.body.over], [9, 12, 0, 3])
    const panel = (await api.get('/admin/v1/preorder-weeks', { token: admin })).body.weeks[0].varieties.find((v) => v.variety === 'Alphonso')
    assert.deepEqual([panel.own, panel.booked, panel.over], [9, 12, 3])
    const skip = await book((await customerToken(api)).accessToken, undefined, { qty: 1 })
    assert.equal(skip.body.weekStart, week3) // the first week is over, the second full
    assert.deepEqual((await query('SELECT week_start FROM preorders WHERE id = ANY($1) ORDER BY created_at', [ids])).rows.map((r) => r.week_start), [week, week, week2])

    // A manager moves a paid booking out of the over week: only to a week with room for its kg.
    await payLink(await pre(ids[1]))
    const move = (id, weekStart, token = admin) => api.post(`/admin/v1/preorders/${id}/move`, { weekStart, reason: 'short harvest' }, { token })
    assert.equal((await move(ids[1], week3, ops)).status, 403)
    const noRoom = await move(ids[1], week3) // 3 of 6 kg taken: 6 kg does not fit
    assert.deepEqual([noRoom.status, noRoom.body.error.code], [409, 'PREORDER_FULL'])
    assert.equal((await setWeek(week3, 12)).status, 200)
    const moved = await move(ids[1], week3)
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    assert.deepEqual([moved.body.weekStart, moved.body.movedCount, moved.body.status], [week3, 1, 'BOOKED'])
    assert.deepEqual([await taken(week), await taken(week3)], [6, 9])
    assert.equal((await setWeek(week, 9)).body.over, 0)
    assert.deepEqual(await kinds(ids[1]), ['PREORDER_BOOKED', 'PREORDER_DELAYED'])
    const ev = (await query(`SELECT reason FROM preorder_events WHERE preorder_id = $1 ORDER BY created_at DESC LIMIT 1`, [ids[1]])).rows[0].reason
    assert.match(ev, /^Delayed from the week of .+ to the week of .+: moved by a manager: short harvest$/)
    assert.equal((await move(ids[1], week3)).body.error.code, 'PREORDER_SAME_WEEK')
    assert.deepEqual(await preorderCapacityDrift({ query }), [])

    // Raised again: room in the earlier week. A customer shown a later week is told before paying.
    assert.equal((await setWeek(week, 20)).body.remaining, 14)
    const changed = await book((await customerToken(api)).accessToken, week3, { qty: 1 })
    assert.deepEqual([changed.status, changed.body.error.code, changed.body.error.weekStart], [409, 'PREORDER_WEEK_CHANGED', week])
    // Back to the default (6 kg): over again by what it holds.
    const back = await setWeek(week, null)
    assert.deepEqual([back.body.own, back.body.limit, back.body.over], [null, 6, 0])
  })
})
