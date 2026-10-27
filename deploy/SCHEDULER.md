# The every-minute maintenance job

`/internal/maintenance` does the background work: it cancels unpaid orders whose
10-minute hold ran out, checks Razorpay for payments whose webhook was lost,
retries refunds, refunds double payments, sends WhatsApp and SMS messages, and
re-checks orders against stock. It must run **every minute** in production.

Since 2026-10-22 a checkout also cancels expired holds on the boxes it needs
(lazy expiry), so a late job no longer blocks sales. Everything else above
still waits for the job.

## Which scheduler

| Hosting | Every-minute trigger | Cost |
|---------|----------------------|------|
| Docker / one server (`deploy/README.md`) or the local launcher | Built in: the API runs the job itself every minute. Nothing to set up. | none |
| Vercel **Pro** | Change `mango-api/vercel.json` `crons[0].schedule` to `* * * * *`. | Pro plan |
| Vercel **Hobby** | An external pinger (below). `vercel.json` keeps a once-a-day Vercel Cron (03:00 IST) as a backstop, which Hobby allows. | free |

Hobby refuses to deploy a project whose cron runs more than once a day, which is
why `vercel.json` ships with the daily schedule.

## External pinger (Vercel Hobby)

Any service that can call a URL every minute with a custom header works, for
example cron-job.org (free). Set it up like this:

1. URL: `https://<your API domain>/internal/maintenance`, method GET (POST also works).
2. Schedule: every minute.
3. Request header: `Authorization: Bearer <CRON_SECRET>`, the same value as the
   API's `CRON_SECRET` environment variable in Vercel. Type it into the
   service's own settings page. Never paste it into chat, a ticket or the repo.
