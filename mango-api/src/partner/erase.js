// Partner Network: an application's details are deleted once it has ended
// (docs/partner-network.md, "How long applications are kept"). The shop's
// Grow with us form promises this, with PARTNER_RETENTION_DAYS as the number,
// so every path that deletes goes through eraseEnquiry here:
//   - the maintenance run, hourly (eraseEndedApplications), for applications
//     REJECTED, CLOSED or CONVERTED PARTNER_RETENTION_DAYS ago;
//   - a manager's "Delete this application's details now" (admin/partner.js);
//   - the applicant deleting their shop account (privacy.js eraseCustomer).
// A CONVERTED application is a business partner now: it keeps the contact
// details (name, number, email, business name, address, website, place, GSTIN)
// so we can work with them, and loses the rest. Everything else loses all of it.
// What stays on every one: the reference, categories, status, priority, the
// questionnaire version and consent wording, who it was assigned to, the
// dates, and erased_at; the activity history keeps what happened and when, not
// what anyone wrote.
import { outOfTime } from '../budget.js'
import { now } from '../clock.js'
import { query, tx } from '../db.js'
import { env } from '../env.js'
import { conflict, notFound } from '../errors.js'
import { newId } from '../ids.js'
import { logger } from '../logger.js'
import { dropPhoto } from '../photos.js'

/** An application in one of these has ended: the clock for deleting its details starts. */
export const ENDED_STATUSES = ['REJECTED', 'CLOSED', 'CONVERTED']
/** The one ended status that keeps the contact details (the applicant became a partner). */
export const KEEPS_CONTACT = 'CONVERTED'

/** The hourly maintenance step deletes this much before the deadline, so none is late. */
export const ERASE_EARLY_MS = 3_600_000

/** Activity metadata keys that hold what staff wrote (reasons, titles, notes, messages). */
const WRITTEN_KEYS = ['reason', 'title', 'note', 'message']

/** SQL: this row (alias e) still has something the rule says must go. */
const DUE = `(e.erased_at IS NULL OR (e.status <> '${KEEPS_CONTACT}' AND (e.applicant_name IS NOT NULL OR e.mobile_number IS NOT NULL OR e.email IS NOT NULL)))`

/** Whether a locked enquiry row still has something to delete now that it has ended. */
export const hasDetailsLeft = (e) => !e.erased_at || (e.status !== KEEPS_CONTACT && (e.applicant_name != null || e.mobile_number != null || e.email != null))

/**
 * Deletes one application's details. `e` is the enquiry row, locked FOR UPDATE
 * by the caller. `by`: RETENTION, MANAGER or APPLICANT (the applicant's own
 * request always takes the contact details too). Returns { keptContact,
 * documents, blobs }: the stored files to drop after the transaction commits.
 */
export async function eraseEnquiry(c, e, { by, admin = null, at = now() }) {
  const keptContact = e.status === KEEPS_CONTACT && by !== 'APPLICANT'
  const docs = await c.query('DELETE FROM partner_enquiry_documents WHERE enquiry_id = $1 RETURNING blob_path', [e.id])
  await c.query('DELETE FROM partner_enquiry_answers WHERE enquiry_id = $1', [e.id])
  await c.query('DELETE FROM partner_enquiry_notes WHERE enquiry_id = $1', [e.id])
  await c.query('DELETE FROM partner_enquiry_followups WHERE enquiry_id = $1', [e.id])
  // The converted business opportunity is the partnership itself, not the application: a partner keeps it.
  if (!keptContact) await c.query('DELETE FROM partner_opportunities WHERE enquiry_id = $1', [e.id])
  await c.query(
    `UPDATE partner_product_proposals SET product_name = NULL, product_category = NULL, description = NULL, source_location = NULL,
            supplier_type = NULL, procurement_price = NULL, suggested_selling_price = NULL, monthly_supply_capacity = NULL,
            quality_certifications = NULL, sample_available = NULL, updated_at = $2
      WHERE enquiry_id = $1`,
    [e.id, at],
  )
  // The history keeps what happened and when; file names and what staff wrote go.
  await c.query(
    `UPDATE partner_enquiry_activities
        SET new_value = CASE WHEN activity_type = 'DOCUMENT_ADDED' THEN NULL ELSE new_value END,
            metadata = CASE WHEN metadata IS NULL THEN NULL ELSE metadata - $2::text[] END
      WHERE enquiry_id = $1`,
    [e.id, WRITTEN_KEYS],
  )
  // Messages about it (the applicant's receipt carries their name and number; team alerts, reasons).
  await c.query('DELETE FROM notifications WHERE partner_enquiry_id = $1', [e.id])
  // The staff audit keeps who did what; the reasons and titles written into it go (the same scrub as privacy.js).
  await c.query(
    `UPDATE staff_audit SET detail = detail - $2::text[]
      WHERE (target = $1 OR target IN (SELECT id FROM partner_product_proposals WHERE enquiry_id = $1)) AND detail ?| $2::text[]`,
    [e.id, ['reason', 'title']],
  )
  if (keptContact) {
    await c.query(
      `UPDATE partner_enquiries SET additional_comments = NULL, content_hash = NULL, upload_token_hash = NULL, upload_token_expires_at = NULL,
              erased_at = $2, updated_at = $2
        WHERE id = $1`,
      [e.id, at],
    )
  } else {
    await c.query(
      `UPDATE partner_enquiries SET applicant_name = NULL, mobile_number = NULL, email = NULL, city = NULL, pincode = NULL,
              business_name = NULL, business_address = NULL, website = NULL, gstin = NULL, years_operating = NULL,
              additional_comments = NULL, callback_time = NULL, content_hash = NULL, upload_token_hash = NULL, upload_token_expires_at = NULL,
              erased_at = $2, updated_at = $2
        WHERE id = $1`,
      [e.id, at],
    )
  }
  await c.query(
    `INSERT INTO partner_enquiry_activities (id, enquiry_id, actor_admin_id, actor_email, activity_type, new_value, metadata, created_at)
     VALUES ($1, $2, $3, $4, 'DETAILS_ERASED', $5, $6, $7)`,
    [newId('pac'), e.id, admin?.id ?? null, admin?.email ?? null, by, JSON.stringify({ keptContact, documents: docs.rowCount }), at],
  )
  return { keptContact, documents: docs.rowCount, blobs: docs.rows }
}

