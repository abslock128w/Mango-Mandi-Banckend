// Customer reviews: who may review what and when, one review per order line
// under load, idempotent sends, the moderation status machine and its star
// totals, photos (type, size, metadata, never public before approval), the
// role matrix, account deletion, the low-rating follow-up and the review
// request message.
import { adminToken, checkout, client, closeAll, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import sharp from 'sharp'
import { now, setNow } from '../src/clock.js'
import { query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'
import { cleanupExpired } from '../src/maintenance.js'
import { usePhotoStore } from '../src/photos.js'
import { auditReviewStats } from '../src/reviews.js'
import { enqueueReviewRequests } from '../src/review-jobs.js'

let srv
let api
let manager

/** An in-memory stand-in for Vercel Blob, so tests can see what is stored and deleted. */
const blobs = new Map()
const memoryStore = {
  async put(path, bytes) {
    blobs.set(path, bytes)
    return path
  },
  async get(path) {
    return blobs.get(path) ?? null
  },
  async del(path) {
    blobs.delete(path)
  },
  async listOld() {
    return []
  },
}

before(async () => {
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  usePhotoStore(null)
  await srv.close()
  await closeAll()
})
beforeEach(async () => {
  blobs.clear()
  usePhotoStore(null)
  await resetDb()
  manager = await adminToken(api)
})

const HOUR = 3_600_000
const later = (ms) => setNow(new Date(now().getTime() + ms).toISOString())
const key = () => `k-${newId('t')}`

/** A paid order for a new customer, marked delivered now. Returns ids and the token. */
async function deliveredOrder({ items = [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }], name = 'Asha Rao', deliver = true } = {}) {
  await makeBatch({ age: 6, rating: 'RIPE', lines: { 'ALP-3': 30, 'ALP-5': 30 } })
  const cust = await customerToken(api)
  if (name) await query('UPDATE customers SET name = $2 WHERE id = $1', [cust.customer?.id ?? (await idOf(cust)), name])
  const c = await checkout(api, cust.accessToken, items)
  assert.equal(c.status, 201, JSON.stringify(c.body))
  await api.post('/v1/dev/pay', { orderId: c.body.orderId, outcome: 'captured' })
  if (deliver) await markDelivered(c.body.orderId)
  const { rows } = await query('SELECT id, sku, stage FROM order_items WHERE order_id = $1 ORDER BY sku, stage', [c.body.orderId])
  return { token: cust.accessToken, orderId: c.body.orderId, items: rows, customerId: await idOf(cust) }
}

async function idOf(cust) {
  const me = await api.get('/v1/me', { token: cust.accessToken })
  return me.body.id
}

async function markDelivered(orderId) {
  await query(`UPDATE orders SET status = 'DELIVERED' WHERE id = $1`, [orderId])
  await query(`INSERT INTO order_events (id, order_id, from_status, status, actor, created_at) VALUES ($1, $2, 'OUT_FOR_DELIVERY', 'DELIVERED', 'test', $3)`, [
    newId('evt'), orderId, now(),
  ])
}

const send = (token, body, k = key()) => api.post('/v1/reviews', body, { token, headers: { 'Idempotency-Key': k } })

async function photo({ format = 'jpeg', width = 900, height = 700, exif } = {}) {
  let img = sharp({ create: { width, height, channels: 3, background: { r: 250, g: 180, b: 40 } } })
  if (exif) img = img.withExif(exif)
  return img.toFormat(format).toBuffer()
}

const upload = (token, bytes, type = 'image/jpeg') => api.raw('POST', '/v1/reviews/photos', { token, raw: bytes, headers: { 'Content-Type': type } })

const stats = async (scope = 'VARIETY', k = 'Alphonso') => (await query('SELECT * FROM review_stats WHERE scope = $1 AND key = $2', [scope, k])).rows[0] ?? null
const publicList = (qs = '') => api.get(`/v1/products/ALP-3/reviews${qs}`)

describe('who can review what, and when', () => {
  test('only the buyer, only once delivered, one per line, within 30 days', async () => {
    const o = await deliveredOrder({ deliver: false })
    const item = o.items[0].id
    const notYet = await send(o.token, { orderItemId: item, rating: 5 })
    assert.equal(notYet.status, 400)
    assert.equal(notYet.body.error.code, 'NOT_DELIVERED')

    await markDelivered(o.orderId)
    const missingKey = await api.post('/v1/reviews', { orderItemId: item, rating: 5 }, { token: o.token })
    assert.equal(missingKey.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED')

    const stranger = await customerToken(api)
    const theirs = await send(stranger.accessToken, { orderItemId: item, rating: 1 })
    assert.equal(theirs.status, 404, 'someone else’s order line looks like it does not exist')

    const ok = await send(o.token, { orderItemId: item, rating: 5, taste: 5, ripenessAccuracy: 4, comment: 'Sweet and ripe, just as promised.' })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    assert.equal(ok.body.review.status, 'PENDING')
    assert.equal(ok.body.review.displayName, 'Asha R.')
    assert.equal(ok.body.followUp, null)

    const again = await send(o.token, { orderItemId: item, rating: 4 })
    assert.equal(again.status, 409)
    assert.equal(again.body.error.code, 'ALREADY_REVIEWED')

    // The review is linked to the batch that filled the line.
    const { rows } = await query('SELECT * FROM review_batches WHERE review_id = $1', [ok.body.review.id])
    assert.equal(rows.length, 1)

    const late = await deliveredOrder()
    later(31 * 24 * HOUR)
    const tooLate = await send(late.token, { orderItemId: late.items[0].id, rating: 5 })
    assert.equal(tooLate.status, 400)
    assert.equal(tooLate.body.error.code, 'REVIEW_WINDOW_CLOSED')
  })

  test('a gift order is reviewed by the buyer; ratings outside 1 to 5 and long comments are refused', async () => {
    await makeBatch({ age: 6, rating: 'RIPE', lines: { 'ALP-3': 10 } })
    const cust = await customerToken(api)
    await api.post('/v1/cart/items', { sku: 'ALP-3', stage: 'RIPE', qty: 1 }, { token: cust.accessToken })
    const q = await api.post('/v1/checkout/quote', { pincode: '560034' }, { token: cust.accessToken })
    const c = await api.post(
      '/v1/checkout/confirm',
      { quoteId: q.body.quoteId, address: '12, 4th Cross, Koramangala, Bengaluru', name: 'Vikram Shah', gift: { recipientName: 'Meera', recipientPhone: '9811111111' } },
      { token: cust.accessToken, headers: { 'Idempotency-Key': key() } },
    )
    assert.equal(c.status, 201, JSON.stringify(c.body))
    await api.post('/v1/dev/pay', { orderId: c.body.orderId, outcome: 'captured' })
    await markDelivered(c.body.orderId)
    const item = (await query('SELECT id FROM order_items WHERE order_id = $1', [c.body.orderId])).rows[0].id
    assert.equal((await send(cust.accessToken, { orderItemId: item, rating: 6 })).status, 400)
    assert.equal((await send(cust.accessToken, { orderItemId: item, rating: 0 })).status, 400)
    assert.equal((await send(cust.accessToken, { orderItemId: item, rating: 5, taste: 9 })).status, 400)
    assert.equal((await send(cust.accessToken, { orderItemId: item, rating: 5, comment: 'x'.repeat(1001) })).status, 400)
    const ok = await send(cust.accessToken, { orderItemId: item, rating: 5, anonymous: true })
    assert.equal(ok.status, 201)
    assert.equal(ok.body.review.displayName, 'Anonymous')
  })

  test('my reviews and the items I can still review', async () => {
    const o = await deliveredOrder({ items: [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }, { sku: 'ALP-5', stage: 'RIPE', qty: 1 }] })
    let mine = await api.get('/v1/me/reviews', { token: o.token })
    assert.equal(mine.status, 200)
    assert.equal(mine.body.reviewable.length, 2)
    assert.equal(mine.body.reviews.length, 0)
    await send(o.token, { orderItemId: o.items[0].id, rating: 4 })
    mine = await api.get(`/v1/me/reviews?orderId=${o.orderId}`, { token: o.token })
    assert.equal(mine.body.reviewable.length, 1)
    assert.equal(mine.body.reviews.length, 1)
    assert.equal(mine.body.reviews[0].canEdit, true)
    assert.equal(mine.body.reviewable[0].sku, 'ALP-5')
  })
})

describe('sending safely', () => {
  test('20 sends at once for the same line make exactly one review', async () => {
    const o = await deliveredOrder()
    const body = { orderItemId: o.items[0].id, rating: 5 }
    const results = await Promise.all(Array.from({ length: 20 }, () => send(o.token, body)))
    const codes = results.map((r) => r.status).sort()
    assert.equal(codes.filter((s) => s === 201).length, 1, codes.join(','))
    assert.ok(codes.every((s) => s === 201 || s === 409), codes.join(','))
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM reviews WHERE order_item_id = $1', [o.items[0].id])
    assert.equal(rows[0].n, 1)
  })

  test('the same Idempotency-Key replays the same review; with a different body it is refused', async () => {
    const o = await deliveredOrder()
    const k = key()
    const body = { orderItemId: o.items[0].id, rating: 4, comment: 'Good' }
    const [a, b] = await Promise.all([send(o.token, body, k), send(o.token, body, k)])
    assert.deepEqual([a.status, b.status].sort(), [200, 201])
    assert.equal(a.body.review.id, b.body.review.id)
    const c = await send(o.token, body, k)
    assert.equal(c.status, 200)
    assert.equal(c.body.review.id, a.body.review.id)
    const d = await send(o.token, { ...body, rating: 1 }, k)
    assert.equal(d.status, 422)
    assert.equal(d.body.error.code, 'IDEMPOTENCY_KEY_REUSED')
    // Another customer's identical key is their own.
    const other = await deliveredOrder()
    assert.equal((await send(other.token, { orderItemId: other.items[0].id, rating: 4, comment: 'Good' }, k)).status, 201)
  })

  test('review sends are rate limited per customer', async () => {
    const o = await deliveredOrder()
    await query(`INSERT INTO rate_limits (key, hits, reset_at) VALUES ($1, 30, $2)`, [`review-submit:${o.customerId}`, new Date(Date.now() + HOUR)])
    const r = await send(o.token, { orderItemId: o.items[0].id, rating: 5 })
    assert.equal(r.status, 429)
    assert.equal(r.body.error.code, 'RATE_LIMITED')
  })
})

describe('moderation', () => {
  test('text with links, phone numbers, emails or swearing is flagged and stays pending', async () => {
    const o = await deliveredOrder({ items: [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }, { sku: 'ALP-5', stage: 'RIPE', qty: 1 }] })
    const a = await send(o.token, { orderItemId: o.items[0].id, rating: 5, comment: 'Cheaper at www.example.com, call 98450 12345 or mail me@x.com' })
    assert.equal(a.body.review.status, 'PENDING')
    const row = (await query('SELECT flagged, flag_reasons FROM reviews WHERE id = $1', [a.body.review.id])).rows[0]
    assert.equal(row.flagged, true)
    assert.deepEqual(row.flag_reasons.sort(), ['EMAIL', 'LINK', 'PHONE'])
    const b = await send(o.token, { orderItemId: o.items[1].id, rating: 5, comment: 'Lovely mangoes, ripe in two days. 10/10.' })
    assert.equal((await query('SELECT flagged FROM reviews WHERE id = $1', [b.body.review.id])).rows[0].flagged, false)
    const q = await api.get('/admin/v1/reviews?flagged=true', { token: manager })
    assert.deepEqual(q.body.items.map((r) => r.id), [a.body.review.id])
  })

  test('every move outside the status machine is refused, and the totals follow every change', async () => {
    const a = await deliveredOrder()
    const b = await deliveredOrder()
    const ra = (await send(a.token, { orderItemId: a.items[0].id, rating: 5, comment: 'Great' })).body.review
    const rb = (await send(b.token, { orderItemId: b.items[0].id, rating: 2, comment: 'Too raw' })).body.review
    const act = (id, what, body = { reason: 'checked by staff' }) => api.post(`/admin/v1/reviews/${id}/${what}`, body, { token: manager })

    // PENDING can't be hidden.
    assert.equal((await act(ra.id, 'hide')).body.error.code, 'INVALID_TRANSITION')
    assert.equal(await stats(), null)

    assert.equal((await act(ra.id, 'approve', {})).status, 200)
    let s = await stats()
    assert.equal(s.count, 1)
    assert.equal(s.rating_sum, 5)
    assert.equal(s.stars_5, 1)
    // APPROVED can't be approved again or rejected.
    assert.equal((await act(ra.id, 'approve', {})).status, 409)
    assert.equal((await act(ra.id, 'reject')).status, 409)

    assert.equal((await act(rb.id, 'reject')).status, 200)
    // REJECTED can't be approved or hidden.
    assert.equal((await act(rb.id, 'approve', {})).status, 409)
    assert.equal((await act(rb.id, 'hide')).status, 409)
    assert.equal((await stats()).count, 1)
    // A reason is required to reject or hide.
    assert.equal((await act(ra.id, 'hide', {})).status, 400)

    assert.equal((await act(ra.id, 'hide')).status, 200)
    s = await stats()
    assert.equal(s.count, 0)
    assert.equal(s.stars_5, 0)
    // HIDDEN can't be approved, rejected or hidden again, and the customer can't edit it.
    for (const what of ['approve', 'reject', 'hide']) assert.equal((await act(ra.id, what)).status, 409, what)
    assert.equal((await api.patch(`/v1/reviews/${ra.id}`, { rating: 4 }, { token: a.token })).body.error.code, 'INVALID_TRANSITION')

    // An edit takes an approved review back to pending and out of the totals.
    const c = await deliveredOrder()
    const rc = (await send(c.token, { orderItemId: c.items[0].id, rating: 4 })).body.review
    await act(rc.id, 'approve', {})
    assert.equal((await stats()).count, 1)
    const edited = await api.patch(`/v1/reviews/${rc.id}`, { rating: 3, comment: 'A bit less sweet than last time' }, { token: c.token })
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    assert.equal(edited.body.review.status, 'PENDING')
    assert.equal((await stats()).count, 0)
    await act(rc.id, 'approve', {})
    s = await stats()
    assert.equal(s.count, 1)
    assert.equal(s.stars_3, 1)
    assert.equal(s.stars_4, 0)

    // Deleting an approved review takes it out; a deleted review is gone for everyone.
    assert.equal((await api.del(`/v1/reviews/${rc.id}`, { token: c.token })).status, 204)
    assert.equal((await stats()).count, 0)
    assert.equal((await act(rc.id, 'approve', {})).status, 404)
    assert.equal((await api.del(`/v1/reviews/${rc.id}`, { token: c.token })).status, 404)
    assert.equal((await api.patch(`/v1/reviews/${rc.id}`, { rating: 5 }, { token: c.token })).status, 404)

    // The history is kept.
    const detail = await api.get(`/admin/v1/reviews/${ra.id}`, { token: manager })
    assert.deepEqual(detail.body.events.map((e) => e.to), ['PENDING', 'APPROVED', 'HIDDEN'])
    assert.deepEqual(await tx((cl) => auditReviewStats(cl)), [])
  })

  test('two staff approving at once: one wins, the totals count it once', async () => {
    const o = await deliveredOrder()
    const r = (await send(o.token, { orderItemId: o.items[0].id, rating: 5 })).body.review
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    const res = await Promise.all([
      api.post(`/admin/v1/reviews/${r.id}/approve`, {}, { token: manager }),
      api.post(`/admin/v1/reviews/${r.id}/approve`, {}, { token: ops }),
      api.post(`/admin/v1/reviews/${r.id}/reject`, { reason: 'duplicate click' }, { token: ops }),
    ])
    assert.equal(res.filter((x) => x.status === 200).length, 1, res.map((x) => x.status).join(','))
    const s = await stats()
    assert.equal(s ? s.count : 0, res[0].status === 200 || res[1].status === 200 ? 1 : 0)
  })

  test('customers edit for 48 hours only', async () => {
    const o = await deliveredOrder()
    const r = (await send(o.token, { orderItemId: o.items[0].id, rating: 4 })).body.review
    later(47 * HOUR)
    assert.equal((await api.patch(`/v1/reviews/${r.id}`, { rating: 5 }, { token: o.token })).status, 200)
    later(2 * HOUR)
    const late = await api.patch(`/v1/reviews/${r.id}`, { rating: 3 }, { token: o.token })
    assert.equal(late.status, 409)
    assert.equal(late.body.error.code, 'EDIT_WINDOW_CLOSED')
    // Still deletable.
    assert.equal((await api.del(`/v1/reviews/${r.id}`, { token: o.token })).status, 204)
  })

  test('bulk approve and reject: capped at 50, each review stands alone', async () => {
    const a = await deliveredOrder()
    const b = await deliveredOrder()
    const ra = (await send(a.token, { orderItemId: a.items[0].id, rating: 5 })).body.review
    const rb = (await send(b.token, { orderItemId: b.items[0].id, rating: 4 })).body.review
    await api.post(`/admin/v1/reviews/${rb.id}/reject`, { reason: 'spam' }, { token: manager })
    const r = await api.post('/admin/v1/reviews/bulk', { action: 'approve', ids: [ra.id, rb.id, 'rvw_missing'] }, { token: manager })
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.done, [ra.id])
    assert.deepEqual(r.body.failed.map((f) => f.code).sort(), ['INVALID_TRANSITION', 'NOT_FOUND'])
    const tooMany = await api.post('/admin/v1/reviews/bulk', { action: 'approve', ids: Array.from({ length: 51 }, (_, i) => `rvw_${i}`) }, { token: manager })
    assert.equal(tooMany.status, 400)
    assert.equal((await api.post('/admin/v1/reviews/bulk', { action: 'reject', ids: [ra.id] }, { token: manager })).status, 400, 'reject needs a reason')
    assert.equal((await stats()).count, 1)
  })

  test('one brand reply per review, shown publicly with the review', async () => {
    const o = await deliveredOrder()
    const r = (await send(o.token, { orderItemId: o.items[0].id, rating: 5, comment: 'Superb' })).body.review
    await api.post(`/admin/v1/reviews/${r.id}/approve`, {}, { token: manager })
    assert.equal((await api.put(`/admin/v1/reviews/${r.id}/reply`, { body: 'Thank you!' }, { token: manager })).status, 200)
    const second = await api.put(`/admin/v1/reviews/${r.id}/reply`, { body: 'Thank you so much!' }, { token: manager })
    assert.equal(second.body.reply.body, 'Thank you so much!')
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM review_replies WHERE review_id = $1', [r.id])).rows[0].n, 1)
    const list = await publicList()
    assert.equal(list.body.items[0].reply.body, 'Thank you so much!')
    assert.equal((await api.put(`/admin/v1/reviews/${r.id}/reply`, { body: '   ' }, { token: manager })).status, 400)
  })
})

