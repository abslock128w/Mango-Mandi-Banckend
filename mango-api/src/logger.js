import pino from 'pino'
import { env, isProd } from './env.js'
import { logContext } from './log-context.js'
import { scrubText } from './sentry.js'

// Redaction works in two layers. REDACT_PATHS (pino's own redaction) covers the
// listed paths, which reach one level down at most ('*.phone' is order.phone, not
// job.order.phone). redactDeep below then removes the DEEP_KEYS at every depth of
// a logged object, so a phone inside an order inside a job is caught too.
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.password_hash',
  // Login and delivery codes in request bodies, not error codes (OPS-06):
  // err.code carries SQLSTATEs and network errors that diagnosis needs.
  'body.code',
  '*.body.code',
  'input.code',
  '*.input.code',
  '*.devCode',
  '*.accessToken',
  '*.refreshToken',
  'password',
  'password_hash',
  'code',
  'devCode',
  'accessToken',
  'refreshToken',
  // SEC-10: customer phone numbers and addresses inside logged objects (an order, a
  // notification, a request body). A top-level `phone` is allowed only masked
  // (maskPhone below); test/log-safety.test.js fails on a logger call that passes it raw.
  '*.phone',
  '*.gift_recipient_phone',
  '*.giftRecipientPhone',
  '*.recipientPhone',
  '*.delivery_address',
  '*.deliveryAddress',
  'body.address',
  '*.body.address',
  'req.headers["x-razorpay-signature"]',
]

/**
 * Keys whose value never goes to the logs, at any depth of a logged object. A top-level
 * `phone` or `email` is allowed (the caller passes it through maskPhone or maskEmail;
 * test/log-safety.test.js checks phones); one nested anywhere in an object is removed.
 */
const DEEP_KEYS = new Set([
  'password', 'password_hash', 'passwordHash', 'devCode', 'accessToken', 'refreshToken', 'authorization', 'cookie',
  'phone', 'gift_recipient_phone', 'giftRecipientPhone', 'recipientPhone', 'delivery_address', 'deliveryAddress',
  'email', 'contact', 'vpa', 'customer_name', 'customerName', 'gstin', 'x-razorpay-signature',
])
/** Allowed at the top level only, and only masked. */
const TOP_LEVEL_MASKED = new Set(['phone', 'email'])
const CENSOR = '[redacted]'
const MAX_DEPTH = 8

const plain = (v) => {
  if (!v || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null || Array.isArray(v)
}

/**
 * A copy of a logged object with every DEEP_KEYS value replaced, at every depth. Only plain
 * objects and arrays are walked: errors keep their own serializer (scrubError), and the
 * caller's objects are never changed.
 */
export function redactDeep(v, depth = 0) {
  if (!plain(v)) return v
  if (depth >= MAX_DEPTH) return '[too deep]'
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, depth + 1))
  const out = {}
  for (const [k, x] of Object.entries(v)) {
    out[k] = DEEP_KEYS.has(k) && x != null && !(depth === 0 && TOP_LEVEL_MASKED.has(k)) ? CENSOR : redactDeep(x, depth + 1)
  }
  return out
}

/** A phone number fit for a log line: the country code and first digits, the rest hidden. */
export const maskPhone = (phone) => (phone ? `${String(phone).slice(0, 5)}*****` : phone)

/** An email fit for a log line: the first letter and the domain ("r***@example.com"). */
export const maskEmail = (email) => {
  if (!email) return email
  const [name, domain] = String(email).split('@')
  return domain ? `${name.slice(0, 1)}***@${domain}` : '***'
}

/**
 * SEC-11 (24 Oct audit): an error's own text can carry personal data that
 * redaction by key path never sees, such as a Postgres unique violation's
 * detail, "Key (phone)=(+91…) already exists". Logged errors drop pg's detail
 * and where fields, and their message and stack get the same masking as Sentry
 * events (phone numbers, tokens, keys), causes included.
 */
export function scrubError(e, depth = 0) {
  const out = pino.stdSerializers.err(e)
  if (!out || typeof out !== 'object') return out
  delete out.detail
  delete out.where
  for (const k of ['message', 'stack']) if (typeof out[k] === 'string') out[k] = scrubText(out[k])
  if (out.cause && typeof out.cause === 'object') out.cause = depth < 3 ? scrubError(out.cause, depth + 1) : '[cause]'
  return out
}

/**
 * The logger's options without the destination, so tests can build the same logger on their own
 * stream. mixin: every line carries the request id, order id or maintenance step in effect
 * (log-context.js); fields the call passes itself win.
 */
export const loggerOptions = {
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: CENSOR },
  serializers: { err: scrubError },
  mixin: () => ({ ...logContext() }),
  formatters: { log: (obj) => redactDeep(obj) },
}

export const logger = pino({
  ...loggerOptions,
  ...(isProd || env.NODE_ENV === 'test' ? {} : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
})
