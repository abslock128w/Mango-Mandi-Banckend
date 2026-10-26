// Customer reviews: the rules, the status machine and the star totals.
//
// A review belongs to one delivered order line. It starts PENDING and only
// staff make it public (APPROVED); staff can also reject it, or hide an
// approved one. The customer can edit it for 48 hours (an approved review
// goes back to PENDING) or delete it at any time. Every status change is a
// guarded UPDATE (the WHERE names the statuses it may come from), so two
// clicks can never both win, and review_stats changes in the same transaction.
//
// Reviews never create, change or replace a claim, a refund or an order.
import { createHash } from 'node:crypto'
import { now } from './clock.js'
import { getConfig } from './config.js'
import { conflict, HttpError, notFound } from './errors.js'
import { newId } from './ids.js'
import { logger } from './logger.js'
import { env } from './env.js'
import { productName } from './products.js'

export const REVIEW_WINDOW_DAYS = 30
export const EDIT_HOURS = 48
export const MAX_REVIEW_PHOTOS = 3
export const MAX_COMMENT = 1000
export const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'HIDDEN', 'DELETED']
const DAY_MS = 86_400_000

/** Which statuses each move may start from. Anything else answers 409. */
export const TRANSITIONS = {
  APPROVE: { from: ['PENDING'], to: 'APPROVED' },
  REJECT: { from: ['PENDING'], to: 'REJECTED' },
  HIDE: { from: ['APPROVED'], to: 'HIDDEN' },
  // The customer edits: the new text needs a fresh look.
  EDIT: { from: ['PENDING', 'APPROVED'], to: 'PENDING' },
  DELETE: { from: ['PENDING', 'APPROVED', 'REJECTED', 'HIDDEN'], to: 'DELETED' },
}

// ---------------------------------------------------------------- text checks

const PROFANITY = [
  'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bullshit', 'bitch', 'bastard', 'asshole', 'arsehole', 'dick', 'cunt', 'slut', 'whore', 'wanker',
  'chutiya', 'chutiye', 'chutia', 'bhenchod', 'behenchod', 'bhenchodd', 'madarchod', 'maderchod', 'gandu', 'bhosdi', 'bhosdike', 'bhosadike',
  'randi', 'harami', 'haramkhor', 'lauda', 'lavda', 'lund', 'jhatu',
]
const PROFANE = new RegExp(`(^|[^a-z])(${PROFANITY.join('|')})(?=[^a-z]|$)`)
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' }

const LINK = /(https?:\/\/|www\.)|\b[a-z0-9-]{2,}\.(com|in|net|org|co|io|xyz|info|biz|me|app|link|ly|shop|store|site|online)\b/i
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i
// Ten or more digits in a row, allowing spaces, dots and dashes between them.
const PHONE = /(?:\+?\d[\s.-]?){10,}/

/** Why a comment needs a person to look at it first: LINK, EMAIL, PHONE, PROFANITY. */
export function flagReasons(text) {
  if (!text) return []
  const out = []
  if (EMAIL.test(text)) out.push('EMAIL')
  if (LINK.test(text.replace(EMAIL, ''))) out.push('LINK')
  if (PHONE.test(text)) out.push('PHONE')
  const plain = text.toLowerCase().replace(/[0-9@$]/g, (ch) => LEET[ch] ?? ch).replace(/\*/g, 'u')
  if (PROFANE.test(plain)) out.push('PROFANITY')
  return out
}

