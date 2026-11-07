// Partner Network for staff (docs/partner-network.md): managers and operators
// (access.js lists what operators may call; the rest is managers only).
// Each change writes its staff_audit row in the same transaction as the change.
// The audit keeps what changed and lengths, not the text of notes or messages
// (those stay on the enquiry, visible to staff only).
// While PARTNER_NETWORK is off every route answers 404.
import express from 'express'
import { z } from 'zod'
import { query, tx } from '../db.js'
import { asyncHandler, forbidden, notFound, parse } from '../errors.js'
import { isOn } from '../feature-switches.js'
import { photoBytes } from '../photos.js'
import { auditNow } from '../staff-audit.js'
import { CATEGORY_CODES, INDIAN_STATES } from '../partner/questionnaire.js'
import {
  addFollowup, addNote, categoriesForStaff, CONTACT_CHANNELS, decide, documentRow, ENQUIRY_STATUSES, enquiryDetail, EXPORT_MAX_ROWS, exportCsv,
  listEnquiries, listProposals, overview, PRIORITIES, PROPOSAL_FINAL, PROPOSAL_STATUSES, proposalDetail, proposalEnquiry, recordContact, requestInfo, updateCategory,
  updateEnquiry, updateFollowup, updateProposal,
} from '../partner/staff.js'

export const router = express.Router()
const P = '/partner-network'

router.use(P, (_req, _res, next) => next(isOn('PARTNER_NETWORK') ? undefined : notFound()))

const managerOnly = (req) => {
  if (req.admin.role !== 'MANAGER') throw forbidden('Only a manager can do this')
}
const ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const text = (min, max, msg) => z.string().trim().min(min, msg ?? `Write at least ${min} characters`).max(max, `Keep it under ${max} characters`)
const reason = text(5, 1000, 'Say why (5 characters or more). It is kept in the activity history.')

const listFilters = z.object({
  q: z.string().trim().max(120).optional(),
  // One status or several, comma-separated (NEW,UNDER_REVIEW is "pending review").
  status: z.string().max(200).transform((s) => s.split(',').filter(Boolean)).pipe(z.array(z.enum(ENQUIRY_STATUSES)).max(7)).optional(),
  category: z.enum(CATEGORY_CODES).optional(),
  state: z.string().trim().max(80).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignedTo: z.union([z.literal('me'), z.literal('none'), ID]).optional(),
  from: DAY.optional(),
  to: DAY.optional(),
  sort: z.enum(['submitted', 'name', 'status', 'priority', 'state', 'reference']).default('submitted'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
})
const clean = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? undefined : v]))

const detail = (req, id) => enquiryDetail({ query }, id, req.admin)

// ---------------------------------------------------------------- overview and list

router.get(`${P}/overview`, asyncHandler(async (_req, res) => res.json(await overview({ query }))))

router.get(
  `${P}/enquiries`,
  asyncHandler(async (req, res) => res.json(await listEnquiries({ query }, parse(listFilters, clean(req.query)), req.admin))),
)

router.get(
  `${P}/enquiries/export.csv`,
  asyncHandler(async (req, res) => {
    managerOnly(req)
    const f = parse(listFilters, clean(req.query))
    const { csv, count } = await exportCsv({ query }, f, req.admin)
    await auditNow(req, 'EXPORT partner enquiries', { detail: { rows: count, max: EXPORT_MAX_ROWS, filters: { ...f, q: f.q ? '(search)' : undefined } } })
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="partner-enquiries.csv"').set('Cache-Control', 'no-store').send(csv)
  }),
)

router.get(`${P}/enquiries/:id`, asyncHandler(async (req, res) => res.set('Cache-Control', 'no-store').json(await detail(req, req.params.id))))

// ---------------------------------------------------------------- changes

router.patch(
  `${P}/enquiries/:id`,
  asyncHandler(async (req, res) => {
    const b = parse(
      z.object({ status: z.enum(ENQUIRY_STATUSES).optional(), priority: z.enum(PRIORITIES).optional(), assignedTo: ID.nullable().optional(), reason: text(1, 1000).optional() })
        .strict()
        .refine((x) => x.status !== undefined || x.priority !== undefined || x.assignedTo !== undefined, 'Change the status, priority or assignment'),
      req.body ?? {},
    )
    await tx(async (c) => {
      const changed = await updateEnquiry(c, req.params.id, req.admin, b)
      if (Object.keys(changed).length) await auditNow(req, 'UPDATE partner enquiry', { target: req.params.id, detail: changed }, c)
    })
    res.json(await detail(req, req.params.id))
  }),
)

