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
   `refund.processed`, `refund.failed`.
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

After each scenario:

```bash
cd mango-api
# Read-only, test keys from the environment:
node scripts/razorpay-sandbox.mjs check order_XXXXXXXX
```

Then copy each webhook body from the dashboard's event log into a file and run:

```bash
node scripts/razorpay-sandbox.mjs sanitize ~/Downloads/r1-captured.json
```

This removes emails, phone numbers, UPI handles and card details, and writes
`test/fixtures/razorpay/*.json`. Commit the fixtures: `npm test` replays them
(test/razorpay-fixtures.test.js), so later changes are checked against what
Razorpay really sends.

## Evidence log

| # | Date | Razorpay order id | Result | Notes |
|---|------|-------------------|--------|-------|
| R1 | | | | |
| R2 | | | | |
| R3 | | | | |
| R4 | | | | |
| R5 | | | | |
| R6 | | | | |
| R7 | | | | |

Until this table is filled in, payments are **not verified against Razorpay**:
the code is tested only against our own stand-in.
