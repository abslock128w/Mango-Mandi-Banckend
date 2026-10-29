// WhatsApp conversations and messages (docs/whatsapp/CONVERSATIONS.md).
//
// One conversation per number. Every inbound message is recorded with Meta's
// id (unique, so a redelivery is recorded once). Every free-form outbound
// message (the bot's replies, staff replies) is first written QUEUED in the
// transaction that decided to send it, then sent: a reply decided but not yet
// sent when an instance dies is sent by the maintenance run, never lost and
// never sent twice (each send claims its row first).
//
// The 24-hour rule: free-form messages may go only within 24 hours of the
// customer's last message (last_inbound_at). Outside it the send is refused
// here, before Meta is called; order updates use approved templates instead.
import { now } from '../clock.js'
import { query, tx } from '../db.js'
import { env } from '../env.js'
import { HttpError } from '../errors.js'
import { newId } from '../ids.js'
import { logger, maskPhone } from '../logger.js'
import { metrics } from '../metrics.js'
import { sendOutcome } from '../whatsapp.js'

/** The customer service window. */
export const WINDOW_MS = 24 * 3_600_000
/** A claimed message is left alone this long if its sender dies mid-send. */
const CLAIM_MS = 2 * 60_000
/** Tries for a free-form message that failed for a passing reason, with the wait before each retry. */
export const MESSAGE_RETRY_MINUTES = [1, 2, 5]
/** INT-12: the pause before the in-turn retry of a chat reply that failed for a passing reason. */
export const CHAT_RETRY_MS = 1_500

const clip = (s, n) => (s == null ? null : String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s))

/**
 * Retry waits get +0 to 25% jitter, so many messages failing together don't all come back in
 * the same second. Never shorter than the wait itself. Tests run without it (exact clocks).
 */
export const RETRY_JITTER = env.NODE_ENV === 'test' ? 0 : 0.25
export const jitter = (ms, spread = RETRY_JITTER, rand = Math.random) => Math.round(ms * (1 + spread * rand()))

/** The Cloud API message type a chat reply goes as. */
export function replyType(r) {
  if (r.type === 'pay') return 'order_details'
  if (r.type === 'buttons' || r.type === 'list' || r.type === 'link') return 'interactive'
  return 'text'
}

/** Whether a free-form message may go to this conversation at `at`. */
export const windowOpen = (conv, at = now()) => Boolean(conv?.last_inbound_at) && at.getTime() - new Date(conv.last_inbound_at).getTime() < WINDOW_MS

/** The conversation for a number, made on first contact. */
export async function ensureConversation(c, phone, customerId = null) {
  const at = now()
  const { rows } = await c.query(
    `INSERT INTO wa_conversations (id, phone, customer_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (phone) DO UPDATE SET customer_id = COALESCE(wa_conversations.customer_id, EXCLUDED.customer_id)
     RETURNING *`,
    [newId('wac'), phone, customerId, at],
  )
  return rows[0]
}

/**
 * Records a customer's message and opens (or keeps open) the 24-hour window.
 * Returns false when this Meta message id was already recorded.
 */
export async function recordInbound(c, conv, { providerId, type, body = null, media = null, correlationId = null }) {
  const at = now()
  const ins = await c.query(
    `INSERT INTO wa_messages (id, conversation_id, direction, type, body, author, provider_id, status, media, correlation_id, created_at, status_at)
     VALUES ($1, $2, 'IN', $3, $4, 'customer', $5, 'RECEIVED', $6, $7, $8, $8)
     ON CONFLICT (provider_id) WHERE provider_id IS NOT NULL DO NOTHING`,
    [newId('wam'), conv.id, type, clip(body, 4096), providerId, media, correlationId, at],
  )
  if (!ins.rowCount) return false
  // Staff need to see it when they hold the conversation or someone is waiting for them.
  const forStaff = conv.mode === 'STAFF' || conv.status === 'WAITING'
  await c.query(
    `UPDATE wa_conversations SET last_inbound_at = $2, updated_at = $2, unread = unread + $3,
            status = CASE WHEN status = 'CLOSED' THEN 'OPEN' ELSE status END WHERE id = $1`,
    [conv.id, at, forStaff ? 1 : 0],
  )
  metrics.whatsappMessages.inc({ direction: 'in', type })
  return true
}

