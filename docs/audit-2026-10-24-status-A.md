# 24 Oct 2026 audit: status of payments, inventory and database findings (A)

Source reports: `audit-2026-10-24/payments.md`, `inventory.md`, `database.md`.
Branch `wip/audita`, from `61ac961`. Every finding ID in the three reports has one
row below. Line numbers are for the branch head.

Status words:

- **fixed**: changed here, with a test that failed on the code before the change and passes now.
- **fixed earlier**: already fixed before this branch (commit named), test named.
- **needs owner**: the fix is a business decision, an account setting, or a check
  against Razorpay or Meta that code cannot do. What the owner has to decide or do is written.
- **docs**: the finding was about documentation; the documentation is fixed.
- **not worth fixing now**: the reason is written.

Commits: `6b4f79f` payments, `89a3b8e` inventory, `3483975` database, `0715ce5`
docs (this file, sandbox scenarios, Neon steps), and a last commit that adds the
panel spec `tests/audit-a.spec.ts` and the re-check below, and `02e7ce0` (the one
existing test changed, INV-04).

## Register

### Payments

| ID | Status | Evidence | Commit |
|---|---|---|---|
| PAY-01 | fixed earlier | `preorders.js:347` (promotion stamps `payment_started_at`), `:387` (reconcile window keyed on it); migration 032; `test/launch-base.test.js` "PAY-01: a waitlist spot paid with the webhook lost" | `eaa0aeb` |
| PAY-02 | needs owner | No Razorpay test-mode run yet: R1-R16 in `deploy/RAZORPAY-SANDBOX.md` need test keys on staging and someone to pay test orders; then commit the sanitised fixtures so `test/razorpay-fixtures.test.js` stops skipping. Code cannot produce this evidence. | – |
| PAY-03 | fixed (no flag: only changes which link a chat reply shows) | `chat.js:586` stores the first link only (`AND payment_link_url IS NULL`); a losing tap reads the stored link and cancels its own at Razorpay (`chat.js:592`, `payments.js:110` `cancelPaymentLink`, best effort, never throws). Test: `audit-a-payments.test.js` "PAY-03" | `6b4f79f` |
| PAY-04 | fixed earlier | `admin/reports.js:145` keeps unresolved Razorpay problems listed past 7 days; `maintenance.js:131` keeps them until resolved. Test: `launch-base.test.js` "DB-04 and PAY-04" | `eaa0aeb` |
| PAY-05 | fixed, behind `REFUND_SAFETY_CHECKS` | `admin/recovery.js:268`: when Razorpay cannot be checked, "Paid back another way" answers 409 `RAZORPAY_UNCHECKED` and writes nothing. Test: "PAY-05" (flag on refused, then accepted once Razorpay answers; flag off as before) | `6b4f79f` |
| PAY-06 | fixed, behind `REFUND_SAFETY_CHECKS` | `payments.js:628` `claimRefund` skips a payment with a dispute that is not won (`disputeHolds`, `payments.js:644`); duplicate-payment refunds the same; Needs attention shows the refund as **held** (`admin/reports.js` stuck refunds, panel `NeedsAttention.tsx`); the health check does not count held ones as stuck. Test: "PAY-06" (held through cancel and the refund job, goes out once won; never under a lost one; flag off as before) | `6b4f79f` |
| PAY-07 | needs owner | WhatsApp Pay stays off (preflight already warns). Before turning it on, run R14 in `deploy/RAZORPAY-SANDBOX.md` to prove Meta's `transaction.id` is Razorpay's `pay_` id. Code cannot verify this without a real payload. | – |
| PAY-08 | fixed, behind `PAYMENT_DAILY_RECON` | `payments.js:873` `reconcileRecentPayments`: once a day (`maintenance.js:289`) it pages through Razorpay's captured payments of the last 3 days (`RECON_DAYS`, `payments.js:855`), applies any that match an order (by Razorpay order or link) or a booking (only when the booking's own link lists the payment), and records each payment that matches nothing once in Needs attention. Test: "PAY-08" (order paid 25 h later confirmed; booking paid 4 days after its window booked; orphan listed once; forged booking notes not trusted; runs once a day only with the flag) | `6b4f79f` |
| PAY-09 | docs + needs owner | `mango-api/README.md` template table now says `mandi_refunded` goes out when the refund is **started**. The owner must word the Meta template that way ("your refund has been started and reaches you in a few working days"). A follow-up message after a failed refund would need a new Meta-approved template: owner's call. | docs commit |
| PAY-10 | docs | `deploy/RAZORPAY-SANDBOX.md`: dispute events added to the webhook list; scenarios R10 (link expiry), R11 (late UPI), R12 (dispute, with the held refund), R13 (secret rotation), R14 (WhatsApp Pay id), R15 (double "Pay", PAY-03), R16 (daily check, PAY-08), with evidence rows | docs commit |

