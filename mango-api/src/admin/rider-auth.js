// Rider sign-in for the rider app (docs/rider-app/README.md). Before the staff gate.
//
// A rider signs in on their own phone with their number: a 6-digit login code
// (by WhatsApp's authentication template or SMS, the customers' sender), then
// sets a 4-digit PIN for that phone. The phone keeps a refresh token bound to
// its device id; after that the app opens with the PIN alone. Riders keep the
// RIDER role and its limits (access.js riderScope): the access token is the
// same staff token the panel uses.
//
// Two things are needed to get in: the phone (its device-bound refresh token,
// which only the login code issues) and the PIN. Five wrong PINs revoke the
// device, and the rider signs in with a code again. A manager revokes a lost
// phone from Staff (admin/staff.js), which also ends its access tokens.
// A refresh without the PIN works only within 12 hours of the last PIN unlock
// (a shift), so a phone left unlocked overnight asks for the PIN again.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import express from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { audit } from '../access.js'
import { ACCESS_TTL_S, signAccess } from '../auth.js'
import { now } from '../clock.js'
import { phoneSchema } from '../customer.js'
import { query, tx } from '../db.js'
import { env, isProd } from '../env.js'
import { asyncHandler, HttpError, parse, unauthorized } from '../errors.js'
import { newId } from '../ids.js'
import { logger, maskPhone } from '../logger.js'
import { hit, sharedLimiter } from '../ratelimit.js'
import { sendOtp } from '../sms.js'

export const router = express.Router()

const CODE_TTL_MS = 5 * 60_000
const CODE_MAX_TRIES = 3
const CODES_PER_HOUR = 5
const SETUP_TTL_S = 10 * 60
const PIN_MAX_FAILURES = 5
/** A refresh without the PIN works this long after the last PIN unlock. */
export const UNLOCK_MS = 12 * 3_600_000

const limiter = sharedLimiter('rider-auth', { windowMs: 15 * 60_000, limit: 40 })

const pepper = () => env.OTP_PEPPER || env.JWT_SECRET
const hashCode = (phone, code) => createHash('sha256').update(`${pepper()}:rider:${phone}:${code}`).digest('hex')
const hashRefresh = (token) => createHash('sha256').update(`${pepper()}:rider-rt:${token}`).digest('hex')
const sameHex = (a, b) => {
  const x = Buffer.from(String(a ?? ''), 'hex')
  const y = Buffer.from(String(b ?? ''), 'hex')
  return x.length === 32 && x.length === y.length && timingSafeEqual(x, y)
}
const deviceId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'deviceId must be 8 to 64 letters, digits, _ or -')
const pin = z.string().regex(/^\d{4}$/, 'The PIN is 4 digits')
/** PINs nobody should choose. */
const WEAK_PINS = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '1212', '0123'])

const riderView = (u) => ({ id: u.id, name: u.display_name ?? null, firstName: (u.display_name ?? u.email).split(/[\s@._-]/)[0] })

async function riderByPhone(phone) {
  const { rows } = await query("SELECT id, email, role, session_version, display_name, phone FROM admin_users WHERE phone = $1 AND role = 'RIDER'", [phone])
  return rows[0] ?? null
}

/** The staff access token, as the panel gets it. Riders are never asked to set up two-step: phone and PIN are their two factors. */
const accessFor = (u) => signAccess({ sub: u.id, email: u.email, role: u.role, typ: 'admin', sv: u.session_version ?? 0, amr: 'device_pin' })

/**
 * Sends a login code to a rider's number. The answer is the same for a number
 * that is no rider's (nothing is sent), so it does not say who is a rider.
 */
router.post(
  '/rider/otp/request',
  limiter,
  asyncHandler(async (req, res) => {
    const { phone } = parse(z.object({ phone: phoneSchema }), req.body)
    const hour = await hit(`rider-otp:${phone}`, 3_600_000)
    if (hour.hits > CODES_PER_HOUR) throw new HttpError(429, 'OTP_LIMIT', 'Too many codes requested. Try again in an hour.')
    const rider = await riderByPhone(phone)
    if (!rider) {
      logger.info({ phone: maskPhone(phone) }, 'rider code asked for a number that is no rider')
      return res.json(env.DEMO_OTP ? { sent: true, channel: 'demo', devCode: env.DEMO_OTP } : { sent: true, channel: 'whatsapp' })
    }
    // DEMO_OTP (demo deploys only, env.js): the fixed code, nothing sent, shown on the sign-in screen.
    const code = env.DEMO_OTP ?? String(randomInt(100_000, 1_000_000))
    const channel = env.DEMO_OTP ? 'demo' : await sendOtp(phone, code, 'whatsapp')
    await query(
      `INSERT INTO rider_otps (phone, code_hash, expires_at, attempts, created_at) VALUES ($1, $2, $3, 0, $4)
       ON CONFLICT (phone) DO UPDATE SET code_hash = $2, expires_at = $3, attempts = 0, created_at = $4`,
      [phone, hashCode(phone, code), new Date(now().getTime() + CODE_TTL_MS), now()],
    )
    // As the shop's sign-in: on a developer's machine the code comes back for the screen.
    if (env.DEMO_OTP) return res.json({ sent: true, channel, devCode: code })
    res.json(isProd || !env.OTP_CODE_IN_RESPONSE ? { sent: true, channel } : { sent: true, channel, devCode: code })
  }),
)

