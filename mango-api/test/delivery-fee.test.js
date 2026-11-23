// The delivery charge on regular orders (src/delivery-fee.js): off by default, then by distance from the
// nearest warehouse and by what the order weighs (the owner's table, 18 Nov).
import { closeAll, adminToken, client, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, test } from 'node:test'
import { currentConfig, DEFAULT_DELIVERY_FEE, DEFAULT_RULES, getConfig, loadConfig, rulesSchema, saveConfig, storedRulesSchema } from '../src/config.js'
import { chargeFor, heavyByWeight, PIN_TOLERANCE_KM, weightKg } from '../src/delivery-fee.js'
import { query, tx } from '../src/db.js'
import { newId } from '../src/ids.js'
import { todayIST } from '../src/clock.js'

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
  await makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 20, 'ALP-5': 10 } })
})

// 560034's centre in the seed, and points a known distance north of it (one degree of latitude is 111.19 km).
const CENTRE = { lat: 12.9279, lng: 77.6271 }
const north = (kmAway) => ({ lat: CENTRE.lat + kmAway / 111.19, lng: CENTRE.lng })
const ADDRESS = '12, 4th Cross, Koramangala, Bengaluru'
const ALP3 = 189900 // one Alphonso 3 kg box, in paise
const ALP5 = 299900 // one Alphonso 5 kg box, in paise

/** Turns the charge on with the warehouse at 560034's centre (and anything else a test changes). */
const turnOn = (over = {}) => saveConfig({ ...currentConfig().rules, deliveryFee: { ...DEFAULT_DELIVERY_FEE, enabled: true, beyond: 'refuse', origins: [{ name: 'Main', ...CENTRE }], ...over } }, 'test')

/** A quote for `qty` boxes of `sku` (one 3 kg box by default: the "under 5 kg" column). */
async function quote(token, body = {}, { sku = 'ALP-3', qty = 1 } = {}) {
  assert.equal((await api.post('/v1/cart/items', { sku, stage: 'SEMI_RIPE', qty }, { token })).status, 204)
  return api.post('/v1/checkout/quote', { pincode: '560034', ...body }, { token })
}
const confirm = (token, quoteId) => api.post('/v1/checkout/confirm', { quoteId, address: ADDRESS }, { token, headers: { 'Idempotency-Key': newId('idem') } })