describe('the public list', () => {
  test('approved reviews only, totals from review_stats, filters, pages, and nothing personal', async () => {
    const reviews = []
    for (const rating of [5, 4, 5, 2, 3]) {
      const o = await deliveredOrder({ name: 'Ravi Kumar' })
      const r = (await send(o.token, { orderItemId: o.items[0].id, rating, comment: `Rated ${rating}` })).body.review
      reviews.push(r)
      later(60_000)
    }
    for (const r of reviews.slice(0, 4)) await api.post(`/admin/v1/reviews/${r.id}/approve`, {}, { token: manager })

    const page1 = await publicList('?limit=2')
    assert.equal(page1.status, 200)
    assert.match(page1.headers.get('cache-control'), /public/)
    assert.deepEqual(page1.body.summary, { count: 4, average: 4, distribution: { 1: 0, 2: 1, 3: 0, 4: 1, 5: 2 }, withPhotos: 0 })
    assert.equal(page1.body.items.length, 2)
    assert.ok(page1.body.nextCursor)
    const page2 = await publicList(`?limit=2&cursor=${page1.body.nextCursor}`)
    assert.equal(page2.body.items.length, 2)
    assert.equal(page2.body.nextCursor, null)
    const all = [...page1.body.items, ...page2.body.items]
    assert.equal(new Set(all.map((r) => r.id)).size, 4)
    assert.ok(!all.some((r) => r.id === reviews[4].id), 'pending review is not public')
    assert.deepEqual((await publicList('?stars=5')).body.items.map((r) => r.rating), [5, 5])
    assert.equal((await publicList('?withPhotos=true')).body.items.length, 0)
    assert.equal((await publicList('?limit=21')).status, 400)
    assert.equal((await api.get('/v1/products/NOPE/reviews')).status, 404)
    // The 5 kg box shows the variety's reviews too; scope=sku narrows it.
    assert.equal((await api.get('/v1/products/ALP-5/reviews')).body.summary.count, 4)
    assert.equal((await api.get('/v1/products/ALP-5/reviews?scope=sku')).body.summary.count, 0)

    const item = all[0]
    assert.equal(item.displayName, 'Ravi K.')
    assert.equal(item.verifiedPurchase, true)
    assert.equal(item.variety, 'Alphonso')
    assert.equal(item.ripenessOrdered, 'RIPE')
    const json = JSON.stringify(page1.body)
    for (const leak of ['orderId', 'order_id', 'orderNumber', 'customerId', 'customer_id', 'phone', 'email', 'address', '+91', 'Koramangala', 'Kumar']) {
      assert.ok(!json.includes(leak), `public list leaks ${leak}`)
    }
  })
})

