// Growth (docs/growth.md): refer a friend (REFERRALS), the anonymous funnel
// (FUNNEL_ANALYTICS) and the managers' evening WhatsApp summary
// (MANAGER_DAILY_SUMMARY). Messages go through stub senders, never to Meta or
// a push service.
import { adminToken, client, closeAll, customerToken, makeBatch, resetDb, startServer, T0 } from './helpers.js'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import sharp from 'sharp'
import { addDays, now, setNow, todayIST } from '../src/clock.js'
import { query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'
import { rollupAndPruneFunnel } from '../src/funnel.js'
import { runMaintenance, takeLease } from '../src/maintenance.js'
import { sendManagerSummaries } from '../src/manager-summary.js'
import { sendDueNotifications } from '../src/notify.js'
import { sendDuePush, usePushSender } from '../src/push.js'
import { enforceLimitsInTests } from '../src/ratelimit.js'
import { settleOne, settleReferrals, withdrawOne } from '../src/referrals.js'
import { attentionCount, attentionReport } from '../src/admin/reports.js'
import { b64url, generateKeyPair } from '../src/webpush.js'

let srv
let api
let admin

const FLAGS = [
  'REFERRALS', 'REFERRAL_REWARD_KIND', 'REFERRAL_REWARD_PERCENT', 'REFERRAL_REWARD_MAX_RUPEES', 'REFERRAL_REWARD_RUPEES', 'REFERRAL_MIN_ORDER_RUPEES', 'REFERRAL_MAX_PER_MONTH', 'FUNNEL_ANALYTICS', 'MANAGER_DAILY_SUMMARY',
  'MANAGER_SUMMARY_TIME', 'MANAGER_SUMMARY_TEMPLATE', 'WEB_PUSH', 'WEB_PUSH_PROVIDER', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT',
]
const saved = Object.fromEntries(FLAGS.map((k) => [k, env[k]]))

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
afterEach(() => {
  Object.assign(env, saved)
  usePushSender(null)
  enforceLimitsInTests(false)
})

const FRIEND_ADDRESS = '22, 1st Main, Jayanagar 4th Block, Bengaluru'
const REFERRER_ADDRESS = '12, 4th Cross, Koramangala, Bengaluru'
const pay = (orderId) => api.post('/v1/dev/pay', { orderId, outcome: 'captured' })
const idOf = async (token) => (await api.get('/v1/me', { token })).body.id
const stock = () => makeBatch({ age: 6, rating: 'RIPE', lines: { 'ALP-3': 60, 'BAD-3': 60 } })

/** Cart, quote and confirm one order (unpaid). Returns the confirm answer's body. */
async function place(token, { address = FRIEND_ADDRESS, sku = 'ALP-3', qty = 1, promoCode, funnelId, gift } = {}) {
  assert.equal((await api.post('/v1/cart/items', { sku, stage: 'RIPE', qty }, { token })).status, 204)
  const q = await api.post('/v1/checkout/quote', { pincode: '560034', promoCode }, { token })
  if (q.status !== 200) return q
  const c = await api.post('/v1/checkout/confirm', { quoteId: q.body.quoteId, address, ...(funnelId ? { funnelId } : {}), ...(gift ? { gift } : {}) }, {
    token, headers: { 'Idempotency-Key': newId('idem') },
  })
  assert.equal(c.status, 201, JSON.stringify(c.body))
  return { ...c, quote: q.body }
}

/** A paid order delivered the way a rider does it: packed, out for delivery, the customer's code. */
async function deliverForReal(orderId) {
  for (const status of ['PROCESSING']) assert.equal((await api.patch(`/admin/v1/orders/${orderId}/status`, { status }, { token: admin })).status, 204)
  assert.equal((await api.post(`/admin/v1/orders/${orderId}/allocate`, undefined, { token: admin })).status, 204)
  for (const status of ['PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY']) {
    const r = await api.patch(`/admin/v1/orders/${orderId}/status`, { status }, { token: admin })
    assert.equal(r.status, 204, `${status}: ${JSON.stringify(r.body)}`)
  }
  const code = (await query('SELECT delivery_code FROM orders WHERE id = $1', [orderId])).rows[0].delivery_code
  const d = await api.post(`/admin/v1/orders/${orderId}/delivery`, { outcome: 'DELIVERED', code }, { token: admin })
  assert.equal(d.status, 200, JSON.stringify(d.body))
}

/** Shortcut for tests that only need the end state. */
async function markDelivered(orderId) {
  await query(`UPDATE orders SET status = 'DELIVERED' WHERE id = $1`, [orderId])
  await query(`INSERT INTO order_events (id, order_id, from_status, status, actor, created_at) VALUES ($1, $2, 'OUT_FOR_DELIVERY', 'DELIVERED', 'test', $3)`, [
    newId('evt'), orderId, now(),
  ])
}

/** A referrer with a code, and a new friend who entered it. */
async function referredPair() {
  const referrer = await customerToken(api)
  const friend = await customerToken(api)
  const mine = await api.get('/v1/me/referral', { token: referrer.accessToken })
  assert.equal(mine.status, 200, JSON.stringify(mine.body))
  const applied = await api.post('/v1/me/referral/apply', { code: mine.body.code }, { token: friend.accessToken })
  assert.equal(applied.status, 201, JSON.stringify(applied.body))
  return { referrer, friend, code: mine.body.code, referrerId: await idOf(referrer.accessToken), friendId: await idOf(friend.accessToken) }
}

const referral = async (friendId) => (await query('SELECT * FROM referrals WHERE friend_id = $1', [friendId])).rows[0]
const rewards = async () => (await query('SELECT * FROM referral_rewards ORDER BY role')).rows

// ---------------------------------------------------------------- refer a friend

describe('refer a friend: switched off', () => {
  test('the customer and staff routes answer 404, the shop is told it is off, and nothing is settled', async () => {
    const cust = await customerToken(api)
    assert.equal((await api.get('/v1/me/referral', { token: cust.accessToken })).status, 404)
    assert.equal((await api.post('/v1/me/referral/apply', { code: 'ABCDEFGH' }, { token: cust.accessToken })).status, 404)
    assert.equal((await api.get('/admin/v1/referrals', { token: admin })).status, 404)
    assert.equal((await api.get('/v1/policy')).body.features.referrals, false)
    assert.equal((await api.get('/admin/v1/auth/me', { token: admin })).body.features.referrals, false)
    assert.deepEqual(await settleReferrals(), { rewarded: 0, voided: 0 })
    // Signed out, the route is still behind the sign-in.
    env.REFERRALS = true
    assert.equal((await api.get('/v1/me/referral')).status, 401)
  })
})

describe('refer a friend', () => {
  beforeEach(() => {
    env.REFERRALS = true
  })

  test('each customer has one stable code and a share link; codes differ between customers', async () => {
    const a = await customerToken(api)
    const b = await customerToken(api)
    const first = await api.get('/v1/me/referral', { token: a.accessToken })
    assert.equal(first.status, 200)
    assert.match(first.body.code, /^[A-Z0-9]{8}$/)
    assert.equal(first.body.shareUrl, `${env.CUSTOMER_ORIGIN.split(',')[0]}/invite/${first.body.code}`)
    // The thank-you is 10% off by default, with no cap unless one is set.
    assert.equal(first.body.rewardKind, 'PERCENT')
    assert.equal(first.body.rewardPercent, 10)
    assert.equal(first.body.rewardMaxRupees, null)
    assert.equal(first.body.rewardRupees, null)
    assert.equal(first.body.minOrderRupees, 499)
    assert.equal(first.body.canEnterCode, true)
    assert.equal((await api.get('/v1/me/referral', { token: a.accessToken })).body.code, first.body.code, 'the same code every time')
    assert.notEqual((await api.get('/v1/me/referral', { token: b.accessToken })).body.code, first.body.code)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM referral_codes')).rows[0].n, 2)
  })

  test("the whole path: once the friend's first order is paid, both get a one-time 10% code exactly once, by WhatsApp and push", async () => {
    await stock()
    const { referrer, friend, code, referrerId, friendId } = await referredPair()
    const view = (await api.get('/v1/me/referral', { token: friend.accessToken })).body
    assert.equal(view.canEnterCode, false)
    assert.equal(view.entered.status, 'PENDING')

    // Push on (log provider, stub sender) and a browser for the friend, so the thank-you is pushed too.
    const keys = generateKeyPair()
    Object.assign(env, { WEB_PUSH: true, WEB_PUSH_PROVIDER: 'log', VAPID_PUBLIC_KEY: b64url(keys.publicKey), VAPID_PRIVATE_KEY: b64url(keys.privateKey), VAPID_SUBJECT: 'mailto:ops@mandimangoes.test' })
    const browser = generateKeyPair()
    await query(`INSERT INTO push_subscriptions (id, customer_id, endpoint, p256dh, auth, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, [
      newId('psb'), friendId, `https://fcm.googleapis.com/fcm/send/${randomUUID()}`, b64url(browser.publicKey), b64url(randomBytes(16)), now(),
    ])

    const o = await place(friend.accessToken)
    // Placed but not paid yet: nothing.
    assert.deepEqual(await settleReferrals(), { rewarded: 0, voided: 0 })
    assert.equal((await referral(friendId)).status, 'PENDING')
    assert.equal((await pay(o.body.orderId)).body.result, 'confirmed')
    // Paid: the reward does not wait for delivery. A retried or overlapping job: two runs at once and one more after. One reward per side, ever.
    const [x, y] = await Promise.all([settleReferrals(), settleReferrals()])
    assert.equal(x.rewarded + y.rewarded, 1)
    assert.equal((await settleReferrals()).rewarded, 0)
    const r = await referral(friendId)
    assert.equal(await tx((c) => settleOne(c, r.id)), null, 'a settled referral is left alone')
    // Delivery later changes nothing: the reward was given once, at payment.
    await deliverForReal(o.body.orderId)
    assert.deepEqual(await settleReferrals(), { rewarded: 0, voided: 0 })
    assert.equal(r.status, 'REWARDED')
    assert.equal(r.order_id, o.body.orderId)
    const given = await rewards()
    assert.deepEqual(given.map((g) => [g.role, g.customer_id, g.amount]), [['FRIEND', friendId, 10], ['REFERRER', referrerId, 10]])
    const promos = (await query('SELECT * FROM promo_codes WHERE code = ANY($1) ORDER BY code', [given.map((g) => g.promo_code)])).rows
    assert.equal(promos.length, 2)
    for (const p of promos) {
      assert.equal(p.kind, 'PERCENT')
      assert.equal(p.value, 10)
      assert.equal(p.max_discount, null)
      assert.equal(p.min_subtotal, 49_900)
      assert.equal(p.max_uses, 1)
      assert.equal(p.per_customer, 1)
      assert.equal(p.ends_on, addDays(todayIST(), 90))
      assert.ok([friendId, referrerId].includes(p.owner_customer_id))
    }
    // Not in the managers' promo list: these belong to one customer each.
    assert.ok(!(await api.get('/admin/v1/promos', { token: admin })).body.some((p) => given.some((g) => g.promo_code === p.code)))

    // One WhatsApp per person, through the outbox, with the code and amount.
    const sent = []
    await sendDueNotifications({ sender: async (m) => (sent.push(m), `wamid.${sent.length}`) })
    const thanks = sent.filter((m) => m.template === 'mandi_referral_reward')
    assert.equal(thanks.length, 2)
    const friendCode = given.find((g) => g.role === 'FRIEND').promo_code
    const toFriend = thanks.find((m) => m.params[2] === friendCode)
    assert.ok(toFriend, JSON.stringify(thanks))
    assert.equal(toFriend.phone, friend.customer?.phone ?? (await query('SELECT phone FROM customers WHERE id = $1', [friendId])).rows[0].phone)
    assert.equal(toFriend.params[1], '10%')
    assert.equal(toFriend.params[4], 'Rs 499')
    await sendDueNotifications({ sender: async (m) => (sent.push(m), 'wamid.again') })
    assert.equal(sent.filter((m) => m.template === 'mandi_referral_reward').length, 2, 'never sent twice')

    // The push says where to look, not the code.
    const pushes = []
    usePushSender(async (_sub, msg) => (pushes.push(JSON.parse(msg.payload)), { status: 201 }))
    // (The friend's order steps are pushed too; the thank-you is the one tagged referral.)
    await sendDuePush()
    assert.deepEqual(pushes.filter((p) => p.tag === 'referral'), [{ title: 'MandiMangoes', body: 'You have a MandiMangoes thank-you code: see your Account page', url: '/account', tag: 'referral' }])

    // Both see their code on the Account page; the referrer sees the friend counted.
    const mine = (await api.get('/v1/me/referral', { token: referrer.accessToken })).body
    assert.equal(mine.code, code)
    assert.deepEqual(mine.friends, { pending: 0, rewarded: 1 })
    assert.equal(mine.rewards.length, 1)
    assert.equal(mine.rewards[0].state, 'READY')
    assert.equal(mine.rewards[0].kind, 'PERCENT')
    assert.equal(mine.rewards[0].percent, 10)
    assert.equal((await api.get('/v1/me/referral', { token: friend.accessToken })).body.entered.status, 'REWARDED')

    // The managers' view lists it, phones masked.
    const list = await api.get('/admin/v1/referrals', { token: admin })
    assert.equal(list.status, 200)
    assert.deepEqual(list.body.counts, { PENDING: 0, REWARDED: 1, VOID: 0 })
    assert.equal(list.body.items[0].status, 'REWARDED')
    assert.equal(list.body.items[0].rewards.length, 2)
    assert.match(list.body.items[0].friend.phone, /••••/)
    assert.ok(!JSON.stringify(list.body).includes((await query('SELECT phone FROM customers WHERE id = $1', [friendId])).rows[0].phone))
  })

  test('the maintenance run settles referrals', async () => {
    await stock()
    const { friend, friendId } = await referredPair()
    const o = await place(friend.accessToken)
    await pay(o.body.orderId)
    await markDelivered(o.body.orderId)
    const out = await runMaintenance({ forceAll: true })
    assert.deepEqual(out.referrals, { rewarded: 1, voided: 0 })
    assert.equal((await referral(friendId)).status, 'REWARDED')
  })

  test('the thank-you code follows the promo rules: only its owner, once, regular boxes, the minimum', async () => {
    await stock()
    const { referrer, friend } = await referredPair()
    const o = await place(friend.accessToken)
    await pay(o.body.orderId)
    await markDelivered(o.body.orderId)
    await settleReferrals()
    const [friendReward, referrerReward] = await rewards()
    const stranger = await customerToken(api)
    // Someone else's code: not valid for them.
    assert.equal((await place(stranger.accessToken, { promoCode: friendReward.promo_code })).body.error.code, 'PROMO_INVALID')
    assert.equal((await place(friend.accessToken, { promoCode: referrerReward.promo_code })).body.error.code, 'PROMO_INVALID')
    // Its owner: 10% off a regular box on their next order.
    await api.post('/v1/cart/items', { sku: 'ALP-3', stage: 'RIPE', qty: 0 }, { token: friend.accessToken })
    const used = await place(friend.accessToken, { promoCode: friendReward.promo_code })
    assert.equal(used.quote.discount, 18_990)
    assert.equal(used.quote.total, 189_900 - 18_990)
    await pay(used.body.orderId)
    // Once only (one use in all, and one per customer).
    assert.equal((await place(friend.accessToken, { promoCode: friendReward.promo_code })).body.error.code, 'PROMO_USED_UP')
    assert.equal((await api.get('/v1/me/referral', { token: friend.accessToken })).body.rewards[0].state, 'USED')
    // The minimum order counts regular boxes only.
    await query('UPDATE promo_codes SET min_subtotal = 200000 WHERE code = $1', [referrerReward.promo_code])
    assert.equal((await place(referrer.accessToken, { promoCode: referrerReward.promo_code, address: REFERRER_ADDRESS })).body.error.code, 'PROMO_MIN_SUBTOTAL')
  })

  test('a bulk deal is not a regular box: it earns no thank-you, and a thank-you code does not take money off it', async () => {
    await stock()
    const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#f4a300' } }).jpeg().toBuffer()
    const draft = {
      sku: 'BAD-3', title: 'Badami for offices', description: 'Badami in 3 kg boxes, for offices and events, packed together.',
      origin: 'Karnataka', stages: ['RIPE'], minQty: 10, qtyStep: 1, maxQty: null, tiers: [{ minQty: 10, unitPrice: 119_900 }],
    }
    const l = await api.post('/admin/v1/bulk-listings', draft, { token: admin })
    assert.equal(l.status, 201, JSON.stringify(l.body))
    assert.equal((await api.raw('POST', `/admin/v1/bulk-listings/${l.body.id}/photos`, { raw: jpeg, token: admin, headers: { 'Content-Type': 'image/jpeg' } })).status, 201)
    assert.equal((await api.post(`/admin/v1/bulk-listings/${l.body.id}/publish`, {}, { token: admin })).status, 200)

    const { friend, friendId } = await referredPair()
    assert.equal((await api.post('/v1/cart/bulk', { listingId: l.body.id, stage: 'RIPE', qty: 10 }, { token: friend.accessToken })).status, 204)
    const q = await api.post('/v1/checkout/quote', { pincode: '560034' }, { token: friend.accessToken })
    assert.equal(q.status, 200, JSON.stringify(q.body))
    const c = await api.post('/v1/checkout/confirm', { quoteId: q.body.quoteId, address: FRIEND_ADDRESS }, { token: friend.accessToken, headers: { 'Idempotency-Key': newId('idem') } })
    assert.equal(c.status, 201, JSON.stringify(c.body))
    await pay(c.body.orderId)
    await markDelivered(c.body.orderId)
    assert.deepEqual(await settleReferrals(), { rewarded: 0, voided: 1 })
    const r = await referral(friendId)
    assert.equal(r.status, 'VOID')
    assert.equal(r.void_reason, 'ORDER_TOO_SMALL', 'only regular boxes count toward the minimum')

    // A thank-you code (given by hand here) on a bulk-only cart is refused like any promo code.
    await query(`INSERT INTO promo_codes (code, kind, value, min_subtotal, max_uses, per_customer, created_at, owner_customer_id) VALUES ('TYBULKTEST', 'FLAT', 10000, 0, 1, 1, $1, $2)`, [now(), friendId])
    assert.equal((await api.post('/v1/cart/bulk', { listingId: l.body.id, stage: 'RIPE', qty: 10 }, { token: friend.accessToken })).status, 204)
    const bq = await api.post('/v1/checkout/quote', { pincode: '560034', promoCode: 'TYBULKTEST' }, { token: friend.accessToken })
    assert.equal(bq.body.error.code, 'PROMO_NOT_FOR_BULK')
  })

  test('no self-referral: own code, the same number, the same address, or two accounts referring each other', async () => {
    await stock()
    const a = await customerToken(api)
    const code = (await api.get('/v1/me/referral', { token: a.accessToken })).body.code
    const own = await api.post('/v1/me/referral/apply', { code }, { token: a.accessToken })
    assert.equal(own.status, 400)
    assert.equal(own.body.error.code, 'REFERRAL_SELF')
    // Lower case and spaces are fine; a code that doesn't exist is not.
    const bad = await api.post('/v1/me/referral/apply', { code: 'ZZZZ2222' }, { token: a.accessToken })
    assert.equal(bad.body.error.code, 'REFERRAL_INVALID')
    assert.equal((await api.post('/v1/me/referral/apply', { code: '!!' }, { token: a.accessToken })).body.error.code, 'REFERRAL_INVALID')

    // The same address as the referrer (an order placed there, not paid), with other spacing and case.
    const referrer = await customerToken(api)
    const rcode = (await api.get('/v1/me/referral', { token: referrer.accessToken })).body.code
    const ro = await place(referrer.accessToken, { address: REFERRER_ADDRESS })
    assert.ok(ro.body.orderId)
    const sameHome = await customerToken(api)
    const unpaid = await place(sameHome.accessToken, { address: '12 4th cross,   koramangala, BENGALURU' })
    assert.equal((await api.post(`/v1/orders/${unpaid.body.orderId}/cancel`, undefined, { token: sameHome.accessToken })).status, 204)
    const home = await api.post('/v1/me/referral/apply', { code: rcode.toLowerCase().replace(/(....)/, '$1 ') }, { token: sameHome.accessToken })
    assert.equal(home.status, 400, JSON.stringify(home.body))
    assert.equal(home.body.error.code, 'REFERRAL_SELF')

    // Two new accounts referring each other: the second one is refused.
    const b = await customerToken(api)
    const bcode = (await api.get('/v1/me/referral', { token: b.accessToken })).body.code
    assert.equal((await api.post('/v1/me/referral/apply', { code }, { token: b.accessToken })).status, 201)
    const ring = await api.post('/v1/me/referral/apply', { code: bcode }, { token: a.accessToken })
    assert.equal(ring.body.error.code, 'REFERRAL_SELF')
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM referrals')).rows[0].n, 1)
  })

  test("an order to the referrer's address or number, placed after the code was entered, earns nothing", async () => {
    await stock()
    const referrer = await customerToken(api)
    const rcode = (await api.get('/v1/me/referral', { token: referrer.accessToken })).body.code
    const ro = await place(referrer.accessToken, { address: REFERRER_ADDRESS })
    await pay(ro.body.orderId)
    const friend = await customerToken(api)
    assert.equal((await api.post('/v1/me/referral/apply', { code: rcode }, { token: friend.accessToken })).status, 201)
    const o = await place(friend.accessToken, { address: REFERRER_ADDRESS.toUpperCase() })
    await pay(o.body.orderId)
    await markDelivered(o.body.orderId)
    assert.deepEqual(await settleReferrals(), { rewarded: 0, voided: 1 })
    const friendId = await idOf(friend.accessToken)
    assert.equal((await referral(friendId)).void_reason, 'SAME_ADDRESS')
    assert.equal((await rewards()).length, 0)
    assert.equal((await api.get('/v1/me/referral', { token: friend.accessToken })).body.entered.status, 'VOID')

    // A gift to the referrer's own number.
    const other = await customerToken(api)
    assert.equal((await api.post('/v1/me/referral/apply', { code: rcode }, { token: other.accessToken })).status, 201)
    const referrerPhone = (await query('SELECT phone FROM customers WHERE id = $1', [await idOf(referrer.accessToken)])).rows[0].phone
    const g = await place(other.accessToken, { address: '5, Lake Road, Ulsoor, Bengaluru', gift: { recipientName: 'Ravi', recipientPhone: referrerPhone.replace('+91', '') } })
    await pay(g.body.orderId)
    await markDelivered(g.body.orderId)
    await settleReferrals()
    assert.equal((await referral(await idOf(other.accessToken))).void_reason, 'SAME_PHONE')
  })

  test('one code per new customer, and only before anything is paid', async () => {
    await stock()
    const { friend, code } = await referredPair()
    const again = await api.post('/v1/me/referral/apply', { code }, { token: friend.accessToken })
    assert.equal(again.status, 409)
    assert.equal(again.body.error.code, 'REFERRAL_ALREADY_USED')
    const other = await customerToken(api)
    const otherCode = (await api.get('/v1/me/referral', { token: other.accessToken })).body.code
    assert.equal((await api.post('/v1/me/referral/apply', { code: otherCode }, { token: friend.accessToken })).body.error.code, 'REFERRAL_ALREADY_USED')

    // Someone who has paid for an order before is not new.
    const old = await customerToken(api)
    const o = await place(old.accessToken)
    await pay(o.body.orderId)
    assert.equal((await api.get('/v1/me/referral', { token: old.accessToken })).body.canEnterCode, false)
    const late = await api.post('/v1/me/referral/apply', { code }, { token: old.accessToken })
    assert.equal(late.status, 409)
    assert.equal(late.body.error.code, 'REFERRAL_NOT_NEW')
    // Two tries at once: one referral.
    const fresh = await customerToken(api)
    const both = await Promise.all([1, 2].map(() => api.post('/v1/me/referral/apply', { code }, { token: fresh.accessToken })))
    assert.deepEqual(both.map((r) => r.status).sort(), [201, 409])
  })

  test('a cancelled (refunded) first order, or one under the minimum, voids the referral', async () => {
    await stock()
    const { friend, friendId } = await referredPair()
    const o = await place(friend.accessToken)
    await pay(o.body.orderId)
    // The customer cancels before packing: refunded in full.
    assert.equal((await api.post(`/v1/orders/${o.body.orderId}/cancel`, undefined, { token: friend.accessToken })).status, 204)
    assert.deepEqual(await settleReferrals(), { rewarded: 0, voided: 1 })
    assert.equal((await referral(friendId)).void_reason, 'ORDER_CANCELLED')
    // A later order doesn't bring it back: the first order decides.
    const o2 = await place(friend.accessToken)
    await pay(o2.body.orderId)
    await markDelivered(o2.body.orderId)
    assert.deepEqual(await settleReferrals(), { rewarded: 0, voided: 0 })
    assert.equal((await rewards()).length, 0)

    env.REFERRAL_MIN_ORDER_RUPEES = 2000
    const second = await referredPair()
    const small = await place(second.friend.accessToken)
    await pay(small.body.orderId)
    await markDelivered(small.body.orderId)
    await settleReferrals()
    assert.equal((await referral(second.friendId)).void_reason, 'ORDER_TOO_SMALL')
  })

  test('a first order cancelled after the reward: unused codes are withdrawn, a used one stays used, and nothing is sent', async () => {
    await stock()
    const { referrer, friend, friendId } = await referredPair()
    const o = await place(friend.accessToken)
    await pay(o.body.orderId)
    assert.deepEqual(await settleReferrals(), { rewarded: 1, voided: 0 })
    const [friendReward, referrerReward] = await rewards()
    // The referrer spends theirs straight away; the friend has not used theirs.
    const spent = await place(referrer.accessToken, { promoCode: referrerReward.promo_code, address: REFERRER_ADDRESS })
    await pay(spent.body.orderId)
    // Now the friend cancels the first order (before packing: refunded in full).
    assert.equal((await api.post(`/v1/orders/${o.body.orderId}/cancel`, undefined, { token: friend.accessToken })).status, 204)
    // Two runs at once: withdrawn once.
    const [x, y] = await Promise.all([settleReferrals(), settleReferrals()])
    assert.equal(x.voided + y.voided, 1)
    const r = await referral(friendId)
    assert.equal(r.status, 'VOID')
    assert.equal(r.void_reason, 'ORDER_CANCELLED_AFTER_REWARD')
    assert.equal(await tx((c) => withdrawOne(c, r.id)), null, 'a withdrawn referral is left alone')
    const after = Object.fromEntries((await rewards()).map((g) => [g.role, g]))
    assert.ok(after.FRIEND.withdrawn_at, 'the unused code is withdrawn')
    assert.equal(after.REFERRER.withdrawn_at, null, 'a code already used stays used')
    assert.equal((await query('SELECT active FROM promo_codes WHERE code = $1', [friendReward.promo_code])).rows[0].active, false)
    assert.equal((await place(friend.accessToken, { promoCode: friendReward.promo_code })).body.error.code, 'PROMO_INVALID')
    assert.equal((await api.get('/v1/me/referral', { token: friend.accessToken })).body.rewards[0].state, 'WITHDRAWN')
    assert.equal((await api.get('/v1/me/referral', { token: referrer.accessToken })).body.rewards[0].state, 'USED')
    // The friend's thank-you WhatsApp, still queued, is not sent; the referrer's still is.
    const sent = []
    await sendDueNotifications({ sender: async (m) => (sent.push(m), `wamid.${sent.length}`) })
    const thanks = sent.filter((m) => m.template === 'mandi_referral_reward')
    assert.deepEqual(thanks.map((m) => m.params[2]), [referrerReward.promo_code])
  })

  test('the reward can be a capped percent, or a flat amount', async () => {
    await stock()
    Object.assign(env, { REFERRAL_REWARD_KIND: 'PERCENT', REFERRAL_REWARD_PERCENT: 15, REFERRAL_REWARD_MAX_RUPEES: 150 })
    const a = await referredPair()
    assert.equal((await api.get('/v1/me/referral', { token: a.friend.accessToken })).body.rewardMaxRupees, 150)
    await pay((await place(a.friend.accessToken)).body.orderId)
    await settleReferrals()
    const capped = (await query('SELECT kind, value, max_discount FROM promo_codes p JOIN referral_rewards rr ON rr.promo_code = p.code WHERE rr.customer_id = $1', [a.friendId])).rows[0]
    assert.deepEqual(capped, { kind: 'PERCENT', value: 15, max_discount: 15_000 })
    await api.post('/v1/cart/items', { sku: 'ALP-3', stage: 'RIPE', qty: 0 }, { token: a.friend.accessToken })
    const code = (await rewards()).find((g) => g.role === 'FRIEND').promo_code
    assert.equal((await place(a.friend.accessToken, { promoCode: code })).quote.discount, 15_000, '15% of Rs 1,899 is Rs 284, capped at Rs 150')

    Object.assign(env, { REFERRAL_REWARD_KIND: 'FLAT', REFERRAL_REWARD_RUPEES: 100 })
    const b = await referredPair()
    const view = (await api.get('/v1/me/referral', { token: b.friend.accessToken })).body
    assert.equal(view.rewardKind, 'FLAT')
    assert.equal(view.rewardRupees, 100)
    assert.equal(view.rewardPercent, null)
    await pay((await place(b.friend.accessToken, { address: '7, Rose Apartments, HSR Layout, Bengaluru' })).body.orderId)
    await settleReferrals()
    const flat = (await query('SELECT kind, value FROM promo_codes p JOIN referral_rewards rr ON rr.promo_code = p.code WHERE rr.customer_id = $1', [b.friendId])).rows[0]
    assert.deepEqual(flat, { kind: 'FLAT', value: 10_000 })
    const sent = []
    await sendDueNotifications({ sender: async (m) => (sent.push(m), `wamid.${sent.length}`) })
    assert.ok(sent.some((m) => m.template === 'mandi_referral_reward' && m.params[1] === 'Rs 100'))
  })

  test('a referrer gets at most REFERRAL_MAX_PER_MONTH thank-yous a month; their friends still get theirs', async () => {
    await stock()
    env.REFERRAL_MAX_PER_MONTH = 1
    const referrer = await customerToken(api)
    const code = (await api.get('/v1/me/referral', { token: referrer.accessToken })).body.code
    const friends = [await customerToken(api), await customerToken(api)]
    for (const [i, f] of friends.entries()) {
      assert.equal((await api.post('/v1/me/referral/apply', { code }, { token: f.accessToken })).status, 201)
      const o = await place(f.accessToken, { address: `${i + 3}, Rose Apartments, HSR Layout, Bengaluru` })
      await pay(o.body.orderId)
      await markDelivered(o.body.orderId)
    }
    assert.deepEqual(await settleReferrals(), { rewarded: 2, voided: 0 })
    const given = await rewards()
    assert.equal(given.filter((g) => g.role === 'FRIEND').length, 2)
    assert.equal(given.filter((g) => g.role === 'REFERRER').length, 1)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM referrals WHERE referrer_capped')).rows[0].n, 1)
    // A new month: the cap starts again.
    setNow('2026-11-02T04:30:00Z')
    await stock()
    const third = await customerToken(api)
    assert.equal((await api.post('/v1/me/referral/apply', { code }, { token: third.accessToken })).status, 201)
    const o = await place(third.accessToken, { address: '9, Rose Apartments, HSR Layout, Bengaluru' })
    await pay(o.body.orderId)
    await markDelivered(o.body.orderId)
    await settleReferrals()
    assert.equal((await rewards()).filter((g) => g.role === 'REFERRER').length, 2)
    setNow(T0)
  })

  test('the Referrals view is for managers only', async () => {
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    assert.equal((await api.get('/admin/v1/referrals', { token: ops })).status, 403)
    assert.equal((await api.get('/admin/v1/referrals', { token: admin })).status, 200)
    assert.equal((await api.get('/admin/v1/referrals?status=NOPE', { token: admin })).status, 400)
  })
})

