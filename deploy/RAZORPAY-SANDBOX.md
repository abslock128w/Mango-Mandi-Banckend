# Razorpay test-mode run (before any real money)

Goal: prove the payment paths against Razorpay itself, in **test mode**, on a
staging deployment with a staging database. No live keys, no real money, no
production data. The result is evidence for the launch checklist.

## Rules

- Only `rzp_test_...` keys. The kit refuses live keys, and preflight refuses
  live keys on previews.
- Keys and the webhook secret go into the staging environment's settings
  (Vercel → Settings → Environment Variables, Preview/staging only) by the
  account owner. Never paste them into chat, tickets, commits or logs.
- Staging uses the Neon `staging` branch, never `main`.
- Use Razorpay's own test cards and test UPI handles from Razorpay's test-mode
  documentation. Don't use a real card.

## Set up (owner)

1. Razorpay dashboard → switch to **Test Mode** → Settings → API Keys → generate a test key.
2. Settings → Webhooks → add `https://<staging API>/webhooks/razorpay` with a new secret,
   events: `payment.authorized`, `payment.captured`, `payment.failed`, `payment_link.paid`,
   `refund.processed`, `refund.failed`, `payment.dispute.created`, `payment.dispute.won`,
   `payment.dispute.lost`, `payment.dispute.closed` (the same list as `deploy/README.md`).
3. Set on staging: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Redeploy.
4. Payment capture: automatic (the code also captures authorized payments that match an order).

## Scenarios (fill in the evidence table)

| # | Do this | Expect |
|---|---------|--------|
| R1 | Shop: order 1 box, pay with a test card that succeeds | Order CONFIRMED within seconds; one `payment.captured` in the webhook log |
| R2 | Order, pay with a test card that fails | Order stays PAYMENT_PENDING, Pay offered again; after the hold, CANCELLED with "We didn't receive your payment in time" |
| R3 | Order, close the payment window, wait 11 minutes | Order CANCELLED (hold expired), stock back in the catalogue |
| R4 | Order, pay successfully, then cancel it from the order page | Refund created; `refund.processed` arrives; order shows "Your refund ... has been sent" |
| R5 | Pause the webhook in the dashboard, pay an order, wait 3 minutes, resume | The maintenance job's reconcile confirms the order without the webhook |
| R6 | Re-send one `payment.captured` from the webhook log 3 times | Order confirmed once; one ORDER_CONFIRMED message |
| R7 | WhatsApp chat order, pay the link in test mode | Order CONFIRMED via `payment_link.paid` |
| R8 | Delayed payment: order, open Checkout, wait until the order page says the hold ran out (11 minutes), then finish paying if Razorpay still lets you | The late payment is matched: order CONFIRMED (on its date, or moved to the next day with stock, or flagged at risk), never refunded and never charged twice |
| R9 | Only if test mode can make a refund fail: repeat R4 with that refund | `refund.failed` arrives (our result `refund_failed`); the order's history says a new refund will be sent; a maintenance run at least 2 minutes after the first refund sends it and `check` shows the second refund. (Failed refunds back off 2, 4, 8 ... up to 60 minutes; after 8 attempts Needs attention shows "Refund failed: needs a manager", docs/order-states.md) |
| R10 | WhatsApp chat order: let the payment link pass its expiry (`expire_by`, the hold), then try to pay it | Razorpay refuses the payment; the order is CANCELLED by the hold sweep and nothing is charged |
| R11 | UPI test handle that fails first and succeeds later for the same payment (if test mode offers one) | `payment.failed` then `payment.captured`: the order is confirmed once (late payment rules: same date, next date with stock, or at risk); never refunded |
| R12 | Pay an order, cancel it as the customer, and raise a dispute on the payment in test mode before the refund goes (with `REFUND_SAFETY_CHECKS` on: the default on a preview and in production) | `payment.dispute.created` arrives; Needs attention shows the refund as **held** while the dispute is open; no refund goes out; after `payment.dispute.won` the next maintenance run sends it once. Also note whether Razorpay itself allows a refund on a disputed payment |
| R13 | Rotate the webhook secret as `deploy/README.md` says (new secret in `RAZORPAY_WEBHOOK_SECRET`, old one in `RAZORPAY_WEBHOOK_SECRET_PREVIOUS`), then re-send an older event from the dashboard | Both old and new events are accepted and applied once; after `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` is removed, an event signed with the old secret is refused. Note how long Razorpay keeps signing retries with the old secret |
| R14 | Only if `WHATSAPP_PAYMENT_CONFIG` is set: pay a chat order with WhatsApp Pay | Write down Meta's `transaction.id` and Razorpay's `pay_` id: they must be the same, and Needs attention must show no "refundable" row for it (audit PAY-07). If they differ, keep WhatsApp Pay off |
| R15 | WhatsApp chat order: tap "Pay" twice quickly | Both replies carry the same link; the extra link Razorpay created is shown as cancelled in the dashboard (audit PAY-03) |
| R16 | With `PAYMENT_DAILY_RECON` on (unset is on in production; set it to `true` on staging): pause the webhook, pay an order, wait until the next day's maintenance run (or run it by hand) | The daily check of Razorpay's payments confirms the order (or books the preorder); a payment that matches nothing is listed once in Needs attention |

