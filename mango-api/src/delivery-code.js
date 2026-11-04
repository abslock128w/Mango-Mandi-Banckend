// The 4-digit delivery code (docs/rider-app/README.md). The customer reads it to
// the rider once they have seen their mangoes; the rider types it to finish the
// delivery.
//
// Only a hash is stored (orders.delivery_code_hash: SHA-256 of pepper, order id
// and code). The customer still needs to see the digits, on the order page and in
// the WhatsApp code message, so they are derived when needed from a random nonce
// (orders.delivery_code_nonce) with the server's pepper:
//   code = HMAC-SHA256(pepper, "dc:<order id>:<nonce>") as a number, mod 10000.
// A copy of the database alone (without the pepper) reveals no code, and a hash
// can't be tried offline against the 10,000 codes either.
//
// The pepper is OTP_PEPPER, or JWT_SECRET when that is not set. Changing it
// changes the codes of orders on the road: rotate it after the day's runs.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from './env.js'

const pepper = () => env.OTP_PEPPER || env.JWT_SECRET

/** The stored hash for a code. */
export const deliveryCodeHash = (orderId, code) => createHash('sha256').update(`${pepper()}:dc:${orderId}:${code}`).digest('hex')

/** The 4 digits for an order's nonce. */
export function deriveCode(orderId, nonce) {
  const mac = createHmac('sha256', pepper()).update(`dc:${orderId}:${nonce}`).digest()
  return String(mac.readUInt32BE(0) % 10_000).padStart(4, '0')
}

/** A new code for an order: the columns to store. */
export function newDeliveryCode(orderId) {
  const nonce = randomBytes(12).toString('base64url')
  return { nonce, hash: deliveryCodeHash(orderId, deriveCode(orderId, nonce)) }
}

/**
 * The code to show the customer (shop page, WhatsApp), or null. Orders from
 * before 053 still carry the plaintext column until 056 drops it.
 */
export function deliveryCodeFor(o) {
  if (o.delivery_code_nonce) return deriveCode(o.id, o.delivery_code_nonce)
  return o.delivery_code ?? null
}

/** Whether a typed code is the order's. Timing-safe; falls back to the plaintext of an order from before 053. */
export function codeMatches(o, given) {
  const typed = String(given ?? '')
  if (!/^\d{4}$/.test(typed)) return false
  if (o.delivery_code_hash) {
    const want = Buffer.from(o.delivery_code_hash, 'hex')
    const got = Buffer.from(deliveryCodeHash(o.id, typed), 'hex')
    return want.length === got.length && timingSafeEqual(want, got)
  }
  if (!o.delivery_code) return false
  const a = Buffer.from(typed)
  const b = Buffer.from(String(o.delivery_code))
  return a.length === b.length && timingSafeEqual(a, b)
}
