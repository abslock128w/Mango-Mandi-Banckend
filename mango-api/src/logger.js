import pino from 'pino'
import { env, isProd } from './env.js'
import { scrubText } from './sentry.js'

// Sensitive values are redacted at every depth.
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
]

/** A phone number fit for a log line: the country code and first digits, the rest hidden. */
export const maskPhone = (phone) => (phone ? `${String(phone).slice(0, 5)}*****` : phone)

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

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  serializers: { err: scrubError },
  ...(isProd || env.NODE_ENV === 'test' ? {} : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
})
