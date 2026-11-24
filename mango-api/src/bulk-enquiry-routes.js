// Bulk orders and enquiries for customers (mango-api/README.md, Bulk orders), mounted in customer.js.
//   GET  /bulk/prices                        public: every 5 kg box and its 10 kg bulk box, shop and bulk price (paise)
//   POST /bulk-enquiries                     an enquiry (a quote, nothing paid), from BULK_ENQUIRY_MIN_KG (250 kg):
//                                            no sign-in needed (a signed-in sender's is linked to their account).
//                                            Less is refused with 400 BULK_ENQUIRY_TOO_SMALL; kind ORDER with
//                                            400 BULK_ORDER_PAY_ONLINE (orders are placed signed in and paid).
//   POST /farm-visit-enquiries               a farm visit enquiry (kind FARM_VISIT), from 250 kg: no sign-in needed;
//                                            the same Idempotency-Key, daily limit and connection limit as an enquiry
//                                            Both forms take an optional captchaToken: with Turnstile on (TURNSTILE_SECRET_KEY)
//                                            a form without a good one is refused (400 CAPTCHA_REQUIRED / CAPTCHA_FAILED), AUTH-01
//   POST /me/bulk-orders                     a bulk order from 100 kg at bulk prices, paid at once by payment link
//                                            (Idempotency-Key required): 201 { ...the order as GET shows it }
//   POST /me/bulk-orders/:id/pay             the payment link again, or "Pay again" after the time to pay ran out
//   POST /me/bulk-orders/:id/cancel          cancel: unpaid, or paid within 4 hours of paying (refunded in full)
//   GET  /me/bulk-enquiries[/:id]            the caller's own, enquiries and orders (sent signed in, or from their number)
//   POST /me/bulk-enquiries/:id/seen         they opened the quote
//   POST /me/bulk-enquiries/:id/respond      accept or decline it
// Every route answers 404 while BULK_ENQUIRIES is off.
import express from 'express'
import { z } from 'zod'
import { optionalCustomer } from './auth.js'
import {
  BULK_ENQUIRY_MIN_KG, BULK_ENQUIRY_MIN_MESSAGE, BULK_MIN_KG, BULK_ORDER_PAY_MESSAGE, bulkPhone, cleanLines, createEnquiry, createFarmVisitEnquiry, enquiryBody, farmVisitBody,
  markSeen, ownEnquiries, ownEnquiry, respond,
} from './bulk-enquiries.js'
import { createBulkOrder, customerCancelBulk, dropLink, ensureBulkPaymentLink, processBulkPayment, refundBulkOrder, reopenBulkOrder } from './bulk-orders.js'
import { bulkPriceList } from './bulk-price.js'
import { newId } from './ids.js'
import { refundsFor, sendDueRefunds } from './payments.js'
import { query, tx } from './db.js'
import { asyncHandler, badRequest, HttpError, notFound, parse } from './errors.js'
import { isOn } from './feature-switches.js'
import { logger } from './logger.js'
import { sharedLimiter } from './ratelimit.js'
import { requireHuman } from './turnstile.js'

const whenOn = (_req, res, next) => {
  if (!isOn('BULK_ENQUIRIES')) return next(notFound())
  res.set('Cache-Control', 'no-store')
  next()
}

/** Public: mounted before the customer sign-in gate. */
export const bulkEnquiryPublic = express.Router()

// Per connection, on top of the per-number daily limit in createEnquiry. Only enquiries
// accepted (201) count: a form refused for a mistake, or a replay, doesn't use up the hour.
const submitLimiter = sharedLimiter('bulk-enquiry', {
  windowMs: 60 * 60_000, limit: 10, message: 'Too many enquiries from this connection. Please try again in an hour.',
  countOnly: (_req, res) => res.statusCode === 201,
})

/**
 * The Turnstile token comes with the form but is not part of it: it is taken out before the form is
 * checked and hashed, since a retry with the same Idempotency-Key brings a new token (a token works once).
 */