/** Drops stored document files after the transaction that deleted their rows has committed. */
export async function dropDocuments(blobs) {
  for (const row of blobs) await dropPhoto(row)
}

/**
 * The hourly maintenance step: applications that ended `days` ago (less an
 * hour, so none waits past the deadline) lose their details. One transaction each, rows another run or a staff change
 * holds are skipped (SKIP LOCKED) and taken next time. Bounded per call; out of
 * time, it returns { partial: true } so the step runs again next minute.
 * Returns how many applications were erased.
 */
export async function eraseEndedApplications(at = now(), { days = env.PARTNER_RETENTION_DAYS, batch = 200 } = {}) {
  // An hour early: the step runs hourly, so nothing waits past the promised number of days.
  const cutoff = new Date(at.getTime() - days * 86_400_000 + ERASE_EARLY_MS)
  const { rows } = await query(
    `SELECT e.id FROM partner_enquiries e
      WHERE e.status = ANY($1) AND e.status_changed_at < $2 AND ${DUE}
      ORDER BY e.status_changed_at LIMIT $3`,
    [ENDED_STATUSES, cutoff, batch],
  )
  let n = 0
  for (const { id } of rows) {
    if (outOfTime(2_000)) return { partial: true, erased: n }
    const blobs = await tx(async (c) => {
      // Checked again under the lock: it may have been reopened or erased since the list was read.
      const locked = await c.query(
        `SELECT e.* FROM partner_enquiries e WHERE e.id = $1 AND e.status = ANY($2) AND e.status_changed_at < $3 AND ${DUE} FOR UPDATE SKIP LOCKED`,
        [id, ENDED_STATUSES, cutoff],
      )
      if (!locked.rows.length) return null
      return (await eraseEnquiry(c, locked.rows[0], { by: 'RETENTION', at })).blobs
    })
    if (!blobs) continue
    await dropDocuments(blobs)
    n++
  }
  if (n) logger.info({ applications: n, days }, 'partner application details deleted after the retention period')
  return n
}

/** A manager's "Delete this application's details now": ended applications only. */
export async function eraseNow(c, id, admin) {
  const { rows } = await c.query('SELECT * FROM partner_enquiries WHERE id = $1 FOR UPDATE', [id])
  if (!rows.length) throw notFound('Enquiry not found')
  const e = rows[0]
  if (!ENDED_STATUSES.includes(e.status)) throw conflict('Only an application that has ended (rejected, closed or converted) can have its details deleted', 'ENQUIRY_NOT_ENDED')
  if (!hasDetailsLeft(e)) throw conflict('This application\'s details are already deleted', 'ALREADY_ERASED')
  const r = await eraseEnquiry(c, e, { by: 'MANAGER', admin })
  return { status: e.status, ...r }
}

/** The applications sent with this mobile number (+91...) or email, oldest first. */
export async function applicationsOf(c, { phone = null, email = null }, lock = false) {
  if (!phone && !email) return []
  const { rows } = await c.query(
    `SELECT * FROM partner_enquiries WHERE mobile_number = $1 OR lower(email) = lower($2) ORDER BY submitted_at, id${lock ? ' FOR UPDATE' : ''}`,
    [phone, email],
  )
  return rows
}

/**
 * The applicant asked for their data to be deleted: their shop account
 * (privacy.js, by the account's number, proven by its login code) or a request
 * by email or WhatsApp (ops/erase-customer.js, by number or email). Their
 * applications lose everything, contact details included, whatever their
 * status. An open one is closed first, so nobody works on an empty
 * application. Returns the stored files to drop after commit.
 */
export async function eraseApplicantApplications(c, who, at = now()) {
  const rows = await applicationsOf(c, who, true)
  const blobs = []
  for (const e of rows) {
    if (!ENDED_STATUSES.includes(e.status)) {
      await c.query('UPDATE partner_enquiries SET status = $2, status_changed_at = $3, updated_at = $3 WHERE id = $1', [e.id, 'CLOSED', at])
      await c.query(
        `INSERT INTO partner_enquiry_activities (id, enquiry_id, activity_type, old_value, new_value, created_at) VALUES ($1, $2, 'CLOSED', $3, 'CLOSED', $4)`,
        [newId('pac'), e.id, e.status, at],
      )
      e.status = 'CLOSED'
    }
    blobs.push(...(await eraseEnquiry(c, e, { by: 'APPLICANT', at })).blobs)
  }
  return blobs
}