describe('the table', () => {
  const rules = DEFAULT_DELIVERY_FEE
  const fee = (km, kg, goods = 100_000) => chargeFor(km, goods, rules, kg).fee

  test('the defaults are the owner’s table', () => {
    assert.deepEqual([rules.freeFromKg, rules.freeWithinKm, rules.beyond], [5, 2, 'perKm'])
    assert.deepEqual(rules.bands, [
      { uptoKm: 2, fee: 0, feeSmall: 30 },
      { uptoKm: 5, fee: 30, feeSmall: 50 },
      { uptoKm: 8, fee: 50, feeSmall: 70 },
      { uptoKm: 12, fee: 80, feeSmall: 100 },
    ])
  })
  test('under 5 kg: ₹30 / ₹50 / ₹70 / ₹100 by distance', () => {
    assert.deepEqual([fee(1.5, 3), fee(3, 3), fee(7, 3), fee(11.9, 4.99)], [3000, 5000, 7000, 10_000])
  })
  test('5 kg and above: free / ₹30 / ₹50 / ₹80 by distance', () => {
    assert.deepEqual([fee(1.5, 5), fee(3, 10), fee(7, 5), fee(10, 20)], [0, 3000, 5000, 8000])
  })
  test('free only within 2 km and only from 5 kg: both boundaries are inclusive', () => {
    assert.deepEqual([fee(2, 5), fee(2.01, 5), fee(2, 4.99), fee(0, 4.99)], [0, 3000, 3000, 3000])
    assert.deepEqual([heavyByWeight(5, rules), heavyByWeight(4.99, rules)], [true, false])
  })
  test('what the order is worth decides nothing: a ₹50,000 order under 5 kg pays the “under” column', () => {
    assert.deepEqual([fee(1.5, 3, 5_000_000), fee(3, 3, 5_000_000), fee(11.9, 3, 5_000_000)], [3000, 5000, 10_000])
    assert.deepEqual([fee(3, 10, 100), fee(1.5, 5, 100)], [3000, 0])
  })
  test('the free distance is a rule of its own, whatever the band’s charge says', () => {
    // Free within 3 km: a 5 kg order at 2.5 km pays nothing although its band charges ₹30.
    assert.equal(chargeFor(2.5, 0, { ...rules, freeWithinKm: 3 }, 5).fee, 0)
    // Free within 0 km: a heavy order pays its band's charge everywhere (a manager must then save band 1 above ₹0).
    assert.equal(chargeFor(1, 0, { ...rules, freeWithinKm: 0, bands: [{ uptoKm: 2, fee: 20, feeSmall: 30 }] }, 5).fee, 2000)
    // The check and the bag quote: what each column pays at this distance.
    const near = chargeFor(1.5, 0, rules), mid = chargeFor(3, 0, rules)
    assert.deepEqual([near.feeAtOrAbove, near.feeBelow, mid.feeAtOrAbove, mid.feeBelow], [0, 3000, 3000, 5000])
  })
  test('freeFromKg 0: no weight line, every order pays the “under” column and none is free', () => {
    const off = { ...rules, freeFromKg: 0 }
    assert.deepEqual([chargeFor(1.5, 0, off, 50).fee, chargeFor(3, 0, off, 50).fee, chargeFor(3, 0, off, 0).fee], [3000, 5000, 5000])
  })
  test('past 12 km the order is refused, whatever it weighs, or pays the last band when the rules say so', () => {
    const refuse = { ...rules, beyond: 'refuse' }
    assert.deepEqual([chargeFor(12.1, 0, refuse, 20).tooFar, chargeFor(12.1, 0, refuse, 3).tooFar, chargeFor(12.1, 0, refuse, 20).fee], [true, true, 0])
    const charge = (kg) => chargeFor(30, 0, { ...rules, beyond: 'charge' }, kg)
    assert.deepEqual([charge(3).tooFar, charge(3).fee, charge(6).fee], [false, 10_000, 8000])
  })
  test('past 12 km (the default): the last band plus Rs 20 a km under 5 kg, Rs 15 a km from 5 kg, a part km counted whole', () => {
    assert.deepEqual(rules.perKmBeyond, { fee: 15, feeSmall: 20 })
    const at = (km, kg) => chargeFor(km, 0, rules, kg)
    // 17 km is 5 km past: 100 + 5 x 20 = 200 under 5 kg; 80 + 5 x 15 = 155 from 5 kg.
    assert.deepEqual([at(17, 3).tooFar, at(17, 3).fee, at(17, 6).fee, at(17, 5).fee, at(17, 3).extraKm], [false, 20_000, 15_500, 15_500, 5])
    // 12 km exactly is still the last band; 12.1 and 12.4 are 1 km past; 13.0 is 1; 13.01 is 2.
    assert.deepEqual([at(12, 3).fee, at(12.1, 3).fee, at(12.4, 6).fee, at(13, 3).fee, at(13.01, 3).fee], [10_000, 12_000, 9500, 12_000, 14_000])
    // Both columns are reported for the shop's "add N kg" hint.
    assert.deepEqual([at(16.9, 3).feeAtOrAbove, at(16.9, 3).feeBelow], [15_500, 20_000])
    // A manager may change the amounts, or switch back to refusing.
    assert.equal(chargeFor(14, 0, { ...rules, perKmBeyond: { fee: 10, feeSmall: 30 } }, 3).fee, 16_000)
  })
  test('an order weighs its boxes × each box’s size', () => {
    assert.equal(weightKg([{ sku: 'ALP-3', qty: 2 }, { sku: 'ALP-5', qty: 1 }]), 11)
    assert.equal(weightKg([{ sku: 'NOPE', qty: 3 }]), 0)
  })
})

