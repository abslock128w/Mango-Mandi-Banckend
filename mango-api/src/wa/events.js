// WhatsApp account health from Meta's webhook (docs/whatsapp/WEBHOOKS.md):
// template approvals and pauses, template category and quality changes, the
// phone number's quality and messaging limit, and account-level updates and
// alerts. Each is kept in wa_account_events (90 days). A template's new status
// is written to wa_templates, so the sender stops using a paused or rejected
// template at once. Bad news reaches a person (Sentry, with OPS_ALERTS).
import { now } from '../clock.js'
import { query } from '../db.js'
import { env } from '../env.js'
import { newId } from '../ids.js'
import { logger } from '../logger.js'
import { reportProblem } from '../sentry.js'

/** Fields we keep. Others (and unknown keys inside these) are dropped. */
const KEEP = {
  message_template_status_update: ['event', 'message_template_id', 'message_template_name', 'message_template_language', 'reason', 'other_info'],
  message_template_quality_update: ['previous_quality_score', 'new_quality_score', 'message_template_id', 'message_template_name', 'message_template_language'],
  template_category_update: ['message_template_id', 'message_template_name', 'message_template_language', 'previous_category', 'new_category', 'correct_category'],
  phone_number_quality_update: ['display_phone_number', 'event', 'current_limit', 'old_limit', 'max_daily_conversation_per_phone'],
  phone_number_name_update: ['display_phone_number', 'decision', 'requested_verified_name', 'rejection_reason'],
  account_update: ['phone_number', 'event', 'ban_info', 'restriction_info', 'violation_info', 'lock_info'],
  account_review_update: ['decision'],
  account_alerts: ['entity_type', 'entity_id', 'alert_severity', 'alert_status', 'alert_type', 'alert_description'],
  business_capability_update: ['max_daily_conversation_per_phone', 'max_phone_numbers_per_business', 'max_daily_conversations_per_business'],
  security: ['display_phone_number', 'event', 'requester'],
}

const BAD = {
  message_template_status_update: (v) => ['REJECTED', 'PAUSED', 'DISABLED', 'FLAGGED', 'PENDING_DELETION', 'LIMIT_EXCEEDED'].includes(v.event),
  message_template_quality_update: (v) => ['RED', 'YELLOW'].includes(v.new_quality_score),
  phone_number_quality_update: (v) => ['FLAGGED', 'DOWNGRADE'].includes(v.event),
  phone_number_name_update: (v) => v.decision === 'REJECTED',
  account_update: (v) => /DISABLED|BAN|RESTRICT|VIOLATION|LOCKED/.test(String(v.event ?? '')),
  account_review_update: (v) => v.decision === 'REJECTED',
  account_alerts: (v) => ['CRITICAL', 'HIGH'].includes(v.alert_severity),
  security: () => true,
}

/** A JSON value cut down to a small, flat shape (strings clipped, depth 2). */
function trimValue(x, depth = 0) {
  if (x == null || typeof x === 'number' || typeof x === 'boolean') return x
  if (typeof x === 'string') return x.slice(0, 300)
  if (depth >= 2) return null
  if (Array.isArray(x)) return x.slice(0, 10).map((y) => trimValue(y, depth + 1))
  if (typeof x === 'object') return Object.fromEntries(Object.entries(x).slice(0, 20).map(([k, v]) => [k.slice(0, 60), trimValue(v, depth + 1)]))
  return null
}

/** Records one non-message change from the webhook. Returns 1 when recorded, 0 when ignored. */
export async function handleAccountChange(entry, change) {
  const field = typeof change?.field === 'string' ? change.field.slice(0, 60) : null
  const keep = field ? KEEP[field] : null
  if (!keep) {
    logger.info({ field }, 'WhatsApp webhook field ignored')
    return 0
  }
  const v = change.value && typeof change.value === 'object' ? change.value : {}
  const detail = Object.fromEntries(keep.filter((k) => k in v).map((k) => [k, trimValue(v[k])]))
  if (entry?.id) detail.waba_id = String(entry.id).slice(0, 40)
  const event = String(detail.event ?? detail.decision ?? detail.new_quality_score ?? detail.new_category ?? detail.alert_type ?? '').slice(0, 80) || null
  const at = now()
  await query('INSERT INTO wa_account_events (id, field, event, detail, created_at) VALUES ($1, $2, $3, $4, $5)', [newId('wae'), field, event, detail, at])

  const name = typeof v.message_template_name === 'string' ? v.message_template_name : null
  const lang = typeof v.message_template_language === 'string' ? v.message_template_language : null
  if (name && lang && /^[a-z0-9_]{1,512}$/.test(name)) {
    if (field === 'message_template_status_update' && typeof v.event === 'string') {
      await query(
        `INSERT INTO wa_templates (name, language, status, meta_id, reason, synced_at) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name, language) DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason, meta_id = COALESCE(EXCLUDED.meta_id, wa_templates.meta_id), synced_at = EXCLUDED.synced_at`,
        [name, lang.slice(0, 20), v.event.slice(0, 40), v.message_template_id ? String(v.message_template_id).slice(0, 40) : null, v.reason ? String(v.reason).slice(0, 500) : null, at],
      )
    }
    if (field === 'template_category_update' && typeof v.new_category === 'string') {
      await query('UPDATE wa_templates SET category = $3, synced_at = $4 WHERE name = $1 AND language = $2', [name, lang, v.new_category.slice(0, 40), at])
    }
  }
  if (BAD[field]?.(v)) {
    const what = `WhatsApp ${field.replaceAll('_', ' ')}: ${event ?? 'see the WhatsApp page'}${name ? ` (${name})` : ''}`
    logger.error({ field, event, template: name }, what)
    if (env.OPS_ALERTS) reportProblem(what, { field, event, template: name })
  }
  return 1
}
