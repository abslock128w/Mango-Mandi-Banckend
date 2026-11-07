// Partner Network messages (docs/partner-network.md), all through the WhatsApp
// outbox (notifications), queued in the same transaction as the change that
// causes them. Nothing is queued unless WHATSAPP_PARTNER_UPDATES is on (both
// templates need Meta's approval first); the team alerts also need numbers in
// PARTNER_ALERT_PHONES. The template words are fixed when queued
// (partner_params), so a late retry still says what happened then.
import { now } from '../clock.js'
import { query, tx } from '../db.js'
import { env } from '../env.js'
import { newId } from '../ids.js'

const WHAT = {
  SUBMITTED: 'New partner enquiry',
  PROPOSAL: 'New product proposal',
  ASSIGNED: 'Partner enquiry assigned',
  CONVERTED: 'Partner enquiry converted',
  REJECTED: 'Partner enquiry rejected',
  FOLLOWUP_DUE: 'Partner follow-up due within the hour',
  FOLLOWUP_OVERDUE: 'Partner follow-up overdue',
}

const panelUrl = () => env.ADMIN_ORIGIN.split(',')[0]?.trim().replace(/\/$/, '') || 'http://localhost:5173'
/** One line, at most n characters: template variables may not hold line breaks. */
const line = (s, n = 300) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

const IST = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

async function add(c, { enquiryId, kind, eventId, phone, params }) {
  const at = now()
  await c.query(
    `INSERT INTO notifications (id, partner_enquiry_id, event_id, kind, phone, partner_params, next_attempt_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7) ON CONFLICT (event_id, kind) DO NOTHING`,
    [newId('ntf'), enquiryId, eventId, kind, phone, JSON.stringify(params), at],
  )
}

/**
 * Queues what an enquiry event sends. kind: SUBMITTED (applicant receipt, team
 * alert, and a proposal alert when there is one), ASSIGNED, CONVERTED, REJECTED,
 * FOLLOWUP_DUE, FOLLOWUP_OVERDUE. `tag` keeps repeats of the same event apart
 * (each assignment, each follow-up) while a retried request adds nothing.
 */
export async function queuePartnerMessages(c, { kind, enquiryId, proposal = false, tag = '', detail = null }) {
  if (!env.WHATSAPP_PARTNER_UPDATES) return 0
  const { rows } = await c.query(
    `SELECT e.id, e.reference, e.applicant_name, e.mobile_number, e.city, e.state, e.consent_at, pc.name AS category,
            pp.product_name
       FROM partner_enquiries e JOIN partnership_categories pc ON pc.code = e.primary_category
       LEFT JOIN partner_product_proposals pp ON pp.enquiry_id = e.id
      WHERE e.id = $1`,
    [enquiryId],
  )
  const e = rows[0]
  if (!e) return 0
  let queued = 0
  if (kind === 'SUBMITTED' && e.consent_at) {
    await add(c, { enquiryId, kind: 'PARTNER_ENQUIRY_RECEIVED', eventId: `${enquiryId}:received`, phone: e.mobile_number, params: [line(e.applicant_name, 60) || 'there', e.reference, line(e.category, 80)] })
    queued++
  }
  const link = `${panelUrl()}/partner-network/enquiries/${enquiryId}`
  const team = (what, words) => env.PARTNER_ALERT_PHONES.map((phone) => ({ phone, params: [WHAT[what], e.reference, line(words), link] }))
  const events = []
  if (kind === 'SUBMITTED') {
    events.push(['SUBMITTED', `${e.category}, ${e.city}, ${e.state}`])
    if (proposal && e.product_name) events.push(['PROPOSAL', `${e.product_name} (${e.city}, ${e.state})`])
  } else {
    events.push([kind, detail ?? `${e.category}, ${e.city}, ${e.state}`])
  }
  for (const [what, words] of events) {
    for (const m of team(what, words)) {
      await add(c, { enquiryId, kind: 'PARTNER_TEAM_ALERT', eventId: `${enquiryId}:${what}:${tag}:${m.phone}`, phone: m.phone, params: m.params })
      queued++
    }
  }
  return queued
}

const DUE_SOON_MS = 60 * 60_000
/** Older than this and an overdue follow-up is not news (a switch turned on late must not flood the team). */
const OVERDUE_NEWS_MS = 24 * 3_600_000

/**
 * The maintenance step: a "due within the hour" and an "overdue" alert, once each
 * per pending follow-up. Marks the follow-up in the same transaction as the queued
 * message, so a run that dies queues nothing twice. Returns how many were queued.
 */
export async function queueFollowupAlerts(at = now()) {
  if (!env.WHATSAPP_PARTNER_UPDATES || !env.PARTNER_ALERT_PHONES.length) return 0
  let n = 0
  for (const [what, where, mark, params] of [
    ['FOLLOWUP_DUE', `f.scheduled_at > $1 AND f.scheduled_at <= $2 AND f.due_alert_at IS NULL`, 'due_alert_at', [at, new Date(at.getTime() + DUE_SOON_MS)]],
    ['FOLLOWUP_OVERDUE', `f.scheduled_at <= $1 AND f.scheduled_at > $2 AND f.overdue_alert_at IS NULL`, 'overdue_alert_at', [at, new Date(at.getTime() - OVERDUE_NEWS_MS)]],
  ]) {
    const { rows } = await query(
      `SELECT f.id, f.enquiry_id, f.scheduled_at, f.notes, a.email AS assignee
         FROM partner_enquiry_followups f LEFT JOIN admin_users a ON a.id = f.assigned_admin_id
        WHERE f.status = 'PENDING' AND ${where} ORDER BY f.scheduled_at LIMIT 50`,
      params,
    )
    for (const f of rows) {
      await tx(async (c) => {
        const { rowCount } = await c.query(`UPDATE partner_enquiry_followups SET ${mark} = $2 WHERE id = $1 AND ${mark} IS NULL AND status = 'PENDING'`, [f.id, at])
        if (!rowCount) return
        const words = `${IST.format(f.scheduled_at)}${f.assignee ? `, ${f.assignee}` : ''}${f.notes ? `: ${f.notes}` : ''}`
        n += await queuePartnerMessages(c, { kind: what, enquiryId: f.enquiry_id, tag: f.id, detail: words })
      })
    }
  }
  return n
}
