// Partner Network for staff (docs/partner-network.md): the overview, the
// enquiry list and detail, status, priority, assignment, notes, follow-ups,
// decisions and product proposals. Every change writes an activity row on the
// enquiry; the routes (admin/partner.js) add the staff_audit row in the same
// transaction.
import { now, todayIST } from '../clock.js'
import { conflict, HttpError, notFound } from '../errors.js'
import { newId } from '../ids.js'
import { queuePartnerMessages } from './alerts.js'
import { DOCUMENT_CATEGORIES, normaliseMobile } from './questionnaire.js'

export const ENQUIRY_STATUSES = ['NEW', 'UNDER_REVIEW', 'CONTACTED', 'NEGOTIATION', 'CONVERTED', 'REJECTED', 'CLOSED']
export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
export const PROPOSAL_STATUSES = ['SUBMITTED', 'UNDER_EVALUATION', 'SAMPLE_REQUESTED', 'QUALITY_REVIEW', 'COMMERCIAL_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED']
export const PROPOSAL_FINAL = ['APPROVED', 'REJECTED', 'CLOSED']
export const CONTACT_CHANNELS = ['PHONE', 'WHATSAPP', 'EMAIL']

/** Moves a plain status change (PATCH) may make; final ones go through the action routes. */
const PLAIN_MOVES = {
  NEW: ['UNDER_REVIEW', 'CONTACTED'],
  UNDER_REVIEW: ['CONTACTED', 'NEGOTIATION'],
  CONTACTED: ['UNDER_REVIEW', 'NEGOTIATION'],
  NEGOTIATION: ['CONTACTED'],
  CONVERTED: [],
  REJECTED: [],
  CLOSED: [],
}
/** The statuses each manager action may start from. */
const ACTION_FROM = {
  approve: ['NEW', 'UNDER_REVIEW', 'CONTACTED'],
  reject: ['NEW', 'UNDER_REVIEW', 'CONTACTED', 'NEGOTIATION'],
  close: ['NEW', 'UNDER_REVIEW', 'CONTACTED', 'NEGOTIATION', 'CONVERTED'],
  reopen: ['REJECTED', 'CLOSED'],
  convert: ['NEGOTIATION'],
}
const ACTION_TO = { approve: 'NEGOTIATION', reject: 'REJECTED', close: 'CLOSED', reopen: 'UNDER_REVIEW', convert: 'CONVERTED' }

const isManager = (admin) => admin.role === 'MANAGER'
const PRIORITY_RANK = `CASE e.priority WHEN 'URGENT' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'NORMAL' THEN 2 ELSE 1 END`
const STATUS_RANK = `array_position(ARRAY['NEW','UNDER_REVIEW','CONTACTED','NEGOTIATION','CONVERTED','REJECTED','CLOSED'], e.status)`
const SORTS = { submitted: 'e.submitted_at', name: 'lower(e.applicant_name)', status: STATUS_RANK, priority: PRIORITY_RANK, state: 'e.state', reference: 'e.reference' }

const ACTIVITY_WORDS = {
  SUBMITTED: 'Enquiry submitted',
  DOCUMENT_ADDED: 'Document added by the applicant',
  STATUS_CHANGED: 'Status changed',
  PRIORITY_CHANGED: 'Priority changed',
  ASSIGNED: 'Assigned',
  NOTE_ADDED: 'Note added',
  FOLLOWUP_SCHEDULED: 'Follow-up scheduled',
  FOLLOWUP_UPDATED: 'Follow-up changed',
  FOLLOWUP_DONE: 'Follow-up completed',
  FOLLOWUP_CANCELLED: 'Follow-up cancelled',
  CONTACT_OPENED: 'Contact opened from the panel',
  INFO_REQUESTED: 'More information requested',
  APPROVED: 'Approved for a business discussion',
  REJECTED: 'Rejected',
  CLOSED: 'Closed',
  REOPENED: 'Reopened',
  CONVERTED: 'Converted to a business opportunity',
  PROPOSAL_STATUS_CHANGED: 'Product proposal status changed',
  PROPOSAL_NOTE_ADDED: 'Product proposal note added',
  SAMPLE_REQUESTED: 'Samples requested',
}
const STATUS_WORDS = {
  NEW: 'New', UNDER_REVIEW: 'Under review', CONTACTED: 'Contacted', NEGOTIATION: 'Negotiation', CONVERTED: 'Converted', REJECTED: 'Rejected', CLOSED: 'Closed',
  LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent',
  SUBMITTED: 'Submitted', UNDER_EVALUATION: 'Under evaluation', SAMPLE_REQUESTED: 'Sample requested', QUALITY_REVIEW: 'Quality review',
  COMMERCIAL_REVIEW: 'Commercial review', APPROVED: 'Approved',
}
const word = (v) => (v == null ? 'none' : STATUS_WORDS[v] ?? v)
const CHANNEL_WORDS = { PHONE: 'a phone call', WHATSAPP: 'WhatsApp', EMAIL: 'an email' }

