// /v1/partner-network: the shop's Partner With Us form (docs/partner-network.md).
// No sign-in. Submissions are limited per address and, when Turnstile is set
// up, need a solved check. Nothing here returns an enquiry's details: the
// reference is printed on screen and may be shared, so it is not a secret.
import express from 'express'
import { query, tx } from '../db.js'
import { env } from '../env.js'
import { asyncHandler, badRequest, notFound } from '../errors.js'
import { isOn } from '../feature-switches.js'
import { logger } from '../logger.js'
import { sharedLimiter } from '../ratelimit.js'
import { requireHuman } from '../turnstile.js'
import { addDocument, formFor, MAX_DOCUMENT_BYTES, REFERENCE_RE, stepsForCategory, submitEnquiry } from './enquiries.js'

export const partnerPublic = express.Router()

partnerPublic.use((_req, res, next) => {
  if (!isOn('PARTNER_NETWORK')) return next(notFound())
  res.set('Cache-Control', 'no-store')
  next()
})

const siteKey = () => (env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY || null : null)
const form = () => formFor({ query }, { captchaRequired: siteKey() })

partnerPublic.get('/', asyncHandler(async (_req, res) => res.json(await form())))
partnerPublic.get('/categories', asyncHandler(async (_req, res) => res.json({ categories: (await form()).categories })))
partnerPublic.get(
  '/questionnaires/:category',
  asyncHandler(async (req, res) => {
    const f = await form()
    if (!f.categories.some((c) => c.code === req.params.category)) throw notFound('No such partnership category')
    res.json(stepsForCategory(f, req.params.category))
  }),
)

// Per address: a real applicant sends one enquiry, maybe two. Uploads have their own, looser limit.
const submitLimiter = sharedLimiter('partner-submit', { windowMs: 60 * 60_000, limit: 5, message: 'Too many enquiries from this connection. Please try again in an hour.' })
const uploadLimiter = sharedLimiter('partner-upload', { windowMs: 60 * 60_000, limit: 40, message: 'Too many uploads from this connection. Please try again later.' })

partnerPublic.post(
  '/enquiries',
  submitLimiter,
  asyncHandler(async (req, res) => {
    const key = req.get('Idempotency-Key')
    if (!key || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw badRequest('Send an Idempotency-Key header (8 to 100 letters, digits, - or _)', 'IDEMPOTENCY_KEY_REQUIRED')
    const b = req.body ?? {}
    if (typeof b !== 'object' || Array.isArray(b)) throw badRequest('Send the form as JSON')
    const extra = Object.keys(b).filter((k) => !['questionnaireVersion', 'answers', 'captchaToken'].includes(k))
    if (extra.length) throw badRequest(`${extra[0]}: not accepted here`)
    await requireHuman(b.captchaToken, req.ip, { action: 'partner' })
    const r = await tx((c) => submitEnquiry(c, { version: b.questionnaireVersion, answers: b.answers, idempotencyKey: key }))
    // The reference only: never the applicant's name, number or email.
    logger.info({ reference: r.body.reference, replay: r.status === 200 }, 'partner enquiry received')
    res.status(r.status).json(r.body)
  }),
)

partnerPublic.post(
  '/enquiries/:reference/documents',
  uploadLimiter,
  express.raw({ type: () => true, limit: MAX_DOCUMENT_BYTES, inflate: false }),
  asyncHandler(async (req, res) => {
    const r = await tx((c) => addDocument(c, {
      reference: req.params.reference, token: req.get('X-Upload-Token'), category: String(req.query.category ?? ''),
      filename: typeof req.query.name === 'string' ? req.query.name : '', bytes: req.body,
    }))
    res.status(201).json(r)
  }),
)

partnerPublic.get(
  '/enquiries/:reference',
  asyncHandler(async (req, res) => {
    const ref = String(req.params.reference).toUpperCase()
    if (!REFERENCE_RE.test(ref)) throw notFound('Enquiry not found')
    const { rows } = await query('SELECT reference FROM partner_enquiries WHERE reference = $1', [ref])
    if (!rows.length) throw notFound('Enquiry not found')
    res.json({ reference: rows[0].reference, received: true })
  }),
)
