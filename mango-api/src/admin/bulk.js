// Bulk Deals management: listings, their prices, photos, publishing and history.
// Manager only (requireManager on every route; access.js lists none of these for
// other roles, so the role gate refuses them too).
import express from 'express'
import { z } from 'zod'
import { requireManager } from '../auth.js'
import {
  assertStatusMove, diff, fromRow, getListing, listingEvent, listingFields, listingProblems, MAX_PHOTOS, onSale, orderMax, publishProblems, tierView,
} from '../bulk.js'
import { now } from '../clock.js'
import { query, tx } from '../db.js'
import { asyncHandler, badRequest, conflict, HttpError, notFound, parse } from '../errors.js'
import { newId } from '../ids.js'
import { checkPhoto, cleanImage, dropPhoto, MAX_REVIEW_UPLOAD_BYTES, photoWidth, sendPublicPhoto, storePhoto } from '../photos.js'
import { findProduct } from '../products.js'
import { stepUp, withoutConfirm } from './step-up.js'

export const router = express.Router()

const PHOTO_SIDE = 1600

/** Photo links: each photo has its own id, so a link never changes what it shows. */
export const adminPhotoUrl = (listingId, photoId) => `/admin/v1/bulk-listings/${encodeURIComponent(listingId)}/photos/${encodeURIComponent(photoId)}`
export const shopPhotoUrl = (listingId, photoId) => `/v1/bulk-deals/${encodeURIComponent(listingId)}/photos/${encodeURIComponent(photoId)}`

async function photosOf(c, listingId) {
  const { rows } = await c.query(
    'SELECT id, position, width, height, size_bytes, created_at FROM bulk_listing_photos WHERE listing_id = $1 ORDER BY position, created_at',
    [listingId],
  )
  return rows
}

/** A listing for the panel: its rules, photos, what stops it being published, and how the shop would show it. */
async function adminView(c, l) {
  const photos = await photosOf(c, l.id)
  const p = findProduct(l.sku)
  return {
    ...l,
    product: p ? { sku: p.sku, name: p.name, variety: p.variety, boxSize: p.boxSize, price: p.price, active: p.active } : null,
    photos: photos.map((ph, i) => ({ id: ph.id, primary: i === 0, width: ph.width, height: ph.height, sizeBytes: ph.size_bytes, url: adminPhotoUrl(l.id, ph.id) })),
    publishProblems: l.status === 'ARCHIVED' ? [] : publishProblems(l, { photos: photos.length }),
    onSale: onSale(l),
    orderMax: orderMax(l),
    tierView: tierView(l, p?.price ?? 0),
  }
}

/** Every listing, newest first within display order; ?status= narrows it. Paged. */
router.get(
  '/bulk-listings',
  requireManager,
  asyncHandler(async (req, res) => {
    const q = parse(
      z.object({ status: z.enum(['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED']).optional(), page: z.coerce.number().int().min(1).max(1000).default(1) }),
      req.query,
    )
    const size = 50
    const { rows } = await query(
      `SELECT l.*, (SELECT id FROM bulk_listing_photos p WHERE p.listing_id = l.id ORDER BY position, created_at LIMIT 1) AS photo_id,
              (SELECT COUNT(*)::int FROM bulk_listing_photos p WHERE p.listing_id = l.id) AS photo_count, COUNT(*) OVER ()::int AS total
         FROM bulk_listings l WHERE ($1::text IS NULL AND l.status <> 'ARCHIVED') OR l.status = $1
        ORDER BY l.sort_order, l.created_at DESC LIMIT $2 OFFSET $3`,
      [q.status ?? null, size, (q.page - 1) * size],
    )
    res.json({
      items: rows.map((r) => {
        const l = fromRow(r)
        return {
          ...l, productName: findProduct(l.sku)?.name ?? l.sku, photoUrl: r.photo_id ? adminPhotoUrl(l.id, r.photo_id) : null, photoCount: r.photo_count,
          onSale: onSale(l), publishProblems: l.status === 'ARCHIVED' ? [] : publishProblems(l, { photos: r.photo_count }),
        }
      }),
      page: q.page, pageSize: size, total: rows[0]?.total ?? 0,
    })
  }),
)