async function activity(c, enquiryId, admin, type, { oldValue = null, newValue = null, metadata = null, proposalId = null } = {}) {
  await c.query(
    `INSERT INTO partner_enquiry_activities (id, enquiry_id, proposal_id, actor_admin_id, actor_email, activity_type, old_value, new_value, metadata, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [newId('pac'), enquiryId, proposalId, admin?.id ?? null, admin?.email ?? null, type, oldValue, newValue, metadata ? JSON.stringify(metadata) : null, now()],
  )
}

// ---------------------------------------------------------------- rows

const ROW_SELECT = `SELECT e.*, pc.name AS primary_name, a.email AS assignee_email,
       (SELECT json_agg(json_build_object('code', x.code, 'name', x.name) ORDER BY x.display_order)
          FROM partner_enquiry_categories ec JOIN partnership_categories x ON x.code = ec.category_code WHERE ec.enquiry_id = e.id) AS cats
  FROM partner_enquiries e JOIN partnership_categories pc ON pc.code = e.primary_category
  LEFT JOIN admin_users a ON a.id = e.assigned_admin_id`

const enquiryRow = (e) => ({
  id: e.id, reference: e.reference, name: e.applicant_name, businessName: e.business_name,
  primaryCategory: { code: e.primary_category, name: e.primary_name },
  categories: e.cats ?? [],
  city: e.city, state: e.state, mobile: e.mobile_number, email: e.email,
  submittedAt: e.submitted_at, status: e.status, priority: e.priority,
  assignedTo: e.assigned_admin_id ? { id: e.assigned_admin_id, email: e.assignee_email } : null,
})

const money = (v) => (v == null ? null : Number(v))
const proposalRow = (p) => ({
  id: p.id, reference: p.reference, productName: p.product_name, productCategory: p.product_category,
  submittedBy: { name: p.applicant_name, enquiryId: p.enquiry_id, enquiryReference: p.enquiry_reference },
  applicantLocation: `${p.city}, ${p.state}`, sourceLocation: p.source_location,
  procurementPrice: money(p.procurement_price), suggestedSellingPrice: money(p.suggested_selling_price),
  monthlySupplyCapacity: p.monthly_supply_capacity, sampleAvailable: p.sample_available,
  submittedAt: p.created_at, status: p.status,
})
const PROPOSAL_SELECT = `SELECT p.*, e.applicant_name, e.reference AS enquiry_reference, e.city, e.state, e.mobile_number, e.email, e.status AS enquiry_status
  FROM partner_product_proposals p JOIN partner_enquiries e ON e.id = p.enquiry_id`

const followupView = (f, at = now()) => ({
  id: f.id, enquiry: f.reference ? { id: f.enquiry_id, reference: f.reference, name: f.applicant_name } : undefined,
  scheduledAt: f.scheduled_at, assignedTo: f.assigned_admin_id ? { id: f.assigned_admin_id, email: f.assignee_email } : null,
  notes: f.notes, status: f.status, completedAt: f.completed_at, overdue: f.status === 'PENDING' && f.scheduled_at < at,
})

/** tel:, wa.me and mailto: links for an applicant (the panel opens them; nothing is sent from here). */
export function contactLinks(mobile, email, reference) {
  const digits = String(mobile).replace(/^\+/, '')
  return {
    tel: `tel:${mobile}`,
    whatsapp: `https://wa.me/${digits}`,
    mailto: `mailto:${email}?subject=${encodeURIComponent(`Your MandiMangoes partnership enquiry ${reference}`)}`,
  }
}

// ---------------------------------------------------------------- list and search

