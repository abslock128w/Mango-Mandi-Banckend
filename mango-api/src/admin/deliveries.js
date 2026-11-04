// Deliveries: the rider manifest, dispatch, rider assignment, proof of delivery.
import express from 'express'
import { z } from 'zod'
import { isPacker, redactForPacker, RIDER_TAKES } from '../access.js'
import { requireManager } from '../auth.js'
import { addDays, isDate, now, todayIST } from '../clock.js'
import { blobUploadsOn, deleteUpload, DELIVERY_UPLOAD_PREFIX, deliveryUploadToken, readUpload, sendPhoto } from '../photos.js'
import {
  checkPhotoForMangoes, codeUnlocked, dispatchOrder, FAIL_REASONS, MAX_CODE_TRIES, MAX_PHOTO_BYTES, photo, photoMeta, photoReviews, pickupOrder, PHOTO_STEPS,
  proofSteps, recordDelivery, reviewDelivery, riderFirstName, savePhoto,
} from '../delivery-proof.js'
import { query, tx } from '../db.js'
import { env } from '../env.js'
import { notify } from '../events.js'
import { asyncHandler, badRequest, HttpError, notFound, parse } from '../errors.js'
import { newId } from '../ids.js'
import { addEvent } from '../orders.js'
import { assignNearest } from '../nearest.js'
import { logger } from '../logger.js'
import { messageStates, messageView, sendNotificationsNow } from '../notify.js'
import { productName } from '../products.js'
import { ROUTE_ORDER } from '../route.js'

export const router = express.Router()

// ---------------------------------------------------------------- rider manifest