/** Checks the code. Returns a 10-minute ticket to set this phone's PIN. */
router.post(
  '/rider/otp/verify',
  limiter,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'), deviceId }), req.body)
    const result = await tx(async (c) => {
      // DEMO_OTP (demo deploys only, env.js): the fixed code always works, asked for or not, as often as needed.
      if (env.DEMO_OTP && b.code === env.DEMO_OTP) {
        await c.query('DELETE FROM rider_otps WHERE phone = $1', [b.phone])
        return { ok: true }
      }
      const { rows } = await c.query('SELECT * FROM rider_otps WHERE phone = $1 FOR UPDATE', [b.phone])
      const otp = rows[0]
      if (!otp || otp.expires_at <= now()) return { error: unauthorized('This code has expired. Ask for a new one.', 'OTP_EXPIRED') }
      if (otp.attempts >= CODE_MAX_TRIES) return { error: unauthorized('Too many wrong codes. Ask for a new one.', 'OTP_LOCKED') }
      if (!sameHex(otp.code_hash, hashCode(b.phone, b.code))) {
        await c.query('UPDATE rider_otps SET attempts = attempts + 1 WHERE phone = $1', [b.phone])
        return { error: unauthorized('That code is not right.', 'OTP_INVALID') }
      }
      await c.query('DELETE FROM rider_otps WHERE phone = $1', [b.phone])
      return { ok: true }
    })
    if (result.error) throw result.error
    const rider = await riderByPhone(b.phone)
    if (!rider) throw unauthorized('This number is not a rider any more. Call ops.', 'NOT_A_RIDER')
    const setupToken = jwt.sign({ sub: rider.id, typ: 'rider_pin_setup', dev: b.deviceId, iat: Math.floor(now().getTime() / 1000) }, env.JWT_SECRET, {
      expiresIn: SETUP_TTL_S, algorithm: 'HS256',
    })
    res.json({ setupToken, expiresIn: SETUP_TTL_S, rider: riderView(rider) })
  }),
)

/** Issues a fresh device refresh token, stores its hash and marks the PIN unlock. */
async function newDeviceSession(c, deviceRowId) {
  const token = randomBytes(32).toString('base64url')
  const at = now()
  await c.query('UPDATE rider_devices SET refresh_hash = $2, unlocked_until = $3, last_seen_at = $4, pin_failures = 0 WHERE id = $1', [
    deviceRowId, hashRefresh(token), new Date(at.getTime() + UNLOCK_MS), at,
  ])
  return token
}

async function riderById(c, id) {
  const { rows } = await c.query("SELECT id, email, role, session_version, display_name FROM admin_users WHERE id = $1 AND role = 'RIDER'", [id])
  return rows[0] ?? null
}

const sessionBody = (u, refreshToken) => ({ accessToken: accessFor(u), expiresIn: ACCESS_TTL_S, refreshToken, rider: riderView(u) })