/** Turns the list filters into a WHERE clause and its values. */
function listWhere(f, admin) {
  const where = []
  const vals = []
  const v = (x) => {
    vals.push(x)
    return `$${vals.length}`
  }
  if (f.q) {
    const term = f.q.trim()
    const mobile = normaliseMobile(term)
    const digits = term.replace(/\D/g, '')
    const parts = [`e.applicant_name ILIKE ${v(`%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)}`, `e.business_name ILIKE $${vals.length}`, `lower(e.email) = lower(${v(term)})`, `e.reference = upper(${v(term)})`]
    if (mobile) parts.push(`e.mobile_number = ${v(mobile)}`)
    else if (digits.length >= 4) parts.push(`e.mobile_number LIKE ${v(`%${digits}`)}`)
    where.push(`(${parts.join(' OR ')})`)
  }
  if (f.status?.length) where.push(`e.status = ANY(${v(f.status)})`)
  if (f.priority) where.push(`e.priority = ${v(f.priority)}`)
  if (f.state) where.push(`e.state = ${v(f.state)}`)
  if (f.category) where.push(`EXISTS (SELECT 1 FROM partner_enquiry_categories ec WHERE ec.enquiry_id = e.id AND ec.category_code = ${v(f.category)})`)
  if (f.assignedTo === 'none') where.push('e.assigned_admin_id IS NULL')
  else if (f.assignedTo === 'me') where.push(`e.assigned_admin_id = ${v(admin.id)}`)
  else if (f.assignedTo) where.push(`e.assigned_admin_id = ${v(f.assignedTo)}`)
  // Dates are IST calendar days.
  if (f.from) where.push(`e.submitted_at >= (${v(f.from)}::date::timestamp AT TIME ZONE 'Asia/Kolkata')`)
  if (f.to) where.push(`e.submitted_at < ((${v(f.to)}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`)
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', vals }
}

export async function listEnquiries(c, f, admin) {
  const { sql, vals } = listWhere(f, admin)
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC'
  const order = `${SORTS[f.sort] ?? SORTS.submitted} ${dir} NULLS LAST, e.submitted_at DESC, e.id`
  const total = (await c.query(`SELECT COUNT(*)::int AS n FROM partner_enquiries e ${sql}`, vals)).rows[0].n
  const { rows } = await c.query(`${ROW_SELECT} ${sql} ORDER BY ${order} LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`, vals)
  const staff = await assignableStaff(c)
  const states = (await c.query('SELECT DISTINCT state FROM partner_enquiries ORDER BY state')).rows.map((r) => r.state)
  return { items: rows.map(enquiryRow), total, page: f.page, pageSize: f.pageSize, staff, states }
}

export const EXPORT_MAX_ROWS = 5000
/** A cell that a spreadsheet would read as a formula gets a leading quote. */
const csvCell = (x) => {
  let s = x == null ? '' : String(x)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function exportCsv(c, f, admin) {
  const { sql, vals } = listWhere(f, admin)
  const { rows } = await c.query(`${ROW_SELECT} ${sql} ORDER BY e.submitted_at DESC, e.id LIMIT ${EXPORT_MAX_ROWS}`, vals)
  const head = ['Reference', 'Name', 'Business', 'Primary category', 'Other categories', 'City', 'State', 'PIN code', 'Mobile', 'Email', 'Submitted (IST)', 'Status', 'Priority', 'Assigned to']
  const ist = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
  const lines = rows.map((e) => [
    e.reference, e.applicant_name, e.business_name, e.primary_name, (e.cats ?? []).filter((x) => x.code !== e.primary_category).map((x) => x.name).join('; '),
    e.city, e.state, e.pincode, e.mobile_number, e.email, ist.format(e.submitted_at), e.status, e.priority, e.assignee_email,
  ].map(csvCell).join(','))
  return { csv: [head.join(','), ...lines].join('\r\n') + '\r\n', count: rows.length }
}

export async function assignableStaff(c) {
  const { rows } = await c.query(`SELECT id, email, role FROM admin_users WHERE role IN ('MANAGER', 'OPERATOR') ORDER BY email`)
  return rows
}

// ---------------------------------------------------------------- detail

async function lockEnquiry(c, id) {
  const { rows } = await c.query('SELECT * FROM partner_enquiries WHERE id = $1 FOR UPDATE', [id])
  if (!rows.length) throw notFound('Enquiry not found')
  return rows[0]
}

function actionsFor(e, admin) {
  const m = isManager(admin)
  return {
    approve: m && ACTION_FROM.approve.includes(e.status),
    reject: m && ACTION_FROM.reject.includes(e.status),
    close: m && ACTION_FROM.close.includes(e.status),
    reopen: m && ACTION_FROM.reopen.includes(e.status),
    convert: m && ACTION_FROM.convert.includes(e.status),
    assign: true,
    export: m,
  }
}

function activityView(a) {
  const words = ACTIVITY_WORDS[a.activity_type] ?? a.activity_type
  let summary = words
  const md = a.metadata ?? {}
  if (a.activity_type === 'STATUS_CHANGED' || a.activity_type === 'PRIORITY_CHANGED' || a.activity_type === 'PROPOSAL_STATUS_CHANGED') summary = `${words}: ${word(a.old_value)} → ${word(a.new_value)}`
  else if (a.activity_type === 'ASSIGNED') summary = a.new_value ? `Assigned to ${a.new_value}` : 'Unassigned'
  else if (a.activity_type === 'CONTACT_OPENED') summary = `Opened ${CHANNEL_WORDS[a.new_value] ?? a.new_value} from the panel (not a record that anything was sent)`
  else if (a.activity_type === 'INFO_REQUESTED') summary = `More information requested by ${CHANNEL_WORDS[a.new_value] ?? a.new_value} (opened from the panel; sent by staff)`
  else if (a.activity_type === 'DOCUMENT_ADDED') summary = `${words}: ${a.new_value}`
  else if (['REJECTED', 'CLOSED', 'REOPENED', 'APPROVED'].includes(a.activity_type) && md.reason) summary = `${words}: ${md.reason}`
  else if (a.activity_type === 'CONVERTED' && md.title) summary = `${words}: ${md.title}`
  else if (a.activity_type.startsWith('FOLLOWUP_') && a.new_value) summary = `${words} (${a.new_value})`
  return { id: a.id, type: a.activity_type, summary, oldValue: a.old_value, newValue: a.new_value, actor: a.actor_email, at: a.created_at, about: a.proposal_id ? 'PROPOSAL' : 'ENQUIRY' }
}

async function documentsOf(c, enquiryId) {
  const { rows } = await c.query(
    'SELECT id, original_filename, document_category, mime_type, file_size, uploaded_at FROM partner_enquiry_documents WHERE enquiry_id = $1 ORDER BY uploaded_at, id',
    [enquiryId],
  )
  return rows.map((d) => ({ id: d.id, name: d.original_filename, category: d.document_category, categoryLabel: DOCUMENT_CATEGORIES[d.document_category] ?? d.document_category, mime: d.mime_type, size: d.file_size, uploadedAt: d.uploaded_at }))
}

async function notesOf(c, enquiryId, proposalId = undefined) {
  const { rows } = await c.query(
    `SELECT * FROM partner_enquiry_notes WHERE enquiry_id = $1 ${proposalId !== undefined ? 'AND proposal_id = $2' : ''} ORDER BY created_at DESC, id DESC`,
    proposalId !== undefined ? [enquiryId, proposalId] : [enquiryId],
  )
  return rows.map((n) => ({ id: n.id, note: n.note, author: n.author_email, createdAt: n.created_at, about: n.proposal_id ? 'PROPOSAL' : 'ENQUIRY' }))
}

export async function enquiryDetail(c, id, admin) {
  const { rows } = await c.query(`${ROW_SELECT} WHERE e.id = $1`, [id])
  if (!rows.length) throw notFound('Enquiry not found')
  const e = rows[0]
  const answers = (await c.query('SELECT * FROM partner_enquiry_answers WHERE enquiry_id = $1 ORDER BY position', [id])).rows
  const sections = []
  for (const a of answers) {
    let s = sections.at(-1)
    if (!s || s.key !== a.section_key) sections.push((s = { key: a.section_key, title: a.section_title, answers: [] }))
    s.answers.push({ key: a.question_key, label: a.question_label, type: a.question_type, value: a.display_value })
  }
  const followups = (await c.query(
    `SELECT f.*, a.email AS assignee_email FROM partner_enquiry_followups f LEFT JOIN admin_users a ON a.id = f.assigned_admin_id
      WHERE f.enquiry_id = $1 ORDER BY (f.status = 'PENDING') DESC, f.scheduled_at`, [id])).rows
  const acts = (await c.query('SELECT * FROM partner_enquiry_activities WHERE enquiry_id = $1 ORDER BY created_at DESC, id DESC LIMIT 300', [id])).rows
  const proposal = (await c.query('SELECT id, reference, status FROM partner_product_proposals WHERE enquiry_id = $1', [id])).rows[0] ?? null
  const opp = (await c.query('SELECT o.*, a.email AS creator FROM partner_opportunities o LEFT JOIN admin_users a ON a.id = o.created_by WHERE o.enquiry_id = $1', [id])).rows[0]
  const assigner = e.assigned_by ? (await c.query('SELECT email FROM admin_users WHERE id = $1', [e.assigned_by])).rows[0] : null
  return {
    ...enquiryRow(e),
    pincode: e.pincode, country: e.country, preferredContact: e.preferred_contact_method, callbackTime: e.callback_time, startTimeline: e.start_timeline,
    decision: e.decision, assignedAt: e.assigned_at, assignedBy: assigner ? { email: assigner.email } : null,
    questionnaireVersion: e.questionnaire_version, consent: { text: e.consent_text, at: e.consent_at },
    sections,
    documents: await documentsOf(c, id),
    notes: await notesOf(c, id),
    followups: followups.map((f) => followupView({ ...f, reference: e.reference, applicant_name: e.applicant_name })),
    activity: acts.map(activityView),
    proposal: proposal ? { id: proposal.id, reference: proposal.reference, status: proposal.status } : null,
    opportunity: opp ? { title: opp.title, notes: opp.notes, createdAt: opp.created_at, createdBy: opp.creator ?? null } : null,
    allowedStatuses: PLAIN_MOVES[e.status],
    actions: actionsFor(e, admin),
    staff: await assignableStaff(c),
    contact: contactLinks(e.mobile_number, e.email, e.reference),
  }
}

// ---------------------------------------------------------------- changes

async function staffMember(c, id) {
  const { rows } = await c.query(`SELECT id, email, role FROM admin_users WHERE id = $1`, [id])
  if (!rows.length || !['MANAGER', 'OPERATOR'].includes(rows[0].role)) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a manager or operator')
  return rows[0]
}

async function setStatus(c, e, to, admin, type = 'STATUS_CHANGED', metadata = null) {
  const at = now()
  await c.query('UPDATE partner_enquiries SET status = $2, updated_at = $3, status_changed_at = $3 WHERE id = $1', [e.id, to, at])
  await activity(c, e.id, admin, type, { oldValue: e.status, newValue: to, metadata })
}

/** PATCH: status (plain moves only), priority and assignment. Returns what changed. */
export async function updateEnquiry(c, id, admin, b) {
  const e = await lockEnquiry(c, id)
  const changed = {}
  if (b.status !== undefined && b.status !== e.status) {
    if (!PLAIN_MOVES[e.status].includes(b.status)) {
      throw conflict(`An enquiry that is ${e.status} can't move to ${b.status} here${['CONVERTED', 'REJECTED', 'CLOSED'].includes(b.status) ? '. Use the approve, reject, close or convert action' : ''}.`, 'INVALID_TRANSITION')
    }
    await setStatus(c, e, b.status, admin, 'STATUS_CHANGED', b.reason ? { reason: b.reason } : null)
    changed.status = [e.status, b.status]
  }
  if (b.priority !== undefined && b.priority !== e.priority) {
    await c.query('UPDATE partner_enquiries SET priority = $2, updated_at = $3 WHERE id = $1', [id, b.priority, now()])
    await activity(c, id, admin, 'PRIORITY_CHANGED', { oldValue: e.priority, newValue: b.priority })
    changed.priority = [e.priority, b.priority]
  }
  if (b.assignedTo !== undefined && (b.assignedTo ?? null) !== e.assigned_admin_id) {
    const to = b.assignedTo ? await staffMember(c, b.assignedTo) : null
    const old = e.assigned_admin_id ? (await c.query('SELECT email FROM admin_users WHERE id = $1', [e.assigned_admin_id])).rows[0]?.email ?? null : null
    const at = now()
    await c.query('UPDATE partner_enquiries SET assigned_admin_id = $2, assigned_at = $3, assigned_by = $4, updated_at = $3 WHERE id = $1', [id, to?.id ?? null, to ? at : null, to ? admin.id : null])
    await activity(c, id, admin, 'ASSIGNED', { oldValue: old, newValue: to?.email ?? null })
    if (to) await queuePartnerMessages(c, { kind: 'ASSIGNED', enquiryId: id, tag: String(at.getTime()), detail: `to ${to.email} by ${admin.email}` })
    changed.assignedTo = [old, to?.email ?? null]
  }
  return changed
}