/** "Ravi Kumar" → "Ravi K."; nothing usable → "Verified buyer". */
export function displayName(name, anonymous) {
  if (anonymous) return 'Anonymous'
  const parts = String(name ?? '')
    .replace(/[^\p{L}\p{M}\s'-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return 'Verified buyer'
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1)
  const first = cap(parts[0]).slice(0, 30)
  return parts.length > 1 ? `${first} ${parts.at(-1).charAt(0).toUpperCase()}.` : first
}

/** A stable fingerprint of a parsed request body, for Idempotency-Key replays. */
export const bodyHash = (body) => createHash('sha256').update(JSON.stringify(body)).digest('hex')

// ---------------------------------------------------------------- timing

/** When the order was delivered (its latest DELIVERED event). */
export async function deliveredAt(c, orderId) {
  const { rows } = await c.query(`SELECT MAX(created_at) AS at FROM order_events WHERE order_id = $1 AND status = 'DELIVERED'`, [orderId])
  return rows[0].at
}

export const reviewableUntil = (delivered) => new Date(delivered.getTime() + REVIEW_WINDOW_DAYS * DAY_MS)

/**
 * What a customer who gave 1 or 2 stars can do next: raise a claim while the
 * claim window is open, otherwise contact support. Only a pointer: nothing is
 * created.
 */
export function lowRatingFollowUp(review, at = now()) {
  if (review.rating > 2) return null
  const claimUntil = new Date(review.delivered_at.getTime() + getConfig().claimWindowHours * 3_600_000)
  if (at < claimUntil) return { type: 'CLAIM', orderId: review.order_id, claimUntil }
  return { type: 'SUPPORT', contact: env.SUPPORT_CONTACT }
}

// ---------------------------------------------------------------- stats

/** Whether an approved review shows at least one approved photo. */
async function hasPublicPhoto(c, reviewId) {
  const { rows } = await c.query('SELECT 1 FROM review_photos WHERE review_id = $1 AND approved_at IS NOT NULL AND removed_at IS NULL LIMIT 1', [reviewId])
  return rows.length > 0
}

/**
 * Adds (sign 1) or removes (sign -1) one approved review from its SKU and
 * variety totals. Callers hold the review's row lock.
 */
export async function countReview(c, review, sign) {
  const photo = (await hasPublicPhoto(c, review.id)) ? sign : 0
  const star = (n) => (review.rating === n ? sign : 0)
  for (const [scope, key] of [['SKU', review.sku], ['VARIETY', review.variety]]) {
    const deltas = [sign, sign * review.rating, star(1), star(2), star(3), star(4), star(5), photo, now()]
    // A row with negative counts must never be offered (the CHECKs refuse it), so removing is a plain UPDATE.
    if (sign < 0) {
      await c.query(
        `UPDATE review_stats SET count = count + $3, rating_sum = rating_sum + $4, stars_1 = stars_1 + $5, stars_2 = stars_2 + $6,
                stars_3 = stars_3 + $7, stars_4 = stars_4 + $8, stars_5 = stars_5 + $9, with_photos = with_photos + $10, updated_at = $11
          WHERE scope = $1 AND key = $2`,
        [scope, key, ...deltas],
      )
      continue
    }
    await c.query(
      `INSERT INTO review_stats (scope, key, count, rating_sum, stars_1, stars_2, stars_3, stars_4, stars_5, with_photos, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (scope, key) DO UPDATE SET
         count = review_stats.count + EXCLUDED.count, rating_sum = review_stats.rating_sum + EXCLUDED.rating_sum,
         stars_1 = review_stats.stars_1 + EXCLUDED.stars_1, stars_2 = review_stats.stars_2 + EXCLUDED.stars_2,
         stars_3 = review_stats.stars_3 + EXCLUDED.stars_3, stars_4 = review_stats.stars_4 + EXCLUDED.stars_4,
         stars_5 = review_stats.stars_5 + EXCLUDED.stars_5, with_photos = review_stats.with_photos + EXCLUDED.with_photos,
         updated_at = EXCLUDED.updated_at`,
      [scope, key, ...deltas],
    )
  }
}

export function statsView(row) {
  const count = row?.count ?? 0
  return {
    count,
    average: count ? Math.round((row.rating_sum / count) * 10) / 10 : null,
    distribution: { 1: row?.stars_1 ?? 0, 2: row?.stars_2 ?? 0, 3: row?.stars_3 ?? 0, 4: row?.stars_4 ?? 0, 5: row?.stars_5 ?? 0 },
    withPhotos: row?.with_photos ?? 0,
  }
}

/** Recounts approved reviews and lists every total that disagrees (hourly check). */
export async function auditReviewStats(c) {
  const { rows } = await c.query(`
    WITH actual AS (
      SELECT scope, key, COUNT(*)::int AS count, SUM(rating)::int AS rating_sum,
             COUNT(*) FILTER (WHERE rating = 1)::int AS s1, COUNT(*) FILTER (WHERE rating = 2)::int AS s2,
             COUNT(*) FILTER (WHERE rating = 3)::int AS s3, COUNT(*) FILTER (WHERE rating = 4)::int AS s4,
             COUNT(*) FILTER (WHERE rating = 5)::int AS s5, COUNT(*) FILTER (WHERE photo)::int AS wp
        FROM (SELECT r.*, EXISTS (SELECT 1 FROM review_photos p WHERE p.review_id = r.id AND p.approved_at IS NOT NULL AND p.removed_at IS NULL) AS photo
                FROM reviews r WHERE r.status = 'APPROVED') r
        CROSS JOIN LATERAL (VALUES ('SKU', r.sku), ('VARIETY', r.variety)) k(scope, key)
       GROUP BY scope, key)
    SELECT COALESCE(a.scope, s.scope) AS scope, COALESCE(a.key, s.key) AS key
      FROM actual a FULL JOIN review_stats s ON s.scope = a.scope AND s.key = a.key
     WHERE COALESCE(a.count, 0) <> COALESCE(s.count, 0) OR COALESCE(a.rating_sum, 0) <> COALESCE(s.rating_sum, 0)
        OR COALESCE(a.s1, 0) <> COALESCE(s.stars_1, 0) OR COALESCE(a.s2, 0) <> COALESCE(s.stars_2, 0)
        OR COALESCE(a.s3, 0) <> COALESCE(s.stars_3, 0) OR COALESCE(a.s4, 0) <> COALESCE(s.stars_4, 0)
        OR COALESCE(a.s5, 0) <> COALESCE(s.stars_5, 0) OR COALESCE(a.wp, 0) <> COALESCE(s.with_photos, 0)`)
  if (rows.length) logger.error({ drift: rows.slice(0, 20) }, 'review totals disagree with the reviews')
  return rows
}

// ---------------------------------------------------------------- status machine

/**
 * Moves a review to another status if, and only if, it is in one of the
 * statuses the move starts from. `customerId` limits it to that customer's
 * review (anything else is "not found"). `set` adds more columns to change.
 * Keeps review_stats in step and writes review_events. Returns the new row.
 */
export async function transition(c, id, move, { actor, reason = null, customerId = null, set = {}, beforeCount = null } = {}) {
  const { from, to } = TRANSITIONS[move]
  // The row lock makes the old status (for the totals) and the guarded update one step.
  const { rows: cur } = await c.query(
    `SELECT * FROM reviews WHERE id = $1 AND ($2::text IS NULL OR customer_id = $2) AND status <> 'DELETED' FOR UPDATE`,
    [id, customerId],
  )
  if (!cur.length) throw notFound('Review not found')
  const old = cur[0]
  const at = now()
  const cols = { status: to, updated_at: at, ...set }
  const keys = Object.keys(cols)
  const { rows } = await c.query(
    `UPDATE reviews SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE id = $1 AND status = ANY($2) RETURNING *`,
    [id, from, ...keys.map((k) => cols[k])],
  )
  if (!rows.length) {
    throw new HttpError(409, 'INVALID_TRANSITION', `A ${old.status.toLowerCase()} review can't be ${verb[move]}`)
  }
  const next = rows[0]
  if (old.status === 'APPROVED') await countReview(c, old, -1)
  // Approving marks the chosen photos first, so they count in "with photos".
  if (beforeCount) await beforeCount(next)
  if (next.status === 'APPROVED') await countReview(c, next, 1)
  if (old.status !== next.status || reason) {
    await c.query('INSERT INTO review_events (id, review_id, from_status, to_status, actor, reason, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
      newId('rev'), id, old.status, next.status, actor, reason, at,
    ])
  }
  return { old, review: next }
}

