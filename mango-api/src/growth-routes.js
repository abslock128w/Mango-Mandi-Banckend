// Growth routes for the shop (docs/growth.md).
//   growthPublic: POST /events, the shop's anonymous funnel steps (FUNNEL_ANALYTICS).
//     Public and signed-out: it reads no token or cookie. Off, it answers 204 and
//     stores nothing, so an older or newer shop never sees an error from it.
//   growthMe: /me/referral... (REFERRALS), mounted after the customer sign-in, so
//     each acts on the caller's own account. Off, they answer 404.
import express from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { query, tx } from './db.js'
import { env } from './env.js'
import { asyncHandler, notFound, parse } from './errors.js'
import { BROWSER_ID, CLIENT_STEPS, recordStep } from './funnel.js'
import { limitsOnInTests } from './ratelimit.js'
import { applyReferral, referralView } from './referrals.js'
import { isOn } from './feature-switches.js'

const whenOn = (on) => (_req, _res, next) => next(on() ? undefined : notFound())

// ---------------------------------------------------------------- funnel steps

export const growthPublic = express.Router()

/**
 * Per address, in this instance's memory: a flood guard, not a count of people (a browser sends a
 * handful of steps a day, each stored once). 429s are answered without touching the database.
 */
export const FUNNEL_RATE = { windowMs: 10 * 60_000, limit: 120 }
const eventLimiter = rateLimit({
  ...FUNNEL_RATE,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test' && !limitsOnInTests(),
  handler: (req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many events', requestId: req.id } }),
})

const eventBody = z.object({ browserId: z.string().regex(BROWSER_ID, 'browserId must be a random UUID'), step: z.enum(CLIENT_STEPS) }).strict()

growthPublic.post(
  '/events',
  // Switched off: dropped before anything else, with the same answer.
  (req, res, next) => (isOn('FUNNEL_ANALYTICS') ? next() : res.status(204).end()),
  eventLimiter,
  asyncHandler(async (req, res) => {
    const b = parse(eventBody, req.body ?? {})
    await recordStep(b.browserId, b.step)
    res.status(204).end()
  }),
)

// ---------------------------------------------------------------- refer a friend

export const growthMe = express.Router()

growthMe.use('/me/referral', whenOn(() => isOn('REFERRALS')))

/** My code and share link, the code I entered (if any) and my thank-you codes. */
growthMe.get(
  '/me/referral',
  asyncHandler(async (req, res) => res.json(await referralView({ query }, req.customer.id))),
)

/** A new customer enters a friend's code (once). Every check is in referrals.js applyReferral. */
growthMe.post(
  '/me/referral/apply',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ code: z.string().min(1).max(40) }).strict(), req.body ?? {})
    await tx((c) => applyReferral(c, req.customer.id, b.code))
    res.status(201).json(await referralView({ query }, req.customer.id))
  }),
)
