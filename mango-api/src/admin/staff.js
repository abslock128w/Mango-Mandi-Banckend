// Staff accounts (managers only).
import bcrypt from 'bcryptjs'
import express from 'express'
import { z } from 'zod'
import { auditInTx, ROLES } from '../access.js'
import { forgetStaff, requireManager } from '../auth.js'
import { now } from '../clock.js'
import { query, tx } from '../db.js'
import { env } from '../env.js'
import { asyncHandler, badRequest, conflict, notFound, parse } from '../errors.js'
import { newId } from '../ids.js'
import { staffPassword } from '../passwords.js'
import { clearPasswordFailures, clearTwoStep, issueSetupCode } from './shared.js'
import { stepUp } from './step-up.js'

export const router = express.Router()

// ---------------------------------------------------------------- staff

const staffDto = (u) => ({
  id: u.id, email: u.email, role: u.role, createdAt: u.created_at, twoStep: Boolean(u.totp_enabled_at),
  // MANAGER_DAILY_SUMMARY (docs/growth.md): whether this manager gets the evening summary. The number stays with them.
  dailySummary: Boolean(u.daily_summary_opt_in),
})
// SEC-09: 12 characters at least, and not a common password (src/passwords.js).
const password = staffPassword

/** 404 unless the staff member exists: checked before step-up, so a code isn't spent on a wrong id. */
async function existing(id) {
  const { rows } = await query('SELECT id, role, totp_enabled_at FROM admin_users WHERE id = $1', [id])
  if (!rows.length) throw notFound('No staff member with that id')
  return rows[0]
}

/**
 * SEC-07 (STAFF_STEP_UP): removing or demoting the last manager with two-step
 * sign-in on is refused, so a stolen session can't leave the shop with only
 * managers an attacker could have enrolled. Inside a transaction the managers
 * are locked, so two managers can't remove each other at once.
 */
async function keepATwoStepManager(c, targetId, { lock = false } = {}) {
  if (!env.STAFF_STEP_UP) return
  const { rows } = await c.query(
    `SELECT id FROM admin_users WHERE role = 'MANAGER' AND totp_enabled_at IS NOT NULL ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
  )
  if (rows.length === 1 && rows[0].id === targetId) {
    throw conflict('This is the only manager with two-step sign-in on. Another manager turns two-step on first.', 'LAST_TWO_STEP_MANAGER')
  }
}

router.get(
  '/staff',
  requireManager,
  asyncHandler(async (_req, res) => res.json((await query('SELECT id, email, role, created_at, totp_enabled_at, daily_summary_opt_in FROM admin_users ORDER BY email')).rows.map(staffDto))),
)

router.post(
  '/staff',
  requireManager,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(ROLES), password }), req.body)
    if ((await query('SELECT 1 FROM admin_users WHERE email = $1', [b.email])).rowCount) throw conflict('Someone already has that email', 'STAFF_EXISTS')
    await stepUp(req)
    const hash = await bcrypt.hash(b.password, 10)
    // SEC-08 (STAFF_AUDIT_TRAIL): the account, its setup code and the audit row commit together.
    const run = env.STAFF_AUDIT_TRAIL ? tx : (fn) => fn({ query })
    const { row, setupCode } = await run(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO admin_users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING RETURNING id, email, role, created_at`,
        [newId('adm'), b.email, hash, b.role],
      )
      if (!rows.length) throw conflict('Someone already has that email', 'STAFF_EXISTS')
      req.params.id = rows[0].id
      // Shown once: they need it to set up two-step sign-in where it is required.
      const code = await issueSetupCode(c, rows[0].id)
      await auditInTx(c, req, { target: rows[0].id })
      return { row: rows[0], setupCode: code }
    })
    res.status(201).json({ ...staffDto(row), setupCode })
  }),
)

