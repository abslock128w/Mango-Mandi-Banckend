// The panel's WhatsApp page (docs/whatsapp/OPERATIONS.md): the inbox (managers
// and operators: read, reply, take over, assign, hand back, close, record an
// opt-out a customer asked for on the phone), and the set-up and health view
// (managers: configuration, the live connection check, template sync, a switch
// per automated message, failed messages and events with retry and replay).
//
// Phones are masked to their last 4 digits in lists; the full number stays on
// the customer profile behind its own audited reveal. Every change writes its
// staff_audit row in the same transaction. Opening a conversation is a
// recorded read (policy.js READ_AUDITED_ROUTES).
import express from 'express'
import { z } from 'zod'
import { requireManager } from '../auth.js'
import { background } from '../background.js'
import { now } from '../clock.js'
import { query, tx } from '../db.js'
import { env } from '../env.js'
import { asyncHandler, badRequest, notFound, parse } from '../errors.js'
import { auditNow } from '../staff-audit.js'
import { stepUp } from './step-up.js'
import { chatMessenger } from '../whatsapp.js'
import { consentFor, setConsent } from '../wa/consent.js'
import {
  assign, closeConversation, handBack, sendMessages, STAFF_REPLY_MAX, staffReply, takeOver, WINDOW_MS, windowOpen,
} from '../wa/conversations.js'
import { connectionCheck, mediaFor, readiness, syncTemplates, templateReport } from '../wa/meta-admin.js'
import { AUTOMATION_KINDS } from '../wa/registry.js'
import { processWhatsAppEvent } from '../webhook-events.js'

export const router = express.Router()

const last4 = (p) => (p ? `•••• ${String(p).slice(-4)}` : null)
const DAY = 86_400_000

const conversationView = (v) => ({
  id: v.id, phone: last4(v.phone), customer: v.customer_id ? { id: v.customer_id, name: v.customer_name ?? null } : null,
  mode: v.mode, status: v.status, assignedTo: v.assigned_admin_id ? { id: v.assigned_admin_id, email: v.assigned_email ?? null } : null,
  handoffReason: v.handoff_reason, waitingSince: v.waiting_since, lastInboundAt: v.last_inbound_at, lastOutboundAt: v.last_outbound_at,
  windowOpenUntil: v.last_inbound_at ? new Date(new Date(v.last_inbound_at).getTime() + WINDOW_MS).toISOString() : null,
  windowOpen: windowOpen(v), unread: v.unread, updatedAt: v.updated_at, preview: v.preview ?? null,
})

const messageView = (m) => ({
  id: m.id, direction: m.direction, type: m.type, body: m.body, template: m.template,
  author: m.author.startsWith('staff:') ? { kind: 'staff', id: m.author.slice(6), email: m.staff_email ?? null } : { kind: m.author },
  status: m.status, error: m.error, createdAt: m.created_at, statusAt: m.status_at,
  media: m.media ? { kind: m.type, mime: m.media.mime ?? null, filename: m.media.filename ?? null, caption: m.media.caption ?? null, location: m.media.latitude != null ? { name: m.media.name, address: m.media.address } : null, canOpen: Boolean(m.media.id) } : null,
})

async function conversation(id) {
  const { rows } = await query(
    `SELECT v.*, cu.name AS customer_name, au.email AS assigned_email FROM wa_conversations v
       LEFT JOIN customers cu ON cu.id = v.customer_id LEFT JOIN admin_users au ON au.id = v.assigned_admin_id WHERE v.id = $1`,
    [id],
  )
  if (!rows.length) throw notFound('Conversation not found')
  return rows[0]
}

async function conversationDetail(id) {
  const v = await conversation(id)
  const { rows: msgs } = await query(
    `SELECT m.*, au.email AS staff_email FROM wa_messages m
       LEFT JOIN admin_users au ON m.author LIKE 'staff:%' AND au.id = substring(m.author from 7)
      WHERE m.conversation_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT 200`,
    [id],
  )
  const consent = await consentFor({ query }, v.phone)
  const { rows: orders } = v.customer_id
    ? await query(`SELECT id, number, status, delivery_date, total FROM orders WHERE customer_id = $1 ORDER BY placed_at DESC LIMIT 5`, [v.customer_id])
    : { rows: [] }
  return {
    conversation: conversationView(v),
    messages: msgs.reverse().map(messageView),
    consent: { updates: consent.updates, marketing: consent.marketing },
    recentOrders: orders.map((o) => ({ id: o.id, number: o.number, status: o.status, deliveryDate: o.delivery_date, total: o.total })),
  }
}

// ---------------------------------------------------------------- inbox

