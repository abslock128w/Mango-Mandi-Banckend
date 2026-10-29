// Durable webhook intake (migration 045, docs/order-states.md). A signed
// webhook is stored as received, in its own short insert, before it is
// processed; processing marks it done in its own transaction. One that fails
// (or whose instance dies mid-way) is replayed by maintenance after 5 minutes,
// at most WEBHOOK_MAX_REPLAYS times, then listed in Needs attention. The
// sender's own retries still arrive and are deduplicated as before
// (processed_webhooks for Razorpay, wa_inbound for WhatsApp messages), so a
// replay and a retry can't apply an event twice.
import { createHash } from 'node:crypto'
import { outOfTime } from './budget.js'
import { handleWhatsAppWebhook } from './chat.js'
import { now } from './clock.js'
import { query } from './db.js'
import { newId } from './ids.js'
import { logger } from './logger.js'
import { metrics } from './metrics.js'
import { handleWebhook, markWebhookEvent, recordWebhookFailure } from './payments.js'

/** An event still unprocessed this long after it arrived (or after its last replay) is replayed. */
export const WEBHOOK_REPLAY_AFTER_MS = 5 * 60_000
/** Replays before an event is given up on and listed in Needs attention. */
export const WEBHOOK_MAX_REPLAYS = 5
/** Events replayed per maintenance run. */
const REPLAY_BATCH = 20
/** How long stored bodies are kept. WhatsApp bodies hold customers' messages: kept as long as wa_inbound keeps them. */
export const WEBHOOK_RETAIN_DAYS = { razorpay: 30, whatsapp: 7 }

/**
 * Stores one signed webhook as received. A sender's retry of the same event
 * (same dedupe key) finds the stored row. Returns { id, processed }.
 * `eventId`: Razorpay's x-razorpay-event-id. Without one the key is the body's hash.
 */
export async function storeWebhookEvent(provider, raw, { eventId = null, createdAt = null } = {}) {
  const key = eventId ? String(eventId).slice(0, 200) : `sha256:${createHash('sha256').update(raw).digest('hex')}`
  const at = now()
  const { rows } = await query(
    `INSERT INTO webhook_events (id, provider, dedupe_key, event_id, body, event_created_at, received_at, last_attempt_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (provider, dedupe_key) DO UPDATE SET last_attempt_at = GREATEST(webhook_events.last_attempt_at, EXCLUDED.last_attempt_at)
     RETURNING id, processed_at`,
    [newId('whe'), provider, key, eventId ? String(eventId).slice(0, 200) : null, raw, createdAt, at],
  )
  return { id: rows[0].id, processed: Boolean(rows[0].processed_at) }
}

/** Records why processing a stored event failed (its replay will try again). Never throws. */
export async function noteWebhookEventFailure(id, err) {
  if (!id) return
  await query('UPDATE webhook_events SET last_error = $2 WHERE id = $1', [id, String(err?.message ?? err).slice(0, 500)]).catch(() => {})
}

/**
 * Seconds from when the sender says the event happened to now (Razorpay's
 * created_at, in unix seconds), observed in mango_webhook_lag_seconds. Null
 * when the event carries no time.
 */
export function webhookLag(provider, createdAtSeconds, at = now()) {
  if (!Number.isFinite(createdAtSeconds)) return null
  const lag = Math.round((at.getTime() - createdAtSeconds * 1000) / 1000)
  metrics.webhookLag.observe({ provider }, Math.max(0, lag))
  return lag
}

/** Processes one stored event, as the webhook route would have. Throws on failure. */
async function processStored(e) {
  const body = JSON.parse(Buffer.from(e.body).toString('utf8'))
  if (e.provider === 'razorpay') return handleWebhook(body, e.event_id, { intakeId: e.id })
  // WhatsApp: each message has its own transaction and dedupe (wa_inbound), so the event is marked after.
  const handled = await handleWhatsAppWebhook(body, { correlationId: e.id })
  await markWebhookEvent({ query }, e.id)
  return { handled }
}

/** How long the WhatsApp webhook works before answering Meta "accepted" and finishing in the background. */
export const WHATSAPP_WEBHOOK_ANSWER_MS = 2_000

