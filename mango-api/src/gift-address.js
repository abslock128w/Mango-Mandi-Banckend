// "Ask them on WhatsApp" (GIFT_ADDRESS_LINKS with MULTI_GIFT, docs/gifting.md, "Before the season"): in a gift for
// several people booked before the season, the giver may leave a recipient's address out. The booking is made with
// address_state ADDRESS_PENDING and no pincode or address (migration 091); it takes its week's kg as any booking (the
// week does not depend on the pincode). Pre-orders stay paid in full and non-refundable once paid.
//
//   1. The group's one payment is captured (preorders.js processGroupPayment): each pending booking gets ONE link
//      (gift_address_links) and the recipient GIFT_ADDRESS_REQUEST, with a URL button <shop>/gift-address/<token>.
//      A replayed webhook adds nothing (one live link per booking; the message's event is the link's first send).
//   2. The recipient opens the link (public, no sign-in): GET shows who it is from, the box and the week; POST takes
//      their address and a served pincode, once (ADDRESS_GIVEN). The link stops working at the start of the day
//      before the booking's week (IST), or at once when the booking is cancelled.
//   3. The giver sees each booking's state, the message text and when it was sent (GET /v1/preorders/groups/:id) and
//      may send the same link again: at most every RESEND_GAP_MS and RESEND_MAX times.
//   4. Five days before the week, maintenance reminds the recipient once (GIFT_ADDRESS_REMINDER) and tells the giver
//      once (GIFT_ADDRESS_MISSING).
//   5. The allocator leaves a pending booking BOOKED (it keeps its week's kg) until the address is given.
import { addDays, now, todayIST } from './clock.js'
import { query, tx } from './db.js'
import { conflict, HttpError, notFound } from './errors.js'
import { isOn } from './feature-switches.js'
import { cleanToken, giftAddressToken, linkExpiry, tokenHash } from './gift-address-token.js'
import { newId } from './ids.js'
import { logger } from './logger.js'
import { env } from './env.js'
import { weekWords } from './notify.js'
import { findProduct, productName } from './products.js'
import { fillBody } from './wa/gift-address-words.js'

export const PENDING = 'ADDRESS_PENDING'
export const GIVEN = 'ADDRESS_GIVEN'
/** The giver may send the link again this long after the last send... */
export const RESEND_GAP_MS = 10 * 60_000
/** ...and this many times after the first send (so a link goes out at most 1 + RESEND_MAX times). */
export const RESEND_MAX = 5
/** The reminder (recipient) and the note to the giver go when the week is this many days away or less (IST). */
export const REMIND_DAYS = 5

/** Both switches: the routes answer 404 and askAddress is refused while either is off. */
export const giftAddressOn = () => isOn('MULTI_GIFT') && isOn('GIFT_ADDRESS_LINKS')

export { linkExpiry }

const shopUrl = () => env.CUSTOMER_ORIGIN.split(',')[0]?.trim().replace(/\/$/, '') || 'https://mandimangoes.in'
const firstName = (s) => String(s ?? '').trim().split(/\s+/)[0] || ''
/** "From": the giver's name on the booking (the group's buyer), else "a friend". */
export const fromName = (p) => p.customer_name?.trim() || 'a friend'
/** "1 × Alphonso 3kg Box" */
export const boxWords = (p) => `${p.qty} × ${productName(p.sku)}`

/** GIFT_ADDRESS_REQUEST and _REMINDER: recipient's first name, from, the box, the week. */
export const recipientParams = (p) => [firstName(p.gift_recipient_name) || 'there', fromName(p), boxWords(p), weekWords(p.week_start)]
/** GIFT_ADDRESS_MISSING: giver's first name, recipient's name, the box, the week, the gift's page in the shop. */
export const giverParams = (p) => [
  firstName(p.customer_name) || 'there', p.gift_recipient_name?.trim() || 'Your recipient', boxWords(p), weekWords(p.week_start),
  // The giver's page for the whole gift, with each person's status and "Send link" (shop gifts.js giftGroupView).
  p.group_id ? `${shopUrl()}/gifts/pre/${encodeURIComponent(p.group_id)}` : `${shopUrl()}/preorders/${encodeURIComponent(p.id)}`,
]

/** The words the recipient gets (GIFT_ADDRESS_REQUEST's body), for the giver's preview. */
export const addressMessage = (p) => fillBody('GIFT_ADDRESS_REQUEST', recipientParams(p))