/** Queues a free-form message (a chat reply or a staff reply) in the caller's transaction. Returns its id. */
export async function queueMessage(c, conv, reply, { author = 'bot', correlationId = null } = {}) {
  const id = newId('wam')
  const at = now()
  await c.query(
    `INSERT INTO wa_messages (id, conversation_id, direction, type, body, payload, author, status, next_attempt_at, correlation_id, created_at)
     VALUES ($1, $2, 'OUT', $3, $4, $5, $6, 'QUEUED', $7, $8, $7)`,
    [id, conv.id, replyType(reply), clip(reply.text, 4096), reply, clip(author, 80), at, correlationId],
  )
  return id
}

/** Claims one queued message for sending; null when it is not due or another sender has it. */
async function claim(id, at) {
  const { rows } = await query(
    `UPDATE wa_messages m SET next_attempt_at = $3
       FROM wa_conversations v
      WHERE m.id = $1 AND m.status = 'QUEUED' AND m.next_attempt_at <= $2 AND v.id = m.conversation_id
      RETURNING m.*, v.phone, v.last_inbound_at`,
    [id, at, new Date(at.getTime() + CLAIM_MS)],
  )
  return rows[0] ?? null
}

async function markSent(m, providerId, at) {
  const fields = [m.id, providerId, at, m.attempts + 1]
  const sql = `UPDATE wa_messages SET status = 'SENT', provider_id = $2, status_at = $3, attempts = $4, payload = NULL, error = NULL, next_attempt_at = NULL WHERE id = $1`
  // Sent: record it outside the send's error handling, so a database hiccup here never sends a second copy.
  await query(sql, fields).catch(() => query(sql, fields)).catch((err) => logger.error({ err, id: m.id }, 'WhatsApp message sent but not recorded'))
  await query('UPDATE wa_conversations SET last_outbound_at = $2, updated_at = $2 WHERE id = $1', [m.conversation_id, at]).catch(() => {})
  metrics.whatsappMessages.inc({ direction: 'out', type: m.type })
}

async function markFailed(m, status, error, at) {
  await query(`UPDATE wa_messages SET status = $2, error = $3, status_at = $4, attempts = attempts + 1, next_attempt_at = NULL WHERE id = $1`, [m.id, status, clip(error, 500), at])
  metrics.whatsappFailures.inc({ outcome: status === 'UNKNOWN' ? 'unknown' : 'failed' })
}

/**
 * Sends one queued message, once. Returns 'sent', 'retry' (left queued for a
 * later try), 'failed', 'unknown' or null (not claimed).
 * `inTurnRetry`: INT-12, one quick retry inside the chat turn (PROVIDER_CHECKS).
 */
export async function sendQueued(id, send, { inTurnRetry = false } = {}) {
  const at = now()
  const m = await claim(id, at)
  if (!m) return null
  if (!windowOpen(m, at)) {
    // Never sent outside the window: Meta would refuse it, and it is not allowed.
    await markFailed(m, 'FAILED', 'WINDOW_CLOSED: more than 24 hours since the customer last wrote', at)
    return 'failed'
  }
  let lastErr
  for (let tryNo = 0; tryNo < (inTurnRetry ? 2 : 1); tryNo++) {
    if (tryNo > 0) {
      logger.warn({ err: lastErr, phone: maskPhone(m.phone) }, 'WhatsApp chat reply failed; trying once more')
      await new Promise((res) => {
        setTimeout(res, CHAT_RETRY_MS)
      })
    }
    try {
      const providerId = await send(m.phone, m.payload)
      await markSent(m, providerId ?? null, now())
      return 'sent'
    } catch (err) {
      lastErr = err
      if (sendOutcome(err) !== 'retry') break
    }
  }
  const outcome = sendOutcome(lastErr)
  const why = String(lastErr?.message ?? lastErr).slice(0, 400)
  if (outcome === 'unknown') {
    logger.error({ err: lastErr, phone: maskPhone(m.phone), id: m.id }, 'WhatsApp gave no answer in time; the message is not resent automatically')
    await markFailed(m, 'UNKNOWN', `UNKNOWN: ${why}. WhatsApp may have delivered it; not resent automatically`, now())
    return 'unknown'
  }
  const attempts = m.attempts + 1
  const wait = outcome === 'retry' ? MESSAGE_RETRY_MINUTES.at(attempts - 1) : null
  if (wait == null) {
    logger.error({ err: lastErr, phone: maskPhone(m.phone), id: m.id }, 'WhatsApp chat reply failed')
    await markFailed(m, 'FAILED', why, now())
    return 'failed'
  }
  logger.warn({ err: lastErr, phone: maskPhone(m.phone), id: m.id, attempts }, 'WhatsApp message failed; it will be tried again')
  await query('UPDATE wa_messages SET attempts = $2, error = $3, next_attempt_at = $4 WHERE id = $1', [m.id, attempts, why, new Date(now().getTime() + jitter(wait * 60_000))])
  return 'retry'
}

