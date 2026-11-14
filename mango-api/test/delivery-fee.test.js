// The delivery charge on regular orders (src/delivery-fee.js): off by default, then by distance from the
// nearest warehouse and by what the order is worth.
import { closeAll, adminToken, client, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { currentConfig, DEFAULT_DELIVERY_FEE, rulesSchema, saveConfig } from '../src/config.js'
import { chargeFor } from '../src/delivery-fee.js'
import { query } from '../src/db.js'
import { newId } from '../src/ids.js'

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
  await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20 } })
})

// 560034's centre in the seed, and points a known distance north of it (one degree of latitude is 111.19 km).
const CENTRE = { lat: 12.9279, lng: 77.6271 }
const north = (kmAway) => ({ lat: CENTRE.lat + kmAway / 111.19, lng: CENTRE.lng })
const ADDRESS = '12, 4th Cross, Koramangala, Bengaluru'
const ALP3 = 189900 // one Alphonso 3 kg box, in paise

/** Turns the charge on with the warehouse at 560034's centre (and anything else a test changes). */
const turnOn = (over = {}) => saveConfig({ ...currentConfig().rules, deliveryFee: { ...DEFAULT_DELIVERY_FEE, enabled: true, origins: [{ name: 'Main', ...CENTRE }], ...over } }, 'test')

async function quote(token, body = {}) {
  assert.equal((await api.post('/v1/cart/items', { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }, { token })).status, 204)
  return api.post('/v1/checkout/quote', { pincode: '560034', ...body }, { token })
}

describe('the table', () => {
  const rules = DEFAULT_DELIVERY_FEE
  test('an order of ₹1,000 or more pays the band’s charge, a smaller one the higher charge', () => {
    assert.deepEqual([chargeFor(1.9, 100_000, rules).fee, chargeFor(1.9, 99_999, rules).fee], [0, 3000])
    assert.deepEqual([chargeFor(2, 100_000, rules).fee, chargeFor(2.01, 100_000, rules).fee], [0, 3000])
    assert.deepEqual([chargeFor(4.5, 500_000, rules).fee, chargeFor(4.5, 50_000, rules).fee], [3000, 5000])
    assert.deepEqual([chargeFor(7, 500_000, rules).fee, chargeFor(11.9, 500_000, rules).fee, chargeFor(11.9, 50_000, rules).fee], [5000, 8000, 10_000])
  })
  test('past the last band the order is refused, or pays the last band when the rules say so', () => {
    assert.equal(chargeFor(12.1, 500_000, rules).tooFar, true)
    const charge = chargeFor(30, 500_000, { ...rules, beyond: 'charge' })
    assert.deepEqual([charge.tooFar, charge.fee], [false, 8000])
  })
  test('a manager cannot save distances out of order, or an unknown key', () => {
    const base = currentConfig().rules
    const bad = { ...DEFAULT_DELIVERY_FEE, bands: [{ uptoKm: 5, fee: 0, feeSmall: 30 }, { uptoKm: 2, fee: 30, feeSmall: 50 }] }
    assert.equal(rulesSchema.safeParse({ ...base, deliveryFee: bad }).success, false)
    assert.equal(rulesSchema.safeParse({ ...base, deliveryFee: { ...DEFAULT_DELIVERY_FEE, surge: 2 } }).success, false)
    assert.equal(rulesSchema.safeParse({ ...base, deliveryFee: DEFAULT_DELIVERY_FEE }).success, true)
  })
})

describe('off (as shipped)', () => {
  test('nothing is charged and the answers are as before', async () => {
    const { accessToken: token } = await customerToken(api)
    const q = await quote(token, { location: north(9) })
    assert.equal(q.status, 200, JSON.stringify(q.body))
    assert.deepEqual([q.body.deliveryFee, q.body.total, 'delivery' in q.body], [0, ALP3, false])
    const check = await api.get('/v1/delivery/check?pincode=560034')
    assert.equal('delivery' in check.body, false)
    assert.deepEqual((await api.get('/v1/policy')).body.deliveryFee, { enabled: false })
  })
})