### Inventory

| ID | Status | Evidence | Commit |
|---|---|---|---|
| INV-01 | fixed, behind `ORDER_RULE_CHECKS` | `delivery.js:157` `chooseSlot({ mustFit })` refuses with 409 `SLOT_FULL` instead of the least-booked slot; used by customer and staff reschedules (`orders.js:328`, `:384`) and the bulk move (`admin/orders.js`, "No stock or slot room" in its not-moved list). Late payments, retries and replacements keep the old "never fail on a slot" rule. Test: `audit-a-inventory.test.js` "INV-01" | `89a3b8e` |
| INV-02 | fixed, behind `STOCK_INTAKE_CHECKS` | `admin/batches.js:25` optional `Idempotency-Key` on `POST /admin/v1/batches` (same key and body: the first batch is returned, 200; different body: 422 `IDEMPOTENCY_KEY_REUSED`); more than `BATCH_INTAKE_MANAGER_BOXES` boxes from a non-manager: 403 `MANAGER_APPROVAL_NEEDED` (`:121`). The panel's Receive dialog sends one key per intake and reuses it on a retry (`src/pages/Batches.tsx`, `src/api.ts`). Test: "INV-02" | `89a3b8e` |
| INV-03 | needs owner | The cutoff is judged when the payment lands (`orders.js` `processPayment`, `stale`). Owner picks: (a) judge it against when the order was placed while the hold is valid, or (b) stop offering D+1 a few minutes before 18:00. Both are small code changes once decided. | – |
| INV-04 | fixed (no flag: the catalogue now agrees with checkout) | `inventory.js:45`: an expired hold with a Razorpay order or link counts as free only after the same 2-minute gateway grace the lazy sweep uses (`LAZY_SWEEP_GATEWAY_GRACE_MS`, `inventory.js:23`, moved here from orders.js). Test: "INV-04". Existing test changed: `remediation-p0.test.js` "the catalogue counts boxes on an expired hold as available before anything sweeps it" expected the bug (3 boxes shown one minute after the hold); it now expects 0 inside the grace and 3 after it | `89a3b8e`, `02e7ce0` |
| INV-05 | needs owner | One unpaid order and one unpaid booking per customer are allowed at once, by design (`preorders.js` `checkUnpaidPreorders` comment). Owner decides whether to keep that or count both under one limit. | – |
| INV-06 | fixed (no flag: read-only check and an alert) | `stock-watch.js:23` `preorderCapacityDrift` compares `preorder_capacity.reserved` with the boxes of live bookings; the hourly audit alerts at most once an hour (`maintenance.js:215-221`) and Needs attention lists the weeks. Test: "INV-06" | `89a3b8e` |
| INV-07 | fixed, behind `ORDER_RULE_CHECKS` | `orders.js:552`: only a manager can cancel a replacement order (it settles a claim). Test: "INV-07" | `89a3b8e` |
| INV-08 | fixed, behind `STOCK_INTAKE_CHECKS` | `inventory.js:68`: in-transit stock whose arrival date has passed stops selling to new orders (orders already promised keep it); `stock-watch.js:43` `lateArrivals` lists the trucks on Needs attention. Test: "INV-08" (clears once the batch arrives and passes QC) | `89a3b8e` |
| INV-09 | needs owner | A customer can cancel (full refund) a CONFIRMED order whose boxes are already packed; the boxes are restocked. Owner decides whether the refund window ends at packing or at the PACKED status; then code and shop wording follow. The owner's rule today says "before packing". | – |
| INV-10 | fixed for chat, behind `ORDER_RULE_CHECKS` | `chat.js:230`: the chat order re-checks the pincode before booking and says "we no longer deliver to …, nothing was booked". Limit: the preorder allocator does not re-check (a booking was already paid for that address; refusing it would need a refund rule from the owner). Test: "INV-10" | `89a3b8e` |

### Database