async function addEvent(c, p, reason, actor = 'system') {
  await c.query('INSERT INTO preorder_events (id, preorder_id, status, reason, actor, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
    newId('pev'), p.id, p.status, reason, actor, now(),
  ])
}

async function queue(c, p, kind, eventId, phone, params) {
  if (!phone) return
  const at = now()
  await c.query(
    `INSERT INTO notifications (id, preorder_id, event_id, kind, phone, params, next_attempt_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (event_id, kind) DO NOTHING`,
    [newId('ntf'), p.id, eventId, kind, phone, JSON.stringify(params), at],
  )
}

const liveLink = async (c, preorderId, { lock = false } = {}) =>
  (await c.query(`SELECT * FROM gift_address_links WHERE preorder_id = $1 AND revoked_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [preorderId])).rows[0] ?? null

/** The link's token, its stored hash brought up to date (JWT_SECRET changed since: gift-address-token.js). */
async function sameLinkToken(c, link) {
  const token = giftAddressToken(link.id)
  const hash = tokenHash(token)
  if (hash !== link.token_hash) await c.query('UPDATE gift_address_links SET token_hash = $2 WHERE id = $1', [link.id, hash])
  return token
}

/**
 * After the group's payment (inside its transaction, the bookings locked): one link per paid pending booking and its
 * first GIFT_ADDRESS_REQUEST. A booking that already has a live link is left alone, so a replay adds nothing.
 * Returns how many links were made.
 */
export async function openLinks(c, members) {
  let made = 0
  for (const p of members) {
    if (p.address_state !== PENDING || p.status !== 'BOOKED') continue
    if (await liveLink(c, p.id)) continue
    const id = newId('gal')
    const at = now()
    const ins = await c.query(
      `INSERT INTO gift_address_links (id, preorder_id, token_hash, expires_at, created_at, sent_at, send_count) VALUES ($1, $2, $3, $4, $5, $5, 1)
       ON CONFLICT DO NOTHING`,
      [id, p.id, tokenHash(giftAddressToken(id)), linkExpiry(p.week_start), at],
    )
    if (!ins.rowCount) continue
    await queue(c, p, 'GIFT_ADDRESS_REQUEST', `${id}:request:1`, p.gift_recipient_phone, recipientParams(p))
    await addEvent(c, p, 'Asked the recipient for their address on WhatsApp')
    made++
  }
  return made
}

// ---------------------------------------------------------------- what the giver sees

/** The live links of these bookings: Map preorder id -> link row. */
export async function linksFor(c, preorderIds) {
  if (!preorderIds.length) return new Map()
  const { rows } = await c.query('SELECT * FROM gift_address_links WHERE preorder_id = ANY($1) AND revoked_at IS NULL', [preorderIds])
  return new Map(rows.map((l) => [l.preorder_id, l]))
}

/** Why the giver may not send the link again now (an HttpError), or null. `paid`: the group's payment is in. */
function resendRefusal(p, link, paid, at = now()) {
  if (!paid) return conflict('The gift is not paid yet: the link goes out once it is.', 'NOT_PAID')
  if (p.status === 'CANCELLED') return new HttpError(410, 'GIFT_CANCELLED', 'This gift was cancelled.')
  if (p.address_state === GIVEN || link?.filled_at) return conflict('The recipient has already given their address.', 'ADDRESS_GIVEN')
  if (p.address_state !== PENDING) return conflict('The address of this gift was given when it was booked.', 'NOT_ASKED')
  if (at >= linkExpiry(p.week_start)) return new HttpError(410, 'LINK_EXPIRED', 'It is too close to the delivery week to ask for the address now.')
  if (link && link.send_count > RESEND_MAX) return conflict(`The link has already been sent ${link.send_count} times.`, 'RESEND_LIMIT')
  if (link?.sent_at) {
    const next = new Date(link.sent_at).getTime() + RESEND_GAP_MS
    if (next > at.getTime()) {
      const retryAfter = Math.ceil((next - at.getTime()) / 1000)
      return new HttpError(429, 'RESEND_TOO_SOON', `The link was just sent. You can send it again in ${Math.ceil(retryAfter / 60)} minutes.`, { retryAfter })
    }
  }
  return null
}

/**
 * The giver's extra fields on one booking of their group: addressState, addressLink (a link exists: when it was last
 * sent, how often, when it stops working, whether and from when it can be sent again) and addressMessage (the
 * recipient's message, words filled in). A booking with its address from the start: addressState null, the rest null.
 */
export function giverFields(p, link, paid, at = now()) {
  const state = p.address_state ?? null
  if (!state) return { addressState: null, addressLink: null, addressMessage: null }
  const refused = resendRefusal(p, link, paid, at)
  const sentAt = link?.sent_at ? new Date(link.sent_at) : null
  const after = sentAt ? new Date(sentAt.getTime() + RESEND_GAP_MS) : null
  return {
    addressState: state,
    addressLink: link
      ? {
          sentAt, sendCount: link.send_count, expiresAt: linkExpiry(p.week_start), canResend: !refused,
          resendAfter: refused?.code === 'RESEND_TOO_SOON' ? after : null,
        }
      : null,
    addressMessage: addressMessage(p),
  }
}

/**
 * The giver sends the same link again (POST /v1/preorders/groups/:id/preorders/:preorderId/send-link): a new event, so
 * it really goes out. Their own group only (else 404). Refused: 409 NOT_PAID, 410 GIFT_CANCELLED, 409 ADDRESS_GIVEN,
 * 409 NOT_ASKED (an address typed at booking), 410 LINK_EXPIRED, 409 RESEND_LIMIT, 429 RESEND_TOO_SOON (retryAfter s).
 * Returns { preorder, link, paid }.
 */
export async function resendLink(c, { groupId, preorderId, customerId }) {
  const g = (await c.query('SELECT * FROM preorder_groups WHERE id = $1 AND customer_id = $2 FOR UPDATE', [groupId, customerId])).rows[0]
  if (!g) throw notFound('Gift pre-order not found')
  const p = (await c.query('SELECT * FROM preorders WHERE id = $1 AND group_id = $2 FOR UPDATE', [preorderId, g.id])).rows[0]
  if (!p) throw notFound('Gift pre-order not found')
  const paid = g.payment_status === 'SUCCEEDED'
  let link = await liveLink(c, p.id, { lock: true })
  const refused = resendRefusal(p, link, paid)
  if (refused) throw refused
  const at = now()
  if (!link) {
    // Paid before links existed for it (cannot happen through the API): made now, as at payment.
    await openLinks(c, [p])
    link = await liveLink(c, p.id, { lock: true })
  } else {
    await sameLinkToken(c, link)
    const count = link.send_count + 1
    await queue(c, p, 'GIFT_ADDRESS_REQUEST', `${link.id}:request:${count}`, p.gift_recipient_phone, recipientParams(p))
    link = (await c.query('UPDATE gift_address_links SET sent_at = $2, send_count = $3 WHERE id = $1 RETURNING *', [link.id, at, count])).rows[0]
    await addEvent(c, p, `Address link sent again to the recipient (${count} sends)`, 'customer')
  }
  return { preorder: p, link, paid }
}

// ---------------------------------------------------------------- the recipient's page (public)

/** The link and its booking for a token, or a 404 LINK_NOT_FOUND (unknown, malformed or revoked). */
async function find(c, rawToken, { lock = false } = {}) {
  const token = cleanToken(rawToken)
  const missing = () => new HttpError(404, 'LINK_NOT_FOUND', 'This link is not valid. Ask the person who sent the gift for a new one.')
  if (!token) throw missing()
  const l = (await c.query('SELECT * FROM gift_address_links WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash(token)])).rows[0]
  if (!l) throw missing()
  // The booking first, then the link: the order every other writer of a booking takes.
  const p = (await c.query(`SELECT * FROM preorders WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [l.preorder_id])).rows[0]
  const link = lock ? (await c.query('SELECT * FROM gift_address_links WHERE id = $1 FOR UPDATE', [l.id])).rows[0] : l
  if (!p || !link || link.revoked_at) throw missing()
  return { p, link }
}

