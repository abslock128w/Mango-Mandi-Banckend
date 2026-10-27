// What checks each alert, on both deploy paths (docs/alerts.md).
//
// Docker: Prometheus scrapes /metrics and Alertmanager pages on the rules in
// ops/alerts.yml. Vercel: nothing reads that file (each function instance has
// its own short-lived counters, and /metrics answers 404), so the checker is the
// maintenance job itself. Every minute it reads shared state from Postgres
// (checkHealth in maintenance.js, the hourly runAudit) and sends a Sentry warning
// per problem, at most hourly each; Sentry's alert rule tells the on-call person.
// The job stopping is caught from outside: Better Stack Uptime polls /ready, and
// the Sentry Cron monitor `maintenance` expects a check-in every minute.
//
// ALERT_CHECKS names, for every rule in ops/alerts.yml, what stands in for it on
// Vercel and who is told. test/alert-checks.test.js fails when a rule has no
// entry, an entry has no rule, or a checkHealth key here is never raised.
import { now } from './clock.js'
import { query } from './db.js'
import { env } from './env.js'
import { recentCounts } from './ops-counters.js'

/** Who hears about it on Vercel (deploy/VERCEL.md, "Watch it", has the setup). */
export const NOTIFY = {
  sentry: 'Sentry warning: alert rule e-mails and app-pushes the on-call people',
  cron: 'Sentry Cron monitor maintenance: missed or failed check-in',
  uptime: 'Better Stack Uptime on /ready: phone call and SMS to the on-call rota',
}

/** The window the counter checks sum over, as the alerts.yml rules mostly do (10 minutes). */
export const ALERT_WINDOW_MS = 10 * 60_000
/** A maintenance step that has failed this many times in a row is reported. */
export const STEP_FAILS = 3
/** A step that last failed longer ago than this is not run any more (a switch went off): no alert. */
const STEP_STALE_MS = 25 * 60 * 60_000

/**
 * Per alerts.yml rule: `vercel` says what checks it there, `checks` names each
 * check (by: checkHealth and its problem key, runAudit, login-codes for sms.js
 * OTP_ALERTS, ready for /ready, cron for the Sentry monitor), `notifies` who is
 * told, `runbook` the heading in deploy/RUNBOOKS.md.
 */
export const ALERT_CHECKS = {
  MaintenanceLoopStopped: {
    vercel: 'No maintenance run finished for 4 minutes: /ready answers 503 (readiness.js), and the Sentry Cron monitor misses its every-minute check-in',
    checks: [{ by: 'ready' }, { by: 'cron', key: 'maintenance' }],
    notifies: [NOTIFY.uptime, NOTIFY.cron],
    runbook: 'scheduler-stopped',
  },
  MaintenanceStepFailing: {
    vercel: `A step failed ${STEP_FAILS} times in a row (maintenance_runs.fail_count). Each failure also reaches Sentry as an error, at most hourly per step`,
    checks: [{ by: 'checkHealth', key: 'steps-failing' }],
    notifies: [NOTIFY.sentry, NOTIFY.cron],
    runbook: 'a-maintenance-step-keeps-failing',
  },
  WhatsAppMessagesFailing: {
    vercel: '3 or more messages given up on (FAILED) in a day',
    checks: [{ by: 'checkHealth', key: 'failing' }],
    notifies: [NOTIFY.sentry],
    runbook: 'failed-notifications',
  },
  WebhooksFailing: {
    vercel: '3 or more unresolved webhook failures in an hour, Razorpay and WhatsApp each (webhook_failures; a webhook that answers 500 records one)',
    checks: [{ by: 'checkHealth', key: 'webhooks' }, { by: 'checkHealth', key: 'whatsapp-webhooks' }],
    notifies: [NOTIFY.sentry],
    runbook: 'webhooks-failing-500',
  },
  LoginCodesOnFallback: {
    vercel: 'The 5th login code in an hour sent on the backup channel (sms.js, counted in rate_limits), reported as it happens',
    checks: [{ by: 'login-codes', key: 'fallback' }],
    notifies: [NOTIFY.sentry],
    runbook: 'login-codes-not-arriving',
  },
  LedgerDrift: {
    vercel: 'The hourly stock audit finds counters that disagree with the ledger (runAudit)',
    checks: [{ by: 'runAudit', key: 'ledger-drift' }],
    notifies: [NOTIFY.sentry],
    runbook: 'stock-discrepancy-ledger-audit-drift',
  },
  ApiErrors: {
    vercel: 'More than ALERT_API_ERRORS (10) server errors (5xx) in 10 minutes, counted in ops_counters. Each unexpected 500 is also a Sentry error',
    checks: [{ by: 'checkHealth', key: 'api-errors' }],
    notifies: [NOTIFY.sentry],
    runbook: 'api-errors-or-slow-answers',
  },
  ApiErrorRatio: {
    vercel: 'The same count as ApiErrors: requests are not counted on Vercel, and 10 errors in 10 minutes is at most 2% of any traffic up to 500 requests in that time, so it fires whenever the ratio would there, and earlier when busier',
    checks: [{ by: 'checkHealth', key: 'api-errors' }],
    notifies: [NOTIFY.sentry],
    runbook: 'api-errors-or-slow-answers',
  },
  ApiSlow: {
    vercel: 'More than ALERT_SLOW_REQUESTS (20) answers slower than SLOW_REQUEST_MS (2000 ms) in 10 minutes, counted in ops_counters (downloads, photo uploads and the maintenance run excluded)',
    checks: [{ by: 'checkHealth', key: 'api-slow' }],
    notifies: [NOTIFY.sentry],
    runbook: 'api-errors-or-slow-answers',
  },
  DatabasePoolBusy: {
    vercel: 'More than ALERT_DB_BUSY (5) requests answered 503 BUSY for want of a database connection in 10 minutes, counted in ops_counters',
    checks: [{ by: 'checkHealth', key: 'db-busy' }],
    notifies: [NOTIFY.sentry],
    runbook: 'downtime-or-database-outage',
  },
  DatabasePoolWaiting: {
    vercel: 'No gauge on Vercel: a query that waits for a connection either gets one late (the request counts as slow) or gives up after DB_CONNECT_TIMEOUT_MS (a 503 BUSY), so the api-slow and db-busy checks stand in',
    checks: [{ by: 'checkHealth', key: 'db-busy' }, { by: 'checkHealth', key: 'api-slow' }],
    notifies: [NOTIFY.sentry],
    runbook: 'downtime-or-database-outage',
  },
}