const MANIFEST_STATUSES = ['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'DELIVERED']

/**
 * The delivery run for a date: slots in order, then stops grouped by zone and
 * pincode, each with the address, phone and boxes. Every order is prepaid, so
 * riders collect nothing. Orders not packed yet are flagged.
 */
router.get(
  '/manifest',
  asyncHandler(async (req, res) => {
    const date = req.query.date ? parse(z.string().refine(isDate, 'date must be YYYY-MM-DD'), req.query.date) : addDays(todayIST(), 1)
    const rider = req.admin.role === 'RIDER'
    // SEC-02: a rider sees only their own stops, and no delivered ones from before today.
    const statuses = isPacker(req) || (rider && date < todayIST()) ? MANIFEST_STATUSES.filter((s) => s !== 'DELIVERED') : MANIFEST_STATUSES
    const { rows: orders } = await query(
      `SELECT o.id, o.number, o.customer_name, o.phone, o.pincode, o.delivery_address, o.status, o.slot_id, o.delivery_failures,
              o.gift_recipient_name, o.gift_recipient_phone, o.gift_message, o.rider_id, r.email AS rider_email, r.display_name AS rider_name,
              o.delivery_code_tries, o.handover_override_at,
              w.id AS wh_id, w.name AS wh_name, w.address AS wh_address, w.lat AS wh_lat, w.lng AS wh_lng,
              s.label AS slot_label, s.starts_at, s.ends_at, p.city, p.zone
         FROM orders o LEFT JOIN delivery_slots s ON s.id = o.slot_id LEFT JOIN pincodes p ON p.pincode = o.pincode
         LEFT JOIN admin_users r ON r.id = o.rider_id LEFT JOIN warehouses w ON w.id = o.pickup_warehouse_id
        WHERE o.delivery_date = $1 AND o.status = ANY($2) ${rider ? 'AND o.rider_id = $3' : ''}
        ORDER BY ${ROUTE_ORDER}`,
      rider ? [date, statuses, req.admin.id] : [date, statuses],
    )
    // Packed stops nobody has yet: a rider can take them by starting the run (they see only how many).
    const unassigned = rider
      ? (await query('SELECT COUNT(*)::int AS n FROM orders WHERE delivery_date = $1 AND rider_id IS NULL AND status = ANY($2)', [date, RIDER_TAKES])).rows[0].n
      : undefined
    const { rows: items } = await query(
      'SELECT order_id, sku, stage, SUM(quantity)::int AS quantity FROM order_items WHERE order_id = ANY($1) GROUP BY order_id, sku, stage ORDER BY sku, stage',
      [orders.map((o) => o.id)],
    )
    const proof = await proofFor(orders)
    const runs = []
    for (const o of orders) {
      let run = runs.at(-1)
      if (!run || run.key !== (o.slot_id ?? null)) {
        run = {
          key: o.slot_id ?? null,
          slot: o.slot_id ? { id: o.slot_id, label: o.slot_label, startsAt: String(o.starts_at).slice(0, 5), endsAt: String(o.ends_at).slice(0, 5) } : null,
          stops: [],
          orders: 0,
          boxes: 0,
        }
        runs.push(run)
      }
      let stop = run.stops.at(-1)
      if (!stop || stop.pincode !== o.pincode) {
        stop = { pincode: o.pincode, city: o.city ?? null, zone: o.zone ?? null, orders: [] }
        run.stops.push(stop)
      }
      const lines = items.filter((i) => i.order_id === o.id)
      const boxes = lines.reduce((n, i) => n + i.quantity, 0)
      const entry = {
        // A gift goes to the recipient: the rider sees and calls them.
        id: o.id, number: o.number, status: o.status, deliveryAddress: o.delivery_address,
        customerName: o.gift_recipient_name ?? o.customer_name, phone: o.gift_recipient_phone ?? o.phone,
        gift: o.gift_recipient_name ? { from: o.customer_name, message: o.gift_message } : null,
        packed: !['CONFIRMED', 'PROCESSING'].includes(o.status), boxes,
        rider: o.rider_id ? { id: o.rider_id, email: o.rider_email ?? null, name: o.rider_name ?? null, firstName: riderFirstName({ display_name: o.rider_name, email: o.rider_email }) } : null,
        // Rider app: the photos of this attempt by step, and where the code stands.
        ...proof.get(o.id),
        // Where the rider collects it (set by the nearest-rider assignment, nearest.js).
        pickupWarehouse: o.wh_id
          ? { id: o.wh_id, name: o.wh_name, address: o.wh_address ?? null, lat: o.wh_lat === null ? null : Number(o.wh_lat), lng: o.wh_lng === null ? null : Number(o.wh_lng) }
          : null,
        // Sent back with the delivery report, so a late resend for an earlier attempt is refused.
        attempt: o.delivery_failures + 1,
        items: lines.map((i) => ({ sku: i.sku, productName: productName(i.sku), stage: i.stage, quantity: i.quantity })),
      }
      stop.orders.push(isPacker(req) ? redactForPacker(entry) : entry)
      run.orders++
      run.boxes += boxes
    }
    res.json({
      date,
      orders: orders.length,
      boxes: runs.reduce((n, r) => n + r.boxes, 0),
      ...(rider ? { unassigned } : {}),
      runs: runs.map(({ key, ...r }) => r),
    })
  }),
)

// ---------------------------------------------------------------- proof of delivery

/** Start a run: every packed order on the date (one slot, or all) goes out for delivery. */
router.post(
  '/manifest/dispatch',
  asyncHandler(async (req, res) => {
    const b = parse(
      z.object({ date: z.string().refine(isDate, 'date must be YYYY-MM-DD'), slotId: z.string().nullable().optional(), riderId: z.string().max(40).optional() }),
      req.body,
    )
    const rider = req.admin.role === 'RIDER'
    // Staff may hand the run to a rider as it goes out; a rider takes the stops nobody has yet.
    if (b.riderId && rider) throw new HttpError(403, 'FORBIDDEN', 'Riders take stops by starting the run')
    if (b.riderId) await riderOrThrow(b.riderId)
    const params = [b.date]
    let slotFilter = ''
    if (b.slotId === null) slotFilter = 'AND slot_id IS NULL'
    else if (b.slotId) {
      params.push(b.slotId)
      slotFilter = `AND slot_id = $${params.length}`
    }
    if (rider) {
      params.push(req.admin.id)
      slotFilter += ` AND (rider_id = $${params.length} OR (rider_id IS NULL AND status IN ('PACKED', 'SHIPPED', 'DELIVERY_FAILED')))`
    }
    const { rows } = await query(
      `SELECT id, number, status FROM orders WHERE delivery_date = $1 ${slotFilter}
          AND status IN ('CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERY_FAILED') ORDER BY number`,
      params,
    )
    const assignTo = rider ? req.admin.id : (b.riderId ?? null)
    const dispatched = []
    const skipped = []
    for (const o of rows) {
      if (['CONFIRMED', 'PROCESSING'].includes(o.status)) {
        skipped.push({ number: o.number, reason: 'Not packed yet' })
        continue
      }
      try {
        const sent = await tx(async (c) => {
          if (assignTo) await assignRider(c, o.id, assignTo, { onlyIfFree: rider })
          return dispatchOrder(c, o.id, req.actor)
        })
        if (sent) dispatched.push(o.number)
      } catch (err) {
        skipped.push({ number: o.number, reason: err.message })
      }
    }
    res.json({ dispatched, skipped })
  }),
)

router.post(
  '/orders/:id/dispatch',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ override: z.boolean().optional(), reason: z.string().trim().max(300).optional() }), req.body ?? {})
    if (b.override && req.admin.role !== 'MANAGER') throw new HttpError(403, 'FORBIDDEN', 'Only a manager can override this')
    if (b.override && !b.reason) throw badRequest('Say why it is going out anyway', 'REASON_REQUIRED')
    await tx(async (c) => {
      // A rider sending out an unassigned stop takes it (riderScope let them reach it for this).
      if (req.admin.role === 'RIDER') await assignRider(c, req.params.id, req.admin.id, { onlyIfFree: true })
      return dispatchOrder(c, req.params.id, req.actor, { override: Boolean(b.override), reason: b.reason })
    })
    res.status(204).end()
  }),
)

