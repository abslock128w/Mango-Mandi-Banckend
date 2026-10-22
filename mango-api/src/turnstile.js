// Cloudflare Turnstile: a check, usually invisible, that a person and not a
// script is asking for a login code. On only when TURNSTILE_SECRET_KEY is set,
// which production requires (preflight). If Cloudflare can't be reached, only
// numbers that already have an account get a code (SEC: fail safe); new numbers
// are asked to try again, so an outage can't be used to pump SMS.
import { env } from './env.js'
import { HttpError } from './errors.js'
import { logger } from './logger.js'

const VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export async function requireHuman(token, ip, { known = false } = {}) {
  if (!env.TURNSTILE_SECRET_KEY) return
  if (typeof token !== 'string' || !token || token.length > 2048) throw new HttpError(400, 'CAPTCHA_REQUIRED', 'Please complete the check, then ask for a code again.')
  let ok = false
  try {
    const res = await fetch(VERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(5_000),
    })
    ok = Boolean((await res.json()).success)
  } catch (err) {
    if (known) {
      logger.warn({ err }, 'Turnstile check failed to run; allowing it for a number with an account')
      return
    }
    logger.warn({ err }, 'Turnstile check failed to run; refusing a code for a new number')
    throw new HttpError(503, 'CAPTCHA_UNAVAILABLE', 'We could not run the security check just now. Please try again in a minute.')
  }
  if (!ok) throw new HttpError(400, 'CAPTCHA_FAILED', 'That check did not pass. Please try again.')
}