router.get(
  '/whatsapp/conversations',
  asyncHandler(async (req, res) => {
    const f = parse(z.object({
      view: z.enum(['waiting', 'mine', 'staff', 'all']).default('waiting'),
      page: z.coerce.number().int().min(1).max(1000).default(1),
    }), req.query)
    const where = { waiting: "v.status = 'WAITING'", mine: 'v.assigned_admin_id = $2', staff: "v.mode = 'STAFF'", all: 'TRUE' }[f.view]
    const { rows } = await query(
      `SELECT v.*, cu.name AS customer_name, au.email AS assigned_email,
              (SELECT left(m.body, 120) FROM wa_messages m WHERE m.conversation_id = v.id AND m.direction = 'IN' ORDER BY m.created_at DESC LIMIT 1) AS preview
         FROM wa_conversations v LEFT JOIN customers cu ON cu.id = v.customer_id LEFT JOIN admin_users au ON au.id = v.assigned_admin_id
        WHERE ${where} AND v.last_inbound_at IS NOT NULL
        ORDER BY (v.status = 'WAITING') DESC, v.updated_at DESC LIMIT 50 OFFSET ($1 - 1) * 50`,
      f.view === 'mine' ? [f.page, req.admin.id] : [f.page],
    )
    const { rows: counts } = await query(
      `SELECT COUNT(*) FILTER (WHERE status = 'WAITING')::int AS waiting, COUNT(*) FILTER (WHERE mode = 'STAFF')::int AS staff,
              COUNT(*) FILTER (WHERE assigned_admin_id = $1)::int AS mine FROM wa_conversations`,
      [req.admin.id],
    )
    res.json({ conversations: rows.map(conversationView), counts: counts[0] })
  }),
)

router.get(
  '/whatsapp/conversations/:id',
  asyncHandler(async (req, res) => {
    const d = await conversationDetail(req.params.id)
    // Opening a conversation reads its new messages.
    await query('UPDATE wa_conversations SET unread = 0 WHERE id = $1 AND unread > 0', [req.params.id])
    res.json(d)
  }),
)

/** Sends what a staff action queued, after its transaction committed. */
const sendNow = (ids) => background(sendMessages(ids, chatMessenger))

router.post(
  '/whatsapp/conversations/:id/reply',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ text: z.string().trim().min(1, 'Write a reply').max(STAFF_REPLY_MAX, `Keep it under ${STAFF_REPLY_MAX} characters`) }).strict(), req.body ?? {})
    const id = await tx(async (c) => {
      const messageId = await staffReply(c, req.params.id, req.admin, b.text)
      // The words are in wa_messages with who wrote them; the audit says who replied, where and how long.
      await auditNow(req, 'REPLY WhatsApp', { target: req.params.id, detail: { messageId, length: b.text.length } }, c)
      return messageId
    })
    sendNow([id])
    res.status(201).json(await conversationDetail(req.params.id))
  }),
)

const action = (path, label, fn) =>
  router.post(
    path,
    asyncHandler(async (req, res) => {
      await tx(async (c) => {
        await fn(c, req)
        await auditNow(req, label, { target: req.params.id, detail: req.body && Object.keys(req.body).length ? req.body : null }, c)
      })
      res.json(await conversationDetail(req.params.id))
    }),
  )

action('/whatsapp/conversations/:id/take-over', 'TAKE OVER WhatsApp', (c, req) => takeOver(c, req.params.id, req.admin.id))
action('/whatsapp/conversations/:id/hand-back', 'HAND BACK WhatsApp', (c, req) => handBack(c, req.params.id))
action('/whatsapp/conversations/:id/close', 'CLOSE WhatsApp', (c, req) => closeConversation(c, req.params.id))
action('/whatsapp/conversations/:id/assign', 'ASSIGN WhatsApp', (c, req) => {
  const b = parse(z.object({ adminId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullable() }).strict(), req.body ?? {})
  return assign(c, req.params.id, b.adminId)
})
// A customer asked on the phone or in a reply to stop messages: staff record it for them.
// Staff can only record an opt-out; opting in is the customer's own act (START, or the shop).
action('/whatsapp/conversations/:id/opt-out', 'OPT OUT WhatsApp', async (c, req) => {
  const b = parse(z.object({ scope: z.enum(['all', 'marketing']) }).strict(), req.body ?? {})
  const { rows } = await c.query('SELECT phone, customer_id FROM wa_conversations WHERE id = $1', [req.params.id])
  if (!rows.length) throw notFound('Conversation not found')
  await setConsent(c, { phone: rows[0].phone, customerId: rows[0].customer_id, scope: b.scope, action: 'OPT_OUT', source: 'staff', evidence: `staff:${req.admin.id}` })
})

/** A customer's photo or document, fetched from Meta for staff. */
router.get(
  '/whatsapp/media/:id',
  asyncHandler(async (req, res) => {
    const m = await mediaFor(req.params.id)
    res.set({
      'Content-Type': m.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': m.mime.startsWith('image/') ? 'inline' : `attachment${m.filename ? `; filename="${m.filename.replace(/[^\w.-]+/g, '_')}"` : ''}`,
    })
    res.send(m.buffer)
  }),
)

