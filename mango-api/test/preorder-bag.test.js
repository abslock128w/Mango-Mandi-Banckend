// The pre-order bag (migration 089, preorders.js bookPreorderBag): several boxes pre-ordered for yourself in one
// checkout and one payment, each line keeping its own delivery week. The server rules: the quote books nothing and
// shows each line's week, counting the lines before it in the same variety; confirm books one pre-order per line in
// one transaction with one payment link; one captured payment books every line; a hold that runs out releases every
// line, whichever sweep finds it; the bag counts as one unpaid pre-order; a week that changed refuses the whole bag.
import { adminToken, client, closeAll, customerToken, resetDb, signWebhook, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { addDays, now, setNow, todayIST } from '../src/clock.js'
import { currentConfig, saveConfig } from '../src/config.js'
import { query, tx } from '../src/db.js'
import { newId } from '../src/ids.js'
import { expirePreorderHolds } from '../src/preorders.js'
import { preorderCapacityDrift } from '../src/stock-watch.js'

let srv
let api

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
  await adminToken(api)
})

/** The first Monday after the regular booking horizon, and the clock set so it is the first delivery week. */
function setup() {
  let week = addDays(todayIST(), 6)
  while (new Date(`${week}T00:00:00Z`).getUTCDay() !== 1) week = addDays(week, 1)
  setNow(`${addDays(week, -6)}T04:30:00Z`)
  return week
}
/** Every variety's delivery week holds `kg` (migrations 076, 078). */
const setLimit = (kg) => saveConfig({ ...currentConfig().rules, preorderDayKg: kg / 7, preorderVarietyDayKg: {}, preorderOtherVarietyDayKg: kg / 7 }, 'test')
/** What a variety's week holds (preorder_variety_week_kg.reserved_kg). */
const held = async (week, variety) =>
  Number((await query('SELECT reserved_kg FROM preorder_variety_week_kg WHERE week_start = $1 AND variety = $2', [week, variety])).rows[0]?.reserved_kg ?? 0)
const members = async (groupId) => (await query('SELECT * FROM preorders WHERE group_id = $1 ORDER BY group_position', [groupId])).rows
const groupRow = async (id) => (await query('SELECT * FROM preorder_groups WHERE id = $1', [id])).rows[0]

// Alphonso 3 kg x 2 (6 kg), Kesar 3 kg x 1 (3 kg), Alphonso 5 kg x 1 (5 kg): with 6 kg a week per variety, the first
// two lines fit the first week and the third, Alphonso again, goes to the next.
const LINES = [
  { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2 },
  { sku: 'KES-3', stage: 'RAW', qty: 1 },
  { sku: 'ALP-5', stage: 'SEMI_RIPE', qty: 1 },
]
const ADDRESS = '12, 4th Cross, Koramangala, Bengaluru'
const quote = (lines = LINES, token = undefined) => api.post('/v1/preorders/quote', { lines }, token ? { token } : {})
const confirm = (token, lines, { key = newId('idem'), ...extra } = {}) =>
  api.post('/v1/preorders/confirm', { lines, pincode: '560034', address: ADDRESS, nonRefundable: true, ...extra }, { token, headers: { 'Idempotency-Key': key } })
/** The quote's lines with the week each would get, as the shop sends them at Pay. */
const withWeeks = async (lines = LINES) => (await quote(lines)).body.lines.map(({ sku, stage, qty, weekStart }) => ({ sku, stage, qty, weekStart }))

