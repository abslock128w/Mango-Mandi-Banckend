# Mango Mandi / VMR Mangoes — Security, Reliability and Business-Risk Audit

- Date: 2026-11-23
- Branch: `claude/retire-customer-app`
- Commit: `e2abdc3` (CI: clear three lint errors and a racing pre-order plan test)
- Scope: `mango-api/` (API, migrations, tests), `src/` (admin panel), `shop/` (static storefront), `rider-app/`, `shared/`, `deploy/`, `docs/`, `.github/workflows/`, and the fork's divergence from upstream `farm-src/main` (merge-base `eaf6b20`, upstream tip `96be28c`).
- **Audit only, nothing changed.** No file in the repo other than this one was created, modified or deleted; no database, deployed service, secret or workflow was touched.

**Method.** Five specialist auditors read the code, migrations and tests directly (not only the docs) and wrote one report per area group; the main reviewer spot-verified every P0 and P1 claim against the source and marked duplicates. Upstream (`farm-src`) was fetched read-only and compared with `git log`/`git diff`; nothing was merged. Local checks were run by the reviewer (typecheck, lint, shop syntax check, panel unit tests, knip). The API test suite (`mango-api/test`, node:test against a real Postgres) was read but not run, because no Postgres or Docker exists on the audit machine; CI logs for runs 45155077756 and 45161320834 and the nightly Backup workflow runs were consulted instead. Anything that could not be confirmed from code, tests or logs is marked UNVERIFIED.

---

## 1. Executive summary

**Overall score: 5.5 / 10.** The money and stock core (guarded stock take, DB oversell check, signed and deduplicated webhooks, refund claims, step-up, role snapshot tests) is solid and well tested, but as shipped the fork runs its safety-net job once a day, has never taken an off-Neon backup, and nothing in the app noticed either.

**Top 5 risks**

1. **CRON-01** The maintenance job is configured to run once a day (`mango-api/vercel.json:22` `"30 21 * * *"`), and the 5-minute ping workflow is not on the default branch and exits 0 without secrets.
   Business consequence: missed refunds, payments whose webhook was lost, WhatsApp/SMS, bills and health alerts can wait up to 24 hours in peak season.
2. **BKP-01** Zero off-Neon backups exist: the nightly Backup workflow failed every night 2026-11-17 to 2026-11-23 because its two secrets are empty.
   Business consequence: if Neon loses the project or a mistake is found after the PITR window, every order, payment record and 8-year tax bill is gone.
3. **BKP-02** Nothing in the app noticed 7+ nights without a backup (`BACKUP_HEARTBEAT_EXPECTED` defaults `'false'`, `mango-api/src/env.js:459-462`).
   Business consequence: the owner believes backups exist until the day one is needed.
4. **STOCK-01** The shop sends a fresh Idempotency-Key on every checkout confirm and pre-order call (`shop/api.js:41,106,115`), so the server's safe-retry path never fires.
   Business consequence: a dropped reply on a weak mobile connection turns into a stuck unpaid order, held boxes and a lost sale (no double charge).
5. **AUTH-01** Bulk and farm-visit enquiry forms send a WhatsApp message to any typed number with no Turnstile (`mango-api/src/bulk-enquiry-routes.js:68-73,95-100`).
   Business consequence: a bot can make the shop's WhatsApp number message thousands of strangers, costing money and damaging the Meta quality rating that login codes may depend on.

**What is already strong.** Stock cannot be oversold: a guarded `UPDATE ... WHERE ... >= qty` (`mango-api/src/inventory.js:233-234`) is backed by the `batch_lines_no_oversell` CHECK (`mango-api/migrations/001_init.sql:54-60`) and proven by race tests. Razorpay webhooks are HMAC-checked on the raw body before any DB work, stored first, deduplicated in the same transaction and replayed; every capture path checks amount and currency in paise. Refunds use a claim row, back-off, gateway lookup before posting, and a give-up queue for a manager. Authorization is enforced by snapshot tests over every route (458 routes) and every role, with step-up on 31 money or irreversible routes. Production preflight refuses demo payments, demo OTPs, dev routes, weak secrets and insecure cookies at both build and cold start, and no secret has ever been committed in 687 revisions.

---

## 2. Architecture map

**Modules**

- `mango-api/`: Node 24 ESM Express API on Vercel serverless (`api/index.js` → `src/app.js` → `src/env.js`), Postgres via `pg` (Neon, pooled), Razorpay, WhatsApp/SMS, Vercel Blob for photos; `vercel-build` runs `migrate.js` then `seed.js`.
- `mango-api/migrations/`: 88 numbered SQL migrations, checksummed in `schema_migrations`, one transaction per file; `migrations-pending/` holds one unapplied file.
- `mango-api/ops/`: backup, heartbeat, restore-check, restore-drill, sequence bump, payment replay, deletion re-apply scripts.
- `mango-api/test/`: ~117 node:test files (~1,412 tests) that need a real Postgres; `test/contract/*` for idempotency contracts.
- `src/`: admin panel (Vite, React, TypeScript), including Needs attention (`src/pages/NeedsAttention.tsx`).
- `shop/`: buildless static storefront (31 JS files, service worker `shop/sw.js`, CSP in `shop/vercel.json`); replaced `customer-app/` (removed on this branch).
- `rider-app/`: Next.js rider app with an IndexedDB job queue (`rider-app/lib/queue.ts`) and its own Playwright e2e folder.
- `shared/`: shared modules, including `shared/error-reports/` (used by the panel, not by the shop).
- `deploy/`: runbooks (`VERCEL.md`, `SCHEDULER.md`, `RESTORE-DRILL.md`, `GO-LIVE.md`, `RAZORPAY-SANDBOX.md`).
- `docs/`: feature and audit notes.
- `.github/workflows/`: `ci.yml` (build-and-test, api, previous-release-on-new-schema, e2e, production-images), `backup.yml` (nightly), `deploy.yml`, `maintenance-ping.yml` (this branch only).

