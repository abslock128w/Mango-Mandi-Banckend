// App feel routes for signed-in customers (docs/app-feel.md), mounted inside
// the /v1 router after its customer sign-in: every path here is under /me, so
// each one acts on the caller's own browsers and hearts and nobody else's.
//   /me/push...        browser notifications (WEB_PUSH)
//   /me/favourites...  hearted boxes (FAVOURITES)
// While a flag is off its routes answer 404, as if they did not exist.
import express from 'express'
import { z } from 'zod'
import { query, tx } from './db.js'
import { env } from './env.js'
import { asyncHandler, notFound, parse } from './errors.js'
import { addFavourite, listFavourites, MAX_FAVOURITES, mergeFavourites, removeFavourite } from './favourites.js'
import { logger } from './logger.js'
import { endpointHint, pushPublicKey, removeSubscription, saveSubscription } from './push.js'

export const appFeel = express.Router()

const whenOn = (on) => (_req, _res, next) => next(on() ? undefined : notFound())

// ---------------------------------------------------------------- browser notifications

appFeel.use('/me/push', whenOn(() => env.WEB_PUSH))

/**
 * What the Account page needs to offer notifications: whether it can (push on
 * and a key to subscribe with) and the public key. How many of the customer's
 * browsers have them on, so the page can say so.
 */
appFeel.get(
  '/me/push',
  asyncHandler(async (req, res) => {
    const publicKey = pushPublicKey()
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE customer_id = $1', [req.customer.id])
    res.json({ available: Boolean(publicKey), publicKey, browsers: rows[0].n })
  }),
)

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/
const subscriptionBody = z.object({
  endpoint: z.string().min(1).max(1024),
  // What PushSubscription.toJSON() gives; expirationTime is ignored (a gone subscription answers 404/410).
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(80).max(120).regex(B64URL), auth: z.string().min(16).max(32).regex(B64URL) }).strict(),
}).strict()

/** Turns notifications on for this browser: called only after the customer said yes in the browser's own prompt. */
appFeel.put(
  '/me/push/subscription',
  asyncHandler(async (req, res) => {
    if (!pushPublicKey()) throw notFound()
    const b = parse(subscriptionBody, req.body ?? {})
    await tx((c) => saveSubscription(c, req.customer.id, b))
    logger.info({ customerId: req.customer.id, to: endpointHint(b.endpoint) }, 'push notifications turned on')
    res.status(201).json({ subscribed: true })
  }),
)

/** Turns notifications off for this browser. Also sent before signing out, so a shared device stops getting them. */
appFeel.delete(
  '/me/push/subscription',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ endpoint: z.string().min(1).max(1024) }).strict(), req.body ?? {})
    if (await tx((c) => removeSubscription(c, req.customer.id, b.endpoint))) {
      logger.info({ customerId: req.customer.id, to: endpointHint(b.endpoint) }, 'push notifications turned off')
    }
    res.status(204).end()
  }),
)

// ---------------------------------------------------------------- favourites

appFeel.use('/me/favourites', whenOn(() => env.FAVOURITES))

const SKU = z.string().min(1).max(40)

appFeel.get(
  '/me/favourites',
  asyncHandler(async (req, res) => res.json({ items: await listFavourites({ query }, req.customer.id), max: MAX_FAVOURITES })),
)

appFeel.put(
  '/me/favourites/:sku',
  asyncHandler(async (req, res) => {
    const sku = parse(SKU, req.params.sku)
    await tx((c) => addFavourite(c, req.customer.id, sku))
    res.json({ items: await listFavourites({ query }, req.customer.id), max: MAX_FAVOURITES })
  }),
)

appFeel.delete(
  '/me/favourites/:sku',
  asyncHandler(async (req, res) => {
    const sku = parse(SKU, req.params.sku)
    await tx((c) => removeFavourite(c, req.customer.id, sku))
    res.status(204).end()
  }),
)

/** The hearts a guest made on this device, sent once after signing in. */
appFeel.post(
  '/me/favourites/merge',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ skus: z.array(SKU).max(MAX_FAVOURITES) }).strict(), req.body ?? {})
    const { ignored } = await tx((c) => mergeFavourites(c, req.customer.id, b.skus))
    res.json({ items: await listFavourites({ query }, req.customer.id), max: MAX_FAVOURITES, ignored })
  }),
)
