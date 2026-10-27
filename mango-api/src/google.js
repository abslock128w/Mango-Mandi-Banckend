// "Sign in with Google": the browser gets an ID token (a JWT signed by Google)
// from Google Identity Services and sends it here. We check Google's signature,
// that it was issued for our client ID, and that the email is verified.
import { createRemoteJWKSet, errors, jwtVerify } from 'jose'
import { env } from './env.js'
import { HttpError, unauthorized } from './errors.js'
import { logger } from './logger.js'

let keys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

/** Tests sign their own tokens. */
export function useGoogleKeys(k) {
  keys = k
}

export const googleOn = () => Boolean(env.GOOGLE_CLIENT_ID)

/**
 * Whether verifying failed because Google's keys could not be fetched (a timeout, a network
 * error, an answer other than 200 or not a key set) rather than because the token is bad.
 * The customer did nothing wrong then: they are told to try again, not that sign-in failed.
 */
const KEYS_UNREACHABLE = new Set(['ERR_JWKS_TIMEOUT', 'ERR_JOSE_GENERIC', 'ERR_JWKS_INVALID'])
export const keysUnreachable = (err) => !(err instanceof errors.JOSEError) || KEYS_UNREACHABLE.has(err.code)

/** Returns { sub, email, name, hd } from a verified Google ID token (hd: the Workspace domain, or null). */
export async function verifyGoogleCredential(credential) {
  if (!googleOn()) throw new HttpError(503, 'GOOGLE_OFF', 'Sign in with Google is not set up.')
  let payload
  try {
    ;({ payload } = await jwtVerify(String(credential ?? ''), keys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: env.GOOGLE_CLIENT_ID.split(',').map((s) => s.trim()),
      algorithms: ['RS256'],
    }))
  } catch (err) {
    if (keysUnreachable(err)) {
      logger.warn({ err }, "Google's sign-in keys could not be fetched")
      throw new HttpError(503, 'GOOGLE_UNAVAILABLE', 'Sign in with Google is not answering just now. Please try again in a minute.')
    }
    throw unauthorized('Google sign-in failed. Please try again.', 'GOOGLE_INVALID')
  }
  if (!payload.sub || !payload.email || payload.email_verified !== true) {
    throw unauthorized('Your Google account email is not verified.', 'GOOGLE_UNVERIFIED')
  }
  return { sub: String(payload.sub), email: String(payload.email).toLowerCase(), name: payload.name ? String(payload.name).slice(0, 80) : null, hd: payload.hd ? String(payload.hd).toLowerCase() : null }
}