// ---------------------------------------------------------------- rider assignment (SEC-02)

/** Riders, for the Deliveries page's assign control. */
router.get(
  '/riders',
  asyncHandler(async (_req, res) =>
    res.json((await query("SELECT id, email, display_name AS name FROM admin_users WHERE role = 'RIDER' ORDER BY display_name NULLS LAST, email")).rows)),
)

async function riderOrThrow(id) {
  const { rows } = await query("SELECT id FROM admin_users WHERE id = $1 AND role = 'RIDER'", [id])
  if (!rows.length) throw badRequest('Pick a rider', 'NOT_A_RIDER')
}

/**
 * Gives the order to a rider (null: to nobody). With onlyIfFree (a rider
 * taking a stop) it must be unassigned or theirs already; another rider's
 * stop answers 404, as riderScope does.
 */
async function assignRider(c, orderId, riderId, { onlyIfFree = false } = {}) {
  const r = await c.query(`UPDATE orders SET rider_id = $2 WHERE id = $1 ${onlyIfFree ? 'AND (rider_id IS NULL OR rider_id = $2)' : ''} RETURNING id`, [orderId, riderId])
  if (!r.rowCount) throw notFound('Order not found')
}

/**
 * Assigns stops to a rider: the listed orders, or every order still to
 * deliver on the date (one slot, or all). riderId null takes them off anyone.
 */