/** Changes a person's role or password. Their open sessions and access tokens end, so they sign in again under the change. */
router.patch(
  '/staff/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ role: z.enum(ROLES).optional(), password: password.optional() }), req.body)
    if (req.params.id === req.admin.id && b.role && b.role !== 'MANAGER') throw badRequest('You cannot remove your own manager role', 'SELF_DEMOTE')
    const demoted = b.role && b.role !== 'MANAGER'
    await existing(req.params.id)
    if (demoted) await keepATwoStepManager({ query }, req.params.id)
    await stepUp(req)
    const hash = b.password ? await bcrypt.hash(b.password, 10) : null
    const result = await tx(async (c) => {
      if (demoted) await keepATwoStepManager(c, req.params.id, { lock: true })
      // The role it replaces, for the audit row (never the password, not even its hash).
      const { rows: was } = await c.query('SELECT role FROM admin_users WHERE id = $1 FOR UPDATE', [req.params.id])
      const { rows } = await c.query(
        `UPDATE admin_users SET role = COALESCE($2, role), password_hash = COALESCE($3, password_hash), session_version = session_version + 1
         WHERE id = $1 RETURNING id, email, role, created_at, totp_enabled_at`,
        [req.params.id, b.role ?? null, hash],
      )
      if (!rows.length) throw notFound('No staff member with that id')
      await c.query("UPDATE refresh_sessions SET revoked_at = $2 WHERE user_id = $1 AND user_type = 'admin' AND revoked_at IS NULL", [req.params.id, now()])
      // A new password also lifts a lock from wrong passwords.
      if (hash) await clearPasswordFailures(rows[0].email, c)
      await auditInTx(c, req, b.role ? { before: { role: was[0].role } } : {})
      return rows[0]
    })
    forgetStaff(req.params.id)
    res.json(staffDto(result))
  }),
)

/**
 * For a lost phone: clears someone's two-step sign-in and ends their sessions.
 * They set it up again at next sign-in, with the setup code returned here (shown once).
 */
router.post(
  '/staff/:id/two-step/reset',
  requireManager,
  asyncHandler(async (req, res) => {
    await existing(req.params.id)
    await stepUp(req)
    const setupCode = await tx(async (c) => {
      const { rows } = await c.query('SELECT id FROM admin_users WHERE id = $1 FOR UPDATE', [req.params.id])
      if (!rows.length) throw notFound('No staff member with that id')
      await clearTwoStep(c, req.params.id)
      await c.query('UPDATE admin_users SET session_version = session_version + 1 WHERE id = $1', [req.params.id])
      await c.query("UPDATE refresh_sessions SET revoked_at = $2 WHERE user_id = $1 AND user_type = 'admin' AND revoked_at IS NULL", [req.params.id, now()])
      await auditInTx(c, req)
      return issueSetupCode(c, req.params.id)
    })
    forgetStaff(req.params.id)
    res.json({ setupCode })
  }),
)

/** A new two-step setup code for someone who hasn't set it up (lost the first, or added before codes existed). Shown once. */
router.post(
  '/staff/:id/two-step/setup-code',
  requireManager,
  asyncHandler(async (req, res) => {
    const target = await existing(req.params.id)
    if (target.totp_enabled_at) throw conflict('Two-step sign-in is already on for them. Reset it if they lost their phone.', 'TWO_STEP_ON')
    await stepUp(req)
    const setupCode = await tx(async (c) => {
      const { rows } = await c.query('SELECT totp_enabled_at FROM admin_users WHERE id = $1 FOR UPDATE', [req.params.id])
      if (!rows.length) throw notFound('No staff member with that id')
      if (rows[0].totp_enabled_at) throw conflict('Two-step sign-in is already on for them. Reset it if they lost their phone.', 'TWO_STEP_ON')
      await auditInTx(c, req)
      return issueSetupCode(c, req.params.id)
    })
    res.json({ setupCode })
  }),
)

/** Removes someone's access. Their open sessions end, and access tokens already issued stop working (see requireAdmin). */
router.delete(
  '/staff/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    if (req.params.id === req.admin.id) throw badRequest('You cannot remove yourself', 'SELF_REMOVE')
    await existing(req.params.id)
    await keepATwoStepManager({ query }, req.params.id)
    await stepUp(req)
    await tx(async (c) => {
      await keepATwoStepManager(c, req.params.id, { lock: true })
      const r = await c.query('DELETE FROM admin_users WHERE id = $1', [req.params.id])
      if (!r.rowCount) throw notFound('No staff member with that id')
      // Their stops go back to the unassigned pool (SEC-02).
      await c.query('UPDATE orders SET rider_id = NULL WHERE rider_id = $1', [req.params.id])
      await c.query("UPDATE refresh_sessions SET revoked_at = $2 WHERE user_id = $1 AND user_type = 'admin' AND revoked_at IS NULL", [req.params.id, now()])
      await auditInTx(c, req)
    })
    forgetStaff(req.params.id)
    res.status(204).end()
  }),
)
