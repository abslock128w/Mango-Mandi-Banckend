// Two-step sign-in secrets at rest (TD-09). With TOTP_ENCRYPTION_KEY set, the
// TOTP secret in admin_users.totp_secret and totp_pending is stored as
//   enc:v1:<base64 of 12-byte IV | 16-byte tag | ciphertext>
// (AES-256-GCM, bound to the staff member's id, so a value copied onto another
// row does not open). A database copy or backup alone then cannot mint codes.
//
// Older rows written before the key was set are plain base32 and keep working;
// they are sealed the next time that person signs in with a code, or all at once
// with ops/seal-two-step.js. The key is separate from JWT_SECRET on purpose.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from './env.js'

const PREFIX = 'enc:v1:'

/** The 32-byte key, or null when TOTP_ENCRYPTION_KEY is not set. */
function key() {
  const raw = env.TOTP_ENCRYPTION_KEY
  if (!raw) return null
  const k = Buffer.from(raw, 'base64')
  if (k.length !== 32) throw new Error('TOTP_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)')
  return k
}

export const isSealed = (stored) => typeof stored === 'string' && stored.startsWith(PREFIX)

/** The value to store for this staff member's secret: sealed when a key is set, else as given. */
export function sealSecret(adminId, secret) {
  const k = key()
  if (!k || secret == null) return secret
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', k, iv)
  cipher.setAAD(Buffer.from(`totp:${adminId}`))
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
}

/** The secret from a stored value (sealed or an older plain one). Throws when it cannot be opened. */
export function openSecret(adminId, stored) {
  if (!isSealed(stored)) return stored
  const k = key()
  if (!k) throw new Error('A two-step secret is encrypted but TOTP_ENCRYPTION_KEY is not set')
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64')
  const decipher = createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12))
  decipher.setAAD(Buffer.from(`totp:${adminId}`))
  decipher.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8')
}

/** True when a key is set and this stored value is still plain (so it should be sealed). */
export const needsSealing = (stored) => Boolean(env.TOTP_ENCRYPTION_KEY) && stored != null && !isSealed(stored)

/** Seals every plain secret still stored (ops/seal-two-step.js). Returns how many rows changed. */
export async function sealStoredSecrets(c) {
  if (!key()) throw new Error('Set TOTP_ENCRYPTION_KEY first')
  const { rows } = await c.query(
    `SELECT id, totp_secret, totp_pending FROM admin_users
      WHERE (totp_secret IS NOT NULL AND totp_secret NOT LIKE 'enc:v1:%') OR (totp_pending IS NOT NULL AND totp_pending NOT LIKE 'enc:v1:%')
      FOR UPDATE`,
  )
  for (const r of rows) {
    await c.query('UPDATE admin_users SET totp_secret = $2, totp_pending = $3 WHERE id = $1', [
      r.id,
      needsSealing(r.totp_secret) ? sealSecret(r.id, r.totp_secret) : r.totp_secret,
      needsSealing(r.totp_pending) ? sealSecret(r.id, r.totp_pending) : r.totp_pending,
    ])
  }
  return rows.length
}