/** Sends queued messages in order (one conversation's replies arrive in the order they were made). */
export async function sendMessages(ids, send, opts = {}) {
  const out = []
  for (const id of ids) out.push(await sendQueued(id, send, opts))
  return out
}

/** The maintenance step: queued messages that are due (an instance died before sending, or a retry). */
export async function sendDueMessages(send, { limit = 50 } = {}) {
  const at = now()
  const { rows } = await query(
    `SELECT id FROM wa_messages WHERE status = 'QUEUED' AND next_attempt_at <= $1 ORDER BY conversation_id, created_at LIMIT $2`,
    [at, limit],
  )
  let sent = 0
  for (const r of rows) if ((await sendQueued(r.id, send)) === 'sent') sent++
  return sent
}

const RANK = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 }

/**
 * Meta's status for a message we sent (free-form or template). Statuses can
 * arrive late, twice or out of order: a status never moves a message
 * backwards (read stays read), and failed wins over sent and delivered.
 */
export async function recordMessageStatus(st) {
  const status = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' }[st?.status]
  if (!st?.id || !status) return 0
  const at = st.timestamp && /^\d+$/.test(String(st.timestamp)) ? new Date(Number(st.timestamp) * 1000) : now()
  if (status === 'FAILED') {
    const why = (st.errors ?? []).map((e) => `${e.code ?? ''} ${e.title ?? e.message ?? ''}`.trim()).join('; ') || 'failed at WhatsApp'
    const r = await query(
      `UPDATE wa_messages SET status = 'FAILED', error = $2, status_at = $3 WHERE provider_id = $1 AND direction = 'OUT' AND status <> 'READ'`,
      [st.id, clip(`Not delivered: ${why}`, 500), at],
    )
    return r.rowCount
  }
  const r = await query(
    `UPDATE wa_messages SET status = $2, status_at = $3
      WHERE provider_id = $1 AND direction = 'OUT' AND status IN ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'UNKNOWN')
        AND (CASE status WHEN 'QUEUED' THEN 0 WHEN 'SENT' THEN 1 WHEN 'DELIVERED' THEN 2 WHEN 'READ' THEN 3 ELSE 0 END) < $4`,
    [st.id, status, at, RANK[status]],
  )
  return r.rowCount
}

/** Records an order update (template) that went out, so the conversation shows it. Never throws. */
export async function recordTemplateSent({ phone, customerId = null, template, summary, providerId, notificationId }) {
  try {
    await tx(async (c) => {
      const conv = await ensureConversation(c, phone, customerId)
      const at = now()
      await c.query(
        `INSERT INTO wa_messages (id, conversation_id, direction, type, body, template, author, provider_id, status, notification_id, created_at, status_at)
         VALUES ($1, $2, 'OUT', 'template', $3, $4, 'system', $5, 'SENT', $6, $7, $7)
         ON CONFLICT (provider_id) WHERE provider_id IS NOT NULL DO NOTHING`,
        [newId('wam'), conv.id, clip(summary, 4096), template, providerId, notificationId, at],
      )
      await c.query('UPDATE wa_conversations SET last_outbound_at = $2 WHERE id = $1', [conv.id, at])
    })
  } catch (err) {
    logger.warn({ err, phone: maskPhone(phone) }, 'could not record a sent order update in its conversation')
  }
}