const verb = { APPROVE: 'approved', REJECT: 'rejected', HIDE: 'hidden', EDIT: 'edited', DELETE: 'deleted' }

// ---------------------------------------------------------------- views

export async function photosFor(c, reviewIds, { publicOnly = false } = {}) {
  if (!reviewIds.length) return new Map()
  const { rows } = await c.query(
    `SELECT id, review_id, approved_at, width, height FROM review_photos
      WHERE review_id = ANY($1) AND removed_at IS NULL ${publicOnly ? 'AND approved_at IS NOT NULL' : ''} ORDER BY created_at, id`,
    [reviewIds],
  )
  const out = new Map()
  for (const p of rows) out.set(p.review_id, [...(out.get(p.review_id) ?? []), p])
  return out
}

export async function repliesFor(c, reviewIds) {
  if (!reviewIds.length) return new Map()
  const { rows } = await c.query('SELECT review_id, body, created_at, updated_at, admin_email FROM review_replies WHERE review_id = ANY($1)', [reviewIds])
  return new Map(rows.map((r) => [r.review_id, r]))
}

const subRatings = (r) => ({ taste: r.taste, ripenessAccuracy: r.ripeness_accuracy, packaging: r.packaging, delivery: r.delivery })

/** What anyone may see: no customer id, order, phone, email or address. */
export function publicView(r, photos = [], reply = null) {
  return {
    id: r.id,
    rating: r.rating,
    ...subRatings(r),
    comment: r.comment,
    displayName: r.display_name,
    verifiedPurchase: true,
    sku: r.sku,
    productName: productName(r.sku),
    variety: r.variety,
    ripenessOrdered: r.stage,
    photos: photos.map((p) => ({ id: p.id, url: `/v1/review-photos/${p.id}`, width: p.width, height: p.height })),
    reply: reply ? { body: reply.body, at: reply.updated_at } : null,
    createdAt: r.created_at,
  }
}

