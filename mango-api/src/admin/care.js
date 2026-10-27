// Customer care for staff (docs/care.md): the Help desk (HELP_CENTRE) and the
// Subscriptions list (SUBSCRIPTIONS). Managers and operators (access.js).
// Phones are masked to the last 4 digits; the full number stays on the
// customer profile, behind its own audited reveal. Every reply, resolve,
// reopen, pause and cancel writes its staff_audit row in the same
// transaction as the change, so neither commits without the other.
// While a switch is off its routes answer 404.
import express from 'express'
import { z } from 'zod'
import { query, tx } from '../db.js'
import { isOn } from '../feature-switches.js'
import { asyncHandler, notFound, parse } from '../errors.js'
import { HELP_STATUSES, HELP_TOPICS, inbox, MESSAGE_MAX, reopenTicket, resolveTicket, staffReply, staffTicket } from '../help.js'
import { auditNow } from '../staff-audit.js'
import { staffCancel, staffList, staffPause } from '../subscriptions.js'

export const router = express.Router()

const whenOn = (on) => (_req, _res, next) => next(on() ? undefined : notFound())
const help = whenOn(() => isOn('HELP_CENTRE'))
const subs = whenOn(() => isOn('SUBSCRIPTIONS'))

// ---------------------------------------------------------------- help desk

router.get(
  '/help/requests',
  help,
  asyncHandler(async (req, res) => {
    const f = parse(
      z.object({
        status: z.enum(HELP_STATUSES).optional(),
        topic: z.enum(Object.keys(HELP_TOPICS)).optional(),
        q: z.string().trim().max(40).optional(),
      }),
      req.query,
    )
    res.json({ ...(await inbox({ query }, { status: f.status ?? null, topic: f.topic ?? null, q: f.q || null })), topics: HELP_TOPICS })
  }),
)

router.get('/help/requests/:id', help, asyncHandler(async (req, res) => res.json(await staffTicket({ query }, req.params.id))))

router.post(
  '/help/requests/:id/reply',
  help,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ message: z.string().trim().min(1, 'Write a reply').max(MESSAGE_MAX, `Keep it under ${MESSAGE_MAX} characters`) }).strict(), req.body ?? {})
    await tx(async (c) => {
      const messageId = await staffReply(c, req.params.id, req.admin, b.message)
      // The reply itself is in help_messages with who wrote it; the audit says who replied, where and how long.
      await auditNow(req, 'REPLY help request', { target: req.params.id, detail: { messageId, length: b.message.length } }, c)
    })
    res.status(201).json(await staffTicket({ query }, req.params.id))
  }),
)

router.post(
  '/help/requests/:id/resolve',
  help,
  asyncHandler(async (req, res) => {
    await tx(async (c) => {
      await resolveTicket(c, req.params.id, req.admin)
      await auditNow(req, 'RESOLVE help request', { target: req.params.id }, c)
    })
    res.json(await staffTicket({ query }, req.params.id))
  }),
)

router.post(
  '/help/requests/:id/reopen',
  help,
  asyncHandler(async (req, res) => {
    await tx(async (c) => {
      await reopenTicket(c, req.params.id)
      await auditNow(req, 'REOPEN help request', { target: req.params.id }, c)
    })
    res.json(await staffTicket({ query }, req.params.id))
  }),
)

// ---------------------------------------------------------------- subscriptions

router.get(
  '/subscriptions',
  subs,
  asyncHandler(async (req, res) => {
    const f = parse(z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']).optional() }), req.query)
    res.json(await staffList({ query }, { status: f.status ?? null }))
  }),
)

const reasonBody = z.object({ reason: z.string().trim().min(5, 'Say why (5 characters or more). It is kept in the activity log.').max(500) }).strict()

for (const [path, action, fn] of [
  ['/subscriptions/:id/pause', 'PAUSE subscription', staffPause],
  ['/subscriptions/:id/cancel', 'CANCEL subscription', staffCancel],
]) {
  router.post(
    path,
    subs,
    asyncHandler(async (req, res) => {
      const { reason } = parse(reasonBody, req.body ?? {})
      await tx(async (c) => {
        await fn(c, req.params.id, req.actor, reason)
        await auditNow(req, action, { target: req.params.id, detail: { reason } }, c)
      })
      res.status(204).end()
    }),
  )
}