// ---------------------------------------------------------------- handoff

/** The customer asked for a person (or sent something only a person can read): the bot steps back. */
export async function handOffToStaff(c, conv, reason) {
  const at = now()
  const { rows } = await c.query(
    `UPDATE wa_conversations SET mode = 'STAFF', status = CASE WHEN assigned_admin_id IS NULL THEN 'WAITING' ELSE 'OPEN' END,
            waiting_since = COALESCE(waiting_since, CASE WHEN assigned_admin_id IS NULL THEN $2::timestamptz END),
            handoff_reason = $3, unread = GREATEST(unread, 1), updated_at = $2
      WHERE id = $1 RETURNING *`,
    [conv.id, at, clip(reason, 200)],
  )
  return rows[0]
}

/** A staff member takes the conversation: assigned to them, the bot quiet. */
export async function takeOver(c, id, adminId) {
  const { rows } = await c.query(
    `UPDATE wa_conversations SET mode = 'STAFF', status = 'OPEN', assigned_admin_id = $2, waiting_since = NULL, updated_at = $3
      WHERE id = $1 RETURNING *`,
    [id, adminId, now()],
  )
  if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found')
  return rows[0]
}

/** Assigns the conversation to a staff member (or nobody). */
export async function assign(c, id, adminId) {
  if (adminId) {
    const { rows } = await c.query(`SELECT 1 FROM admin_users WHERE id = $1 AND role IN ('MANAGER', 'OPERATOR')`, [adminId])
    if (!rows.length) throw new HttpError(400, 'VALIDATION_ERROR', 'Pick a manager or operator who can answer chats')
  }
  const { rows } = await c.query('UPDATE wa_conversations SET assigned_admin_id = $2, updated_at = $3 WHERE id = $1 RETURNING *', [id, adminId, now()])
  if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found')
  return rows[0]
}

/** Staff give the conversation back to the bot; the chat starts again at the menu. */
export async function handBack(c, id) {
  const { rows } = await c.query(
    `UPDATE wa_conversations SET mode = 'BOT', status = 'OPEN', waiting_since = NULL, handoff_reason = NULL, unread = 0, updated_at = $2
      WHERE id = $1 RETURNING *`,
    [id, now()],
  )
  if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found')
  // The chat was paused mid-way perhaps: a half-built cart from before the handoff is not resumed.
  await c.query(`UPDATE wa_sessions SET state = 'IDLE', data = jsonb_build_object('pincode', data->'pincode') WHERE phone = $1 AND state <> 'AWAITING_PAYMENT'`, [rows[0].phone])
  return rows[0]
}

/** Staff close the conversation: back to the bot, nothing waiting. */
export async function closeConversation(c, id) {
  const { rows } = await c.query(
    `UPDATE wa_conversations SET mode = 'BOT', status = 'CLOSED', waiting_since = NULL, unread = 0, updated_at = $2 WHERE id = $1 RETURNING *`,
    [id, now()],
  )
  if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found')
  return rows[0]
}

/** Longest staff reply. */
export const STAFF_REPLY_MAX = 2000

/**
 * A staff reply: refused outside the 24-hour window, else queued in the
 * caller's transaction (sent after commit). Replying takes the conversation
 * over, so the bot doesn't answer the customer's next message as well.
 */
export async function staffReply(c, id, admin, text) {
  const { rows } = await c.query('SELECT * FROM wa_conversations WHERE id = $1 FOR UPDATE', [id])
  const conv = rows[0]
  if (!conv) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found')
  if (!windowOpen(conv)) {
    throw new HttpError(409, 'WINDOW_CLOSED', 'More than 24 hours have passed since the customer last wrote, so WhatsApp only allows approved templates. Ask them to message us first.')
  }
  await c.query(
    `UPDATE wa_conversations SET mode = 'STAFF', status = 'OPEN', assigned_admin_id = COALESCE(assigned_admin_id, $2), waiting_since = NULL, unread = 0, updated_at = $3 WHERE id = $1`,
    [id, admin.id, now()],
  )
  return queueMessage(c, conv, { type: 'text', text }, { author: `staff:${admin.id}` })
}
