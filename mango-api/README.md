# mango-api

The VMR Mangoes backend: the `/admin/v1` API the Mango Ops panel uses, the `/v1`
storefront API, Razorpay payments, and the engine that decides which boxes can be sold
as raw, semi-ripe or ripe on each delivery date.

Node 22, Express 4, PostgreSQL 16. One process, one database; stock holds, payment
confirmation and allocation all commit in the same Postgres transaction.

## Run it locally

```bash
cd mango-api
npm ci
# Postgres with user/password mango, database mango (docker compose up db works too)
COOKIE_SECURE=false npm run dev
```

On start it migrates, seeds products (Alphonso and Badami, 3 kg and 5 kg), Bengaluru
pincodes and two staff logins (`manager@vmr.test` / `manager123`,
`ops@vmr.test` / `operator123`; not created in production), plus a spread of demo
batches when the database is empty. Point the panel at it with
`VITE_API_URL=http://localhost:3000`.

`docker compose up --build` starts Postgres and the API together. Settings are in
[`.env.example`](.env.example); in production the API refuses to start with a weak
`JWT_SECRET`, the dev webhook secret, or `COOKIE_SECURE=false`.

## Login codes by SMS (Jio)

Customers sign in with a 6-digit code. With `SMS_PROVIDER=jio` the code goes out
through the Jio SMS gateway; production refuses to start without it. Set `JIO_SMS_URL`,
`JIO_SMS_API_KEY`, and the DLT registration (`JIO_SMS_SENDER_ID`, `JIO_SMS_TEMPLATE_ID`,
`JIO_SMS_ENTITY_ID`). `JIO_SMS_TEXT` must match the registered template exactly, with
`{code}` where the code goes. The request body is in [`src/sms.js`](src/sms.js); check it
against your Jio account's API docs before going live. Outside production the default
`SMS_PROVIDER=log` logs the code and returns it as `devCode`.

## The rules it enforces

The two specs split the work: the technical plan fixes the API contract, and the
*Backend Architecture and Edge-Case Playbook* fixes the engine. The business rules
below override both.

- **No refunds, only replacements, with one exception.** A claim resolves as
  `REPLACEMENT_APPROVED` (a free replacement order on the earliest date with stock) or
  `REJECTED`, and staff have no refund action. The exception (user decision): a customer
  who cancels a paid order gets a full refund through Razorpay.
- **Ripeness comes from age on the delivery date.** Day of pluck is age 0. By default
  a batch sells as raw at age 3, semi-ripe at 4–5 and ripe at 6–7. The latest QC reading
  shifts a batch by up to a day (QC'd ripe while the profile expected semi-ripe = a fast
  ripener). Nothing older than 7 days on its delivery date is sold, and batches retire
  at age 8. Physical stock needs an intake QC before it is sold; stock still in transit
  sells only for dates after its arrival, at 85% of its count.
- **Delivery dates.** Order before 18:00 IST for next-day delivery, after it for the day
  after. Closed days and per-day box limits come from the delivery calendar. Customers
  can book up to 5 days ahead.
- **Holds and FEFO.** Checkout holds stock for 10 minutes, oldest batch first, with a
  conditional `UPDATE` so two buyers can never take the same box. A database `CHECK`
  backs it up. Payment turns the hold into a commitment.
- **Rebalancing, never cancelling.** After QC, a status change, a condemned batch and
  hourly, every open order is re-checked. Stock that no longer fits is swapped to another
  batch with the same SKU and stage. What can't be swapped flags the order **at risk**
  for ops, and later rebalances fill it if stock arrives.
- **Late payments** (user decision): a payment that lands after the hold expired still
  confirms the order. If its stock is gone it moves to the next date that has stock.
- **Failed deliveries** (user decision): `DELIVERY_FAILED` reschedules the order to the
  next delivery day for a retry. If the packed boxes would pass the 7-day limit by
  then, the order is flagged at risk.
- **Customer cancels** are allowed until the order is packed. A paid order is refunded
  in full: the refund is requested in the cancel transaction, sent to Razorpay right
  after, and retried by the maintenance loop until it lands (it checks for an existing
  refund first, so retries never pay twice). A payment that arrives after the customer
  cancelled is refunded too, and a replayed payment can't revive the order. Staff can
  cancel up to out-for-delivery without a refund; boxes not yet shipped go back on the
  shelf.

