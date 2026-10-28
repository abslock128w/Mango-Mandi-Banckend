# Alerts: what checks them, and who is told

An alert rule is only useful if something reads it. This page says, for every
alert, what checks it on each deploy path and who hears about it.

## The decision

Made on 27 Oct 2026, in answer to the second architecture review ("nothing on
Vercel reads alerts.yml or the metrics, so the alerts may never fire").

- **On Vercel, the checker is the maintenance job itself.** It runs every
  minute and reads shared state from Postgres: `checkHealth` in
  `mango-api/src/maintenance.js`, and the hourly stock audit. Each problem
  becomes a Sentry warning, at most once an hour each, with a fixed message so
  Sentry groups it. Nothing on Vercel reads `ops/alerts.yml` or the Prometheus
  metrics: each function instance keeps its own counters for a few minutes,
  and `/metrics` answers 404.
- **Two tools tell people:**
  - **Sentry.** An issue alert rule on those warnings (and on errors) e-mails
    the on-call people and pushes to the Sentry app on their phones. The Sentry
    Cron monitor `maintenance` alerts when the job misses its every-minute
    check-in, or a run has a failed step.
  - **Better Stack Uptime.** It checks `https://api.<domain>/ready` every
    minute from outside, and phones and texts (SMS) the on-call person, by an
    on-call rota. It is the one alert that does not need our code to run, so it
    catches the job stopping, the database down and the whole API down.
- **On the Docker path**, Prometheus scrapes `/metrics` and Alertmanager pages
  on [`mango-api/ops/alerts.yml`](../mango-api/ops/alerts.yml), as before. The
  maintenance job's Sentry warnings fire there too.
- **One machine-checked list.** [`mango-api/src/alert-checks.js`](../mango-api/src/alert-checks.js)
  names, for every rule in alerts.yml, the Vercel check and who is told.
  `test/alert-checks.test.js` fails when a rule has no entry, when a check key
  is never raised from seeded rows, or when this table misses a rule.

Setup steps (Sentry alert rule, Cron monitor alert, Better Stack monitor and
rota): [deploy/VERCEL.md, section 8](../deploy/VERCEL.md#8-watch-it).

## Every alert

"Docker" is the Prometheus rule in alerts.yml. On Vercel, `checkHealth` keys
are the names in the maintenance job's code; each needs `OPS_ALERTS`, which is
on by default in production, unless marked "always".

| Alert | Condition (Docker) | What checks it on Vercel | What checks it on Docker | Who is told on Vercel | Runbook |
|---|---|---|---|---|---|
| MaintenanceLoopStopped | No run for 5 minutes | `/ready` answers 503 after 4 minutes with no finished run, and Better Stack checks it every minute. The Sentry Cron monitor `maintenance` misses a check-in (always) | Prometheus, `mango_maintenance_last_run_timestamp_seconds` | Better Stack (call and SMS); Sentry Cron alert | [Scheduler stopped](../deploy/RUNBOOKS.md#scheduler-stopped) |
| MaintenanceStepFailing | More than 3 step failures in 15 minutes | `checkHealth` `steps-failing`: a step has failed 3 times in a row (`maintenance_runs.fail_count`) and last failed within a day. Each failure is also a Sentry error, at most hourly per step, and the run checks in as failed | `mango_maintenance_errors_total` | Sentry warning; Sentry Cron alert | [A maintenance step keeps failing](../deploy/RUNBOOKS.md#a-maintenance-step-keeps-failing) |
| WhatsAppMessagesFailing | More than 5 messages given up on in an hour | `checkHealth` `failing`: 3 or more messages FAILED in the last day (without `OPS_ALERTS`: over 5% of 20 or more) | `mango_notifications_failed_total` | Sentry warning | [Failed notifications](../deploy/RUNBOOKS.md#failed-notifications) |
| WebhooksFailing | More than 3 webhook errors in 15 minutes | `checkHealth` `webhooks` (Razorpay, always) and `whatsapp-webhooks`: 3 or more unresolved webhook failures in the last hour. A webhook that answers 500 records one | `mango_webhook_errors_total` | Sentry warning, and a Sentry error per 500 | [Webhooks failing (500)](../deploy/RUNBOOKS.md#webhooks-failing-500) |
| LoginCodesOnFallback | More than 10 codes on the backup channel in 30 minutes | `sms.js` (always): the 5th code in an hour sent on the backup channel, counted in Postgres (`rate_limits`), reported as it happens | `mango_otp_fallbacks_total` | Sentry warning | [Login codes not arriving](../deploy/RUNBOOKS.md#login-codes-not-arriving) |
| LedgerDrift | Any stock counter disagrees with the ledger | The hourly `audit` step, `runAudit` (always) | `mango_ledger_drift_lines` | Sentry warning; Needs attention | [Stock discrepancy](../deploy/RUNBOOKS.md#stock-discrepancy-ledger-audit-drift) |
| ApiErrors | 5xx answers above 0.2 a second for 5 minutes | `checkHealth` `api-errors`: more than `ALERT_API_ERRORS` (10) 5xx answers in 10 minutes, from `ops_counters` | Request histogram, `status=~"5.."` | Sentry warning, and a Sentry error per unexpected 500 | [API errors or slow answers](../deploy/RUNBOOKS.md#api-errors-or-slow-answers) |
| ApiErrorRatio | Over 2% of answers 5xx for 10 minutes | The same `api-errors` count (see below) | Request histogram | Sentry warning | [API errors or slow answers](../deploy/RUNBOOKS.md#api-errors-or-slow-answers) |
| ApiSlow | p95 over 1.5 seconds for 10 minutes | `checkHealth` `api-slow`: more than `ALERT_SLOW_REQUESTS` (20) answers slower than `SLOW_REQUEST_MS` (2000 ms) in 10 minutes, from `ops_counters` | Request histogram | Sentry warning | [API errors or slow answers](../deploy/RUNBOOKS.md#api-errors-or-slow-answers) |
| DatabasePoolBusy | More than 5 BUSY answers in 10 minutes | `checkHealth` `db-busy`: more than `ALERT_DB_BUSY` (5) answers of 503 BUSY for want of a database connection in 10 minutes, from `ops_counters` | `mango_db_pool_busy_total` | Sentry warning | [Downtime or database outage](../deploy/RUNBOOKS.md#downtime-or-database-outage) |
| DatabasePoolWaiting | Queries waiting for a connection for 5 minutes | `db-busy` and `api-slow` stand in (see below) | `mango_db_pool_connections{state="waiting"}` | Sentry warning | [Downtime or database outage](../deploy/RUNBOOKS.md#downtime-or-database-outage) |

## How the API counts are kept on Vercel

- Table `ops_counters` (migration 050): one row per minute and kind. The
  kinds are `api-5xx`, `db-busy`, `db-unavailable` (each 5xx answer is one of
  these three) and `api-slow`. The code is `mango-api/src/ops-counters.js`.
- Only rare events are counted, never every request. A request adds to the
  count after its answer has been sent, so the counter never slows or fails it.
  Each instance has at most one counter write in flight; a burst of errors is
  one upsert per kind and minute.
- When a write fails, the error is logged and the request is not touched. When
  it fails because the database is unreachable or the pool is full, the counts
  stay in memory and nothing is written for 30 seconds, so the counter does not
  add load to a database that is already the problem. A 503 for an
  unreachable database is counted too, but that write usually fails: the
  uptime monitor on `/ready` covers an outage.
- Nothing is written until the instance has checked that the database belongs
  to this environment, so a deploy pointed at the wrong database never writes
  to it.
- Not counted as slow: file downloads (CSV exports, bill and label PDFs, a
  customer's own data), photo uploads, and the maintenance run. `/ready` and
  `/health` are never counted: a 503 from `/ready` is its answer, and Better
  Stack already pages on it.
- The cleanup step deletes rows older than 7 days.

## The two rules with no direct equivalent

- **ApiErrorRatio.** Vercel does not count every request (that would be one
  database write per request). The absolute count stands in. 10 errors in 10
  minutes is at most 2% of any traffic up to 500 requests in that time (about
  one a second). So up to that traffic it fires whenever the ratio rule would.
  When the shop is busier it fires earlier than the ratio would, never later.
- **DatabasePoolWaiting.** No instance lives long enough for a gauge. A query
  that waits for a connection either gets one late, so its request is counted
  slow, or gives up after `DB_CONNECT_TIMEOUT_MS` (5 seconds) and its request
  answers 503 BUSY, counted as `db-busy`. So waiting shows as `api-slow` and
  `db-busy`.

## Settings (`mango-api`)

| Setting | Default | Meaning |
|---|---|---|
| `OPS_ALERTS` | on in production (`NODE_ENV=production`, so Vercel previews too), off elsewhere | These checks and the counting. `false` turns them off, and preflight warns about it. A preview's warnings carry the Sentry environment `preview`, which the alert rule does not page on |
| `SLOW_REQUEST_MS` | `2000` | An answer slower than this many ms counts as slow; `0` counts none |
| `ALERT_API_ERRORS` | `10` | More than this many 5xx answers in 10 minutes raises `api-errors` |
| `ALERT_SLOW_REQUESTS` | `20` | More than this many slow answers in 10 minutes raises `api-slow` |
| `ALERT_DB_BUSY` | `5` | More than this many 503 BUSY answers in 10 minutes raises `db-busy` |

The window is 10 minutes. Each problem is reported at most once an hour while
it lasts.

## Other warnings

The maintenance job and the API also warn about things alerts.yml has no rule
for: overdue messages and refunds, payments found only by polling, overdue
orders, a missed backup, preorder capacity and labelled boxes that disagree
with the counters, messages dropped unsent, and the login-code budget. They
reach the same Sentry alert rule. Each is listed with its owner and way back
in [deploy/RUNBOOKS.md](../deploy/RUNBOOKS.md#every-needs-attention-item-who-owns-it-and-the-way-back).