/** The customer's own view of their review. */
export function ownView(r, photos = [], reply = null, at = now()) {
  return {
    id: r.id,
    orderId: r.order_id,
    orderItemId: r.order_item_id,
    status: r.status,
    rating: r.rating,
    ...subRatings(r),
    comment: r.comment,
    anonymous: r.anonymous,
    displayName: r.display_name,
    sku: r.sku,
    productName: productName(r.sku),
    variety: r.variety,
    ripenessOrdered: r.stage,
    photos: photos.map((p) => ({ id: p.id, url: `/v1/reviews/${r.id}/photos/${p.id}`, approved: Boolean(p.approved_at) })),
    reply: reply ? { body: reply.body, at: reply.updated_at } : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    editableUntil: r.editable_until,
    canEdit: TRANSITIONS.EDIT.from.includes(r.status) && r.editable_until > at,
    moderationReason: r.status === 'REJECTED' || r.status === 'HIDDEN' ? r.moderation_reason : null,
  }
}

/** Staff see everything about a review, including the order it came from. */
export function staffView(r, photos = [], reply = null) {
  return {
    id: r.id,
    status: r.status,
    flagged: r.flagged,
    flagReasons: r.flag_reasons,
    rating: r.rating,
    ...subRatings(r),
    comment: r.comment,
    displayName: r.display_name,
    anonymous: r.anonymous,
    customerName: r.customer_name ?? null,
    customerId: r.customer_id,
    orderId: r.order_id,
    orderNumber: r.order_number ?? null,
    sku: r.sku,
    productName: productName(r.sku),
    variety: r.variety,
    ripenessOrdered: r.stage,
    photos: photos.map((p) => ({ id: p.id, url: `/admin/v1/reviews/${r.id}/photos/${p.id}`, approved: Boolean(p.approved_at) })),
    reply: reply ? { body: reply.body, at: reply.updated_at, by: reply.admin_email } : null,
    deliveredAt: r.delivered_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    moderatedBy: r.moderated_by,
    moderatedAt: r.moderated_at,
    moderationReason: r.moderation_reason,
    scrubbed: Boolean(r.scrubbed_at),
  }
}

// ---------------------------------------------------------------- cursors

/** Keyset cursor over (created_at, id), opaque to clients. */
export const encodeCursor = (r) => Buffer.from(`${r.created_at.toISOString()}|${r.id}`).toString('base64url')

export function decodeCursor(s) {
  if (!s) return null
  const [at, id] = Buffer.from(String(s), 'base64url').toString().split('|')
  const d = new Date(at)
  if (!id || Number.isNaN(d.getTime())) throw new HttpError(400, 'VALIDATION_ERROR', 'cursor is not valid')
  return { at: d, id }
}

// ---------------------------------------------------------------- privacy

/**
 * Account deletion: each of the customer's reviews loses its name, text,
 * photos and the brand's reply; the star rating stays (anonymous) so the
 * averages don't jump. Returns photo rows whose stored image must be dropped.
 */
export async function scrubCustomerReviews(c, customerId) {
  const { rows } = await c.query('SELECT * FROM reviews WHERE customer_id = $1 AND scrubbed_at IS NULL ORDER BY id FOR UPDATE', [customerId])
  for (const r of rows) if (r.status === 'APPROVED') await countReview(c, r, -1)
  const pics = await c.query('SELECT blob_path FROM review_photos WHERE customer_id = $1 AND removed_at IS NULL FOR UPDATE', [customerId])
  await c.query('UPDATE review_photos SET removed_at = $2, bytes = NULL, blob_path = NULL WHERE customer_id = $1 AND removed_at IS NULL', [customerId, now()])
  await c.query('DELETE FROM review_replies WHERE review_id IN (SELECT id FROM reviews WHERE customer_id = $1)', [customerId])
  const { rows: after } = await c.query(
    `UPDATE reviews SET display_name = 'Anonymous', anonymous = TRUE, comment = NULL, scrubbed_at = $2
      WHERE customer_id = $1 AND scrubbed_at IS NULL RETURNING *`,
    [customerId, now()],
  )
  for (const r of after) if (r.status === 'APPROVED') await countReview(c, r, 1)
  return pics.rows
}

/** Ensures a review id belongs to the customer; anything else is "not found". */
export async function ownReview(c, id, customerId, { lock = false } = {}) {
  const { rows } = await c.query(`SELECT * FROM reviews WHERE id = $1 AND customer_id = $2 AND status <> 'DELETED' ${lock ? 'FOR UPDATE' : ''}`, [id, customerId])
  if (!rows.length) throw notFound('Review not found')
  return rows[0]
}

export const alreadyReviewed = () => conflict('You have already reviewed this item', 'ALREADY_REVIEWED')
