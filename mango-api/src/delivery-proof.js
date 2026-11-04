// Proof of delivery. When an order goes out for delivery it gets a 4-digit
// code (stored hashed: delivery-code.js), shown to the customer in the app and
// sent in its own WhatsApp message. The rider marks it delivered by typing the
// code the customer reads out, or, when nobody can give the code (left with
// security, at the door) and a manager allowed it for the order, with a photo
// and who received it. A missed delivery needs a reason. Every attempt is a row
// in delivery_attempts. Marking an order delivered from the panel without proof
// is a manager's override with a reason (orders.js setOrderStatus), recorded
// as "staff" and queued for a second person to check, like a photo.
//
// Rider app (docs/rider-app/README.md): every photo says which step it proves
// (pickup at the warehouse, door, open box, a missed attempt) with the phone's
// GPS and time. The box is picked up with a photo (pickupOrder), which is what
// sends it out for delivery. At the door the code is only accepted once the
// door photo and an open-box photo that passed the mango check (or was flagged
// for review) are in.
import { now, todayIST } from './clock.js'
import { codeMatches, deliveryCodeFor } from './delivery-code.js'
import { badRequest, conflict, HttpError, notFound } from './errors.js'
import { newId } from './ids.js'
import { decide, FAILS_BEFORE_CONTINUE, runCheck } from './mango-check.js'
import { addEvent, setOrderStatus } from './orders.js'
import { query, tx } from './db.js'
import { checkPhoto, cleanImage, dropPhoto, MAX_PHOTO_BYTES, photoBytes, storePhoto } from './photos.js'
import { productName } from './products.js'
import { STAGE_WORDS } from './ripeness.js'

export const FAIL_REASONS = ['NOT_HOME', 'WRONG_ADDRESS', 'REFUSED', 'UNREACHABLE', 'OTHER']
export const FAIL_LABEL = {
  NOT_HOME: 'Customer not home',
  WRONG_ADDRESS: 'Address not found',
  REFUSED: 'Customer refused the order',
  UNREACHABLE: 'Customer did not answer the phone',
  OTHER: 'Could not deliver',
}
/** Wrong codes before the order locks and the rider calls ops. */
export const MAX_CODE_TRIES = 3
export const PHOTO_STEPS = ['pickup', 'door', 'open_box', 'attempt']
/** Order states a pickup photo may be taken in: ready to go, or a retry going out again. */
const PICKUP_FROM = ['PACKED', 'SHIPPED', 'DELIVERY_FAILED', 'OUT_FOR_DELIVERY']
export { MAX_PHOTO_BYTES }

async function lockOrder(c, orderId) {
  const { rows } = await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])
  if (!rows.length) throw notFound('Order not found')
  return rows[0]
}

/**
 * Puts a packed order (or one retrying after a missed delivery) on the road.
 * Refused (409) when its packed stock is condemned or too old, or its
 * attempts are used up, unless a manager overrides (opts.override, opts.reason).
 */
export async function dispatchOrder(c, orderId, actor, opts = {}) {
  const o = await lockOrder(c, orderId)
  if (o.status === 'OUT_FOR_DELIVERY') return false
  if (!['PACKED', 'SHIPPED', 'DELIVERY_FAILED'].includes(o.status)) {
    const why = ['CONFIRMED', 'PROCESSING'].includes(o.status) ? 'is not packed yet' : `is ${o.status.toLowerCase().replace(/_/g, ' ')}`
    throw badRequest(`Order ${o.number} ${why}`, 'INVALID_TRANSITION')
  }
  if (o.status === 'PACKED') await setOrderStatus(c, orderId, 'SHIPPED', actor, opts)
  await setOrderStatus(c, orderId, 'OUT_FOR_DELIVERY', actor, opts)
  return true
}

const notOut = () => badRequest('Photos are taken while the order is out for delivery', 'INVALID_TRANSITION')
const notReady = () => badRequest('The pickup photo is taken when the order is packed and ready to go', 'INVALID_TRANSITION')

