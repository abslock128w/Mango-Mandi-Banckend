// SEC-07 (24 Oct 2026 audit), on with STAFF_STEP_UP=true: adding staff, changing
// a role or password, resetting two-step, giving out a setup code and removing
// someone ask the manager to prove it is them again, with `confirmCode` in the
// body: the 6-digit code from their authenticator app when they have two-step
// on, otherwise their password. A stolen 15-minute access token alone can no
// longer mint a manager or take over a colleague's account. Turning your own
// two-step on from a signed-in session asks too (admin/auth.js), or the holder
// of a stolen token could enroll their own authenticator and answer every
// later step-up with it.
//
// Routes call `stepUp(req)` after they have checked the request, so a one-time
// code is never spent on a change that is then refused for a typo.
//
// Money and pricing changes always ask, whatever STAFF_STEP_UP says
// (`stepUp(req, { always: true })`): a refund, a price, a discount or a cost is
// exactly what a stolen session would be used for. STEP_UP_ROUTES (admin/policy.js) is
// the one list of every route that asks; test/step-up-routes.test.js calls each one
// and docs/authorization-matrix.md is generated from it.
import bcrypt from 'bcryptjs'
import { now } from '../clock.js'
import { query, tx } from '../db.js'
import { env } from '../env.js'
import { HttpError } from '../errors.js'
import { logger } from '../logger.js'
import { hit } from '../ratelimit.js'
import { verifyCode } from '../totp.js'
import { openSecret } from '../secret-box.js'

export { STEP_UP_ROUTES } from './policy.js'


/** The body without `confirmCode`, for routes whose schema refuses unknown fields. */
export function withoutConfirm(body) {
  if (!body || typeof body !== 'object' || !('confirmCode' in body)) return body
  const { confirmCode: _c, ...rest } = body
  return rest
}

/** Wrong confirmations allowed per manager in STEP_UP_WINDOW_MS before they must wait. */
export const STEP_UP_TRIES = 5
const STEP_UP_WINDOW_MS = 15 * 60_000
const key = (id) => `step-up:${id}`

const needed = (method) =>
  new HttpError(403, 'REAUTH_REQUIRED', method === 'code' ? 'Enter the 6-digit code from your authenticator app to confirm.' : 'Enter your password to confirm.', { method })

const lockedError = () => new HttpError(429, 'REAUTH_LOCKED', 'Too many wrong confirmations. Try again in 15 minutes.')

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
      const step = verifyCode(openSecret(adminId, u.totp_secret), given.replace(/\s/g, ''), now().getTime(), u.totp_last_step)
      if (step != null) await c.query('UPDATE admin_users SET totp_last_step = $2 WHERE id = $1', [adminId, step])
      return { method: 'code', ok: step != null }
    }
    return { method: 'password', ok: await bcrypt.compare(given, u.password_hash) }
  })
}

/**
 * Throws unless the caller confirmed it is them (a no-op unless STAFF_STEP_UP is
 * on, or `always` is set: changing a feature switch always asks, docs/ops.md).
 * Each confirmation is counted before it is checked, in one statement, so
 * parallel guesses can't get past the STEP_UP_TRIES lock together.
 */
export async function stepUp(req, { always = false } = {}) {
  if (!env.STAFF_STEP_UP && !always) return
  const given = typeof req.body?.confirmCode === 'string' ? req.body.confirmCode.slice(0, 200) : ''
  if (!given) {
    if (await locked(req.admin.id)) throw lockedError()
    const { rows } = await query('SELECT totp_enabled_at FROM admin_users WHERE id = $1', [req.admin.id])
    throw needed(rows[0]?.totp_enabled_at ? 'code' : 'password')
  }
  const { hits } = await hit(key(req.admin.id), STEP_UP_WINDOW_MS)
  if (hits > STEP_UP_TRIES) throw lockedError()
  const r = await confirmed(req.admin.id, given)
  if (!r.ok) {
    logger.warn({ staffId: req.admin.id, method: req.method, path: req.path }, 'staff change refused: confirmation was wrong')
    throw new HttpError(403, 'REAUTH_FAILED', r.method === 'code' ? 'That code is not right, or was already used. Wait for the next one.' : 'That password is not right.', { method: r.method })
  }
  await query('DELETE FROM rate_limits WHERE key = $1', [key(req.admin.id)])
}