**Checkout and payment data flow** (from report B's trace)

1. Razorpay webhook route is mounted on `express.raw` at `mango-api/src/app.js:181`, before `express.json` at `:269`; `/v1` goes to the customer router at `app.js:309`.
2. `POST /v1/checkout/quote` (`mango-api/src/customer.js:976`) runs one `tx()` with no row locks: reads `availability()` (`:992`), unlocked capacity check (`:1035`, `{lock:false}`), promo check, and the server-side delivery fee from pincode plus optional map pin (`:1042`, `deliveryFor`).
3. The quote snapshot is stored in `quotes` and expires after `quoteMinutes` (default 5, `mango-api/src/config.js:171`; `customer.js:1053`).
4. `POST /v1/checkout/confirm` (`customer.js:1214`) requires an Idempotency-Key, stored as `${customerId}:${rawKey}` (`customer.js:1234`); a replay compares the sha256 of the body (`replayFor`, `:1190`) and returns 422 on a different body.
5. Inside one `tx()`: the key is claimed with `INSERT ... ON CONFLICT DO NOTHING` (`customer.js:1249`), the quote is locked `FOR UPDATE`, bulk lines are repriced, and `checkUnpaidLimit` locks the customer row (`mango-api/src/orders.js:226`).
6. Backorder availability is read unlocked (`customer.js:1270`), the promo is re-applied `FOR UPDATE`, then `createOrder` is called.
7. `createOrder` (`orders.js:158`) takes the day capacity lock, lazily sweeps expired holds on the same boxes (`:197`), locks SKU lines (`:201`) and allocates into `batch_lines.held` and `order_stock(state='held')`; with `allOrNothing` a shortfall throws `StockError` (`:206`) and the whole transaction rolls back. The guarded take is `inventory.js:233-234`.
8. At the end of the confirm transaction the quote and cart are deleted (`customer.js:1310-1311`).
9. After commit, `startPayment` creates the Razorpay order for `order.total` (`mango-api/src/payments.js:69`) and stores it `WHERE razorpay_order_id IS NULL`; on gateway failure the order is abandoned and the key deleted. A same-key retry gets PAYMENT_STARTING / recovery (`customer.js:1238-1243`).
10. Webhook: `razorpaySigned` (`app.js:176-179`) checks HMAC-SHA256 with `timingSafeEqual` (`payments.js:152-155`); `storeWebhookEvent` stores first (`mango-api/src/webhook-events.js:33`); `routeWebhook` (`payments.js:359`) inserts `processed_webhooks` (`:374`) in the same transaction; `findOrderId` trusts only Razorpay's own ids (`:187`); `checkCapture` requires INR and `amount === total` in paise (`:273`).
11. `processPayment` (`orders.js:529`) locks the order then its lines in order and moves held → committed; a late payment is re-allocated or moved to the next date with stock. In parallel the shop's Razorpay handler calls `verify-payment` (`customer.js:1615`), which checks the Checkout HMAC (`payments.js:175-178`) and asks Razorpay via `reconcileOrderNow`.
12. Safety net: `reconcilePendingPayments` (`payments.js:711`) each maintenance run, `reconcileRecentPayments` daily over 3 days (`payments.js:1312`), stored-webhook replay after 5 minutes up to 5 times (`webhook-events.js:20-22`); expired holds are swept after reconcile (`mango-api/src/maintenance.js:393,396`), with a 2-minute grace on the lazy path (`orders.js:1436`).
13. Refunds: `claimRefund` (`payments.js:903`) takes a 2-minute claim with doubling back-off to 60 minutes, `REFUND_MAX_ATTEMPTS = 8`, and `gatewayRefund` lists existing refunds at Razorpay before posting only what is still owed (`payments.js:1042-1062`).

**Maintenance job**

- As shipped: `mango-api/vercel.json:22` `"schedule": "30 21 * * *"` (once a day, 03:00 IST); `.github/workflows/maintenance-ping.yml:19` `*/5 * * * *` exists only on this branch (GitHub runs schedules only from the default branch) and exits 0 when `MAINTENANCE_URL`/`CRON_SECRET` are unset (`:38-41`).
- As documented: `deploy/SCHEDULER.md:14` "Production runs on Vercel Pro and uses Vercel's own every-minute cron"; `mango-api/src/maintenance.js:1` "Maintenance, once a minute"; Sentry monitor expects `* * * * *` (`mango-api/src/sentry.js:101`); `/ready` goes stale after 240 s (`mango-api/src/readiness.js:10`).
- Guarded by a lease row (`maintenance.js:144-153`, 65 s), a 45 s budget under `maxDuration` 60 (`maintenance.js:59`, `vercel.json:9`) and a constant-time cron secret that fails closed (`app.js:148-151`).

---

## 3. Findings table

| ID | Sev | Area | Title | Evidence (file:line) | Smallest fix (≤12 words) |
|---|---|---|---|---|---|
| CRON-01 | P0 (P1 only if owner confirms Vercel Pro with every-minute cron set in the dashboard) | 6 Background / 7 Prod safety | Maintenance job runs once a day as shipped | mango-api/vercel.json:22; .github/workflows/maintenance-ping.yml:19,38-41; deploy/SCHEDULER.md:14 | Every-minute cron on Pro, or ping workflow on main failing without secrets |
| BKP-01 | P0 | 9 DR | Zero off-Neon backups exist on the fork | .github/workflows/backup.yml:54-56; runs 44227102786 … 45096932075 | Owner sets backup secrets, runs workflow, records one restore-check |
| BKP-02 | P0 | 9 DR / 6 Background | Nothing in the app noticed 7+ days without a backup | mango-api/src/env.js:459-462; mango-api/src/maintenance.js:596; backup.yml:92 | Preflight errors in production unless BACKUP_HEARTBEAT_EXPECTED is true |
| STOCK-01 | P1 | 2 Stock / 8 Tests | Shop sends a new Idempotency-Key on every confirm and pre-order call | shop/api.js:41,106,115; shop/app.js:129; mango-api/src/customer.js:1238-1243 | One key per quote in pay(), reused on retry |
| SHOP-01 | P1 | 1 Fork / 10 Leaks | Shop errors are never reported; no error hook or boundary | shop/api.js:26; shop/vercel.json:30,55 (connect-src) | onerror/unhandledrejection reporter behind DSN; add ingest host to CSP |
| AUTH-02 | P1 | 4 Auth | Tokens carry no environment claim; preview tokens may work on production | mango-api/src/auth.js:26,135; mango-api/src/preflight.js:81-85 | Sign and verify audience = deployEnv |
| AUTH-01 | P1 | 4 Auth | Bulk and farm-visit enquiry forms message any typed number, no Turnstile | mango-api/src/bulk-enquiry-routes.js:68-73,95-100; mango-api/src/bulk-enquiries.js:228 | requireHuman in both handlers plus a shop-wide daily cap |
| AREA7-02 | P1 | 7 Prod safety | Razorpay test key in production is only a warning | mango-api/src/preflight.js:57 | Error unless ALLOW_TEST_PAYMENTS_IN_PRODUCTION=true |
| STOCK-02 | P1 (owner decision) | 2 Stock | Paid bulk orders accept payment with no stock, season or plan check | mango-api/src/bulk-orders.js:126; mango-api/src/bulk-enquiries.js:88 | Per-order or per-week kg ceiling in createBulkOrder |
| LEAK-03 | P1 | 10 Leaks | No customer reschedule or address change in the shop | mango-api/src/customer.js:1655 (route unused by shop) | "Change delivery day" button on order page using existing route |
| LEAK-01 | P1 | 10 Leaks | Help page complaints have no server record by default | mango-api/src/env.js:173; shop/help.js:90 | HELP_CENTRE=true and prefill the order number |
| LEAK-02 | P1 | 10 Leaks | Back-in-stock alerts lost in the shop rebuild | shop/shelf.js:120; mango-api/src/customer.js:646 | "Tell me when it's back" button posting /v1/stock-alerts |
| TEST-01 | P1 | 8 Tests | Customer journey e2e against the real API deleted, nothing replaced it | ci.yml (diff main...HEAD); package.json:22 | Add tests/shop-journey.spec.ts to the e2e job |
| BKP-03 | P1 | 9 DR | Delivery-proof, claim, review and product photos have no backup | deploy/VERCEL.md:408-412; deploy/GO-LIVE.md:25; mango-api/src/delivery-proof.js:145-147 | Weekly Blob sync into backup, or owner records acceptance |
| BKP-04 | P1 | 9 DR | Only backup copy is a 30-day artifact in the same GitHub repo | .github/workflows/backup.yml:75-81 | Set BACKUP_UPLOAD_CMD to separate object-locked bucket, monthly long copies |
| SRV-02 | P1 | 6 Background | Stopped-job alarms do not match the real schedule | mango-api/src/sentry.js:101; mango-api/src/readiness.js:10; maintenance-ping.yml:19 | One expected-interval setting feeding monitor and stale threshold |
| AREA1-02 | P1 | 1 Fork | Shop privacy text omits that bills keep name and address 8 years | shop/help.js:63; mango-api/src/privacy.js:54 | Restore the 8-year bill and 12-month PII sentences |
| AREA1-01 | P1 | 1 Fork / 5 DB | Migration filename collision with upstream 052/053 | mango-api/src/migrate.js:89-90,113-114; mango-api/migrations/058_partner_network.sql:15 | Refuse to start when schema_migrations has a version without file |
| PAY-02 | P2 (P1 if staff refund by hand) | 3 Payments | Daily check does not flag a hand-made dashboard refund on a paid order | mango-api/src/payments.js:1312-1332,1501 | Call flagGatewayRefunds at end of reconcileRecentPayments |
| STOCK-04 | P2 | 2 Stock | Scheduled sweep ignores the PAY-B5 grace | mango-api/src/orders.js:1341 vs :1442-1443 | Add reconcile_checked_at grace clause to EXPIRED_HOLDS |
| AUTH-04 | P2 | 4 Auth | Some money-moving or irreversible manager actions have no step-up | mango-api/src/admin/recovery.js:138-152; mango-api/src/admin/partner.js:190-196; preorders move | stepUp(req,{always:true}) in both txs; list in policy.js |
| AUTH-03 | P2 | 4 Auth | Bulk enquiries matched by typed phone; a typo exposes the quote | mango-api/src/bulk-enquiries.js:363; mango-api/src/bulk-orders.js:82 | Phone match for reading only; customer_id for respond/pay/cancel |
| DB-03 | P2 | 5 DB | No product name snapshot on order lines; late bills use live names | mango-api/src/bills.js:198-200; mango-api/src/customer.js:1566 | Add order_items.product_name at insert; COALESCE in bills |
| SRV-04 | P2 | 6 Background | Each instance caches prices up to 60 s | mango-api/src/app.js:33; mango-api/src/customer.js:1010 | Read price and sellability inside the checkout tx |
| STOCK-03 | P2 | 2 Stock | Delivery address is free text, never tied to the quoted pincode | mango-api/src/customer.js:1223,1042 | Refuse address containing a different 6-digit pincode |
| LEAK-07 | P2 | 10 Leaks | Refused rider photo dropped silently | rider-app/lib/queue.ts:182 | Keep blob, show "Upload refused, retake", tag jobs with rider id |
| DB-04 | P2 | 5 DB | Migrations fall back silently to the pooled URL | mango-api/src/migrate.js:34,102 | Throw on Vercel without DATABASE_URL_UNPOOLED |
| AREA7-03 | P2 | 7 Prod safety | TOTP secrets may be stored unencrypted in production | mango-api/src/preflight.js:143 | Error in production when TOTP_ENCRYPTION_KEY is missing |
| PAY-01 | P2 | 3 Payments | A missing currency passes the capture check | mango-api/src/payments.js:286 | Change condition to currency !== 'INR' |
| PAY-03 | P2 | 3 Payments | Needs attention shows a refund button the server refuses | mango-api/src/admin/reports.js:177-179; mango-api/src/payments.js:1413 | Check the same seven tables as knownPayment |
| DB-02 | P2 | 5 DB | Linking a phone fails for Google-only account with stock alert | mango-api/src/customer.js:907,879-906 | Move or delete stock_alerts in the account merge |
| DB-01 | P2 | 5 DB | Two farm queries use UTC days instead of IST days | mango-api/src/farm/staff.js:30-31,140; mango-api/src/farm/settings.js:158 | Use AT TIME ZONE 'Asia/Kolkata' and todayIST() |
| DB-06 | P2 | 5 DB | Pending migration reuses number 056; plaintext delivery codes still read | mango-api/migrations-pending/056_drop_delivery_code.sql; mango-api/src/delivery-code.js:41 | Run hashing script, remove reads, ship as 089 |
| AUTH-05 | P2 | 4 Auth | Customer refresh replayed inside grace gets a new independent session | mango-api/src/auth.js:73-74 | In grace return only an access token, as for staff |
| AUTH-06 | P2 | 4 Auth | RIDER_ORIGIN trusted by CORS but not checked by preflight | mango-api/src/app.js:82-83; mango-api/src/preflight.js:90 | Add RIDER_ORIGIN to the https/no-localhost check |
| LEAK-08 | P2 | 10 Leaks | No prefilled WhatsApp link when enquiries are switched off | shop/pages.js:800; shop/bulk.js:392 | Render existing bulkWhatsApp(text) with the form contents |
| LEAK-04 | P2 | 10 Leaks | Favourites are device-only | shop/shelf.js:464-467 | When signed in, call /me/favourites and /merge |
| LEAK-05 | P2 | 10 Leaks | No funnel or abandoned-checkout signal | mango-api/src/growth-routes.js:39; mango-api/src/customer.js:1230 | Small track(step) in shop/api.js |
| BKP-05 | P2 | 9 DR | RTO never measured; Neon PITR window unknown | deploy/RESTORE-DRILL.md:12; deploy/VERCEL.md:485 | Owner runs ops/restore-drill.sh once, records minutes and window |
| AREA1-06 | P2 | 1 Fork | Production shop CSP allows the staging API host | shop/vercel.json:30,55 | Write API origin into CSP per environment at build |
| AREA1-07 | P2 | 1 Fork | Shop vercel.json hard-codes the staging API as the /v1 proxy target | shop/vercel.json:87-89; shop/build-config.mjs:117-120 | Write the /v1 rewrite per environment, or remove it when API_VIA_SHOP is off |
| AREA1-04 | P2 | 1 Fork | Hindi/Kannada lost; docs and CI still say they exist | shop/index.html:2; mango-api/src/customer.js:483-484; ci.yml:246-247 | Document English-only and drop SHOP_LANGUAGES, or rebuild i18n |
| AREA1-05 | P2 | 1 Fork / 8 Tests | shop:test syntax-checks 15 of 31 JS files | package.json:22 | Loop node --check over every shop/*.js |
| DB-05 | P2 | 5 DB | Every preview build migrates the single shared staging database | mango-api/package.json (vercel-build); deploy/VERCEL.md:39,95 | Migrate previews only for the staging ref, or document |
| SRV-05 | P2 | 6 Background | Panel live-event LISTEN uses owner role or pooler | mango-api/src/events.js:85 | Separate app-role LISTEN URL; poll when only pooler exists |
| AREA7-04 | P2 | 7 Prod safety | .gitignore lacks .env.* and *.pem | .gitignore:3,10,16 | Add .env.*, !.env.example, *.pem, *.key |
| TEST-03 | P2 | 8 Tests | e2abdc3 widened the pre-order assertion, not the race | mango-api/test/preorder-plan.test.js:279-286 | Assert [2002,2004].includes(...); split deterministic cases |
| TEST-08 | P2 | 8 Tests | Panel unit test fails: 'partner-retention' step has no label | tests/unit/step-labels.unit.ts:19; src/pages/NeedsAttention.tsx:11; mango-api/src/maintenance.js:471 | Add 'partner-retention' to STEP_LABEL |
| TEST-05 | P2 | 8 Tests | Recorded Razorpay replay skipped forever; restore stubbed | mango-api/test/razorpay-fixtures.test.js:56; mango-api/test/backup.test.js | Record sandbox fixtures; one CI step with real pg_restore |
| TEST-04 | P2 | 8 Tests | Rider e2e never runs in CI | rider-app/playwright.config.ts:9 | Run npm --prefix rider-app run e2e in build-and-test |
| TEST-06 | P2 | 8 Tests | Timing assertions that could flake | mango-api/test/audit-b-security.test.js:79; pay-fixes.test.js:287 | Loosen or remove wall-clock assertions |
| TEST-07 | P2 | 8 Tests | API suite slow: full reset plus 88 migrations per reset | mango-api/test/helpers.js:21-30 | Migrate once into a template DB, clone per reset |
| PAY-04 | P2 | 3 Payments | Leftover amount-mismatch warning after confirm | mango-api/src/orders.js:629 | Remove the warning or throw |
| HYG-01 | P2 | Hygiene | knip reports seven unused exports | mango-api/src/bulk-enquiries.js:30; bulk-orders.js:43; events.js:47,230; farm/bookings.js:327; preorders.js:78; season-phase.js:10 | Drop the export keyword or delete dead code |

Counts: **P0 3, P1 15, P2 35** (53 findings).

---

## 4. Detailed findings

### 4.1 Fork vs upstream

**How it works**

- Merge-base `eaf6b20`. The fork has 206 commits since; upstream (`farm-src/main`, tip `96be28c`) has 30 commits not in HEAD, all Partner Network (`3730749..96be28c`, PR #26).
- The fork already holds that feature, squashed in `83a0aaf`; upstream migrations `052_partner_network` and `053_validate_partner_checks` were renumbered to `058_partner_network.sql` and `059_...`, and the fork added `partner/erase.js`, `069_partner_erasure.sql`, a manager erase route and a `/partner/privacy` page.
- Over `mango-api/src`, upstream is a strict subset of the fork (only an unused `MANAGER_ACTIONS` export in `partner/staff.js` differs). Upstream changes already present: `app.js:84-85` (X-Upload-Token), `env.js:188-200` (PARTNER_NETWORK, WHATSAPP_PARTNER_UPDATES, PARTNER_ALERT_PHONES), `admin/policy.js:54`, `customer.js:56,477`, `turnstile.js:27`, `maintenance.js:425-426`.
- 61 files changed on both sides; see Appendix B for the conflict list.
- **Recommendation: do not merge upstream.** The fork already contains everything in upstream mango-api; cherry-pick individual commits only if ever needed.
- `customer-app/` (old Next.js shop) was removed on this branch and replaced by the buildless `shop/`. Several behaviours the old app had were not carried over; those are findings below and in 4.10.

**AREA1-01 | P1 | Migration filename collision with upstream (052/053)**

- Evidence: upstream `migrations/052_partner_network.sql` and `053_validate_partner_checks.sql` vs fork `052_demo_seed_runs.sql`, `053_rider_app.sql`; fork's partner tables at `mango-api/migrations/058_partner_network.sql:15` `CREATE TABLE partnership_categories (` (no `IF NOT EXISTS`). `mango-api/src/migrate.js:113` `checkApplied(applied, sums)` only looks at files present in the repo (`migrate.js:89-90`), and `:114` `for (const file of files) {` skips by filename, so an upstream-only applied row is ignored silently.
- Why it matters: any database ever migrated by upstream code fails at 058 with "relation already exists" and blocks every Vercel build, because `vercel-build` runs the migrations.
- Smallest fix: never merge upstream's 052/053; in `migrate.js` refuse to start when `schema_migrations` holds a version with no matching file.
- Test that proves it: `mango-api/test/migrations.test.js`: insert a `052_partner_network.sql` row, expect a named refusal.
- UNVERIFIED: whether any shared database was ever migrated by upstream code (decides live vs latent).

**AREA1-02 | P1 | Shop privacy text omits that bills keep name and address for 8 years**

- Evidence: `shop/help.js:63` "Your name, number, email and addresses are removed and your bag is emptied. The amounts of past orders are kept," (continues "without your details"). Code keeps bills 96 months (`env.js` `BILL_RETENTION_MONTHS` default 96; `mango-api/src/privacy.js:54` "Bills are not touched: tax law needs"; `docs/trust.md:112`). Upstream `customer-app/src/i18n/en.ts:407` and `Privacy.tsx:52` disclosed it.
- Why it matters: a misleading privacy notice under DPDP; it also omits the 12-month PII retention (`PII_RETENTION_MONTHS`).
- Smallest fix: restore the two sentences in `shop/help.js` `#your-information`.
- Test that proves it: a node unit test reading `shop/help.js` asserts the text contains "8 years" and "12 months".

**AREA1-04 | P2 | Hindi/Kannada lost; docs and CI still say they exist**

- Evidence: upstream had `customer-app/src/i18n/{en,hi,kn}.ts` and `tests/languages.spec.ts`; `shop/` has no translations (`lang=` only at `shop/index.html:2`); the API still serves `features.languages` (`mango-api/src/customer.js:483-484`); `ci.yml:246-247` sets `SHOP_LANGUAGES 'true'`; `docs/languages.md` describes the feature.
- Why it matters: customers who used Hindi or Kannada now get English only, and the docs say otherwise.
- Smallest fix: document English-only and drop `SHOP_LANGUAGES` from `ci.yml`, or rebuild i18n (owner decision).
- Test that proves it: if rebuilt, a shop spec switching language; if dropped, a CI grep that `SHOP_LANGUAGES` is gone.

**AREA1-05 | P2 | shop:test syntax-checks 15 of 31 JS files; no shop a11y or behaviour tests**

- Evidence: `package.json:22` `"shop:test": "node --check shop/theme.js && node --check shop/catalog.js && ..."` (15 files). Skipped: bulk, claims, config, deco, fifty, fly, gift-bag, gifts, help-requests, help, home, install, journey, phone-search, reorder, suggest. Upstream had `customer-app/tests` a11y.spec.ts, checkout.ts, payments.spec.ts, sw.unit.ts and 15+ specs. Only shop coverage now: `tests/csp.spec.ts:61-68` (static) and `mango-api/test/shop-payments.test.js` (API side).
- Why it matters: a syntax error in `gifts.js` or `help.js` ships unnoticed, and `sw.js` caches it on customers' phones.
- Smallest fix: loop `node --check` over every `shop/*.js`.
- Test that proves it: a deliberately broken `help.js` must fail CI.

**AREA1-06 | P2 | Production shop CSP allows the staging API host**

- Evidence: `shop/vercel.json:30` and `:55` (the `Content-Security-Policy` values whose keys are at `:29` and `:54`) include `https://mandi-api-staging.vercel.app` in `connect-src` (added in `8d8852f`).
- Why it matters: the production shop is allowed to talk to staging; a mistaken config would not be stopped by CSP.
- Smallest fix: write the API origin into CSP per environment from `build-config.mjs`, or accept.
- Test that proves it: extend `tests/csp.spec.ts` to assert the production CSP has only the production API host.

SHOP-01 (no shop error reporting; was AREA1-03 here) is written up in full in 4.10.

**AREA1-07 | P2 | Shop vercel.json hard-codes the staging API as the /v1 proxy target** (reviewer addendum)
- Evidence: `shop/vercel.json:87-89` `{"source": "/v1/:path*", "destination": "https://mandi-api-staging.vercel.app/v1/:path*"}` (added in 5866ce6). `shop/build-config.mjs:117-120` compares that destination with `API_URL` only when `API_VIA_SHOP=true`, and fails the build on a mismatch.
- Why it matters: with `API_VIA_SHOP` off (the apparent production setting), `config.js` carries the API origin directly and customers never use the rewrite, but the production shop origin still proxies `/v1/*` to staging for anyone who calls it. With `API_VIA_SHOP` on, every production build fails until the file is hand-edited. Either way the file cannot be deployed as-is to production without a manual step.
- Smallest fix: have `build-config.mjs` write the rewrite destination from `API_URL` (or drop the rewrite when `API_VIA_SHOP` is off), and extend the bundle scan to refuse a staging host in a production build.
- Test that proves it: a unit test in `tests/unit/` that a production build with `API_URL=https://api.mandimangoes.in` produces a vercel.json whose `/v1` rewrite points at the same origin. UNVERIFIED: the production value of `API_VIA_SHOP`.

**Docs vs code**

- `docs/languages.md` describes Hindi/Kannada; the shop has no i18n (`shop/index.html:2`).
- Brief says "per-minute cron"; `mango-api/vercel.json:22` is daily (see CRON-01).

**UNVERIFIED**

- Whether any shared database was ever migrated by upstream code (AREA1-01).

---

### 4.2 Stock and checkout

**How it works**

- Quote (`customer.js:976`) holds no stock and takes no locks; it stores a 5-minute snapshot (`config.js:171`, `customer.js:1053`) with a server-side delivery fee (`customer.js:1042`).
- Confirm (`customer.js:1214`) claims the per-customer Idempotency-Key first (`:1249`), locks the quote `FOR UPDATE`, reprices bulk lines, locks the customer row (`orders.js:226`), re-applies the promo under lock, and calls `createOrder`.
- `createOrder` (`orders.js:158`) takes the day lock, lazily sweeps expired holds (`:197`), locks SKU lines (`:201`), and allocates with the guarded take `inventory.js:233-234`; a shortfall throws `StockError` (`:206`) and rolls back everything.
- Quote and cart are deleted at the end of the transaction (`customer.js:1310-1311`), so a quote is single-use.
- `startPayment` runs after commit (`payments.js:69`); `processPayment` (`orders.js:529`) moves held → committed.
- Expiry: maintenance runs `reconcile` (`maintenance.js:393`) before `sweep` (`:396`); the lazy sweep waits for a reconcile or 2 minutes before cancelling an order that has a Razorpay order (`orders.js:1436`).
- Planned orders and pre-orders hold no stock; they take week kg via `takePlanKg` (`plan-kg.js:38`) and `reserve` (`preorders.js:266`) with conditional upserts re-checked under row lock and `CHECK (planned_kg >= 0)`.
- Paid bulk orders (migration 084): `createBulkOrder` (`bulk-orders.js:107`) prices server-side from the catalogue but holds and checks no stock.

**STOCK-01 | P1 | The shop sends a new Idempotency-Key on every confirm and pre-order call** (merged with TEST-02)

- Evidence: `shop/api.js:41` `const idem=()=>({'Idempotency-Key':window.crypto&&crypto.randomUUID?crypto.randomUUID():...})`; `:106` `confirm:body=>auth('/checkout/confirm','POST',body,idem())`; `:115` `bookPreorder:body=>auth('/preorders','POST',body,idem())`; `shop/app.js:129` the `pay()` loop retries `MM.confirm` on PAYMENT_STARTING and QUOTE_EXPIRED with a fresh key each time.
- Why it matters: the server's PAY-B4 recovery (`customer.js:1238-1243`) returns PAYMENT_STARTING only to a same-key replay, so the shop's retry loop never reaches it. If the confirm reply is lost after commit, or the instance died before storing the Razorpay order, the quote and cart are already deleted (`customer.js:1310-1311`): the retry gets QUOTE_EXPIRED, the re-quote has an empty cart, and the next attempt gets UNPAID_ORDER_EXISTS. The customer sees an unpaid order with no Razorpay order to pay, and the boxes stay held until the hold ends (10 minutes). No double charge, but a likely lost sale on a weak mobile connection. Only `maxUnpaidOrders = 1` (`config.js:178`) prevents a second order; it can be set up to 5 (`config.js:88`), at which point this becomes P0.
- Smallest fix: create one key per quote in `pay()` (reset on re-quote) and pass it to `MM.confirm(body, key)`, as `giftConfirm` already does (`shop/api.js:141`; `shop/gifts.js:1109` `gift.key ??= ...`). Same for `bookPreorder`.
- Test that proves it: `mango-api/test/shop-payments.test.js`: confirm commits, then `createGatewayOrder` times out; a retry with the same key after 15 s gets 200 with a `razorpayOrderId`. Plus a static check that `confirm` does not call `idem()` inline, and a shop Playwright spec that aborts the first confirm response with `page.route` and checks the retry lands on the same orderId.

**STOCK-02 | P1 (owner decision) | Paid bulk orders accept payment with no stock, season or plan check**

- Evidence: `mango-api/src/bulk-orders.js:126` `const { lines, kg } = orderLines(b.lines)`; nothing touches `batch_lines` or `preorder_variety_week_kg`; `mango-api/src/bulk-enquiries.js:88` `boxes: ...max(5000)`.
- Why it matters: a customer can pay for tonnes of fruit that do not exist. Customer cancel closes 4 hours after paying, and the business replaces rather than refunds, so the shop is left owing fruit it cannot supply.
- Smallest fix: a per-order or per-week kg ceiling in `createBulkOrder`, or charge `preorder_variety_week_kg` through `takePlanKg`.
- Test that proves it: `mango-api/test/bulk-orders.test.js`: an order over the ceiling gets 409 and no payment link.
- Severity depends on the owner's answer on the ceiling (Question 6).

**STOCK-03 | P2 | Delivery address is free text and never tied to the quoted pincode**

- Evidence: `mango-api/src/customer.js:1223` `address: z.string().trim().min(10, 'Enter the full delivery address').max(500),`; the fee is computed from the quote's pincode and pin (`:1042`); the map pin can only raise distance (`delivery-fee.js:75-76`).
- Why it matters: a customer can be charged the near-pincode delivery fee while typing a far address.
- Smallest fix: refuse an address containing a different 6-digit pincode, or show riders the quoted pincode.
- Test that proves it: `mango-api/test/delivery-fee.test.js`: confirm with an address carrying another pincode → 422.
- Note: report B cited `customer.js:1224`; the address line is `:1223` (`:1224` is `name`).

**STOCK-04 | P2 | The scheduled sweep ignores the PAY-B5 grace**

- Evidence: `mango-api/src/orders.js:1341` ``const EXPIRED_HOLDS = `SELECT id FROM orders WHERE status = 'PAYMENT_PENDING' AND hold_expires_at < $1 ORDER BY at_risk, hold_expires_at LIMIT 200` `` has no `reconcile_checked_at` condition, unlike the lazy path at `:1442-1443`.
- Why it matters: if reconcile runs out of time in a run, a paid order can be cancelled and then confirmed late, possibly on another date. A worse customer experience, not lost money.
- Smallest fix: add the same grace clause to `EXPIRED_HOLDS` for orders with a Razorpay order or payment link.
- Test that proves it: extend the PAY-B5 test in `mango-api/test/pay-fixes.test.js` to cover `sweepExpiredHoldsEach`.

**Not covered by tests:** shop retry with the same key (no shop tests at all); retry with a different key when `maxUnpaidOrders > 1`; parallel `bookPlan` racing for the last kg; bulk-order ceiling; scheduled sweep against an unreconciled paid order.

**Docs vs code**

- The brief and `orders.js:749` say a customer cancel before packing is the only automatic refund. **Correction:** the code also refunds automatically for (a) second payments on the same order (`orders.js:510`), (b) payments landing after a customer or staff cancel (`orders.js:546-553`), (c) captures rejected for amount or currency (`payments.js:295-305`), (d) cancels of orders the shop delayed (`orders.js:713-725`), and (e) bulk-order cancels within 4 hours of paying. All are correct behaviour; the statement "only automatic refund" is wrong.

**UNVERIFIED**

- Whether "Pay for it" in the shop can start a payment for an unpaid order that has no `razorpay_order_id`; no API route was found that creates one outside the confirm replay (bears on STOCK-01's recovery).

---

### 4.3 Payments and webhooks

**How it works**

- Webhook signature: `app.js:181` mounts `express.raw`, then `razorpaySigned` (`app.js:176-179`) runs before any DB work; HMAC-SHA256 with `timingSafeEqual` after a hex-64 shape check (`payments.js:152-155`); the previous secret is accepted during rotation.
- Intake and dedupe: `storeWebhookEvent` stores first (`webhook-events.js:33`, unique `(provider, dedupe_key)`; key = event id or sha256 of body). `routeWebhook` (`payments.js:359`) inserts `processed_webhooks` (`:374`, key = event id or `${kind}:${payment id}`) in the same transaction and marks the intake processed. On failure both roll back; maintenance replays after 5 minutes, at most 5 times (`webhook-events.js:20-22`), then Needs attention.
- Matching: `findOrderId` (`payments.js:187`) trusts only Razorpay's own order id and link id. `checkCapture` (`:273`) requires a payment id, INR and `amount === total` in paise; a rejected payment goes to `webhook_failures` and `duplicate_payments` and is refunded.
- `verify-payment` (`customer.js:1615`): the Razorpay order must match, the Checkout HMAC is checked (`payments.js:175-178`), then `reconcileOrderNow` fetches the payment from Razorpay and applies `checkCapture`.
- Crash recovery: `reconcilePendingPayments` (`payments.js:711`) every maintenance run; daily `reconcileRecentPayments` (PAY-08, `:1312`) over captured payments of the last 3 days, on by default in production (`env.js:542`); an ops notice when a payment was found only by polling (`maintenance.js:530`).
- Refunds: `claimRefund` (`:903`) 2-minute claim with doubling back-off to 60 minutes; `REFUND_MAX_ATTEMPTS = 8`, then left for a manager who can reopen (`admin/recovery.js:365`). `gatewayRefund` lists the payment's existing refunds at Razorpay and sends only what is still owed (`:1042-1062`). The receipt changes each attempt.

**Scenario answers (report B)**

1. Signatures: webhook and Checkout reply both checked; raw body before JSON parsing.
2. Dedupe: dedupe key is the PK (`001_init.sql:215`); same id with another body is a duplicate. A webhook for an unknown order returns 200, records a failure with the payment id (`payments.js:447-450`) and uses up its key; the poll still confirms by Razorpay order id; the manager refund route refuses once matched (`recovery.js:173`). Stale capture after cancel+refund → `already_paid` (same payment id) or `duplicate_payment` with refund (new id) (`orders.js:531-539`). Never re-confirms.
3. Crash between capture and confirm: Razorpay retries, stored event replayed, poll, daily 3-day check, ops alert.
4. Duplicate payment: refunded automatically; order untouched.
5. Refund twice: blocked by the claim, lookup before posting, `duplicate_payments` keyed by `payment_id`, `WHERE refunded_at IS NULL`. No unique constraint on `refund_id`; Razorpay idempotency header not used (receipts change by design).
6. Daily reconciliation compares payments, not settlements. Refunds are compared only in the restore replay.
7. Amount and currency compared in paise and INR (`payments.js:286-288`).

Note: scenario 3's "every minute" depends on CRON-01; as shipped the poll runs once a day.

**PAY-02 | P2 (rises to P1 if staff refund by hand) | Daily check does not flag a refund made by hand in the Razorpay dashboard on an order still shown as paid**

- Evidence: `flagGatewayRefunds` (defined `mango-api/src/payments.js:1259`) is called only from `replayCapturedPayments` at `payments.js:1501` `out.refundedAtGateway = await flagGatewayRefunds(from, to)`, not from `reconcileRecentPayments` (`:1312-1332`).
- Why it matters: if staff refund in the Razorpay dashboard, the order still shows paid and the fruit is delivered free.
- Smallest fix: call `flagGatewayRefunds` at the end of `reconcileRecentPayments` (it is idempotent).
- Test that proves it: the PAY-08 describe in `mango-api/test/audit-a-payments.test.js`: a refund listed at the stubbed gateway on a CONFIRMED order appears in Needs attention after the daily check.
- Note: report B cited `:1500`; the call is at `:1501`.

**PAY-01 | P2 | A missing currency passes the check**

- Evidence: `mango-api/src/payments.js:286` `else if (currency != null && currency !== 'INR') reason = ...`.
- Why it matters: a capture with no currency field is treated as INR; defence in depth only, since Razorpay always sends one.
- Smallest fix: `currency !== 'INR'`.
- Test that proves it: extend `mango-api/test/audit-fixes.test.js:123` with currency omitted → rejected.

**PAY-03 | P2 | Needs attention shows a refund button the server then refuses**

- Evidence: `mango-api/src/admin/reports.js:177-179` checks only `orders`, `preorders`, `duplicate_payments` (`AND NOT EXISTS (SELECT 1 FROM duplicate_payments WHERE payment_id = w.payment_id)) AS refundable`); `knownPayment` (`payments.js:1413`) used by `recovery.js:173` also covers `gift_orders`, `preorder_groups`, `farm_booking_payments`, `bulk_enquiries` and returns PAYMENT_MATCHED.
- Why it matters: staff see a button that fails, and may then refund by hand (feeds PAY-02).
- Smallest fix: check the same seven tables in `reports.js`.
- Test that proves it: `mango-api/test/hardening.test.js:108`: a failure whose payment matches a gift order is listed as not refundable.

**PAY-04 | P2 | Leftover warning after confirm**

- Evidence: `mango-api/src/orders.js:629` `if (amount != null && amount !== o.total) {` logs a warning; real paths reject earlier in `checkCapture`; only dev/demo reach it.
- Why it matters: dead code that suggests mismatches are tolerated.
- Smallest fix: remove it, or throw.
- Test that proves it: existing amount-mismatch tests (`audit-fixes.test.js:107,123,140`) still pass.

**Test coverage (report B)**

- Duplicate webhook: YES (`security-readiness.test.js:453`; `business-invariants.test.js:490`).
- Crash mid-payment: YES (`webhook-intake.test.js:87`; `business-invariants.test.js:595,760,790`).
- Repeated refund: YES (`business-invariants.test.js:618,654,690`; `hardening.test.js:42`; `refund-retries.test.js:110-225`; `pay-fixes.test.js:146-195`).
- Stale webhook replay: PARTIAL (`flow.test.js:396-398` new payment id after refund; same payment id after REFUNDED tested only for gift `gifting.test.js:290-291` and farm `farm-experience.test.js:437`). Add a checkout-order case to `business-invariants` section 2.
- Amount/currency mismatch: YES (`audit-fixes.test.js:107,123,140`; `bulk-orders.test.js:161`).

**Docs vs code**

- Automatic refunds go beyond "customer cancel before packing" (see 4.2).
- Migration 086 `payment_failed_at` is only a UI marker (`orders.js:552`); it triggers no refund.

**UNVERIFIED**

- Whether Razorpay lists a refund straight away after a POST that timed out on our side; the no-double-refund guarantee rests on that, and tests use a stub.
- Whether `PAYMENT_DAILY_RECON` is set in production (defaults on).

---

### 4.4 Authorization, sessions, OTP, CSRF

**How it works**

- Roles MANAGER, OPERATOR, PACKER, QC, RIDER (`access.js:18`); MANAGER everything (`access.js:21,267`); others only LIMITED (`access.js:223-256`); path params must match `ID_SEGMENT` (`access.js:40-41`). Gate order `admin.js:48-54`: signIn, riderAuth, warehouseGate, then requireAdmin, needsSetupFirst, watchRefusals, limitByRole, riderScope, auditStaffChanges.
- Coverage: `auth-matrix.test.js:40-58` walks every route against `test/fixtures/role-policy.json` and calls every route with every role (`:196-209`); `security-readiness.test.js:125-140` compares the whole app to `route-inventory.json` (458 routes). Fork routes are in both.
- Step-up (`admin/step-up.js:78-94`): per request, TOTP spent once (`:64-65`) or password, 5 tries per 15 minutes in Postgres (`:40-41`), runs inside the route transaction. 31 `STEP_UP_ROUTES` (`admin/policy.js:12-42`): 24 always, 7 only with `STAFF_STEP_UP` (on by default in production); proven by `step-up-routes.test.js:279-307`.
- Sessions: HS256 JWT access 15 minutes (`auth.js:20`), Bearer only, typ and alg pinned (`auth.js:131-141`); refresh rotated on each use, reuse after a 10 s grace revokes every session (`auth.js:72-84`); sign-in capped 7 days staff / 90 days customer (`auth.js:24,70-71`); role and `session_version` re-checked against DB (`auth.js:148-228`). Cookies hold only the refresh token; refresh/logout check an Origin allowlist (`auth.js:260-265`); CORS explicit list (`app.js:81-88`).
- OTP: 6 digits `randomInt` (`customer.js:185`), 5-minute TTL (`:86`), 3 wrong tries (`:90`), peppered SHA-256 constant-time (`:156-163`), send caps per number and address in Postgres (`:91-140`), Turnstile before sending (`:229,847`).
- Rider/packer scoping: `riderScope` (`access.js:313-344`), own or free stops only (`admin/deliveries.js:51,136-139,228-230`); DELIVERED needs customer code (`delivery-proof.js:38,331`) or manager handover (`:344-346`).
- Customer IDOR: every id route checks `customer_id` (`security-readiness.test.js:136,254`; `auth-matrix :289,320,340`); bill links HMAC-signed, 180 days (`bill-link.js:14-33`).

**AUTH-02 | P1 | Tokens carry no environment claim; keeping preview tokens off production depends only on operators choosing different JWT_SECRETs (SEC-10 still open)**

- Evidence: `mango-api/src/auth.js:26` `export const signAccess = (claims) => jwt.sign(claims, env.JWT_SECRET, { expiresIn: ACCESS_TTL_S, algorithm: 'HS256' })`; verify at `:135` has no `iss`/`aud`. DEMO_OTP is refused only when `deployEnv==='production'` (`env.js:544`); on preview DEMO_OTP/DEMO_OTP_ON_SCREEN only warn (`preflight.js:81-85`). The preview DB is a Neon branch of production so customer ids match. `bill-link.js:13` also derives its key from `JWT_SECRET`. `docs/audit-2026-10-24-status-B.md:30` marks this owner-pending; `deploy/VERCEL.md:128` asks for different secrets but nothing enforces it.
- Why it matters: if the secrets are equal, anyone can sign in on a preview as any phone number with a demo code and use the token on production, including cancelling paid orders (which triggers an automatic refund).
- Smallest fix: sign with `audience = deployEnv` and verify it (with a transition window, or a one-time sign-out), or derive a per-environment key `HMAC(JWT_SECRET, deployEnv)`.
- Test that proves it: `mango-api/test/auth-matrix.test.js`: a token with `aud=preview` → 401 on every route.
- UNVERIFIED: whether the fork's Vercel Preview and Production `JWT_SECRET` values differ.

**AUTH-01 | P1 | Bulk and farm-visit enquiry forms send WhatsApp messages to any typed number with no Turnstile**

- Evidence: `mango-api/src/bulk-enquiry-routes.js:68-73` `bulkEnquiryPublic.post('/bulk-enquiries', whenOn, validEnquiry, submitLimiter, optionalCustomer, ...` never calls `requireHuman`; `/farm-visit-enquiries` the same at `:95-100`. `mango-api/src/bulk-enquiries.js:228` `await addMessage(c, { enquiryId: id, kind: 'BULK_ENQUIRY_RECEIVED', ..., phone: b.phone, ...`; farm-visit at `:589`. Limits: only 10/h per address (`bulk-enquiry-routes.js:45-46`) and 5/day per number (`BULK_ENQUIRY_DAILY_LIMIT`, `env.js:219`); no shop-wide cap. Partner With Us does call Turnstile (`partner/routes.js:51`).
- Why it matters: a bot rotating addresses makes the shop's WhatsApp number message thousands of strangers. That costs money per message and lowers the Meta quality rating; when `SMS_PROVIDER` is not `jio`, WhatsApp is the only login-code channel (`preflight.js:70-72`), so a downgraded number can stop customers signing in.
- Smallest fix: `requireHuman(b.captchaToken, req.ip, {action:'bulk'})` in both handlers (shop forms send the token), or skip `addMessage` for anonymous senders; add a shop-wide daily cap.
- Test that proves it: `mango-api/test/bulk-enquiries.test.js` and `farm-visit-enquiries.test.js`: with TURNSTILE set, a form without a token → 400 CAPTCHA_REQUIRED and no notifications row (model on `partner-network.test.js:260`). Not tested today.

**AUTH-04 | P2 | Some manager actions that move money or cannot be undone have no step-up**

- Evidence: `mango-api/src/admin/recovery.js:138-140` `router.post('/webhook-failures/:id/resolve', requireManager, ...` closes an unmatched captured payment without refund (the sibling `/refund` does step up); `mango-api/src/admin/partner.js:190-191` `` router.post(`${P}/enquiries/:id/erase`, `` is irreversible; `POST /preorders/:id/move` (delaying opens a full customer refund, `customer.js:565`) while `/preorder-plan/apply` does step up. Operators can also change a pincode's lat/lng that feeds the delivery charge (`admin/planning.js:62-64`; effect with a map pin UNVERIFIED).
- Why it matters: a stolen 15-minute manager token could clear a customer's unmatched payment without refunding it.
- Smallest fix: `await stepUp(req, {always:true})` inside both transactions, and list them in `admin/policy.js`.
- Test that proves it: `mango-api/test/step-up-routes.test.js`: resolve and erase without `confirmCode` → refused, nothing changed.

**AUTH-03 | P2 | Bulk enquiries are matched to an account by typed phone; a typo lets a stranger read and answer the quote**

- Evidence: `mango-api/src/bulk-enquiries.js:363` `const OWN = '(customer_id = $1 OR phone = (SELECT phone FROM customers WHERE id = $1))'` (same in `bulk-orders.js:82`); anonymous enquiries store the typed phone unverified (`bulk-enquiries.js:222-225`); respond (`:392-404`) lets that phone's owner accept or decline and sets `customer_id = COALESCE(customer_id, $5)`.
- Why it matters: leaks business name, email, notes and the quote to the wrong number; recycled numbers expose old enquiries; the wrong person can accept a quote.
- Smallest fix: phone match for reading only; `customer_id = $1` for respond, seen, pay and cancel.
- Test that proves it: `mango-api/test/bulk-enquiries.test.js`: an anonymous enquiry typed with B's phone cannot be answered by B. Not tested today.

**AUTH-05 | P2 | Customer refresh token replayed inside the grace window gets a new independent session**

- Evidence: `mango-api/src/auth.js:74` `if (inGrace) return { userId: s.user_id, refresh: userType === 'customer' ? await issueRefresh(s.user_id, userType, c, { startedAt }) : null }`.
- Why it matters: a thief replaying within 10 s gets their own valid chain and reuse detection never fires; sign-out-everywhere and the 90-day cap still end it.
- Smallest fix: in grace return only an access token, as for staff.
- Test that proves it: `mango-api/test/flow.test.js:48` covers staff; add a customer case asserting no new `refresh_sessions` row.

**AUTH-06 | P2 | RIDER_ORIGIN trusted by CORS and Origin check but never checked by preflight**

- Evidence: `mango-api/src/app.js:82-83` and `auth.js:251` include `env.RIDER_ORIGIN` with credentials; `mango-api/src/preflight.js:90` `for (const key of ['ADMIN_ORIGIN', 'CUSTOMER_ORIGIN']) {`.
- Why it matters: an `http://` or localhost rider origin in production would be trusted with credentials.
- Smallest fix: add `RIDER_ORIGIN` to the list (skip when empty).
- Test that proves it: `mango-api/test/preflight.test.js:50`: production with `RIDER_ORIGIN=http://localhost:3000` → error.

**Docs vs code**

- `access.js:5-6` understates the snapshot test's strictness (harmless).
- `access.js:24-27` says DELIVERED needs "code or a photo", but a photo alone is refused without a manager handover (`delivery-proof.js:344-346`); the code is safer than the comment.
- `bulk-enquiry-routes.js:8` says "same limits as enquiry", but Partner With Us also has Turnstile.
- The brief says step-up covers "16 money routes"; code has 31 `STEP_UP_ROUTES` (24 always, 7 with `STAFF_STEP_UP`) at `admin/policy.js:12-42`.

**UNVERIFIED**

- Whether Preview and Production `JWT_SECRET` differ (AUTH-02).
- Delivery fee with map pin vs pincode centre (AUTH-04 side note).
- Whether WhatsApp enquiry-receipt templates are approved (`WHATSAPP_BULK_UPDATES` defaults true).
- Vercel `X-Forwarded-For` handling with `TRUST_PROXY=1`.

---

### 4.5 Database

**How it works**

- Migrations (`migrate.js:99-158`): session `pg_advisory_lock(427714201)` (`:102`); UTF8 check (`:71-77`); environment stamp in `app_meta` (`:51-64`) so a preview build is refused on the production DB; sha256 vs `schema_migrations.checksum`, refuses on mismatch (`:89-97,113`); each file in its own BEGIN/COMMIT with `lock_timeout 5s`, 3 tries (`:117-143`).
- `runMigrations` (`:33-40`) uses `DATABASE_URL_UNPOOLED` when set, else the app pool.
- Build: `vercel-build` = migrate + seed on every production and preview build; seed inserts products only into an empty table (`seed.js:92-100`).
- Pool (`db.js:21-30`): `DB_POOL_MAX` 5 on Vercel (`env.js:34`); `statement_timeout` set only on a non-pooler URL (`:24`), and preflight errors in production when the role lacks it (`preflight.js:189-199`); `attachDatabasePool` on Vercel (`:50`). Only transaction-scoped advisory locks in `src/` (safe with PgBouncer transaction mode); no named prepared statements or SET SESSION.
- Money: all money columns INTEGER paise (`001_init.sql:1`); NUMERIC only for gst_rate, coordinates, kg, km and partner proposal prices (`058:130-131`, never charged); no float or money columns.
- Snapshots: `order_items` stores sku, quantity, stage, unit_price, line_price, pricing JSONB, plan_kg, plan_variety, but no product name. Bills keep a JSONB snapshot frozen by the `bills_keep_issued` trigger (`035:38-80`); `bill-pdf.js:192` reads only that snapshot.
- Time: every timestamp column is TIMESTAMPTZ; `clock.js:17-24` `todayIST`; most SQL uses `AT TIME ZONE 'Asia/Kolkata'`.

**Constraints**

- DB-enforced: orders status CHECK + 045 trigger; number UNIQUE; money non-negative (`038:19`, validated `049:22`); refund_status CHECK; payment_id UNIQUE where not null (`021:18`); discount ≥ 0; order_items quantity > 0, prices ≥ 0 (`048:37`, `049`); batch_lines counters ≥ 0 and no-oversell CHECK (`001:52-60`); duplicate_payments PK payment_id, amount ≥ 0; webhook_events UNIQUE (provider, dedupe_key) (`045:97`); processed_webhooks, idempotency_keys, otps PKs; bills UNIQUE order_id, UNIQUE (fy, seq), immutability trigger.
- App-only: total = subtotal − discount + fee and subtotal = sum of line prices, checked only when a bill is composed (`bills.js:101,105`); line_price = unit_price × quantity; payment_amount = total; one refund per order.

**DB-03 | P2 | No name snapshot on order lines; bills built from live product rows**

- Evidence: `mango-api/src/bills.js:199-200` ``const ITEMS_SQL = `SELECT i.*, p.name AS product_name, p.hsn_code, p.gst_rate FROM order_items i LEFT JOIN products p ON p.sku = i.sku``; `customer.js:1566` `name: findProduct(i.sku)?.name`.
- Why it matters: late bills (pre-orders, `issueMissingBills`) print the current name, GST rate and HSN on a tax document for an earlier sale.
- Smallest fix: nullable `order_items.product_name` (optionally `gst_rate`, `hsn`) filled at insert (`orders.js:185`); `COALESCE(i.product_name, p.name)` in bills.
- Test that proves it: bills test: pay, rename the product, run `issueMissingBills()`, the old name is on the bill.

**DB-04 | P2 | Migrations fall back silently to the pooled URL**

- Evidence: `mango-api/src/migrate.js:34` `const direct = env.DATABASE_URL_UNPOOLED ? new pg.Pool({ connectionString: env.DATABASE_URL_UNPOOLED, max: 1 }) : null`; `:102` `await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK])`.
- Why it matters: through PgBouncer transaction mode the session lock and unlock may land on different server connections; the next deploy's `pg_advisory_lock` (no timeout) hangs the build, and DDL runs as the app role.
- Smallest fix: throw on Vercel when `DATABASE_URL_UNPOOLED` is missing or `isPooledUrl()` matches.
- Test that proves it: `mango-api/test/migrations.test.js` unit test: Vercel env without the unpooled URL → named error.
- Dependency: confirm `DATABASE_URL_UNPOOLED` is set in Vercel production first (UNVERIFIED), or builds will fail.

**DB-02 | P2 | Linking a phone fails for a Google-only account with a back-in-stock alert**

- Evidence: `mango-api/src/customer.js:907` `await c.query('DELETE FROM customers WHERE id = $1', [me.id])`; `stock_alerts.customer_id` is NO ACTION (`019:8`); `POST /stock-alerts` (`customer.js:644-651`) needs no phone; the merge (`:879-906`) moves carts, reviews, photos, favourites, push subs, help tickets and subscriptions, but not `stock_alerts`, so the delete fails with a 500.
- Why it matters: the customer cannot add a phone and is stuck. Low today because the shop never creates stock alerts (LEAK-02); it becomes live once LEAK-02 is fixed.
- Smallest fix: move or delete alerts in the merge, respecting `stock_alerts_open_idx`.
- Test that proves it: account-join test: Google-only customer with an open alert links a phone owned by another account → 200.
- Dependency: fix before or with LEAK-02.

**DB-01 | P2 | Two farm queries use UTC days instead of IST days**

- Evidence: `mango-api/src/farm/staff.js:30` ``if (f.createdFrom) where.push(`b.created_at >= ${arg(f.createdFrom)}::date`)``, `:31` and `:140` the same; `mango-api/src/farm/settings.js:158` `[new Date(now().getTime()).toISOString().slice(0, 10), MIN_KG],` where `todayIST()` is meant.
- Why it matters: bookings made 00:00-05:30 IST fall on the wrong day in staff filters and settings.
- Smallest fix: `::date::timestamp AT TIME ZONE 'Asia/Kolkata'` (as `admin/exports.js:43`) and `todayIST()`.
- Test that proves it: farm test: a booking at `2026-05-10T20:00Z` with `createdFrom=createdTo=2026-05-11` is included.

**DB-06 | P2 | Pending migration reuses a number; plaintext delivery codes still read**

- Evidence: `mango-api/migrations-pending/056_drop_delivery_code.sql` clashes with `migrations/056_payment_details.sql`; `mango-api/src/delivery-code.js:41` `return o.delivery_code ?? null` (also `:53-55`, `orders.js:1027`).
- Why it matters: plaintext delivery codes stay in `orders` and in every backup; the pending file cannot ship under its number.
- Smallest fix: run `ops/hash-delivery-codes.js` once, remove the reads, ship as `089_drop_delivery_code.sql`.
- Test that proves it: `migrations.test.js` lint rejects duplicate numbers across `migrations/` and `migrations-pending/`; delivery tests pass with the column gone.

**DB-05 | P2 | Every preview build migrates the single shared staging database**

- Evidence: `vercel-build` runs `migrate.js`; `deploy/VERCEL.md:39,95` describe one staging Neon branch for all previews.
- Why it matters: a work-in-progress branch's 089 is applied for good; another branch's different 089 then fails the checksum (`migrate.js:92-96`) and blocks its previews. Production is protected by the environment check.
- Smallest fix: on preview builds migrate only for the staging ref (`VERCEL_GIT_COMMIT_REF`), or document the rule.
- Test that proves it: a unit test of the build script: preview with a non-staging ref skips migrate.

**Docs vs code**

- `deploy/VERCEL.md:127` says `DATABASE_URL_UNPOOLED` is for migrations only, but `events.js:85` uses it at runtime for LISTEN (see SRV-05).

**UNVERIFIED**

- Production DB time zone.
- Whether `DATABASE_URL_UNPOOLED` is set on Vercel production.

---

### 4.6 Background work on serverless

**How it works**

- `background.js:12-23` passes tasks to `waitUntil` (`@vercel/functions`); outside a request context errors are swallowed (`:18-20`).
- Money tasks that use `waitUntil` all have a DB-backed redo: refunds (`payments.js:465,799,800,831,877`; `admin/recovery.js:184`) are redone from `refund_requested_at` and `duplicate_payments` by `processDueRefunds` (`maintenance.js:409`, `payments.js:1110`); capture of an authorized payment (`payments.js:366`) is redone by `reconcilePendingPayments` (`:846-850`); slow WhatsApp webhooks (`app.js:262`) are stored first then replayed. Best effort only: staff audit after response (`access.js:465,473`), ops counters, Sentry flush, payment-link cancel.
- So nothing that moves money relies only on `waitUntil`; **the maintenance job's schedule is the real guarantee.**
- Job: cron secret checked constant-time before DB (`app.js:148-151,164-165`); overlapping runs blocked by a lease row (`maintenance.js:144-153`, 65 s); 45 s budget (`:59`) under `maxDuration` 60 (`vercel.json:9`); time slices for steps that call out; open-order re-check resumes from a cursor (`:217-242`); each step's result goes to `maintenance_runs` with a failure count, Sentry at most hourly (`:91-131`).
- Steps (`maintenance.js:393-493`): reconcile, webhook-replay, sweep, retire, warehouse-sessions, audit (hourly), review-stats (hourly), refunds, duplicate-payments, refund-checks, payment-recon (daily), stock-alerts, reminders, review-requests, referrals, manager-summary, subscriptions, partner-followups, farm, preorders, bulk-orders, notifications, whatsapp-messages, whatsapp-templates (daily), push, bills, cleanup, retention / delivery-photo-purge / funnel (daily), partner-retention (hourly), rebalance, health, tick.

**CRON-01 | P0 (P1 only if the owner confirms production is on Vercel Pro with an every-minute cron set in the dashboard) | The maintenance job as shipped runs once a day** (merged AREA7-01 and SRV-01)

- Evidence: `mango-api/vercel.json:22` `"schedule": "30 21 * * *"`. `.github/workflows/maintenance-ping.yml` exists only on this branch (not on `origin/main` or `farm-src/main`; GitHub runs schedules only from the default branch; `gh run list --workflow maintenance-ping.yml` → "HTTP 404 not found on the default branch"), runs `*/5 * * * *` (`:19`), and exits 0 when secrets are missing (`:38-41` `echo "MAINTENANCE_URL or CRON_SECRET is not set: nothing called."` / `exit 0`). `gh secret list` returned nothing (may be permissions). `deploy/SCHEDULER.md:14` "Production runs on Vercel Pro and uses Vercel's own every-minute cron." `app.js:143-145` says the every-minute scheduler is Vercel Cron on Pro or an external pinger. Preflight does not check cron cadence; only `/ready` → 503 after 240 s (`readiness.js:10`) if a monitor is pointed at it.
- Why it matters: refunds the instant path missed, payments whose webhook was lost, WhatsApp/SMS sends, webhook replay, bills, expired-hold sweeps and health alerts can all wait up to 24 hours. In season that means stuck boxes, customers not told their order is confirmed, and refunds late.
- Smallest fix: Vercel Pro with `* * * * *` in `vercel.json`; or merge the ping workflow to `main`, set `MAINTENANCE_URL` and `CRON_SECRET`, and make it `exit 1` when they are unset.
- Test that proves it: a CI check reading `vercel.json` that requires either an every-minute cron or a ping workflow that fails on missing secrets; and extend `mango-api/test/preflight.test.js` with a production-on-Vercel case reading `vercel.json` that errors unless `EXTERNAL_SCHEDULER=true` is acknowledged.

**SRV-02 | P1 | Stopped-job alarms don't match the real schedule**

- Evidence: `mango-api/src/sentry.js:101` `{ schedule: { type: 'crontab', value: '* * * * *' }, checkinMargin: 3, ... }`; `mango-api/src/readiness.js:10` `export const MAINTENANCE_STALE_S = 240`; the pinger is `*/5`. Detection of a stopped job exists only outside code (Better Stack, Sentry monitor; `alert-checks.js:9-10,41-46`).
- Why it matters: with a 5-minute or daily trigger these alarms fire constantly, get muted, and then a real stop goes unnoticed. Alerts go to Sentry email/push and Better Stack; nothing reaches the owner on WhatsApp.
- Smallest fix: one setting for the expected interval, used by both the Sentry monitor schedule and the stale threshold.
- Test that proves it: readiness unit test and `alert-checks` test with a 5-minute interval: not stale at 6 minutes, stale at 16.
- Dependency: after the CRON-01 decision (Phase 0).

**SRV-04 | P2 | Each instance caches prices up to 60 s**

- Evidence: `mango-api/src/app.js:33` `const RELOAD_MS = 60_000`; `customer.js:1010` prices with `findProduct(l.sku).price`.
- Why it matters: other instances charge the old price or sell a stopped product for up to a minute after a change.
- Smallest fix: read price and sellability from `products` inside the checkout transaction.
- Test that proves it: warm the cache, update the price in the DB, quote, expect the new price.

**SRV-05 | P2 | Panel live-event LISTEN**

- Evidence: `mango-api/src/events.js:85` `const c = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL })`.
- Why it matters: each instance with an open panel stream holds a direct owner-role connection; without the unpooled URL, LISTEN goes through the pooler and may never deliver (UNVERIFIED) while reporting it is listening, so the panel misses live updates.
- Smallest fix: a separate LISTEN URL for the app role; poll when only a pooler URL exists.
- Test that proves it: unit test: pooler-only URL → events module chooses polling.

BKP-02 (backups-missing alert off by default; was SRV-03 here) is written up in full in 4.9.

**Alert coverage** (`alert-checks.js:40-107`, `maintenance.js:505-579`)

- Covered: refunds overdue > 30 minutes; Razorpay webhooks failing (≥ 3/h) and payments found only by polling; WhatsApp/push overdue or failing; orders past delivery date; hourly stock, capacity and box drift; steps failing 3× in a row; 5xx, slow answers, busy pool (`OPS_ALERTS`).
- Partly: backups missing (BKP-02), job stopped (SRV-02), Razorpay unreachable (indirect).
- Not needed: negative stock (DB CHECK).
- Not covered: Blob upload failures (warning log only).
- All of these run inside the maintenance job, so they inherit CRON-01's cadence.

**Docs vs code**

- `maintenance.js:1` and `alert-checks.js:6` say every minute; `deploy/SCHEDULER.md:14` says production is on Pro with every-minute cron; the repo is configured daily plus a 5-minute pinger that is not on `main`.
- Brief says "per-minute cron"; shipped config is daily.

**UNVERIFIED**

- Vercel plan and any external pinger; whether a dashboard cron overrides `vercel.json`.
- Whether the Sentry monitor and Better Stack check exist.
- Whether empty `gh secret list` means no secrets or no permission.
- Whether `waitUntil` keeps request context inside `res.on('finish')`.
- Neon pooler LISTEN behaviour.

---

### 4.7 Production safety

**How it works**

- `api/index.js` → `src/app.js` → `env.js`; `env.js:575-581` runs `checkProduction(env, {vercel})` when `isProd && !PREFLIGHT` and calls `process.exit(1)` on error. The same check runs at build (`vercel-build` = `migrate.js`, which imports `env.js:16`), so bad production config fails the build.
- On Vercel, `NODE_ENV` not `production` is refused (`env.js:516-519`); previews run as production with `target='preview'` (`preflight.js:40-43`).
- Gates: DEMO_PAYMENTS exits in production (`env.js:548-551`, `preflight.js:79`); `payments.js:73` 503 without keys; demo-pay route gated (`customer.js:1983`); dev routes only `!isProd && flag && no Razorpay keys` (`env.js:507`, `app.js:306`, `preflight.js:88`); `COOKIE_SECURE` default `'true'` (`env.js:48-51`) and preflight errors on false (`preflight.js:48`); demo staff only `!isProd` (`seed.js:108-117`); demo stock `!isProd || preview` (`seed.js:131`).
- Razorpay: live key on preview → error (`preflight.js:56`); test key in production → warning only (`:57`); missing keys in production → error (`:52-55`); `whsec_dev` → error (`:58`). JWT < 32 chars or `dev-only-change-me` rejected (`:45-47`). `CRON_SECRET` required on Vercel (`:122`), missing → 401 fail-closed (`app.js:148-150`).
- OTP in response only `!isProd` (`customer.js:200`, `admin/rider-auth.js:104`); DEMO_OTP, DEMO_OTP_ON_SCREEN, LOG_OTP_CODES refused outside preview (`preflight.js:81-87`, `env.js:544-547`). `NEVER_FROM_PANEL` (`feature-switches.js:53-58`) includes ENABLE_DEV_ROUTES, COOKIE_SECURE, SEED_DEMO_DATA, BACKUP_HEARTBEAT_EXPECTED.
- `scripts/scan-bundle.mjs:41-55` forbids rzp_ keys, private keys, postgres URLs, dev JWT, whsec_, Blob tokens, JWTs, server-only names, `/v1/dev`, dev gateway markers, test staff emails, demo passwords and mock-api in built bundles.
- Committed secrets: none in 687 revisions (see section 5).

CRON-01 (was AREA7-01 here) is written up in full in 4.6.

**AREA7-02 | P1 | A Razorpay test key in production is only a warning**

- Evidence: `mango-api/src/preflight.js:57` `else if (!preview && env.RAZORPAY_KEY_ID.startsWith('rzp_test_')) warnings.push('RAZORPAY_KEY_ID is a test key: payments are not real money')`.
- Why it matters: production confirms orders and dispatches mangoes for "payments" that are not real money, until someone reads the build logs.
- Smallest fix: error unless `ALLOW_TEST_PAYMENTS_IN_PRODUCTION=true`.
- Test that proves it: `mango-api/test/preflight.test.js`: "production with rzp_test_ key → errors"; with the allow flag → warning.
- Dependency: ask the owner first whether a pre-season test-key week in production is intended (Question 12).

**AREA7-03 | P2 | TOTP secrets may be stored unencrypted in production**

- Evidence: `mango-api/src/preflight.js:143` `if (!env.TOTP_ENCRYPTION_KEY) warnings.push('TOTP_ENCRYPTION_KEY is not set: staff two-step secrets are stored unencrypted ...')`; `STAFF_TWO_STEP` defaults `'all'` in production.
- Why it matters: a DB leak or backup leak gives an attacker every manager's second factor.
- Smallest fix: error in production outside preview.
- Test that proves it: `mango-api/test/preflight.test.js`: production without the key → error.
- Dependency: set `TOTP_ENCRYPTION_KEY` in Vercel production before shipping, or the next build fails.

**AREA7-04 | P2 | .gitignore lacks .env.* and *.pem**

- Evidence: `.gitignore:3` `.env`, `:10` `deploy/.env`, `:16` `.env.local`; no `.env.*` with `!.env.example`, no `*.pem` / `*.key`.
- Why it matters: `vercel env pull .env.production` output would be committable.
- Smallest fix: add `.env.*`, `!.env.example`, `*.pem`, `*.key`.
- Test that proves it: `git check-ignore .env.production key.pem` returns both.

**Docs vs code**

- `app.js:143-145` and `deploy/SCHEDULER.md:14` vs `vercel.json:22` (see CRON-01).

**UNVERIFIED**

- Whether the fork's API is deployed to Vercel production and on which plan (a dashboard cron could override `vercel.json`).
- Vercel env values: `NODE_ENV`, `RAZORPAY_KEY_ID` prefix, `SENTRY_DSN`, `CRON_SECRET`.

---

### 4.8 Tests

**How it works**

- `mango-api/package.json:15` `node --test --test-concurrency=1 "test/**/*.test.js"`: 117 files plus `test/contract/*`, about 1,412 tests. `helpers.js:21-30` resets by dropping the schema and running all 88 migrations plus seed; referenced 218 times (most of the ~36 minutes).
- Razorpay: `setup-env.js:21-22` sets keys to `''` so `payments.js:23` `hasKeys()` is false and an in-memory dev gateway is used (`:28-29`); webhooks are really HMAC-signed (`helpers.js:135-138`); about 10 files (audit-a-payments, business-invariants, pay-fixes, recovery, refund-retries, gifting) set `RAZORPAY_KEY_ID='rzp_test_x'` and stub `globalThis.fetch` to test the real adapter.
- CI api job: postgres:16, `npm test` direct (`ci.yml:106`), then again through PgBouncer `pool_mode=transaction` (`:129,:139`). `previous-release-on-new-schema` (`:171`, `scripts/n-minus-1.sh`) runs the old API's tests on the new schema. The e2e job runs only `contract.spec.ts` and `day-in-the-life.spec.ts` against the real API (`:251`); panel specs are mocked (`:57`).
- Trigger bypass: `helpers.js:39-48` `forceOrderState` uses `SET LOCAL mango.order_status_override` in one transaction in ~29 files; `src/` never uses the override.

**Scenario coverage (report E, verbatim)**

| Scenario | Test | Verdict |
|---|---|---|
| (a) Last-stock race | concurrency.test.js:17 "30 buyers racing for 10 boxes"; business-invariants.test.js:430 "20 customers … last 3 boxes", :462; holdback.test.js:178; lock-order.test.js:39 | REAL |
| (b) Duplicate webhook | security-readiness.test.js:453; business-invariants.test.js:490,510; webhook-intake.test.js:122 | REAL |
| (c) Crash mid-payment | business-invariants.test.js:595 "webhook never comes"; audit-a-payments.test.js:300; pay-fixes.test.js:426 (PAY-B4); webhook-intake.test.js:87; business-invariants :760,:790 | REAL |
| (d) Repeated refund | contract/twice.test.js:107; business-invariants.test.js:618,654,690; hardening.test.js:42 | REAL |
| (e) Double-submitted checkout | server: concurrency.test.js:43, contract/twice.test.js:49,64, launch-review.test.js:229, flow.test.js:250; shop: none and broken (TEST-02) | PARTIAL |
| (f) Failed delivery | business-invariants.test.js:889 (3 misses, 4th dispatch refused); delivery.test.js:147; stock-fixes.test.js:310; audit-b-delivery.test.js (PLT-08); contract/twice.test.js:123 (replacement once); RTO step flow.test.js:~368 asserts only 204 | PARTIAL |
| (g) Stale replay after paid→cancelled→refunded | none; only pay-fixes.test.js:270 (late new capture after cancel) and webhook-intake.test.js:122; orders.js:531 returns already_paid for REFUNDED but unproven for checkout orders (gift/farm have it) | PARTIAL |
| Amount mismatch | audit-fixes.test.js:106,121 | REAL |
| OTP brute force | flow.test.js:510; security-fixes.test.js:111 | REAL |
| Rider IDOR | rider-app.test.js:115 | REAL |
| Migration re-run | migrations.test.js:179,186,215 + n-minus-1 job | REAL |
| Backup restore | backup.test.js:363+ with stub pg_restore (exit 0) | PARTIAL |
| Shop behaviour | none | NONE |
| Rider e2e | rider-app/e2e/* exist, CI never runs them | NONE in CI |

Note: TEST-02 in row (e) is merged into STOCK-01 (4.2) in this document.

**TEST-01 | P1 | Customer journey test against the real API deleted with nothing to replace it**

- Evidence: `git diff main...HEAD -- .github/workflows/ci.yml` removes "Customer app journey against the real API" and its WebKit rerun; 22 spec/unit files went with `customer-app/`; `package.json:22` `shop:test` is `node --check` on 15 of 31 files.
- Why it matters: the path that takes money from customers (add box → sign in → quote → confirm → pay → success) has no end-to-end test; a shop regression reaches customers in season.
- Smallest fix: `tests/shop-journey.spec.ts` in the e2e job, serving `shop/` via `scripts/serve-shop.mjs`: add box → OTP devCode → quote → confirm → demo-pay → success, plus one guest bulk enquiry and one claim.
- Test that proves it: the spec itself, green in CI against the real API; break `shop/app.js` `pay()` locally and see it fail.
- Dependency: loop `shop:test` over every file first (AREA1-05); add the STOCK-01 retry case once STOCK-01 is fixed.

STOCK-01 (was TEST-02 here) is written up in full in 4.2.

**TEST-08 | P2 | Panel unit test fails: the 'partner-retention' step has no label**

- Evidence: `tests/unit/step-labels.unit.ts:19` `assert.deepEqual([...steps].filter((s) => !labelled.has(s)).sort(), [])` fails with actual `[ 'partner-retention' ]`; the step is recorded at `mango-api/src/maintenance.js:471` `step('partner-retention', ...)`; labels live in `src/pages/NeedsAttention.tsx:11` `const STEP_LABEL`.
- Why it matters: staff would see a raw name like "partner-retention is failing" in Needs attention; it also fails the CI build-and-test job on run 45161320834, which hides other failures.
- Smallest fix: add a `'partner-retention'` entry to `STEP_LABEL`.
- Test that proves it: `npm run test:unit` passes.

**TEST-03 | P2 | preorder-plan.test.js: e2abdc3 widened the assertion, not the race**

- Evidence: `mango-api/test/preorder-plan.test.js:286` `assert.ok(r.delayed.paid >= 2002 && r.delayed.paid <= 2004, ...)`; the comment at `:282-285` says "Either order is right" for 2,002 or 2,004, yet 2,003 passes; the race between `Promise.all([recalculatePreorders({}), paid(...)])` (`:280`) is built into the test; `assert.ok(Date.now() - started < 20_000, ...)` (`:281`) remains; it also runs through the pooler.
- Why it matters: the test can pass on a wrong count and can still fail on a slow runner (it failed CI run 45155077756).
- Smallest fix: assert `[2002, 2004].includes(r.delayed.paid)`; better, split into two deterministic before/after tests with exact counts and keep the concurrent one asserting only invariants.
- Test that proves it: the split tests, each with an exact expected count.
- Owner question: should an UNPAID booking push PAID bookings to later weeks (`:284`)?

**TEST-05 | P2 | Recorded Razorpay replay skipped forever; restore stubbed**

- Evidence: `mango-api/test/razorpay-fixtures.test.js:56` `test('replay recorded webhooks', { skip: 'no recorded fixtures yet: see deploy/RAZORPAY-SANDBOX.md' }, () => {})`; no fixtures folder; `backup.test.js` writes a `pg_restore` stub that exits 0.
- Why it matters: real Razorpay payload shapes and a real restore are never exercised; a format change or a broken dump would only show in production.
- Smallest fix: record 5 sandbox bodies with `scripts/razorpay-sandbox.mjs`; add one CI step running real `pg_dump -Fc`, `pg_restore` and `ops/restore-check.sh`.
- Test that proves it: the un-skipped replay test and the CI restore step.

**TEST-04 | P2 | Rider e2e never runs in CI**

- Evidence: `rider-app/playwright.config.ts:9` `testDir: "e2e",`; CI runs only the root `testDir './tests'`.
- Why it matters: rider app regressions (offline queue, proof photos) reach riders unnoticed.
- Smallest fix: `npm --prefix rider-app run e2e` in build-and-test (it has its own mock API).
- Test that proves it: the CI job lists rider e2e results.

**TEST-06 | P2 | Timing assertions that could flake**

- Evidence: `mango-api/test/audit-b-security.test.js:79` `assert.ok(ms < 150, ...)`; `pay-fixes.test.js:287` `< 1000`; `rider-app.test.js:252`; `preorder-plan.test.js:281`.
- Why it matters: flaky CI trains people to rerun and ignore red builds.
- Smallest fix: loosen limits substantially or assert statement counts instead of wall-clock.
- Test that proves it: 20 consecutive CI runs without a timing failure.

**TEST-07 | P2 | Run time**

- Evidence: `mango-api/test/helpers.js:22-24` `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` then `await runMigrations()` and `await seed()` on every reset (88 migrations).
- Why it matters: ~36 minutes per run (UNVERIFIED, from CI log) slows every fix in season.
- Smallest fix: migrate once into a template DB, then `CREATE DATABASE ... TEMPLATE` (or TRUNCATE + re-seed) per reset; keep `migrations.test.js` on real migrations.
- Test that proves it: same pass count, shorter run.

**HYG-01 | P2 | knip reports seven unused exports**

- Evidence: `FARM_VISIT_STATUSES` `mango-api/src/bulk-enquiries.js:30`; `BULK_ORDER_STEPS` `bulk-orders.js:43`; `publish` `events.js:47`; `resetAttention` `events.js:230`; `moneyOf` `farm/bookings.js:327`; `addPreorderEvent` `preorders.js:78`; `SEASON_PHASES` `season-phase.js:10`.
- Why it matters: dead surface that misleads readers.
- Smallest fix: drop the `export` keyword, or delete the code if unused internally too.
- Test that proves it: knip clean in CI.

**Docs vs code**

- `shop/README.md:236-253` marks the customer-app retirement as done with e2e jobs, but no shop e2e replaced them; `README:174` confirms `shop:test` is `node --check` only.

**UNVERIFIED**

- The ~36-minute runtime (from CI log).
- Whether the e2abdc3 CI api job passed (still pending when this audit was written).

---

### 4.9 Disaster recovery

**How it works**

- Primary: Neon PITR (1-day default; docs say raise to 7 days, `deploy/VERCEL.md:84-87`).
- Secondary: `backup.yml` nightly at 21:30 UTC (`:27`) → `ops/backup.sh`: `pg_dump` custom format, `pg_restore --list` read-back, GPG to a public key (plaintext refused unless `BACKUP_ALLOW_PLAINTEXT`), uploaded as a GitHub artifact with `retention-days: 30` (`backup.yml:75-81`).
- Heartbeat: `ops/backup-heartbeat.sh ok` writes `maintenance_runs.step='backup'` (`backup.yml:83-90`); `maintenance.js:545-548` raises "No backup in the last 26 hours" only if `BACKUP_HEARTBEAT_EXPECTED=true` or a row exists (`maintenance.js:596`).
- Restore tooling: `ops/restore-drill.sh` (PITR branch checks), `ops/restore-check.sh` (decrypt, load into scratch DB, checks, drop), `ops/bump-sequences.js`, `replay-payments.js`, `reapply-deletions.js`.
- Tests: `backup.test.js` (encryption only, private key refused, upload, half-file cleanup, unreadable dump, heartbeat role grants, 26-hour rule, restore-check on balanced books `:363-390`), CI only.
- Documented targets (`deploy/RESTORE-DRILL.md:11-12`, `VERCEL.md:394-401`): RPO < 1 minute within the Neon window, up to 24 hours from nightly; RTO target 1 hour "Not measured yet"; drill log empty.
- Photos: none backed up (`VERCEL.md:408-412`; `RESTORE-DRILL.md:14`; `GO-LIVE.md:25` item 14 open; `delivery-proof.js:145-147` stores `blob_path` only).

**Status**

- DOCUMENTED: nightly encrypted dump; 7-day PITR; RPO and RTO targets; monthly drill; 26-hour missing-backup alert.
- VERIFIED by code and tests: encryption enforced; read-back check; `restore-check.sh` works on balanced books; staleness rule works when enabled; heartbeat role least-privilege.
- BROKEN / NOT IN PLACE: nightly backup failed every night 2026-11-17 to 2026-11-23 (runs 44227102786 … 45096932075, including 45096932075, 44971518594, 44856820561), each with "No backup taken: set the BACKUP_DATABASE_URL and BACKUP_GPG_PUBLIC_KEY secrets"; the fork has no Actions secrets; heartbeat flag unset; RTO never measured; Neon PITR window UNVERIFIED; photos have no copy.

**BKP-01 | P0 | Zero off-Neon backups exist on the fork** (was AREA9-01)

- Evidence: `.github/workflows/backup.yml:54-56` `elif [ -z "$BACKUP_DATABASE_URL" ] || [ -z "$BACKUP_GPG_PUBLIC_KEY" ]; then` / `echo "::error::No backup taken: ..."` / `exit 1`; every run 2026-11-17 to 2026-11-23 failed; `gh secret list` empty.
- Why it matters: if Neon loses the project, or a mistake is found after the PITR window (possibly still 1 day), every order, payment record and 8-year tax bill is gone.
- Smallest fix (owner action, no code): create a read-only Neon role; generate a GPG keypair (private key kept offline); set `BACKUP_DATABASE_URL`, `BACKUP_GPG_PUBLIC_KEY` and `BACKUP_HEARTBEAT_DATABASE_URL` secrets; run the workflow by hand; run `ops/restore-check.sh` once; fill the `RESTORE-DRILL.md` log.
- Test that proves it: a green Backup run with an artifact, plus one recorded restore-check.

**BKP-02 | P0 | Nothing in the app noticed 7+ days without a backup** (merged AREA9-02 and SRV-03)

- Evidence: `mango-api/src/env.js:459-462` `BACKUP_HEARTBEAT_EXPECTED: z.enum(['true','false']).default('false')`; `mango-api/src/maintenance.js:596` `if (!row && !env.BACKUP_HEARTBEAT_EXPECTED) return null`; the failure-heartbeat step needs `steps.check.outputs.ready == 'true'` (`backup.yml:92`), so a setup failure never reaches the app; `preflight-cli.js:46-47` warns only, and only in the manual CLI; the boot-time `checkProduction` has no backup check. The only signal is GitHub's failed-run email to whoever last edited the workflow.
- Why it matters: the owner believes backups exist until the day one is needed; seven silent nights already happened.
- Smallest fix: `preflight.js` `checkProduction` errors in production when `BACKUP_HEARTBEAT_EXPECTED` is off; `env.js` defaults it to true when `deployEnv === 'production'`.
- Test that proves it: extend `mango-api/test/backup.test.js` "a missed backup shows in Needs attention" for production with no row and the flag unset; `mango-api/test/preflight.test.js` production without the flag → error.
- Dependency: Phase 0 backup secrets first, so the alert shows real state rather than a permanent red.

**BKP-03 | P1 | Photos (delivery proof, claims, reviews, products) have no backup** (was AREA9-03)

- Evidence: `deploy/VERCEL.md:408-412`; `deploy/GO-LIVE.md:25` (item 14, due 4 Dec); `mango-api/src/delivery-proof.js:145-147` stores only `blob_path`.
- Why it matters: proof and claim photos are the evidence in replacement disputes and chargebacks.
- Smallest fix: a `backup.yml` step (or weekly workflow) listing the Blob store and syncing new objects into the encrypted artifact or off-site storage; or the owner records explicit acceptance in GO-LIVE item 14.
- Test that proves it: `backup.test.js` workflow-level check (like the heartbeat test at `:296`) that the photo step exists.

**BKP-04 | P1 | The only backup copy lives in the same GitHub repo with 30-day retention** (was AREA9-04)

- Evidence: `.github/workflows/backup.yml:75-81` `actions/upload-artifact@v4` ... `retention-days: 30`; the `BACKUP_UPLOAD_CMD` hook in `ops/backup.sh` is unused by the workflow.
- Why it matters: deleting the repo or compromising the account takes every backup; bills older than 30 days are unrecoverable outside Neon's window, though tax law needs 8 years.
- Smallest fix: pass `BACKUP_UPLOAD_CMD` (for example rclone to a separate bucket with object lock), plus monthly long-retention copies.
- Test that proves it: `backup.test.js`: with `BACKUP_UPLOAD_CMD` set in the workflow env, the upload command is invoked with the `.gpg` file.
- Dependency: BKP-01 first.

**BKP-05 | P2 | RTO never measured; Neon PITR window unknown** (was AREA9-05)

- Evidence: `deploy/RESTORE-DRILL.md:12` "Not measured yet"; drill log empty; `deploy/VERCEL.md:485` checklist "7 days" unticked.
- Why it matters: nobody knows how long the shop would be down after a disaster, or how far back Neon can go.
- Smallest fix: owner runs `ops/restore-drill.sh` once, records the minutes and the window.
- Test that proves it: a filled row in the drill log.

**Docs vs code**

- `backup.yml:42-43` says failures email "the repo owner"; GitHub notifies the last workflow editor (UNVERIFIED).
- Docs describe nightly copies that do not exist.

**UNVERIFIED**

- Neon plan and PITR window.
- `BACKUP_HEARTBEAT_EXPECTED` and `SENTRY_DSN` in Vercel production.
- Whether any backup ever succeeded before 2026-11-17.

---

### 4.10 Business leaks

**How it works**

- `shop/api.js:26` turns a failed fetch into a NETWORK error shown inline or as a toast; there is no Sentry, `onerror` or `sendBeacon` anywhere in `shop/` (the panel reports via `src/main.tsx:8`).
- `shop/sw.js` skips non-GET and anything under `/v1/`: no POST or offline queue, nothing replays stale sessions or keys.
- Payment return (`shop/app.js:131-133`): the Razorpay handler calls `verifyPayment` (errors ignored), then `settle()` polls `/payment-status` 20 × 1.5 s; if still pending it says "still confirming" and goes to `/orders/:id`; closing the sheet shows the hold time. It does not rely on the webhook alone.
- Rider app: IndexedDB queue (`rider-app/lib/queue.ts`), client id per job as idempotency key, drains on online/visibility/every 15 s; a 401 keeps the job pending.

**Correction to the brief's premise.** The brief assumed a bulk enquiry is a local draft plus a WhatsApp hand-off. That is wrong for current code: bulk and farm-visit enquiries create server records for guests and signed-in customers alike, with a stable key per form; the WhatsApp button is an extra prefilled copy (`shop/pages.js:836-860`, `shop/bulk.js:379-387`).

**Action → class** (1 server record, 2 local only, 3 WhatsApp hand-off, 4 dropped)

- Bulk enquiry/order, guest or signed in: `pages.js:843` → `POST /v1/bulk-enquiries` with stable key (1)
- Farm visit enquiry: `bulk.js:387` → `POST /v1/farm-visit-enquiries` (1)
- Help request: (1) only if signed in AND `HELP_CENTRE` on; else WhatsApp link (`help.js:90,96-97,105`), so (3) by default
- Claim: `claims.js:201-202` (1)
- Review: `review.js:71` (1), but text lost if the sheet is closed after an error and the order is marked skipped (`:41`)
- Favourites: `shelf.js:464-467` (2), never synced; server `/v1/me/favourites*` (`app-feel-routes.js:74-103`) unused
- Back-in-stock alert: sold-out cards disabled (`shelf.js:120`); `/v1/stock-alerts` (`customer.js:646`) never called (4)
- Pre-order booking/cancel: (1). Re-order: local cart only, fine.
- Change delivery date: not in shop though `/v1/orders/:id/reschedule` exists (`customer.js:1655`); the old app used it (3)
- Change delivery address: no route anywhere (3)
- Guest cart: `mm-cart` localStorage, sign-in required before quote (2), acceptable
- Funnel events / funnelId: never sent (4). Client errors: never reported (4).
- Rider jobs: queued and retried (2), but a permanently refused photo is dropped (4)

**SHOP-01 | P1 | Shop errors are never reported; no error hook or boundary** (merged AREA1-03 and LEAK-06)

- Evidence: `shop/api.js:26` maps failures to a NETWORK error shown only to the customer; `shop/*.js` has only XHR/script-load handlers (`api.js:50`, `app.js:78`, `map-picker.js:40`); `shared/error-reports/` is unused by the shop; shop CSP `connect-src` (`shop/vercel.json:30,55`) has no `*.ingest.sentry.io`. Upstream `customer-app/src/main.tsx:9-10,26` had an ErrorBoundary and `startErrorReports`, and `ui.tsx:58-65` `componentDidCatch` → `reportError`.
- Why it matters: a JavaScript error at checkout on a customer's phone is invisible to the owner; sales are lost with no signal.
- Smallest fix: a `window.onerror` / `unhandledrejection` hook in `shop/app.js` posting a scrubbed report (via `shared/error-reports`, or the Sentry browser loader behind a DSN in `config.js`); also report 5xx and BAD_RESPONSE; add the ingest host to both CSP entries in `shop/vercel.json`.
- Test that proves it: extend `tests/csp.spec.ts` `expectShopSources` for the ingest host; a shop spec that throws and asserts one report request.
- Dependency: CSP change before the Sentry loader, or the browser blocks every report.

**LEAK-03 | P1 (failed deliveries) | No customer reschedule or address change**

- Evidence: `mango-api/src/customer.js:1655` `'/orders/:id/reschedule',` exists and the old app called it (`customer-app/lib/api/client.ts:306`); the shop has no caller; no address-change route exists anywhere.
- Why it matters: a customer who will be away cannot move the day, so the rider arrives to a locked door; failed deliveries cost a trip and a replacement.
- Smallest fix: a "Change delivery day" button on the order page using the existing route; address changes via a help request with topic ADDRESS.
- Test that proves it: shop spec: open a paid order, change the day, the order shows the new date (API side already tested).

**LEAK-01 | P1 (lost complaint) | Help page complaints have no server record by default**

- Evidence: `mango-api/src/env.js:173` `HELP_CENTRE: flag(),` defaults false; `shop/help.js:90` prefills `'Hi VMR Mangoes, I need help with an order'` with no order number; guests always get only the link; without `SUPPORT_WHATSAPP` even the link is gone (`build-config.mjs:113` only warns).
- Why it matters: complaints live only in a WhatsApp chat with no order number; they cannot be tracked, counted or handed over.
- Smallest fix: `HELP_CENTRE=true` (route, desk and `care.test.js` exist) and prefill the order number; optionally a guest `POST /v1/help-intents` modelled on the bulk enquiry route.
- Test that proves it: `care.test.js` with the flag on; shop spec: the WhatsApp link text contains the order number.
- Dependency: turn `HELP_CENTRE` on before the order-number prefill matters for signed-in users.

**LEAK-02 | P1 (lost sale) | Back-in-stock alerts lost in the rebuild**

- Evidence: `shop/shelf.js:120` renders sold-out box cards `disabled`; the route still exists at `mango-api/src/customer.js:646` `'/stock-alerts',`; the old app called it (`customer-app/lib/api/client.ts:332-334` at `3f51be3~1`).
- Why it matters: in a seasonal business, a sold-out variety that comes back sells to whoever happens to look; interested customers are not told.
- Smallest fix: a "Tell me when it's back" button on sold-out cards → `POST /v1/stock-alerts`.
- Test that proves it: shop spec: click on a sold-out card creates one alert; API stock-alert tests already cover sending.
- Dependency: fix DB-02 first or together (account merge breaks once alerts exist).

**LEAK-07 | P2 (lost proof of delivery) | Refused rider photo dropped silently**

- Evidence: `rider-app/lib/queue.ts:182` `const failed: Job = { ...j, state: "error", error: errorOf(e), lastError: e.message, blob: undefined };`; `stop.tsx:51-52,76` the door step shows the photo as taken but `doorConfirmed` stays false, so the code step stays locked with no message; only pickup (`pickup.tsx:94`) and the code job (`stop.tsx:207`) show errors. Jobs survive sign-out (`session.ts:80-85`), so another rider on the same phone sends them under their own token.
- Why it matters: proof of delivery is lost, and the rider is stuck without knowing why.
- Smallest fix: keep the blob, show "Upload refused, retake", tag jobs with the rider id.
- Test that proves it: rider e2e (once TEST-04 runs in CI): mock API refuses a photo with 4xx, the stop shows the retake message.

**LEAK-08 | P2 (lost enquiry) | No prefilled link when enquiries are switched off**

- Evidence: `shop/pages.js:800` `if (e.status === 404) return 'Bulk orders are paused right now. Message us on WhatsApp instead.'`; `bulk.js:392` the same, with no link.
- Why it matters: the customer must retype everything into WhatsApp; many will not.
- Smallest fix: render the existing `bulkWhatsApp(text)` (`bulk.js:422-427`) with the form contents.
- Test that proves it: shop spec with the route returning 404: a wa.me link containing the quantity is shown.

**LEAK-04 | P2 | Favourites device-only**

- Evidence: `shop/shelf.js:467` `toast(favorites.includes(id) ? 'Saved to your favourites on this device' : 'Removed from favourites')`; contradicts `docs/app-feel.md:180-190`.
- Why it matters: favourites vanish on a new phone; minor lost repeat sales.
- Smallest fix: when signed in, call `PUT`/`DELETE /me/favourites` and `/merge`.
- Test that proves it: shop spec: favourite on one context, sign in on another, favourite shown.

**LEAK-05 | P2 | No funnel or abandoned-checkout signal**

- Evidence: `/v1/events` (`mango-api/src/growth-routes.js:39`) and `funnelId` on confirm (`customer.js:1230`) are never sent by the shop.
- Why it matters: the owner cannot see where customers drop out of checkout.
- Smallest fix: a small `track(step)` in `shop/api.js`.
- Test that proves it: shop spec asserts one `/v1/events` call per checkout step.

**Docs vs code**

- `docs/app-feel.md:180-190` says favourites sync; the shop says "on this device" (`shelf.js:467`).
- Brief's bulk-enquiry premise corrected above.

**UNVERIFIED**

- Production values of `HELP_CENTRE`, `FAVOURITES`, `FUNNEL_ANALYTICS`, `SUPPORT_WHATSAPP`.
- Whether a rider photo uploaded the next day is refused with a 4xx.

---

## 5. Verified OK

Do not rework any of these.

**Fork vs upstream**

- Upstream Partner Network fixes already in the fork: requireManager, length limits, supplier type, X-Upload-Token (`mango-api/src/app.js:84-85`), Turnstile action (`mango-api/src/turnstile.js:27`).
- Fork partner code is a superset: retention erase (`mango-api/src/maintenance.js:467-471`), privacy path (`shop/partner.js:296-299`).
- Shop sends CSP, HSTS, X-Frame-Options DENY, nosniff (`shop/vercel.json:10-33`), guarded by `tests/csp.spec.ts:61-68`.
- `shop/sw.js` offline fallback never caches `/v1/`; no config still references `customer-app/`.

**Stock and checkout**

- Guarded take `inventory.js:233-234` (`UPDATE ... WHERE floor(on_hand*f)-held-committed-reserve_buffer >= qty`) and constraint `batch_lines_no_oversell` (`migrations/001_init.sql:54-60`), never dropped; one lock order everywhere (`inventory.js:283`).
- Repeat submits: same-key claim row first (`customer.js:1249-1250`), 422 for a different body, 7-day TTL (`maintenance.js:163`), key scoped per customer; a different key cannot make a second order because the quote is single-use (FOR UPDATE then DELETE, `customer.js:1251,1310`) and the customer row lock serialises checkouts.
- Prices frozen at the quote; bulk lines repriced (PRICE_CHANGED); promo re-checked under lock; confirm body cannot carry prices, fee or promo; order total never updated after creation.
- kg upserts race-safe (`plan-kg.js:38-50`, `preorders.js:266-271`); advisory locks guard pre-order allocation (`preorders.js:948`) and planned fulfilment (`plan-orders.js:208`).
- Existing proofs: `concurrency.test.js:17,43`; `business-invariants.test.js:430,462`; `review-fixes.test.js:93`; `remediation-p0.test.js:72,131`; `holdback.test.js:178`; `bulk-deals.test.js:366`; `preorders.test.js:720`; `lock-order.test.js:39`; `flow.test.js:245`.
- Gifts, farm bookings and bulk orders keep one key per attempt (`shop/gifts.js:1109`); a pre-order retried with a new key is refused UNPAID_PREORDER_EXISTS.

**Payments and webhooks**

- Raw-body HMAC, constant time, before DB (`app.js:176-181`, `payments.js:152-165`); Checkout HMAC (`payments.js:175-178`); verify-payment asks Razorpay (`customer.js:1633-1636`).
- Store first, dedupe in the same transaction (`webhook-events.js:33-44`, `payments.js:374-376`); replay capped at 5 (`webhook-events.js:105-145`).
- Only Razorpay's own ids trusted (`payments.js:187-207`, `bulk-orders.js:173`); `checkCapture` on every path (`payments.js:249-305`); stale and late capture handling (`orders.js:531-572`).
- Refund claim, back-off, give-up and gateway lookup (`payments.js:886-1069`); failed refund reopened and resent (`:619-652`); hourly refund-status check (`:664`); chargeback hold (`:999`).
- DEMO_PAYMENTS and DEMO_OTP make the API exit in production (`env.js:544-551`).
- Shop payment return polls `/payment-status` and does not rely on the webhook alone (`shop/app.js:131-133`).

**Authorization**

- Route-inventory and role-policy snapshot tests (`auth-matrix.test.js:40-58,196-209`; `security-readiness.test.js:125-140`); `ID_SEGMENT` (`access.js:40-41`).
- Step-up design: per request, TOTP spent once, Postgres counter, rollback with the transaction (`admin/step-up.js:40-94`; `step-up-routes.test.js:279-307`).
- Status change cannot cancel or confirm (`STAFF_TRANSITIONS`, `orders.js:84-89`), so no paid-cancel step-up bypass; delivered without proof needs manager + reason (`orders.js:955-960`).
- Tokens re-checked against DB on every request (`auth.js:148-228`); refresh rotation, reuse revocation and session caps (`flow.test.js:48`; `security-readiness.test.js:568,588`).
- OTP hashing and Postgres counters (`customer.js:156-163`, `ratelimit.js:13-23`); Google sign-in checks issuer, audience, RS256, email_verified (`google.js:31-45`); rider PIN lockout (`admin/rider-auth.js:25-33,218-226`).
- Staff removal, role, password or two-step reset ends access at once (`admin/staff.js:52,178-183,208-209,252`; `auth-matrix.test.js:381-423`; `security-readiness.test.js:525`).
- Rider/packer scoping (`access.js:313-344`; `admin/deliveries.js:51,136-139,228-230`; `delivery-proof.js:315-316`); customer IDOR isolation (`security-readiness.test.js:136,254`).
- Signed bill links (`bill-link.js:14-33`, `bill-routes.js:31-48`); public review photos limited to approved; exports manager-only, audited, no phone or address (`admin/exports.js:7`).
- CORS explicit list with credentials, no wildcard (`app.js:81-88`); refresh/logout Origin check (`auth.js:260-265`, `review-fixes.test.js:248`); Turnstile on OTP, add phone and Partner With Us, hostname and action checked (`turnstile.js:40`; `preflight.js:132-135`).

**Database**

- Integer paise throughout (`001_init.sql:1`); oversell CHECK (`001:59`); bill trigger and snapshot (`035:38-80`, `bill-pdf.js:192`).
- Customer FKs on orders/preorders/gift_orders NO ACTION and bills undeletable, so 8-year retention holds; erasure anonymises instead of deleting.
- Checksums and atomic per-file migrations (`migrations.test.js:186,215`); migration lints (`:47,101,130-151`); environment stamp refuses preview builds on production DB (`migrate.js:51-64`, `preflight.js:114-118`). No CONCURRENTLY by design (small tables, `lock_timeout 5s`).
- `previous-release-on-new-schema` (`ci.yml:147-173`, `scripts/n-minus-1.sh`) makes rollback and deploy windows safe.
- Indexes for hold sweep, refunds due/pending, notifications due, webhook replay (`045:99`), rider day list, customer orders, WhatsApp/push queues and cleanup deletes; none missing that matters at seasonal volume.
- `db.js` type parsers and per-client query queueing (`db-serial.test.js`); only transaction-scoped advisory locks, safe with PgBouncer.

**Background work**

- `waitUntil` with DB-backed redo for every money task (`background.js:12-23`; `maintenance.js:409`; `payments.js:846-850,1110`).
- Lease (`maintenance.js:144-153,348-371`); time budget, slices and resume cursor (`:59,217-242`); failure recording and Sentry dedupe (`:105-130`); constant-time cron secret, fail-closed (`app.js:148-151`).
- `ops_counters` never slow a request (`ops-counters.test.js:87-209`); sign-in rate limits in Postgres (`ratelimit.js`); `attachDatabasePool` and pool of 5 (`db.js:50`, `env.js:34`); cold instance loads stock and rules before the first request (`cold-start.test.js:36`).

**Production safety**

- Preflight at every production cold start and in build, refusing rather than logging (`env.js:575-581`).
- Fake gateway and demo-pay blocked in production; `/v1/dev` blocked in production and needs no keys (`env.js:507`, `app.js:306`); demo staff never in production (`seed.js:108-117`).
- Preview/production DB separation via `PRODUCTION_DB_HOST` (`preflight.js:114-118`) and the migrate environment stamp (`migrate.js:60-61`).
- Missing `CRON_SECRET` fails closed (`app.js:148-150`); bundle scan comprehensive and unit-tested (`scripts/scan-bundle.mjs:41-55`, `tests/unit/scan-bundle.unit.ts`).
- **Committed secrets: none.** All 687 revisions grepped; every hit is a fixture or placeholder (`mango-api/test/smoke.test.js:159`, `tests/unit/scan-bundle.unit.ts:25-26,74`, `mango-api/ops/load/start-api.sh:29`, `test/security-fixes.test.js:280`, `test/preflight.test.js:29`). Only `.env.example` files ever added; no `.vercel/`, `.env` or key file tracked now.

**Tests**

- PgBouncer transaction-mode pass (`ci.yml:120-142`); `forceOrderState` scoped to one SET LOCAL transaction (`helpers.js:39-48`); n-minus-1 job; wrong-code lockout on delivery codes.
- Real-adapter Razorpay tests via stubbed fetch in ~10 files; HMAC-signed webhooks in helpers (`helpers.js:135-138`).

**Disaster recovery**

- Encryption enforced, plaintext and private keys refused (`ops/backup.sh:64-83`, `backup.test.js:93-124`); dump read-back (`backup.test.js:164`); heartbeat role least-privilege (`:335`); restore-check and drill tooling with stock-ledger balance (`:390`); real-restore follow-up scripts exist (`ops/bump-sequences.js`, `replay-payments.js`, `reapply-deletions.js`).

**Business leaks**

- Bulk and farm enquiries are server records with a stable key per form; WhatsApp button is an extra prefilled copy (`shop/pages.js:836-860`, `shop/bulk.js:379-387`).
- `shop/sw.js` never queues or replays POSTs.
- Rider queue idempotency and retry on 5xx/408/429/401 (`rider-app/lib/queue.ts`).

---

## 6. Prioritized fix plan

Effort: S = under 1 hour, M = half a day, L = 1-2 days. Phases are ordered so nothing depends on something not yet built.

### Phase 0: Owner actions, no code

| # | Item | Finding | Where | Action | Effort | Proof |
|---|---|---|---|---|---|---|
| 0.1 | Set backup secrets | BKP-01 | GitHub repo secrets; Neon console | Read-only Neon role; GPG keypair (private key offline); set `BACKUP_DATABASE_URL`, `BACKUP_GPG_PUBLIC_KEY`, `BACKUP_HEARTBEAT_DATABASE_URL` | S | `gh secret list` shows three secrets |
| 0.2 | Run the Backup workflow by hand, then a restore-check | BKP-01, BKP-05 | Actions → Backup; `ops/restore-check.sh`, `ops/restore-drill.sh` | Run once, record restore minutes in `deploy/RESTORE-DRILL.md` | M | Green run with `.gpg` artifact; drill log row |
| 0.3 | Set `BACKUP_HEARTBEAT_EXPECTED=true` in Vercel production | BKP-02 | Vercel env | After 0.2 is green | S | Needs attention shows backup state |
| 0.4 | Confirm Vercel plan and cron | CRON-01, SRV-02 | Vercel dashboard | Pro with every-minute cron, or choose the GitHub pinger and set `MAINTENANCE_URL`, `CRON_SECRET` secrets | S | `maintenance_runs` shows a row every minute (or 5) |
| 0.5 | Confirm Preview and Production `JWT_SECRET` differ | AUTH-02 | Vercel env | Compare without revealing; rotate the preview one if equal | S | Owner confirmation |
| 0.6 | Confirm Neon PITR window (raise to 7 days) | BKP-05 | Neon console | Set and record window | S | `deploy/VERCEL.md:485` ticked |
| 0.7 | Answer the paid bulk-order ceiling | STOCK-02 | Owner | kg per order and/or per week | S | Number recorded |
| 0.8 | Confirm `DATABASE_URL_UNPOOLED`, `TOTP_ENCRYPTION_KEY`, `RAZORPAY_KEY_ID` prefix, `RIDER_ORIGIN` in Vercel production | DB-04, AREA7-03, AREA7-02, AUTH-06 | Vercel env | Set missing values | S | Values present (needed before the matching preflight errors ship) |

### Phase 1: Go-live blockers, small code

| # | Item | Finding | File(s) | Change | Effort | Test to add |
|---|---|---|---|---|---|---|
| 1.1 | Cron cadence enforcement | CRON-01 | `mango-api/vercel.json`; `.github/workflows/maintenance-ping.yml`; `mango-api/src/preflight.js` | Every-minute schedule (Pro) or merge ping workflow to `main` and `exit 1` when secrets unset; preflight errors unless cadence acknowledged | M | CI check over `vercel.json` and ping workflow; `preflight.test.js` production-on-Vercel case |
| 1.2 | Alarm interval matches schedule | SRV-02 | `mango-api/src/sentry.js:101`; `mango-api/src/readiness.js:10`; `alert-checks.js` | One `MAINTENANCE_INTERVAL_S` setting feeds monitor and stale threshold | S | Readiness and alert-checks tests at 5-minute interval |
| 1.3 | Backup heartbeat default and preflight error | BKP-02 | `mango-api/src/env.js:459-462`; `mango-api/src/preflight.js` | Default true in production; error when off | S | `backup.test.js` missed-backup case; `preflight.test.js` |
| 1.4 | `rzp_test_` in production is an error | AREA7-02 | `mango-api/src/preflight.js:57` | Error unless `ALLOW_TEST_PAYMENTS_IN_PRODUCTION=true` | S | `preflight.test.js` test-key case |
| 1.5 | Shop Idempotency-Key per quote | STOCK-01 | `shop/api.js:106,115`; `shop/app.js:129` | `confirm(body,key)` / `bookPreorder(body,key)`; key created per quote, reset on re-quote | S | `shop-payments.test.js` same-key retry; static check no inline `idem()` |
| 1.6 | Turnstile on enquiry forms | AUTH-01 | `mango-api/src/bulk-enquiry-routes.js:68-73,95-100`; `shop/pages.js`, `shop/bulk.js` | `requireHuman(..., {action:'bulk'})`; shop sends token; shop-wide daily cap | M | `bulk-enquiries.test.js`, `farm-visit-enquiries.test.js` CAPTCHA_REQUIRED, no notification row |
| 1.7 | JWT audience claim | AUTH-02 | `mango-api/src/auth.js:26,135`; `bill-link.js:13` | Sign and verify `aud = deployEnv` with a short transition window | M | `auth-matrix.test.js` aud=preview → 401 |
| 1.8 | Paid bulk-order ceiling | STOCK-02 | `mango-api/src/bulk-orders.js:107-126` | Reject over the owner's kg ceiling with 409 | S | `bulk-orders.test.js` over-ceiling → 409, no link |
| 1.9 | Refuse orphan migration versions | AREA1-01 | `mango-api/src/migrate.js:89-90` | Error when `schema_migrations` has a version with no file | S | `migrations.test.js` orphan `052_partner_network.sql` row |
| 1.10 | Off-site backup copy | BKP-04 | `.github/workflows/backup.yml:75-81` | Pass `BACKUP_UPLOAD_CMD` to separate object-locked bucket; monthly long copy | M | `backup.test.js` upload command invoked |

Dependencies: 1.1 and 1.2 follow the 0.4 decision. 1.3 follows 0.2 (otherwise permanent red). 1.4 follows 0.8 (a test key in production would fail the build). 1.7 follows 0.5 and the one-time sign-out answer (Question 2). 1.8 follows 0.7. 1.10 follows 0.1.

### Phase 2: Customer-facing gaps

| # | Item | Finding | File(s) | Change | Effort | Test to add |
|---|---|---|---|---|---|---|
| 2.1 | CSP allows error ingest | SHOP-01 | `shop/vercel.json:30,55`; `tests/csp.spec.ts` | Add ingest host to `connect-src` (and per-environment API origin, AREA1-06) | S | `csp.spec.ts` `expectShopSources` |
| 2.2 | Shop error reporting | SHOP-01 | `shop/app.js`; `shop/config.js`; `shared/error-reports/` | `onerror`/`unhandledrejection` + 5xx reporter behind DSN | M | Shop spec throws, asserts one report |
| 2.3 | Privacy text | AREA1-02 | `shop/help.js:63` | Restore 8-year bill and 12-month PII sentences | S | Node test text contains "8 years", "12 months" |
| 2.4 | Help centre on + order number | LEAK-01 | Vercel env `HELP_CENTRE=true`; `shop/help.js:90` | Turn on; prefill order number in WhatsApp text | S | `care.test.js`; shop spec link contains order number |
| 2.5 | Stock-alert merge fix | DB-02 | `mango-api/src/customer.js:879-907` | Move or delete `stock_alerts` in merge | S | Account-join test with open alert |
| 2.6 | Back-in-stock button | LEAK-02 | `shop/shelf.js:120`; `shop/api.js` | "Tell me when it's back" → `POST /v1/stock-alerts` | M | Shop spec creates one alert |
| 2.7 | Reschedule button | LEAK-03 | `shop/` order page; `shop/api.js` | "Change delivery day" using `/v1/orders/:id/reschedule` | M | Shop spec changes date |
| 2.8 | shop:test loop | AREA1-05 | `package.json:22` | `node --check` every `shop/*.js` | S | Broken `help.js` fails CI |
| 2.9 | Shop journey e2e | TEST-01 | `tests/shop-journey.spec.ts`; `.github/workflows/ci.yml` e2e job | Box → OTP → quote → confirm → demo-pay → success; guest bulk enquiry; claim; STOCK-01 retry | L | The spec itself |
| 2.10 | Photo backup | BKP-03 | `.github/workflows/backup.yml` or new weekly workflow | Sync Blob objects into encrypted off-site copy, or owner records acceptance | M | `backup.test.js` workflow-level check |

Dependencies: 2.1 before 2.2 (CSP blocks reports otherwise; also needs a DSN, Question 18). 2.4: `HELP_CENTRE` on before the order-number prefill matters for signed-in users. 2.5 before 2.6. 2.8 before 2.9; 2.9 after 1.5 for the retry case. 2.10 after 1.10.

### Phase 3: Hardening and hygiene (all P2)

| # | Finding | File(s) | Change | Effort | Test to add |
|---|---|---|---|---|---|
| 3.1 | PAY-02 | `mango-api/src/payments.js:1312-1332` | Call `flagGatewayRefunds` at end of `reconcileRecentPayments` | S | `audit-a-payments.test.js` PAY-08 hand refund flagged |
| 3.2 | STOCK-04 | `mango-api/src/orders.js:1341` | Add `reconcile_checked_at` grace to `EXPIRED_HOLDS` | S | `pay-fixes.test.js` PAY-B5 via `sweepExpiredHoldsEach` |
| 3.3 | AUTH-04 | `mango-api/src/admin/recovery.js:138-152`; `admin/partner.js:190-196`; preorder move; `admin/policy.js` | `stepUp(req,{always:true})`; list in policy | S | `step-up-routes.test.js` |
| 3.4 | AUTH-03 | `mango-api/src/bulk-enquiries.js:363,392-404`; `bulk-orders.js:82` | Phone match read-only; `customer_id` for writes | M | `bulk-enquiries.test.js` typo phone cannot answer |
| 3.5 | DB-03 | new migration; `orders.js:185`; `bills.js:199` | `order_items.product_name` snapshot; COALESCE | M | Bills test rename after pay |
| 3.6 | SRV-04 | `mango-api/src/customer.js:1010` | Read price/sellability in checkout tx | M | Price change seen immediately |
| 3.7 | STOCK-03 | `mango-api/src/customer.js:1223` | Refuse address with a different 6-digit pincode | S | `delivery-fee.test.js` |
| 3.8 | LEAK-07 | `rider-app/lib/queue.ts:182`; `stop.tsx` | Keep blob, show retake message, tag rider id | M | Rider e2e (after 3.21) |
| 3.9 | DB-04 | `mango-api/src/migrate.js:34` | Throw on Vercel without unpooled URL (after 0.8) | S | `migrations.test.js` |
| 3.10 | AREA7-03 | `mango-api/src/preflight.js:143` | Error in production without `TOTP_ENCRYPTION_KEY` (after 0.8) | S | `preflight.test.js` |
| 3.11 | PAY-01 | `mango-api/src/payments.js:286` | `currency !== 'INR'` | S | `audit-fixes.test.js:123` currency omitted |
| 3.12 | PAY-03 | `mango-api/src/admin/reports.js:177-179` | Same seven tables as `knownPayment` | S | `hardening.test.js:108` |
| 3.13 | DB-01 | `mango-api/src/farm/staff.js:30-31,140`; `farm/settings.js:158` | IST day boundaries; `todayIST()` | S | Farm test 20:00Z booking |
| 3.14 | DB-06 | `migrations-pending/056_drop_delivery_code.sql`; `delivery-code.js:41,53-55`; `orders.js:1027` | Run hashing script, remove reads, ship as 089 | M | Duplicate-number lint; delivery tests |
| 3.15 | AUTH-05 | `mango-api/src/auth.js:74` | Grace returns access token only | S | `flow.test.js` customer grace case |
| 3.16 | AUTH-06 | `mango-api/src/preflight.js:90` | Include `RIDER_ORIGIN` (after 0.8) | S | `preflight.test.js:50` |
| 3.17 | LEAK-08 | `shop/pages.js:800`; `shop/bulk.js:392` | Render `bulkWhatsApp(text)` link | S | Shop spec 404 path |
| 3.18 | LEAK-04 | `shop/shelf.js:464-467` | Sync favourites when signed in | M | Shop spec two contexts |
| 3.19 | LEAK-05 | `shop/api.js` | `track(step)` to `/v1/events`, send `funnelId` | S | Shop spec event per step |
| 3.20 | AREA1-06 | `shop/vercel.json:30,55`; `build-config.mjs` | Per-environment API origin in CSP (with 2.1) | S | `csp.spec.ts` |
| 3.20a | AREA1-07 | `shop/build-config.mjs`; `shop/vercel.json:87-89` | Write the /v1 rewrite from API_URL per environment | S | unit test in `tests/unit/` |
| 3.21 | TEST-04 | `.github/workflows/ci.yml` | `npm --prefix rider-app run e2e` | S | CI shows rider e2e |
| 3.22 | AREA1-04 | `ci.yml:246-247`; `docs/languages.md` | Document English-only, drop `SHOP_LANGUAGES` (or rebuild, owner) | S | CI grep |
| 3.23 | DB-05 | build script / `deploy/VERCEL.md` | Preview builds migrate only for staging ref, or document | S | Build script unit test |
| 3.24 | SRV-05 | `mango-api/src/events.js:85` | App-role LISTEN URL; poll on pooler-only | M | Events unit test |
| 3.25 | AREA7-04 | `.gitignore` | Add `.env.*`, `!.env.example`, `*.pem`, `*.key` | S | `git check-ignore` |
| 3.26 | TEST-08 | `src/pages/NeedsAttention.tsx:11` | Add `'partner-retention'` label | S | `npm run test:unit` green |
| 3.27 | TEST-03 | `mango-api/test/preorder-plan.test.js:279-286` | Exact `[2002,2004]`; split deterministic cases | M | The split tests |
| 3.28 | TEST-05 | `test/razorpay-fixtures.test.js:56`; `backup.test.js`; `ci.yml` | Record sandbox fixtures; real restore CI step | M | Un-skipped replay; restore step |
| 3.29 | TEST-06 | `audit-b-security.test.js:79`; `pay-fixes.test.js:287`; `rider-app.test.js:252`; `preorder-plan.test.js:281` | Loosen or replace wall-clock checks | S | Repeated CI runs |
| 3.30 | TEST-07 | `mango-api/test/helpers.js:21-30` | Template DB clone per reset | L | Same pass count, faster |
| 3.31 | PAY-04 | `mango-api/src/orders.js:629` | Remove warning or throw | S | Existing mismatch tests |
| 3.32 | HYG-01 | seven files listed in 4.8 | Drop unused exports | S | knip clean |
| 3.33 | BKP-05 | `deploy/RESTORE-DRILL.md` | Monthly drill, record RTO (first run in 0.2) | S | Drill log rows |

Note: 3.26 (TEST-08) is S and currently fails CI; it can be pulled forward into Phase 1 at no cost so CI is green while Phase 1 lands.

---

## 7. Questions for the business owner or original author

1. Is production on Vercel Pro with an every-minute cron set in the dashboard? If not, which pinger is live? Unblocks CRON-01 (severity and fix), SRV-02.
2. Do the Preview and Production `JWT_SECRET` values differ, and is a one-time sign-out of all customers acceptable to add an environment claim? Unblocks AUTH-02.
3. Which Neon plan, and what is the PITR window today? Unblocks BKP-01, BKP-05.
4. Who holds the GPG private key offline, and how long must DB backups be retained given 8-year bills? Unblocks BKP-01, BKP-04.
5. Is losing delivery-proof and claim photos acceptable (GO-LIVE item 14)? Unblocks BKP-03.
6. What is the ceiling for paid bulk orders (kg per order and/or per week)? Unblocks STOCK-02.
7. Will `maxUnpaidOrders` ever be raised above 1? If yes, STOCK-01 becomes P0.
8. Are refunds ever made by hand in the Razorpay dashboard? Unblocks PAY-02 severity (P1 if yes). Is settlement-level reconciliation wanted? (scope note on PAY-02).
9. Should anonymous enquiries send WhatsApp to the typed number at all, and can the shop's bulk and farm-visit forms carry Turnstile? Unblocks AUTH-01, AUTH-03.
10. Is resolving an unmatched payment without a refund ever the right action? Unblocks AUTH-04.
11. Do packers also deliver (they may record deliveries and dispatch the manifest)? Confirms the role policy (no finding; affects AUTH-04's scope).
12. Is a pre-season test-key week in production intended? Unblocks AREA7-02.
13. Was any shared database ever migrated by upstream code, and should the fork keep pulling from upstream at all (if not, drop the `farm-src` remote)? Unblocks AREA1-01.
14. Are Hindi and Kannada wanted this season? Unblocks AREA1-04.
15. Who monitors `/ready`, who is on the alert rota, and should a stopped job also WhatsApp the owner? Unblocks SRV-02.
16. Should a product rename ever change past bills? Unblocks DB-03.
17. Is pending migration 056 still wanted, and has `ops/hash-delivery-codes.js` run on production? Unblocks DB-06.
18. Is there a Sentry DSN for the shop? Unblocks SHOP-01.
19. Is WhatsApp the system of record for complaints this season? Unblocks LEAK-01.
20. Was dropping reschedule and back-in-stock from the shop deliberate? Unblocks LEAK-02, LEAK-03.
21. Should a price change apply to carts already open? Unblocks SRV-04.
22. Should an UNPAID pre-order booking push PAID bookings to later weeks? Unblocks TEST-03.
23. Is `DATABASE_URL_UNPOOLED` set on Vercel production? Unblocks DB-04, SRV-05.
24. What are the production values of `HELP_CENTRE`, `FAVOURITES`, `FUNNEL_ANALYTICS`, `SUPPORT_WHATSAPP`, `SENTRY_DSN`, `PAYMENT_DAILY_RECON`, `TOTP_ENCRYPTION_KEY`? Unblocks LEAK-01, LEAK-04, LEAK-05, SHOP-01, PAY-02, AREA7-03.
25. Are the WhatsApp enquiry-receipt templates approved by Meta? Unblocks AUTH-01 (impact).

---

## Appendix A: Local and CI check results

| Check | Where | Result | Notes |
|---|---|---|---|
| `npm run typecheck` | local | PASS | panel + tests tsconfig |
| `npm run lint` | local | PASS | panel + rider-app |
| `npm run shop:test` | local | PASS | `node --check` on 15 of 31 shop files only (AREA1-05) |
| `npm run test:unit` | local | FAIL | `tests/unit/step-labels.unit.ts:19`: 'partner-retention' has no label (TEST-08) |
| API `node --check` | local | PASS | syntax only |
| knip | local | 7 unused exports | FARM_VISIT_STATUSES, BULK_ORDER_STEPS, publish, resetAttention, moneyOf, addPreorderEvent, SEASON_PHASES (HYG-01) |
| API test suite | local | NOT RUN | no Postgres or Docker on the audit machine; tests read instead |
| CI run 45155077756 (commit 696aa51), api job | CI | FAIL | only `preorder-plan.test.js` "thousands of bookings recalculate in bounded statements" (TEST-03) |
| CI run 45155077756, previous-release-on-new-schema | CI | PASS | |
| CI run 45155077756, production-images | CI | PASS | |
| CI run 45161320834 (commit e2abdc3), build-and-test | CI | FAIL | unit tests (step-labels, TEST-08) |
| CI run 45161320834, api job | CI | PENDING | result not available when the audit was written |
| Backup workflow, nightly 2026-11-17 to 2026-11-23 | CI | FAIL every night | runs 44227102786 … 45096932075: "No backup taken: set the BACKUP_DATABASE_URL and BACKUP_GPG_PUBLIC_KEY secrets" (BKP-01) |
| maintenance-ping workflow | CI | NOT SCHEDULED | `gh run list` → 404 not found on the default branch (CRON-01) |

## Appendix B: Fork vs upstream merge-conflict file list

From report A. `git merge farm-src/main` would conflict as follows. **Do not merge**: the fork already contains everything in upstream mango-api (Partner Network squashed in `83a0aaf`); cherry-pick only.

**add/add**

- every `mango-api/src/partner/*.js`
- `mango-api/src/admin/partner.js`
- `mango-api/test/partner-network.test.js`
- `src/pages/partner/*`
- `docs/partner-network.md`

**content conflicts**

- `mango-api/src/app.js`
- `mango-api/src/env.js`
- `mango-api/src/customer.js`
- `mango-api/src/maintenance.js`
- `mango-api/src/notify.js`
- `mango-api/src/turnstile.js`
- `mango-api/src/wa/registry.js`
- `mango-api/src/admin/policy.js`
- `mango-api/src/access.js`
- `mango-api/test/fixtures/role-policy.json`
- `mango-api/test/fixtures/route-inventory.json`
- `src/App.tsx` (panel)
- `src/Layout.tsx` (panel)
- `src/permissions.ts` (panel)
- `src/styles.css` (panel)

**modify/delete**

- 11 files under `customer-app/` (removed on this branch, modified upstream)

**migration numbering**

- upstream `052_partner_network.sql`, `053_validate_partner_checks.sql` vs fork `052_demo_seed_runs.sql`, `053_rider_app.sql`; fork carries the partner schema as `058_partner_network.sql`, `059_...` (AREA1-01).