router.post(
  '/manifest/assign',
  asyncHandler(async (req, res) => {
    const b = parse(
      z.object({
        date: z.string().refine(isDate, 'date must be YYYY-MM-DD'),
        slotId: z.string().nullable().optional(),
        orderIds: z.array(z.string().max(40)).min(1).max(500).optional(),
        riderId: z.string().max(40).nullable(),
      }),
      req.body,
    )
    if (b.riderId) await riderOrThrow(b.riderId)
    const params = [b.date, b.riderId, MANIFEST_STATUSES.filter((s) => s !== 'DELIVERED')]
    let filter = ''
    if (b.slotId === null) filter += ' AND slot_id IS NULL'
    else if (b.slotId) {
      params.push(b.slotId)
      filter += ` AND slot_id = $${params.length}`
    }
    if (b.orderIds) {
      params.push(b.orderIds)
      filter += ` AND id = ANY($${params.length})`
    }
    const { rows } = await query(`UPDATE orders SET rider_id = $2 WHERE delivery_date = $1 AND status = ANY($3) ${filter} RETURNING number`, params)
    res.json({ assigned: rows.map((r) => r.number).sort() })
  }),
)

/** The photo is the raw request body (Content-Type image/jpeg, png or webp). */
router.post(
  '/orders/:id/delivery-photos',
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_PHOTO_BYTES, inflate: false }),
  asyncHandler(async (req, res) => {
    const { id } = await savePhoto(req.params.id, req.body, req.actor) // uploads first, then a short transaction (OPS-26)
    res.status(201).json({ id })
  }),
)

router.get(
  '/orders/:id/delivery-photos/:photoId',
  asyncHandler(async (req, res) => {
    await sendPhoto(res, await photo({ query }, req.params.id, req.params.photoId))
  }),
)

router.post(
  '/orders/:id/delivery',
  asyncHandler(async (req, res) => {
    const b = parse(
      z.object({
        outcome: z.enum(['DELIVERED', 'FAILED']),
        code: z.string().regex(/^\d{4}$/, 'The code is 4 digits').optional(),
        photoId: z.string().max(40).optional(),
        receivedBy: z.string().trim().max(80).optional(),
        reason: z.enum(FAIL_REASONS).optional(),
        note: z.string().trim().max(300).optional(),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        // Which delivery attempt this report is for (the manifest's attempt): a late resend after a re-dispatch is refused.
        attempt: z.number().int().min(1).max(100).optional(),
      }),
      req.body,
    )
    // OPS-02: a missed-delivery report must say which attempt it is for, so a late resend can't count twice.
    if (b.outcome === 'FAILED' && b.attempt === undefined) throw badRequest('Say which delivery attempt this report is for', 'ATTEMPT_REQUIRED')
    const r = await tx((c) => recordDelivery(c, req.params.id, b, req.actor))
    if (r.wrongCode) {
      throw new HttpError(422, 'WRONG_CODE', r.triesLeft ? `That code is not right. ${r.triesLeft} ${r.triesLeft === 1 ? 'try' : 'tries'} left.` : 'That code is not right. The order is locked: call ops.', { triesLeft: r.triesLeft })
    }
    // The customer hears now, not at the next outbox pass (daily on Vercel); a failure stays queued for its retry.
    await sendOutcomeNow(req.params.id)
    res.json(r)
  }),
)

// ---------------------------------------------------------------- rider app: photos, pickup, mango check

const stepView = (p) => (p ? {
  id: p.id, at: p.created_at, passed: p.check_passed === null || p.check_passed === undefined ? null : Boolean(p.check_passed),
  needsReview: Boolean(p.needs_review), verdict: p.verdict ?? null, checked: Boolean(p.checked_at),
} : null)

/** Per order: { pickup, proof, codeTriesLeft, codeLocked, codeUnlocked, leaveAtDoorAllowed } for the manifest. */
async function proofFor(orders) {
  const out = new Map()
  for (const o of orders) {
    const steps = await proofSteps({ query }, o)
    out.set(o.id, {
      pickup: steps.pickup ? { photoId: steps.pickup.id, at: steps.pickup.created_at } : null,
      proof: Object.fromEntries(PHOTO_STEPS.filter((k) => steps[k]).map((k) => [k, stepView(steps[k])])),
      codeTriesLeft: Math.max(0, MAX_CODE_TRIES - (o.delivery_code_tries ?? 0)),
      codeLocked: (o.delivery_code_tries ?? 0) >= MAX_CODE_TRIES,
      codeUnlocked: codeUnlocked(steps),
      leaveAtDoorAllowed: Boolean(o.handover_override_at),
    })
  }
  return out
}