// ---------------------------------------------------------------- funnel

describe('funnel analytics', () => {
  const event = (body, headers) => api.post('/v1/events', body, { headers })
  const rows = async () => (await query('SELECT * FROM funnel_events ORDER BY step')).rows

  test('switched off: events are dropped with 204, and the report answers 404', async () => {
    const r = await event({ browserId: randomUUID(), step: 'visit' })
    assert.equal(r.status, 204)
    assert.equal((await event({ anything: 'at all' })).status, 204, 'not even validated while off')
    assert.equal((await rows()).length, 0)
    assert.equal((await api.get('/admin/v1/analytics/funnel', { token: admin })).status, 404)
    assert.equal((await api.get('/v1/policy')).body.features.funnel, false)
  })

  test('on: the four shop steps are stored once per browser per day, and nothing about the person', async () => {
    env.FUNNEL_ANALYTICS = true
    const id = randomUUID()
    for (const step of ['visit', 'visit', 'product_view', 'add_to_cart', 'checkout_start']) assert.equal((await event({ browserId: id, step })).status, 204)
    // A signed-in customer's token is not read: the row has the random id only.
    const cust = await customerToken(api)
    assert.equal((await event({ browserId: id, step: 'visit' }, { Authorization: `Bearer ${cust.accessToken}` })).status, 204)
    const stored = await rows()
    assert.equal(stored.length, 4)
    assert.deepEqual(Object.keys(stored[0]).sort(), ['browser_id', 'created_at', 'day', 'step'])
    assert.ok(stored.every((r) => r.browser_id === id && r.day === todayIST()))
  })

  test('step names and ids are checked; "paid" is never taken from the shop; extra fields are refused', async () => {
    env.FUNNEL_ANALYTICS = true
    const id = randomUUID()
    for (const body of [
      { browserId: id, step: 'paid' }, { browserId: id, step: 'purchase' }, { browserId: 'not-a-uuid', step: 'visit' }, { step: 'visit' },
      { browserId: id, step: 'visit', phone: '+919876543210' }, { browserId: id, step: 'visit', customerId: 'cus_1' },
    ]) {
      const r = await event(body)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.equal(r.body.error.code, 'VALIDATION_ERROR')
    }
    assert.equal((await rows()).length, 0)
  })

  test('the public endpoint is rate limited per address', async () => {
    env.FUNNEL_ANALYTICS = true
    enforceLimitsInTests(true)
    let last
    for (let i = 0; i < 121; i++) last = await event({ browserId: randomUUID(), step: 'visit' })
    assert.equal(last.status, 429)
    assert.equal(last.body.error.code, 'RATE_LIMITED')
    assert.equal((await rows()).length, 120)
  })

  test('"paid" is recorded by the server when the payment is captured, for the browser that started that checkout', async () => {
    env.FUNNEL_ANALYTICS = true
    await stock()
    const id = randomUUID()
    const cust = await customerToken(api)
    const o = await place(cust.accessToken, { funnelId: id })
    assert.equal((await query('SELECT browser_id FROM funnel_checkouts WHERE order_id = $1', [o.body.orderId])).rows[0].browser_id, id)
    assert.equal((await rows()).filter((r) => r.step === 'paid').length, 0, 'not paid yet')
    await pay(o.body.orderId)
    const paid = (await rows()).filter((r) => r.step === 'paid')
    assert.equal(paid.length, 1)
    assert.equal(paid[0].browser_id, id)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM funnel_checkouts')).rows[0].n, 0, 'the order-to-browser link is gone')
    // A second capture message changes nothing.
    await pay(o.body.orderId)
    assert.equal((await rows()).filter((r) => r.step === 'paid').length, 1)
    // A bad id from the shop is refused at checkout.
    await api.post('/v1/cart/items', { sku: 'ALP-3', stage: 'RIPE', qty: 1 }, { token: cust.accessToken })
    const q = await api.post('/v1/checkout/quote', { pincode: '560034' }, { token: cust.accessToken })
    const bad = await api.post('/v1/checkout/confirm', { quoteId: q.body.quoteId, address: FRIEND_ADDRESS, funnelId: 'cus_123' }, { token: cust.accessToken, headers: { 'Idempotency-Key': newId('idem') } })
    assert.equal(bad.status, 400)
  })

  test('the funnel by day: counts and conversion, managers only, with a date range', async () => {
    env.FUNNEL_ANALYTICS = true
    const day = todayIST()
    const ids = Array.from({ length: 4 }, () => randomUUID())
    for (const id of ids) await event({ browserId: id, step: 'visit' })
    for (const id of ids.slice(0, 2)) await event({ browserId: id, step: 'product_view' })
    await event({ browserId: ids[0], step: 'add_to_cart' })
    await event({ browserId: ids[0], step: 'checkout_start' })
    await query(`INSERT INTO funnel_events (day, browser_id, step, created_at) VALUES ($1, $2, 'paid', $3)`, [day, ids[0], now()])
    const r = await api.get(`/admin/v1/analytics/funnel?from=${addDays(day, -1)}&to=${day}`, { token: admin })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual(r.body.steps, ['visit', 'product_view', 'add_to_cart', 'checkout_start', 'paid'])
    assert.equal(r.body.days.length, 2)
    const today = r.body.days.find((d) => d.day === day)
    assert.deepEqual(today.counts, { visit: 4, product_view: 2, add_to_cart: 1, checkout_start: 1, paid: 1 })
    assert.deepEqual(today.conversion, { visit: 100, product_view: 50, add_to_cart: 25, checkout_start: 25, paid: 25 })
    assert.deepEqual(today.stepConversion, { product_view: 50, add_to_cart: 50, checkout_start: 100, paid: 100 })
    assert.equal(r.body.days.find((d) => d.day !== day).conversion.paid, null, 'no visits: no rate')
    assert.equal(r.body.totals.counts.visit, 4)

    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    assert.equal((await api.get('/admin/v1/analytics/funnel', { token: ops })).status, 403)
    assert.equal((await api.get(`/admin/v1/analytics/funnel?from=${day}&to=${addDays(day, -1)}`, { token: admin })).status, 400)
    assert.equal((await api.get(`/admin/v1/analytics/funnel?from=${addDays(day, -200)}&to=${day}`, { token: admin })).status, 400)
    assert.equal((await api.get('/admin/v1/analytics/funnel', { token: admin })).body.days.length, 14)
  })

  test('kept 90 days in the daily retention pass, with the counts rolled up first', async () => {
    env.FUNNEL_ANALYTICS = true
    const today = todayIST()
    const recent = addDays(today, -89)
    const old = addDays(today, -95)
    for (const [day, n] of [[recent, 3], [old, 2], [today, 1]]) {
      for (let i = 0; i < n; i++) await query(`INSERT INTO funnel_events (day, browser_id, step, created_at) VALUES ($1, $2, 'visit', $3)`, [day, randomUUID(), now()])
    }
    const out = await runMaintenance({ forceAll: true })
    assert.ok(out.funnel, JSON.stringify(out))
    assert.equal(out.funnel.pruned, 2)
    const left = (await query('SELECT day, COUNT(*)::int AS n FROM funnel_events GROUP BY day ORDER BY day')).rows
    assert.deepEqual(left, [{ day: recent, n: 3 }, { day: today, n: 1 }])
    assert.deepEqual((await query('SELECT day, step, browsers FROM funnel_daily ORDER BY day')).rows, [{ day: recent, step: 'visit', browsers: 3 }])
    // Once its events are gone the day still reads from the rollup; a rollup never goes down.
    await query('DELETE FROM funnel_events WHERE day = $1', [recent])
    await rollupAndPruneFunnel()
    const r = await api.get(`/admin/v1/analytics/funnel?from=${recent}&to=${addDays(recent, 1)}`, { token: admin })
    assert.equal(r.body.days[0].counts.visit, 3)
  })
})

