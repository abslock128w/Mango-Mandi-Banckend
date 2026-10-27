# Going live on Vercel and Neon

This is the hosted setup: three Vercel projects from this one repository, and a
Neon Postgres database in Singapore. Nothing to patch, back up by hand or renew.
(The single-server Docker setup in [README.md](README.md) still works if you ever
want to leave Vercel.) For every release after the first, follow
[RELEASE.md](RELEASE.md); when something breaks, [RUNBOOKS.md](RUNBOOKS.md).

| Vercel project | Root directory | Serves | Example domain |
|----------------|----------------|--------|----------------|
| `mandi-api` | `mango-api` | the API, the Razorpay and WhatsApp webhooks, the maintenance job | `api.mandimangoes.in` |
| `mandi-shop` | `customer-app` | the customer shop | `mandimangoes.in` and `www.` |
| `mandi-admin` | `/` (repo root) | the staff panel (hidden from search engines) | `ops.mandimangoes.in` |

Each folder already has its `vercel.json`, so Vercel needs no build settings typed in.
The API runs in Singapore (`sin1`), next to the database.

## What you need first

- [ ] **Vercel Pro** for production, with its every-minute cron for the maintenance
  job ([SCHEDULER.md](SCHEDULER.md)). Vercel's Hobby plan is for non-commercial use,
  and a free pinger promises nothing, so Hobby with a pinger is for staging and demos
  only. Without the every-minute job, payment checks, refund retries and WhatsApp
  messages stall. Dated plan for this and every other item: [GO-LIVE.md](GO-LIVE.md).
