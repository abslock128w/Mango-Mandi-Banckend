// Partner Network: an application's progress as the applicant sees it (docs/partner-network.md, "Where an
// application is"). ONE mapping, used by the public status check (GET /v1/partner-network/enquiries/:reference)
// and by the signed-in customer's list (GET /v1/me/partner-enquiries), so both always show the same step for
// the same reference. The shop draws both with one function (shop/partner.js pnTimeline).
//
// The four steps: Submitted → Under review → Call / meeting → Decision, from the record's real status:
//   NEW           Submitted (Under review is next)
//   UNDER_REVIEW  Under review
//   CONTACTED     Call / meeting (we have spoken to them)
//   NEGOTIATION   Call / meeting (a manager approved it for a business discussion: decision APPROVED)
//   CONVERTED     Decision: a partner now
//   REJECTED      Decision: not taken forward
//   CLOSED        Decision: closed
// A pending follow-up (a call we have booked) shows on the Call / meeting step as its time.
//
// Nothing personal: no name, number, email, place, answers, documents, notes, reasons or who handled it. Only
// the reference, when it was sent, the status, when each step was reached and the time of a booked call.
import { now } from '../clock.js'

const PROGRESS_STEPS = ['SUBMITTED', 'UNDER_REVIEW', 'CALL', 'DECISION']
const STEP_OF = { NEW: 0, UNDER_REVIEW: 1, CONTACTED: 2, NEGOTIATION: 2, CONVERTED: 3, REJECTED: 3, CLOSED: 3 }
const OUTCOME = { CONVERTED: 'PARTNER', REJECTED: 'NOT_TAKEN_FORWARD', CLOSED: 'CLOSED' }
// The activities that moved the status (staff.js setStatus, the manager actions, erase.js closing an erased one).
const MOVES = ['SUBMITTED', 'STATUS_CHANGED', 'APPROVED', 'REJECTED', 'CLOSED', 'REOPENED', 'CONVERTED']

const iso = (d) => (d ? new Date(d).toISOString() : null)

/**
 * The progress of one application (pure).
 * `e`: the partner_enquiries row (reference, status, decision, submitted_at, status_changed_at).
 * `moves`: its status moves, oldest first, as [{ status, at }].
 * `nextCall`: the time of its earliest pending follow-up, or null.
 */
function progressOf(e, moves = [], nextCall = null) {
  const current = STEP_OF[e.status] ?? 0
  // When each step was last entered (a reopened application enters Under review again).
  const entered = [iso(e.submitted_at), null, null, null]
  for (const m of moves) {
    const s = STEP_OF[m.status]
    if (s > 0) entered[s] = iso(m.at)
  }
  if (current > 0 && !entered[current]) entered[current] = iso(e.status_changed_at)
  const ended = current === 3
  const steps = PROGRESS_STEPS.map((key, i) => {
    let state = i < current ? 'done' : i === current ? (ended ? 'done' : 'current') : 'next'
    // A decision made without a call: the call step was skipped (a decision always means it was reviewed).
    if (state === 'done' && i === 2 && i < current && !entered[2]) state = 'skipped'
    // Submitted is a thing that happened: always done (while it is the latest step, Under review is next).
    if (i === 0) state = 'done'
    return { key, state, at: state === 'next' ? null : entered[i] }
  })
  const call = !ended && nextCall ? iso(nextCall) : null
  return {
    reference: e.reference,
    submittedAt: iso(e.submitted_at),
    status: e.status,
    // The step the application is at now: the last one reached.
    step: PROGRESS_STEPS[current],
    // NEGOTIATION: a manager approved it for a business discussion (decision APPROVED); the final answer is still to come.
    approved: e.status === 'NEGOTIATION',
    outcome: OUTCOME[e.status] ?? null,
    callAt: call,
    steps,
    updatedAt: iso(e.status_changed_at),
  }
}

/** The progress of these partner_enquiries rows, read with their moves and booked calls (one query each). */
async function progressFor(db, rows) {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const { rows: moves } = await db.query(
    `SELECT enquiry_id, new_value AS status, created_at AS at FROM partner_enquiry_activities
      WHERE enquiry_id = ANY($1) AND activity_type = ANY($2) AND new_value IS NOT NULL
      ORDER BY created_at, id`,
    [ids, MOVES],
  )
  const { rows: calls } = await db.query(
    `SELECT enquiry_id, min(scheduled_at) AS at FROM partner_enquiry_followups
      WHERE enquiry_id = ANY($1) AND status = 'PENDING' AND scheduled_at > $2 GROUP BY enquiry_id`,
    [ids, new Date(now().getTime() - 3_600_000)],
  )
  return rows.map((e) => progressOf(e, moves.filter((m) => m.enquiry_id === e.id), calls.find((c) => c.enquiry_id === e.id)?.at ?? null))
}

const COLUMNS = 'id, reference, status, decision, submitted_at, status_changed_at'

/** One application by its reference (the public check), or null. */
export async function progressByReference(db, reference) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM partner_enquiries WHERE reference = $1`, [reference])
  return rows.length ? (await progressFor(db, rows))[0] : null
}

/**
 * The applications sent with this customer's mobile number, newest first. The form stores the number as
 * +91 and 10 digits (partner_enquiries.mobile_number); the account's number is compared the same way. An
 * application whose details were deleted has no number any more, so it is found by its reference only.
 */
export async function progressForCustomer(db, customerId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM partner_enquiries
      WHERE mobile_number IS NOT NULL
        AND mobile_number = (SELECT '+91' || right(regexp_replace(phone, '\\D', '', 'g'), 10) FROM customers WHERE id = $1 AND deleted_at IS NULL AND phone IS NOT NULL)
      ORDER BY submitted_at DESC LIMIT 20`,
    [customerId],
  )
  return progressFor(db, rows)
}