const metaBody = z.object({
  step: z.enum(PHOTO_STEPS),
  clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'clientId must be 8 to 64 letters, digits, _ or -'),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  accuracy: z.number().nullable().optional(),
  takenAt: z.union([z.number(), z.string().max(40)]).optional(),
})

/** Where Blob reports a finished upload: BLOB_CALLBACK_URL, else this API's own address. */
const callbackUrl = (req) => env.BLOB_CALLBACK_URL || `${req.protocol}://${req.get('host')}/webhooks/blob/delivery-photos`
const uploadPath = (orderId, clientId) => `${DELIVERY_UPLOAD_PREFIX}${orderId}/${clientId}.jpg`

/**
 * Where the rider's phone sends a photo. With Vercel Blob: a 10-minute token
 * for one private path (JPEG, 2 MB), whose completion Blob reports to
 * /webhooks/blob/delivery-photos with the order, step and GPS; otherwise
 * { mode: 'direct' }: post the JPEG to /orders/:id/photos.
 */
router.post(
  '/orders/:id/photos/token',
  asyncHandler(async (req, res) => {
    const b = parse(metaBody, req.body)
    if (!blobUploadsOn()) return res.json({ mode: 'direct', maxBytes: MAX_PHOTO_BYTES })
    const pathname = uploadPath(req.params.id, b.clientId)
    const payload = JSON.stringify({ orderId: req.params.id, ...b, actor: { id: req.actor.id, label: req.actor.label } })
    res.json({ mode: 'blob', pathname, clientToken: await deliveryUploadToken(pathname, payload, callbackUrl(req)), maxBytes: MAX_PHOTO_BYTES })
  }),
)

/**
 * Stores a rider photo of a delivery step: the JPEG as the body (headers
 * X-Step, X-Client-Id, X-Lat, X-Lng, X-Accuracy, X-Taken-At), or JSON
 * { pathname, step, clientId, lat, lng, accuracy, takenAt } after a Blob upload.
 * Idempotent by clientId. Returns { id, step, duplicate }.
 */
router.post(
  '/orders/:id/photos',
  express.raw({ type: ['image/jpeg'], limit: MAX_PHOTO_BYTES, inflate: false }),
  asyncHandler(async (req, res) => {
    if (Buffer.isBuffer(req.body)) {
      const meta = parse(metaBody, {
        step: req.get('x-step'), clientId: req.get('x-client-id'),
        lat: num(req.get('x-lat')), lng: num(req.get('x-lng')), accuracy: num(req.get('x-accuracy')), takenAt: num(req.get('x-taken-at')) ?? undefined,
      })
      const r = await savePhoto(req.params.id, req.body, req.actor, meta)
      return res.status(r.duplicate ? 200 : 201).json(r)
    }
    const b = parse(metaBody.extend({ pathname: z.string().max(200) }), req.body)
    const r = await finishUpload(req.params.id, b.pathname, b, req.actor)
    res.status(r.duplicate ? 200 : 201).json(r)
  }),
)

const num = (v) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * A Blob upload becomes a delivery photo: read, checked, re-encoded and stored
 * like a posted one, then the upload (with its EXIF) is deleted. Called by the
 * phone and by Blob's completion callback; whichever comes second finds the
 * photo by its client id.
 */