describe('photos', () => {
  test('wrong type, spoofed type, oversize and a 4th photo are refused', async () => {
    const o = await deliveredOrder()
    const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'latin1')
    const wrong = await upload(o.token, gif, 'image/jpeg')
    assert.equal(wrong.status, 400)
    assert.equal(wrong.body.error.code, 'PHOTO_INVALID')
    // A text file named and labelled as a JPEG.
    const spoofed = await upload(o.token, Buffer.from('<?php echo "hi"; ?> not really a photo'), 'image/jpeg')
    assert.equal(spoofed.body.error.code, 'PHOTO_INVALID')
    // The right first bytes, but not an image behind them.
    const fake = await upload(o.token, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7)]))
    assert.equal(fake.status, 400)
    assert.equal(fake.body.error.code, 'PHOTO_INVALID')
    const notImage = await upload(o.token, Buffer.from('hello'), 'text/plain')
    assert.equal(notImage.status, 400)
    const big = await upload(o.token, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024 + 10)]))
    assert.equal(big.status, 413)

    const ids = []
    for (let i = 0; i < 4; i++) {
      const r = await upload(o.token, await photo({ format: ['jpeg', 'png', 'webp', 'jpeg'][i] }), ['image/jpeg', 'image/png', 'image/webp', 'image/jpeg'][i])
      assert.equal(r.status, 201, JSON.stringify(r.body))
      ids.push(r.body.id)
    }
    const four = await send(o.token, { orderItemId: o.items[0].id, rating: 5, photoIds: ids })
    assert.equal(four.status, 400)
    assert.equal((await send(o.token, { orderItemId: o.items[0].id, rating: 5, photoIds: ids.slice(0, 3) })).status, 201)
  })

  test('photos are re-encoded, smaller and without EXIF or GPS', async () => {
    const o = await deliveredOrder()
    const original = await photo({
      width: 3000,
      height: 2000,
      exif: { IFD0: { Artist: 'SECRET-OWNER', Copyright: 'SECRET-COPY' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '12/1 58/1 0/1' } },
    })
    assert.ok((await sharp(original).metadata()).exif, 'the test photo carries EXIF')
    const r = await upload(o.token, original)
    assert.equal(r.status, 201)
    assert.ok(r.body.width <= 1600 && r.body.height <= 1600)
    const stored = (await query('SELECT bytes, mime FROM review_photos WHERE id = $1', [r.body.id])).rows[0]
    assert.equal(stored.mime, 'image/jpeg')
    const meta = await sharp(stored.bytes).metadata()
    assert.equal(meta.exif, undefined)
    assert.ok(!stored.bytes.includes(Buffer.from('SECRET')), 'no metadata text survives')
  })

  test('a photo is public only once staff approve it and its review', async () => {
    usePhotoStore(memoryStore)
    const o = await deliveredOrder()
    const p1 = (await upload(o.token, await photo())).body.id
    const p2 = (await upload(o.token, await photo({ format: 'png' }), 'image/png')).body.id
    assert.equal(blobs.size, 2)
    const stranger = await customerToken(api)
    // Someone else's photo id can't be attached.
    const s = await deliveredOrder()
    assert.equal((await send(s.token, { orderItemId: s.items[0].id, rating: 5, photoIds: [p1] })).body.error.code, 'PHOTO_NOT_FOUND')

    const r = (await send(o.token, { orderItemId: o.items[0].id, rating: 5, photoIds: [p1, p2] })).body.review
    // The owner sees their own photo; nobody else does, signed in or not.
    assert.equal((await api.get(`/v1/reviews/${r.id}/photos/${p1}`, { token: o.token })).status, 200)
    assert.equal((await api.get(`/v1/reviews/${r.id}/photos/${p1}`, { token: stranger.accessToken })).status, 404)
    assert.equal((await api.get(`/v1/review-photos/${p1}`)).status, 404, 'pending review')

    await api.post(`/admin/v1/reviews/${r.id}/approve`, { photoIds: [p1] }, { token: manager })
    const pub = await api.get(`/v1/review-photos/${p1}`)
    assert.equal(pub.status, 200)
    assert.equal(pub.headers.get('cross-origin-resource-policy'), 'cross-origin', 'the shop on another origin can show it')
    assert.equal(pub.headers.get('content-type'), 'image/jpeg')
    assert.equal((await api.get(`/v1/review-photos/${p2}`)).status, 404, 'photo not approved')
    const list = await publicList()
    assert.deepEqual(list.body.items[0].photos.map((p) => p.id), [p1])
    assert.equal(list.body.summary.withPhotos, 1)
    assert.equal((await publicList('?withPhotos=true')).body.items.length, 1)

    await api.post(`/admin/v1/reviews/${r.id}/hide`, { reason: 'off topic' }, { token: manager })
    assert.equal((await api.get(`/v1/review-photos/${p1}`)).status, 404, 'hidden review')
    assert.equal((await stats()).with_photos, 0)
    assert.deepEqual(await tx((c) => auditReviewStats(c)), [])
  })

  test('direct uploads: only the customer’s own upload path, and the original is deleted', async () => {
    usePhotoStore(memoryStore)
    const o = await deliveredOrder()
    const path = `review-uploads/${o.customerId}/up_1`
    blobs.set(path, await photo({ exif: { IFD0: { Artist: 'SECRET' } } }))
    const other = await deliveredOrder()
    const theirs = await api.post('/v1/reviews/photos', { pathname: path }, { token: other.token })
    assert.equal(theirs.status, 404)
    assert.equal((await api.post('/v1/reviews/photos', { pathname: `review-uploads/${o.customerId}/../x` }, { token: o.token })).status, 404)
    const ok = await api.post('/v1/reviews/photos', { pathname: path }, { token: o.token })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    assert.ok(!blobs.has(path), 'the original upload is removed')
    const stored = [...blobs.entries()].find(([k]) => k.startsWith('reviews/'))
    assert.ok(stored)
    assert.ok(!stored[1].includes(Buffer.from('SECRET')))
    // Without Blob set up the phone is told to post the photo to the API.
    assert.equal((await api.post('/v1/reviews/photos/upload-token', {}, { token: o.token })).body.mode, 'direct')
  })

  test('photos never sent with a review are cleaned up after a day', async () => {
    usePhotoStore(memoryStore)
    const o = await deliveredOrder()
    const loose = (await upload(o.token, await photo())).body.id
    const used = (await upload(o.token, await photo())).body.id
    await send(o.token, { orderItemId: o.items[0].id, rating: 4, photoIds: [used] })
    later(25 * HOUR)
    await cleanupExpired(now())
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM review_photos WHERE id = $1', [loose])).rows[0].n, 0)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM review_photos WHERE id = $1', [used])).rows[0].n, 1)
    assert.equal(blobs.size, 1)
  })
})