describe('what a manager may save', () => {
  const base = () => currentConfig().rules
  const ok = (deliveryFee) => rulesSchema.safeParse({ ...base(), deliveryFee: { ...DEFAULT_DELIVERY_FEE, ...deliveryFee } }).success

  test('distances in order, no unknown key', () => {
    assert.equal(ok({ bands: [{ uptoKm: 5, fee: 0, feeSmall: 30 }, { uptoKm: 2, fee: 30, feeSmall: 50 }] }), false)
    assert.equal(ok({ surge: 2 }), false)
    assert.equal(ok({}), true)
  })
  test('a sensible weight and free distance', () => {
    assert.deepEqual([ok({ freeFromKg: -1 }), ok({ freeFromKg: 1001 }), ok({ freeFromKg: '5' }), ok({ freeFromKg: null })], [false, false, false, false])
    assert.deepEqual([ok({ freeFromKg: 0 }), ok({ freeFromKg: 5 }), ok({ freeFromKg: 7.5 }), ok({ freeFromKg: 1000 })], [true, true, true, true])
    assert.deepEqual([ok({ freeWithinKm: -1 }), ok({ freeWithinKm: 201 }), ok({ freeWithinKm: 0 }), ok({ freeWithinKm: 2.5 })], [false, false, false, true])
    // 0 km (nothing free) is allowed once the first band charges too.
    assert.equal(ok({ freeWithinKm: 0, bands: [{ uptoKm: 2, fee: 20, feeSmall: 30 }] }), true)
  })
  test('nothing free past the free distance: a band reaching past it must charge both columns', () => {
    const bands = (b2) => [{ uptoKm: 2, fee: 0, feeSmall: 0 }, { uptoKm: 5, ...b2 }]
    assert.equal(ok({ bands: bands({ fee: 30, feeSmall: 50 }) }), true, 'free for everyone within 2 km is allowed')
    assert.equal(ok({ bands: bands({ fee: 0, feeSmall: 50 }) }), false)
    assert.equal(ok({ bands: bands({ fee: 30, feeSmall: 0 }) }), false)
    // A band straddling the free distance reaches past it.
    assert.equal(ok({ freeWithinKm: 1, bands: [{ uptoKm: 2, fee: 0, feeSmall: 30 }] }), false)
    // Charged past the last band: that band must charge, even inside the free distance.
    assert.equal(ok({ freeWithinKm: 2, beyond: 'charge', bands: [{ uptoKm: 2, fee: 0, feeSmall: 30 }] }), false)
    assert.equal(ok({ freeWithinKm: 2, beyond: 'refuse', bands: [{ uptoKm: 2, fee: 0, feeSmall: 30 }] }), true)
  })
  test('the save route refuses it too', async () => {
    const save = (deliveryFee) => api.put('/admin/v1/config', { rules: { ...base(), deliveryFee: { ...DEFAULT_DELIVERY_FEE, ...deliveryFee } }, confirmCode: 'manager123' }, { token: admin })
    const bad = await save({ bands: [{ uptoKm: 2, fee: 0, feeSmall: 30 }, { uptoKm: 5, fee: 0, feeSmall: 50 }] })
    assert.equal(bad.status, 400, JSON.stringify(bad.body))
    assert.match(JSON.stringify(bad.body), /free distance/)
    const good = await save({ enabled: true })
    assert.equal(good.status, 200, JSON.stringify(good.body))
    assert.deepEqual([getConfig().deliveryFee.freeFromKg, getConfig().deliveryFee.freeWithinKm], [5, 2])
  })
})