/**
 * Processes a stored WhatsApp event (the webhook route, right after storing it). Marks it
 * done, or records why it failed (the maintenance replay tries again). Returns how many
 * messages and statuses it handled; throws on failure.
 */
export async function processWhatsAppEvent(id, body, { reqId = null } = {}) {
  try {
    const handled = await handleWhatsAppWebhook(body, { correlationId: id })
    // Each message is its own transaction (deduplicated by its id), so the event is marked done after them.
    await markWebhookEvent({ query }, id)
    return handled
  } catch (err) {
    await noteWebhookEventFailure(id, err)
    logger.error({ err, reqId, webhookEventId: id }, 'WhatsApp webhook processing failed')
    metrics.webhookErrors.inc({ source: 'whatsapp' })
    await recordWebhookFailure('whatsapp', err.message, body?.entry?.[0]?.id ?? null).catch(() => {})
    throw err
  }
}

/**
 * The maintenance step: replays events still unprocessed 5 minutes after they
 * arrived (and 5 minutes after each replay), oldest first, a bounded batch per
 * run. Rows are taken with SKIP LOCKED and their attempt counted before the
 * work, so two runs never replay the same event at once. An event replayed
 * WEBHOOK_MAX_REPLAYS times without success is given up on and listed once
 * in Needs attention (webhook problems). Returns counts.
 */
export async function replayWebhookEvents(at = now()) {
  const due = new Date(at.getTime() - WEBHOOK_REPLAY_AFTER_MS)
  const out = { replayed: 0, failed: 0, gaveUp: 0 }
  const spent = await query(
    `UPDATE webhook_events SET gave_up_at = $1
      WHERE id IN (SELECT id FROM webhook_events
                    WHERE processed_at IS NULL AND gave_up_at IS NULL AND attempts >= $2 AND last_attempt_at < $3
                    ORDER BY received_at LIMIT $4 FOR UPDATE SKIP LOCKED)
      RETURNING id, provider, dedupe_key, attempts, last_error`,
    [at, WEBHOOK_MAX_REPLAYS, due, REPLAY_BATCH],
  )
  for (const e of spent.rows) {
    out.gaveUp++
    logger.error({ webhookEventId: e.id, provider: e.provider, attempts: e.attempts }, 'webhook event given up on after its replays')
    await recordWebhookFailure(
      e.provider,
      `A stored ${e.provider === 'razorpay' ? 'Razorpay' : 'WhatsApp'} event (${e.dedupe_key}) still failed after ${e.attempts} replays: ${e.last_error ?? 'no error recorded'}. It needs a manager`,
      e.dedupe_key,
    )
  }
  const { rows } = await query(
    `UPDATE webhook_events SET attempts = attempts + 1, last_attempt_at = $1
      WHERE id IN (SELECT id FROM webhook_events
                    WHERE processed_at IS NULL AND gave_up_at IS NULL AND attempts < $2 AND last_attempt_at < $3
                    ORDER BY received_at LIMIT $4 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [at, WEBHOOK_MAX_REPLAYS, due, REPLAY_BATCH],
  )
  for (const e of rows) {
    // Out of time: the rest are replayed 5 minutes on (their attempt is already counted).
    if (outOfTime(2_000)) break
    try {
      await processStored(e)
      out.replayed++
      logger.warn({ webhookEventId: e.id, provider: e.provider, attempt: e.attempts }, 'stored webhook event replayed')
    } catch (err) {
      out.failed++
      logger.error({ err, webhookEventId: e.id, provider: e.provider, attempt: e.attempts }, 'stored webhook event failed again')
      await noteWebhookEventFailure(e.id, err)
    }
  }
  return out
}

/** Deletes stored events past their retention (bounded per run). */
export async function pruneWebhookEvents(at = now()) {
  let n = 0
  for (const [provider, days] of Object.entries(WEBHOOK_RETAIN_DAYS)) {
    const r = await query(
      `DELETE FROM webhook_events WHERE id IN (SELECT id FROM webhook_events WHERE provider = $1 AND received_at < $2 ORDER BY received_at LIMIT 5000)`,
      [provider, new Date(at.getTime() - days * 86_400_000)],
    )
    n += r.rowCount
  }
  return n
}