describe('roles', () => {
  test('every review route answers the right people', async () => {
    const o = await deliveredOrder()
    const r = (await send(o.token, { orderItemId: o.items[0].id, rating: 5 })).body.review
    const other = await customerToken(api)
    await api.post('/admin/v1/staff', { email: 'ravi@mandimangoes.test', role: 'RIDER', password: 'long-enough-1' }, { token: manager })
    const staff = {
      MANAGER: manager,
      OPERATOR: await adminToken(api, 'ops@mandimangoes.test', 'operator123'),
      PACKER: await adminToken(api, 'packer@mandimangoes.test', 'packer123'),
      QC: await adminToken(api, 'qc@mandimangoes.test', 'qc123'),
      RIDER: await adminToken(api, 'ravi@mandimangoes.test', 'long-enough-1'),
    }
    const p = (await upload(o.token, await photo())).body.id

    // Customer routes: the owner yes; another customer "not found"; anonymous and staff tokens 401.
    const customerRoutes = [
      ['get', '/v1/me/reviews', undefined, 200, 200],
      ['patch', `/v1/reviews/${r.id}`, { rating: 4 }, 200, 404],
      ['get', `/v1/reviews/${r.id}/photos/${p}`, undefined, 404, 404],
      ['post', '/v1/reviews/photos/upload-token', {}, 200, 200],
    ]
    for (const [m, path, body, own, theirs] of customerRoutes) {
      const call = (token) => (body === undefined ? api[m](path, { token }) : api[m](path, body, { token }))
      assert.equal((await call(o.token)).status, own, `${m} ${path} owner`)
      assert.equal((await call(other.accessToken)).status, theirs, `${m} ${path} other customer`)
      assert.equal((await call(undefined)).status, 401, `${m} ${path} anonymous`)
      assert.equal((await call(staff.MANAGER)).status, 401, `${m} ${path} staff token`)
    }
    assert.equal((await api.post('/v1/reviews', { orderItemId: o.items[0].id, rating: 5 }, { headers: { 'Idempotency-Key': key() } })).status, 401)
    assert.equal((await upload(undefined, await photo())).status, 401)
    assert.equal((await api.del(`/v1/reviews/${r.id}`, { token: other.accessToken })).status, 404)
    // Public routes need nobody.
    assert.equal((await publicList()).status, 200)

    // Staff routes: managers and operators moderate; QC reads insights; packers and riders get nothing.
    const staffRoutes = [
      ['get', '/admin/v1/reviews', undefined],
      ['get', '/admin/v1/reviews/insights', undefined],
      ['get', `/admin/v1/reviews/${r.id}`, undefined],
      ['get', `/admin/v1/reviews/${r.id}/photos/missing`, undefined],
      ['post', `/admin/v1/reviews/${r.id}/reject`, { reason: 'x' }],
      ['post', `/admin/v1/reviews/${r.id}/hide`, { reason: 'x' }],
      ['post', `/admin/v1/reviews/${r.id}/approve`, { photoIds: ['nope'] }],
      ['post', '/admin/v1/reviews/bulk', { action: 'approve', ids: [] }],
      ['put', `/admin/v1/reviews/${r.id}/reply`, { body: '' }],
      ['del', `/admin/v1/reviews/${r.id}/reply`, undefined],
    ]
    for (const [m, path, body] of staffRoutes) {
      const call = (token) => (body === undefined ? api[m](path, { token }) : api[m](path, body, { token }))
      for (const [role, token] of Object.entries(staff)) {
        const st = (await call(token)).status
        const allowed = role === 'MANAGER' || role === 'OPERATOR' || (role === 'QC' && path.endsWith('/insights'))
        if (allowed) assert.notEqual(st, 403, `${role} ${m} ${path}`)
        else assert.equal(st, 403, `${role} ${m} ${path}`)
      }
      assert.equal((await call(o.token)).status, 401, `customer ${m} ${path}`)
      assert.equal((await call(undefined)).status, 401, `anonymous ${m} ${path}`)
    }
  })

  test('staff changes land in the audit trail with the reason', async () => {
    const o = await deliveredOrder()
    const r = (await send(o.token, { orderItemId: o.items[0].id, rating: 5 })).body.review
    await api.post(`/admin/v1/reviews/${r.id}/reject`, { reason: 'mentions a competitor' }, { token: manager })
    for (let i = 0; i < 50; i++) {
      const { rows } = await query(`SELECT * FROM staff_audit WHERE target = $1 AND action = 'POST /reviews/:id/reject'`, [r.id])
      if (rows.length) {
        assert.equal(rows[0].email, 'manager@mandimangoes.test')
        assert.equal(rows[0].detail.reason, 'mentions a competitor')
        return
      }
      await new Promise((res) => setTimeout(res, 20))
    }
    assert.fail('no audit row')
  })
})