describe('on', () => {
  test('inside the free circle a ₹1,000 order is delivered free; a smaller one pays', async () => {
    await turnOn()
    const { accessToken: token } = await customerToken(api)
    const q = await quote(token, { location: north(1) })
    assert.equal(q.status, 200, JSON.stringify(q.body))
    assert.deepEqual([q.body.deliveryFee, q.body.total, q.body.delivery.basis, q.body.delivery.distanceKm], [0, ALP3, 'pin', 1])
    // The same box counts as a small order once the free amount is above its price.
    await turnOn({ freeAbove: 5000 })
    const small = await api.post('/v1/checkout/quote', { pincode: '560034', location: north(1) }, { token })
    assert.deepEqual([small.body.deliveryFee, small.body.total], [3000, ALP3 + 3000])
  })

  test('further out the charge applies whatever the order is worth, and the order carries it', async () => {
    await turnOn()
    const { accessToken: token } = await customerToken(api)
    const q = await quote(token, { location: north(3) })
    assert.deepEqual([q.body.deliveryFee, q.body.total, q.body.delivery.distanceKm], [3000, ALP3 + 3000, 3])
    const o = await api.post('/v1/checkout/confirm', { quoteId: q.body.quoteId, address: ADDRESS }, { token, headers: { 'Idempotency-Key': newId('idem') } })
    assert.equal(o.status, 201, JSON.stringify(o.body))
    assert.equal(o.body.total, ALP3 + 3000)
    assert.equal((await api.post('/v1/dev/pay', { orderId: o.body.orderId, outcome: 'captured' })).status, 200)
    const mine = (await api.get(`/v1/orders/${o.body.orderId}`, { token })).body
    assert.deepEqual([mine.subtotal, mine.deliveryFee, mine.deliveryKm, mine.total], [ALP3, 3000, 3, ALP3 + 3000])
    const staff = (await api.get(`/admin/v1/orders/${o.body.orderId}`, { token: admin })).body
    assert.deepEqual([staff.deliveryFee, staff.deliveryKm, staff.total], [3000, 3, ALP3 + 3000])
    const row = (await query('SELECT total, payment_amount, delivery_km FROM orders WHERE id = $1', [o.body.orderId])).rows[0]
    assert.deepEqual([row.total, row.payment_amount, Number(row.delivery_km)], [ALP3 + 3000, ALP3 + 3000, 3])
  })

  test('the charge is the one quoted, even if the rules change before the customer pays', async () => {
    await turnOn()
    const { accessToken: token } = await customerToken(api)
    const q = await quote(token, { location: north(3) })
    await turnOn({ bands: [{ uptoKm: 12, fee: 500, feeSmall: 500 }] })
    const o = await api.post('/v1/checkout/confirm', { quoteId: q.body.quoteId, address: ADDRESS }, { token, headers: { 'Idempotency-Key': newId('idem') } })
    assert.equal(o.body.total, ALP3 + 3000)
  })

  test('without a pin the pincode’s centre is used; a pin far from its pincode is not believed', async () => {
    await turnOn({ origins: [{ name: 'Main', ...north(6) }] })
    const { accessToken: token } = await customerToken(api)
    const q = await quote(token)
    assert.deepEqual([q.body.delivery.basis, q.body.delivery.distanceKm, q.body.deliveryFee], ['pincode', 6, 5000])
    // A pin dropped on the warehouse itself, 6 km from the pincode's centre, is still plausible for the pincode…
    const near = await api.post('/v1/checkout/quote', { pincode: '560034', location: north(6) }, { token })
    assert.deepEqual([near.body.delivery.basis, near.body.deliveryFee], ['pin', 0])
    // …one 20 km away is not: the centre is used instead.
    const far = await api.post('/v1/checkout/quote', { pincode: '560034', location: north(20) }, { token })
    assert.deepEqual([far.body.delivery.basis, far.body.delivery.distanceKm, far.body.deliveryFee], ['pincode', 6, 5000])
  })

  test('past the last band the order is refused with the distance, or charged the last band', async () => {
    await turnOn({ origins: [{ name: 'Main', ...north(15) }] })
    const { accessToken: token } = await customerToken(api)
    const q = await quote(token)
    assert.equal(q.status, 422, JSON.stringify(q.body))
    assert.equal(q.body.error.code, 'TOO_FAR')
    assert.match(q.body.error.message, /about 15 km .* up to 12 km/)
    await turnOn({ origins: [{ name: 'Main', ...north(15) }], beyond: 'charge' })
    const charged = await api.post('/v1/checkout/quote', { pincode: '560034' }, { token })
    assert.deepEqual([charged.status, charged.body.deliveryFee], [200, 8000])
  })

  test('with no position for the warehouse or the pincode, the assumed distance is charged and nobody is refused', async () => {
    await turnOn({ origins: [], unknownKm: 30 })
    await query('UPDATE warehouses SET lat = NULL, lng = NULL')
    const { accessToken: token } = await customerToken(api)
    const q = await quote(token)
    assert.deepEqual([q.status, q.body.delivery.basis, q.body.deliveryFee], [200, 'unknown', 8000])
  })

  test('the nearest of several warehouses counts', async () => {
    await turnOn({ origins: [{ name: 'Far', ...north(10) }, { name: 'Near', ...north(-1.5) }] })
    const { accessToken: token } = await customerToken(api)
    const q = await quote(token)
    assert.deepEqual([q.body.delivery.distanceKm, q.body.deliveryFee], [1.5, 0])
  })

  test('the shop can ask before checkout, and quote the table on its pages', async () => {
    await turnOn()
    const at = north(4)
    const check = (await api.get(`/v1/delivery/check?pincode=560034&lat=${at.lat}&lng=${at.lng}`)).body
    assert.deepEqual(
      [check.delivery.distanceKm, check.delivery.basis, check.delivery.freeAbove, check.delivery.feeAtOrAbove, check.delivery.feeBelow, check.delivery.tooFar],
      [4, 'pin', 100_000, 3000, 5000, false],
    )
    const policy = (await api.get('/v1/policy')).body.deliveryFee
    assert.deepEqual([policy.enabled, policy.freeAbove, policy.bands[0], policy.bands.length], [true, 100_000, { uptoKm: 2, fee: 0, feeSmall: 3000 }, 4])
  })
})
