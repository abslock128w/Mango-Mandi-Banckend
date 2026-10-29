// What the panel's WhatsApp page asks Meta (docs/whatsapp/OPERATIONS.md):
// whether the configuration is complete (no call), whether it works (a live
// read of the phone number and the app subscription), Meta's template list,
// and a customer's photo or document for staff. Every call is server-side
// with the system-user token; no Meta URL or token ever reaches a browser.
import { now } from '../clock.js'
import { query, tx } from '../db.js'
import { env } from '../env.js'
import { HttpError } from '../errors.js'
import { newId } from '../ids.js'
import { logger } from '../logger.js'
import { AUTOMATIONS } from './registry.js'
import { templateFor } from '../notify.js'

let fetchImpl = (...a) => fetch(...a)
/** Tests: answer Meta's calls with a stub. Returns the previous one. */
export function useMetaFetchForTests(f) {
  const prev = fetchImpl
  fetchImpl = f
  return prev
}

const GRAPH = 'https://graph.facebook.com'
const CALL_MS = 10_000

/**
 * Why a Graph API call failed, in words an operator can act on:
 * missing_credentials, invalid_token, insufficient_permissions, invalid_configuration,
 * rate_limited, unavailable (Meta down or unreachable) or error.
 */
export function graphProblem(status, body, err = null) {
  if (err) return 'unavailable'
  const code = Number(body?.error?.code)
  if (status === 401 || code === 190 || code === 102) return 'invalid_token'
  if (code === 10 || code === 200 || code === 3 || (code >= 200 && code <= 299)) return 'insufficient_permissions'
  if (code === 100 || code === 803 || status === 404) return 'invalid_configuration'
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80007 || status === 429) return 'rate_limited'
  if (status >= 500 || code === 1 || code === 2) return 'unavailable'
  return 'error'
}

