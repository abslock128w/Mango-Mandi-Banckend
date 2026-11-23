// "Ask them on WhatsApp" (GIFT_ADDRESS_LINKS with MULTI_GIFT, src/gift-address.js, docs/gifting.md "Before the season"):
// a gift for several people booked before the season may leave a recipient's address to the recipient. The link goes
// out once the group is paid (once, however often the webhook comes), the recipient fills it in once with a served
// pincode, the giver can send it again within limits, maintenance reminds five days before the week, and the allocator
// leaves a booking without an address alone until it has one.
import { adminToken, client, closeAll, customerToken, makeBatch, resetDb, signWebhook, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { addDays, now, setNow, todayIST } from '../src/clock.js'
import { query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { giftAddressToken, tokenHash } from '../src/gift-address-token.js'
import { RESEND_MAX, sendAddressReminders } from '../src/gift-address.js'
import { newId } from '../src/ids.js'
import { runMaintenance, runPreorderJobs } from '../src/maintenance.js'
import { sendDueNotifications, weekWords } from '../src/notify.js'
import { staffCancelPreorder } from '../src/preorders.js'
import { SYSTEM } from '../src/orders.js'
import { productName } from '../src/products.js'

let srv
let api
let admin
const saved = { MULTI_GIFT: env.MULTI_GIFT, GIFT_ADDRESS_LINKS: env.GIFT_ADDRESS_LINKS }

before(async () => {
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  Object.assign(env, saved)
  await srv.close()
  await closeAll()
})
beforeEach(async () => {
  Object.assign(env, { MULTI_GIFT: true, GIFT_ADDRESS_LINKS: true })
  await resetDb()
  admin = await adminToken(api)
})

function openWeek() {
  let d = addDays(todayIST(), 6)
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1)
  return d
}
const ADDRESS = '7, 2nd Main, Indiranagar, Bengaluru'
/** Person 1 with an address, as today; person 2 asked on WhatsApp. */
const typed = (week) => ({
  sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1, weekStart: week, pincode: '560034', address: '1, 4th Cross, Koramangala, Bengaluru',
  gift: { recipientName: 'Friend One', recipientPhone: '98450 12341', message: null },
})
const asked = (week, extra = {}) => ({
  sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1, weekStart: week, askAddress: true,
  gift: { recipientName: 'Ravi Kumar', recipientPhone: '98450 12342', message: 'Happy summer!' }, ...extra,
})
const bookGroup = (token, recipients, key = newId('idem')) => api.post('/v1/preorders/groups', { name: 'Asha Rao', recipients }, { token, headers: { 'Idempotency-Key': key } })
const members = async (groupId) => (await query('SELECT * FROM preorders WHERE group_id = $1 ORDER BY group_position', [groupId])).rows
const groupRow = async (id) => (await query('SELECT * FROM preorder_groups WHERE id = $1', [id])).rows[0]
const linkOf = async (preorderId) => (await query('SELECT * FROM gift_address_links WHERE preorder_id = $1 AND revoked_at IS NULL', [preorderId])).rows[0]
const messages = async (preorderId, kind) => (await query('SELECT * FROM notifications WHERE preorder_id = $1 AND kind = $2 ORDER BY created_at', [preorderId, kind])).rows
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
}
async function setup() {
  const week = openWeek()
  setNow(`${addDays(week, -6)}T04:30:00Z`)
  assert.equal((await api.put(`/admin/v1/preorder-capacity/${week}/ALP-3`, { capacity: 10 }, { token: admin })).status, 200)
  return { week, a: await customerToken(api) }
}
/** A paid group: person 1 typed, person 2 asked. Returns its ids and the asked person's token. */
async function paidGroup() {
  const { week, a } = await setup()
  const r = await bookGroup(a.accessToken, [typed(week), asked(week)])
  assert.equal(r.status, 201, JSON.stringify(r.body))
  await payGroup(r.body.id)
  const [one, two] = await members(r.body.id)
  const link = await linkOf(two.id)
  return { week, a, g: r.body, one, two, link, token: giftAddressToken(link.id) }
}
const sendLink = (a, g, p) => api.post(`/v1/preorders/groups/${g.id}/preorders/${p.id}/send-link`, {}, { token: a.accessToken })
const later = (ms) => setNow(new Date(now().getTime() + ms))

