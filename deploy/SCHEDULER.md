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
every minute, and `https://<your API domain>/ready` answers `{"ready":true}`.
A wrong secret shows as 401 in the logs and `/ready` turns 503 after 5 minutes.

Two runs at once are safe: the job takes a database lock and the second run
returns `{"skipped":true}`.

## Monitoring (required before launch)

1. **Uptime monitor on `/ready`** (UptimeRobot, Better Stack, or similar),
   every minute, alerting a named person by SMS or phone. `/ready` returns 503
   when the database is down or the job has not finished a run for 5 minutes.
2. **Sentry cron monitor** `maintenance`: the job checks in on every run. In
   Sentry → Crons turn on alerts for missed and failed check-ins.
3. Write the owner's name in the launch checklist (`deploy/VERCEL.md`, "Watch it").

## Evidence needed to call this done

- [ ] 24 hours of `/internal/maintenance 200` once a minute in staging logs
      (no gap over 2 minutes).
- [ ] The uptime monitor alerted when the pinger was paused for 6 minutes, and
      cleared when it was resumed.
- [ ] The Sentry `maintenance` monitor shows check-ins and has an alert rule.