const isGiven = (p, link) => p.address_state === GIVEN || Boolean(link.filled_at)

/** What the page shows: never the giver's phone, the price or the recipient's phone. */
function recipientView(p, link) {
  const box = findProduct(p.sku)
  return {
    state: isGiven(p, link) ? 'GIVEN' : 'PENDING',
    recipientName: p.gift_recipient_name ?? null, fromName: fromName(p),
    box: { name: box?.name ?? p.sku, qty: p.qty, stage: p.stage },
    weekStart: p.week_start, message: p.gift_message || null, expiresAt: linkExpiry(p.week_start),
  }
}

/**
 * GET /v1/gift-address/:token. 404 LINK_NOT_FOUND; 410 GIFT_CANCELLED; 410 LINK_EXPIRED while the address is still
 * missing. Once given, the page keeps answering 200 with state GIVEN (also after the link's time), so the recipient
 * who opens it again sees "thank you", not an error.
 */
export async function readLink(rawToken, at = now()) {
  const { p, link } = await find({ query }, rawToken)
  if (p.status === 'CANCELLED') throw new HttpError(410, 'GIFT_CANCELLED', 'This gift was cancelled.')
  if (!isGiven(p, link) && at >= linkExpiry(p.week_start)) throw new HttpError(410, 'LINK_EXPIRED', 'This link has expired. Ask the person who sent the gift to contact us.')
  return recipientView(p, link)
}