- [ ] **Neon** account (the Launch plan is enough to start).
- [ ] **A domain**, e.g. `mandimangoes.in`, with access to its DNS.
- [ ] **Razorpay live account** with KYC done. Jio DLT and Meta WhatsApp approval
  are the same as in [README.md](README.md#what-you-need-first); start them now,
  they take weeks.
- [ ] **A Google OAuth client** for "Sign in with Google" (step 4).
- [ ] **Sentry** project (free tier is fine) for error alerts.

## 1. Neon

1. Create a project in **AWS Asia Pacific (Singapore)**, Postgres 16 or newer.
2. Keep the default branch as `main` (production). Create a second branch
   `staging` from it for preview deployments.
3. In the SQL editor on `main`, make a separate login for the app that can read
   and write data but cannot change the schema, and give both roles a query
   time limit:

   ```sql
   CREATE ROLE mango_app LOGIN PASSWORD '<a long random password>';
   GRANT USAGE ON SCHEMA public TO mango_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mango_app;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mango_app;
   -- Tables the owner creates later (new migrations) get the same rights.
   ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mango_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
     GRANT USAGE, SELECT ON SEQUENCES TO mango_app;
   ALTER ROLE mango_app SET statement_timeout = '10s';
   -- A transaction left open (a function stopped mid-request) gives its connection back.
   ALTER ROLE mango_app SET idle_in_transaction_session_timeout = '30s';
   -- A request behind a locked row gives up after 5 s and answers 503 BUSY (LOAD-3).
   ALTER ROLE mango_app SET lock_timeout = '5s';
   ALTER ROLE neondb_owner SET statement_timeout = '60s';
   -- The app's queries are short; compiling them (JIT) only adds time (audit DB-06).
   ALTER ROLE mango_app SET jit = off;
   ```

   Run the first deploy (step 3) before the two `GRANT ... ON ALL` lines matter;
   if you made the role before the tables existed, run those two lines again after.
   Then, after the first deploy and after any re-run of those lines, take back
   the right to change the stock ledger, which only ever gets new rows (a trigger
   refuses changes too; this keeps it that way even if the trigger is bypassed,
   audit DB-09):

   ```sql
   REVOKE UPDATE, DELETE, TRUNCATE ON batch_ledger FROM mango_app;
   ```

   Check both with `SELECT has_table_privilege('mango_app', 'batch_ledger', 'UPDATE');`
   (should be `f`) and, logged in as `mango_app`, `SHOW jit;` (should be `off`).
4. Copy two connection strings from **Connect**:
   - **Pooled** (host has `-pooler`), logged in as `mango_app`: this is `DATABASE_URL`.
   - **Direct** (no `-pooler`), logged in as the owner: this is
     `DATABASE_URL_UNPOOLED`. Only migrations use it.

   Do the same on the `staging` branch for the preview values.

5. **Set the restore window to 7 days.** Neon keeps point-in-time history for a
   window that is **1 day by default on paid plans** (6 hours on Free). In the Neon
   console's project **Settings**, set the history (restore) window to **7 days**,
   the most the Launch plan allows (history storage is billed per GB-month). Write the date
   you set it in the go-live checks below. Without this step a mistake noticed on
   day two cannot be undone from Neon.

With the window set, a bad change can be undone by restoring a branch to a minute
before it. See [Backups and restore drill](#backups-and-restore-drill).

The first deploy against each branch records which environment it belongs to
(production for `main`, preview for `staging`). After that a preview build
pointed at `main` by mistake fails instead of migrating or serving it, and the
API refuses to use it; production refuses `staging` the same way.

## 2. Create the three Vercel projects

For each row in the table above: **Add New → Project**, import this GitHub
repository, set the **Root Directory**, and leave the build settings as detected.
Then add the domain under **Settings → Domains** and the DNS record Vercel shows.

All three run on **Node.js 24**. `mandi-api` and `mandi-admin` take it from their
`package.json` (`engines`); `mandi-shop` has no `package.json` of its own, so set it
under **Settings → Build and Deployment → Node.js Version → 24.x**.

Put the shop and the panel on the same domain as the API (`mandimangoes.in`,
`ops.mandimangoes.in`, `api.mandimangoes.in`). The sign-in cookie then works with
the default `COOKIE_SAMESITE=lax`.

## 3. Environment variables

Set these under each project's **Settings → Environment Variables**. Generate
secrets with `openssl rand -hex 32`. Never commit them.

### `mandi-api`

| Variable | Production | Preview | Notes |
|----------|-----------|---------|-------|
| `NODE_ENV` | `production` | `production` | required: on Vercel the API won't start without it (no fake payments or logged codes on any deploy) |
| `DATABASE_URL` | Neon `main`, pooled, `mango_app` | Neon `staging`, pooled | |
| `DATABASE_URL_UNPOOLED` | Neon `main`, direct, owner | Neon `staging`, direct | migrations only |
| `JWT_SECRET` | random, 64 hex | a different random | |
| `TOTP_ENCRYPTION_KEY` | random, `openssl rand -base64 32` | a different random | Encrypts staff two-step secrets at rest. Keep it once set; after first setting it, run `node --env-file=.env ops/seal-two-step.js` |
| `CRON_SECRET` | random, 32+ chars | random | Vercel sends it to the maintenance job |
| `CUSTOMER_ORIGIN` | `https://mandimangoes.in,https://www.mandimangoes.in` | the shop preview URL | comma-separated |
| `ADMIN_ORIGIN` | `https://ops.mandimangoes.in` | the panel preview URL | |
| `COOKIE_SAMESITE` | `lax` | `none` | previews are on different `*.vercel.app` names |
| `SEED_DEMO_DATA` | `false` | `true` | demo batches only on previews; demo staff logins are never made on Vercel |
| `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` | first manager's login | **not set** | tick only Production; used once, on an empty staff table; remove after |
| `PREVIEW_ADMIN_EMAIL` / `PREVIEW_ADMIN_PASSWORD` | | a different login | the first manager on the staging branch, so the production password never reaches a preview |
| `PRODUCTION_DB_HOST` | the Neon `main` host, e.g. `ep-cool-sun-123456.ap-southeast-1.aws.neon.tech` | the same value | required: production refuses any other database, and a preview refuses this one, even on its first deploy |
| `STAFF_TWO_STEP` | leave unset (`all`) | leave unset (`all`) | every staff account uses an authenticator app; `managers` limits it to managers and operators (preflight warns) |
| `GOOGLE_CLIENT_ID` | from step 4 | same | |
| `BLOB_READ_WRITE_TOKEN` | added by Vercel Blob (step 5) | same store or a second one | required in production |
| `SENTRY_DSN` | from Sentry | same | |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | live keys | test keys | a preview refuses live keys |
| `RAZORPAY_WEBHOOK_SECRET` | from the Razorpay webhook | test webhook | |
| `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` | unset; the old secret for a day while rotating | unset | webhooks signed with it are still accepted (preflight warns while it is set) |
| `WHATSAPP_PAYMENT_CONFIG` | leave unset | unset | Payments on WhatsApp has no reconcile yet (preflight warns when set); unset, chat orders get a Razorpay payment link |
| `SMS_PROVIDER` and `JIO_SMS_*` | `jio` and Jio's values | `log`, with `LOG_OTP_CODES=true` to read codes in the Vercel logs | see [mango-api/README.md](../mango-api/README.md#login-codes-by-sms-jio); production refuses `LOG_OTP_CODES` |
| `WHATSAPP_*` | Meta's values | `log` | see [mango-api/README.md](../mango-api/README.md#whatsapp-order-updates) |
| `OTP_DAILY_LIMIT` | `3000` | `200` | login codes per day before sending pauses; Sentry warns at 80% |
| `OTP_NEW_NUMBER_SHARE` | `0.6` | | the part of that budget numbers with no account may use; the rest is kept for existing customers |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | from Cloudflare Turnstile | Cloudflare's test keys | a check, usually invisible, before a login code is sent; set both or neither |
| `API_RATE_LIMIT` | `3000` | | requests per 15 minutes from one address before 429. Mobile carriers put many customers behind one address, so keep it high; it only stops floods |
| `OTP_IP_LIMIT` | leave unset (`200`) | | login-code requests per 15 minutes from one address. High on purpose, for the same carrier-NAT reason: Turnstile, the per-number caps (5 an hour, 16 a day) and `OTP_DAILY_LIMIT` are what stop SMS pumping. Lower it only if Sentry shows one address pumping codes |
| `METRICS_TOKEN` | not needed | | `/metrics` answers 404 on Vercel; it and `ops/alerts.yml` are for the Docker path only |
| `BILL_RETENTION_MONTHS` | leave unset (`96`) | leave unset | months a bill keeps the buyer's name and address after its date (tax law, [docs/trust.md](../docs/trust.md#how-long-bills-are-kept)); the CA confirms it. Production refuses under 72 and warns under 96 |
| `OPS_ALERTS` | leave unset (on) | leave unset (on too: previews run as production; the Sentry alert rule only pages for `production`) | the maintenance job's alert checks ([docs/alerts.md](../docs/alerts.md)); `false` turns them off and preflight warns |
| `SLOW_REQUEST_MS`, `ALERT_API_ERRORS`, `ALERT_SLOW_REQUESTS`, `ALERT_DB_BUSY` | leave unset (2000, 10, 20, 5) | | when an answer counts as slow, and how many errors, slow answers and BUSY answers in 10 minutes raise a warning |
| `BACKUP_HEARTBEAT_EXPECTED` | `true` once the backup workflow records its heartbeat (see [Backups](#backups-and-restore-drill)) | | Needs attention and Sentry warn when no backup has succeeded for 26 hours |

`TRUST_PROXY` and the database pool size are set for Vercel automatically.

### `mandi-shop` and `mandi-admin`

| Variable | Production | Preview |
|----------|-----------|---------|
| `VITE_API_URL` | `https://api.mandimangoes.in` | the API preview URL |
| `VITE_SUPPORT_WHATSAPP` (`mandi-shop` only) | the shop's help WhatsApp number, country code and number, digits only (91 and the 10-digit number) | the same, or a team number | **required**: a production build of the shop fails without it, so every page has a help contact (footer, order page, /help, /terms) |

### Check before the first real deploy

From a terminal with the production values in `mango-api/.env`:

```sh
cd mango-api && npm run preflight
```

It lists every missing or unsafe setting. In production the API also refuses to
start when one of the hard errors is present.

## 4. Sign in with Google

1. In [Google Cloud console](https://console.cloud.google.com/), **APIs & Services →
   OAuth consent screen**: app name MandiMangoes, support email, the privacy notice
   URL `https://mandimangoes.in/privacy`. Publish it.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
   Under **Authorized JavaScript origins** add `https://mandimangoes.in`,
   `https://www.mandimangoes.in` and `https://ops.mandimangoes.in`. No redirect URIs
   are needed.
3. Put the client ID in `GOOGLE_CLIENT_ID` on `mandi-api`. Google sign-in for staff
   only works for emails already added on the Staff page.

## 5. Photos in Vercel Blob

On `mandi-api`: **Storage → Create → Blob**, choose private access, and connect it
to the project. Vercel adds `BLOB_READ_WRITE_TOKEN` for you. Delivery and claim
photos then go there. Production won't start without it, so photos never end up
in the database; previews may keep them there. The photos have no copy anywhere
else (see [Backups and restore drill](#backups-and-restore-drill)).

## 6. Deploy

Push to `main` (or merge the pull request). Vercel builds all three projects. The
API build runs the migrations (over `DATABASE_URL_UNPOOLED`) and the
reference-data seed before it goes live, so a failed migration stops the deploy
and the old version keeps serving.

For a minute after a deploy the old version still runs against the new schema,
so migrations only add: a new column or table first, and the removal of the old
one a release later, once no code uses it. A test refuses a migration that
drops, renames or narrows something unless the file has a `-- contract:` line
saying which release stopped using it.

Then point the webhooks at the API:

- Razorpay dashboard → **Webhooks**: `https://api.mandimangoes.in/webhooks/razorpay`,
  events `payment.authorized`, `payment.captured`, `payment.failed`, `payment_link.paid`, `refund.processed`, `refund.failed` and the `payment.dispute.*` events (disputes are only recorded and shown in Needs attention).
- Meta app → **WhatsApp → Configuration**: callback `https://api.mandimangoes.in/webhooks/whatsapp`
  with your `WHATSAPP_VERIFY_TOKEN`, subscribed to `messages`.

## 7. Protect it

- **Firewall rate limit on sign-in.** On `mandi-api`, **Firewall → Configure → New
  rule**: if the request path starts with `/v1/auth/` or `/admin/v1/auth/`, rate limit
  to 60 requests per minute per IP, action **Deny**. The API has its own limits too;
  this stops floods before they cost function time. Don't go much lower: one mobile
  carrier address can carry many customers signing in at once (each sign-in is a code
  request and a verify), and the API's own per-address limit is 200 codes per 15
  minutes (`OTP_IP_LIMIT`).
- **Turn on Vercel's bot protection** in the shop project's Firewall settings.
- **Deployment protection (required).** On all three projects, **Settings → Deployment
  Protection → Vercel Authentication** for previews, so only your team can open them.
  Previews hold real staff logins and test payments; an open preview URL is an open
  admin panel.
- **Turnstile.** In Cloudflare → **Turnstile → Add widget**, add the shop's domains
  (`mandimangoes.in`, `www.mandimangoes.in`), mode **Managed**. Put the site key and
  secret key in `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` on `mandi-api`. The
  shop shows the check above "Send code" by itself. For previews use Cloudflare's
  always-pass test keys.
- **Two-step sign-in** on every account that can change production: GitHub, Vercel,
  Neon, Razorpay, Google Cloud and Meta.
- **Branch protection on GitHub** for `main`: require the CI check to pass and one
  approval before merging. Vercel only deploys what reaches `main`.
- **Least access.** Vercel team members who only look at logs get the Viewer role;
  only the owner holds the production database password.

## 8. Watch it

**Who is on call.** Write the names here before launch; the alerts below must reach them.

| Alert | Goes to (name, phone) | Backup person |
|-------|-----------------------|---------------|
| Better Stack Uptime on `/ready` (phone call and SMS, by the on-call rota) | _fill in_ | _fill in_ |
| Sentry: the alert rule below (e-mail and Sentry app push), Cron monitor `maintenance` | _fill in_ | _fill in_ |
| Panel "Needs attention" (checked every morning) | _fill in_ | _fill in_ |

**What checks the alerts on Vercel.** The maintenance job itself. Every minute it
reads shared state from Postgres and sends a Sentry warning for each problem, at
most hourly each: failing steps, overdue messages and refunds, webhook failures,
API errors, slow answers and a busy database pool (counted per minute in the
database), ledger drift, a missed backup. Two tools then tell people: **Sentry**
and **Better Stack Uptime**. `ops/alerts.yml` is for the Docker path only:
nothing reads it, or `/metrics`, on Vercel. Every alert, what checks it and who
is told: [docs/alerts.md](../docs/alerts.md). Leave `OPS_ALERTS` unset (on in
production); preflight warns if it is `false`.

**Sentry** (production refuses to start without `SENTRY_DSN`):
1. **Alerts → Create Alert → Issues**, project `mandi-api`, environment
   `production`. When: a new issue is created, or an issue changes from resolved
   to unresolved. If: the event's level is **warning or above** (so the job's
   warnings count, not only errors). Then: send a notification to the on-call
   people (a Sentry team with the names above). That is an e-mail, and a push on
   their phones once each person signs in to the Sentry app and allows issue alert
   notifications. Name it "On call: production problems".
2. **Crons → `maintenance`** (the first run creates the monitor; it expects a
   check-in every minute, with 3 minutes' grace). Turn on its alert for missed and
   failed check-ins, to the same people. A run with a failed step checks in as
   failed.
3. After fixing a problem, mark its Sentry issue **Resolved**. If the problem
   comes back, the job's next warning reopens it and the rule alerts again.
   While it lasts, the job repeats the warning hourly (it shows on the issue).

**Better Stack Uptime** (betterstack.com; check that the plan includes 1-minute
checks, phone calls and SMS):
1. **Uptime → Monitors → Create monitor**: alert when the URL becomes
   unavailable, URL `https://api.mandimangoes.in/ready`, checked **every minute**.
   `/ready` answers 503 when the database is down or the maintenance job has not
   finished a run for 4 minutes, and nothing at all when the API is down.
2. On-call: **Who's on-call** (on-call calendar) with the rota from the table
   above. Escalation: **call and SMS** the person on call at once; if nobody
   acknowledges within 5 minutes, call the backup person.
3. Each person installs the Better Stack app or saves its calling number, so the
   call is not taken for spam. Test the call and the SMS once before launch.

- The same Sentry rule covers new errors from the API, and the warning when login
  codes reach 80% of the day's budget.
- **Vercel → Logs** for request logs; **Neon → Monitoring** for database load. Search
  a customer's `X-Request-Id` (`req_…`) to see everything that request did; each
  maintenance run writes one `maintenance run` line with its counts, and slow
  queries show as `slow query` (deploy/RUNBOOKS.md, "Observability").
- The panel's **Today** page shows a "Needs attention" card when messages, refunds or
  webhooks are failing.

## Backups and restore drill

- **What you can lose (RPO): under a minute** for a point inside Neon's 7-day history
  window, **up to 24 hours** from the nightly off-site copy. Neon keeps every change
  for its history window, so `main` can go back to any second inside it. The window is
  **1 day by default on paid plans** (6 hours on Free); step 1.5 sets it to 7 days, the
  Launch plan's maximum (longer on Scale). Check it under Neon → **Settings** before
  trusting a restore. The nightly off-Neon copy (below) covers older mistakes and Neon
  itself being down, but anything after the last copy is lost in that case.
- **How long it takes (RTO): target 1 hour**, from deciding to restore to the shop
  taking orders again. **Not measured yet**: the owner must run the drill and write
  the real time in [RESTORE-DRILL.md](RESTORE-DRILL.md)'s log.
- **Drill** before launch and monthly in season: make a branch of `main` at a time a
  few minutes ago, then run `DRILL_URL=<its connection string> ./mango-api/ops/restore-drill.sh`.
  It checks the schema, row counts and that the stock books balance. Delete the
  branch afterwards; it holds customer data. Steps: [RESTORE-DRILL.md](RESTORE-DRILL.md).
- **Photos have no backup of their own** (an owner decision, not yet taken). Delivery,
  claim, review, product and deal photos are kept only in Vercel Blob (rows hold the
  path; neither Neon's history nor the nightly copy has the images). A deleted Blob
  store, or a photo deleted by mistake, cannot be brought back. The owner decides
  whether that is acceptable or a scheduled copy of the store is needed.
- **Nightly encrypted copy off Neon.** The GitHub Actions workflow
  [`backup.yml`](../.github/workflows/backup.yml) runs `ops/backup.sh` at 03:00 IST,
  encrypts the dump with your GPG public key and keeps it 30 days.
  **Where the copies live:** in the repository's GitHub Actions artifact storage
  (GitHub → Actions → **Backup** → a run → **Artifacts**), on GitHub's servers, apart
  from Neon and Vercel. Once the repository is in the client's GitHub organisation
  (deploy/GO-LIVE.md, item 2) the copies belong to the client. Only the holder of the
  GPG private key can read them. A copy is a few megabytes; check the Actions storage
  used under the organisation's **Settings → Billing** once a month. Set it up once:
  1. Make a read-only Neon role and copy its **direct** connection string. Tables
     that later migrations add must be readable too, or the first new table stops
     every backup with "permission denied":

     ```sql
     CREATE ROLE mango_backup LOGIN PASSWORD '<a long random password>';
     GRANT USAGE ON SCHEMA public TO mango_backup;
     GRANT SELECT ON ALL TABLES IN SCHEMA public TO mango_backup;
     GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO mango_backup;
     ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT ON TABLES TO mango_backup;
     ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT ON SEQUENCES TO mango_backup;
     ```
  2. `gpg --quick-generate-key "MandiMangoes backups"` on your own computer, then
     `gpg --armor --export "MandiMangoes backups"`. Keep the private key offline (a
     password manager or a USB stick in a safe), never in GitHub.
  3. In GitHub → **Settings → Secrets and variables → Actions**, add
     `BACKUP_DATABASE_URL` and `BACKUP_GPG_PUBLIC_KEY`. Run the workflow once by hand.
  4. **Heartbeat, so a missed backup is noticed.** The workflow's last step records each
     backup in the app (`ops/backup-heartbeat.sh`). In the SQL editor on `main`, make a
     role that can write only that record and read nothing else:

     ```sql
     CREATE ROLE mango_backup_beat LOGIN PASSWORD '<a long random password>';
     GRANT USAGE ON SCHEMA public TO mango_backup_beat;
     GRANT SELECT (step), INSERT (step, last_ok_at, last_err_at, last_error),
           UPDATE (last_ok_at, last_err_at, last_error) ON maintenance_runs TO mango_backup_beat;
     ```

     Add its connection string (pooled is fine) as the secret
     `BACKUP_HEARTBEAT_DATABASE_URL`, run the workflow once by hand, then set
     `BACKUP_HEARTBEAT_EXPECTED=true` on `mandi-api` (Production) and **redeploy**
     the current production deployment (Deployments → ⋯ → Redeploy): a changed
     variable reaches only deployments made after the change. From then on the
     panel's Needs attention card and Sentry warn when no backup has succeeded for 26
     hours: a failing run, missing secrets, or GitHub pausing the schedule (it stops
     scheduled workflows in a repository with no activity for 60 days, as can happen
     off-season).
  Prove a copy loads with `ops/restore-check.sh` after `gpg --decrypt`.
- **Personal data in backups.** Dumps hold names, phones and addresses, which is why they
  are encrypted and kept only 30 days. A deleted account can still be inside an older
  copy; after any restore, run `ops/reapply-deletions.js` (see Rolling back) so it is
  deleted again.

## Load test

`mango-api/ops/load/shop.js` is a [k6](https://k6.io) script. Run the browse
scenario against staging, and the checkout spike (50 buyers at once) against a
local copy, before the season opens. The top of the file has the commands and
the pass marks; [LOAD-TEST.md](LOAD-TEST.md) covers all five scenarios.

## Go-live checks

- [ ] `npm run preflight -- --online` shows no errors, on production and on a preview.
- [ ] Razorpay test webhooks sent to the staging API confirm orders: pay a test order in
      the staging shop, then in Razorpay → **Webhooks** check the delivery shows 200.
- [ ] The k6 browse scenario passes against staging (`ops/load/shop.js`).
- [ ] The Sentry alert rule (level warning or above), the Sentry cron monitor alert and the
      Better Stack Uptime monitor on `/ready` are set up ("Watch it"), and each has reached a
      named person once in a test.
- [ ] `OPS_ALERTS` is unset or `true` on production (preflight warns when it is `false`).
- [ ] Neon's history (restore) window is set to 7 days, not the 1-day default (step 1.5).
      Set on: _date_.
- [ ] `mango_app` has `jit = off` and no UPDATE, DELETE or TRUNCATE on `batch_ledger`
      (step 1.3; the two checks there).
- [ ] One restore drill done on a Neon branch, with the time it took written down.
- [ ] The nightly backup workflow ran once and its artifact decrypts; its heartbeat is
      recorded and `BACKUP_HEARTBEAT_EXPECTED=true` is set (Backups, step 4).
- [ ] Turnstile keys set; deployment protection on for previews.
- [ ] `https://api.mandimangoes.in/ready` returns `{"ready":true,...}`.
- [ ] Sign in to the panel as the bootstrap manager, set up two-step, then remove
      `ADMIN_BOOTSTRAP_*`.
- [ ] Add staff on the Staff page; add pincodes, slots and the first batch.
- [ ] Place one real order with a live card or UPI, then cancel it and see the
      refund arrive.
- [ ] Get the privacy notice at `/privacy` reviewed by a lawyer before launch.

## Refunds the system sends on its own

The owner's rule is that money goes back only when a customer cancels before packing,
or a manager cancels an order or booking we can't deliver. Besides those two, the
API refunds in these cases, because the payment bought nothing:

- **A second payment** for an order or booking that is already paid (two tabs, a
  retried link): that payment alone is refunded (`duplicate_payments`); the order
  stays as it is.
- **A rejected capture**: a payment that is short, in another currency or has no
  amount confirms nothing and is refunded in full (also via `duplicate_payments`),
  and is listed in Needs attention.
- **A payment after a cancel**: a payment that lands after the customer or the shop
  cancelled is refunded, not used to revive the order.
- **After a restore, `ops/replay-payments.js --refund-missing`**: captured payments
  whose order the restore lost are refunded in full. Without the flag they are only
  listed.

Every refund is leased and looked up at Razorpay before it is sent, so it is never
paid twice; each new attempt carries a new receipt (`<number>-r<attempt>`).
Refunds are sent after the webhook is answered; one that fails is sent again by
the maintenance job after 2, 4, 8, 16, 32 and then 60 minutes, 8 attempts at most,
then left for a manager ("Refund failed: needs a manager"). One stuck for 30
minutes shows in Needs attention (docs/order-states.md).

## Rolling back

- **Code:** Vercel → the project → **Deployments**, pick the last good one,
  **Promote to Production**. It takes seconds, and the data stays as it is. Migrations
  only add, so older code runs fine on the newer schema.
- **Data: roll forward first.** A bad change to some rows (a wrong price, a bulk
  reschedule on the wrong day) is fixed with a new change: correct the rows, or deploy
  a fix. This loses nothing.
- **Restoring the database is the last resort.** It throws away every order, payment
  and deletion since the restore point, while Razorpay keeps the money. Only restore
  when the data can't be repaired, and then always do all of this:
  1. Neon → **Branches → main → Restore** to a time before the problem. Neon keeps the
     state just before the restore as a backup branch; don't delete it yet.
     Straight away, before the shop takes an order, move the order, booking, gift,
     subscription, help request and bill numbers past every number handed out before
     the restore, so none is used twice (customer messages, Razorpay receipts, GST bills):
     `node --env-file=.env ops/bump-sequences.js --old-url <backup branch URL>`
     (no backup branch, as after restoring an off-Neon copy: `--margin 1000`; this
     leaves a gap in this year's bill numbers, so note the restore in the bill register).
  2. Bring back the payments taken since the restore point (applied as the webhook
     would; lost orders are listed in Needs attention):
     `node --env-file=.env ops/replay-payments.js --from <restore point>`.
     Rebuild lost orders by hand where you can, or re-run with `--refund-missing` to
     refund them in full, and tell those customers. The replay also lists (in Needs
     attention, as a Razorpay webhook problem) every order Razorpay refunded after the
     restore point that the restored database still shows as paid: check those
     before they are delivered. It reads Razorpay's refund list for the window
     (`GET /v1/refunds?from=&to=`).
  3. Delete again the accounts deleted since then:
     `node --env-file=.env ops/reapply-deletions.js --old-url <backup branch URL> --since <restore point>`.
  4. Check the panel's Needs attention card, then delete the backup branch.
