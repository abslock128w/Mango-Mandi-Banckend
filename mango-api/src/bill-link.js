// The invoice link sent on WhatsApp with the order confirmation (docs/whatsapp/TEMPLATES.md,
// ORDER_CONFIRMED): GET /v1/invoice/<link> shows the order's bill without a sign-in, because
// the customer opens it from a chat, often in a browser where they are not signed in.
//
// The link is "<order id>.<expiry>.<signature>": the signature is an HMAC over the first two
// parts with a key derived from JWT_SECRET, so a link can't be made or changed without the
// server's secret, and one order's link opens no other order. It stops working after
// BILL_LINK_DAYS; the shop's orders list has the invoice after that.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { now } from './clock.js'
import { env } from './env.js'

export const BILL_LINK_DAYS = 180
const key = () => createHmac('sha256', env.JWT_SECRET).update('bill-link:v1').digest()
const sign = (body) => createHmac('sha256', key()).update(body).digest('base64url').slice(0, 32)

/** The link for an order's bill, valid for BILL_LINK_DAYS from `at`. */
export function billLink(orderId, at = now()) {
  const body = `${orderId}.${Math.floor(at.getTime() / 1000 + BILL_LINK_DAYS * 86_400).toString(36)}`
  return `${body}.${sign(body)}`
}

/** The order id a link was made for, or null when it is malformed, altered or expired. */
export function readBillLink(link, at = now()) {
  const m = /^([a-z]{2,6}_[a-z0-9]{8,40})\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{32})$/.exec(String(link ?? ''))
  if (!m) return null
  const want = Buffer.from(sign(`${m[1]}.${m[2]}`))
  const got = Buffer.from(m[3])
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  if (parseInt(m[2], 36) * 1000 < at.getTime()) return null
  return m[1]
}