**`PAYMENT_DAILY_RECON`** is the once-a-day check behind R16: the maintenance run
asks Razorpay for every payment captured in the last 3 days and applies any we
have no record of (as its webhook would have), or lists it once in Needs
attention for a manager to refund. It catches a lost webhook on a payment the
shorter checks no longer look at. Keep it on in production: unset, it is on
there (`mango-api/src/env.js`); only `PAYMENT_DAILY_RECON=false` turns it off.

Scenario map for the launch gate: success = R1 and R7, failure = R2, delayed
payment = R5 (webhook late) and R8 (payment late), duplicate webhook = R6,
refund = R4 (and R9 where possible). R3 checks the hold. R10-R16 cover link
expiry, late UPI, disputes, secret rotation, WhatsApp Pay, double "Pay" taps and
the daily payment check (24 Oct 2026 audit, PAY-10).

After each scenario, collect the ids from both sides:

1. **Our side.** Every webhook writes one API log line `razorpay webhook` with our
   request id (`reqId`, also sent back as the `X-Request-Id` header), Razorpay's
   event id (the `x-razorpay-event-id` header), the payment, order, link and
   refund ids, and what we did (`confirmed`, `duplicate`, `refund_due`, ...).
   Export the staging API logs for the scenario's time (Vercel → Logs, or
   `docker compose logs api > api.log`) and run:

   ```bash
   cd mango-api
   node scripts/razorpay-sandbox.mjs webhooks ~/Downloads/api.log
   ```

   It prints one Markdown row per webhook. Paste them under the scenario.
   For the shop's own calls, the order page's request id is in the browser's
   network tab (`X-Request-Id` on `POST /v1/checkout/confirm`).
2. **Razorpay's side.** Read-only, test keys from the environment:

   ```bash
   node scripts/razorpay-sandbox.mjs check order_XXXXXXXX
   ```

   It lists the order, each payment and each refund with their status, and
   prints an evidence row with our order number (the Razorpay receipt).
3. The webhook event ids are also in the Razorpay dashboard's webhook event log;
   they must match the `Event id` column from step 1.

Then copy each webhook body from the dashboard's event log into a file and run:

```bash
node scripts/razorpay-sandbox.mjs sanitize ~/Downloads/r1-captured.json
```

This removes emails, phone numbers, UPI handles and card details, and writes
`test/fixtures/razorpay/*.json`. Commit the fixtures: `npm test` replays them
(test/razorpay-fixtures.test.js), so later changes are checked against what
Razorpay really sends.

## Evidence log

One row per scenario. "Our request ids" and "Event ids" come from the
`webhooks` command; the payment and refund ids from `check`.

| # | Date | Our order no. | Our request ids | Razorpay order / link id | Event ids | Payment ids | Refund ids | Result |
|---|------|---------------|-----------------|--------------------------|-----------|-------------|------------|--------|
| R1 | | | | | | | | |
| R2 | | | | | | | | |
| R3 | | | | | | | | |
| R4 | | | | | | | | |
| R5 | | | | | | | | |
| R6 | | | | | | | | |
| R7 | | | | | | | | |
| R8 | | | | | | | | |
| R9 | | | | | | | | |
| R10 | | | | | | | | |
| R11 | | | | | | | | |
| R12 | | | | | | | | |
| R13 | | | | | | | | |
| R14 | | | | | | | | |
| R15 | | | | | | | | |
| R16 | | | | | | | | |

## What runs without test keys (checked on every `npm test`)

- Signature check on every webhook (`x-razorpay-signature`, raw body), the
  replay of the scenarios above against our stand-in gateway (shop-payments,
  pay-fixes, remediation tests), and the sanitizer.
- `test/p0-verify.test.js`: each webhook's log line carries our request id and
  Razorpay's ids, and the `webhooks` command turns those lines into rows.
- `test/razorpay-fixtures.test.js` replays recorded bodies; it is skipped until
  fixtures from this run are committed.

Until this table is filled in, payments are **not verified against Razorpay**:
the code is tested only against our own stand-in.