describe('older stored rules', () => {
  test('a version that still says freeAbove, freeFromKg 6 and no freeWithinKm loads; it decides nothing by value', async () => {
    const { freeWithinKm, ...rest } = DEFAULT_DELIVERY_FEE
    assert.equal(freeWithinKm, 2)
    const older = { ...rest, freeAbove: 1000, freeFromKg: 6, enabled: true, origins: [{ name: 'Main', ...CENTRE }] }
    const parsed = storedRulesSchema.parse({ ...DEFAULT_RULES, deliveryFee: older }).deliveryFee
    assert.deepEqual([parsed.freeAbove, parsed.freeFromKg, parsed.freeWithinKm], [1000, 6, 2])
    await query(`INSERT INTO app_config (version, value, changed_by) SELECT MAX(version) + 1, $1, 'older' FROM app_config`, [{ ...currentConfig().rules, deliveryFee: older }])
    await loadConfig()
    assert.equal(currentConfig().rules.deliveryFee.freeFromKg, 6)
    const policy = (await api.get('/v1/policy')).body.deliveryFee
    assert.deepEqual([policy.enabled, policy.freeFromKg, policy.freeWithinKm, policy.freeAbove], [true, 6, 2, 100_000])
  })
  test('a version from before freeFromKg loads with the new defaults', () => {
    const { freeFromKg, freeWithinKm, ...older } = DEFAULT_DELIVERY_FEE
    assert.deepEqual([freeFromKg, freeWithinKm], [5, 2])
    const parsed = storedRulesSchema.parse({ ...DEFAULT_RULES, deliveryFee: older }).deliveryFee
    assert.deepEqual([parsed.freeFromKg, parsed.freeWithinKm], [5, 2])
  })
  test('a stored band past 2 km with a 0 charge still loads (only a save is refused)', () => {
    const odd = { ...DEFAULT_DELIVERY_FEE, bands: [{ uptoKm: 12, fee: 0, feeSmall: 0 }] }
    assert.equal(storedRulesSchema.safeParse({ ...DEFAULT_RULES, deliveryFee: odd }).success, true)
  })
})

describe('the migration that moves live rules to the new table (072)', () => {
  const sql = async () => readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '072_delivery_fee_by_weight.sql'), 'utf8')
  const latest = async () => (await query('SELECT version, value, changed_by FROM app_config ORDER BY version DESC LIMIT 1')).rows[0]

  test('freeFromKg 6 becomes 5 with freeWithinKm 2, everything else kept; nothing when run again', async () => {
    const { rows: was } = await query('SELECT MAX(version)::int AS v FROM app_config')
    const { freeWithinKm, ...rest } = DEFAULT_DELIVERY_FEE
    void freeWithinKm
    const old = { ...DEFAULT_RULES, holdMinutes: 7, deliveryFee: { ...rest, enabled: true, freeAbove: 1500, freeFromKg: 6, unknownKm: 9 } }
    await query(`INSERT INTO app_config (version, value, changed_by) VALUES ($1, $2, 'manager@x')`, [was[0].v + 1, old])
    await tx(async (c) => c.query(await sql()))
    const now = await latest()
    assert.deepEqual([now.version, now.changed_by], [was[0].v + 2, 'system'])
    assert.deepEqual([now.value.deliveryFee.freeFromKg, now.value.deliveryFee.freeWithinKm], [5, 2])
    assert.deepEqual([now.value.holdMinutes, now.value.deliveryFee.enabled, now.value.deliveryFee.freeAbove, now.value.deliveryFee.unknownKm], [7, true, 1500, 9])
    assert.deepEqual(now.value.deliveryFee.bands, DEFAULT_DELIVERY_FEE.bands)
    assert.equal((await loadConfig()).version, was[0].v + 2)
    assert.deepEqual([getConfig().deliveryFee.freeFromKg, getConfig().deliveryFee.freeWithinKm], [5, 2])
    await tx(async (c) => c.query(await sql()))
    assert.equal((await latest()).version, was[0].v + 2)
  })
  test('a weight a manager chose, or rules without the key, are left alone', async () => {
    const { rows: was } = await query('SELECT MAX(version)::int AS v FROM app_config')
    await query(`INSERT INTO app_config (version, value, changed_by) VALUES ($1, $2, 'manager@x')`, [was[0].v + 1, { ...DEFAULT_RULES, deliveryFee: { ...DEFAULT_DELIVERY_FEE, freeFromKg: 8 } }])
    await tx(async (c) => c.query(await sql()))
    assert.equal((await latest()).version, was[0].v + 1)
    const { deliveryFee, ...noFee } = DEFAULT_RULES
    void deliveryFee
    await query(`INSERT INTO app_config (version, value, changed_by) VALUES ($1, $2, 'manager@x')`, [was[0].v + 2, noFee])
    await tx(async (c) => c.query(await sql()))
    assert.equal((await latest()).version, was[0].v + 2)
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
  test('a heavy order’s answers are exactly as before', async () => {
    const { accessToken: token } = await customerToken(api)
    const q = await quote(token, { location: north(3) }, { qty: 2 })
    assert.deepEqual([q.body.deliveryFee, q.body.total, 'delivery' in q.body], [0, 2 * ALP3, false])
  })
})