describe('privacy', () => {
  test('deleting the account removes name, text, photos and reply from reviews; the stars stay', async () => {
    usePhotoStore(memoryStore)
    const o = await deliveredOrder({ name: 'Priya Nair' })
    const p = (await upload(o.token, await photo())).body.id
    const r = (await send(o.token, { orderItemId: o.items[0].id, rating: 4, taste: 5, comment: 'I am Priya from Indiranagar', photoIds: [p] })).body.review
    await api.post(`/admin/v1/reviews/${r.id}/approve`, { photoIds: [p] }, { token: manager })
    await api.put(`/admin/v1/reviews/${r.id}/reply`, { body: 'Thanks Priya!' }, { token: manager })
    assert.equal((await stats()).with_photos, 1)

    assert.equal((await api.del('/v1/me', { token: o.token })).status, 204)
    const row = (await query('SELECT * FROM reviews WHERE id = $1', [r.id])).rows[0]
    assert.equal(row.display_name, 'Anonymous')
    assert.equal(row.comment, null)
    assert.ok(row.scrubbed_at)
    assert.equal(row.rating, 4)
    const pic = (await query('SELECT * FROM review_photos WHERE id = $1', [p])).rows[0]
    assert.ok(pic.removed_at)
    assert.equal(pic.bytes, null)
    assert.equal(pic.blob_path, null)
    assert.equal(blobs.size, 0, 'the stored image is deleted')
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM review_replies WHERE review_id = $1', [r.id])).rows[0].n, 0)
    const list = await publicList()
    const json = JSON.stringify(list.body)
    assert.ok(!json.includes('Priya') && !json.includes('Indiranagar'))
    assert.equal(list.body.items[0].displayName, 'Anonymous')
    assert.deepEqual(list.body.items[0].photos, [])
    const s = await stats()
    assert.equal(s.count, 1)
    assert.equal(s.stars_4, 1)
    assert.equal(s.with_photos, 0)
    assert.equal((await api.get(`/v1/review-photos/${p}`)).status, 404)
    assert.deepEqual(await tx((c) => auditReviewStats(c)), [])
  })
})