router.get(
  '/bulk-listings/:id',
  requireManager,
  asyncHandler(async (req, res) => res.json(await adminView({ query }, await getListing({ query }, req.params.id)))),
)

function checkProduct(sku) {
  const p = findProduct(sku)
  if (!p) throw badRequest('Choose a product from the list', 'INVALID_SKU')
  return p
}

function checkRules(l) {
  const problems = listingProblems(l)
  if (problems.length) throw new HttpError(400, 'BULK_INVALID', problems[0], { problems })
}

/** Creates a draft. Nothing shows in the shop until it is published. */
router.post(
  '/bulk-listings',
  requireManager,
  asyncHandler(async (req, res) => {
    const b = parse(
      z.object({
        ...listingFields,
        description: listingFields.description.default(''),
        origin: listingFields.origin.default(''),
        qtyStep: listingFields.qtyStep.default(1),
        maxQty: listingFields.maxQty.default(null),
        startsAt: listingFields.startsAt.default(null),
        endsAt: listingFields.endsAt.default(null),
        sortOrder: listingFields.sortOrder.default(0),
      }).strict(),
      withoutConfirm(req.body),
    )
    checkProduct(b.sku)
    checkRules(b)
    await stepUp(req, { always: true }) // its price tiers (STEP_UP_ROUTES)
    const id = newId('bulk')
    const out = await tx(async (c) => {
      await c.query(
        `INSERT INTO bulk_listings (id, sku, title, description, origin, stages, min_qty, qty_step, max_qty, tiers, status, starts_at, ends_at,
                                    sort_order, version, created_at, created_by, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'DRAFT', $11, $12, $13, 1, $14, $15, $14, $15)`,
        [id, b.sku, b.title, b.description, b.origin, b.stages, b.minQty, b.qtyStep, b.maxQty, JSON.stringify(b.tiers), b.startsAt, b.endsAt, b.sortOrder, now(), req.admin.email],
      )
      const l = await getListing(c, id)
      await listingEvent(c, id, 'CREATED', 1, { ...b }, req.admin)
      return adminView(c, l)
    })
    req.params.id = id
    res.status(201).json(out)
  }),
)

const EDITABLE = Object.keys(listingFields)
/** The fields that set what a customer pays: changing one asks the manager to confirm it is them. */
const PRICING = ['tiers', 'minQty', 'qtyStep', 'maxQty']

/**
 * Edits a listing. Every change bumps its version, so a customer's quote made
 * before it is priced again at checkout. A published listing must stay
 * publishable: an edit that would break it is refused (unpublish first).
 */
router.patch(
  '/bulk-listings/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const b = parse(z.object(Object.fromEntries(EDITABLE.map((k) => [k, listingFields[k].optional()]))).strict(), withoutConfirm(req.body))
    if (!Object.keys(b).length) throw badRequest('Nothing to change')
    if (b.sku) checkProduct(b.sku)
    const out = await tx(async (c) => {
      const before = await getListing(c, req.params.id, { lock: 'update' })
      if (before.status === 'ARCHIVED') throw conflict('An archived listing can no longer be changed', 'BULK_ARCHIVED')
      const next = { ...before, ...b }
      checkRules(next)
      if (before.status === 'PUBLISHED') {
        const problems = publishProblems(next, { photos: (await photosOf(c, before.id)).length })
        if (problems.length) throw new HttpError(400, 'BULK_INVALID', `This listing is live, so it must stay complete: ${problems[0]}`, { problems })
      }
      const changes = diff(Object.fromEntries(EDITABLE.map((k) => [k, before[k]])), Object.fromEntries(EDITABLE.map((k) => [k, next[k]])))
      if (!Object.keys(changes).length) return adminView(c, before)
      const pricing = PRICING.some((k) => changes[k])
      if (pricing) await stepUp(req, { always: true }) // STEP_UP_ROUTES
      const version = before.version + 1
      await c.query(
        `UPDATE bulk_listings SET sku = $2, title = $3, description = $4, origin = $5, stages = $6, min_qty = $7, qty_step = $8, max_qty = $9, tiers = $10,
                starts_at = $11, ends_at = $12, sort_order = $13, version = $14, updated_at = $15, updated_by = $16 WHERE id = $1`,
        [
          before.id, next.sku, next.title, next.description, next.origin, next.stages, next.minQty, next.qtyStep, next.maxQty, JSON.stringify(next.tiers),
          next.startsAt, next.endsAt, next.sortOrder, version, now(), req.admin.email,
        ],
      )
      await listingEvent(c, before.id, pricing ? 'PRICING_CHANGED' : 'EDITED', version, changes, req.admin)
      return adminView(c, await getListing(c, before.id))
    })
    res.json(out)
  }),
)