/**
 * POST /v1/gift-address/:token { address, pincode }: accepted once, in one transaction with the booking locked.
 * 404 LINK_NOT_FOUND, 410 GIFT_CANCELLED, 409 ADDRESS_GIVEN (a second time), 410 LINK_EXPIRED, 400 NOT_SERVICEABLE.
 * Returns { state: 'GIVEN', weekStart }.
 */
export async function fillLink(rawToken, { address, pincode }) {
  return await tx(async (c) => {
    const { p, link } = await find(c, rawToken, { lock: true })
    if (p.status === 'CANCELLED') throw new HttpError(410, 'GIFT_CANCELLED', 'This gift was cancelled.')
    if (isGiven(p, link)) throw conflict('The address for this gift has already been given.', 'ADDRESS_GIVEN')
    if (now() >= linkExpiry(p.week_start)) throw new HttpError(410, 'LINK_EXPIRED', 'This link has expired. Ask the person who sent the gift to contact us.')
    const { rows } = await c.query('SELECT 1 FROM pincodes WHERE pincode = $1 AND active', [pincode])
    if (!rows.length) throw new HttpError(400, 'NOT_SERVICEABLE', 'We do not deliver to this pincode yet')
    const at = now()
    await c.query(`UPDATE preorders SET pincode = $2, delivery_address = $3, address_state = 'ADDRESS_GIVEN' WHERE id = $1`, [p.id, pincode, address])
    await c.query('UPDATE gift_address_links SET filled_at = $2 WHERE id = $1', [link.id, at])
    await addEvent(c, p, 'Address given by the recipient', 'recipient')
    return { state: 'GIVEN', weekStart: p.week_start }
  })
}

// ---------------------------------------------------------------- maintenance

/**
 * Paid bookings still waiting for an address whose week is REMIND_DAYS days away or less (IST), and whose link still
 * works: the recipient is reminded once (reminded_at) and the giver told once (giver_told_at). Bounded and SKIP LOCKED.
 * Returns { reminded, giversTold }.
 */
export async function sendAddressReminders({ limit = 200 } = {}) {
  return await tx(async (c) => {
    const at = now()
    const { rows } = await c.query(
      `SELECT p.*, gl.id AS link_id, gl.reminded_at, gl.giver_told_at, gl.token_hash AS link_token_hash
         FROM gift_address_links gl JOIN preorders p ON p.id = gl.preorder_id JOIN preorder_groups g ON g.id = p.group_id
        WHERE gl.revoked_at IS NULL AND gl.filled_at IS NULL AND (gl.reminded_at IS NULL OR gl.giver_told_at IS NULL)
          AND p.address_state = 'ADDRESS_PENDING' AND p.status = 'BOOKED' AND g.payment_status = 'SUCCEEDED'
          AND p.week_start <= $1::date
        ORDER BY p.week_start, gl.id LIMIT $2
        FOR UPDATE OF gl, p SKIP LOCKED`,
      [addDays(todayIST(at), REMIND_DAYS), limit],
    )
    let reminded = 0
    let giversTold = 0
    for (const r of rows) {
      if (at >= linkExpiry(r.week_start)) continue
      if (!r.reminded_at) {
        await sameLinkToken(c, { id: r.link_id, token_hash: r.link_token_hash })
        await queue(c, r, 'GIFT_ADDRESS_REMINDER', `${r.link_id}:reminder`, r.gift_recipient_phone, recipientParams(r))
        await c.query('UPDATE gift_address_links SET reminded_at = $2 WHERE id = $1', [r.link_id, at])
        reminded++
      }
      if (!r.giver_told_at) {
        await queue(c, r, 'GIFT_ADDRESS_MISSING', `${r.link_id}:missing`, r.phone, giverParams(r))
        await c.query('UPDATE gift_address_links SET giver_told_at = $2 WHERE id = $1', [r.link_id, at])
        giversTold++
      }
    }
    if (reminded || giversTold) logger.info({ reminded, giversTold }, 'gift address reminders queued')
    return { reminded, giversTold }
  })
}
