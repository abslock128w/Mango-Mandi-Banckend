// The gift recipient's address page (GIFT_ADDRESS_LINKS with MULTI_GIFT, gift-address.js, docs/gifting.md), mounted in
// customer.js before the sign-in gate: the recipient opens it from WhatsApp, usually not signed in, often on a phone
// that has never seen the shop.
//   GET  /gift-address/:token   200 { state: 'PENDING'|'GIVEN', recipientName, fromName, box: { name, qty, stage },
//                               weekStart, message, expiresAt }; 404 LINK_NOT_FOUND, 410 LINK_EXPIRED, 410 GIFT_CANCELLED
//   POST /gift-address/:token   { address (10–500 characters), pincode (6 digits) } once: 200 { state: 'GIVEN', weekStart };
//                               400 VALIDATION_ERROR, 400 NOT_SERVICEABLE, 404 LINK_NOT_FOUND, 409 ADDRESS_GIVEN,
//                               410 LINK_EXPIRED, 410 GIFT_CANCELLED
// Never the giver's phone, the price or the recipient's phone. Every answer is Cache-Control: no-store, limited per
// address (a token is 256 bits, so the limit is against load, not guessing). Both routes answer 404 while either switch is off.
import express from 'express'
import { z } from 'zod'
import { asyncHandler, notFound, parse } from './errors.js'
import { fillLink, giftAddressOn, readLink } from './gift-address.js'
import { logger } from './logger.js'
import { sharedLimiter } from './ratelimit.js'

export const giftAddressPublic = express.Router()

const whenOn = (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next(giftAddressOn() ? undefined : notFound())
}

const limiter = sharedLimiter('gift-address', {
  windowMs: 15 * 60_000, limit: 60, message: 'Too many tries from this connection. Please wait a few minutes and try again.',
})

const body = z
  .object({
    address: z.string().trim().min(10, 'Enter the full delivery address').max(500, 'The address is too long'),
    pincode: z.string().trim().regex(/^\d{6}$/, 'pincode must be 6 digits'),
  })
  .strict()

giftAddressPublic.get(
  '/gift-address/:token',
  whenOn,
  limiter,
  asyncHandler(async (req, res) => {
    res.json(await readLink(req.params.token))
  }),
)

giftAddressPublic.post(
  '/gift-address/:token',
  whenOn,
  limiter,
  asyncHandler(async (req, res) => {
    const b = parse(body, req.body ?? {})
    const r = await fillLink(req.params.token, b)
    // Never the address, the pincode or the token in the log.
    logger.info({ weekStart: r.weekStart }, 'gift recipient gave their address')
    res.json(r)
  }),
)