const captchaField = z.object({ captchaToken: z.string().max(2048).optional().nullable() })
function takeCaptcha(raw) {
  const { captchaToken, ...form } = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return { captchaToken: parse(captchaField, { captchaToken }).captchaToken ?? null, form }
}

/**
 * AUTH-01: both forms make the shop's WhatsApp number message the number typed in, so a script must not
 * send them. Checked for everyone, signed in or not, after the form is valid and before anything is saved
 * or counted. Without Turnstile set up (TURNSTILE_SECRET_KEY unset: local, tests) it lets every form through.
 */
const human = (field, action) => asyncHandler(async (req, _res, next) => {
  await requireHuman(req[field].captchaToken, req.ip, { action })
  next()
})

/** The form is checked before the limiter counts it (createEnquiry checks the lines again with the catalogue). */
function validEnquiry(req, _res, next) {
  const key = req.get('Idempotency-Key') ?? null
  if (key !== null && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) return next(badRequest('Idempotency-Key: 8 to 100 letters, digits, - or _', 'IDEMPOTENCY_KEY_INVALID'))
  try {
    const { captchaToken, form } = takeCaptcha(req.body)
    const body = parse(enquiryBody, form)
    // Bulk orders are placed signed in and paid at once (POST /me/bulk-orders); this form sends enquiries only.
    if (body.kind === 'ORDER') return next(new HttpError(400, 'BULK_ORDER_PAY_ONLINE', BULK_ORDER_PAY_MESSAGE))
    // An enquiry is for BULK_ENQUIRY_MIN_KG or more (createEnquiry checks it again from the catalogue's box sizes).
    const kg = body.lines.length ? cleanLines(body.lines).reduce((t, l) => t + l.kg, 0) : (body.quantityKg ?? 0)
    if (Math.round(kg) < BULK_ENQUIRY_MIN_KG) return next(new HttpError(400, 'BULK_ENQUIRY_TOO_SMALL', BULK_ENQUIRY_MIN_MESSAGE, { minKg: BULK_ENQUIRY_MIN_KG, orderMinKg: BULK_MIN_KG }))
    req.enquiry = { key, body, captchaToken }
    next()
  } catch (err) {
    next(err)
  }
}

bulkEnquiryPublic.post(
  '/bulk-enquiries',
  whenOn,
  validEnquiry,
  human('enquiry', 'bulk'),
  submitLimiter,
  optionalCustomer,
  asyncHandler(async (req, res) => {
    const { key, body: b } = req.enquiry
    const r = await tx((c) => createEnquiry(c, b, { customerId: req.customer?.id ?? null, idempotencyKey: key }))
    // The number only: never the sender's name, phone or email.
    logger.info({ number: r.body.number, replay: r.status === 200, signedIn: Boolean(req.customer) }, 'bulk enquiry received')
    res.status(r.status).json(r.body)
  }),
)

/** The farm visit form (the shop's Farm visit tab): checked before the limiter counts it, as the enquiry form is. */
function validFarmVisit(req, _res, next) {
  const key = req.get('Idempotency-Key') ?? null
  if (key !== null && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) return next(badRequest('Idempotency-Key: 8 to 100 letters, digits, - or _', 'IDEMPOTENCY_KEY_INVALID'))
  try {
    const { captchaToken, form } = takeCaptcha(req.body)
    req.farmVisit = { key, body: parse(farmVisitBody, form), captchaToken }
    next()
  } catch (err) {
    next(err)
  }
}

bulkEnquiryPublic.post(
  '/farm-visit-enquiries',
  whenOn,
  validFarmVisit,
  human('farmVisit', 'farm-visit'),
  submitLimiter,
  optionalCustomer,
  asyncHandler(async (req, res) => {
    const { key, body: b } = req.farmVisit
    const r = await tx((c) => createFarmVisitEnquiry(c, b, { customerId: req.customer?.id ?? null, idempotencyKey: key }))
    logger.info({ number: r.body.number, replay: r.status === 200, signedIn: Boolean(req.customer) }, 'farm visit enquiry received')
    res.status(r.status).json(r.body)
  }),
)