router.post(
  `${P}/enquiries/:id/notes`,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ note: text(1, 3000, 'Write a note') }).strict(), req.body ?? {})
    await tx(async (c) => {
      const noteId = await addNote(c, req.params.id, req.admin, b.note)
      await auditNow(req, 'NOTE partner enquiry', { target: req.params.id, detail: { noteId, length: b.note.length } }, c)
    })
    res.status(201).json(await detail(req, req.params.id))
  }),
)

const followupBody = z.object({
  scheduledAt: z.coerce.date({ message: 'Choose a date and time' }),
  assignedTo: ID.nullable().optional(),
  notes: z.string().trim().max(1000, 'Keep it under 1000 characters').optional(),
}).strict()

router.post(
  `${P}/enquiries/:id/followups`,
  asyncHandler(async (req, res) => {
    const b = parse(followupBody, req.body ?? {})
    await tx(async (c) => {
      const fid = await addFollowup(c, req.params.id, req.admin, b)
      await auditNow(req, 'FOLLOWUP partner enquiry', { target: req.params.id, detail: { followupId: fid, scheduledAt: b.scheduledAt } }, c)
    })
    res.status(201).json(await detail(req, req.params.id))
  }),
)

router.patch(
  `${P}/enquiries/:id/followups/:followupId`,
  asyncHandler(async (req, res) => {
    const b = parse(
      z.object({
        scheduledAt: z.coerce.date().optional(), assignedTo: ID.nullable().optional(), notes: z.string().trim().max(1000).optional(),
        status: z.enum(['PENDING', 'DONE', 'CANCELLED']).optional(),
      }).strict(),
      req.body ?? {},
    )
    await tx(async (c) => {
      await updateFollowup(c, req.params.id, req.params.followupId, req.admin, b)
      await auditNow(req, 'UPDATE partner follow-up', { target: req.params.id, detail: { followupId: req.params.followupId, status: b.status, scheduledAt: b.scheduledAt } }, c)
    })
    res.json(await detail(req, req.params.id))
  }),
)

router.post(
  `${P}/enquiries/:id/contact-attempts`,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ channel: z.enum(CONTACT_CHANNELS), note: z.string().trim().max(500).optional() }).strict(), req.body ?? {})
    await tx(async (c) => {
      await recordContact(c, req.params.id, req.admin, b.channel, b.note)
      await auditNow(req, 'CONTACT partner applicant', { target: req.params.id, detail: { channel: b.channel } }, c)
    })
    res.status(201).json(await detail(req, req.params.id))
  }),
)

router.post(
  `${P}/enquiries/:id/request-info`,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ channel: z.enum(CONTACT_CHANNELS), message: text(5, 2000, 'Write what you need (5 characters or more)') }).strict(), req.body ?? {})
    await tx(async (c) => {
      await requestInfo(c, req.params.id, req.admin, b.channel, b.message)
      await auditNow(req, 'REQUEST INFO partner applicant', { target: req.params.id, detail: { channel: b.channel, length: b.message.length } }, c)
    })
    res.status(201).json(await detail(req, req.params.id))
  }),
)

const ACTION_BODIES = {
  approve: z.object({ note: z.string().trim().max(1000).optional() }).strict(),
  reject: z.object({ reason }).strict(),
  close: z.object({ reason }).strict(),
  reopen: z.object({ reason }).strict(),
  convert: z.object({ title: text(3, 160, 'Give the opportunity a title (3 characters or more)'), notes: z.string().trim().max(3000).optional() }).strict(),
}
for (const [action, schema] of Object.entries(ACTION_BODIES)) {
  router.post(
    `${P}/enquiries/:id/${action}`,
    asyncHandler(async (req, res) => {
      managerOnly(req)
      const b = parse(schema, req.body ?? {})
      await tx(async (c) => {
        const moved = await decide(c, req.params.id, req.admin, action, b)
        await auditNow(req, `${action.toUpperCase()} partner enquiry`, { target: req.params.id, detail: { ...moved, reason: b.reason, title: b.title } }, c)
      })
      res.json(await detail(req, req.params.id))
    }),
  )
}