describe('on', () => {
  test('within 2 km a 5 kg order is delivered free; a 3 kg one pays ₹30, however much it is worth', async () => {
    await turnOn()
    const { accessToken: token } = await customerToken(api)
    const light = await quote(token, { location: north(1.5) }, { qty: 1 })
    assert.equal(light.status, 200, JSON.stringify(light.body))
    assert.deepEqual([light.body.deliveryFee, light.body.total, light.body.delivery.basis, light.body.delivery.distanceKm, light.body.delivery.weightKg], [3000, ALP3 + 3000, 'pin', 1.5, 3])
    const other = (await customerToken(api)).accessToken
    const five = await quote(other, { location: north(1.5) }, { sku: 'ALP-5' })
    assert.equal(five.status, 200, JSON.stringify(five.body))
    assert.deepEqual([five.body.deliveryFee, five.body.total, five.body.delivery.weightKg, five.body.delivery.freeWithinKm], [0, ALP5, 5, 2])
    const o = await confirm(other, five.body.quoteId)
    assert.equal(o.status, 201, JSON.stringify(o.body))
    assert.equal(o.body.total, ALP5)
  })

  test('past 2 km a heavy order pays the lower charge, a light one the higher, and the order carries it', async () => {
    await turnOn()
    const { accessToken: token } = await customerToken(api)
    const heavy = await quote(token, { location: north(3) }, { qty: 4 }) // 12 kg
    assert.deepEqual([heavy.body.deliveryFee, heavy.body.total, heavy.body.delivery.weightKg], [3000, 4 * ALP3 + 3000, 12])
    const o = await confirm(token, heavy.body.quoteId)
    assert.equal(o.status, 201, JSON.stringify(o.body))
    assert.equal(o.body.total, 4 * ALP3 + 3000)
    assert.equal((await api.post('/v1/dev/pay', { orderId: o.body.orderId, outcome: 'captured' })).status, 200)
    const mine = (await api.get(`/v1/orders/${o.body.orderId}`, { token })).body
    assert.deepEqual([mine.subtotal, mine.deliveryFee, mine.deliveryKm, mine.total], [4 * ALP3, 3000, 3, 4 * ALP3 + 3000])
    const staff = (await api.get(`/admin/v1/orders/${o.body.orderId}`, { token: admin })).body
    assert.deepEqual([staff.deliveryFee, staff.deliveryKm, staff.total], [3000, 3, 4 * ALP3 + 3000])
    const row = (await query('SELECT total, payment_amount, delivery_km FROM orders WHERE id = $1', [o.body.orderId])).rows[0]
    assert.deepEqual([row.total, row.payment_amount, Number(row.delivery_km)], [4 * ALP3 + 3000, 4 * ALP3 + 3000, 3])

    const other = (await customerToken(api)).accessToken
    const light = await quote(other, { location: north(3) })
    assert.deepEqual([light.body.deliveryFee, light.body.total], [5000, ALP3 + 5000])
  })

  test('the orders export carries the charge, so goods less discount plus delivery is the total', async () => {
    await turnOn()
    const { accessToken: token } = await customerToken(api)
    const q = await quote(token, { location: north(3) })
    const o = await confirm(token, q.body.quoteId)
    assert.equal(o.status, 201, JSON.stringify(o.body))
    const day = todayIST()
    const r = await fetch(`${srv.base}/admin/v1/exports/orders?from=${day}&to=${day}`, { headers: { Authorization: `Bearer ${admin}` } })
    const [head, ...rows] = (await r.text()).trim().split('\r\n')
    const cols = head.split(',').map((h) => h.replace(/"/g, ''))
    assert.equal(rows.length, 1, rows.join('\n'))
    const row = rows[0].split(',').map((v) => v.replace(/"/g, ''))
    const at = (k) => row[cols.indexOf(k)]
    assert.ok(cols.includes('delivery_inr'), head)
    assert.deepEqual([at('goods_inr'), at('discount_inr'), at('delivery_inr'), at('total_inr')], ['1899.00', '0.00', '50.00', '1949.00'])
  })

  test('20 kg at 10 km pays ₹80', async () => {
    await turnOn()
    const { accessToken: token } = await customerToken(api)
    const q = await quote(token, { location: north(10) }, { sku: 'ALP-5', qty: 4 })
    assert.deepEqual([q.status, q.body.deliveryFee, q.body.delivery.weightKg, q.body.delivery.distanceKm], [200, 8000, 20, 10])
  })

  test('the charge is the one quoted, even if the rules change before the customer pays', async () => {
    await turnOn()
    const { accessToken: token } = await customerToken(api)
    const q = await quote(token, { location: north(3) })
    await turnOn({ bands: [{ uptoKm: 12, fee: 500, feeSmall: 500 }] })
    const o = await confirm(token, q.body.quoteId)
    assert.equal(o.body.total, ALP3 + 5000)
  })

  // The rule changed on purpose (audit, 16 Nov): the pincode's centre is the floor. A pin can raise the
  // distance, but lower it by PIN_TOLERANCE_KM at most; it used to be believed anywhere within 8 km of the
  // centre, so a pin dropped on the warehouse bought free delivery to a pincode 6 km away.
  test('without a pin the pincode’s centre is used; a pin lowers the distance by the tolerance at most', async () => {
    assert.equal(PIN_TOLERANCE_KM, 1.5)
    await turnOn({ origins: [{ name: 'Main', ...north(6) }] })
    const { accessToken: token } = await customerToken(api)
    const q = await quote(token)
    assert.deepEqual([q.body.delivery.basis, q.body.delivery.distanceKm, q.body.deliveryFee], ['pincode', 6, 7000])
    // A pin dropped on the warehouse itself counts as the centre less 1.5 km, not 0 km.
    const near = await api.post('/v1/checkout/quote', { pincode: '560034', location: north(6) }, { token })
    assert.deepEqual([near.body.delivery.basis, near.body.delivery.distanceKm, near.body.deliveryFee], ['pincode', 4.5, 5000])
    assert.equal('lat' in near.body.delivery, false)
    // A pin a little closer than the centre (within the tolerance) is believed.
    const bit = await api.post('/v1/checkout/quote', { pincode: '560034', location: north(1.2) }, { token })
    assert.deepEqual([bit.body.delivery.basis, bit.body.delivery.distanceKm, bit.body.deliveryFee], ['pin', 4.8, 5000])
    // A pin further out raises it: 13 km from the warehouse is past the last band (12 km).
    const far = await api.post('/v1/checkout/quote', { pincode: '560034', location: north(-7) }, { token })
    assert.deepEqual([far.status, far.body.error?.code, far.body.error?.distanceKm], [422, 'TOO_FAR', 13])
  })

  test('a pin can’t bring an address inside the delivery area', async () => {
    await turnOn({ origins: [{ name: 'Main', ...north(15) }] })
    const { accessToken: token } = await customerToken(api)
    // The pin on the warehouse's doorstep still counts as 15 - 1.5 = 13.5 km: past the last band.
    const onWarehouse = await quote(token, { location: north(15) })
    assert.deepEqual([onWarehouse.status, onWarehouse.body.error?.code, onWarehouse.body.error?.distanceKm], [422, 'TOO_FAR', 13.5])
    // A pin 2 km closer than the centre (more than the tolerance) counts as 13.5 km too.
    const edge = await api.post('/v1/checkout/quote', { pincode: '560034', location: north(2) }, { token })
    assert.deepEqual([edge.status, edge.body.error?.distanceKm], [422, 13.5])
  })

  test('a pincode with no centre: its pin is not believed on its own, the assumed distance is charged', async () => {
    await turnOn({ unknownKm: 7 })
    await query(`UPDATE pincodes SET lat = NULL, lng = NULL WHERE pincode = '560034'`)
    const { accessToken: token } = await customerToken(api)
    // A pin right on the warehouse would be 0 km; without a centre to check it against it is ignored.
    const q = await quote(token, { location: CENTRE })
    assert.equal(q.status, 200, JSON.stringify(q.body))
    assert.deepEqual([q.body.delivery.basis, q.body.delivery.distanceKm, q.body.deliveryFee, 'lat' in q.body.delivery], ['unknown', 7, 7000, false])
  })

  test('past the last band the order is refused with the distance, whatever it weighs, or charged the last band', async () => {
    await turnOn({ origins: [{ name: 'Main', ...north(15) }] })
    const { accessToken: token } = await customerToken(api)
    const q = await quote(token)
    assert.equal(q.status, 422, JSON.stringify(q.body))
    assert.equal(q.body.error.code, 'TOO_FAR')
    assert.match(q.body.error.message, /about 15 km .* up to 12 km/)
    const heavy = await quote((await customerToken(api)).accessToken, {}, { qty: 3 })
    assert.deepEqual([heavy.status, heavy.body.error?.code], [422, 'TOO_FAR'])
    await turnOn({ origins: [{ name: 'Main', ...north(15) }], beyond: 'charge' })
    const charged = await api.post('/v1/checkout/quote', { pincode: '560034' }, { token })
    assert.deepEqual([charged.status, charged.body.deliveryFee], [200, 10_000])
  })

  test('with no position for the warehouse or the pincode, the assumed distance is charged and nobody is refused', async () => {
    await turnOn({ origins: [], unknownKm: 30 })
    await query('UPDATE warehouses SET lat = NULL, lng = NULL')
    const { accessToken: token } = await customerToken(api)
    const q = await quote(token)
    assert.deepEqual([q.status, q.body.delivery.basis, q.body.deliveryFee], [200, 'unknown', 10_000])
  })

  test('the nearest of several warehouses counts', async () => {
    await turnOn({ origins: [{ name: 'Far', ...north(10) }, { name: 'Near', ...north(-1.5) }] })
    const { accessToken: token } = await customerToken(api)
    const q = await quote(token, {}, { sku: 'ALP-5' })
    assert.deepEqual([q.body.delivery.distanceKm, q.body.deliveryFee], [1.5, 0])
  })

  test('the shop can ask before checkout, and quote the table on its pages', async () => {
    await turnOn()
    const at = north(4)
    const check = (await api.get(`/v1/delivery/check?pincode=560034&lat=${at.lat}&lng=${at.lng}`)).body
    assert.deepEqual(
      [check.delivery.distanceKm, check.delivery.basis, check.delivery.freeFromKg, check.delivery.freeWithinKm, check.delivery.feeAtOrAbove, check.delivery.feeBelow, check.delivery.tooFar],
      [4, 'pin', 5, 2, 3000, 5000, false],
    )
    // Kept for the current shop until its wording changes.
    assert.equal(check.delivery.freeAbove, 100_000)
    const near = north(1)
    const close = (await api.get(`/v1/delivery/check?pincode=560034&lat=${near.lat}&lng=${near.lng}`)).body
    assert.deepEqual([close.delivery.feeAtOrAbove, close.delivery.feeBelow], [0, 3000])
    const policy = (await api.get('/v1/policy')).body.deliveryFee
    assert.deepEqual(
      [policy.enabled, policy.freeFromKg, policy.freeWithinKm, policy.freeAbove, policy.bands[0], policy.bands[3], policy.bands.length],
      [true, 5, 2, 100_000, { uptoKm: 2, fee: 0, feeSmall: 3000 }, { uptoKm: 12, fee: 8000, feeSmall: 10_000 }, 4],
    )
  })

  test('with freeFromKg 0 every order pays the “under” column', async () => {
    await turnOn({ freeFromKg: 0 })
    assert.equal((await api.get('/v1/policy')).body.deliveryFee.freeFromKg, 0)
    const { accessToken: token } = await customerToken(api)
    const q = await quote(token, { location: north(1) }, { sku: 'ALP-5', qty: 2 })
    assert.deepEqual([q.body.deliveryFee, q.body.delivery.weightKg, q.body.delivery.freeFromKg], [3000, 10, 0])
  })
})