export async function finishUpload(orderId, pathname, meta, actor) {
  if (pathname !== uploadPath(orderId, meta.clientId)) throw notFound('Upload not found')
  const { rows } = await query('SELECT id, step FROM delivery_photos WHERE order_id = $1 AND client_id = $2', [orderId, meta.clientId])
  if (rows.length) return { id: rows[0].id, step: rows[0].step, duplicate: true }
  const bytes = await readUpload(pathname)
  if (!bytes) throw notFound('Upload not found')
  try {
    return await savePhoto(orderId, bytes, actor, photoMeta(meta))
  } finally {
    await deleteUpload(pathname)
  }
}

/**
 * The rider has the sealed box: with today's pickup photo, the order goes out
 * for delivery and the customer's two WhatsApp messages (the update, and the
 * code in its own authentication message) are sent at once; a failure stays in
 * the outbox for its retry. Idempotent: a second call changes nothing and
 * answers the messages' state. A rider picking up an unassigned stop takes it.
 */
router.post(
  '/orders/:id/pickup',
  asyncHandler(async (req, res) => {
    parse(z.object({ clientId: z.string().max(64).optional() }), req.body ?? {})
    const r = await tx(async (c) => {
      if (req.admin.role === 'RIDER') await assignRider(c, req.params.id, req.admin.id, { onlyIfFree: true })
      return pickupOrder(c, req.params.id, req.actor)
    })
    const ids = r.eventId ? (await query('SELECT id FROM notifications WHERE event_id = $1', [r.eventId])).rows.map((x) => x.id) : []
    const messages = r.already ? await messageStates(ids) : await sendNotificationsNow(ids)
    res.json({ status: 'OUT_FOR_DELIVERY', already: r.already, messages })
  }),
)

/**
 * The mango check on an open-box photo (mango-check.js). With
 * { continueForReview: true } after two failed checks, the rider carries on and
 * the delivery is flagged for review.
 */
router.post(
  '/orders/:id/photos/:photoId/check',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ continueForReview: z.boolean().optional() }), req.body ?? {})
    res.json(await checkPhotoForMangoes(req.params.id, req.params.photoId, b))
  }),
)

/**
 * A manager lets the rider leave this order without the code (at the door,
 * with security), with a photo and who took it, saying why: the customer asked
 * on the phone, or said yes on WhatsApp. Recorded on the order's history.
 */
router.post(
  '/orders/:id/handover-override',
  requireManager,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body)
    await tx(async (c) => {
      const { rows } = await c.query("SELECT status FROM orders WHERE id = $1 FOR UPDATE", [req.params.id])
      if (!rows.length) throw notFound('Order not found')
      if (rows[0].status !== 'OUT_FOR_DELIVERY') throw badRequest('Only an order out for delivery can be left without the code', 'INVALID_TRANSITION')
      await c.query('UPDATE orders SET handover_override_by = $2, handover_override_at = $3, handover_override_reason = $4 WHERE id = $1', [
        req.params.id, req.actor.label ?? req.actor.id, now(), b.reason,
      ])
      await addEvent(c, req.params.id, 'OUT_FOR_DELIVERY', 'OUT_FOR_DELIVERY', req.actor, `May be left without the code: ${b.reason}`)
    })
    res.status(204).end()
  }),
)

// ---------------------------------------------------------------- live view for the panel

/** Kinds of message the Deliveries page shows per stop. */
const LIVE_KINDS = ['OUT_FOR_DELIVERY', 'DELIVERY_CODE', 'GIFT_OUT_FOR_DELIVERY', 'GIFT_DELIVERY_CODE', 'DELIVERED', 'DELIVERY_FAILED']

/**
 * The day's stops as they change, for the Deliveries page (polled every 10 s):
 * each stop's photos with GPS, time and mango verdict, its WhatsApp messages
 * with Meta's delivery report, whether it needs review, and every rider's last
 * position. `since` (the last answer's cursor) lists what changed after it:
 * stops picked up, delivered or missed (the Today page's toasts).
 */
