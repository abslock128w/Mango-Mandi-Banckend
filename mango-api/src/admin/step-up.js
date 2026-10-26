// SEC-07 (24 Oct 2026 audit), on with STAFF_STEP_UP=true: adding staff, changing
// a role or password, resetting two-step, giving out a setup code and removing
// someone ask the manager to prove it is them again, with `confirmCode` in the
// body: the 6-digit code from their authenticator app when they have two-step
// on, otherwise their password. A stolen 15-minute access token alone can no
// longer mint a manager or take over a colleague's account.
import bcrypt from 'bcryptjs'
import { now } from '../clock.js'
import { query, tx } from '../db.js'
import { env } from '../env.js'
import { asyncHandler, HttpError } from '../errors.js'
import { logger } from '../logger.js'
import { hit } from '../ratelimit.js'
import { verifyCode } from '../totp.js'

/** Wrong confirmations allowed per manager in STEP_UP_WINDOW_MS before they must wait. */
export const STEP_UP_TRIES = 5
const STEP_UP_WINDOW_MS = 15 * 60_000
const key = (id) => `step-up:${id}`

const needed = (method) =>
  new HttpError(403, 'REAUTH_REQUIRED', method === 'code' ? 'Enter the 6-digit code from your authenticator app to confirm.' : 'Enter your password to confirm.', { method })

async function locked(id) {
  const { rows } = await query('SELECT hits FROM rate_limits WHERE key = $1 AND reset_at > $2', [key(id), now()])
  return (rows[0]?.hits ?? 0) >= STEP_UP_TRIES
}

/**
 * Checks the caller's code or password. A TOTP step once used is spent (as at
 * sign-in), so the same code can't confirm a second change.
 */
function confirmed(adminId, given) {
  return tx(async (c) => {
    const { rows } = await c.query('SELECT password_hash, totp_secret, totp_enabled_at, totp_last_step FROM admin_users WHERE id = $1 FOR UPDATE', [adminId])
    const u = rows[0]
    if (!u) return { method: 'password', ok: false }
    if (u.totp_enabled_at) {
      const step = verifyCode(u.totp_secret, given.replace(/\s/g, ''), now().getTime(), u.totp_last_step)
      if (step != null) await c.query('UPDATE admin_users SET totp_last_step = $2 WHERE id = $1', [adminId, step])
      return { method: 'code', ok: step != null }
    }
    return { method: 'password', ok: await bcrypt.compare(given, u.password_hash) }
  })
}

/** Route guard, after requireManager. A no-op unless STAFF_STEP_UP is on. */
export const requireStepUp = asyncHandler(async (req, _res, next) => {
  if (!env.STAFF_STEP_UP) return next()
  const given = typeof req.body?.confirmCode === 'string' ? req.body.confirmCode.slice(0, 200) : ''
  if (await locked(req.admin.id)) {
    throw new HttpError(429, 'REAUTH_LOCKED', 'Too many wrong confirmations. Try again in 15 minutes.')
  }
  if (!given) {
    const { rows } = await query('SELECT totp_enabled_at FROM admin_users WHERE id = $1', [req.admin.id])
    throw needed(rows[0]?.totp_enabled_at ? 'code' : 'password')
  }
  const r = await confirmed(req.admin.id, given)
  if (!r.ok) {
    await hit(key(req.admin.id), STEP_UP_WINDOW_MS)
    logger.warn({ staffId: req.admin.id, method: req.method, path: req.path }, 'staff change refused: confirmation was wrong')
    throw new HttpError(403, 'REAUTH_FAILED', r.method === 'code' ? 'That code is not right, or was already used. Wait for the next one.' : 'That password is not right.', { method: r.method })
  }
  await query('DELETE FROM rate_limits WHERE key = $1', [key(req.admin.id)])
  next()
})