/** approve, reject, close, reopen or convert (managers; the route checks the role). */
export async function decide(c, id, admin, action, { reason = null, note = null, title = null, notes = null } = {}) {
  const e = await lockEnquiry(c, id)
  const done = { approve: 'approved', reject: 'rejected', close: 'closed', reopen: 'reopened', convert: 'converted' }[action]
  if (!ACTION_FROM[action].includes(e.status)) throw conflict(`An enquiry that is ${e.status} can't be ${done}`, 'INVALID_TRANSITION')
  const to = ACTION_TO[action]
  const type = { approve: 'APPROVED', reject: 'REJECTED', close: 'CLOSED', reopen: 'REOPENED', convert: 'CONVERTED' }[action]
  await setStatus(c, e, to, admin, type, { reason: reason ?? note ?? undefined, title: title ?? undefined })
  if (action === 'approve') await c.query(`UPDATE partner_enquiries SET decision = 'APPROVED' WHERE id = $1`, [id])
  if (action === 'reject') await c.query(`UPDATE partner_enquiries SET decision = 'REJECTED' WHERE id = $1`, [id])
  if (action === 'reopen') await c.query('UPDATE partner_enquiries SET decision = NULL WHERE id = $1', [id])
  if (action === 'convert') {
    await c.query('INSERT INTO partner_opportunities (id, enquiry_id, title, notes, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [newId('pop'), id, title, notes, admin.id, now()])
    await queuePartnerMessages(c, { kind: 'CONVERTED', enquiryId: id, detail: title })
  }
  if (action === 'reject') await queuePartnerMessages(c, { kind: 'REJECTED', enquiryId: id, detail: reason })
  // Pending follow-ups of an enquiry that has ended are no longer due.
  if (['REJECTED', 'CLOSED'].includes(to)) {
    await c.query(`UPDATE partner_enquiry_followups SET status = 'CANCELLED', updated_at = $2 WHERE enquiry_id = $1 AND status = 'PENDING'`, [id, now()])
  }
  return { from: e.status, to }
}

export async function addNote(c, id, admin, note, proposalId = null) {
  await lockEnquiry(c, id)
  const noteId = newId('pnt')
  await c.query('INSERT INTO partner_enquiry_notes (id, enquiry_id, proposal_id, admin_user_id, author_email, note, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    noteId, id, proposalId, admin.id, admin.email, note, now(),
  ])
  await c.query('UPDATE partner_enquiries SET updated_at = $2 WHERE id = $1', [id, now()])
  await activity(c, id, admin, proposalId ? 'PROPOSAL_NOTE_ADDED' : 'NOTE_ADDED', { proposalId, metadata: { noteId } })
  return noteId
}

