# 24 Oct 2026 audit, part B: status register

Covers every finding in `audit-2026-10-24/security.md`, `security-endpoints.md`,
`integrations.md` and `platform.md`. Branch `wip/auditb`, from `61ac961`.
What was built, the flags and the rollout order: [audit-b-fixes.md](audit-b-fixes.md).

**Status values**
- **fixed**: changed on this branch, with a test that failed on the old code (flag-pinned-off or base-file run) and passes now.
- **already fixed**: fixed before this branch; the evidence is the line that does it.
- **needs owner**: a decision, an account or an outside setting that code can't make.
- **not worth fixing**: the reason is given.

Flag names in brackets: the env flag that turns the fix on. Unset, each is on in production and off elsewhere; `false` turns it off (preflight warns).

## Security (security.md)

| ID | Finding | Status | Evidence | Commit |
|---|---|---|---|---|
| SEC-01 | Phone-link proxy's `/v1/dev` block bypassed by case; dev API on every interface | fixed (no flag) | `customer-app/dev-server.ts:25` `isDevPath` decodes and lower-cases before matching, `:66` proxy bypass; `mango-api/src/env.js:22` `HOST`, `src/index.js:18-19` listens on it. Tests: `customer-app/tests/unit/dev-server.unit.ts`; `mango-api/test/audit-b-platform.test.js` "PLT-14 … and SEC-01: HOST" (log shows `"host":"127.0.0.1"`). Owner/integrator: `scripts/start-local.mjs` should set `HOST=127.0.0.1` and, when sharing, `ENABLE_DEV_ROUTES=false` (not edited here, by rule). | 6573215 |
| SEC-02 | Framework 4xx errors become 500 and a Sentry event | fixed [API_HARDENING] | `mango-api/src/http-contract.js:53` `clientErrorOf` (body-parser and path-decoding errors only), `src/app.js:298`. Test: `test/audit-b-security.test.js` "SEC-02 …" (400 / 415, `onErrorForTests` sees nothing; flag off: 500). | b761add |
| SEC-03 | body-parser 1.20.8 advisory | already fixed | `mango-api/package-lock.json:1231` body-parser 1.20.9 (commit eaa0aeb). | eaa0aeb |
| SEC-04 | zod 3 validates every element of an over-long array | already fixed | `mango-api/package.json:37` zod ^4.6.7, `:39-40` and root `package.json:41-42` overrides (eaa0aeb). Timing regression test added: `test/audit-b-security.test.js` "SEC-04 …". | eaa0aeb (test b761add) |
| SEC-05 | CI dependency gate fails before every test | already fixed | Same bumps as SEC-03/04; `.github/workflows/ci.yml:23-24,83-84` gate unchanged; `npm audit --omit=dev` reported 0 vulnerabilities in this worktree. | eaa0aeb |
| SEC-06 | A rider takes every unassigned packed stop for three days in one call | fixed [DELIVERY_CHECKS]; residual needs owner | `mango-api/src/orders.js:731-736` OUT_FOR_DELIVERY refused with 409 `NOT_DUE_YET` before the delivery date unless a manager overrides with a reason. The override is reachable in the panel: `src/pages/OrderDetail.tsx:91` `OVERRIDABLE` includes `NOT_DUE_YET`, so the refusal opens "Send it out anyway?" with a reason. Tests: `test/audit-b-delivery.test.js` "SEC-06, PLT-07 …"; `tests/audit-b-attention.spec.ts` "a manager sends an order out before its day …" (failed on the old panel: no dialog). Residual: a rider can still take *today's* unassigned stops (that is how riders self-assign today); whether to require assignment is the owner's call. | 78ac1f5, 3c2dd97 |
| SEC-07 | No step-up for staff management | fixed [STAFF_STEP_UP]; notification needs owner | `mango-api/src/admin/step-up.js:60` `stepUp` (own TOTP code, spent once, or password when two-step is off; each try counted atomically before the check, `:69`, so 5 wrong → 429 `REAUTH_LOCKED` for 15 min even in parallel), called after validation and target checks at `src/admin/staff.js:59,90,120,142,162`; turning your own two-step on from an ordinary session asks for the password (`src/admin/auth.js:238-245`), so a stolen token can't enroll its own authenticator and then answer step-up; the last manager with two-step on can't be removed or demoted (`staff.js:37` `keepATwoStepManager`, 409 `LAST_TWO_STEP_MANAGER`, managers locked in the transaction); `src/access.js` adds `confirmcode` to the secret keys. Panel: `src/StepUp.tsx:18`, `src/pages/Staff.tsx:28`, `src/pages/TwoStep.tsx` (setup asks for the password). Tests: `test/audit-b-staff.test.js` "SEC-07 …" (10: enrollment bypass, parallel burst of 30 → exactly 5 checked, code not spent on a 400/409, last two-step manager, each failed on the old code), `tests/audit-b-step-up.spec.ts` (4). Telling the affected person about a change needs a staff contact channel that does not exist: owner. | 36ce240, 5b7bd3e, 59be19b |
| SEC-08 | Staff audit rows best-effort after the response; reads of personal data not audited | fixed [STAFF_AUDIT_TRAIL]; retention needs owner | `mango-api/src/access.js:274` `auditInTx` (row in the change's own transaction) used in `src/admin/staff.js:73,103,127,147,170`, `src/admin/orders.js:177` (cancel), `src/admin/claims.js:144` (resolve), `src/admin/preorders.js:46` (a manager's booking cancel and its refund); `src/admin/recovery.js` already wrote in the transaction; `access.js:285-296` read audit for order detail, order search (no search words), manifest, claims and photos, once per person/route/target per 10 min; `access.js:301` `watchRefusals` logs 403s with who and where; `src/admin/reports.js:252-256` `/audit?reads=`. Panel checkbox `src/pages/Staff.tsx:534`. Tests: `test/audit-b-staff.test.js` "SEC-08 …" (6, including "a manager's booking cancel and its audit row commit together", which failed on the old code), `tests/audit-b-step-up.spec.ts` "Activity can include views …". `staff_audit` retention (prior R-14) is an owner decision. | 512a8c5, 2793005 |
| SEC-09 | API contract gaps | partly fixed [API_HARDENING]; rest not worth fixing now | 405 + `Allow` (`src/http-contract.js:18` `routeMethods`, `src/app.js:244`), CORS `exposedHeaders` (`http-contract.js:7`, `app.js:81`), `retryAfterSeconds` in BUSY/UNAVAILABLE bodies (`app.js:30`). Tests: `test/audit-b-security.test.js` "SEC-09 …", `test/audit-b-outage.test.js`. Not done: `truncated` flags on capped lists (the caps are far above real volumes: 3 claims a month, 100 orders per customer) and an OpenAPI export (the audit's own spot-check found the shop types in agreement). Both are worth doing with a client change, not as a leftover. | b761add |
| SEC-10 | Tokens carry no issuer, audience or environment | needs owner | Not exploitable as documented (`deploy/VERCEL.md` asks for a different `JWT_SECRET` per environment). Verifying `iss`/`aud` rejects every token issued before the release (staff and customers signed out) unless a transition window is built, so the owner should choose when. Until then: confirm Preview and Production secrets differ. | — |
| SEC-11 | Raw error objects in logs carry a phone past key redaction | fixed (no flag) | `mango-api/src/logger.js:49-62` `scrubError` serializer: drops `detail`/`where`, runs `scrubText` over message and stack, recurses into `cause`. Test: `test/audit-b-security.test.js` "SEC-11 and INT-16 …". | b761add |

## Endpoint table (security-endpoints.md)

The table has no finding IDs of its own. Its defect notes map to findings above:
the "known defect" 500s → SEC-02; 404 for unknown methods, capped lists, `Retry-After` → SEC-09;
`/v1/dev` reachable through the proxy → SEC-01; the in-memory general rate limiter
(per serverless instance, as the table says) → PLT-12 item 6 (documented, owner relies on the Vercel
firewall rule). No route was added or removed on this branch, so `route-inventory.json` and
`role-policy.json` are unchanged.

## Integrations (integrations.md)

| ID | Finding | Status | Evidence | Commit |
|---|---|---|---|---|
| INT-01 | No named person receives any alert | needs owner | `deploy/VERCEL.md` §8 "Goes to" cells, the external pinger, the `/ready` uptime monitor and the Sentry alert rules are people and accounts. INT-03/06/07/08 below make the alerts worth receiving. | — |
| INT-02 | Phone-login outage alerts nobody on Vercel | already fixed | `mango-api/src/sms.js:103-146` `noteOtpTrouble` → `reportProblem` (eaa0aeb, `test/launch-base.test.js`). | eaa0aeb |
| INT-03 | A step failing every minute reaches Sentry once | fixed [OPS_ALERTS] | `mango-api/src/maintenance.js:95-102` reports a failing step again each hour (`alert-step-<name>` marker). Test: `test/audit-b-ops.test.js` "INT-03 …". | fe0bc64 |
| INT-04 | Stale messages after a cancel | fixed [PROVIDER_CHECKS] | `mango-api/src/notify.js:243-262` `staleSince` skips ripeness guides, reminders and booking messages for orders or bookings that moved on. Test: `test/audit-b-integrations.test.js` "INT-04 …" (3). | 9e3d1a3 |
| INT-05 | Erasure leaves booking messages pending with the phone | fixed (no flag) | `mango-api/src/privacy.js:77-80` blanks the phone and skips pending preorder notifications. Test: `test/audit-b-integrations.test.js` "INT-05 …". | 9e3d1a3 |
| INT-06 | Scheduler outage over 24 h silently drops every message | fixed [OPS_ALERTS] | `src/notify.js:277,288` record when a message was given up; `src/maintenance.js:387-392` `opsProblems` alerts; `src/admin/reports.js:108-109` lists them in Needs attention with Send again; panel `src/pages/NeedsAttention.tsx:36,295` "WhatsApp message never sent". Tests: `test/audit-b-ops.test.js` "INT-06 …", `tests/audit-b-attention.spec.ts`. | fe0bc64 |
| INT-07 | Failure alert needs 20 messages; "no provider" skips never alert | fixed [OPS_ALERTS] | `src/maintenance.js:364` 3 failures alert at any volume; `opsProblems` raises no-provider skips. Test: `test/audit-b-ops.test.js` "INT-07 …" (3). | fe0bc64 |
| INT-08 | WhatsApp webhook failures never reach Sentry | fixed [OPS_ALERTS] | `opsProblems` alerts on 3+ webhook failures an hour; `src/chat.js:724-725` reports a captured WhatsApp payment with no order at once. Test: `test/audit-b-ops.test.js` "INT-08 …" (3). | fe0bc64 |
| INT-09 | Meta errors classified by HTTP status only | fixed [PROVIDER_CHECKS] | `mango-api/src/whatsapp.js:20` `META_TEMPORARY_CODES`, `:52`, `:173`. Test: `test/audit-b-integrations.test.js` "INT-09 …" (3). | 9e3d1a3 |
| INT-10 | WhatsApp login code "accepted" treated as delivered | fixed [PROVIDER_CHECKS]; launch rule needs owner | `src/sms.js:87` keeps the message id, `:120-142` `otpMessageFailed` and the `whatsapp-undelivered` alert; `src/notify.js:334` status webhook. Test: `test/audit-b-integrations.test.js` "INT-10 …". The customer is still not told in the moment (a later status can't reach the open sign-in screen): the owner should not launch WhatsApp-only login codes. | 9e3d1a3 |
| INT-11 | Blob `list` every minute, first 1000 uploads only | fixed [PROVIDER_CHECKS] | `src/review-jobs.js:54-63` hourly `blobSweepDue`; `src/photos.js:38,68` pages (up to 10). Test: `test/audit-b-integrations.test.js` "INT-11 and INT-14 …". | 9e3d1a3 |
| INT-12 | Chat replies are fire-and-forget | partly fixed [PROVIDER_CHECKS] | `src/chat.js:652-668` one retry after 1.5 s for a temporary Meta error. Test: `test/audit-b-integrations.test.js` "INT-12 …" (2). Not done: an outbox for chat replies (a payment link lost after the retry still needs the customer to ask again); a larger change for a rare case. | 9e3d1a3 |
| INT-13 | A failed OTP send replaces the customer's code | fixed [PROVIDER_CHECKS] | `src/customer.js:135-139` the new code is stored only after a send succeeds. Test: `test/audit-b-integrations.test.js` "INT-13 …" (2). | 9e3d1a3 |
| INT-14 | Blob calls have no timeout | fixed [PROVIDER_CHECKS] | `src/photos.js:30-33` `BLOB_TIMEOUT_MS = 15_000`, `blobCallOptions` abort signal. Test: "INT-11 and INT-14 …" "each Blob call carries an abort deadline". | 9e3d1a3 |
| INT-15 | At-least-once WhatsApp sends | not worth fixing | The audit accepts occasional duplicates; the Cloud API has no idempotency key; the `message sent but not recorded` log line stays. | — |
| INT-16 | Jio error bodies logged with only the code removed | fixed (no flag) | `src/sms.js:61-62` `clean` also runs `scrubText`. Test: `test/audit-b-security.test.js` "a Jio reply that echoes the number …". | b761add |
| INT-17 | A `failed` status arriving before the send is recorded is dropped | not worth fixing | The window is between Meta's HTTP reply and the `UPDATE` that records `provider_id`, in the same request (milliseconds); Meta's `failed` status comes after its own delivery attempt, normally seconds later. A fix needs a table for early statuses (migration 039 is free), a check on every send and a cleanup job, for a race not seen in practice. The message's own retry and INT-07's failure alert still cover a persistent failure. | — |
| INT-18 | `/me/phone/request` counts as a "known" number for Turnstile | fixed [PROVIDER_CHECKS] | `src/customer.js:579-581` `known` is a real account lookup. Test: `test/audit-b-integrations.test.js` "INT-18 …" (2). | 9e3d1a3 |

## Platform (platform.md)

| ID | Finding | Status | Evidence | Commit |
|---|---|---|---|---|
| PLT-01 | Rules saved by this release break the previous release | already fixed | `mango-api/src/config.js:58` `storedRulesSchema` strips unknown keys on read (eaa0aeb). | eaa0aeb |
| PLT-02 | `main` unprotected; Vercel build migrates production | needs owner | GitHub branch protection or a ruleset is a repository setting (prior OPS-21). `deploy/RELEASE.md` §0 now says so instead of claiming it is enforced. | 061c317 (docs) |
| PLT-03 | No off-Neon backup has succeeded; heartbeat inactive | needs owner | Needs the backup secrets in GitHub, the workflow on `main`, and `BACKUP_HEARTBEAT_EXPECTED=true` on Vercel plus a redeploy (step added to `deploy/VERCEL.md`). PLT-11 makes the backup itself verifiable. | — |
| PLT-04 | CI's audit gate fails today | already fixed | Same as SEC-03/04/05 (eaa0aeb). | eaa0aeb |
| PLT-05 | Production cron still daily on Hobby | needs owner | A Vercel plan or an external pinger (prior OPS-20). | — |
| PLT-06 | Replacement with no stock announced as confirmed for a date | fixed [DELIVERY_CHECKS] | `mango-api/src/orders.js:197-215` `CONFIRMATION_HELD`, `:1025-1030` holds REPLACEMENT_CONFIRMED and the ripeness guide until stock is found (then a replacement on the next available date, per the owner's rule). Test: `test/audit-b-delivery.test.js` "PLT-06 …" (2). | 78ac1f5 |
| PLT-07 | Dispatch has no date check | fixed [DELIVERY_CHECKS] | Same change as SEC-06. | 78ac1f5 |
| PLT-08 | Failed-delivery retry put on a full day silently | fixed [DELIVERY_CHECKS] | `src/orders.js:588-618` `retryDay` / `RETRY_NEEDS_DAY`: the "retrying on" message is held; `src/admin/reports.js:167-173,216` lists it in Needs attention (`kind: 'day'`); panel `src/pages/NeedsAttention.tsx:202`. Staff then move the retry to a day with room: `src/orders.js:634` `moveRetryToDate` (open day with room; packed boxes kept, too-old ones swapped or 409 `STOCK_TOO_OLD`; the held message is sent with the new date) through `POST /orders/:id/reschedule` (`src/admin/orders.js:225-229`); order detail `retryDateMovable` (`:107`); panel "Move retry date" (`src/pages/OrderDetail.tsx:146,265`). Tests: `test/audit-b-delivery.test.js` "PLT-08 …" (3; the move test failed on the old code with 400 INVALID_TRANSITION), `tests/audit-b-attention.spec.ts` (3). | 78ac1f5, d4ba4c4, 3c2dd97 |
| PLT-09 | No open day in 60 days: the rider cannot record the miss | fixed [DELIVERY_CHECKS] | `src/orders.js:761-764` the miss is recorded, the date kept, and staff asked to open a day and move the retry to it; `moveRetryToDate` (`:634`) then gives it that day, and the rider's run on that day takes it. Test: `test/audit-b-delivery.test.js` "PLT-09 …" (4; "once a day is opened, staff move the retry to it and the rider takes it on that day" failed on the old code). | 78ac1f5, d4ba4c4 |
| PLT-10 | A restore re-issues order numbers | fixed (ops tool) | `mango-api/src/restore.js:17-46` `highWater`, `bumpSequences`; CLI `mango-api/ops/bump-sequences.js`; step in `deploy/VERCEL.md` "Rolling back". Test: `test/audit-b-platform.test.js` "PLT-10 …". | 061c317 |
| PLT-11 | Backup role, dump verification, artifact location | fixed except artifact access (owner) | `mango-api/ops/backup.sh:22` `umask 077`, `:89-91` `pg_restore --list` check; backup role SQL with default privileges in `deploy/VERCEL.md`. Tests: `test/backup.test.js` (2 new). Who can download Actions artifacts of a public repo is a repository decision. | 061c317 |
| PLT-12 | Documentation vs code | items 11-14 fixed; 1-9 needs owner; 10 to part A | 11: `scripts/smoke.mjs` uses 240 s, `deploy/RELEASE.md` matches (test "PLT-12 …"). 12: `lock_timeout` line in `deploy/VERCEL.md` step 1. 13: RELEASE.md §0 wording. 14: redeploy step after `BACKUP_HEARTBEAT_EXPECTED`. Items 1-9 are in the external Architecture Doc, which is not in this repo. Item 10 (refund-after-cancel wording) belongs to the payments review (audit part A). | 061c317 |
| PLT-13 | `lock_timeout` relied on but not set up or checked | fixed | `mango-api/src/preflight.js:141` `checkLockTimeout`, called by `src/preflight-cli.js:66` with `--online`; VERCEL.md step 1. Test: `test/audit-b-platform.test.js` "PLT-13 …" (2). | 061c317 |
| PLT-14 | Graceful shutdown | fixed [API_HARDENING] | `src/maintenance.js:260` `settleMaintenance`; `src/index.js:31-34` waits for the run (10 s) and `drainBackground` before closing the pool. Test: `test/audit-b-platform.test.js` "PLT-14 …" spawns `index.js`, holds the run on a lock, sends SIGTERM (flag on: run completes; off: it doesn't). | 061c317 |
| PLT-15 | A claim replaces every box of the SKU | needs owner | The audit marks it an owner decision: claims carry SKUs, not quantities; adding a quantity changes the shop's claim form and the claim rules. | — |
| PLT-16 | CI hardening | fixed except SHA pinning | `.github/workflows/ci.yml:9` `permissions: contents: read`; `.github/workflows/deploy.yml:25` same-repository check; `mango-api/package.json:7` `">=22.9 <23"`. Test: "PLT-16 …". Not done: pinning actions by SHA (needs Dependabot active on `main` to keep them current; prior OPS-31). | 061c317 |
| PLT-17 | Per-instance caches; one import cycle | not worth fixing | The 60 s product cache is the audit's accepted window (price comes from the 5-minute quote). The payments ↔ preorders cycle is safe today (call-time references only) and moving it would collide with part A's payments changes. | — |
| PLT-18 | Projects deploy independently | fixed (process) | `deploy/RELEASE.md` checklist: ship API fields first; frontends use only fields already in production. | 061c317 |

## Prior findings carried in these files

| Prior | Status | Note |
|---|---|---|
| SEC-03 (22 Oct) PCI SAQ A evidence | needs owner | CSP reporting and an ASV scan are account work. |
| SEC-13 (22 Oct) TOTP secret stored in plaintext | needs owner (Info) | Encrypting it needs a key-management choice. |
| R-14 `staff_audit` retention | needs owner | See SEC-08. |
| R-15 `review_note` not erased | not re-checked here | Minor; outside this unit's files. |
| `/metrics` open off-Vercel without `METRICS_TOKEN` (PLT-12 #7) | needs owner (Info) | 404 on Vercel; set the token for Docker. |
| Bootstrap password only `min(12)` | not worth fixing (Info) | Used only while there are no staff accounts; preflight flags it when it is still set after (`src/preflight-cli.js:32`). |
| OPS-09, OPS-10/20, OPS-21, OPS-22, OPS-23, OPS-31 | needs owner | Same as INT-01, PLT-05, PLT-02, PITR drill, PLT-03, Dependabot on `main`. |

## Review follow-ups (26 Oct)

Two reviews of this branch found eight problems. Each one was reproduced first, then fixed with a test that failed before the fix.

| Review finding | Outcome | Commit |
|---|---|---|
| SEC-07: a stolen token enrolls its own authenticator through `/me/two-step/setup`, then passes step-up | fixed: setup from an ordinary session asks for the password | 5b7bd3e, 59be19b |
| SEC-07: parallel guesses all pass the lock check before any failure is counted (21 checks instead of 5) | fixed: the try is counted first, in one upsert | 5b7bd3e |
| SEC-07: step-up runs before validation, so a code is spent on a 400/409 | fixed: routes check the body, target and duplicate email before `stepUp` | 5b7bd3e |
| SEC-07: "refuse removing or demoting the last two-step-enabled manager" not built | fixed: 409 `LAST_TWO_STEP_MANAGER` | 5b7bd3e |
| SEC-08: a manager's booking cancel and its refund still audited after the response (two reviewers) | fixed: `auditInTx` in `admin/preorders.js` | 2793005 |
| PLT-08, PLT-09: a missed order with no day can't be moved, so it stays stuck | fixed: `moveRetryToDate`, "Move retry date" | d4ba4c4, 3c2dd97 |
| SEC-06, PLT-07: the documented NOT_DUE_YET manager override can't be reached in the panel | fixed: the refusal opens the override dialog on the order page | 3c2dd97 |