router.get(
  '/deliveries/live',
  asyncHandler(async (req, res) => {
    const date = req.query.date ? parse(z.string().refine(isDate, 'date must be YYYY-MM-DD'), req.query.date) : todayIST()
    const since = req.query.since ? new Date(String(req.query.since)) : null
    if (since && Number.isNaN(since.getTime())) throw badRequest('since must be a time from an earlier answer', 'INVALID_CURSOR')
    const cursor = now()
    const { rows: orders } = await query(
      `SELECT o.id, o.number, o.status, o.delivery_failures, o.delivery_code_tries, o.rider_id, o.pincode, o.handover_override_at,
              (SELECT name FROM warehouses w WHERE w.id = o.pickup_warehouse_id) AS pickup_warehouse,
              COALESCE(o.gift_recipient_name, o.customer_name) AS customer_name, r.display_name AS rider_name, r.email AS rider_email
         FROM orders o LEFT JOIN admin_users r ON r.id = o.rider_id
        WHERE o.delivery_date = $1 AND o.status = ANY($2) ORDER BY o.number`,
      [date, MANIFEST_STATUSES],
    )
    const ids = orders.map((o) => o.id)
    const [photos, messages, reviews, events] = await Promise.all([
      query(
        `SELECT id, order_id, step, attempt, lat, lng, accuracy, taken_at, created_at, verdict, check_passed, needs_review, checked_at, removed_at
           FROM delivery_photos WHERE order_id = ANY($1) AND step IS NOT NULL ORDER BY created_at`,
        [ids],
      ),
      query(`SELECT * FROM notifications WHERE order_id = ANY($1) AND kind = ANY($2) ORDER BY created_at, kind`, [ids, LIVE_KINDS]),
      photoReviews({ query }, 500),
      since
        ? query(
            `SELECT e.order_id, e.status AS to_status, e.created_at, o.number FROM order_events e JOIN orders o ON o.id = e.order_id
              WHERE e.order_id = ANY($1) AND e.created_at > $2 AND e.from_status IS DISTINCT FROM e.status ORDER BY e.created_at`,
            [ids, since],
          )
        : { rows: [] },
    ])
    const reviewByOrder = new Map(reviews.map((r) => [r.order.id, r]))
    const changed = new Set(events.rows.map((e) => e.order_id))
    if (since) for (const p of photos.rows) if (p.created_at > since || (p.checked_at && p.checked_at > since)) changed.add(p.order_id)
    const stops = orders.map((o) => {
      const mine = photos.rows.filter((p) => p.order_id === o.id && p.attempt === o.delivery_failures + 1)
      const review = reviewByOrder.get(o.id)
      return {
        id: o.id, number: o.number, status: o.status, pincode: o.pincode, customerName: o.customer_name,
        rider: o.rider_id ? { id: o.rider_id, firstName: riderFirstName({ display_name: o.rider_name, email: o.rider_email }) } : null,
        pickupWarehouse: o.pickup_warehouse ?? null,
        photos: mine.map((p) => ({
          id: p.id, step: p.step, at: p.created_at, takenAt: p.taken_at, removed: Boolean(p.removed_at),
          lat: p.lat === null ? null : Number(p.lat), lng: p.lng === null ? null : Number(p.lng), accuracy: p.accuracy === null ? null : Number(p.accuracy),
          passed: p.check_passed, needsReview: p.needs_review, verdict: p.verdict,
        })),
        messages: messages.rows.filter((m) => m.order_id === o.id).map(messageView),
        codeTries: o.delivery_code_tries, codeLocked: o.delivery_code_tries >= MAX_CODE_TRIES, leaveAtDoorAllowed: Boolean(o.handover_override_at),
        needsReview: mine.some((p) => p.needs_review) || Boolean(review),
        reviewAttemptId: review?.id ?? null,
      }
    })
    const riderIds = [...new Set(orders.map((o) => o.rider_id).filter(Boolean))]
    const { rows: spots } = await query(
      `SELECT DISTINCT ON (l.rider_id) l.rider_id, l.lat, l.lng, l.accuracy, l.at, u.display_name, u.email
         FROM rider_locations l JOIN admin_users u ON u.id = l.rider_id WHERE l.rider_id = ANY($1) ORDER BY l.rider_id, l.at DESC`,
      [riderIds],
    )
    res.json({
      date,
      cursor: cursor.toISOString(),
      changed: [...changed],
      events: events.rows.map((e) => ({ orderId: e.order_id, number: e.number, status: e.to_status, at: e.created_at })),
      stops,
      riders: spots.map((l) => ({
        id: l.rider_id, firstName: riderFirstName(l), lat: Number(l.lat), lng: Number(l.lng), accuracy: l.accuracy === null ? null : Number(l.accuracy), at: l.at,
      })),
    })
  }),
)

