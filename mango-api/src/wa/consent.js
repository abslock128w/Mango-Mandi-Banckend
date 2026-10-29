// WhatsApp consent (docs/whatsapp/CONSENT.md). Two scopes per number:
//   updates    order, booking, claim and help updates. Allowed unless the number sent STOP.
//   marketing  promotional messages. Only with the customer's own opt-in, which is the
//              shop's "Remind me to order again" setting or START OFFERS in the chat, and
//              stopped by STOP, STOP OFFERS or turning the setting off.
// Every change is written to wa_consent_events with its source and evidence.
// What a person asked for in that moment (a login code, the chat's answer to
// their own message) is not a business-started message and needs no consent.
import { now } from '../clock.js'
import { newId } from '../ids.js'
import { automationFor } from './registry.js'

const clean = (t) => String(t ?? '').trim().toLowerCase().replace(/[.!\s]+/g, ' ').trim()

const KEYWORDS = new Map([
  ['stop', { scope: 'all', action: 'OPT_OUT' }],
  ['stop all', { scope: 'all', action: 'OPT_OUT' }],
  ['unsubscribe', { scope: 'all', action: 'OPT_OUT' }],
  ['opt out', { scope: 'all', action: 'OPT_OUT' }],
  ['optout', { scope: 'all', action: 'OPT_OUT' }],
  ['stop offers', { scope: 'marketing', action: 'OPT_OUT' }],
  ['stop promotions', { scope: 'marketing', action: 'OPT_OUT' }],
  ['stop reminders', { scope: 'marketing', action: 'OPT_OUT' }],
  ['start', { scope: 'updates', action: 'OPT_IN' }],
  ['unstop', { scope: 'updates', action: 'OPT_IN' }],
  ['resume', { scope: 'updates', action: 'OPT_IN' }],
  ['start offers', { scope: 'marketing', action: 'OPT_IN' }],
])

/** A consent keyword in a customer's message, or null. Only the whole message counts ("stop" yes, "stop by 5" no). */
export function consentKeyword(text) {
  return KEYWORDS.get(clean(text)) ?? null
}

/** The number's consent, with defaults for a number that never changed it. */
export async function consentFor(c, phone) {
  const { rows } = await c.query('SELECT updates, marketing FROM wa_consent WHERE phone = $1', [phone])
  return rows[0] ?? { updates: 'ALLOWED', marketing: 'NONE' }
}

/**
 * Records a consent change and its evidence. scope 'all' with OPT_OUT stops
 * updates and marketing. Returns the consent after the change.
 */
export async function setConsent(c, { phone, customerId = null, scope, action, source, evidence = null }) {
  const at = now()
  const scopes = scope === 'all' ? ['updates', 'marketing'] : [scope]
  const value = (s) => (s === 'updates' ? (action === 'OPT_OUT' ? 'STOPPED' : 'ALLOWED') : action === 'OPT_OUT' ? 'OPTED_OUT' : 'OPTED_IN')
  await c.query(
    `INSERT INTO wa_consent (phone, customer_id, updates, marketing, updated_at) VALUES ($1, $2, 'ALLOWED', 'NONE', $3)
     ON CONFLICT (phone) DO UPDATE SET customer_id = COALESCE(EXCLUDED.customer_id, wa_consent.customer_id)`,
    [phone, customerId, at],
  )
  for (const s of scopes) {
    await c.query(`UPDATE wa_consent SET ${s} = $2, updated_at = $3 WHERE phone = $1`, [phone, value(s), at])
    await c.query(
      `INSERT INTO wa_consent_events (id, phone, customer_id, scope, action, source, evidence, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [newId('wcn'), phone, customerId, s, action, source, evidence ? String(evidence).slice(0, 200) : null, at],
    )
  }
  // Opting out of promotions also turns the shop's reminder setting off, so both say the same.
  if (action === 'OPT_OUT' && scopes.includes('marketing')) {
    await c.query('UPDATE customers SET reminders_opt_in = FALSE WHERE phone = $1 AND reminders_opt_in', [phone])
  }
  return consentFor(c, phone)
}

/**
 * Whether a business-started message of this kind may go to a number.
 * `consent` from consentFor; `optIn` is the kind's own opt-in where there is
 * one (the shop's reminder setting for REORDER_REMINDER). Returns null when it
 * may go, else the reason it may not.
 */
export function refusal(kind, consent, { optIn = false } = {}) {
  const a = automationFor(kind)
  const cls = a?.consent ?? 'updates'
  if (consent.updates === 'STOPPED') return 'customer sent STOP on WhatsApp'
  // STOP OFFERS also stops what we ask Meta to bill as marketing (a review request, a referral
  // thank-you), even though those need no opt-in of their own.
  if (a?.category === 'MARKETING' && consent.marketing === 'OPTED_OUT') return 'customer opted out of promotional messages'
  if (cls !== 'marketing') return null
  if (consent.marketing === 'OPTED_OUT') return 'customer opted out of promotional messages'
  if (consent.marketing === 'OPTED_IN' || optIn) return null
  return 'no opt-in for promotional messages'
}
