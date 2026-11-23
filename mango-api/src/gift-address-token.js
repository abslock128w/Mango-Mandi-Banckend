// The token in a gift address link (GIFT_ADDRESS_LINKS, docs/gifting.md): what the recipient's WhatsApp button opens,
// <shop>/gift-address/<token>. It is an HMAC of the link's own random id with a key derived from JWT_SECRET, so
//   - the server can send the SAME link again (a resend, the reminder) without storing the token anywhere: only its
//     sha256 is kept (gift_address_links.token_hash), so a copy of the database alone opens no link;
//   - a token can't be made or guessed without the server's secret.
// Changing JWT_SECRET changes every token: links already sent stop working (as bill links do, bill-link.js); the next
// send of a link stores the new token's hash (sameLinkToken), so a resend works again.
import { createHash, createHmac } from 'node:crypto'
import { addDays } from './clock.js'
import { env } from './env.js'

const key = () => createHmac('sha256', env.JWT_SECRET).update('gift-address-link:v1').digest()

/** The link's token: 43 URL-safe characters. */
export const giftAddressToken = (linkId) => createHmac('sha256', key()).update(String(linkId)).digest('base64url')

/** What is stored and looked up: the token's sha256, hex. */
export const tokenHash = (token) => createHash('sha256').update(String(token)).digest('hex')

/** A token as it may arrive in a URL: 43 URL-safe characters, else null (never looked up). */
export const cleanToken = (t) => (typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t) ? t : null)

/** When a booking's link stops working: the start of the day before its (current) week, in IST. */
export const linkExpiry = (weekStart) => new Date(`${addDays(weekStart, -1)}T00:00:00+05:30`)

/** The messages whose URL button is the link: <shop>/gift-address/{{1}}, the token. */
export const LINK_KINDS = new Set(['GIFT_ADDRESS_REQUEST', 'GIFT_ADDRESS_REMINDER'])
export const GIFT_ADDRESS_KINDS = new Set([...LINK_KINDS, 'GIFT_ADDRESS_MISSING'])