/** One Graph API call. Resolves { ok, status, body, problem }. Never throws. */
export async function graph(path, { method = 'GET', params = null, raw = false } = {}) {
  if (!env.WHATSAPP_TOKEN) return { ok: false, status: 0, body: null, problem: 'missing_credentials' }
  const qs = params ? `?${new URLSearchParams(params)}` : ''
  const url = path.startsWith('https://') ? path : `${GRAPH}/${env.WHATSAPP_API_VERSION}/${path}${qs}`
  try {
    const res = await fetchImpl(url, { method, headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` }, signal: AbortSignal.timeout(CALL_MS) })
    if (raw && res.ok) return { ok: true, status: res.status, res, problem: null }
    const body = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, status: res.status, body: { error: { code: body?.error?.code ?? null, message: String(body?.error?.message ?? '').slice(0, 300) } }, problem: graphProblem(res.status, body) }
    return { ok: true, status: res.status, body, problem: null }
  } catch (err) {
    logger.warn({ err, path: path.split('?')[0].replace(/\d{6,}/g, '<id>') }, 'Meta Graph API call failed')
    return { ok: false, status: 0, body: null, problem: graphProblem(0, null, err) }
  }
}

const last4 = (s) => (s ? `…${String(s).slice(-4)}` : null)

/**
 * Whether everything the integration needs is configured. No call to Meta: "complete" here
 * is not "working" (that is the connection check). Values are never shown, only whether
 * they are set (ids by their last 4 digits).
 */
export function readiness() {
  const meta = env.WHATSAPP_PROVIDER === 'meta'
  const items = [
    { key: 'WHATSAPP_PROVIDER', label: 'Provider is Meta', ok: meta, detail: meta ? 'meta' : `${env.WHATSAPP_PROVIDER}: messages are only logged`, required: true },
    { key: 'WHATSAPP_TOKEN', label: 'Access token (system user)', ok: Boolean(env.WHATSAPP_TOKEN), detail: env.WHATSAPP_TOKEN ? 'set' : 'not set', required: true },
    { key: 'WHATSAPP_PHONE_NUMBER_ID', label: 'Phone number id (not the phone number)', ok: /^\d{6,}$/.test(env.WHATSAPP_PHONE_NUMBER_ID ?? ''), detail: env.WHATSAPP_PHONE_NUMBER_ID ? (/^\d{6,}$/.test(env.WHATSAPP_PHONE_NUMBER_ID) ? last4(env.WHATSAPP_PHONE_NUMBER_ID) : 'not a Meta id: use the Phone number ID from WhatsApp Manager, not the number') : 'not set', required: true },
    { key: 'WHATSAPP_BUSINESS_ACCOUNT_ID', label: 'WhatsApp Business Account id', ok: Boolean(env.WHATSAPP_BUSINESS_ACCOUNT_ID), detail: env.WHATSAPP_BUSINESS_ACCOUNT_ID ? last4(env.WHATSAPP_BUSINESS_ACCOUNT_ID) : 'not set: template sync and the subscription check are off', required: false },
    { key: 'WHATSAPP_APP_SECRET', label: 'App secret (checks webhook signatures)', ok: env.WHATSAPP_APP_SECRET.length >= 16, detail: env.WHATSAPP_APP_SECRET ? (env.WHATSAPP_APP_SECRET.length >= 16 ? 'set' : 'too short to be an app secret') : 'not set: every webhook is refused', required: true },
    { key: 'WHATSAPP_VERIFY_TOKEN', label: 'Webhook verify token', ok: env.WHATSAPP_VERIFY_TOKEN.length >= 16, detail: env.WHATSAPP_VERIFY_TOKEN ? (env.WHATSAPP_VERIFY_TOKEN.length >= 16 ? 'set' : 'set, but use 16 or more random characters') : 'not set: Meta cannot verify the webhook', required: true },
    { key: 'WHATSAPP_API_VERSION', label: 'Graph API version', ok: true, detail: env.WHATSAPP_API_VERSION, required: true },
    { key: 'WHATSAPP_LANGUAGE', label: 'Template language', ok: Boolean(env.WHATSAPP_LANGUAGE), detail: env.WHATSAPP_LANGUAGE, required: true },
    { key: 'WHATSAPP_WEBHOOK_URL', label: 'Public webhook address', ok: Boolean(env.WHATSAPP_WEBHOOK_URL), detail: env.WHATSAPP_WEBHOOK_URL || 'not set (only shown on this page; Meta is given it in the app dashboard)', required: false },
    { key: 'WHATSAPP_PAYMENT_CONFIG', label: 'Payments inside WhatsApp', ok: true, detail: env.WHATSAPP_PAYMENT_CONFIG ? 'on (Razorpay configuration in WhatsApp Manager)' : 'off: chat orders get a Razorpay payment link', required: false },
  ]
  const missing = items.filter((i) => i.required && !i.ok).map((i) => i.key)
  return { complete: missing.length === 0, missing, items, environment: env.NODE_ENV }
}

/**
 * The live check: reads the phone number (name, quality, messaging limit) and, with the
 * WABA id, whether this app is subscribed to the account's webhooks. Each part says what
 * went wrong in operator terms. Recorded in wa_account_events.
 */
export async function connectionCheck(adminId) {
  const ready = readiness()
  const out = { at: now().toISOString(), configured: ready.complete, phone: null, subscription: null, ok: false }
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    out.phone = { ok: false, problem: 'missing_credentials' }
  } else {
    const p = await graph(encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID), {
      params: { fields: 'display_phone_number,verified_name,quality_rating,code_verification_status,name_status,messaging_limit_tier,throughput,platform_type,status' },
    })
    out.phone = p.ok
      ? {
          ok: true,
          number: p.body.display_phone_number ?? null, name: p.body.verified_name ?? null, quality: p.body.quality_rating ?? null,
          nameStatus: p.body.name_status ?? null, verification: p.body.code_verification_status ?? null, limit: p.body.messaging_limit_tier ?? null,
          throughput: p.body.throughput?.level ?? null, platform: p.body.platform_type ?? null, status: p.body.status ?? null,
        }
      : { ok: false, problem: p.problem, metaCode: p.body?.error?.code ?? null, message: p.body?.error?.message ?? null }
  }
  if (env.WHATSAPP_BUSINESS_ACCOUNT_ID && env.WHATSAPP_TOKEN) {
    const s = await graph(`${encodeURIComponent(env.WHATSAPP_BUSINESS_ACCOUNT_ID)}/subscribed_apps`)
    out.subscription = s.ok
      ? { ok: Array.isArray(s.body?.data) && s.body.data.length > 0, apps: (s.body?.data ?? []).map((a) => a?.whatsapp_business_api_data?.name ?? a?.name ?? 'app').slice(0, 5) }
      : { ok: false, problem: s.problem, metaCode: s.body?.error?.code ?? null, message: s.body?.error?.message ?? null }
  }
  out.ok = Boolean(out.phone?.ok && (out.subscription == null || out.subscription.ok))
  await query('INSERT INTO wa_account_events (id, field, event, detail, created_at) VALUES ($1, $2, $3, $4, $5)', [
    newId('wae'), 'connection_check', out.ok ? 'OK' : 'FAILED', { ...out, by: adminId ?? null }, now(),
  ])
  return out
}

/** The distinct {{n}} variables in a template's body text. */
export function bodyParams(components) {
  const body = (components ?? []).find((c) => c?.type === 'BODY')
  return new Set(String(body?.text ?? '').match(/\{\{\s*\d+\s*\}\}/g) ?? []).size
}
const urlButton = (components) =>
  (components ?? []).some((c) => c?.type === 'BUTTONS' && (c.buttons ?? []).some((b) => b?.type === 'URL' && /\{\{\s*1\s*\}\}/.test(String(b.url ?? ''))))

/**
 * Reads every template of the account from Meta and keeps name, language, status, category
 * and the number of body variables. Templates Meta no longer has are removed. Returns the
 * registry with each kind's template status.
 */
export async function syncTemplates() {
  if (!env.WHATSAPP_BUSINESS_ACCOUNT_ID) throw new HttpError(409, 'NOT_CONFIGURED', 'Set WHATSAPP_BUSINESS_ACCOUNT_ID to read templates from Meta')
  const seen = []
  let next = `${encodeURIComponent(env.WHATSAPP_BUSINESS_ACCOUNT_ID)}/message_templates`
  let params = { fields: 'name,language,status,category,components,rejected_reason,id', limit: '100' }
  for (let page = 0; next && page < 20; page++) {
    const r = await graph(next, { params })
    if (!r.ok) throw new HttpError(502, 'META_ERROR', `Meta refused the template list: ${r.problem}${r.body?.error?.message ? ` (${r.body.error.message})` : ''}`, { problem: r.problem })
    for (const t of r.body?.data ?? []) {
      if (typeof t?.name !== 'string' || !/^[a-z0-9_]{1,512}$/.test(t.name) || typeof t.language !== 'string') continue
      seen.push({ name: t.name, language: t.language.slice(0, 20), status: String(t.status ?? 'UNKNOWN').slice(0, 40), category: t.category ? String(t.category).slice(0, 40) : null,
        metaId: t.id ? String(t.id).slice(0, 40) : null, bodyParams: bodyParams(t.components), urlButton: urlButton(t.components), reason: t.rejected_reason && t.rejected_reason !== 'NONE' ? String(t.rejected_reason).slice(0, 500) : null })
    }
    // Meta's next page is a full URL with the cursor; it is only followed on Meta's own host.
    const n = r.body?.paging?.next
    next = typeof n === 'string' && n.startsWith(`${GRAPH}/`) ? n : null
    params = null
  }
  const at = now()
  await tx(async (c) => {
    for (const t of seen) {
      await c.query(
        `INSERT INTO wa_templates (name, language, status, category, meta_id, body_params, url_button, reason, synced_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (name, language) DO UPDATE SET status = EXCLUDED.status, category = EXCLUDED.category, meta_id = EXCLUDED.meta_id,
           body_params = EXCLUDED.body_params, url_button = EXCLUDED.url_button, reason = EXCLUDED.reason, synced_at = EXCLUDED.synced_at`,
        [t.name, t.language, t.status, t.category, t.metaId, t.bodyParams, t.urlButton, t.reason, at],
      )
    }
    await c.query('DELETE FROM wa_templates WHERE synced_at < $1', [at])
  })
  return templateReport()
}

/** Each automated message with its template and what Meta says about it. */
export async function templateReport() {
  const { rows } = await query('SELECT * FROM wa_templates WHERE language = $1', [env.WHATSAPP_LANGUAGE])
  const byName = new Map(rows.map((t) => [t.name, t]))
  const { rows: sw } = await query('SELECT kind, enabled FROM wa_automations')
  const switches = new Map(sw.map((r) => [r.kind, r.enabled]))
  const synced = rows.length > 0
  return {
    language: env.WHATSAPP_LANGUAGE,
    synced,
    lastSyncedAt: rows.reduce((m, t) => (!m || t.synced_at > m ? t.synced_at : m), null),
    automations: AUTOMATIONS.map((a) => {
      const name = templateFor(a.kind)
      const t = byName.get(name)
      const flagOff = a.flag ? !env[a.flag] : false
      let state
      if (switches.get(a.kind) === false) state = 'OFF'
      else if (flagOff) state = 'FLAG_OFF'
      else if (!synced) state = 'NOT_CHECKED'
      else if (!t) state = 'AWAITING_TEMPLATE'
      else if (t.status !== 'APPROVED') state = 'AWAITING_APPROVAL'
      else if (t.body_params != null && t.body_params !== a.params.length) state = 'VARIABLES_MISMATCH'
      else state = 'READY'
      return {
        kind: a.kind, template: name, category: a.category, consent: a.consent, params: a.params, example: a.example, trigger: a.trigger, flag: a.flag ?? null,
        enabled: switches.get(a.kind) ?? true, state, meta: t ? { status: t.status, category: t.category, bodyParams: t.body_params, urlButton: t.url_button, reason: t.reason } : null,
      }
    }),
  }
}

/** Customer media staff may open: images, PDFs, voice notes and short videos. */
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/amr', 'video/mp4', 'video/3gpp'])

/**
 * A customer's photo or document from a chat, fetched from Meta for staff. Meta's
 * temporary URL is used once, here, and never leaves the server. Type and size are
 * checked before and after download.
 */
export async function mediaFor(messageId) {
  const { rows } = await query(`SELECT media FROM wa_messages WHERE id = $1 AND direction = 'IN'`, [messageId])
  const id = rows[0]?.media?.id
  if (!id) throw new HttpError(404, 'NOT_FOUND', 'This message has no photo or file')
  if (env.WHATSAPP_PROVIDER !== 'meta' || !env.WHATSAPP_TOKEN) throw new HttpError(409, 'NOT_CONFIGURED', 'Photos are kept at Meta and need the WhatsApp token to open')
  const info = await graph(encodeURIComponent(id))
  if (!info.ok) throw new HttpError(info.problem === 'invalid_configuration' ? 410 : 502, 'META_ERROR', info.problem === 'invalid_configuration' ? 'Meta no longer has this file (media is kept for about 30 days)' : `Meta did not give the file: ${info.problem}`)
  const mime = String(info.body?.mime_type ?? '').split(';')[0].trim().toLowerCase()
  if (!MEDIA_TYPES.has(mime)) throw new HttpError(415, 'UNSUPPORTED_MEDIA', `Files of type ${mime || 'unknown'} are not opened here`)
  if (Number(info.body?.file_size) > env.WHATSAPP_MEDIA_MAX_BYTES) throw new HttpError(413, 'TOO_LARGE', 'This file is too large to open here')
  const url = String(info.body?.url ?? '')
  // Only Meta's own media host, over https.
  if (!/^https:\/\/([a-z0-9-]+\.)*(fbcdn\.net|facebook\.com|whatsapp\.net)\//i.test(url)) throw new HttpError(502, 'META_ERROR', 'Meta gave an unexpected file address')
  const got = await graph(url, { raw: true })
  if (!got.ok) throw new HttpError(502, 'META_ERROR', `Meta did not give the file: ${got.problem}`)
  const buf = Buffer.from(await got.res.arrayBuffer())
  if (buf.length > env.WHATSAPP_MEDIA_MAX_BYTES) throw new HttpError(413, 'TOO_LARGE', 'This file is too large to open here')
  return { mime, buffer: buf, filename: rows[0].media.filename ?? null }
}