// ---------------------------------------------------------------- daily summary

describe('daily manager summary', () => {
  // 20:05 IST on T0's day.
  const EVENING = '2026-10-15T14:35:00Z'
  const optIn = (token = admin, body = { optedIn: true, phone: '98765 43210' }) => api.put('/admin/v1/me/daily-summary', body, { token })
  const summaries = async () => (await query('SELECT * FROM manager_summaries ORDER BY created_at')).rows

  test('switched off: 404 for the setting and the preview, and nothing is sent', async () => {
    assert.equal((await api.get('/admin/v1/me/daily-summary', { token: admin })).status, 404)
    assert.equal((await optIn()).status, 404)
    assert.equal((await api.get('/admin/v1/daily-summary/preview', { token: admin })).status, 404)
    await query(`UPDATE admin_users SET daily_summary_opt_in = TRUE, daily_summary_phone = '+919876543210' WHERE email = 'manager@mandimangoes.test'`)
    setNow(EVENING)
    assert.equal(await sendManagerSummaries(), 0)
    assert.equal((await summaries()).length, 0)
    setNow(T0)
  })

  test('a manager opts in with a WhatsApp number (shown masked); others may not', async () => {
    env.MANAGER_DAILY_SUMMARY = true
    assert.deepEqual((await api.get('/admin/v1/me/daily-summary', { token: admin })).body, { optedIn: false, phone: null, time: '20:00' })
    const noPhone = await optIn(admin, { optedIn: true })
    assert.equal(noPhone.status, 400)
    assert.equal(noPhone.body.error.code, 'PHONE_REQUIRED')
    assert.equal((await optIn(admin, { optedIn: true, phone: '12345' })).status, 400)
    const on = await optIn()
    assert.equal(on.status, 200)
    assert.deepEqual(on.body, { optedIn: true, phone: '+919876••••10', time: '20:00' })
    // Off keeps the number for next time.
    assert.deepEqual((await optIn(admin, { optedIn: false })).body, { optedIn: false, phone: '+919876••••10', time: '20:00' })
    assert.equal((await optIn(admin, { optedIn: true })).status, 200)
    const staff = (await api.get('/admin/v1/staff', { token: admin })).body
    assert.equal(staff.find((s) => s.email === 'manager@mandimangoes.test').dailySummary, true)
    assert.equal(staff.find((s) => s.email === 'ops@mandimangoes.test').dailySummary, false)

    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    assert.equal((await api.get('/admin/v1/me/daily-summary', { token: ops })).status, 403)
    assert.equal((await optIn(ops)).status, 403)
    assert.equal((await api.get('/admin/v1/daily-summary/preview', { token: ops })).status, 403)
  })

  test("the evening summary: the day's numbers, once a day per opted-in manager, by the WhatsApp outbox", async () => {
    env.MANAGER_DAILY_SUMMARY = true
    await stock()
    assert.equal((await optIn()).status, 200)
    // The day: one paid order (delivered), one missed delivery, one claim, one unhappy rating.
    const cust = await customerToken(api)
    const o = await place(cust.accessToken)
    await pay(o.body.orderId)
    await markDelivered(o.body.orderId)
    const other = await customerToken(api)
    const f = await place(other.accessToken, { address: REFERRER_ADDRESS })
    await pay(f.body.orderId)
    await query(`INSERT INTO order_events (id, order_id, from_status, status, actor, created_at) VALUES ($1, $2, 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'test', $3)`, [newId('evt'), f.body.orderId, now()])
    const customerId = await idOf(cust.accessToken)
    await query(`INSERT INTO claims (id, order_id, customer_id, issue_type, description, created_at) VALUES ($1, $2, $3, 'DAMAGED', 'Squashed box', $4)`, [newId('clm'), o.body.orderId, customerId, now()])
    await query(`INSERT INTO order_ratings (order_id, customer_id, stars, comment, created_at, updated_at) VALUES ($1, $2, 1, NULL, $3, $3)`, [o.body.orderId, customerId, now()])

    // Before 20:00 IST nothing goes.
    assert.equal(await sendManagerSummaries(), 0)
    const preview = await api.get('/admin/v1/daily-summary/preview', { token: admin })
    assert.equal(preview.status, 200)
    const want = { day: todayIST(), orders: 2, revenue: 2 * 189_900, boxesDelivered: 1, boxesFailed: 1, newClaims: 1, unhappyRatings: 1 }
    const { needsAttention, ...rest } = preview.body.numbers
    assert.deepEqual(rest, want)
    assert.equal(needsAttention, attentionCount(await attentionReport()))
    assert.ok(needsAttention >= 1, 'the loop has not run in this test, which Needs attention lists')
    assert.match(preview.body.text, /Orders: 2 \(Rs 3,798\)/)
    assert.equal(preview.body.recipients, 1)
    assert.equal(preview.body.sentToday, 0)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM notifications WHERE kind = $1', ['MANAGER_DAILY_SUMMARY'])).rows[0].n, 0, 'a preview sends nothing')

    setNow(EVENING)
    // Several runs at once, and again later: one summary.
    const counts = await Promise.all([sendManagerSummaries(), sendManagerSummaries(), sendManagerSummaries()])
    assert.equal(counts.reduce((a, b) => a + b, 0), 1)
    assert.equal(await sendManagerSummaries(), 0)
    assert.equal((await summaries()).length, 1)
    const sent = []
    await sendDueNotifications({ sender: async (m) => (sent.push(m), 'wamid.sum') })
    const sums = sent.filter((m) => m.template === 'mandimangoes_daily_summary')
    assert.equal(sums.length, 1)
    assert.equal(sums[0].phone, '+919876543210')
    assert.deepEqual(sums[0].params, ['Thu, 15 Oct', '2', 'Rs 3,798', '1', '1', '1', '1', String(needsAttention)])
    assert.equal((await api.get('/admin/v1/daily-summary/preview', { token: admin })).body.sentToday, 1)

    // The next evening: one more.
    setNow('2026-10-16T14:35:00Z')
    assert.equal(await sendManagerSummaries(), 1)
    setNow(T0)
  })

  test('the summary time is a setting; a held lease skips the run; opting out before it goes stops it', async () => {
    env.MANAGER_DAILY_SUMMARY = true
    env.MANAGER_SUMMARY_TIME = '21:30'
    assert.equal((await optIn()).status, 200)
    setNow(EVENING)
    assert.equal(await sendManagerSummaries(), 0, 'not before 21:30')
    setNow('2026-10-15T16:05:00Z') // 21:35 IST
    // Another run holds the lease: this one leaves it.
    const holder = await takeLease('manager-summary', 60_000)
    assert.ok(holder)
    assert.equal(await sendManagerSummaries(), 0)
    await query(`DELETE FROM job_leases WHERE name = 'manager-summary'`)
    assert.equal(await sendManagerSummaries(), 1)
    // Opted out before the message went: it is skipped, not sent.
    assert.equal((await optIn(admin, { optedIn: false })).status, 200)
    const sent = []
    await sendDueNotifications({ sender: async (m) => (sent.push(m), 'wamid.x') })
    assert.equal(sent.length, 0)
    const n = (await query(`SELECT status, last_error FROM notifications WHERE kind = 'MANAGER_DAILY_SUMMARY'`)).rows[0]
    assert.deepEqual(n, { status: 'SKIPPED', last_error: 'summary turned off since' })
    setNow(T0)
  })

  test('the maintenance run sends it; only managers get it', async () => {
    env.MANAGER_DAILY_SUMMARY = true
    assert.equal((await optIn()).status, 200)
    // An operator with the columns set by hand is still not sent one.
    await query(`UPDATE admin_users SET daily_summary_opt_in = TRUE, daily_summary_phone = '+919811111111' WHERE email = 'ops@mandimangoes.test'`)
    setNow(EVENING)
    const out = await runMaintenance({ forceAll: true })
    assert.equal(out.managerSummaries, 1)
    const rows = (await query(`SELECT phone, status FROM notifications WHERE kind = 'MANAGER_DAILY_SUMMARY'`)).rows
    assert.deepEqual(rows.map((r) => r.phone), ['+919876543210'])
    setNow(T0)
  })
})
