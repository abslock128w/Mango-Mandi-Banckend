// Staff accounts (managers only).
import bcrypt from 'bcryptjs'
import express from 'express'
import { z } from 'zod'
import { phoneSchema } from '../customer.js'
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

// ---------------------------------------------------------------- rider phones

/** A rider's signed-in phones (rider app), newest first, revoked ones included. */
router.get(
  '/staff/:id/devices',
  requireManager,
  asyncHandler(async (req, res) => {
    await existing(req.params.id)
    const { rows } = await query(
      'SELECT id, device_id, label, created_at, last_seen_at, revoked_at, revoked_by FROM rider_devices WHERE rider_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.params.id],
    )
    res.json(rows.map((d) => ({
      id: d.id, deviceId: d.device_id, label: d.label, createdAt: d.created_at, lastSeenAt: d.last_seen_at, revokedAt: d.revoked_at, revokedBy: d.revoked_by,
    })))
  }),
)

/** Signs a lost phone out: its refresh token stops working and the rider's access tokens end now. */
router.post(
  '/staff/:id/devices/:deviceId/revoke',
  requireManager,
  asyncHandler(async (req, res) => {
    await existing(req.params.id)
    await tx(async (c) => {
      const r = await c.query(
        'UPDATE rider_devices SET revoked_at = $3, revoked_by = $4, refresh_hash = NULL WHERE id = $1 AND rider_id = $2 AND revoked_at IS NULL RETURNING id',
        [req.params.deviceId, req.params.id, now(), req.actor.label ?? req.actor.id],
      )
      if (!r.rowCount) throw notFound('No signed-in phone with that id')
      // Access tokens already issued end too (the panel and the rider's other phones sign in again).
      await c.query('UPDATE admin_users SET session_version = session_version + 1 WHERE id = $1', [req.params.id])
      await auditInTx(c, req, { target: req.params.id })
    })
    forgetStaff(req.params.id)
    res.status(204).end()
  }),
)

const staffDto = (u) => ({
  id: u.id, email: u.email, role: u.role, createdAt: u.created_at, twoStep: Boolean(u.totp_enabled_at),
  // MANAGER_DAILY_SUMMARY (docs/growth.md): whether this manager gets the evening summary. The number stays with them.
  dailySummary: Boolean(u.daily_summary_opt_in),
  // Rider app (docs/rider-app/README.md): the number a rider signs in with, and their name for customers.
  phone: u.phone ?? null, displayName: u.display_name ?? null, devices: u.devices ?? 0,
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
  asyncHandler(async (_req, res) => res.json((await query(
    `SELECT u.id, u.email, u.role, u.created_at, u.totp_enabled_at, u.daily_summary_opt_in, u.phone, u.display_name,
            (SELECT COUNT(*)::int FROM rider_devices d WHERE d.rider_id = u.id AND d.revoked_at IS NULL) AS devices
       FROM admin_users u ORDER BY u.email`,
  )).rows.map(staffDto))),
)

router.post(
  '/staff',
  requireManager,
  asyncHandler(async (req, res) => {
    const b = parse(
      z.object({
        email: z.string().trim().toLowerCase().email(), role: z.enum(ROLES), password,
        // A rider signs in to the rider app with this number (admin/rider-auth.js); the name is what customers see.
        phone: phoneSchema.optional(), displayName: z.string().trim().min(1).max(80).optional(),
      }),
      req.body,
    )
    if ((await query('SELECT 1 FROM admin_users WHERE email = $1', [b.email])).rowCount) throw conflict('Someone already has that email', 'STAFF_EXISTS')
    if (b.phone && (await query('SELECT 1 FROM admin_users WHERE phone = $1', [b.phone])).rowCount) throw conflict('Another staff member has that number', 'PHONE_TAKEN')
    await stepUp(req)
    const hash = await bcrypt.hash(b.password, 10)
    // SEC-08 (STAFF_AUDIT_TRAIL): the account, its setup code and the audit row commit together.
    const run = env.STAFF_AUDIT_TRAIL ? tx : (fn) => fn({ query })
    const { row, setupCode } = await run(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO admin_users (id, email, password_hash, role, phone, display_name) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (email) DO NOTHING RETURNING id, email, role, created_at, phone, display_name`,
        [newId('adm'), b.email, hash, b.role, b.phone ?? null, b.displayName ?? null],
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
    const b = parse(
      z.object({
        role: z.enum(ROLES).optional(), password: password.optional(),
        phone: phoneSchema.nullable().optional(), displayName: z.string().trim().min(1).max(80).nullable().optional(),
      }),
      req.body,
    )
    // Only the rider-app details: no step-up, and open sessions carry on.
    if (b.role === undefined && b.password === undefined && (b.phone !== undefined || b.displayName !== undefined)) {
      await existing(req.params.id)
      if (b.phone && (await query('SELECT 1 FROM admin_users WHERE phone = $1 AND id <> $2', [b.phone, req.params.id])).rowCount) {
        throw conflict('Another staff member has that number', 'PHONE_TAKEN')
      }
      const row = await tx(async (c) => {
        const { rows } = await c.query(
          `UPDATE admin_users SET phone = CASE WHEN $2 THEN $3 ELSE phone END, display_name = CASE WHEN $4 THEN $5 ELSE display_name END
            WHERE id = $1 RETURNING id, email, role, created_at, totp_enabled_at, daily_summary_opt_in, phone, display_name`,
          [req.params.id, b.phone !== undefined, b.phone ?? null, b.displayName !== undefined, b.displayName ?? null],
        )
        await auditInTx(c, req, { detail: { phone: b.phone === undefined ? undefined : Boolean(b.phone), displayName: b.displayName !== undefined } })
        return rows[0]
      })
      return res.json(staffDto(row))
    }
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
