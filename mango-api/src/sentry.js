// Error reporting to Sentry when SENTRY_DSN is set; otherwise errors are only logged.
import * as Sentry from '@sentry/node'
import { env } from './env.js'

// SEC-R1: what an error report may carry. The Sentry SDK in use (v11) no
// longer reads `sendDefaultPii`; by default it sends the request body (phone,
// login code, address), parsed cookies (the refresh token), the client IP and
// query strings. dataCollection turns those off, and beforeSend scrubs what is
// left (headers, extra context, breadcrumbs, error messages) as a second line.
const SENSITIVE_KEY = /phone|address|password|passwd|secret|token|cookie|authorization|^code$|devcode|otp|^lat$|^lng$|receivedby|email|signature/i
const KEEP_HEADERS = new Set(['content-type', 'content-length', 'user-agent', 'accept', 'x-request-id'])
const FILTERED = '[Filtered]'
/** Indian mobile numbers (with or without +91), Razorpay keys, bearer tokens and JWTs inside free text. */
export function scrubText(s) {
  if (typeof s !== 'string') return s
  return s
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, FILTERED)
    .replace(/\b(rzp_(?:live|test)_\w+|whsec_\w+|vercel_blob_rw_\w+)/g, FILTERED)
    .replace(/(Bearer\s+)\S+/gi, `$1${FILTERED}`)
    .replace(/(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g, FILTERED)
}
function scrubValue(v, depth = 0) {
  if (typeof v === 'string') return scrubText(v)
  if (!v || typeof v !== 'object' || depth > 6) return v
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, depth + 1))
  const out = {}
  for (const [k, x] of Object.entries(v)) out[k] = SENSITIVE_KEY.test(k) ? FILTERED : scrubValue(x, depth + 1)
  return out
}

/** beforeSend: no body, cookies, query string or IP; headers cut to a safe few; secrets and phones masked everywhere else. */
export function scrubEvent(event) {
  if (event.request) {
    const r = event.request
    delete r.data
    delete r.cookies
    delete r.query_string
    if (typeof r.url === 'string') r.url = r.url.split('?')[0]
    if (r.headers) r.headers = Object.fromEntries(Object.entries(r.headers).filter(([k]) => KEEP_HEADERS.has(k.toLowerCase())))
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined
  if (event.message) event.message = scrubText(event.message)
  for (const ex of event.exception?.values ?? []) ex.value = scrubText(ex.value)
  if (event.extra) event.extra = scrubValue(event.extra)
  if (event.contexts) event.contexts = scrubValue(event.contexts)
  if (event.tags) event.tags = scrubValue(event.tags)
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map((b) => ({ ...b, message: scrubText(b.message), data: b.data && scrubValue(b.data) }))
  return event
}

export const sentryOptions = () => ({
  dsn: env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: 0,
  dataCollection: { userInfo: false, cookies: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false, stackFrameVariables: false },
  beforeSend: scrubEvent,
  beforeBreadcrumb: (b) => ({ ...b, message: scrubText(b.message), data: b.data && scrubValue(b.data) }),
})

const on = Boolean(env.SENTRY_DSN)
if (on) Sentry.init(sentryOptions())

let errorHook = null
/** Tests see every reportError call (Sentry itself is off in tests). */
export function onErrorForTests(fn) {
  errorHook = fn
}

/** Reports an unexpected error with what we know about the request. */
export function reportError(err, context = {}) {
  errorHook?.(err, context)
  if (!on) return
  Sentry.captureException(err, { extra: context })
}

let problemHook = null
/** Tests see every reportProblem call (Sentry itself is off in tests). */
export function onProblemForTests(fn) {
  problemHook = fn
}

/** Reports a condition that needs a person (stuck payments, failing messages). */
export function reportProblem(message, context = {}) {
  problemHook?.(message, context)
  if (!on) return
  Sentry.captureMessage(message, { level: 'warning', extra: context })
}

// SRV-02: the Sentry monitor's schedule follows how often the scheduler calls the job
// (MAINTENANCE_INTERVAL_S), or a 5-minute pinger would count as missing four check-ins in
// five and the alert would be muted. A whole number of minutes that divides the hour is a
// crontab (every minute, or every N minutes from the hour, as a pinger runs); anything else
// an interval in minutes. The margin is about three intervals, like the every-minute
// monitor's 3 minutes.
export function cronMonitorConfig(intervalS = env.MAINTENANCE_INTERVAL_S) {
  const minutes = Math.max(1, Math.ceil(intervalS / 60))
  const crontab = intervalS % 60 === 0 && minutes < 60 && 60 % minutes === 0
  const schedule = !crontab
    ? { type: 'interval', value: minutes, unit: 'minute' }
    : { type: 'crontab', value: minutes === 1 ? '* * * * *' : `*/${minutes} * * * *` }
  return { schedule, checkinMargin: Math.ceil((3 * intervalS) / 60), maxRuntime: 2, timezone: 'Etc/UTC' }
}

/**
 * Sentry cron monitor for the maintenance job: a dead-man's switch. Sentry
 * expects a check-in on the scheduler's interval (cronMonitorConfig) and alerts
 * when one is missed or a run errors, even if nobody is looking at the panel.
 * Returns the check-in id.
 */
export function cronCheckIn(status, checkInId = null) {
  if (!on) return null
  try {
    if (checkInId) return Sentry.captureCheckIn({ checkInId, monitorSlug: 'maintenance', status })
    return Sentry.captureCheckIn({ monitorSlug: 'maintenance', status }, cronMonitorConfig())
  } catch {
    return null
  }
}

/** Sends queued reports before a serverless function is frozen or a server exits. */
export const flushErrors = () => (on ? Sentry.flush(2000).catch(() => false) : Promise.resolve(true))