/** Publish, unpublish or archive. Publishing checks the listing is complete; archiving is final. */
function moveStatus(req, to) {
  return tx(async (c) => {
    const l = await getListing(c, req.params.id, { lock: 'update' })
    assertStatusMove(l.status, to)
    if (to === 'PUBLISHED') {
      const problems = publishProblems(l, { photos: (await photosOf(c, l.id)).length })
      if (problems.length) throw new HttpError(400, 'BULK_NOT_READY', problems[0], { problems })
    }
    const version = l.version + 1
    await c.query(
      `UPDATE bulk_listings SET status = $2, version = $3, updated_at = $4, updated_by = $5,
              published_at = CASE WHEN $2 = 'PUBLISHED' THEN $4 ELSE published_at END WHERE id = $1`,
      [l.id, to, version, now(), req.admin.email],
    )
    // A listing that leaves the shop leaves carts too; a quote made earlier fails at checkout.
    if (to !== 'PUBLISHED') await c.query('DELETE FROM bulk_cart_lines WHERE listing_id = $1', [l.id])
    await listingEvent(c, l.id, to, version, { status: { from: l.status, to } }, req.admin)
    return adminView(c, await getListing(c, l.id))
  })
}

/** Publishing checks the listing is complete; it shows in the shop at once. */
router.post('/bulk-listings/:id/publish', requireManager, asyncHandler(async (req, res) => res.json(await moveStatus(req, 'PUBLISHED'))))
/** Takes it out of the shop (and out of carts); it can be published again. */
router.post('/bulk-listings/:id/unpublish', requireManager, asyncHandler(async (req, res) => res.json(await moveStatus(req, 'UNPUBLISHED'))))
/** Retires it for good: it stays for past orders and its history, and can no longer be changed. */
router.post('/bulk-listings/:id/archive', requireManager, asyncHandler(async (req, res) => res.json(await moveStatus(req, 'ARCHIVED'))))

router.get(
  '/bulk-listings/:id/history',
  requireManager,
  asyncHandler(async (req, res) => {
    await getListing({ query }, req.params.id)
    const { rows } = await query(
      'SELECT id, action, version, changes, actor_name, created_at FROM bulk_listing_events WHERE listing_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200',
      [req.params.id],
    )
    res.json(rows.map((r) => ({ id: r.id, action: r.action, version: r.version, changes: r.changes, by: r.actor_name, at: r.created_at })))
  }),
)

// ---------------------------------------------------------------- photos

/**
 * Adds a photo (JPEG, PNG or WebP as the request body). It is checked by its
 * first bytes, re-encoded as a JPEG of at most 1600 px without metadata
 * (camera location included), and goes last in the gallery.
 */