/** The bulk price list the shop's bulk page shows (bulk-price.js). Public: prices are not private. */
bulkEnquiryPublic.get('/bulk/prices', whenOn, (_req, res) => res.json(bulkPriceList()))

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

// ---------------------------------------------------------------- bulk orders, paid at once (bulk-orders.js)

bulkEnquiryMe.use('/me/bulk-orders', whenOn)

const text = (max, label) => z.string().trim().max(max, `Keep ${label} under ${max} characters`)
const orderBody = z
  .object({
    name: text(100, 'the name').min(1, 'Enter your name'),
    business: text(120, 'the business name').optional().nullable().transform((v) => v || null),
    email: z.string().trim().max(200).optional().nullable().transform((v) => v || null)
      .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email, or leave it empty'),
    phone: bulkPhone,
    city: text(100, 'the city').min(1, 'Enter the delivery city'),
    address: text(500, 'the address').min(5, 'Enter the delivery address'),
    pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter the 6-digit pincode'),
    notes: text(1000, 'the note').optional().nullable().transform((v) => v || null),
    lines: enquiryBody.shape.lines,
  })
  .strict()

/** The order as the shop reads it, with its payment link made (or made again) when it is waiting for payment. */
async function withLink(customerId, id) {
  try {
    await ensureBulkPaymentLink(id)
  } catch (err) {
    // The order stays; the shop's Pay button asks again (POST /me/bulk-orders/:id/pay).
    logger.error({ err, bulkOrderId: id }, 'bulk order: payment link not made yet')
  }
  return ownEnquiry({ query }, customerId, id)
}

bulkEnquiryMe.post(
  '/me/bulk-orders',
  asyncHandler(async (req, res) => {
    const key = req.get('Idempotency-Key') ?? null
    if (!key || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw badRequest('Idempotency-Key: 8 to 100 letters, digits, - or _', 'IDEMPOTENCY_KEY_INVALID')
    const b = parse(orderBody, req.body ?? {})
    const r = await tx((c) => createBulkOrder(c, b, { customerId: req.customer.id, idempotencyKey: key }))
    logger.info({ number: r.row.number, replay: r.status === 200 }, 'bulk order placed')
    res.status(r.status).json(await withLink(req.customer.id, r.row.id))
  }),
)

bulkEnquiryMe.post(
  '/me/bulk-orders/:id/pay',
  asyncHandler(async (req, res) => {
    const { row, oldLink } = await tx((c) => reopenBulkOrder(c, req.customer.id, req.params.id))
    if (oldLink) await dropLink(oldLink)
    res.json(await withLink(req.customer.id, row.id))
  }),
)

bulkEnquiryMe.post(
  '/me/bulk-orders/:id/cancel',
  asyncHandler(async (req, res) => {
    const r = await tx((c) => customerCancelBulk(c, req.customer.id, req.params.id))
    if (r.refund) await refundBulkOrder(req.params.id).catch((err) => logger.error({ err, bulkOrderId: req.params.id }, 'bulk refund failed; maintenance will retry'))
    else if (r.link) await dropLink(r.link)
    res.json(await ownEnquiry({ query }, req.customer.id, req.params.id))
  }),
)

/** Dev only (/v1/dev, mounted in customer.js): pays or fails a bulk order's link as the Razorpay webhook would. */
export const devBulk = express.Router()
devBulk.post(
  '/pay-bulk',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ bulkOrderId: z.string().min(1), outcome: z.enum(['captured', 'failed']) }), req.body)
    const r = await tx((c) => processBulkPayment(c, {
      bulkOrderId: b.bulkOrderId, outcome: b.outcome, paymentId: `pay_dev_${newId('p').slice(2)}`, method: 'dev',
      details: { gateway: 'Test mode', method: 'dev' },
    }))
    await sendDueRefunds(refundsFor({ result: r, bulkOrderId: b.bulkOrderId }))
    res.json({ result: r })
  }),
)