/** checkHealth problems from the ops_counters sums of the last 10 minutes (with OPS_ALERTS). */
export async function counterProblems(at = now()) {
  const c = await recentCounts(ALERT_WINDOW_MS, at)
  const n = (kind) => c[kind] ?? 0
  const errors = n('api-5xx') + n('db-busy') + n('db-unavailable')
  const out = []
  if (errors > env.ALERT_API_ERRORS) {
    out.push(['api-errors', 'The API is answering with server errors (5xx): see Sentry and the Vercel logs (RUNBOOKS: API errors or slow answers)', {
      lastTenMinutes: errors, threshold: env.ALERT_API_ERRORS, busy: n('db-busy'), unavailable: n('db-unavailable'),
    }])
  }
  if (n('api-slow') > env.ALERT_SLOW_REQUESTS) {
    out.push(['api-slow', 'API answers are slow: see "slow query" in the logs and the Neon load (RUNBOOKS: API errors or slow answers)', {
      lastTenMinutes: n('api-slow'), slowerThanMs: env.SLOW_REQUEST_MS, threshold: env.ALERT_SLOW_REQUESTS,
    }])
  }
  if (n('db-busy') > env.ALERT_DB_BUSY) {
    out.push(['db-busy', 'The database pool is exhausted: customers are getting "busy, retry". Check slow queries and DB_POOL_MAX (RUNBOOKS: downtime or database outage)', {
      lastTenMinutes: n('db-busy'), threshold: env.ALERT_DB_BUSY,
    }])
  }
  return out
}

/** A checkHealth problem when a step has failed STEP_FAILS times in a row and last failed within a day (with OPS_ALERTS). */
export async function stepProblems(at = now()) {
  const { rows } = await query('SELECT step, fail_count FROM maintenance_runs WHERE fail_count >= $1 AND last_err_at > $2 ORDER BY step', [
    STEP_FAILS, new Date(at.getTime() - STEP_STALE_MS),
  ])
  if (!rows.length) return []
  return [['steps-failing', `Maintenance steps have failed ${STEP_FAILS} times in a row: see Needs attention (RUNBOOKS: a maintenance step keeps failing)`, {
    steps: rows.map((r) => ({ step: r.step, failCount: r.fail_count })),
  }]]
}