/** Sends a failed or unknown staff or bot message again (only within the 24-hour window). */
router.post(
  '/whatsapp/messages/:id/retry',
  asyncHandler(async (req, res) => {
    const id = await tx(async (c) => {
      const { rows } = await c.query(
        `SELECT m.id, m.body, m.payload, v.last_inbound_at, v.id AS conversation_id FROM wa_messages m JOIN wa_conversations v ON v.id = m.conversation_id
          WHERE m.id = $1 AND m.direction = 'OUT' AND m.type <> 'template' AND m.status IN ('FAILED', 'UNKNOWN') FOR UPDATE OF m`,
        [req.params.id],
      )
      const m = rows[0]
      if (!m) throw notFound('No failed message with that id (order updates are sent again from their own list)')
      if (!windowOpen(m)) throw badRequest('More than 24 hours have passed since the customer last wrote, so it can no longer be sent', 'WINDOW_CLOSED')
      // A message already sent once has no payload left: its words are sent as text.
      const payload = m.payload ?? { type: 'text', text: m.body ?? '' }
      await c.query(`UPDATE wa_messages SET status = 'QUEUED', payload = $2, error = NULL, next_attempt_at = $3 WHERE id = $1`, [m.id, payload, now()])
      await auditNow(req, 'RETRY WhatsApp message', { target: m.conversation_id, detail: { messageId: m.id } }, c)
      return m.id
    })
    sendNow([id])
    res.status(202).json({ queued: id })
  }),
)

// ---------------------------------------------------------------- set-up and health (managers)

router.get(
  '/whatsapp/overview',
  requireManager,
  asyncHandler(async (_req, res) => {
    const since = new Date(now().getTime() - DAY)
    const { rows: [m] } = await query(
      `SELECT
         (SELECT COUNT(*)::int FROM wa_messages WHERE direction = 'IN' AND created_at > $1) AS inbound,
         (SELECT COUNT(*)::int FROM wa_messages WHERE direction = 'OUT' AND type <> 'template' AND created_at > $1 AND status IN ('SENT', 'DELIVERED', 'READ')) AS replies,
         (SELECT COUNT(*)::int FROM notifications WHERE created_at > $1 AND status = 'SENT') AS updates_sent,
         (SELECT COUNT(*)::int FROM notifications WHERE created_at > $1 AND delivery_status = 'delivered') AS updates_delivered,
         (SELECT COUNT(*)::int FROM notifications WHERE created_at > $1 AND delivery_status = 'read') AS updates_read,
         (SELECT COUNT(*)::int FROM notifications WHERE created_at > $1 AND status = 'FAILED') AS updates_failed,
         (SELECT COUNT(*)::int FROM notifications WHERE created_at > $1 AND status = 'SKIPPED') AS updates_skipped,
         (SELECT COUNT(*)::int FROM wa_messages WHERE created_at > $1 AND status IN ('FAILED', 'UNKNOWN')) AS messages_failed,
         (SELECT COUNT(*)::int FROM wa_messages WHERE status = 'QUEUED') AS messages_queued,
         (SELECT COUNT(*)::int FROM wa_conversations WHERE status = 'WAITING') AS waiting,
         (SELECT MIN(waiting_since) FROM wa_conversations WHERE status = 'WAITING') AS oldest_waiting,
         (SELECT COUNT(*)::int FROM wa_consent WHERE updates = 'STOPPED') AS stopped,
         (SELECT MAX(received_at) FROM webhook_events WHERE provider = 'whatsapp') AS last_webhook_at,
         (SELECT COUNT(*)::int FROM webhook_events WHERE provider = 'whatsapp' AND processed_at IS NULL AND received_at > $1) AS webhooks_unprocessed,
         (SELECT COUNT(*)::int FROM webhook_events WHERE provider = 'whatsapp' AND gave_up_at IS NOT NULL AND received_at > $1) AS webhooks_given_up`,
      [since],
    )
    const { rows: checks } = await query(`SELECT detail, created_at FROM wa_account_events WHERE field = 'connection_check' ORDER BY created_at DESC LIMIT 1`)
    const { rows: health } = await query(`SELECT field, event, detail, created_at FROM wa_account_events WHERE field <> 'connection_check' ORDER BY created_at DESC LIMIT 20`)
    res.json({
      readiness: readiness(),
      lastCheck: checks[0] ? { ...checks[0].detail, at: checks[0].created_at } : null,
      metrics: m,
      health: health.map((h) => ({ field: h.field, event: h.event, detail: h.detail, at: h.created_at })),
      templates: await templateReport(),
      webhookUrl: env.WHATSAPP_WEBHOOK_URL || null,
    })
  }),
)