router.post(
  '/bulk-listings/:id/photos',
  requireManager,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_REVIEW_UPLOAD_BYTES, inflate: false }),
  asyncHandler(async (req, res) => {
    const l = await getListing({ query }, req.params.id)
    if (l.status === 'ARCHIVED') throw conflict('An archived listing can no longer be changed', 'BULK_ARCHIVED')
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('Send the photo as a JPEG, PNG or WebP image', 'PHOTO_INVALID')
    checkPhoto(req.body, MAX_REVIEW_UPLOAD_BYTES)
    const img = await cleanImage(req.body, PHOTO_SIDE)
    const photoId = newId('blp')
    const saved = await storePhoto('bulk', `${l.id}-${photoId}`, img.bytes, img.ext, img.mime)
    try {
      const out = await tx(async (c) => {
        const locked = await getListing(c, l.id, { lock: 'update' })
        const { rows } = await c.query('SELECT COUNT(*)::int AS n, COALESCE(MAX(position), -1) AS top FROM bulk_listing_photos WHERE listing_id = $1', [l.id])
        if (rows[0].n >= MAX_PHOTOS) throw conflict(`A listing can have ${MAX_PHOTOS} photos at most; remove one first`, 'BULK_PHOTO_LIMIT')
        await c.query(
          `INSERT INTO bulk_listing_photos (id, listing_id, position, mime, bytes, blob_path, width, height, size_bytes, created_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [photoId, l.id, rows[0].top + 1, img.mime, saved.bytes, saved.blobPath, img.width, img.height, img.bytes.length, now(), req.admin.email],
        )
        const version = locked.version + 1
        await c.query('UPDATE bulk_listings SET version = $2, updated_at = $3, updated_by = $4 WHERE id = $1', [l.id, version, now(), req.admin.email])
        await listingEvent(c, l.id, 'PHOTO_ADDED', version, { photoId }, req.admin)
        return adminView(c, await getListing(c, l.id))
      })
      res.status(201).json(out)
    } catch (err) {
      await dropPhoto({ blob_path: saved.blobPath })
      throw err
    }
  }),
)

/** Sets the gallery order: every photo id, the main photo first. */
router.put(
  '/bulk-listings/:id/photos/order',
  requireManager,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ ids: z.array(z.string().min(1)).min(1).max(MAX_PHOTOS) }).strict(), req.body)
    const out = await tx(async (c) => {
      const l = await getListing(c, req.params.id, { lock: 'update' })
      if (l.status === 'ARCHIVED') throw conflict('An archived listing can no longer be changed', 'BULK_ARCHIVED')
      const have = (await photosOf(c, l.id)).map((p) => p.id)
      if (have.length !== b.ids.length || new Set(b.ids).size !== b.ids.length || !b.ids.every((id) => have.includes(id))) {
        throw badRequest('Send every photo of this listing exactly once', 'BULK_PHOTO_ORDER')
      }
      for (const [i, id] of b.ids.entries()) await c.query('UPDATE bulk_listing_photos SET position = $3 WHERE id = $1 AND listing_id = $2', [id, l.id, i])
      const version = l.version + 1
      await c.query('UPDATE bulk_listings SET version = $2, updated_at = $3, updated_by = $4 WHERE id = $1', [l.id, version, now(), req.admin.email])
      await listingEvent(c, l.id, 'PHOTOS_REORDERED', version, { order: { from: have, to: b.ids } }, req.admin)
      return adminView(c, await getListing(c, l.id))
    })
    res.json(out)
  }),
)

/** Removes a photo. A live listing keeps at least one. */
router.delete(
  '/bulk-listings/:id/photos/:photoId',
  requireManager,
  asyncHandler(async (req, res) => {
    let gone = null
    const out = await tx(async (c) => {
      const l = await getListing(c, req.params.id, { lock: 'update' })
      if (l.status === 'ARCHIVED') throw conflict('An archived listing can no longer be changed', 'BULK_ARCHIVED')
      const photos = await photosOf(c, l.id)
      if (!photos.some((p) => p.id === req.params.photoId)) throw notFound('Photo not found')
      if (l.status === 'PUBLISHED' && photos.length === 1) throw conflict('A live listing needs a photo: add another first, or unpublish it', 'BULK_PHOTO_REQUIRED')
      const { rows } = await c.query('DELETE FROM bulk_listing_photos WHERE id = $1 AND listing_id = $2 RETURNING blob_path', [req.params.photoId, l.id])
      gone = rows[0]
      const version = l.version + 1
      await c.query('UPDATE bulk_listings SET version = $2, updated_at = $3, updated_by = $4 WHERE id = $1', [l.id, version, now(), req.admin.email])
      await listingEvent(c, l.id, 'PHOTO_REMOVED', version, { photoId: req.params.photoId }, req.admin)
      return adminView(c, await getListing(c, l.id))
    })
    // The file goes only after the row is gone for good.
    if (gone) await dropPhoto(gone)
    res.json(out)
  }),
)

/** A photo of any listing, for the panel (drafts' photos are not public). */
router.get(
  '/bulk-listings/:id/photos/:photoId',
  requireManager,
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT id, mime, bytes, blob_path FROM bulk_listing_photos WHERE id = $1 AND listing_id = $2', [req.params.photoId, req.params.id])
    if (!rows.length) throw notFound('Photo not found')
    await sendPublicPhoto(res, rows[0], { key: `bulk:${rows[0].id}`, width: photoWidth(req.query.w), cache: 'private, max-age=86400' })
  }),
)