/** Whether a photo of this step may be taken in this order state. No step: the panel's older photo, while out for delivery. */
function stepAllowed(step, status) {
  if (step === 'pickup') return PICKUP_FROM.includes(status)
  return status === 'OUT_FOR_DELIVERY'
}

/** A finite number or null, from a header or body value. */
const num = (v) => {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * The photo's metadata from the phone: step, client id, GPS, shutter time.
 * Out-of-range values are dropped rather than refused: a bad GPS fix must not
 * stop a delivery. A shutter time in the future or over a day old is replaced by now.
 */
export function photoMeta(raw = {}) {
  const step = raw.step ?? null
  if (step !== null && !PHOTO_STEPS.includes(step)) throw badRequest(`step must be one of ${PHOTO_STEPS.join(', ')}`, 'INVALID_STEP')
  const clientId = raw.clientId ?? null
  if (clientId !== null && !/^[A-Za-z0-9_-]{8,64}$/.test(String(clientId))) throw badRequest('clientId must be 8 to 64 letters, digits, _ or -', 'INVALID_CLIENT_ID')
  let lat = num(raw.lat)
  let lng = num(raw.lng)
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) lat = lng = null
  const accuracy = num(raw.accuracy)
  let takenAt = raw.takenAt ? new Date(Number.isFinite(Number(raw.takenAt)) ? Number(raw.takenAt) : raw.takenAt) : null
  const at = now()
  if (!takenAt || Number.isNaN(takenAt.getTime()) || takenAt > new Date(at.getTime() + 5 * 60_000) || takenAt < new Date(at.getTime() - 86_400_000)) takenAt = at
  return {
    step, clientId: clientId === null ? null : String(clientId),
    lat: lat === null ? null : Math.round(lat * 1e6) / 1e6, lng: lng === null ? null : Math.round(lng * 1e6) / 1e6,
    accuracy: accuracy === null || accuracy < 0 ? null : Math.min(Math.round(accuracy * 10) / 10, 9_999_999), takenAt,
  }
}

async function photoByClientId(c, orderId, clientId) {
  if (!clientId) return null
  const { rows } = await c.query('SELECT id, step FROM delivery_photos WHERE order_id = $1 AND client_id = $2', [orderId, clientId])
  return rows[0] ?? null
}

/**
 * Stores a delivery photo. Returns { id, step, duplicate }.
 * meta: from photoMeta (step, clientId, GPS, takenAt); without a step it is the
 * panel's older photo, taken while out for delivery.
 * Idempotent by meta.clientId: a resend (the phone lost the answer) returns the
 * photo already stored.
 * OPS-26: the upload (Blob, no transaction) happens before the transaction
 * that locks the order, so a slow upload never holds the order lock or a
 * pooled connection. The short transaction re-checks the order and inserts
 * the row; if it fails, the uploaded file is deleted again.
 */