/** Where the rider is, while a run is on: one row per 20 seconds at most (more often is dropped, not refused). */
const LOCATION_EVERY_MS = 20_000
router.post(
  '/rider/location',
  asyncHandler(async (req, res) => {
    const b = parse(
      z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100_000).nullable().optional(), at: z.number().optional() }),
      req.body,
    )
    const at = now()
    const r = await query(
      `INSERT INTO rider_locations (id, rider_id, lat, lng, accuracy, at)
       SELECT $1, $2, $3, $4, $5, $6
        WHERE NOT EXISTS (SELECT 1 FROM rider_locations WHERE rider_id = $2 AND at > $7)`,
      [newId('loc'), req.admin.id, Math.round(b.lat * 1e6) / 1e6, Math.round(b.lng * 1e6) / 1e6, b.accuracy ?? null, at, new Date(at.getTime() - LOCATION_EVERY_MS)],
    )
    // Mango Ops v2: the panel's map moves the rider's dot (events.js); a dropped repeat says nothing.
    if (r.rowCount === 1) await notify({ query }, 'rider.position', { riderId: req.admin.id, at: at.toISOString() })
    res.json({ stored: r.rowCount === 1 })
  }),
)

/**
 * Sends the "delivered" message just queued for this order. Never fails the request.
 * A missed delivery's message keeps going through the outbox: it may be held for staff
 * (no retry day, attempts used up) and its wording depends on that.
 */
async function sendOutcomeNow(orderId) {
  try {
    const { rows } = await query(
      `SELECT id FROM notifications WHERE order_id = $1 AND kind = 'DELIVERED' AND status = 'PENDING' AND next_attempt_at <= $2`,
      [orderId, now()],
    )
    if (rows.length) await sendNotificationsNow(rows.map((r) => r.id))
  } catch (err) {
    logger.warn({ err, orderId }, 'delivered message not sent at once; the outbox retries it')
  }
}

/**
 * Gives every unassigned stop on the date (one slot's orders, or the listed ones) to
 * the nearest rider, with the warehouse that makes his trip shortest (nearest.js).
 */
router.post(
  '/manifest/auto-assign',
  asyncHandler(async (req, res) => {
    const b = parse(
      z.object({ date: z.string().refine(isDate, 'date must be YYYY-MM-DD'), orderIds: z.array(z.string().max(40)).min(1).max(500).optional() }),
      req.body,
    )
    res.json(await tx((c) => assignNearest(c, b.date, req.actor, { orderIds: b.orderIds ?? null })))
  }),
)

/** Photo deliveries waiting for someone other than the rider to check them. */
router.get('/delivery-reviews', asyncHandler(async (_req, res) => res.json(await photoReviews({ query }))))

router.post(
  '/delivery-reviews/:id',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ ok: z.boolean(), note: z.string().trim().max(300).optional() }), req.body)
    await tx((c) => reviewDelivery(c, req.params.id, b, req.actor))
    res.status(204).end()
  }),
)