| ID | Status | Evidence | Commit |
|---|---|---|---|
| DB-01 | fixed (no flag: lock order only) | One line order everywhere, the order `allocate` takes lines in: SKU by code point, then FEFO (`inventory.js:207` `LINE_LOCK_ORDER`, `:213` `lockLines`). Payments, cancels, rebalances, moves and returns lock the order's lines in that order before changing any (`orders.js:99` `lockOrderLines`); checkout sorts SKUs by code point; batch operations lock a batch's lines by SKU (`orders.js` `takeBatchOutOfService`, `admin/batches.js` QC); returns use `lockLines` (`stock-watch.js`). A late payment takes the day's booking locks before the lines, the order a checkout takes them in (`orders.js:458`, `delivery.js:128` `lockDay`). Test: `audit-a-database.test.js` "DB-01" (the audit's repro with no retry: two payments, a payment and a cancel, a late payment and a checkout; all finish, zero `40P01`) | `3483975` |
| DB-02 | fixed for the sweep; condemn not worth fixing now | The scheduled sweep cancels each expired hold in its own transaction (`orders.js:1045` `sweepExpiredHoldsEach`, `maintenance.js:272`); `sweepExpiredHolds(c)` stays for callers inside a transaction. Test: "DB-02" (30 two-SKU holds, longest transaction ≤ 50 statements; a broken one is flagged and the rest go). Condemn/retire still rebalance in one transaction: splitting it gives up the guarantee that no allocation lands on a condemned batch between the steps (INV-6 of 22 Oct), it is a manual action a few times a season, and with DB-01 it makes others wait rather than deadlock. | `3483975` |
| DB-03 | fixed | Migration 038 adds `batch_ledger (batch_id, sku, event_type) INCLUDE (delta)`; the audit reads the index instead of every ledger row. Test: "DB-03" (`EXPLAIN` of `auditLedger` uses `batch_ledger_audit_idx`). Serving `/attention` from the hourly result was not done: the index alone took the audit's query from ~500 ms to ~50 ms on 200k rows (audit measurement). | `3483975` |
| DB-04 | fixed earlier | `maintenance.js:131` deletes only resolved Razorpay problems. Test: `launch-base.test.js` "DB-04 and PAY-04" | `eaa0aeb` |
| DB-05 | fixed (no flag) | `db.js:89` the first retry per SQL state per hour on an instance is reported to Sentry (`reportProblem`), on top of the log line and counter; `db.js:109` `afterCommit` runs a function only once the transaction commits, used for `ordersConfirmed`, `rebalanceSwaps` and `lazyExpiries` (`orders.js:298`, `:468`, `:1103`). Test: "DB-05" (a forced deadlock: one report, a second race reports nothing; counters count two commits, not three attempts; nothing runs after a rollback) | `3483975` |
| DB-06 | needs owner (documented) | `ALTER ROLE mango_app SET jit = off` added to `deploy/VERCEL.md` step 1.3 and the go-live checks. It is a Neon role setting; the app cannot set it for itself on a pooled connection. The DB-03 index removes most of the measured JIT cost. | docs commit |
| DB-07 | partly fixed; rest not worth fixing now | Migration 038 adds NOT VALID checks: order money never negative, `refund_status` only `pending/processed/failed/manual` on orders, preorders and duplicate payments. Test: "DB-07". Not done: `total = subtotal - discount` (a test and the fixture replay set `total` alone; the code computes it in one place, `orders.js` `createOrder`); a FK from `order_items.sku` (products can be deleted while old orders keep their SKU); a unique index on `orders.razorpay_order_id` (Razorpay makes a new id per order and the one writer only fills an empty column, `customer.js:895`; a unique index would break the fixture replay test); VALIDATE of the 028/030 checks and the new ones (a VALIDATE that finds an old bad row fails the deploy; run it by hand on a copy first: `ALTER TABLE … VALIDATE CONSTRAINT …`). | `3483975` |
| DB-08 | partly fixed; rest not worth fixing now | Migration 038 indexes the cleanup columns (`idempotency_keys.created_at`, `processed_webhooks.created_at`, `quotes.expires_at`, `otps.expires_at`) and the foreign keys the audit named (`claims.order_id`, `claims.replacement_order_id`, `orders.replacement_for`, `orders.preorder_id`, `notifications.stock_alert_id`, `order_ratings.customer_id`, `claim_photos.customer_id`). Test: "DB-08". Not done: trigram search, keyset pages and range date filters for the staff order list (182 ms p50 at 50k orders, staff-only; worth doing when a season's orders reach that). | `3483975` |
| DB-09 | needs owner (documented) | `REVOKE UPDATE, DELETE, TRUNCATE ON batch_ledger FROM mango_app` with a check query added to `deploy/VERCEL.md` step 1.3 and the go-live checks. It is a Neon grant; the trigger from migration 022 still refuses changes. | docs commit |

## What was built

### Flags (all default `false`: the previous behaviour)

| Env var | Turns on | Findings |
|---|---|---|
| `REFUND_SAFETY_CHECKS` | refunds wait while a chargeback is open; "Paid back another way" refused while Razorpay can't be checked | PAY-05, PAY-06 |
| `PAYMENT_DAILY_RECON` | the once-a-day check of Razorpay's captured payments (in production it does nothing without Razorpay keys; locally it reads the dev stand-in gateway) | PAY-08 |
| `ORDER_RULE_CHECKS` | reschedules never overfill a slot; only a manager cancels a replacement; chat re-checks the pincode | INV-01, INV-07, INV-10 |
| `STOCK_INTAKE_CHECKS` | batch intake idempotency key and manager approval above a size; late trucks stop selling to new orders | INV-02, INV-08 |
| `BATCH_INTAKE_MANAGER_BOXES` | the size (boxes) above which a non-manager needs a manager; default 1000, 1-100000 | INV-02 |

They are in `mango-api/src/env.js` and `mango-api/.env.example`. For the local demo
turn all four on. In production, `REFUND_SAFETY_CHECKS` can be turned off for a moment
if Razorpay is unreachable for good and a manual refund must be recorded.

Not behind a flag (they change no rule a person sees, only fix a wrong answer or a
race): PAY-03, INV-04, INV-06, DB-01, DB-02, DB-03, DB-05, DB-07, DB-08.

### Migration `038_audit_a.sql`

Indexes and NOT VALID checks only. The previous release writes nothing the checks
refuse, so it runs safely on the new schema. Index builds block writes on their table
while they build (batch_ledger is the largest; under a second at 200k rows).
Numbering: 035-037 come from other branches; until they are merged, the "no gaps"
test in `test/migrations.test.js` ("migration files are numbered in order with no
gaps or repeats") fails on this branch alone. That is expected and is not changed
here; it passes once the branches are merged in number order.

### API and panel changes

- `POST /admin/v1/batches` accepts an optional `Idempotency-Key` header (at most 100
  characters); with `STOCK_INTAKE_CHECKS` a repeat answers 200 (not 201) with the
  first batch. No new routes.
- `GET /admin/v1/attention` adds `preorderCapacityDrift` and `lateArrivals`; stuck
  refunds can have `state: 'held'`. The panel shows them under Needs attention
  ("Refund held", with "Paid back another way" still offered to a manager; "Batch
  still in transit"; "Preorder capacity disagrees with the bookings", under
  "Stock counts to check").
- The panel's Receive batch dialog sends an `Idempotency-Key`: the same key while
  the form is unchanged (a double tap, a retry after an error), a new one once any
  field changes. The API ignores it unless `STOCK_INTAKE_CHECKS` is on.
- Panel spec `tests/audit-a.spec.ts` covers both (phone and desktop, with an axe
  scan of Needs attention).

### Limits

- The daily payment check looks back 3 days and stops (reporting `partial`) when its
  time budget runs out; the next day carries on. It handles payments that belong to
  an order or a booking (classes M1/M2 of the audit), not a full settlement report.
- A move to another date after stock ran out still takes the new day's lock after the
  order's lines; it is rare and a deadlock there is retried (and now reported).
- The preorder allocator does not re-check the pincode (INV-10 limit above).

### How "failed before" was shown

The three test files were run against the code before each change:
`audit-a-payments.test.js` and `audit-a-inventory.test.js` on `61ac961` (17 of 22
fail; the 5 that pass are the flag-off rollback tests, which assert the old
behaviour), `audit-a-database.test.js` on `89a3b8e` without migration 038 (9 of 10
fail; DB-01 with `40P01`, DB-02 with a 421-statement transaction). Exports that did
not exist yet were replaced by the old behaviour in those copies.

Re-checked on 26 Oct 2026 in a copy of `61ac961` (the three test files copied in,
the missing exports replaced by the old behaviour, a fresh database without
migration 038): 26 of 32 tests fail; the 6 that pass are the 5 flag-off rollback
tests and DB-02 "an order that cannot be cancelled is flagged and the rest still
go" (the old in-transaction sweep already did that). DB-01 fails with `40P01`,
DB-02 with "longest transaction: 421 statements". On the branch all 32 pass.

### Checks run on the branch head (26 Oct 2026)

- `npm run lint`, `npm run typecheck`, `npm run test:unit` (28 pass): clean.
- The three audit-A API files: 32 of 32 pass.
- `auth-matrix.test.js` and `security-readiness.test.js` with
  `UPDATE_ROUTE_INVENTORY=1 UPDATE_ROLE_POLICY=1`: 189 pass, no fixture change
  (no route was added).
- Full API run (`npm test` in `mango-api/`): 728 tests, 726 pass, 1 skip, 1 fail:
  the migration numbering test above, which passes once 035-037 are merged.
- Panel Playwright: `audit-a.spec.ts` (4 pass) and the related `recovery`,
  `screens`, `a11y`, `phase3` and `inventory` specs (210 pass). The shop was not
  changed.

### For the local demo launcher

Set `REFUND_SAFETY_CHECKS=true`, `PAYMENT_DAILY_RECON=true`,
`ORDER_RULE_CHECKS=true` and `STOCK_INTAKE_CHECKS=true` (with the default
`BATCH_INTAKE_MANAGER_BOXES=1000`). Without Razorpay keys the daily payment check
reads the dev stand-in gateway, so it calls nothing outside.