export async function savePhoto(orderId, bytes, actor, meta = {}) {
  const m = photoMeta(meta)
  const again = await photoByClientId({ query }, orderId, m.clientId)
  if (again) return { id: again.id, step: again.step, duplicate: true }
  checkPhoto(bytes)
  // SEC-13: re-encoded, so the phone's EXIF (GPS, device) and anything hidden in the file stay behind.
  // The GPS that matters comes from the app, read at the shutter, in its own columns.
  const { bytes: clean, mime, ext } = await cleanImage(bytes)
  const { rows } = await query('SELECT number, status FROM orders WHERE id = $1', [orderId])
  if (!rows.length) throw notFound('Order not found')
  if (!stepAllowed(m.step, rows[0].status)) throw m.step === 'pickup' ? notReady() : notOut()
  const id = newId('dph')
  const stored = await storePhoto(`delivery/${rows[0].number}`, id, clean, ext, mime)
  let result
  try {
    result = await tx(async (c) => {
      const o = await lockOrder(c, orderId)
      if (!stepAllowed(m.step, o.status)) throw m.step === 'pickup' ? notReady() : notOut()
      const dup = await photoByClientId(c, orderId, m.clientId)
      if (dup) return { id: dup.id, step: dup.step, duplicate: true }
      await c.query(
        `INSERT INTO delivery_photos (id, order_id, mime, bytes, blob_path, taken_by, created_at, step, lat, lng, accuracy, taken_at, attempt, client_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [id, orderId, mime, stored.bytes, stored.blobPath, actor.label ?? actor.id, now(), m.step, m.lat, m.lng, m.accuracy, m.takenAt ?? now(),
          o.delivery_failures + 1, m.clientId],
      )
      return { id, step: m.step, duplicate: false }
    })
  } catch (err) {
    if (stored.blobPath) await dropPhoto({ blob_path: stored.blobPath })
    throw err
  }
  if (result.duplicate && stored.blobPath) await dropPhoto({ blob_path: stored.blobPath })
  return result
}

// ---------------------------------------------------------------- pickup

/** The pickup photo for the order's current attempt, taken today (IST), or null. */
async function pickupPhoto(c, o) {
  const { rows } = await c.query(
    `SELECT id, created_at FROM delivery_photos WHERE order_id = $1 AND step = 'pickup' AND attempt = $2 AND removed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [o.id, o.delivery_failures + 1],
  )
  const p = rows[0]
  return p && todayIST(p.created_at) === todayIST() ? p : null
}

/**
 * The rider has the box: needs today's pickup photo for this attempt, then puts
 * the order out for delivery (which makes its code and queues the two WhatsApp
 * messages, notify.js). Packed orders are handed over (SHIPPED) on the way.
 * Idempotent: an order already out for delivery with its pickup photo answers
 * { already: true } and changes nothing.
 * Returns { already, eventId } (the OUT_FOR_DELIVERY event, whose messages the route sends now).
 */
export async function pickupOrder(c, orderId, actor) {
  const o = await lockOrder(c, orderId)
  const photo = await pickupPhoto(c, o)
  if (o.status === 'OUT_FOR_DELIVERY') {
    if (photo) return { already: true, eventId: await lastOutEvent(c, o.id) }
    // Sent out from the panel before the rider's photo: the photo is what was missing.
    throw badRequest('Take the pickup photo of the sealed box first', 'PICKUP_PHOTO_REQUIRED')
  }
  if (!['PACKED', 'SHIPPED', 'DELIVERY_FAILED'].includes(o.status)) {
    const why = ['CONFIRMED', 'PROCESSING'].includes(o.status) ? 'is not packed yet' : `is ${o.status.toLowerCase().replace(/_/g, ' ')}`
    throw badRequest(`Order ${o.number} ${why}`, 'INVALID_TRANSITION')
  }
  if (!photo) throw badRequest('Take the pickup photo of the sealed box first', 'PICKUP_PHOTO_REQUIRED')
  if (o.status === 'PACKED') await setOrderStatus(c, orderId, 'SHIPPED', actor)
  await setOrderStatus(c, orderId, 'OUT_FOR_DELIVERY', actor, { reason: null })
  return { already: false, eventId: await lastOutEvent(c, o.id) }
}

async function lastOutEvent(c, orderId) {
  const { rows } = await c.query(
    `SELECT id FROM order_events WHERE order_id = $1 AND status = 'OUT_FOR_DELIVERY' AND from_status IS DISTINCT FROM status ORDER BY created_at DESC, id DESC LIMIT 1`,
    [orderId],
  )
  return rows[0]?.id ?? null
}

// ---------------------------------------------------------------- mango check

/** "Alphonso 3kg Box (ripe), Kesar 3kg Box (raw)": what the model is told to expect. */
async function expectedContents(c, orderId) {
  const { rows } = await c.query('SELECT sku, stage, SUM(quantity)::int AS q FROM order_items WHERE order_id = $1 GROUP BY sku, stage ORDER BY sku', [orderId])
  if (!rows.length) return 'mangoes'
  return rows.map((r) => `${r.q} × ${productName(r.sku)} (${STAGE_WORDS[r.stage] ?? r.stage} mangoes)`).join(', ')
}

/** Failed checks recorded for the order's open-box step on this attempt. */
async function failedChecks(c, orderId, attempt) {
  const { rows } = await c.query(
    `SELECT COUNT(*)::int AS n FROM delivery_photos WHERE order_id = $1 AND step = 'open_box' AND attempt = $2 AND check_passed = FALSE`,
    [orderId, attempt],
  )
  return rows[0].n
}

const checkView = (p, extra = {}) => ({
  photoId: p.id, passed: Boolean(p.check_passed), needsReview: Boolean(p.needs_review), verdict: p.verdict ?? null, ...extra,
})

/**
 * Runs the mango check on an open-box photo and stores the verdict (mango-check.js).
 * With continueForReview, after two failed checks on this attempt, the photo is
 * accepted for a person to review instead. A photo already checked answers its
 * stored result (a resend). The model call runs outside any transaction.
 */
export async function checkPhotoForMangoes(orderId, photoId, { continueForReview = false } = {}) {
  const { rows } = await query('SELECT p.*, o.status, o.delivery_failures FROM delivery_photos p JOIN orders o ON o.id = p.order_id WHERE p.id = $1 AND p.order_id = $2', [photoId, orderId])
  const p = rows[0]
  if (!p) throw notFound('Photo not found')
  if (p.step !== 'open_box') throw badRequest('Only the open-box photo is checked', 'INVALID_STEP')
  if (p.status !== 'OUT_FOR_DELIVERY') throw notOut()
  const attempt = p.attempt ?? p.delivery_failures + 1
  if (continueForReview) {
    const fails = await failedChecks({ query }, orderId, attempt)
    if (fails < FAILS_BEFORE_CONTINUE) throw badRequest(`Retake the photo: you can continue for review after ${FAILS_BEFORE_CONTINUE} failed checks`, 'RETAKE_FIRST')
    await query('UPDATE delivery_photos SET needs_review = TRUE, checked_at = COALESCE(checked_at, $2) WHERE id = $1', [p.id, now()])
    return { passed: true, needsReview: true, failures: fails, canContinue: true, reason: 'Continued for review after the check failed twice', verdict: p.verdict, mode: p.verdict?.mode ?? null }
  }
  if (p.checked_at) {
    const fails = await failedChecks({ query }, orderId, attempt)
    return { ...checkView(p), passed: Boolean(p.check_passed) || p.needs_review, failures: fails, canContinue: fails >= FAILS_BEFORE_CONTINUE, reason: p.verdict?.reason ?? null, mode: p.verdict?.mode ?? null, already: true }
  }
  const failsBefore = await failedChecks({ query }, orderId, attempt)
  const run = await runCheck(await photoBytes(p), await expectedContents({ query }, orderId))
  const d = decide({ mode: run.mode, verdict: run.verdict, error: run.error, failsBefore })
  const stored = {
    mode: run.mode, ...(run.verdict ?? {}), ...(run.error ? { error: run.errorKind } : {}), ...(run.skipped ? { skipped: true } : {}),
    wouldPass: d.wouldPass, ms: run.ms, model: run.skipped ? null : 'claude-haiku-5-5',
  }
  await query('UPDATE delivery_photos SET verdict = $2, check_passed = $3, needs_review = $4, checked_at = $5 WHERE id = $1', [
    p.id, stored, d.passed && !d.needsReview ? true : d.passed ? null : false, d.needsReview, now(),
  ])
  const reason = run.error
    ? 'The check could not run. Carry on; the photo will be reviewed.'
    : run.verdict?.reason || (d.passed ? 'Looks good.' : 'This does not look like an open box of mangoes. Retake it.')
  return { passed: d.passed, needsReview: d.needsReview, failures: d.failures, canContinue: d.canContinue, reason, verdict: stored, mode: run.mode }
}

/** Photos of the current attempt, by step: what the rider app and the code check need. */
export async function proofSteps(c, o) {
  const { rows } = await c.query(
    `SELECT id, step, created_at, check_passed, needs_review, verdict, checked_at FROM delivery_photos
      WHERE order_id = $1 AND attempt = $2 AND step IS NOT NULL ORDER BY created_at`,
    [o.id, o.delivery_failures + 1],
  )
  const last = {}
  for (const r of rows) last[r.step] = r
  // The open-box step counts the best photo: one that passed, else one flagged for review, else the latest.
  const box = rows.filter((r) => r.step === 'open_box')
  if (box.length) last.open_box = box.find((r) => r.check_passed) ?? box.find((r) => r.needs_review) ?? box.at(-1)
  return last
}

/** Whether the door and open-box steps are done, so the code may be typed. */
export const codeUnlocked = (steps) => Boolean(steps.door && steps.open_box && (steps.open_box.check_passed || steps.open_box.needs_review))

export async function photo(c, orderId, photoId) {
  const { rows } = await c.query('SELECT mime, bytes, blob_path FROM delivery_photos WHERE id = $1 AND order_id = $2', [photoId, orderId])
  if (!rows.length) throw notFound('Photo not found')
  return rows[0]
}

async function insertAttempt(c, orderId, a, actor) {
  await c.query(
    `INSERT INTO delivery_attempts (id, order_id, outcome, method, received_by, reason, note, photo_id, lat, lng, actor, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [newId('dat'), orderId, a.outcome, a.method ?? null, a.receivedBy ?? null, a.reason ?? null, a.note ?? null, a.photoId ?? null,
      a.lat ?? null, a.lng ?? null, actor.label ?? actor.id, now()],
  )
}

/**
 * Records a delivery or a missed delivery with its proof and moves the order.
 * A wrong code is counted and returned (not thrown) so the count commits.
 */
export async function recordDelivery(c, orderId, input, actor) {
  const o = await lockOrder(c, orderId)
  if (o.status !== 'OUT_FOR_DELIVERY') {
    if (['DELIVERED', 'DELIVERY_FAILED'].includes(o.status)) throw conflict('This delivery was already recorded.')
    throw badRequest(`Order ${o.number} is not out for delivery`, 'INVALID_TRANSITION')
  }
  // ORD-4: a report for an earlier attempt (resent after the order went out again) must not count against this one.
  if (input.attempt !== undefined && input.attempt !== o.delivery_failures + 1) {
    throw conflict(`This report is for delivery attempt ${input.attempt}; the order is now on attempt ${o.delivery_failures + 1}.`, 'STALE_ATTEMPT')
  }
  if (input.photoId) {
    const { rows } = await c.query('SELECT 1 FROM delivery_photos WHERE id = $1 AND order_id = $2', [input.photoId, orderId])
    if (!rows.length) throw badRequest('That photo is not from this order', 'PHOTO_INVALID')
  }
  const where = { lat: input.lat ?? null, lng: input.lng ?? null }

  if (input.outcome === 'FAILED') {
    if (!FAIL_REASONS.includes(input.reason)) throw badRequest('Say why the delivery could not be made', 'REASON_REQUIRED')
    await insertAttempt(c, orderId, { outcome: 'FAILED', reason: input.reason, note: input.note, photoId: input.photoId, ...where }, actor)
    const reason = input.reason === 'OTHER' && input.note ? input.note : FAIL_LABEL[input.reason]
    await setOrderStatus(c, orderId, 'DELIVERY_FAILED', actor, { reason })
    return { outcome: 'FAILED' }
  }

  let method
  if (input.code) {
    if (o.delivery_code_tries >= MAX_CODE_TRIES) {
      throw new HttpError(429, 'CODE_LOCKED', 'Too many wrong codes. Call ops.')
    }
    // The customer gives the code once they have seen their mangoes: the door and open-box photos come first.
    if (!codeUnlocked(await proofSteps(c, o))) {
      throw conflict('Take the door photo and a photo of the open box first.', 'PROOF_STEPS_MISSING')
    }
    if (!codeMatches(o, input.code)) {
      const { rows } = await c.query('UPDATE orders SET delivery_code_tries = delivery_code_tries + 1 WHERE id = $1 RETURNING delivery_code_tries', [orderId])
      return { wrongCode: true, triesLeft: Math.max(0, MAX_CODE_TRIES - rows[0].delivery_code_tries) }
    }
    method = 'code'
  } else if (input.photoId) {
    // Left at the door or with someone: only when a manager allowed it for this order (or the customer said yes).
    if (!o.handover_override_at) {
      throw new HttpError(403, 'HANDOVER_NOT_ALLOWED', "Leaving the box without the code needs a manager's OK for this order. Call ops.")
    }
    if (!input.receivedBy?.trim()) throw badRequest('Say who took the order, or where it was left', 'RECEIVER_REQUIRED')
    method = 'photo'
  } else {
    throw badRequest("Enter the customer's code, or take a photo of the handover", 'PROOF_REQUIRED')
  }
  await insertAttempt(c, orderId, { outcome: 'DELIVERED', method, receivedBy: input.receivedBy?.trim() || null, note: input.note, photoId: input.photoId, ...where }, actor)
  await setOrderStatus(c, orderId, 'DELIVERED', actor, { proof: method })
  return { outcome: 'DELIVERED', method }
}

/** Staff moved the order from the panel: recorded as an attempt without proof, with the reason given. */
export async function recordStaffDelivery(c, orderId, status, actor, note = null) {
  if (status === 'DELIVERED') await insertAttempt(c, orderId, { outcome: 'DELIVERED', method: 'staff', note: note?.trim() || null }, actor)
  if (status === 'DELIVERY_FAILED') await insertAttempt(c, orderId, { outcome: 'FAILED', method: 'staff', reason: 'OTHER', note: note?.trim() || null }, actor)
}

const attemptView = (a) => ({
  id: a.id, outcome: a.outcome, method: a.method, receivedBy: a.received_by, reason: a.reason, reasonLabel: a.reason ? FAIL_LABEL[a.reason] : null,
  note: a.note, photoId: a.photo_id, lat: a.lat === null ? null : Number(a.lat), lng: a.lng === null ? null : Number(a.lng), actor: a.actor, at: a.created_at,
})

export async function attemptsFor(c, orderId) {
  const { rows } = await c.query('SELECT * FROM delivery_attempts WHERE order_id = $1 ORDER BY created_at, id', [orderId])
  return rows.map(attemptView)
}

/** "Ravi" from display_name "Ravi Kumar", else from the email ("ravi.k@…" → "Ravi"). */
export function riderFirstName(u) {
  const name = u?.display_name?.trim().split(/\s+/)[0]
  if (name) return name
  const local = String(u?.email ?? '').split('@')[0].split(/[._+-]/)[0]
  return local ? local[0].toUpperCase() + local.slice(1).toLowerCase() : 'your rider'
}

/** What the customer sees: the code while it's on the way (and the rider's first name), then how it was delivered. */
export async function customerDelivery(c, o) {
  const { rows } = await c.query(
    "SELECT * FROM delivery_attempts WHERE order_id = $1 AND outcome = 'DELIVERED' ORDER BY created_at DESC LIMIT 1",
    [o.id],
  )
  const d = rows[0]
  let rider = null
  if (o.status === 'OUT_FOR_DELIVERY' && o.rider_id) {
    const r = await c.query('SELECT display_name, email FROM admin_users WHERE id = $1', [o.rider_id])
    if (r.rows[0]) rider = { firstName: riderFirstName(r.rows[0]) }
  }
  return {
    deliveryCode: o.status === 'OUT_FOR_DELIVERY' ? deliveryCodeFor(o) : null,
    rider,
    delivery: d && o.status === 'DELIVERED' ? { at: d.created_at, method: d.method, receivedBy: d.received_by, hasPhoto: Boolean(d.photo_id) } : null,
  }
}

export async function customerPhoto(c, o) {
  const { rows } = await c.query(
    `SELECT p.mime, p.bytes, p.blob_path FROM delivery_attempts a JOIN delivery_photos p ON p.id = a.photo_id
      WHERE a.order_id = $1 AND a.outcome = 'DELIVERED' ORDER BY a.created_at DESC LIMIT 1`,
    [o.id],
  )
  if (!rows.length || o.status !== 'DELIVERED') throw notFound('No delivery photo for this order')
  return rows[0]
}

/**
 * Deliveries proven only by a photo, marked delivered by a manager with no
 * proof at all ("staff"), or delivered with the code after an open-box photo
 * the mango check could not pass (needs review), not yet checked by someone
 * else. A photo after wrong codes, or with no location, is flagged: those are
 * how a delivery would be faked.
 */
export async function photoReviews(c, limit = 50) {
  const { rows } = await c.query(
    `SELECT a.*, o.number, o.delivery_code_tries, o.customer_name, o.gift_recipient_name,
            (SELECT p.verdict FROM delivery_photos p WHERE p.order_id = a.order_id AND p.step = 'open_box' AND p.needs_review
              AND p.created_at <= a.created_at ORDER BY p.created_at DESC LIMIT 1) AS review_verdict,
            (SELECT p.id FROM delivery_photos p WHERE p.order_id = a.order_id AND p.step = 'open_box' AND p.needs_review
              AND p.created_at <= a.created_at ORDER BY p.created_at DESC LIMIT 1) AS review_photo_id
       FROM delivery_attempts a JOIN orders o ON o.id = a.order_id
      WHERE a.outcome = 'DELIVERED' AND a.reviewed_at IS NULL
        AND (a.method IN ('photo', 'staff') OR (a.method = 'code' AND ${NEEDS_REVIEW_SQL}))
      ORDER BY a.created_at LIMIT $1`,
    [limit],
  )
  return rows.map((a) => ({
    ...attemptView(a),
    // The open-box photo the check could not pass: the reviewer looks at it.
    photoId: a.photo_id ?? a.review_photo_id ?? null,
    order: { id: a.order_id, number: a.number, name: a.gift_recipient_name ?? a.customer_name },
    flags: [
      ...(a.method === 'staff' ? ['no proof: marked delivered from the panel'] : []),
      ...(a.review_photo_id ? [`mango check: needs review${a.review_verdict?.reason ? ` (${a.review_verdict.reason})` : ''}`] : []),
      ...(a.delivery_code_tries > 0 ? [`${a.delivery_code_tries} wrong code${a.delivery_code_tries === 1 ? '' : 's'} first`] : []),
      ...(a.lat === null && a.method === 'photo' ? ['no location'] : []),
    ],
  }))
}

/** A code delivery whose open-box photo was flagged for review (the check failed twice, or could not run). */
const NEEDS_REVIEW_SQL = `EXISTS (SELECT 1 FROM delivery_photos p WHERE p.order_id = a.order_id AND p.step = 'open_box' AND p.needs_review AND p.created_at <= a.created_at)`

/** Marks a photo delivery checked. A doubtful one goes on the order's history for follow-up. */
export async function reviewDelivery(c, attemptId, { ok, note }, actor) {
  const { rows } = await c.query(
    `SELECT a.*, o.status, ${NEEDS_REVIEW_SQL} AS flagged FROM delivery_attempts a JOIN orders o ON o.id = a.order_id WHERE a.id = $1 FOR UPDATE OF a`,
    [attemptId],
  )
  const a = rows[0]
  const reviewable = a && (['photo', 'staff'].includes(a.method) || (a.method === 'code' && a.flagged))
  if (!reviewable || a.outcome !== 'DELIVERED') throw notFound('Photo delivery not found')
  if (a.reviewed_at) throw conflict('This delivery was already checked.')
  if (a.actor === (actor.label ?? actor.id)) throw new HttpError(403, 'FORBIDDEN', 'Someone other than the rider has to check this delivery.')
  if (!ok && !note?.trim()) throw badRequest('Say what looks wrong', 'NOTE_REQUIRED')
  await c.query('UPDATE delivery_attempts SET reviewed_at = $2, reviewed_by = $3, review_note = $4 WHERE id = $1', [
    a.id, now(), actor.label ?? actor.id, ok ? note?.trim() || null : `Doubtful: ${note.trim()}`,
  ])
  if (!ok) {
    await addEvent(c, a.order_id, a.status, a.status, actor, `Delivery photo doubted: ${note.trim()}. Call the customer.`)
  }
}
