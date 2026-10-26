# Audit part B fixes: what was built

The security, integrations and platform leftovers of the 24 Oct 2026 audit.
One row per finding, with evidence: [audit-2026-10-24-status-B.md](audit-2026-10-24-status-B.md).

## Flags

Every behaviour change that a customer, rider or staff member could notice is behind a flag.
All flags default to `false`; setting one back to `false` is the rollback. No migration and no new route.

| Flag | Turns on | Findings |
|---|---|---|
| `API_HARDENING` | Bad `%`-encoding and unsupported or corrupt `Content-Encoding` answer 400/415, not 500 plus a Sentry event. A known path with the wrong method answers 405 with `Allow`. 503 BUSY/UNAVAILABLE bodies carry `retryAfterSeconds`. CORS exposes `Retry-After`, `X-Request-Id`, `RateLimit`, `RateLimit-Policy`. On SIGTERM, `index.js` waits up to 10 s for a maintenance run and drains background work before closing the pool. | SEC-02, SEC-09, PLT-14 |
| `PROVIDER_CHECKS` | Skips stale messages for orders or bookings that moved on. Classes Meta errors by error code. Tracks WhatsApp login-code delivery, with an alert on the third failure. Keeps the customer's old login code when a send fails. Treats only numbers with an account as "known" during a Turnstile outage. Retries a chat reply once on a temporary error. Blob calls time out after 15 s; the upload sweep runs hourly and reads every page. | INT-04, 09, 10, 11, 12, 13, 14, 18 |
| `OPS_ALERTS` | A failing maintenance step is reported every hour, not once. Messages dropped after a day are alerted and listed in Needs attention ("WhatsApp message never sent", with Send again). 3 failed messages alert at any volume. "No provider" skips alert. 3+ WhatsApp webhook failures in an hour alert. A captured WhatsApp payment with no order is reported at once. | INT-03, 06, 07, 08 |
| `DELIVERY_CHECKS` | An order goes OUT_FOR_DELIVERY only on its delivery day (409 `NOT_DUE_YET`; a manager override with a reason still works). A retry with no room, or no open day, holds the "retrying on" message and is listed as "Retry has no delivery day". With no open day the rider can still record the miss. A replacement with no stock holds its confirmation until stock is found. | SEC-06, PLT-06, 07, 08, 09 |
| `STAFF_STEP_UP` | Adding staff, changing a role or password, setup codes, two-step resets and removals ask the manager again: their authenticator code (spent once used), or their password if two-step is off. 5 wrong answers lock step-up for 15 minutes. The panel shows a "Confirm it's you" dialog and resends the change. | SEC-07 |
| `STAFF_AUDIT_TRAIL` | Staff changes, order cancels and claim resolutions write their audit row in the same transaction; no row means no change. Opening an order, searching orders (the search words are not stored), the manifest, claims and the photo routes are recorded, at most once per person, route and target per 10 minutes. 403s are logged with staff id, role, method and path. The Activity list hides views unless "Include views of customer details" is ticked. | SEC-08 |

These are not flagged, because nobody sees them: log masking (SEC-11, INT-16); blanking booking messages on erasure (INT-05); the dev-proxy check and `HOST` (SEC-01); `backup.sh` hardening (PLT-11); `preflight --online` checking `lock_timeout` (PLT-13); `ops/bump-sequences.js` (PLT-10); CI and docs (PLT-12, 16, 18); and the panel dialog fix where Escape and Tab go only to the topmost dialog.

## Env vars

- `HOST` (default empty: every interface, as Docker needs). This is the address `index.js` listens on.
- The six flags above. They are all listed in `mango-api/.env.example`.

`scripts/start-local.mjs` was not edited. It should set:
- `HOST=127.0.0.1` always, so `/v1/dev` cannot be reached from the Wi-Fi; phones go through the shop's dev-server proxy, which now refuses every spelling of `/v1/dev`;
- `ENABLE_DEV_ROUTES=false` when it shares the shop (`--phone`, `--wifi`);
- `http://127.0.0.1:<port>` in the API URLs it hands the shop and panel, so they keep working once the API no longer listens on every interface.

## Rollout order

1. Deploy with every flag off. Nothing changes.
2. Turn on `API_HARDENING` and `OPS_ALERTS`. These only change error codes and alerts. Before `OPS_ALERTS`, name who receives the alerts (INT-01).
3. Turn on `PROVIDER_CHECKS`, then watch the `whatsapp-undelivered` and Blob logs for a day.
4. Turn on `DELIVERY_CHECKS`. Tell riders that tomorrow's stops no longer go on today's run. Managers can still send an order early, giving a reason.
5. Turn on `STAFF_AUDIT_TRAIL`, then `STAFF_STEP_UP`. Managers will be asked for their code or password on staff changes. The panel and API changes ship in the same release, but the dialog only appears once the API asks.

For ops after a database restore, run `ops/bump-sequences.js` before the shop takes an order. See `deploy/VERCEL.md`, "Rolling back".

## Decisions and limits

- No refunds were added. PLT-06 holds the replacement confirmation and the customer gets the replacement on the next date with stock, following the owner's replacement-only rule. PLT-08 and PLT-09 keep "a failed delivery retries on the next delivery"; staff pick the day only when no day has room.
- SEC-06 has a residual: a rider can still take today's unassigned stops, because that is how riders self-assign. Requiring assignment is the owner's call.
- SEC-07 does not tell the affected person, because staff have no contact channel. Step-up attempts are counted in `rate_limits` (`step-up:<staff id>`), so the lock holds across instances.
- The SEC-08 read audit adds at most one row per person, route and target every 10 minutes. There is still no retention rule for `staff_audit` (R-14, owner).
- SEC-09 does not add `truncated` flags or an OpenAPI file (see the register).
- INT-12 retries a chat reply once, with no outbox. INT-17 (a status that arrives before its send is recorded) is not fixed.
- PLT-14 bounds the shutdown wait at 10 s, inside the 15 s hard exit. A run still going after that is left to its lease.
- PLT-16 does not pin actions by SHA.

## Tests

- **API tests** (`mango-api/test`):
  - audit-b-security.test.js
  - audit-b-outage.test.js
  - audit-b-integrations.test.js
  - audit-b-ops.test.js
  - audit-b-delivery.test.js
  - audit-b-staff.test.js
  - audit-b-platform.test.js
  - backup.test.js: 2 new tests, plus a `pg_restore` stub, because its fake dump is not a real archive.
- **Panel specs:** tests/audit-b-step-up.spec.ts and tests/audit-b-attention.spec.ts.
- **Shop unit test:** customer-app/tests/unit/dev-server.unit.ts.

Each flag-on test was run with its flag pinned off and failed. Each flag-off test pins the old behaviour, so a rollback is covered.