describe('low ratings', () => {
  test('1 or 2 stars point to a claim while the window is open, then to support; never a claim by itself', async () => {
    const o = await deliveredOrder({ items: [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }, { sku: 'ALP-5', stage: 'RIPE', qty: 1 }] })
    const a = await send(o.token, { orderItemId: o.items[0].id, rating: 2, comment: 'Two were bruised' })
    assert.equal(a.body.followUp.type, 'CLAIM')
    assert.equal(a.body.followUp.orderId, o.orderId)
    later(25 * HOUR)
    const b = await send(o.token, { orderItemId: o.items[1].id, rating: 1 })
    assert.equal(b.body.followUp.type, 'SUPPORT')
    assert.ok(b.body.followUp.contact)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM claims')).rows[0].n, 0)
    const attention = await api.get('/admin/v1/attention', { token: manager })
    assert.deepEqual(attention.body.lowRatings.map((r) => r.rating).sort(), [1, 2])
    assert.ok(!('phone' in attention.body.lowRatings[0]))
  })
})

describe('insights', () => {
  test('ripeness accuracy per batch and variety, for managers and QC', async () => {
    const o = await deliveredOrder()
    await send(o.token, { orderItemId: o.items[0].id, rating: 3, ripenessAccuracy: 2 })
    const p = await deliveredOrder()
    await send(p.token, { orderItemId: p.items[0].id, rating: 5, ripenessAccuracy: 5 })
    const qc = await adminToken(api, 'qc@mandimangoes.test', 'qc123')
    const r = await api.get('/admin/v1/reviews/insights', { token: qc })
    assert.equal(r.status, 200)
    const v = r.body.byVariety.find((x) => x.variety === 'Alphonso')
    assert.equal(v.reviews, 2)
    assert.equal(v.ripenessAccuracy, 3.5)
    assert.equal(v.averageRating, 4)
    assert.ok(r.body.byBatch.length >= 1)
    assert.ok(r.body.byBatch.some((b) => b.notAsPromised === 1))
    assert.equal(r.body.lowRatingTrend.reduce((t, w) => t + w.reviews, 0), 2)
  })
})