router.post(
  '/whatsapp/check',
  requireManager,
  asyncHandler(async (req, res) => {
    const out = await connectionCheck(req.admin.id)
    await auditNow(req, 'CHECK WhatsApp connection', { detail: { ok: out.ok } })
    res.json(out)
  }),
)

router.post(
  '/whatsapp/templates/sync',
  requireManager,
  asyncHandler(async (req, res) => {
    const report = await syncTemplates()
    await auditNow(req, 'SYNC WhatsApp templates', { detail: { automations: report.automations.length } })
    res.json(report)
  }),
)

router.put(
  '/whatsapp/automations/:kind',
  requireManager,
  asyncHandler(async (req, res) => {
    if (!AUTOMATION_KINDS.includes(req.params.kind)) throw notFound('No automated message of that kind')
    const b = parse(z.object({ enabled: z.boolean(), confirmCode: z.string().max(200).optional() }).strict(), req.body ?? {})
    await stepUp(req) // STEP_UP_ROUTES: asks with STAFF_STEP_UP on (production)
    await tx(async (c) => {
      const { rows } = await c.query('SELECT enabled FROM wa_automations WHERE kind = $1', [req.params.kind])
      await c.query(
        `INSERT INTO wa_automations (kind, enabled, updated_by, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (kind) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
        [req.params.kind, b.enabled, req.admin.id, now()],
      )
      await auditNow(req, 'SWITCH WhatsApp automation', { target: req.params.kind, detail: { enabled: b.enabled, before: rows[0]?.enabled ?? true } }, c)
    })
    res.json(await templateReport())
  }),
)

/** What failed in the last 7 days: order updates, chat and staff messages, and webhook events. */
router.get(
  '/whatsapp/failures',
  requireManager,
  asyncHandler(async (_req, res) => {
    const since = new Date(now().getTime() - 7 * DAY)
    const { rows: updates } = await query(
      `SELECT n.id, n.kind, n.status, n.delivery_status, n.last_error, n.attempts, n.created_at, n.phone, COALESCE(o.number, p.number) AS number
         FROM notifications n LEFT JOIN orders o ON o.id = n.order_id LEFT JOIN preorders p ON p.id = n.preorder_id
        WHERE n.created_at > $1 AND n.status = 'FAILED' ORDER BY n.created_at DESC LIMIT 100`,
      [since],
    )
    const { rows: messages } = await query(
      `SELECT m.id, m.conversation_id, m.type, m.status, m.error, m.attempts, m.created_at, v.phone FROM wa_messages m JOIN wa_conversations v ON v.id = m.conversation_id
        WHERE m.created_at > $1 AND m.status IN ('FAILED', 'UNKNOWN') ORDER BY m.created_at DESC LIMIT 100`,
      [since],
    )
    const { rows: events } = await query(
      `SELECT id, received_at, attempts, last_error, gave_up_at FROM webhook_events
        WHERE provider = 'whatsapp' AND processed_at IS NULL AND received_at > $1 ORDER BY received_at DESC LIMIT 100`,
      [since],
    )
    res.json({
      updates: updates.map((n) => ({ id: n.id, kind: n.kind, number: n.number, phone: last4(n.phone), unknown: n.delivery_status === 'unknown', error: n.last_error, attempts: n.attempts, createdAt: n.created_at })),
      messages: messages.map((x) => ({ id: x.id, conversationId: x.conversation_id, type: x.type, status: x.status, error: x.error, attempts: x.attempts, phone: last4(x.phone), createdAt: x.created_at })),
      events: events.map((e) => ({ id: e.id, receivedAt: e.received_at, attempts: e.attempts, error: e.last_error, gaveUp: Boolean(e.gave_up_at) })),
    })
  }),
)

/** Processes a stored WhatsApp event again now (one that failed or was given up on). Safe: messages are deduplicated. */
router.post(
  '/whatsapp/events/:id/replay',
  requireManager,
  asyncHandler(async (req, res) => {
    const { rows } = await query(`SELECT id, body FROM webhook_events WHERE id = $1 AND provider = 'whatsapp' AND processed_at IS NULL`, [req.params.id])
    if (!rows.length) throw notFound('No unprocessed WhatsApp event with that id')
    await query('UPDATE webhook_events SET gave_up_at = NULL, attempts = attempts + 1, last_attempt_at = $2 WHERE id = $1', [req.params.id, now()])
    let ok = true
    let error = null
    try {
      await processWhatsAppEvent(rows[0].id, JSON.parse(Buffer.from(rows[0].body).toString('utf8')), { reqId: req.id })
    } catch (err) {
      ok = false
      error = String(err?.message ?? err).slice(0, 300)
    }
    await auditNow(req, 'REPLAY WhatsApp event', { target: req.params.id, detail: { ok } })
    res.json({ ok, error })
  }),
)
