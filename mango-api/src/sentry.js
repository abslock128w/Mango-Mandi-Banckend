// Error reporting to Sentry when SENTRY_DSN is set; otherwise errors are only logged.
import * as Sentry from '@sentry/node'
import { env } from './env.js'

const on = Boolean(env.SENTRY_DSN)
if (on) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  })
}

/** Reports an unexpected error with what we know about the request. */
export function reportError(err, context = {}) {
  if (!on) return
  Sentry.captureException(err, { extra: context })
}

/** Reports a condition that needs a person (stuck payments, failing messages). */
export function reportProblem(message, context = {}) {
  if (!on) return
  Sentry.captureMessage(message, { level: 'warning', extra: context })
}

/**
 * Sentry cron monitor for the maintenance job: a dead-man's switch. Sentry
 * expects a check-in every minute and alerts when one is missed or a run
 * errors, even if nobody is looking at the panel. Returns the check-in id.
 */
export function cronCheckIn(status, checkInId = null) {
  if (!on) return null
  try {
    if (checkInId) return Sentry.captureCheckIn({ checkInId, monitorSlug: 'maintenance', status })
    return Sentry.captureCheckIn(
      { monitorSlug: 'maintenance', status },
      { schedule: { type: 'crontab', value: '* * * * *' }, checkinMargin: 3, maxRuntime: 2, timezone: 'Etc/UTC' },
    )
  } catch {
    return null
  }
}

/** Sends queued reports before a serverless function is frozen or a server exits. */
export const flushErrors = () => (on ? Sentry.flush(2000).catch(() => false) : Promise.resolve(true))