4. Request timeout: 60 seconds (the function's limit).
5. Turn on the service's failure e-mail.

Check it works: in Vercel → Logs you should see `GET /internal/maintenance 200`
every minute, and `https://<your API domain>/ready` answers `{"ready":true,...}`.
A wrong secret shows as 401 in the logs and `/ready` turns 503 after 4 minutes.

Two runs at once are safe: the job takes a lease in the database (`job_leases`)
and the second run returns `{"skipped":true}`. A run killed at Vercel's 60-second
limit loses its lease after 65 seconds, so the next minute's run goes ahead.

## What records each run

- `maintenance_runs`: one row per step with the time it last succeeded
  (`last_ok_at`) or failed (`last_err_at`, `last_error`), how long its last
  try took (`last_duration_ms`) and how many times in a row it has failed
  (`fail_count`, back to 0 on a success). The row `tick` is
  written at the end of every run that held the lease; a skipped run writes
  nothing, so it never hides a stuck job. These are latest-only, not a history.
- The history is the log: one `GET /internal/maintenance 200` line per
  run (Vercel → Logs), one `maintenance run` line with that run's counts
  (orders expired, messages sent, refunds sent, failed steps, and so on), and
  the Sentry cron monitor's check-ins. Every line a step writes carries
  `step`, so one search finds what a step did.
- The panel's Needs attention card shows the last run and failing steps, with
  failures in a row and how long the last try took.

## Background work

There is no general jobs table. Each kind of work is found from the business
rows themselves: an unsent message is a `notifications` row still `PENDING`, a
refund due is an order with `refund_requested_at` set and no `refunded_at`, an
expired hold is an unpaid order past its hold. A second queue would be a second
source of truth that could disagree with the order. So each step reads the state,
does the work in a short transaction, and the next minute's run picks up
whatever is left. Every step is safe to run twice.

| Work | How work is claimed | Retries | Finished when | Where staff see it | Alert |
|------|---------------------|---------|---------------|--------------------|-------|
| WhatsApp messages (`notifications`, step `notifications`) | Written in the same transaction as the order change (an outbox; a rolled-back change sends nothing; one row per event and kind). Due rows are claimed with `FOR UPDATE SKIP LOCKED` and pushed 5 minutes ahead | 1, 5, 15, 60, 180 minutes; skipped after 24 hours | `SENT`, `FAILED` or `SKIPPED` | Needs attention, "WhatsApp messages not delivered" (Send again) | Sentry "WhatsApp messages are overdue" or "failing"; Docker: `WhatsAppMessagesFailing` |
| Browser notifications (`push_messages`, step `push`, `WEB_PUSH`) | As for WhatsApp: same transaction, same claim | 1, 5, 15 minutes; skipped after 24 hours | `SENT`, `FAILED` or `SKIPPED` | Needs attention, "Browser notifications not delivered" (failed, or 15 minutes overdue) | Sentry "Browser notifications are overdue" or "failing" |
| Refunds (step `refunds`, also `duplicate-payments`) | An order or preorder with `refund_requested_at` and no `refunded_at`. A 2-minute lease (`refund_attempted_at`) stops two workers sending the same refund | On later runs (`src/payments.js` sets the limits) | `refunded_at` set; `refund-checks` then asks Razorpay how it ended | Needs attention, "Refunds not sent" | Sentry "Refunds are overdue" (30 minutes); a failing step |
| Webhook replay | Stored Razorpay webhook events not yet processed (`src/payments.js`, "webhook replay") | On later runs | Processed, or listed as a webhook problem | Needs attention, "Webhook problems" | Sentry "Razorpay payments could not be matched"; Docker: `WebhooksFailing` |
| Bills catch-up (step `bills`, `BILLS_ENABLED`) | Paid orders with no bill, and bills whose order was cancelled. One transaction per order, order locked first | Every run until issued | A bill row with its number | Needs attention, the `bills` step failing | A failing step |
| Hold sweep (step `sweep`) | Unpaid orders past `hold_expires_at`, each cancelled in its own transaction with `SKIP LOCKED`. Checkout also expires them on the spot | Every run | `CANCELLED`, stock back on sale | Nothing to do; `mango_holds_expired_total` counts them | A failing step |
| Payment reconcile (steps `reconcile`, `payment-recon`) | Orders still `PAYMENT_PENDING` with a Razorpay order, asked about by polling; daily, every payment Razorpay captured in 3 days is matched | Every run; cancelled orders for a day with a 15-minute back-off | Paid, or left to the sweep | Needs attention, "Webhook problems" for payments that match nothing | Sentry "Payments were confirmed by polling" (webhooks not arriving) |
| Subscriptions (step `subscriptions`, `SUBSCRIPTIONS`) | Running subscriptions with a cycle due, each in its own transaction with `SKIP LOCKED`; the unique cycle row makes a repeat harmless | Every run | Cycle set up and its message queued, or `MISSED` | The subscriptions pages | A failing step |
| Preorders (step `preorders`) | Unpaid holds past their time, waitlist spots that opened, booked preorders whose week came (`SKIP LOCKED`) | Every run | `CONVERTED`, `CANCELLED` or moved a week | Needs attention, "Preorders for a manager" | A failing step |
| Retention (steps `retention`, `funnel-retention`) | Orders finished over `PII_RETENTION_MONTHS` ago, and bills older than `BILL_RETENTION_MONTHS` (buyer's name and address only), a bounded batch of each a day | The next day's pass | Details removed | Nothing to do | A failing step |

"A failing step" means: Needs attention lists the step with its error, failures
in a row and the last try's duration; Sentry gets the error at most hourly;
on Docker `MaintenanceStepFailing` fires. Every run also checks the outboxes
and refunds for work piling up (`checkHealth` in `src/maintenance.js`), since a
step can succeed every minute while doing nothing.

## Monitoring (required before launch)

`/ready` is the signal for an outside monitor. It needs no secret and says only
this:

| Answer | Meaning |
|--------|---------|
| `200 {"ready":true,"maintenanceAgeSeconds":42}` | Database answers, the last maintenance run finished 42 s ago |
| `503 {"ready":false,"maintenanceAgeSeconds":241}` | No run has finished for over 4 minutes: the scheduler (or every run) has stopped |
| `503 {"ready":false}` | The database doesn't answer |

In production a database where no run has ever finished also answers 503.

The rule is 4 minutes (three missed runs), so a monitor that checks every
minute alerts at most 5 minutes after the last good run, and one slow or skipped
run never trips it. A monitor that checks only every 3 or 5 minutes (common on
free plans) alerts up to about 7 or 9 minutes after the last run instead.

### Set up the uptime monitor (free)

Use a different service from the pinger, so one outage can't silence both.

1. Create an HTTP(S) monitor for `https://<your API domain>/ready`, method GET,
   no headers. It must count any status other than 200 as down (the default on
   most services).
2. Interval: every minute if the plan offers it; see above for what a longer
   interval means.
3. Alert by SMS or phone call to the on-call person named in
   `deploy/VERCEL.md` ("Watch it"), and by e-mail to the backup person.
4. If the service has a "confirm before alerting" or "retries" setting, keep it
   at one extra check at most; each extra check adds a minute.
5. Turn on the "back up" (recovery) notification too.

If no free service gives one-minute checks, a second cron-job.org job (a
separate account is better) that calls `/ready` every minute and e-mails on a
failure works as the monitor, together with the Sentry cron monitor below.

### Sentry cron monitor

The job checks in with Sentry on every run (monitor `maintenance`). In
Sentry → Crons turn on alerts for missed and failed check-ins. Write the owner's
name in the launch checklist (`deploy/VERCEL.md`, "Watch it").

### Test the alert (staging, then production)

1. Pause the pinger.
2. Watch `/ready`: `maintenanceAgeSeconds` climbs; after 4 minutes it answers
   503 and the monitor alerts within the next check.
3. Resume the pinger. The next run makes `/ready` answer 200; the monitor sends
   its recovery notice.
4. Write the times (paused, 503 seen, alert received, resumed, recovered) in the
   evidence list below.

## Evidence needed to call this done

- [ ] 24 hours of `/internal/maintenance 200` once a minute in staging logs
      (no gap over 2 minutes).
- [ ] The uptime monitor alerted within 5 minutes of the last run when the
      pinger was paused, and cleared when it was resumed (times written down).
- [ ] The Sentry `maintenance` monitor shows check-ins and has an alert rule.