All the numbers above live in the versioned `app_config` table (`GET/PUT
/admin/v1/config`). Each order records the version it was placed under.

## API

| Area | Routes |
|------|--------|
| System | `GET /health`, `GET /ready`, `GET /metrics` (optional bearer `METRICS_TOKEN`) |
| Staff auth | `POST /admin/v1/auth/login`, `/refresh`, `/logout`, `GET /auth/me`. Refresh token is the httpOnly `mango_admin_rt` cookie, rotated on each use. |
| Dashboard | `GET /admin/v1/summary` (adds `atRiskOrders`), `GET /products` |
| Batches | `GET/POST /batches`, `GET /batches/:id`, `PATCH /batches/:id/status`, `POST /batches/:id/qc`, `PATCH /batches/:id/lines/:lineId`, `GET /batches/:id/ledger` |
| Orders | `GET /orders` (`?status&from&to&q&atRisk&page`), `GET /orders/:id`, `PATCH /orders/:id/status`, `POST /orders/:id/allocate`, `/cancel`, `/rebalance`, `/reschedule` |
| Fulfilment | `GET /pack-list?date=` |
| Claims | `GET /claims`, `POST /claims/:id/review`, `POST /claims/:id/resolve` |
| Pincodes | `GET/POST /pincodes`, `PATCH/DELETE /pincodes/:pincode` |
| Rules | `GET/PUT /config`, `GET/PUT/DELETE /calendar/:date`, `GET /coverage` (sellable boxes per SKU and stage for each bookable date) |
| Customer auth | `POST /v1/auth/otp/request`, `/otp/verify`, `/token/refresh`, `/logout` |
| Storefront | `GET /v1/delivery/check?pincode=`, `GET /v1/catalogue?pincode=&delivery_date=`, `GET/POST /v1/cart`, `DELETE /v1/cart/items/:sku` |
| Checkout | `POST /v1/checkout/quote`, `POST /v1/checkout/confirm` (requires `Idempotency-Key`) |
| Orders and claims | `GET /v1/orders`, `GET /v1/orders/:id`, `/payment-status`, `POST /v1/orders/:id/cancel`, `GET/POST /v1/claims` |
| Payments | `POST /webhooks/razorpay` (HMAC-SHA256 over the raw body, deduplicated) |
| Dev only | `POST /v1/dev/pay`, `/v1/dev/mark-paid-at-gateway`, `/v1/dev/reconcile` (not mounted in production) |

Errors are `{ error: { code, message, requestId } }`. Admin routes are the contract in
the panel's `src/types.ts`; extra fields (`atRisk`, `atRiskReason`, `replacementFor`,
`eatBy`, `replacementOrder`) are additive.

Cart lines carry a stage (`{ sku, stage, qty }`), unlike the technical plan's
`{ sku, qty }`. The same box can sell as raw on one date and ripe on another, so the
customer picks the stage.

## Background work

Every 60 seconds, on exactly one instance (`pg_try_advisory_lock(427714202)`):
reconcile pending payments with Razorpay, send due refunds, cancel unpaid orders whose hold expired,
prune expired OTPs, quotes, idempotency keys, webhooks and sessions, and retire batches
at age 8. Hourly (or right after a rules change) it rebalances every open order and runs
the ledger audit, which checks `on_hand` against the ledger and `held`/`committed`
against the order allocations. Drift is logged and exported as `mango_ledger_drift_lines`.

## Tests

```bash
npm test   # needs a Postgres database named *_test; default postgres://mango:mango@localhost:5432/mango_test
TEST_DATABASE_URL=postgres://user:pass@host:5432/mango_test npm test
```

The suite drops and recreates the schema of that database, and refuses to run against
one whose name doesn't end in `_test`. It covers the stage engine, staff and customer
auth (refresh rotation and reuse detection, OTP lockout), the full order flow through
claim and replacement, hold expiry and late payments, condemn and rebalance, failed
delivery retries, retirement and the ledger audit, plus a race of 30 buyers for 10 boxes.

## Not in phase 1

Preorders, delivery slots, WhatsApp order updates, Redis, S3 photo storage and rider
proof of delivery. Dry fruit is out of scope.
