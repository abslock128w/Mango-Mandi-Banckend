// Bulk enquiries for customers (mango-api/README.md, Bulk enquiries), mounted in customer.js.
//   POST /bulk-enquiries                     the shop's form: no sign-in needed (a signed-in sender's
//                                            enquiry is linked to their account)
//   GET  /me/bulk-enquiries[/:id]            the caller's own (sent signed in, or from their number)
//   POST /me/bulk-enquiries/:id/seen         they opened the quote
//   POST /me/bulk-enquiries/:id/respond      accept or decline it
// Every route answers 404 while BULK_ENQUIRIES is off.
import express from 'express'
import { z } from 'zod'
import { optionalCustomer } from './auth.js'
import { createEnquiry, enquiryBody, markSeen, ownEnquiries, ownEnquiry, respond } from './bulk-enquiries.js'
import { query, tx } from './db.js'
import { asyncHandler, badRequest, notFound, parse } from './errors.js'
import { isOn } from './feature-switches.js'
import { logger } from './logger.js'
import { sharedLimiter } from './ratelimit.js'

const whenOn = (_req, res, next) => {
  if (!isOn('BULK_ENQUIRIES')) return next(notFound())
  res.set('Cache-Control', 'no-store')
  next()
}

/** Public: mounted before the customer sign-in gate. */
export const bulkEnquiryPublic = express.Router()

// Per connection, on top of the per-number daily limit in createEnquiry.
const submitLimiter = sharedLimiter('bulk-enquiry', { windowMs: 60 * 60_000, limit: 10, message: 'Too many enquiries from this connection. Please try again in an hour.' })

bulkEnquiryPublic.post(
  '/bulk-enquiries',
  whenOn,
  submitLimiter,
  optionalCustomer,
  asyncHandler(async (req, res) => {
    const key = req.get('Idempotency-Key') ?? null
    if (key !== null && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw badRequest('Idempotency-Key: 8 to 100 letters, digits, - or _', 'IDEMPOTENCY_KEY_INVALID')
    const b = parse(enquiryBody, req.body ?? {})
    const r = await tx((c) => createEnquiry(c, b, { customerId: req.customer?.id ?? null, idempotencyKey: key }))
    // The number only: never the sender's name, phone or email.
    logger.info({ number: r.body.number, replay: r.status === 200, signedIn: Boolean(req.customer) }, 'bulk enquiry received')
    res.status(r.status).json(r.body)
  }),
)

/** Signed in: mounted after the customer sign-in gate (every path is under /me). */
export const bulkEnquiryMe = express.Router()
bulkEnquiryMe.use('/me/bulk-enquiries', whenOn)

bulkEnquiryMe.get('/me/bulk-enquiries', asyncHandler(async (req, res) => res.json({ items: await ownEnquiries({ query }, req.customer.id) })))
bulkEnquiryMe.get('/me/bulk-enquiries/:id', asyncHandler(async (req, res) => res.json(await ownEnquiry({ query }, req.customer.id, req.params.id))))
bulkEnquiryMe.post('/me/bulk-enquiries/:id/seen', asyncHandler(async (req, res) => res.json(await tx((c) => markSeen(c, req.customer.id, req.params.id)))))
bulkEnquiryMe.post(
  '/me/bulk-enquiries/:id/respond',
  asyncHandler(async (req, res) => {
    const b = parse(
      z.object({
        decision: z.enum(['ACCEPT', 'DECLINE']),
        message: z.string().trim().max(1000, 'Keep the message under 1000 characters').optional().nullable().transform((v) => v || null),
      }).strict(),
      req.body ?? {},
    )
    res.json(await tx((c) => respond(c, req.customer.id, req.params.id, b.decision, b.message)))
  }),
)