async function payBag(groupId, paymentId = `pay_${groupId}`) {
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

describe('the pre-order bag', () => {
  test('the quote shows each line its own week, counting the lines before it, and books nothing', async () => {
    const week = setup()
    await setLimit(6)
    const r = await quote()
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual(r.body.lines.map((l) => [l.sku, l.variety, l.kg, l.weekStart, l.tooBig, l.full]), [
      ['ALP-3', 'Alphonso', 6, week, false, false],
      ['KES-3', 'Kesar', 3, week, false, false],
      ['ALP-5', 'Alphonso', 5, addDays(week, 7), false, false],
    ])
    assert.equal(r.body.total, r.body.lines.reduce((t, l) => t + l.unitPrice * l.qty, 0))
    assert.deepEqual([r.body.boxes, r.body.payable, r.body.nonRefundable], [4, true, true])
    assert.equal(r.body.season.phase, 'OPEN')
    // Nothing was reserved.
    assert.deepEqual([await held(week, 'Alphonso'), await held(week, 'Kesar')], [0, 0])

    // A line no week can take says why, and the bag can't be paid.
    const big = await quote([{ sku: 'ALP-5', stage: 'RAW', qty: 2 }])
    assert.deepEqual([big.body.lines[0].tooBig, big.body.lines[0].weekStart, big.body.payable], [true, null, false])
    // One line per box and ripeness; a box not on sale names its line.
    const dup = await quote([LINES[0], { ...LINES[0], qty: 1 }])
    assert.deepEqual([dup.status, dup.body.error.code], [400, 'DUPLICATE_LINE'])
    const unknown = await quote([{ sku: 'NOPE-3', stage: 'RAW', qty: 1 }])
    assert.deepEqual([unknown.status, unknown.body.error.code], [400, 'INVALID_SKU'])
    const empty = await quote([])
    assert.equal(empty.status, 400)
  })

  test('confirm books one pre-order per line with its own week, under one P number and one payment link', async () => {
    const week = setup()
    await setLimit(6)
    const a = await customerToken(api)
    const lines = await withWeeks()
    // The non-refundable tick is required.
    const unticked = await confirm(a.accessToken, lines, { nonRefundable: false })
    assert.equal(unticked.status, 400)

    const key = newId('idem')
    const r = await confirm(a.accessToken, lines, { key })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    const g = r.body
    assert.match(g.number, /^P\d{9}$/)
    assert.deepEqual([g.kind, g.status, g.paymentStatus, g.lineCount, g.boxes, g.nonRefundable, g.canCancel], ['BAG', 'PAYMENT_PENDING', 'INITIATED', 3, 4, true, true])
    assert.ok(g.paymentUrl)
    assert.equal(g.total, g.preorders.reduce((t, p) => t + p.total, 0))
    assert.deepEqual(g.preorders.map((p) => [p.sku, p.weekStart, p.status, p.address, p.gift, p.group.kind, p.group.position]), [
      ['ALP-3', week, 'PAYMENT_PENDING', ADDRESS, null, 'BAG', 1],
      ['KES-3', week, 'PAYMENT_PENDING', ADDRESS, null, 'BAG', 2],
      ['ALP-5', addDays(week, 7), 'PAYMENT_PENDING', ADDRESS, null, 'BAG', 3],
    ])
    // Each line is a pre-order for yourself: its own P number.
    for (const p of g.preorders) assert.match(p.number, /^P\d{9}$/)
    assert.equal(new Set([g.number, ...g.preorders.map((p) => p.number)]).size, 4)
    // One link for the whole bag, on every line; each line's week took its kg.
    const rows = await members(g.id)
    assert.equal(new Set(rows.map((p) => p.payment_link_id)).size, 1)
    assert.equal(rows[0].payment_link_id, (await groupRow(g.id)).payment_link_id)
    assert.deepEqual([await held(week, 'Alphonso'), await held(week, 'Kesar'), await held(addDays(week, 7), 'Alphonso')], [6, 3, 5])

    // The same key again: the same bag, not a second one.
    const again = await confirm(a.accessToken, lines, { key })
    assert.deepEqual([again.status, again.body.id], [200, g.id])
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM preorder_groups')).rows[0].n, 1)

    // The bag, as its owner reads it (without MULTI_GIFT), and the list with its lines together.
    const view = await api.get(`/v1/preorders/groups/${g.id}`, { token: a.accessToken })
    assert.deepEqual([view.status, view.body.kind, view.body.preorders.length], [200, 'BAG', 3])
    const mine = (await api.get('/v1/preorders', { token: a.accessToken })).body
    assert.deepEqual(mine.map((p) => [p.group.id, p.group.kind, p.group.lines, p.group.position]), [[g.id, 'BAG', 3, 1], [g.id, 'BAG', 3, 2], [g.id, 'BAG', 3, 3]])
    const b = await customerToken(api)
    assert.equal((await api.get(`/v1/preorders/groups/${g.id}`, { token: b.accessToken })).status, 404)
  })

  test('one captured payment books every line; each keeps its own amount and week, and a paid line is non-refundable', async () => {
    const week = setup()
    await setLimit(6)
    const a = await customerToken(api)
    const g = (await confirm(a.accessToken, await withWeeks())).body
    await payBag(g.id)
    const paid = await members(g.id)
    assert.deepEqual(paid.map((p) => [p.status, p.payment_status, p.paid_amount, p.payment_id, p.week_start]), [
      ['BOOKED', 'SUCCEEDED', paid[0].total, null, week],
      ['BOOKED', 'SUCCEEDED', paid[1].total, null, week],
      ['BOOKED', 'SUCCEEDED', paid[2].total, null, addDays(week, 7)],
    ])
    const gr = await groupRow(g.id)
    assert.deepEqual([gr.kind, gr.status, gr.payment_status, gr.payment_id, gr.paid_amount], ['BAG', 'PAID', 'SUCCEEDED', `pay_${g.id}`, g.total])
    // A replay changes nothing; a second payment is a duplicate, refunded.
    await payBag(g.id)
    await payBag(g.id, 'pay_second')
    assert.equal((await query(`SELECT COUNT(*)::int AS n FROM duplicate_payments WHERE payment_id = 'pay_second'`)).rows[0].n, 1)
    assert.deepEqual([await held(week, 'Alphonso'), await held(addDays(week, 7), 'Alphonso')], [6, 5])
    // Cancel stays per line and unchanged: a paid pre-order can't be cancelled by the customer.
    const no = await api.post(`/v1/preorders/${paid[1].id}/cancel`, {}, { token: a.accessToken })
    assert.deepEqual([no.status, no.body.error.code], [409, 'PREORDER_NON_REFUNDABLE'])
    assert.deepEqual((await members(g.id)).map((p) => p.status), ['BOOKED', 'BOOKED', 'BOOKED'])
  })

  test('a hold that runs out releases every line, in every week, whichever sweep finds it first', async () => {
    const week = setup()
    await setLimit(6)
    const a = await customerToken(api)
    const g = (await confirm(a.accessToken, await withWeeks())).body
    assert.deepEqual([await held(week, 'Alphonso'), await held(addDays(week, 7), 'Alphonso'), await held(week, 'Kesar')], [6, 5, 3])

    // The lazy sweep at booking: another customer's Alphonso finds the first week full of an expired hold. It frees
    // that line and, with it, the bag's Kesar line and its Alphonso line a week later.
    setNow(new Date(now().getTime() + 13 * 60_000).toISOString())
    const b = await customerToken(api)
    const other = await api.post(
      '/v1/preorders',
      { sku: 'ALP-3', stage: 'RAW', qty: 2, weekStart: week, pincode: '560034', address: ADDRESS },
      { token: b.accessToken, headers: { 'Idempotency-Key': newId('idem') } },
    )
    assert.deepEqual([other.status, other.body.weekStart], [201, week], JSON.stringify(other.body))
    assert.deepEqual((await members(g.id)).map((p) => [p.status, p.payment_status]), [['CANCELLED', 'CANCELLED'], ['CANCELLED', 'CANCELLED'], ['CANCELLED', 'CANCELLED']])
    assert.deepEqual([await held(week, 'Alphonso'), await held(addDays(week, 7), 'Alphonso'), await held(week, 'Kesar')], [6, 0, 0])
    assert.equal((await api.get(`/v1/preorders/groups/${g.id}`, { token: a.accessToken })).body.status, 'CANCELLED')
    assert.deepEqual(await preorderCapacityDrift({ query }), [])
  })

  test('the maintenance sweep releases the whole bag once, and a payment after it still books every line', async () => {
    const week = setup()
    await setLimit(6)
    const a = await customerToken(api)
    const g = (await confirm(a.accessToken, await withWeeks())).body
    setNow(new Date(now().getTime() + 13 * 60_000).toISOString())
    await tx((c) => expirePreorderHolds(c))
    assert.deepEqual((await members(g.id)).map((p) => p.status), ['CANCELLED', 'CANCELLED', 'CANCELLED'])
    // Released once each, never twice (the sweep had read every line before the first one took the others with it).
    assert.deepEqual([await held(week, 'Alphonso'), await held(addDays(week, 7), 'Alphonso'), await held(week, 'Kesar')], [0, 0, 0])
    const events = (await query(`SELECT preorder_id, COUNT(*)::int AS n FROM preorder_events WHERE status = 'CANCELLED' GROUP BY preorder_id`)).rows
    assert.deepEqual(events.map((e) => e.n), [1, 1, 1])
    assert.deepEqual(await preorderCapacityDrift({ query }), [])

    // A late payment is honoured: every line booked again in its week.
    await payBag(g.id)
    assert.deepEqual((await members(g.id)).map((p) => [p.status, p.week_start]), [['BOOKED', week], ['BOOKED', week], ['BOOKED', addDays(week, 7)]])
    assert.deepEqual([await held(week, 'Alphonso'), await held(addDays(week, 7), 'Alphonso'), await held(week, 'Kesar')], [6, 5, 3])
  })

  test('an unpaid bag is one unpaid pre-order; cancelling any line before paying cancels the whole bag', async () => {
    const week = setup()
    await setLimit(30)
    const a = await customerToken(api)
    const g = (await confirm(a.accessToken, await withWeeks())).body
    const again = await confirm(a.accessToken, await withWeeks([{ sku: 'KES-3', stage: 'SEMI_RIPE', qty: 1 }]))
    assert.deepEqual([again.status, again.body.error.code], [409, 'UNPAID_PREORDER_EXISTS'])
    const single = await api.post(
      '/v1/preorders',
      { sku: 'KES-3', stage: 'SEMI_RIPE', qty: 1, pincode: '560034', address: ADDRESS },
      { token: a.accessToken, headers: { 'Idempotency-Key': newId('idem') } },
    )
    assert.deepEqual([single.status, single.body.error.code], [409, 'UNPAID_PREORDER_EXISTS'])

    const [, kesar] = await members(g.id)
    assert.equal((await api.post(`/v1/preorders/${kesar.id}/cancel`, {}, { token: a.accessToken })).status, 204)
    assert.deepEqual((await members(g.id)).map((p) => p.status), ['CANCELLED', 'CANCELLED', 'CANCELLED'])
    assert.deepEqual([await held(week, 'Alphonso'), await held(week, 'Kesar')], [0, 0])
    assert.equal((await groupRow(g.id)).status, 'CANCELLED')
    // Now another bag may be made.
    assert.equal((await confirm(a.accessToken, await withWeeks())).status, 201)
  })

  test('a week that changed since the quote refuses the whole bag, naming the line; nothing is booked', async () => {
    const week = setup()
    await setLimit(6)
    const a = await customerToken(api)
    const lines = await withWeeks()
    // Someone else takes the first Alphonso week before this customer pays.
    const b = await customerToken(api)
    const first = await api.post(
      '/v1/preorders',
      { sku: 'ALP-3', stage: 'RAW', qty: 2, pincode: '560034', address: ADDRESS },
      { token: b.accessToken, headers: { 'Idempotency-Key': newId('idem') } },
    )
    assert.equal(first.body.weekStart, week)
    const r = await confirm(a.accessToken, lines)
    assert.equal(r.status, 409, JSON.stringify(r.body))
    assert.equal(r.body.error.code, 'PREORDER_FULL')
    assert.match(r.body.error.message, /^Line 1 /)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM preorders')).rows[0].n, 1) // only the other customer's
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM preorder_groups')).rows[0].n, 0)
    // The quote now shows the new week; with it the bag books.
    const fresh = await withWeeks()
    assert.equal(fresh[0].weekStart, addDays(week, 7))
    assert.equal((await confirm(a.accessToken, fresh)).status, 201)
  })
})
