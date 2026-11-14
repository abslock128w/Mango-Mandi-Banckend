// Bulk enquiries for staff (mango-api/README.md, Bulk enquiries): the list, one enquiry with its events and
// WhatsApp messages, sending a quote, closing it and notes. Managers and operators (access.js).
// Every change writes its staff_audit row in the same transaction. While BULK_ENQUIRIES is off
// the routes answer 404.
import express from 'express'
import { z } from 'zod'
import { addNote, BULK_STATUSES, closeEnquiry, quoteBody, sendQuote, staffDetail, staffList } from '../bulk-enquiries.js'
import { query, tx } from '../db.js'
import { asyncHandler, notFound, parse } from '../errors.js'
import { isOn } from '../feature-switches.js'
import { sendNotificationsNow } from '../notify.js'
import { auditNow } from '../staff-audit.js'
import { logger } from '../logger.js'

export const router = express.Router()

const on = (_req, _res, next) => next(isOn('BULK_ENQUIRIES') ? undefined : notFound())

router.get(
  '/bulk-enquiries',
  on,
  asyncHandler(async (req, res) => {
    const f = parse(z.object({ status: z.enum(BULK_STATUSES).optional(), q: z.string().trim().max(60).optional() }), req.query)
    res.json(await staffList({ query }, { status: f.status ?? null, q: f.q || null }))
  }),
)

router.get('/bulk-enquiries/:id', on, asyncHandler(async (req, res) => res.json(await staffDetail({ query }, req.params.id))))

router.post(
  '/bulk-enquiries/:id/quote',
  on,
  asyncHandler(async (req, res) => {
    const b = parse(quoteBody, req.body ?? {})
    const r = await tx(async (c) => {
      const out = await sendQuote(c, req.params.id, b, req.admin)
      await auditNow(req, 'QUOTE bulk enquiry', { target: req.params.id, detail: { round: out.round, total: out.quote.total, lines: out.quote.lines.length, extras: out.quote.extras.length } }, c)
      return out
    })
    // Send it now rather than at the next maintenance run, so the panel shows Sent or Failed at once.
    // A failure stays in the outbox for its retry.
    const { rows } = await query(`SELECT id FROM notifications WHERE bulk_enquiry_id = $1 AND kind = 'BULK_QUOTE' AND event_id = $2`, [req.params.id, `${req.params.id}:quote:${r.round}`])
    if (rows.length) await sendNotificationsNow(rows.map((x) => x.id)).catch((err) => logger.warn({ err }, 'bulk quote: send now failed'))
    res.status(201).json(await staffDetail({ query }, req.params.id))
  }),
)

router.post(
  '/bulk-enquiries/:id/close',
  on,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ reason: z.string().trim().max(500).optional().nullable() }).strict(), req.body ?? {})
    await tx(async (c) => {
      await closeEnquiry(c, req.params.id, req.admin, b.reason || null)
      await auditNow(req, 'CLOSE bulk enquiry', { target: req.params.id, detail: b.reason ? { reason: b.reason } : null }, c)
    })
    res.json(await staffDetail({ query }, req.params.id))
  }),
)

router.post(
  '/bulk-enquiries/:id/note',
  on,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ text: z.string().trim().min(1, 'Write a note').max(1000) }).strict(), req.body ?? {})
    await tx(async (c) => {
      await addNote(c, req.params.id, req.admin, b.text)
      await auditNow(req, 'NOTE bulk enquiry', { target: req.params.id, detail: { length: b.text.length } }, c)
    })
    res.status(201).json(await staffDetail({ query }, req.params.id))
  }),
)