describe('review request message', () => {
  test('one WhatsApp per order about a day after delivery, only when switched on and not yet reviewed', async () => {
    const a = await deliveredOrder()
    const b = await deliveredOrder()
    const count = async (orderId) =>
      (await query(`SELECT COUNT(*)::int AS n FROM notifications WHERE order_id = $1 AND kind = 'REVIEW_REQUEST'`, [orderId])).rows[0].n
    later(25 * HOUR)
    env.WHATSAPP_REVIEW_REQUESTS = false
    assert.equal(await enqueueReviewRequests(), 0, 'off until the Meta template is approved')

    env.WHATSAPP_REVIEW_REQUESTS = true
    try {
      await send(b.token, { orderItemId: b.items[0].id, rating: 5 })
      assert.equal(await enqueueReviewRequests(), 1)
      assert.equal(await count(a.orderId), 1)
      assert.equal(await count(b.orderId), 0, 'already reviewed')
      assert.equal(await enqueueReviewRequests(), 0, 'never twice')
      assert.equal(await count(a.orderId), 1)
    } finally {
      env.WHATSAPP_REVIEW_REQUESTS = false
    }
  })

  test('not sooner than a day after delivery', async () => {
    env.WHATSAPP_REVIEW_REQUESTS = true
    try {
      await deliveredOrder()
      later(2 * HOUR)
      assert.equal(await enqueueReviewRequests(), 0)
    } finally {
      env.WHATSAPP_REVIEW_REQUESTS = false
    }
  })
})

