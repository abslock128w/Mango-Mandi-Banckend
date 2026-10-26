// Audit rows that must exist before an answer goes out: a staff member
// looking at a customer's profile, revealing their phone number, downloading
// a bill or exporting a CSV. Unlike access.js audit() (written after the
// response, best effort), this one is awaited and its failure fails the
// request, so nothing is shown that was not recorded.
import { now } from './clock.js'
import { query } from './db.js'
import { newId } from './ids.js'

/** Writes one staff_audit row for this request and returns its id; throws if it can't. */
export async function auditNow(req, action, { target = null, detail = null } = {}, c = { query }) {
  const id = newId('aud')
  await c.query(
    `INSERT INTO staff_audit (id, admin_id, email, role, action, target, detail, request_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, req.admin.id ?? null, req.admin.email, req.admin.role, action, target, detail, req.id ?? null, now()],
  )
  // auditStaffChanges (access.js) skips a request that wrote its own row.
  req.audited = true
  return id
}