/** Sets this phone's PIN after the login code: the phone is now bound to the rider. Any earlier binding of the same device id is replaced. */
router.post(
  '/rider/pin/set',
  limiter,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ setupToken: z.string().min(20).max(2000), deviceId, pin, label: z.string().trim().max(120).optional() }), req.body)
    let t
    try {
      t = jwt.verify(b.setupToken, env.JWT_SECRET, { algorithms: ['HS256'], clockTimestamp: Math.floor(now().getTime() / 1000) })
      if (t.typ !== 'rider_pin_setup' || t.dev !== b.deviceId) throw new Error('wrong ticket')
    } catch {
      throw unauthorized('That took too long. Ask for a new code.', 'TICKET_EXPIRED')
    }
    if (WEAK_PINS.has(b.pin)) throw new HttpError(422, 'WEAK_PIN', 'Pick a PIN that is harder to guess')
    const pinHash = await bcrypt.hash(b.pin, 10)
    const out = await tx(async (c) => {
      const u = await riderById(c, t.sub)
      if (!u) throw unauthorized('This number is not a rider any more. Call ops.', 'NOT_A_RIDER')
      await c.query('UPDATE rider_devices SET revoked_at = $3, revoked_by = $4 WHERE rider_id = $1 AND device_id = $2 AND revoked_at IS NULL', [u.id, b.deviceId, now(), 'replaced'])
      const id = newId('dev')
      await c.query('INSERT INTO rider_devices (id, rider_id, device_id, label, pin_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
        id, u.id, b.deviceId, b.label ?? req.get('user-agent')?.slice(0, 120) ?? null, pinHash, now(),
      ])
      return { u, token: await newDeviceSession(c, id) }
    })
    await audit(out.u, 'auth.login', { detail: { method: 'rider_phone', device: b.deviceId }, requestId: req.id })
    res.json(sessionBody(out.u, out.token))
  }),
)

/** The device's live row, checked against its refresh token. */
async function deviceFor(c, devId, refreshToken) {
  const { rows } = await c.query('SELECT * FROM rider_devices WHERE device_id = $1 AND revoked_at IS NULL FOR UPDATE', [devId])
  const d = rows.find((r) => sameHex(r.refresh_hash, hashRefresh(refreshToken)))
  if (!d) throw unauthorized('This phone is signed out. Sign in with your number again.', 'DEVICE_REVOKED')
  return d
}

/** Opens the app with the PIN. Rotates the refresh token. */
router.post(
  '/rider/pin/unlock',
  limiter,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ deviceId, refreshToken: z.string().min(20).max(200), pin }), req.body)
    const r = await tx(async (c) => {
      const d = await deviceFor(c, b.deviceId, b.refreshToken)
      if (!(await bcrypt.compare(b.pin, d.pin_hash ?? ''))) {
        const fails = d.pin_failures + 1
        if (fails >= PIN_MAX_FAILURES) {
          await c.query('UPDATE rider_devices SET pin_failures = $2, revoked_at = $3, revoked_by = $4 WHERE id = $1', [d.id, fails, now(), 'wrong PINs'])
          return { error: unauthorized('Too many wrong PINs. Sign in with your number again.', 'PIN_LOCKED') }
        }
        await c.query('UPDATE rider_devices SET pin_failures = $2 WHERE id = $1', [d.id, fails])
        return { error: new HttpError(422, 'WRONG_PIN', `That PIN is not right. ${PIN_MAX_FAILURES - fails} tries left.`, { triesLeft: PIN_MAX_FAILURES - fails }) }
      }
      const u = await riderById(c, d.rider_id)
      if (!u) throw unauthorized('You are no longer a rider. Call ops.', 'NOT_A_RIDER')
      return { u, token: await newDeviceSession(c, d.id) }
    })
    if (r.error) throw r.error
    res.json(sessionBody(r.u, r.token))
  }),
)

/** A new access token while the app is open (no PIN), within 12 hours of the last PIN unlock. Rotates the refresh token. */
router.post(
  '/rider/session/refresh',
  limiter,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ deviceId, refreshToken: z.string().min(20).max(200) }), req.body)
    const r = await tx(async (c) => {
      const d = await deviceFor(c, b.deviceId, b.refreshToken)
      if (!d.unlocked_until || d.unlocked_until <= now()) return { error: unauthorized('Enter your PIN.', 'PIN_REQUIRED') }
      const u = await riderById(c, d.rider_id)
      if (!u) throw unauthorized('You are no longer a rider. Call ops.', 'NOT_A_RIDER')
      const token = randomBytes(32).toString('base64url')
      await c.query('UPDATE rider_devices SET refresh_hash = $2, last_seen_at = $3 WHERE id = $1', [d.id, hashRefresh(token), now()])
      return { u, token }
    })
    if (r.error) throw r.error
    res.json(sessionBody(r.u, r.token))
  }),
)

/** Signs this phone out (the rider app's Sign out). */
router.post(
  '/rider/logout',
  limiter,
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ deviceId, refreshToken: z.string().min(20).max(200) }), req.body)
    await tx(async (c) => {
      const d = await deviceFor(c, b.deviceId, b.refreshToken).catch(() => null)
      if (d) await c.query('UPDATE rider_devices SET revoked_at = $2, revoked_by = $3, refresh_hash = NULL WHERE id = $1', [d.id, now(), 'signed out'])
    })
    res.status(204).end()
  }),
)
