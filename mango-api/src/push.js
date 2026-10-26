// Browser notifications for order updates (WEB_PUSH, docs/app-feel.md).
//
// A customer turns them on from the shop's Account page; the browser gives a
// subscription (its push service URL and keys), stored in push_subscriptions.
// Order steps that send a WhatsApp update also queue a push (push_messages),
// in the same transaction (notify.js enqueue), and the maintenance loop sends
// it to each of the customer's browsers. The text is fixed per kind and says
// nothing personal: no name, address, phone, amount or delivery code, because a
// phone shows it on the lock screen. A subscription the push service says is
// gone (404 or 410) is deleted.
import { canStartCall } from './budget.js'
import { now } from './clock.js'
import { query } from './db.js'
import { env } from './env.js'
import { badRequest } from './errors.js'
import { newId } from './ids.js'
import { logger } from './logger.js'
import { fromB64url, validPublicKey, vapidSender } from './webpush.js'

/** Order updates that are also pushed: the steps of an order the customer follows. */
export const PUSH_KINDS = new Set(['ORDER_CONFIRMED', 'REPLACEMENT_CONFIRMED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'DATE_MOVED', 'CANCELLED'])

/** Browsers one customer may have at once; the oldest goes when a new one is added. */
export const MAX_SUBSCRIPTIONS = 10
const RETRY_MINUTES = [1, 5, 15]
const MAX_AGE_MS = 24 * 3_600_000
const CLAIM_MS = 5 * 60_000
const SEND_CALL_MS = 12_000
/** Refusals in a row (other than gone) after which a subscription is dropped. */
const MAX_FAILURES = 5

/** What each kind says. The same words for everyone: nothing in them is about the customer. */
const TEXT = {
  ORDER_CONFIRMED: 'Your MandiMangoes order is confirmed',
  REPLACEMENT_CONFIRMED: 'Your MandiMangoes replacement is booked',
  OUT_FOR_DELIVERY: 'Your MandiMangoes order is out for delivery',
  DELIVERED: 'Your MandiMangoes order has been delivered',
  DELIVERY_FAILED: 'We missed you: your MandiMangoes order will be tried again',
  // A missed delivery that is not rescheduled on its own (attempts used up, or the boxes too old for the retry day).
  DELIVERY_FAILED_NO_RETRY: 'We missed you: MandiMangoes will be in touch about your order',
  DATE_MOVED: 'Your MandiMangoes order has a new delivery day',
  CANCELLED: 'Your MandiMangoes order was cancelled',
  // REFERRALS (docs/growth.md): not about an order. The code itself is on the Account page, not on the lock screen.
  REFERRAL_REWARD: 'You have a MandiMangoes thank-you code: see your Account page',
}

/** Push is on: the flag, and keys when it really sends. */
export const pushOn = () => env.WEB_PUSH && (env.WEB_PUSH_PROVIDER === 'log' || Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT))

/** The public key the browser subscribes with (RFC 8292 applicationServerKey); null while push is off. */
export const pushPublicKey = () => (pushOn() ? env.VAPID_PUBLIC_KEY || null : null)

/** The message for one order update: the words, a link to the order and a tag that replaces older ones. */
export function payloadFor(kind, orderId) {
  const text = TEXT[kind]
  if (!text) return null
  if (kind === 'REFERRAL_REWARD') return { title: 'MandiMangoes', body: text, url: '/account', tag: 'referral' }
  return { title: 'MandiMangoes', body: text, url: `/orders/${encodeURIComponent(orderId)}`, tag: `order-${orderId}` }
}

/** "fcm.googleapis.com …a1b2": enough to tell browsers apart in a log, never the capability URL. */
export function endpointHint(endpoint) {
  try {
    return `${new URL(endpoint).host} …${String(endpoint).slice(-4)}`
  } catch {
    return '(not a URL)'
  }
}

const hostAllowed = (host) =>
  env.WEB_PUSH_HOSTS.split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .some((h) => (h.startsWith('*.') ? host.endsWith(h.slice(1)) : host === h))

/**
 * Checks a subscription from the browser before it is stored. The endpoint is
 * where the API will post, so only https URLs on a known push service are taken
 * (WEB_PUSH_HOSTS); the keys must be a real P-256 point and a 16-byte secret.
 */
export function checkSubscription({ endpoint, keys }) {
  let url
  try {
    url = new URL(endpoint)
  } catch {
    throw badRequest('That is not a push subscription', 'BAD_SUBSCRIPTION')
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !hostAllowed(url.hostname.toLowerCase())) {
    throw badRequest('That push service is not one we send to', 'BAD_SUBSCRIPTION')
  }
  const p256dh = fromB64url(keys.p256dh)
  const auth = fromB64url(keys.auth)
  if (!validPublicKey(p256dh) || auth.length !== 16) throw badRequest('That push subscription has unusable keys', 'BAD_SUBSCRIPTION')
}

/** Stores (or moves to this customer) a browser's subscription. A browser belongs to whoever signed in on it last. */
export async function saveSubscription(c, customerId, sub) {
  checkSubscription(sub)
  const at = now()
  const { rows } = await c.query(
    `INSERT INTO push_subscriptions (id, customer_id, endpoint, p256dh, auth, created_at) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE SET customer_id = EXCLUDED.customer_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, failures = 0,
       created_at = CASE WHEN push_subscriptions.customer_id = EXCLUDED.customer_id THEN push_subscriptions.created_at ELSE EXCLUDED.created_at END
     RETURNING id`,
    [newId('psb'), customerId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, at],
  )
  await c.query(
    `DELETE FROM push_subscriptions WHERE customer_id = $1 AND id NOT IN (
       SELECT id FROM push_subscriptions WHERE customer_id = $1 ORDER BY created_at DESC, id LIMIT ${MAX_SUBSCRIPTIONS})`,
    [customerId],
  )
  return rows[0].id
}

/**
 * Account join (POST /me/phone/verify): the Google account's browsers, and any
 * pushes still queued for it, go to the phone account it joins before the
 * Google account is deleted. The joined account keeps its newest ten browsers.
 */
export async function movePushSubscriptions(c, fromId, toId) {
  await c.query('UPDATE push_subscriptions SET customer_id = $2 WHERE customer_id = $1', [fromId, toId])
  await c.query('UPDATE push_messages SET customer_id = $2 WHERE customer_id = $1', [fromId, toId])
  await c.query(
    `DELETE FROM push_subscriptions WHERE customer_id = $1 AND id NOT IN (
       SELECT id FROM push_subscriptions WHERE customer_id = $1 ORDER BY created_at DESC, id LIMIT ${MAX_SUBSCRIPTIONS})`,
    [toId],
  )
}

/** Turns notifications off for one browser of this customer. Another customer's browser is left alone. */
export async function removeSubscription(c, customerId, endpoint) {
  const r = await c.query('DELETE FROM push_subscriptions WHERE customer_id = $1 AND endpoint = $2', [customerId, endpoint])
  return r.rowCount > 0
}

/**
 * Called by notify.js for every order update it queues, inside the order's
 * transaction. Queues a push only when push is on, the kind is an order step
 * and the customer has turned notifications on somewhere.
 */
export async function enqueueOrderPush(c, orderId, eventId, kind) {
  if (!pushOn() || !PUSH_KINDS.has(kind)) return
  const at = now()
  await c.query(
    `INSERT INTO push_messages (id, customer_id, order_id, event_id, kind, next_attempt_at, created_at)
     SELECT $1, o.customer_id, o.id, $3, $4, $5, $5 FROM orders o
      WHERE o.id = $2 AND o.customer_id IS NOT NULL AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.customer_id = o.customer_id)
     ON CONFLICT (event_id, kind) DO NOTHING`,
    [newId('psh'), orderId, eventId, kind, at],
  )
}

/**
 * A push about the customer's account rather than an order (a referral thank-you, REFERRALS), in
 * the caller's transaction. Queued only when push is on and the customer has a browser with it on.
 */
export async function enqueueCustomerPush(c, customerId, eventId, kind) {
  if (!pushOn() || kind !== 'REFERRAL_REWARD') return
  const at = now()
  await c.query(
    `INSERT INTO push_messages (id, customer_id, event_id, kind, next_attempt_at, created_at)
     SELECT $1, $2, $3, $4, $5, $5 WHERE EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.customer_id = $2)
     ON CONFLICT (event_id, kind) DO NOTHING`,
    [newId('psh'), customerId, eventId, kind, at],
  )
}

/** A missed delivery that will not be tried again on its own: its push says we'll be in touch, not that it will be retried. */
export async function noRetryPush(c, eventId) {
  await c.query(`UPDATE push_messages SET kind = 'DELIVERY_FAILED_NO_RETRY' WHERE event_id = $1 AND kind = 'DELIVERY_FAILED' AND status = 'PENDING'`, [eventId])
}

// ---------------------------------------------------------------- sending

/** Tests swap the sender (and so never reach a push service). */
let senderOverride = null
export const usePushSender = (fn) => {
  senderOverride = fn
}

/** WEB_PUSH_PROVIDER=log: what would be sent, with the endpoint shortened. Development and tests. */
// eslint-disable-next-line require-await -- a sender: async like the real one
async function logSender(sub, { payload, topic }) {
  logger.info({ to: endpointHint(sub.endpoint), topic, payload: JSON.parse(payload) }, 'web push (log provider)')
  return { status: 201 }
}

let vapid = null
function sender() {
  if (senderOverride) return senderOverride
  if (env.WEB_PUSH_PROVIDER !== 'vapid') return logSender
  vapid ??= vapidSender({ publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT })
  return vapid
}

async function mark(id, fields) {
  const keys = Object.keys(fields)
  await query(`UPDATE push_messages SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...keys.map((k) => fields[k])])
}

/** An update about an order that has moved on is not true any more: skipped, not sent late (as for WhatsApp). */
function staleReason(m) {
  const s = m.order_status
  if (!s) return null
  if (['ORDER_CONFIRMED', 'REPLACEMENT_CONFIRMED', 'DATE_MOVED'].includes(m.kind) && s === 'CANCELLED') return 'order cancelled since'
  if (m.kind === 'OUT_FOR_DELIVERY' && s !== 'OUT_FOR_DELIVERY') return `order is ${s} now`
  if ((m.kind === 'DELIVERY_FAILED' || m.kind === 'DELIVERY_FAILED_NO_RETRY') && (s === 'DELIVERED' || s === 'CANCELLED')) return `order is ${s} now`
  return null
}

/**
 * Sends due pushes (the maintenance loop's 'push' step). Returns how many
 * messages reached at least one browser. Only messages due when the call began
 * are claimed, and each outcome moves the message past that time.
 */
export async function sendDuePush({ limit = 50 } = {}) {
  if (!pushOn()) return 0
  const at = now()
  const claimed = await query(
    `UPDATE push_messages SET next_attempt_at = $3
      WHERE id IN (SELECT id FROM push_messages WHERE status = 'PENDING' AND next_attempt_at <= $1
                    ORDER BY next_attempt_at LIMIT $2 FOR UPDATE SKIP LOCKED)
      RETURNING id`,
    [at, limit, new Date(at.getTime() + CLAIM_MS)],
  )
  if (!claimed.rows.length) return 0
  const { rows } = await query(
    `SELECT m.*, o.status AS order_status FROM push_messages m LEFT JOIN orders o ON o.id = m.order_id
      WHERE m.id = ANY($1) ORDER BY m.created_at`,
    [claimed.rows.map((r) => r.id)],
  )
  let sent = 0
  for (let i = 0; i < rows.length; i++) {
    if (!canStartCall(SEND_CALL_MS)) {
      await query('UPDATE push_messages SET next_attempt_at = $2 WHERE id = ANY($1)', [rows.slice(i).map((r) => r.id), at])
      break
    }
    if (await sendOne(rows[i], at)) sent++
  }
  return sent
}

/** Sends one message to every browser of its customer and records what happened. True when one took it. */
async function sendOne(m, at) {
  if (at - m.created_at > MAX_AGE_MS) {
    await mark(m.id, { status: 'SKIPPED', last_error: 'older than a day' })
    return false
  }
  const stale = staleReason(m)
  if (stale) {
    await mark(m.id, { status: 'SKIPPED', last_error: stale })
    return false
  }
  const payload = payloadFor(m.kind, m.order_id)
  const { rows: subs } = await query('SELECT * FROM push_subscriptions WHERE customer_id = $1 ORDER BY created_at', [m.customer_id])
  if (!payload || !subs.length) {
    await mark(m.id, { status: 'SKIPPED', last_error: payload ? 'no browser has notifications on' : 'not a pushed kind' })
    return false
  }
  const body = JSON.stringify(payload)
  const send = sender()
  let delivered = 0
  let retry = false
  const problems = []
  for (const sub of subs) {
    let status
    try {
      // Topic: the order id (base64url, at most 32 characters), so a phone that was off gets only the latest step.
      const topic = m.order_id && m.order_id.length <= 32 ? m.order_id : null
      const r = await send(sub, { payload: body, ttl: 24 * 3600, urgency: m.kind === 'OUT_FOR_DELIVERY' ? 'high' : 'normal', topic })
      status = r.status
    } catch (err) {
      // Network trouble or a timeout: try this message again later.
      logger.warn({ err: { message: err?.message }, to: endpointHint(sub.endpoint), kind: m.kind }, 'web push failed')
      problems.push(`${endpointHint(sub.endpoint)}: ${String(err?.message ?? err).slice(0, 80)}`)
      retry = true
      continue
    }
    if (status >= 200 && status < 300) {
      delivered++
      await query('UPDATE push_subscriptions SET last_sent_at = $2, failures = 0 WHERE id = $1', [sub.id, at])
    } else if (status === 404 || status === 410) {
      // The browser unsubscribed or the subscription expired: it will never work again.
      await query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id])
      logger.info({ to: endpointHint(sub.endpoint), status }, 'push subscription gone; removed')
    } else if (status === 429 || status >= 500) {
      problems.push(`${endpointHint(sub.endpoint)}: ${status}`)
      retry = true
    } else {
      // 400, 403 (a key that doesn't match), 413: this browser won't take it as it is.
      problems.push(`${endpointHint(sub.endpoint)}: ${status}`)
      const r = await query('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1 RETURNING failures', [sub.id])
      if ((r.rows[0]?.failures ?? 0) >= MAX_FAILURES) await query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id])
    }
  }
  const attempts = m.attempts + 1
  const lastError = problems.length ? problems.join('; ').slice(0, 500) : null
  if (delivered) {
    // Taken by at least one browser: never sent again, so nobody gets it twice.
    await mark(m.id, { status: 'SENT', sent_at: at, attempts, delivered, last_error: lastError })
    return true
  }
  const wait = retry ? RETRY_MINUTES.at(attempts - 1) : null
  if (wait == null) await mark(m.id, { status: problems.length ? 'FAILED' : 'SKIPPED', attempts, last_error: lastError ?? 'every browser had unsubscribed' })
  else await mark(m.id, { attempts, last_error: lastError, next_attempt_at: new Date(at.getTime() + wait * 60_000) })
  return false
}

/** Finished push messages are kept 30 days (to answer "did it go?"), then deleted, a bounded number per run. */
export async function prunePushMessages(at = now(), { limit = 5000 } = {}) {
  const r = await query(
    `DELETE FROM push_messages WHERE id IN (
       SELECT id FROM push_messages WHERE status <> 'PENDING' AND created_at < $1 ORDER BY created_at LIMIT $2)`,
    [new Date(at.getTime() - 30 * 86_400_000), limit],
  )
  return r.rowCount
}
