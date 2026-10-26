// Customer care routes for signed-in customers (docs/care.md), mounted inside
// the /v1 router after its customer sign-in. Every path is under /me, so each
// one acts on the caller's own help requests and subscriptions and nobody
// else's (another customer's answers 404). While a switch is off its routes
// answer 404, as if they did not exist.
//   /me/help/requests...     the help centre (HELP_CENTRE)
//   /me/subscriptions...     mango season subscriptions (SUBSCRIPTIONS)
// Paying for a subscription's delivery (POST /me/subscriptions/:id/cycles/:cycleId/pay)
// is in customer.js, beside checkout, whose payment start and idempotency it shares.
import express from 'express'
import { z } from 'zod'
import { query, tx } from './db.js'
import { env } from './env.js'
import { isOn } from './feature-switches.js'
import { asyncHandler, notFound, parse } from './errors.js'
import { customerReply, FIRST_MESSAGE_MIN, HELP_TOPICS, listOwnTickets, MESSAGE_MAX, openTicket, ownTicket } from './help.js'
import { STAGES } from './stage.js'
import {
  createSubscription, customerCancelSubscription, customerPause, customerResume, listOwn, ownSubscription, PERIOD_DAYS, seasonEnd, skipCycle, subscriptionsOpen,
} from './subscriptions.js'

export const care = express.Router()

const whenOn = (on) => (_req, _res, next) => next(on() ? undefined : notFound())

// ---------------------------------------------------------------- help centre

care.use('/me/help', whenOn(() => isOn('HELP_CENTRE')))

const message = (min) => z.string().trim().min(min, min > 1 ? `Tell us a little more (${min} characters or more)` : 'Write a message').max(MESSAGE_MAX, `Keep it under ${MESSAGE_MAX} characters`)
const ID = z.string().min(1).max(64)

/** The topics to choose from, and the limits the form shows. */
care.get('/me/help', (_req, res) =>
  res.json({ topics: Object.entries(HELP_TOPICS).map(([id, label]) => ({ id, label })), messageMax: MESSAGE_MAX, firstMessageMin: FIRST_MESSAGE_MIN, dailyLimit: env.HELP_DAILY_LIMIT }),
)

care.get('/me/help/requests', asyncHandler(async (req, res) => res.json({ items: await listOwnTickets({ query }, req.customer.id) })))

care.post(
  '/me/help/requests',
  asyncHandler(async (req, res) => {
    const b = parse(
      z.object({ topic: z.enum(Object.keys(HELP_TOPICS)), orderId: ID.optional().nullable(), message: message(FIRST_MESSAGE_MIN) }).strict(),
      req.body ?? {},
    )
    res.status(201).json(await tx((c) => openTicket(c, req.customer.id, { topic: b.topic, orderId: b.orderId ?? null, message: b.message })))
  }),
)

care.get('/me/help/requests/:id', asyncHandler(async (req, res) => res.json(await ownTicket({ query }, req.customer.id, req.params.id))))

care.post(
  '/me/help/requests/:id/messages',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ message: message(1) }).strict(), req.body ?? {})
    res.status(201).json(await tx((c) => customerReply(c, req.customer.id, req.params.id, b.message)))
  }),
)

// ---------------------------------------------------------------- subscriptions

care.use('/me/subscriptions', whenOn(() => isOn('SUBSCRIPTIONS')))

/** The customer's subscriptions, and whether a new one can start (the season's end). */
care.get(
  '/me/subscriptions',
  asyncHandler(async (req, res) =>
    res.json({ items: await listOwn({ query }, req.customer.id), open: subscriptionsOpen(), seasonEnd: seasonEnd(), leadDays: env.SUBSCRIPTION_LEAD_DAYS }),
  ),
)

care.post(
  '/me/subscriptions',
  asyncHandler(async (req, res) => {
    const b = parse(
      z
        .object({
          sku: z.string().min(1).max(40), stage: z.enum(STAGES), qty: z.number().int().min(1).max(20),
          frequency: z.enum(Object.keys(PERIOD_DAYS)), weekday: z.number().int().min(1).max(7),
          slotId: z.string().max(64).optional().nullable(), addressId: ID, endDate: z.string().max(10),
        })
        .strict(),
      req.body ?? {},
    )
    const id = await tx((c) => createSubscription(c, req.customer.id, b, req.actor))
    res.status(201).json(await ownSubscription({ query }, req.customer.id, id))
  }),
)

care.get('/me/subscriptions/:id', asyncHandler(async (req, res) => res.json(await ownSubscription({ query }, req.customer.id, req.params.id))))

const change = (fn) =>
  asyncHandler(async (req, res) => {
    await tx((c) => fn(c, req))
    res.json(await ownSubscription({ query }, req.customer.id, req.params.id))
  })

care.post('/me/subscriptions/:id/pause', change((c, req) => customerPause(c, req.customer.id, req.params.id, req.actor)))
care.post('/me/subscriptions/:id/resume', change((c, req) => customerResume(c, req.customer.id, req.params.id, req.actor)))
care.post('/me/subscriptions/:id/cancel', change((c, req) => customerCancelSubscription(c, req.customer.id, req.params.id, req.actor)))
care.post(
  '/me/subscriptions/:id/skip',
  change((c, req) => {
    const b = parse(z.object({ scheduledFor: z.string().max(10) }).strict(), req.body ?? {})
    return skipCycle(c, req.customer.id, req.params.id, b.scheduledFor, req.actor)
  }),
)