describe('asking a gift recipient for their address', () => {
  test('booked with one asked and one typed address, paid once: one link and one message, even when the payment comes again', async () => {
    const { week, a } = await setup()
    const r = await bookGroup(a.accessToken, [typed(week), asked(week)])
    assert.equal(r.status, 201, JSON.stringify(r.body))
    const [p1, p2] = r.body.preorders
    assert.deepEqual([p1.addressState, p1.pincode, p2.addressState, p2.pincode, p2.address], [null, '560034', 'ADDRESS_PENDING', null, null])
    // The week does not depend on the pincode: both people get the same week, each taking its kg.
    assert.deepEqual([p1.weekStart, p2.weekStart], [week, week])
    // Unpaid: no link yet, nothing to send; the shop can already preview the message.
    assert.equal(await linkOf(p2.id), undefined)
    assert.deepEqual([p2.addressLink, typeof p2.addressMessage], [null, 'string'])
    assert.equal((await sendLink(a, r.body, p2)).body.error.code, 'NOT_PAID')

    await payGroup(r.body.id)
    await payGroup(r.body.id) // a replay
    const [b1, b2] = await members(r.body.id)
    assert.deepEqual([b1.status, b2.status, b2.address_state], ['BOOKED', 'BOOKED', 'ADDRESS_PENDING'])
    assert.equal(await linkOf(b1.id), undefined)
    const link = await linkOf(b2.id)
    assert.deepEqual([link.send_count, link.token_hash], [1, tokenHash(giftAddressToken(link.id))])
    assert.equal(new Date(link.expires_at).toISOString(), new Date(`${addDays(week, -1)}T00:00:00+05:30`).toISOString())
    const sent = await messages(b2.id, 'GIFT_ADDRESS_REQUEST')
    assert.equal(sent.length, 1)
    const words = ['Ravi', 'Asha Rao', `1 × ${productName('ALP-3')}`, weekWords(week)]
    assert.deepEqual([sent[0].phone, sent[0].params], ['+919845012342', words])

    // It goes out with the token as the URL button's variable (<shop>/gift-address/{{1}}).
    const out = []
    await sendDueNotifications({ sender: async (m) => out.push(m) && 'wamid.1' })
    const msg = out.find((m) => m.template === 'mandi_gift_address_request')
    assert.ok(msg, JSON.stringify(out.map((m) => m.template)))
    assert.deepEqual([msg.params, msg.urlParam], [words, giftAddressToken(link.id)])

    // The giver sees the state, when it was sent, and the words.
    const view = (await api.get(`/v1/preorders/groups/${r.body.id}`, { token: a.accessToken })).body
    const v2 = view.preorders[1]
    assert.equal(v2.addressState, 'ADDRESS_PENDING')
    assert.deepEqual([v2.addressLink.sendCount, v2.addressLink.canResend, Boolean(v2.addressLink.resendAfter)], [1, false, true])
    assert.match(v2.addressMessage, /^Hi Ravi, Asha Rao is sending you a gift of VMR Mangoes: 1 × .+, to be delivered in the week of/)
    assert.equal(view.preorders[0].addressState, null)
  })

  test('the recipient sees the gift, cannot use an unserved pincode, gives the address once', async () => {
    const { week, a, g, two, token } = await paidGroup()
    const page = await api.get(`/v1/gift-address/${token}`)
    assert.equal(page.status, 200, JSON.stringify(page.body))
    assert.equal(page.headers.get('cache-control'), 'no-store')
    assert.deepEqual(page.body, {
      state: 'PENDING', recipientName: 'Ravi Kumar', fromName: 'Asha Rao', box: { name: productName('ALP-3'), qty: 1, stage: 'SEMI_RIPE' },
      weekStart: week, message: 'Happy summer!', expiresAt: new Date(`${addDays(week, -1)}T00:00:00+05:30`).toISOString(),
    })
    // Never a phone or the price.
    const text = JSON.stringify(page.body)
    for (const s of ['+91', '98450', String(two.total), 'total', 'price']) assert.ok(!text.includes(s), s)

    assert.equal((await api.get('/v1/gift-address/not-a-token')).body.error.code, 'LINK_NOT_FOUND')
    assert.equal((await api.get(`/v1/gift-address/${giftAddressToken('gal_nope')}`)).status, 404)

    const bad = await api.post(`/v1/gift-address/${token}`, { address: ADDRESS, pincode: '999999' })
    assert.deepEqual([bad.status, bad.body.error.code, bad.body.error.message], [400, 'NOT_SERVICEABLE', 'We do not deliver to this pincode yet'])
    assert.equal((await api.post(`/v1/gift-address/${token}`, { address: 'short', pincode: '560034' })).status, 400)
    const still = (await members(g.id))[1]
    assert.deepEqual([still.address_state, still.pincode, still.delivery_address], ['ADDRESS_PENDING', null, null])

    const ok = await api.post(`/v1/gift-address/${token}`, { address: `  ${ADDRESS}  `, pincode: '560034' })
    assert.deepEqual([ok.status, ok.body], [200, { state: 'GIVEN', weekStart: week }])
    const given = (await members(g.id))[1]
    assert.deepEqual([given.address_state, given.pincode, given.delivery_address], ['ADDRESS_GIVEN', '560034', ADDRESS])
    assert.ok((await linkOf(two.id)).filled_at)
    assert.ok((await query(`SELECT 1 FROM preorder_events WHERE preorder_id = $1 AND reason = 'Address given by the recipient'`, [two.id])).rowCount)

    const again = await api.post(`/v1/gift-address/${token}`, { address: '9, Other Road, Bengaluru 1', pincode: '560034' })
    assert.deepEqual([again.status, again.body.error.code], [409, 'ADDRESS_GIVEN'])
    assert.equal((await members(g.id))[1].delivery_address, ADDRESS)
    assert.equal((await api.get(`/v1/gift-address/${token}`)).body.state, 'GIVEN')

    // The giver sees it was given, with the pincode but not the recipient's address; resending is refused.
    const v = (await api.get(`/v1/preorders/groups/${g.id}`, { token: a.accessToken })).body.preorders[1]
    assert.deepEqual([v.addressState, v.pincode, v.address, v.addressLink.canResend], ['ADDRESS_GIVEN', '560034', null, false])
    assert.equal((await sendLink(a, g, two)).body.error.code, 'ADDRESS_GIVEN')
    // Staff see the address.
    const staff = (await api.get('/admin/v1/preorders', { token: admin })).body.find((p) => p.id === two.id)
    assert.deepEqual([staff.address, staff.addressState], [ADDRESS, 'ADDRESS_GIVEN'])
  })

  test('the link stops working the day before the week, and at once when the gift is cancelled', async () => {
    const { week, a, g, two, token } = await paidGroup()
    setNow(`${addDays(week, -2)}T18:29:00Z`) // 23:59 IST two days before: still open
    assert.equal((await api.get(`/v1/gift-address/${token}`)).status, 200)
    setNow(`${addDays(week, -2)}T18:30:00Z`) // midnight IST, the day before the week
    assert.deepEqual([(await api.get(`/v1/gift-address/${token}`)).status, (await api.get(`/v1/gift-address/${token}`)).body.error.code], [410, 'LINK_EXPIRED'])
    const late = await api.post(`/v1/gift-address/${token}`, { address: ADDRESS, pincode: '560034' })
    assert.deepEqual([late.status, late.body.error.code], [410, 'LINK_EXPIRED'])
    assert.equal((await sendLink(a, g, two)).body.error.code, 'LINK_EXPIRED')

    const other = await paidGroupFor(await customerToken(api), addDays(week, 7))
    await tx((c) => staffCancelPreorder(c, other.two.id, SYSTEM, 'Week closed'))
    const gone = await api.get(`/v1/gift-address/${other.token}`)
    assert.deepEqual([gone.status, gone.body.error.code], [410, 'GIFT_CANCELLED'])
    assert.equal((await api.post(`/v1/gift-address/${other.token}`, { address: ADDRESS, pincode: '560034' })).body.error.code, 'GIFT_CANCELLED')
  })

  test('the giver sends the same link again: not too soon, not too often, only their own', async () => {
    const { a, g, one, two, link, token } = await paidGroup()
    const soon = await sendLink(a, g, two)
    assert.deepEqual([soon.status, soon.body.error.code], [429, 'RESEND_TOO_SOON'])
    assert.ok(soon.body.error.retryAfter > 0 && soon.body.error.retryAfter <= 600, String(soon.body.error.retryAfter))
    assert.ok(soon.headers.get('retry-after'))
    // A booking with its address typed: nothing to send.
    assert.equal((await sendLink(a, g, one)).body.error.code, 'NOT_ASKED')
    // Someone else, or a booking not in this group: 404.
    const b = await customerToken(api)
    assert.equal((await sendLink(b, g, two)).status, 404)
    assert.equal((await api.post(`/v1/preorders/groups/${g.id}/preorders/pre_none/send-link`, {}, { token: a.accessToken })).status, 404)

    for (let i = 2; i <= RESEND_MAX + 1; i++) {
      later(11 * 60_000)
      const r = await sendLink(a, g, two)
      assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.deepEqual([r.body.id, r.body.addressState, r.body.addressLink.sendCount, r.body.addressLink.canResend], [two.id, 'ADDRESS_PENDING', i, false])
    }
    // The same link every time, a new message every time.
    assert.equal((await linkOf(two.id)).id, link.id)
    assert.equal((await messages(two.id, 'GIFT_ADDRESS_REQUEST')).length, RESEND_MAX + 1)
    later(11 * 60_000)
    assert.equal((await sendLink(a, g, two)).body.error.code, 'RESEND_LIMIT')
    assert.equal((await api.get(`/v1/gift-address/${token}`)).status, 200)
  })

  test('maintenance reminds the recipient and tells the giver once, five days before the week and not before', async () => {
    const { week, two } = await paidGroup()
    // Six days before: nothing.
    assert.deepEqual(await sendAddressReminders(), { reminded: 0, giversTold: 0 })
    setNow(`${addDays(week, -5)}T04:30:00Z`)
    const run = await runMaintenance({ budgetMs: 60_000 })
    assert.deepEqual(run.giftAddressReminders, { reminded: 1, giversTold: 1 }, JSON.stringify(run.giftAddressReminders))
    assert.deepEqual(await sendAddressReminders(), { reminded: 0, giversTold: 0 })
    const remind = await messages(two.id, 'GIFT_ADDRESS_REMINDER')
    const told = await messages(two.id, 'GIFT_ADDRESS_MISSING')
    assert.deepEqual([remind.length, remind[0].phone, told.length, told[0].phone], [1, '+919845012342', 1, two.phone])
    assert.equal(told[0].params[0], 'Asha')
    assert.match(told[0].params[4], new RegExp(`/preorders/${two.id}$`))
  })

  test('the allocator leaves a booking without an address booked, and turns it into a delivery once it has one', async () => {
    const { g, one, two, token } = await paidGroup()
    await makeBatch({ age: 0, rating: 'RAW', lines: { 'ALP-3': 10 } })
    await runPreorderJobs()
    let [p1, p2] = await members(g.id)
    assert.deepEqual([p1.status, p2.status], ['CONVERTED', 'BOOKED'])
    assert.equal(p1.id, one.id)
    assert.equal((await api.post(`/v1/gift-address/${token}`, { address: ADDRESS, pincode: '560034' })).status, 200)
    await runPreorderJobs()
    ;[, p2] = await members(g.id)
    assert.equal(p2.status, 'CONVERTED')
    const o = (await query('SELECT * FROM orders WHERE id = $1', [p2.order_id])).rows[0]
    assert.deepEqual([o.pincode, o.delivery_address, o.gift_recipient_name, o.preorder_id], ['560034', ADDRESS, 'Ravi Kumar', two.id])
  })

  test('with either switch off: the routes answer 404 and askAddress is refused; the policy says so', async () => {
    const { week, a, g, two, token } = await paidGroup()
    assert.equal((await api.get('/v1/policy')).body.features.giftAddressAsk, true)
    // Checked as a booking: no address with askAddress, an address without it.
    const both = await bookGroup(a.accessToken, [asked(week, { pincode: '560034' })])
    assert.equal(both.status, 400)
    const none = await bookGroup(a.accessToken, [{ ...typed(week), address: null }])
    assert.equal(none.status, 400)
    // A gift needs the recipient's mobile anyway.
    assert.equal((await bookGroup(a.accessToken, [asked(week, { gift: { recipientName: 'X' } })])).status, 400)

    env.GIFT_ADDRESS_LINKS = false
    assert.equal((await api.get('/v1/policy')).body.features.giftAddressAsk, false)
    assert.equal((await api.get(`/v1/gift-address/${token}`)).status, 404)
    assert.equal((await api.post(`/v1/gift-address/${token}`, { address: ADDRESS, pincode: '560034' })).status, 404)
    assert.equal((await sendLink(a, g, two)).status, 404)
    const refused = await bookGroup(a.accessToken, [asked(week)])
    assert.deepEqual([refused.status, refused.body.error.code], [400, 'ASK_ADDRESS_OFF'])
    env.GIFT_ADDRESS_LINKS = true
    env.MULTI_GIFT = false
    assert.equal((await api.get('/v1/policy')).body.features.giftAddressAsk, false)
    assert.equal((await api.get(`/v1/gift-address/${token}`)).status, 404)
  })
})

/** A paid group for another giver in `week` (the second of its two people asked). */
async function paidGroupFor(cust, week) {
  const r = await bookGroup(cust.accessToken, [typed(week), asked(week)])
  assert.equal(r.status, 201, JSON.stringify(r.body))
  await payGroup(r.body.id)
  const [one, two] = await members(r.body.id)
  const link = await linkOf(two.id)
  return { g: r.body, one, two, link, token: giftAddressToken(link.id) }
}
