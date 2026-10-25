// Bulk Deals: listings, tier pricing, photos, publishing, and bulk lines going
// through the same cart, checkout, stock and order lifecycle as regular boxes.
// Razorpay is the dev gateway (no network); photos are stored in the row.
import { adminToken, checkout, client, closeAll, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import sharp from 'sharp'
import { listingProblems, priceLine, qtyProblem, tierFor } from '../src/bulk.js'
import { addDays, now, setNow, todayIST } from '../src/clock.js'
import { query, tx } from '../src/db.js'
import { newId } from '../src/ids.js'
import { sweepExpiredHolds } from '../src/orders.js'

let srv
let api
let manager
let jpeg
before(async () => {
  srv = await startServer()
  api = client(srv.base)
  jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#f4a300' } }).jpeg().toBuffer()
})
after(async () => {
  await srv.close()
  await closeAll()
})
beforeEach(async () => {
  await resetDb()
  manager = await adminToken(api)
})

const TIERS = [
  { minQty: 10, unitPrice: 159_900 },
  { minQty: 25, unitPrice: 149_900 },
  { minQty: 50, unitPrice: 139_900 },
]
const DRAFT = {
  sku: 'ALP-3', title: 'Alphonso for offices', description: 'Hand-picked Ratnagiri Alphonso in 3 kg boxes, for offices and events.',
  origin: 'Ratnagiri, Maharashtra', stages: ['RIPE', 'SEMI_RIPE'], minQty: 10, qtyStep: 1, maxQty: null, tiers: TIERS,
}
const ADDRESS = '12, 4th Cross, Koramangala, Bengaluru'
const MIN = 60_000

const create = (body = DRAFT, token = manager) => api.post('/admin/v1/bulk-listings', body, { token })
const upload = (id, bytes = jpeg, type = 'image/jpeg', token = manager) =>
  api.raw('POST', `/admin/v1/bulk-listings/${id}/photos`, { raw: bytes, token, headers: { 'Content-Type': type } })
async function published(body = DRAFT) {
  const c = await create(body)
  assert.equal(c.status, 201, JSON.stringify(c.body))
  assert.equal((await upload(c.body.id)).status, 201)
  const p = await api.post(`/admin/v1/bulk-listings/${c.body.id}/publish`, {}, { token: manager })
  assert.equal(p.status, 200, JSON.stringify(p.body))
  return p.body
}
const stock = (qty = 60) => makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': qty } })
const addBulk = (token, listingId, qty, stage = 'RIPE', extra = {}) => api.post('/v1/cart/bulk', { listingId, stage, qty, ...extra }, { token })
const quote = (token, body = {}) => api.post('/v1/checkout/quote', { pincode: '560034', ...body }, { token })
const confirm = (token, quoteId, key = newId('idem')) => api.post('/v1/checkout/confirm', { quoteId, address: ADDRESS }, { token, headers: { 'Idempotency-Key': key } })
const shopIds = async () => (await api.get('/v1/bulk-deals')).body.items.map((l) => l.id)
const heldFor = async (orderId) =>
  (await query(`SELECT COALESCE(SUM(quantity), 0)::int AS n FROM order_stock WHERE order_id = $1 AND state <> 'released'`, [orderId])).rows[0].n

describe('the price engine', () => {
  const l = { id: 'bulk_x', version: 3, title: 'T', minQty: 10, qtyStep: 1, maxQty: null, tiers: TIERS }

  test('every tier boundary: just below, at and just above', () => {
    assert.match(qtyProblem(l, 9), /minimum order is 10/)
    const at = (q) => priceLine(l, q).unitPrice
    assert.deepEqual([10, 11, 24].map(at), [159_900, 159_900, 159_900])
    assert.deepEqual([25, 26, 39].map(at), [149_900, 149_900, 149_900])
    assert.equal(at(40), 149_900)
    // 50+ is above the unpaid-box limit (40) for an order, but the tier itself starts at 50.
    assert.deepEqual([49, 50, 51].map((q) => tierFor(l, q).unitPrice), [149_900, 139_900, 139_900])
    assert.equal(tierFor(l, 9), null)
    assert.equal(priceLine(l, 25).linePrice, 25 * 149_900)
    assert.deepEqual(tierFor(l, 30), { index: 1, minQty: 25, maxQty: 49, unitPrice: 149_900 })
    assert.deepEqual(priceLine(l, 30).pricing, { kind: 'bulk', listingId: 'bulk_x', listingVersion: 3, title: 'T', tier: { minQty: 25, maxQty: 49, unitPrice: 149_900 } })
  })

  test('steps and the maximum are enforced', () => {
    const stepped = { ...l, minQty: 10, qtyStep: 5, maxQty: 60, tiers: [{ minQty: 10, unitPrice: 100 }, { minQty: 30, unitPrice: 90 }] }
    assert.equal(qtyProblem(stepped, 15), null)
    assert.match(qtyProblem(stepped, 12), /steps of 5/)
    assert.match(qtyProblem(stepped, 65), /most you can order at once is 40/) // the unpaid-box limit (maxHeldBoxes 40) is lower than 60
    assert.throws(() => priceLine(stepped, 12), { code: 'BULK_QTY_INVALID' })
  })

  test('invalid, overlapping and ambiguous tiers are refused', () => {
    const base = { minQty: 10, qtyStep: 1, maxQty: null, stages: ['RIPE'] }
    assert.match(listingProblems({ ...base, tiers: [{ minQty: 5, unitPrice: 100 }] })[0], /first price tier must start at the minimum/)
    assert.match(listingProblems({ ...base, tiers: [{ minQty: 10, unitPrice: 100 }, { minQty: 10, unitPrice: 90 }] }).join(), /higher quantity each time/)
    assert.match(listingProblems({ ...base, tiers: [{ minQty: 10, unitPrice: 100 }, { minQty: 30, unitPrice: 20 }, { minQty: 20, unitPrice: 10 }] }).join(), /higher quantity/)
    assert.match(listingProblems({ ...base, tiers: [{ minQty: 10, unitPrice: 100 }, { minQty: 20, unitPrice: 100 }] }).join(), /must cost less per box/)
    assert.match(listingProblems({ ...base, qtyStep: 5, tiers: [{ minQty: 10, unitPrice: 100 }, { minQty: 22, unitPrice: 90 }] }).join(), /steps of 5/)
    assert.match(listingProblems({ ...base, maxQty: 20, tiers: [{ minQty: 10, unitPrice: 100 }, { minQty: 30, unitPrice: 90 }] }).join(), /above the most boxes/)
    assert.match(listingProblems({ ...base, stages: ['RIPE', 'RIPE'], tiers: [{ minQty: 10, unitPrice: 100 }] }).join(), /listed twice/)
    assert.deepEqual(listingProblems({ ...base, tiers: TIERS }), [])
  })
})

describe('managing listings', () => {
  test('create, edit, publish, unpublish and archive, with history', async () => {
    const c = await create()
    assert.equal(c.status, 201, JSON.stringify(c.body))
    assert.equal(c.body.status, 'DRAFT')
    assert.ok(c.body.publishProblems.includes('Add at least one photo'))
    // Publishing needs a photo first.
    const early = await api.post(`/admin/v1/bulk-listings/${c.body.id}/publish`, {}, { token: manager })
    assert.equal(early.status, 400)
    assert.equal(early.body.error.code, 'BULK_NOT_READY')
    assert.equal((await upload(c.body.id)).status, 201)
    const pub = await api.post(`/admin/v1/bulk-listings/${c.body.id}/publish`, {}, { token: manager })
    assert.equal(pub.status, 200, JSON.stringify(pub.body))
    assert.equal(pub.body.status, 'PUBLISHED')
    assert.equal(pub.body.onSale, true)
    const edit = await api.patch(`/admin/v1/bulk-listings/${c.body.id}`, { tiers: [{ minQty: 10, unitPrice: 155_000 }, { minQty: 30, unitPrice: 145_000 }] }, { token: manager })
    assert.equal(edit.status, 200, JSON.stringify(edit.body))
    assert.ok(edit.body.version > pub.body.version)
    // A live listing can't be edited into something incomplete.
    const bad = await api.patch(`/admin/v1/bulk-listings/${c.body.id}`, { description: 'short' }, { token: manager })
    assert.equal(bad.status, 400)
    assert.match(bad.body.error.message, /live, so it must stay complete/)
    assert.equal((await api.post(`/admin/v1/bulk-listings/${c.body.id}/unpublish`, {}, { token: manager })).body.status, 'UNPUBLISHED')
    assert.equal((await api.post(`/admin/v1/bulk-listings/${c.body.id}/archive`, {}, { token: manager })).body.status, 'ARCHIVED')
    const again = await api.post(`/admin/v1/bulk-listings/${c.body.id}/publish`, {}, { token: manager })
    assert.equal(again.status, 409)
    assert.equal((await api.patch(`/admin/v1/bulk-listings/${c.body.id}`, { title: 'New name' }, { token: manager })).status, 409)
    const history = (await api.get(`/admin/v1/bulk-listings/${c.body.id}/history`, { token: manager })).body
    assert.deepEqual(history.map((h) => h.action).reverse(), ['CREATED', 'PHOTO_ADDED', 'PUBLISHED', 'PRICING_CHANGED', 'UNPUBLISHED', 'ARCHIVED'])
    const priced = history.find((h) => h.action === 'PRICING_CHANGED')
    assert.equal(priced.by, 'manager@mandimangoes.test')
    assert.deepEqual(priced.changes.tiers.from, TIERS)
    // Archived listings drop out of the default list but stay findable.
    assert.equal((await api.get('/admin/v1/bulk-listings', { token: manager })).body.items.length, 0)
    assert.equal((await api.get('/admin/v1/bulk-listings?status=ARCHIVED', { token: manager })).body.items.length, 1)
  })

  test('bad input is refused with a reason', async () => {
    const off = await create({ ...DRAFT, tiers: [{ minQty: 5, unitPrice: 100 }] })
    assert.equal(off.status, 400)
    assert.equal(off.body.error.code, 'BULK_INVALID')
    assert.equal((await create({ ...DRAFT, sku: 'NOPE' })).status, 400)
    assert.equal((await create({ ...DRAFT, tiers: [{ minQty: 10, unitPrice: 0 }] })).status, 400)
    assert.equal((await create({ ...DRAFT, tiers: [{ minQty: 10, unitPrice: 99.5 }] })).status, 400, 'paise are whole numbers')
    assert.equal((await create({ ...DRAFT, stages: [] })).status, 400)
    assert.equal((await create({ ...DRAFT, status: 'PUBLISHED' })).status, 400, 'a listing is created as a draft')
    assert.equal((await create({ ...DRAFT, startsAt: '2026-11-02T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' })).status, 400)
  })

  test('the minimum must fit the unpaid-box limit before publishing', async () => {
    const big = await create({ ...DRAFT, minQty: 60, tiers: [{ minQty: 60, unitPrice: 139_900 }] })
    assert.equal(big.status, 201)
    assert.ok(big.body.publishProblems.some((p) => /most boxes one customer can hold unpaid \(40/.test(p)))
  })

  test('only managers manage listings; the role gate and the route both refuse', async () => {
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    const packer = await adminToken(api, 'packer@mandimangoes.test', 'packer123')
    for (const token of [ops, packer]) {
      assert.equal((await create(DRAFT, token)).status, 403)
      assert.equal((await api.get('/admin/v1/bulk-listings', { token })).status, 403)
    }
    const cust = (await customerToken(api)).accessToken
    assert.equal((await create(DRAFT, cust)).status, 401)
    assert.equal((await api.raw('POST', '/admin/v1/bulk-listings', { body: DRAFT })).status, 401)
  })
})

describe('photos', () => {
  test('upload, reorder, remove, and what the shop can see', async () => {
    const c = (await create()).body
    const a = await upload(c.id)
    const b = await upload(c.id, await sharp({ create: { width: 30, height: 30, channels: 3, background: '#00ff00' } }).png().toBuffer(), 'image/png')
    assert.equal(b.status, 201)
    assert.equal(b.body.photos.length, 2)
    assert.equal(b.body.photos[0].primary, true)
    const [first, second] = b.body.photos.map((p) => p.id)
    // A draft's photos are not public.
    assert.equal((await api.get(`/v1/bulk-deals/${c.id}/photos/${first}`)).status, 404)
    assert.equal((await api.get(`/admin/v1/bulk-listings/${c.id}/photos/${first}`, { token: manager })).status, 200)
    const order = await api.put(`/admin/v1/bulk-listings/${c.id}/photos/order`, { ids: [second, first] }, { token: manager })
    assert.equal(order.status, 200)
    assert.equal(order.body.photos[0].id, second)
    assert.equal((await api.put(`/admin/v1/bulk-listings/${c.id}/photos/order`, { ids: [second] }, { token: manager })).status, 400, 'every photo once')
    await api.post(`/admin/v1/bulk-listings/${c.id}/publish`, {}, { token: manager })
    const pub = await api.get(`/v1/bulk-deals/${c.id}/photos/${second}`)
    assert.equal(pub.status, 200)
    assert.equal(pub.headers.get('content-type'), 'image/jpeg', 're-encoded as JPEG')
    assert.match(pub.headers.get('cache-control'), /immutable/)
    // A live listing keeps at least one photo.
    assert.equal((await api.del(`/admin/v1/bulk-listings/${c.id}/photos/${first}`, { token: manager })).status, 200)
    const last = await api.del(`/admin/v1/bulk-listings/${c.id}/photos/${second}`, { token: manager })
    assert.equal(last.status, 409)
    assert.equal(last.body.error.code, 'BULK_PHOTO_REQUIRED')
    assert.ok(a.body.photos[0].url.startsWith('/admin/v1/'))
  })

  test('files that are not images, or too many, are refused', async () => {
    const c = (await create()).body
    const fake = await upload(c.id, Buffer.from('<?php echo 1; ?> not really a jpeg'), 'image/jpeg')
    assert.equal(fake.status, 400)
    const svg = await upload(c.id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')
    assert.equal(svg.status, 400, 'only JPEG, PNG and WebP are read')
    for (let i = 0; i < 8; i++) assert.equal((await upload(c.id)).status, 201)
    const ninth = await upload(c.id)
    assert.equal(ninth.status, 409)
    assert.equal(ninth.body.error.code, 'BULK_PHOTO_LIMIT')
  })
})

describe('the shop catalogue', () => {
  test('only published listings inside their sale window are shown', async () => {
    const live = await published()
    const draft = (await create({ ...DRAFT, title: 'Draft deal' })).body
    const later = await published({ ...DRAFT, title: 'Starts later', startsAt: new Date(now().getTime() + 86_400_000).toISOString() })
    const ended = await published({ ...DRAFT, title: 'Ends soon', endsAt: new Date(now().getTime() + 60 * MIN).toISOString() })
    assert.deepEqual((await shopIds()).sort(), [live.id, ended.id].sort())
    setNow(new Date(now().getTime() + 2 * 60 * MIN).toISOString())
    assert.deepEqual(await shopIds(), [live.id])
    assert.equal((await api.get(`/v1/bulk-deals/${draft.id}`)).status, 404)
    assert.equal((await api.get(`/v1/bulk-deals/${later.id}`)).status, 404)
    const one = (await api.get(`/v1/bulk-deals/${live.id}`)).body
    assert.equal(one.retailPrice, 189_900)
    assert.deepEqual(one.tiers.map((t) => [t.minQty, t.maxQty, t.unitPrice, t.savingPerBox]), [
      [10, 24, 159_900, 30_000], [25, 49, 149_900, 40_000], [50, null, 139_900, 50_000],
    ])
    assert.equal(one.maxQty, 40, 'capped by the unpaid-box limit')
  })

  test('no saving is claimed when a tier is not below the regular price', async () => {
    const l = await published({ ...DRAFT, tiers: [{ minQty: 10, unitPrice: 199_900 }, { minQty: 25, unitPrice: 189_900 }] })
    const one = (await api.get(`/v1/bulk-deals/${l.id}`)).body
    assert.deepEqual(one.tiers.map((t) => t.savingPerBox), [null, null])
  })

  test('stock per delivery date and ripeness, with a pincode', async () => {
    await stock(30)
    const l = await published()
    const one = (await api.get(`/v1/bulk-deals/${l.id}?pincode=560034`)).body
    assert.equal(one.serviceable, true)
    assert.ok(one.availability.length > 0)
    const day = one.availability[0]
    const ripe = day.stages.find((s) => s.stage === 'RIPE')
    assert.equal(ripe.available, 30)
    assert.equal(ripe.enough, true)
    assert.equal((await api.get(`/v1/bulk-deals/${l.id}?pincode=110001`)).body.serviceable, false)
    assert.equal((await api.get(`/v1/bulk-deals/${l.id}/price?qty=25`)).body.total, 25 * 149_900)
    assert.equal((await api.get(`/v1/bulk-deals/${l.id}/price?qty=9`)).status, 400)
  })
})

describe('bulk lines through the cart, checkout and orders', () => {
  test('quantities must fit the minimum, steps and maximum; prices from the browser are refused', async () => {
    const l = await published({ ...DRAFT, qtyStep: 5, tiers: [{ minQty: 10, unitPrice: 159_900 }, { minQty: 25, unitPrice: 149_900 }] })
    const t = (await customerToken(api)).accessToken
    assert.equal((await addBulk(t, l.id, 9)).body.error.code, 'BULK_QTY_INVALID')
    assert.equal((await addBulk(t, l.id, 12)).body.error.code, 'BULK_QTY_INVALID')
    assert.equal((await addBulk(t, l.id, 45)).body.error.code, 'BULK_QTY_INVALID', 'above 40, the unpaid-box limit')
    assert.equal((await addBulk(t, l.id, 10, 'RAW')).body.error.code, 'BULK_STAGE_INVALID')
    const tamper = await addBulk(t, l.id, 25, 'RIPE', { unitPrice: 1 })
    assert.equal(tamper.status, 400, 'a price field is not accepted')
    assert.equal((await addBulk(t, l.id, 25)).status, 204)
    const cart = (await api.get('/v1/cart', { token: t })).body
    assert.equal(cart.bulkLines[0].unitPrice, 149_900)
    assert.equal(cart.subtotal, 25 * 149_900)
  })

  test('the server prices the quote and the order keeps a snapshot that later edits never change', async () => {
    await stock(60)
    const l = await published()
    const cust = await customerToken(api)
    const t = cust.accessToken
    assert.equal((await addBulk(t, l.id, 25)).status, 204)
    const q = await quote(t)
    assert.equal(q.status, 200, JSON.stringify(q.body))
    assert.equal(q.body.total, 25 * 149_900)
    assert.equal(q.body.lines[0].listingId, l.id)
    const c = await confirm(t, q.body.quoteId)
    assert.equal(c.status, 201, JSON.stringify(c.body))
    assert.equal(c.body.total, 25 * 149_900)
    assert.equal(await heldFor(c.body.orderId), 25, 'the same stock holds as a regular order')
    assert.equal((await api.get('/v1/cart', { token: t })).body.bulkLines.length, 0, 'the cart is emptied')
    // The manager changes the price and the text afterwards.
    await api.patch(`/admin/v1/bulk-listings/${l.id}`, { title: 'Renamed deal', tiers: [{ minQty: 10, unitPrice: 120_000 }] }, { token: manager })
    const mine = (await api.get(`/v1/orders/${c.body.orderId}`, { token: t })).body
    assert.equal(mine.total, 25 * 149_900)
    assert.deepEqual(mine.items[0].bulk, { listingId: l.id, title: 'Alphonso for offices', tier: { minQty: 25, maxQty: 49, unitPrice: 149_900 } })
    assert.equal(mine.items[0].unitPrice, 149_900)
    const staff = (await api.get(`/admin/v1/orders/${c.body.orderId}`, { token: manager })).body
    assert.equal(staff.items[0].bulk.title, 'Alphonso for offices')
    assert.equal(staff.items[0].bulk.listingVersion, l.version)
  })

  test('a price change after the quote is caught at checkout, and a fresh quote shows the new total', async () => {
    await stock(60)
    const l = await published()
    const t = (await customerToken(api)).accessToken
    await addBulk(t, l.id, 25)
    const q = await quote(t)
    await api.patch(`/admin/v1/bulk-listings/${l.id}`, { tiers: [{ minQty: 10, unitPrice: 159_900 }, { minQty: 25, unitPrice: 154_900 }] }, { token: manager })
    const stale = await confirm(t, q.body.quoteId)
    assert.equal(stale.status, 409)
    assert.equal(stale.body.error.code, 'PRICE_CHANGED')
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM orders')).rows[0].n, 0, 'nothing was ordered')
    const fresh = await quote(t)
    assert.equal(fresh.body.total, 25 * 154_900)
    assert.equal((await confirm(t, fresh.body.quoteId)).status, 201)
  })

  test('an edit that leaves the price alone does not block the checkout', async () => {
    await stock(60)
    const l = await published()
    const t = (await customerToken(api)).accessToken
    await addBulk(t, l.id, 25)
    const q = await quote(t)
    await api.patch(`/admin/v1/bulk-listings/${l.id}`, { description: 'Hand-picked Ratnagiri Alphonso, packed for offices, events and hotels.' }, { token: manager })
    const c = await confirm(t, q.body.quoteId)
    assert.equal(c.status, 201, JSON.stringify(c.body))
    const item = (await query('SELECT pricing FROM order_items WHERE order_id = $1', [c.body.orderId])).rows[0]
    assert.equal(item.pricing.listingVersion, l.version + 1, 'the snapshot is the version sold')
  })

  test('a listing taken off sale, or an unsellable product, stops the purchase', async () => {
    await stock(60)
    const l = await published()
    const t = (await customerToken(api)).accessToken
    await addBulk(t, l.id, 25)
    const q = await quote(t)
    await api.post(`/admin/v1/bulk-listings/${l.id}/unpublish`, {}, { token: manager })
    assert.equal((await confirm(t, q.body.quoteId)).body.error.code, 'BULK_UNAVAILABLE')
    assert.equal((await api.get('/v1/cart', { token: t })).body.bulkLines.length, 0, 'unpublishing clears it from carts')
    // Publish again, then take the product itself off sale.
    await api.post(`/admin/v1/bulk-listings/${l.id}/publish`, {}, { token: manager })
    await addBulk(t, l.id, 25)
    await api.del('/admin/v1/products/ALP-3', { token: manager })
    const cart = (await api.get('/v1/cart', { token: t })).body
    assert.match(cart.bulkLines[0].problem, /no longer on sale/)
    assert.equal((await quote(t)).body.error.code, 'BULK_UNAVAILABLE')
    assert.ok(!(await shopIds()).includes(l.id))
  })

  test('not enough stock, a closed day and a full cart conflict', async () => {
    await stock(20)
    const l = await published()
    const t = (await customerToken(api)).accessToken
    await addBulk(t, l.id, 25)
    assert.equal((await quote(t)).body.error.code, 'STOCK_INSUFFICIENT')
    await addBulk(t, l.id, 15)
    // The same box and ripeness as a regular line too.
    await api.post('/v1/cart/items', { sku: 'ALP-3', stage: 'RIPE', qty: 1 }, { token: t })
    assert.equal((await quote(t)).body.error.code, 'CART_CONFLICT')
    await api.del('/v1/cart/items/ALP-3', { token: t })
    // Promo codes are for regular boxes.
    assert.equal((await quote(t, { promoCode: 'ANY' })).body.error.code, 'PROMO_NOT_FOR_BULK')
    // A closed delivery day can't be chosen.
    const day = (await quote(t)).body.deliveryDate
    await api.put(`/admin/v1/calendar/${day}`, { isOpen: false }, { token: manager })
    const closed = await quote(t, { deliveryDate: day })
    assert.equal(closed.status, 400)
    const shown = (await api.get(`/v1/bulk-deals/${l.id}?pincode=560034`)).body.availability.map((d) => d.date)
    assert.ok(!shown.includes(day), 'the closed day is not offered')
  })

  test('concurrent bulk and regular checkouts never sell the same boxes twice', async () => {
    await stock(30)
    const l = await published()
    const bulkBuyer = (await customerToken(api)).accessToken
    const retailBuyers = await Promise.all([1, 2].map(() => customerToken(api).then((x) => x.accessToken)))
    await addBulk(bulkBuyer, l.id, 25)
    const bq = await quote(bulkBuyer)
    for (const r of retailBuyers) await api.post('/v1/cart/items', { sku: 'ALP-3', stage: 'RIPE', qty: 4 }, { token: r })
    const rq = await Promise.all(retailBuyers.map((r) => quote(r)))
    const results = await Promise.all([confirm(bulkBuyer, bq.body.quoteId), ...retailBuyers.map((r, i) => confirm(r, rq[i].body.quoteId))])
    const ok = results.filter((r) => r.status === 201)
    for (const r of results.filter((x) => x.status !== 201)) assert.equal(r.body.error.code, 'STOCK_INSUFFICIENT')
    const { rows } = await query(`SELECT COALESCE(SUM(quantity), 0)::int AS n FROM order_stock WHERE state <> 'released'`)
    assert.ok(rows[0].n <= 30, `held ${rows[0].n} of 30`)
    assert.equal(rows[0].n, ok.reduce((n, r) => n + (r.body.total === 25 * 149_900 ? 25 : 4), 0))
    const line = (await query(`SELECT on_hand, committed, held FROM batch_lines WHERE sku = 'ALP-3'`).catch(() => ({ rows: [] }))).rows[0]
    if (line?.held != null) assert.ok(line.held + (line.committed ?? 0) <= line.on_hand)
  })

  test('a hold that runs out, or a cancel, gives the boxes back', async () => {
    await stock(30)
    const l = await published()
    const t = (await customerToken(api)).accessToken
    await addBulk(t, l.id, 25)
    const c = await confirm(t, (await quote(t)).body.quoteId)
    assert.equal(c.status, 201)
    assert.equal(await heldFor(c.body.orderId), 25)
    setNow(new Date(now().getTime() + 30 * MIN).toISOString())
    await tx((cl) => sweepExpiredHolds(cl))
    assert.equal((await query('SELECT status FROM orders WHERE id = $1', [c.body.orderId])).rows[0].status, 'CANCELLED')
    assert.equal(await heldFor(c.body.orderId), 0)
    // The boxes are free again for the next customer, who cancels before paying.
    const t2 = (await customerToken(api)).accessToken
    await addBulk(t2, l.id, 25)
    const c2 = await confirm(t2, (await quote(t2)).body.quoteId)
    assert.equal(c2.status, 201, JSON.stringify(c2.body))
    assert.equal((await api.post(`/v1/orders/${c2.body.orderId}/cancel`, {}, { token: t2 })).status, 204)
    assert.equal(await heldFor(c2.body.orderId), 0)
  })

  test('a regular checkout still works beside bulk deals', async () => {
    await stock(30)
    await published()
    const t = (await customerToken(api)).accessToken
    const r = await checkout(api, t, [{ sku: 'ALP-3', stage: 'RIPE', qty: 2 }])
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(r.body.total, 2 * 189_900)
    const item = (await query('SELECT listing_id, pricing FROM order_items WHERE order_id = $1', [r.body.orderId])).rows[0]
    assert.deepEqual(item, { listing_id: null, pricing: null })
  })

  test('a product used by a listing is hidden, not deleted', async () => {
    await create()
    const del = await api.del('/admin/v1/products/ALP-3', { token: manager })
    assert.equal(del.body.outcome, 'hidden')
  })

  test('delivery dates come from the open calendar', async () => {
    await stock(30)
    const l = await published()
    const dates = (await api.get(`/v1/bulk-deals/${l.id}?pincode=560034`)).body.availability.map((d) => d.date)
    assert.ok(dates.every((d) => d >= todayIST() && d <= addDays(todayIST(), 30)))
  })
})