router.get(
  `${P}/enquiries/:id/documents/:documentId`,
  asyncHandler(async (req, res) => {
    const d = await documentRow({ query }, req.params.id, req.params.documentId)
    const bytes = await photoBytes(d)
    const inline = req.query.inline === '1' && d.mime_type.startsWith('image/')
    const name = d.original_filename.replace(/[^\x20-\x7e]/g, '_')
    res
      .set('Content-Type', d.mime_type)
      .set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(d.original_filename)}`)
      .set('X-Content-Type-Options', 'nosniff')
      .set('Content-Security-Policy', "default-src 'none'; sandbox")
      .set('Cache-Control', 'private, no-store')
      .send(bytes)
  }),
)

// ---------------------------------------------------------------- product proposals

router.get(
  `${P}/product-proposals`,
  asyncHandler(async (req, res) => {
    const f = parse(
      z.object({
        // One status, several comma-separated, or "open" for every status that is not final.
        status: z.string().max(200).transform((s) => (s === 'open' ? PROPOSAL_STATUSES.filter((x) => !PROPOSAL_FINAL.includes(x)) : s.split(',').filter(Boolean))).pipe(z.array(z.enum(PROPOSAL_STATUSES)).max(8)).optional(), q: z.string().trim().max(120).optional(),
        page: z.coerce.number().int().min(1).max(10_000).default(1), pageSize: z.coerce.number().int().min(10).max(100).default(25),
      }),
      clean(req.query),
    )
    res.json(await listProposals({ query }, f))
  }),
)

router.get(`${P}/product-proposals/:id`, asyncHandler(async (req, res) => res.set('Cache-Control', 'no-store').json(await proposalDetail({ query }, req.params.id, req.admin))))

router.patch(
  `${P}/product-proposals/:id`,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ status: z.enum(PROPOSAL_STATUSES), reason: reason.optional() }).strict(), req.body ?? {})
    await tx(async (c) => {
      const moved = await updateProposal(c, req.params.id, req.admin, b)
      await auditNow(req, 'UPDATE product proposal', { target: req.params.id, detail: { from: moved.from, to: moved.to, reason: b.reason } }, c)
    })
    res.json(await proposalDetail({ query }, req.params.id, req.admin))
  }),
)

router.post(
  `${P}/product-proposals/:id/notes`,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ note: text(1, 3000, 'Write a note') }).strict(), req.body ?? {})
    await tx(async (c) => {
      const enquiryId = await proposalEnquiry(c, req.params.id)
      const noteId = await addNote(c, enquiryId, req.admin, b.note, req.params.id)
      await auditNow(req, 'NOTE product proposal', { target: req.params.id, detail: { noteId, length: b.note.length } }, c)
    })
    res.status(201).json(await proposalDetail({ query }, req.params.id, req.admin))
  }),
)

router.post(
  `${P}/product-proposals/:id/request-sample`,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ note: z.string().trim().max(1000).optional() }).strict(), req.body ?? {})
    await tx(async (c) => {
      const moved = await updateProposal(c, req.params.id, req.admin, { status: 'SAMPLE_REQUESTED', reason: null }, 'SAMPLE_REQUESTED')
      if (b.note) await addNote(c, moved.enquiryId ?? (await proposalEnquiry(c, req.params.id)), req.admin, `Samples requested: ${b.note}`, req.params.id)
      await auditNow(req, 'REQUEST SAMPLE product proposal', { target: req.params.id, detail: { from: moved.from } }, c)
    })
    res.json(await proposalDetail({ query }, req.params.id, req.admin))
  }),
)

// ---------------------------------------------------------------- categories

router.get(`${P}/categories`, asyncHandler(async (_req, res) => res.json({ categories: await categoriesForStaff({ query }), states: INDIAN_STATES })))

router.patch(
  `${P}/categories/:code`,
  asyncHandler(async (req, res) => {
    managerOnly(req)
    const b = parse(
      z.object({
        name: text(2, 80).optional(), description: text(2, 600).optional(), active: z.boolean().optional(), displayOrder: z.number().int().min(0).max(1000).optional(),
      }).strict().refine((x) => Object.keys(x).length > 0, 'Change something'),
      req.body ?? {},
    )
    await tx(async (c) => {
      const change = await updateCategory(c, req.params.code, b)
      await auditNow(req, 'UPDATE partnership category', { target: req.params.code, detail: change }, c)
    })
    res.json({ categories: await categoriesForStaff({ query }) })
  }),
)