const istWords = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })

export async function addFollowup(c, id, admin, { scheduledAt, assignedTo, notes }) {
  const e = await lockEnquiry(c, id)
  if (['REJECTED', 'CLOSED'].includes(e.status)) throw conflict('Reopen the enquiry before scheduling a follow-up', 'ENQUIRY_ENDED')
  if (scheduledAt < new Date(now().getTime() - 60_000)) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a time in the future')
  const who = assignedTo ? await staffMember(c, assignedTo) : { id: admin.id }
  const fid = newId('pfu')
  const at = now()
  try {
    await c.query('SAVEPOINT pfu')
    await c.query(
      `INSERT INTO partner_enquiry_followups (id, enquiry_id, assigned_admin_id, scheduled_at, notes, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
      [fid, id, who.id, scheduledAt, notes ?? null, admin.id, at],
    )
    await c.query('RELEASE SAVEPOINT pfu')
  } catch (err) {
    await c.query('ROLLBACK TO SAVEPOINT pfu')
    if (err.code === '23505') throw conflict('There is already a follow-up at that time', 'FOLLOWUP_EXISTS')
    throw err
  }
  await activity(c, id, admin, 'FOLLOWUP_SCHEDULED', { newValue: istWords.format(scheduledAt), metadata: { followupId: fid } })
  return fid
}

export async function updateFollowup(c, id, followupId, admin, b) {
  await lockEnquiry(c, id)
  const { rows } = await c.query('SELECT * FROM partner_enquiry_followups WHERE id = $1 AND enquiry_id = $2 FOR UPDATE', [followupId, id])
  if (!rows.length) throw notFound('Follow-up not found')
  const f = rows[0]
  const sets = []
  const vals = [followupId]
  const set = (col, v) => {
    vals.push(v)
    sets.push(`${col} = $${vals.length}`)
  }
  if (b.scheduledAt !== undefined) {
    if (b.scheduledAt < new Date(now().getTime() - 60_000) && (b.status ?? f.status) === 'PENDING') throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a time in the future')
    set('scheduled_at', b.scheduledAt)
    // A moved follow-up gets its alerts again.
    set('due_alert_at', null)
    set('overdue_alert_at', null)
  }
  if (b.assignedTo !== undefined) set('assigned_admin_id', b.assignedTo ? (await staffMember(c, b.assignedTo)).id : null)
  if (b.notes !== undefined) set('notes', b.notes || null)
  let type = 'FOLLOWUP_UPDATED'
  if (b.status !== undefined && b.status !== f.status) {
    set('status', b.status)
    set('completed_at', b.status === 'DONE' ? now() : null)
    type = b.status === 'DONE' ? 'FOLLOWUP_DONE' : b.status === 'CANCELLED' ? 'FOLLOWUP_CANCELLED' : 'FOLLOWUP_UPDATED'
  }
  if (!sets.length) return
  set('updated_at', now())
  try {
    await c.query('SAVEPOINT pfu')
    await c.query(`UPDATE partner_enquiry_followups SET ${sets.join(', ')} WHERE id = $1`, vals)
    await c.query('RELEASE SAVEPOINT pfu')
  } catch (err) {
    await c.query('ROLLBACK TO SAVEPOINT pfu')
    if (err.code === '23505') throw conflict('There is already a follow-up at that time', 'FOLLOWUP_EXISTS')
    throw err
  }
  await activity(c, id, admin, type, { newValue: istWords.format(b.scheduledAt ?? f.scheduled_at), metadata: { followupId } })
}

export async function recordContact(c, id, admin, channel, note) {
  await lockEnquiry(c, id)
  await activity(c, id, admin, 'CONTACT_OPENED', { newValue: channel, metadata: note ? { note } : null })
}

/** Records a request for more information; a NEW or UNDER_REVIEW enquiry becomes CONTACTED. Staff send the message themselves. */
export async function requestInfo(c, id, admin, channel, message) {
  const e = await lockEnquiry(c, id)
  await activity(c, id, admin, 'INFO_REQUESTED', { newValue: channel, metadata: { message } })
  if (e.status === 'NEW' || e.status === 'UNDER_REVIEW') await setStatus(c, e, 'CONTACTED', admin)
}

// ---------------------------------------------------------------- overview

export async function overview(c) {
  const counts = Object.fromEntries(ENQUIRY_STATUSES.map((s) => [s, 0]))
  for (const r of (await c.query('SELECT status, COUNT(*)::int AS n FROM partner_enquiries GROUP BY status')).rows) counts[r.status] = r.n
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const proposalsAwaiting = (await c.query(`SELECT COUNT(*)::int AS n FROM partner_product_proposals WHERE status <> ALL($1)`, [PROPOSAL_FINAL])).rows[0].n
  const latest = (await c.query(`${ROW_SELECT} ORDER BY e.submitted_at DESC, e.id LIMIT 8`)).rows.map(enquiryRow)
  const byCategory = (await c.query(
    `SELECT pc.code, pc.name, COUNT(ec.enquiry_id)::int AS count FROM partnership_categories pc
       LEFT JOIN partner_enquiry_categories ec ON ec.category_code = pc.code GROUP BY pc.code, pc.name, pc.display_order ORDER BY pc.display_order`,
  )).rows
  const byState = (await c.query('SELECT state, COUNT(*)::int AS count FROM partner_enquiries GROUP BY state ORDER BY count DESC, state LIMIT 40')).rows
  const at = now()
  const fsel = `SELECT f.*, a.email AS assignee_email, e.reference, e.applicant_name FROM partner_enquiry_followups f
    JOIN partner_enquiries e ON e.id = f.enquiry_id LEFT JOIN admin_users a ON a.id = f.assigned_admin_id WHERE f.status = 'PENDING'`
  const overdue = (await c.query(`${fsel} AND f.scheduled_at < $1 ORDER BY f.scheduled_at LIMIT 50`, [at])).rows.map((f) => followupView(f, at))
  const upcoming = (await c.query(`${fsel} AND f.scheduled_at >= $1 AND f.scheduled_at < $2 ORDER BY f.scheduled_at LIMIT 50`, [at, new Date(at.getTime() + 7 * 86_400_000)])).rows.map((f) => followupView(f, at))
  const recentlyConverted = (await c.query(`${ROW_SELECT} WHERE e.status = 'CONVERTED' ORDER BY e.status_changed_at DESC LIMIT 8`)).rows.map(enquiryRow)
  const proposalsNeedingAttention = (await c.query(`${PROPOSAL_SELECT} WHERE p.status <> ALL($1) ORDER BY p.status = 'SUBMITTED' DESC, p.created_at LIMIT 8`, [PROPOSAL_FINAL])).rows.map(proposalRow)
  return {
    counts: { total, ...counts, pendingReview: counts.NEW + counts.UNDER_REVIEW, proposalsAwaiting },
    latest, byCategory, byState, followups: { overdue, upcoming }, recentlyConverted, proposalsNeedingAttention,
    today: todayIST(),
  }
}

// ---------------------------------------------------------------- product proposals

export async function listProposals(c, f) {
  const where = []
  const vals = []
  if (f.status?.length) {
    vals.push(f.status)
    where.push(`p.status = ANY($${vals.length})`)
  }
  if (f.q) {
    vals.push(`%${f.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`)
    where.push(`(p.product_name ILIKE $${vals.length} OR p.product_category ILIKE $${vals.length} OR e.applicant_name ILIKE $${vals.length} OR p.reference ILIKE $${vals.length})`)
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = (await c.query(`SELECT COUNT(*)::int AS n FROM partner_product_proposals p JOIN partner_enquiries e ON e.id = p.enquiry_id ${w}`, vals)).rows[0].n
  const { rows } = await c.query(`${PROPOSAL_SELECT} ${w} ORDER BY p.created_at DESC, p.id LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`, vals)
  return { items: rows.map(proposalRow), total, page: f.page, pageSize: f.pageSize }
}

async function lockProposal(c, id) {
  const { rows } = await c.query('SELECT * FROM partner_product_proposals WHERE id = $1 FOR UPDATE', [id])
  if (!rows.length) throw notFound('Product proposal not found')
  return rows[0]
}

const proposalMoves = (p, admin) => {
  if (PROPOSAL_FINAL.includes(p.status)) return isManager(admin) ? ['UNDER_EVALUATION'] : []
  return PROPOSAL_STATUSES.filter((s) => s !== p.status && (isManager(admin) || !PROPOSAL_FINAL.includes(s)) && s !== 'SUBMITTED')
}

export async function proposalDetail(c, id, admin) {
  const { rows } = await c.query(`${PROPOSAL_SELECT} WHERE p.id = $1`, [id])
  if (!rows.length) throw notFound('Product proposal not found')
  const p = rows[0]
  const extra = Object.fromEntries((await c.query(
    `SELECT question_key, display_value FROM partner_enquiry_answers WHERE enquiry_id = $1 AND question_key = ANY($2)`,
    [p.enquiry_id, ['pd_appeal', 'pd_canManage', 'pd_relationships', 'pd_stage']],
  )).rows.map((r) => [r.question_key, r.display_value]))
  const acts = (await c.query('SELECT * FROM partner_enquiry_activities WHERE proposal_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200', [id])).rows
  return {
    ...proposalRow(p),
    description: p.description, productStage: extra.pd_stage ?? null, supplierType: p.supplier_type, qualityCertifications: p.quality_certifications,
    commercialAppeal: extra.pd_appeal ?? null, canManage: extra.pd_canManage ?? null, relationships: extra.pd_relationships ?? null,
    documents: await documentsOf(c, p.enquiry_id),
    notes: await notesOf(c, p.enquiry_id, id),
    activity: acts.map(activityView),
    allowedStatuses: proposalMoves(p, admin),
    actions: Object.fromEntries([['approve', 'APPROVED'], ['reject', 'REJECTED'], ['close', 'CLOSED']].map(([k, s]) => [k, proposalMoves(p, admin).includes(s)])),
    contact: contactLinks(p.mobile_number, p.email, p.enquiry_reference),
    enquiry: { id: p.enquiry_id, reference: p.enquiry_reference, status: p.enquiry_status },
    addsToShop: false,
  }
}

export async function updateProposal(c, id, admin, { status, reason }, type = 'PROPOSAL_STATUS_CHANGED') {
  const p = await lockProposal(c, id)
  if (status === p.status) return { from: p.status, to: status }
  if (!proposalMoves(p, admin).includes(status)) {
    if (PROPOSAL_FINAL.includes(status) && !isManager(admin)) throw new HttpError(403, 'FORBIDDEN', 'Only a manager can approve, reject or close a product proposal')
    throw conflict(`A proposal that is ${p.status} can't move to ${status}`, 'INVALID_TRANSITION')
  }
  if (PROPOSAL_FINAL.includes(status) && !reason) throw new HttpError(400, 'VALIDATION_ERROR', 'Say why (5 characters or more)')
  await c.query('UPDATE partner_product_proposals SET status = $2, updated_at = $3 WHERE id = $1', [id, status, now()])
  await activity(c, p.enquiry_id, admin, type, { proposalId: id, oldValue: p.status, newValue: status, metadata: reason ? { reason } : null })
  return { from: p.status, to: status, enquiryId: p.enquiry_id }
}

export async function proposalEnquiry(c, id) {
  const { rows } = await c.query('SELECT enquiry_id FROM partner_product_proposals WHERE id = $1', [id])
  if (!rows.length) throw notFound('Product proposal not found')
  return rows[0].enquiry_id
}

// ---------------------------------------------------------------- categories

export async function categoriesForStaff(c) {
  const { rows } = await c.query(
    `SELECT pc.*, (SELECT COUNT(*)::int FROM partner_enquiry_categories ec WHERE ec.category_code = pc.code) AS enquiries
       FROM partnership_categories pc ORDER BY pc.display_order, pc.code`,
  )
  return rows.map((r) => ({ code: r.code, name: r.name, description: r.description, active: r.is_active, displayOrder: r.display_order, enquiries: r.enquiries }))
}

export async function updateCategory(c, code, b) {
  const { rows } = await c.query('SELECT * FROM partnership_categories WHERE code = $1 FOR UPDATE', [code])
  if (!rows.length) throw notFound('Category not found')
  const old = rows[0]
  if (b.active === false && old.is_active) {
    const left = (await c.query('SELECT COUNT(*)::int AS n FROM partnership_categories WHERE is_active AND code <> $1', [code])).rows[0].n
    if (!left) throw conflict('At least one category must stay open', 'LAST_CATEGORY')
  }
  await c.query(
    `UPDATE partnership_categories SET name = COALESCE($2, name), description = COALESCE($3, description), is_active = COALESCE($4, is_active),
       display_order = COALESCE($5, display_order), updated_at = $6 WHERE code = $1`,
    [code, b.name ?? null, b.description ?? null, b.active ?? null, b.displayOrder ?? null, now()],
  )
  return { before: { name: old.name, active: old.is_active, displayOrder: old.display_order }, after: b }
}

export async function documentRow(c, enquiryId, documentId) {
  const { rows } = await c.query('SELECT * FROM partner_enquiry_documents WHERE id = $1 AND enquiry_id = $2', [documentId, enquiryId])
  if (!rows.length) throw notFound('Document not found')
  return rows[0]
}
