# Customer care: help centre and season subscriptions

Two features, each behind its own switch, each **off by default**:

- **Help centre** (`HELP_CENTRE`): a signed-in customer asks a question about an
  order (from its page) or in general (from `/help`), picks a topic and writes a
  message, then follows the status and the replies in one thread. Managers and
  operators answer from the panel's **Help desk**.
- **Mango season subscriptions** (`SUBSCRIPTIONS`): a box every week or every
  other week until a chosen end date, no later than the season's end. The
  customer pays for each box as an ordinary order. There is no auto-debit, no
  stored payment method and no wallet or store credit.

With a switch off, its API routes answer 404, `GET /v1/policy` and
`GET /admin/v1/auth/me` look exactly as before, the shop and panel show nothing
new, and the maintenance loop does not run the subscription step.

## Switches and environment (mango-api)

| Variable | Default | What it does |
| --- | --- | --- |
| `HELP_CENTRE` | `false` | Help requests in the shop (`/help/requests`) and the panel's Help desk |
| `HELP_DAILY_LIMIT` | `5` | New help requests one customer may open in 24 hours (1 to 50). Replies to a request don't count |
| `SUBSCRIPTIONS` | `false` | Subscriptions on the shop's Account page and the panel's Subscriptions list, and the maintenance step that sets up each box |
| `SUBSCRIPTION_SEASON_END` | empty | Last day a subscription can run (`YYYY-MM-DD`). Empty, or already past: no new subscription can start (running ones keep their own end date) |
| `SUBSCRIPTION_LEAD_DAYS` | `2` | How many days before a delivery its box is set up and the customer asked to pay (1 to 5) |
| `WHATSAPP_CARE_UPDATES` | `false` | WhatsApp for help replies and pay reminders. Needs two new Meta templates (below). Without it, the customer still gets a browser notification when `WEB_PUSH` is on, and sees the reply or the box in the shop |

The shop reads the switches from `GET /v1/policy` → `care`
(`helpCentre`, `subscriptions`, `subscriptionsOpen`); the key is present only
while one of the two is on. The panel reads `GET /admin/v1/auth/me` →
`features.helpDesk` and `features.subscriptions`, present only while on.

`scripts/start-local.mjs` turns both on for the local demo, with a season that
ends 90 days from the day it starts. CI's end-to-end job does the same.

Migration: `mango-api/migrations/041_care.sql`.

## Help centre

### What the customer sees

- **Order page**: "Ask us about this order" beside the WhatsApp link. The
  WhatsApp link is unchanged: it shows only when the shop build has
  `VITE_SUPPORT_WHATSAPP`.
- **`/help`**: "Ask us a question" under *Talk to us*.
- **`/help/requests`**: the form (topic from a fixed list, message) and the
  customer's questions with their status. Opened from an order page it says
  "Ask about order MM-…" and the request is tied to that order.
- **`/help/requests/:id`**: the status, the thread (the shop's replies show as
  "MandiMangoes", never the staff member's name or email) and a reply box.

Status, as the customer sees it: **Open** (waiting on us), **Waiting for you**
(we replied), **Resolved**. A customer message moves the request to Open, even
a resolved one; a staff reply moves it to Waiting for you.

**Damaged, spoilt, wrong or missing mangoes are not a topic.** The form says
so and links to the order's claim form (`/orders/:id/claim`), which stays the
only way to report them. Claims still end in a replacement or a rejection.

Topics: delivery or the delivery day; payment or a refund; changing or
cancelling an order; my mango subscription; my account or signing in;
something else.

### Rules the API enforces

- Every customer route is under `/v1/me/help`: a customer reads and writes only
  their own requests. Another customer's request answers 404, the same as one
  that does not exist (`test/security-readiness.test.js` checks each route).
- An order named on a new request must be the customer's own (404 otherwise).
- Messages: 5 to 2000 characters for the first one, 1 to 2000 after that
  (the database checks 1 to 2000 too).
- At most `HELP_DAILY_LIMIT` new requests per customer in any 24 hours, counted
  under a lock on the customer so two at once can't both slip through: 429
  `HELP_LIMIT`. At most 20 customer messages on one request in 24 hours (429).
- Staff routes are for managers and operators only (`OPERATOR_ROUTES` in
  `src/access.js`; packers, QC and riders get 403).
- Each staff reply, resolve and reopen writes its `staff_audit` row in the same
  transaction (`REPLY help request` with the message id and length,
  `RESOLVE help request`, `REOPEN help request`). The reply text itself is kept
  in `help_messages` with who wrote it.
- The Help desk shows the customer's phone as `******1234`; nothing in the shop
  or panel code logs a phone number.

### Help desk (panel, Customers → Help desk)

The inbox puts open requests first, the longest waiting on top, then those
waiting on the customer, then resolved. Filters: status, topic, and a request
or order number. A request opens its thread with the order (linked), a reply
box, and **Mark resolved** or **Reopen**.

### Telling the customer

A staff reply queues, in the same transaction:

- a browser notification (`HELP_REPLY`, links to the request) when `WEB_PUSH`
  is on and the customer turned notifications on;
- a WhatsApp message `mandi_help_reply` (name, request number, link) when
  `WHATSAPP_CARE_UPDATES=true` and the customer has a phone number.

Both go through the existing outboxes (`push_messages`, `notifications`), sent
by the maintenance loop with the existing providers. Tests use the log/stub
providers.

## Season subscriptions

### What the customer chooses

On **Account → Your subscriptions → Start a subscription**: the box (product),
ripeness (same price for every ripeness), how many boxes (1 to 20), every week
or every other week, the delivery day, the delivery time (when the shop uses
times), one of their saved addresses (an address they ordered to before), and
the last delivery date (no later than `SUBSCRIPTION_SEASON_END`).

The API checks all of it: the box is on sale, the address is the customer's
own and in a pincode we deliver to, the time exists, the end date is a real
date after the first delivery and not after the season's end, the customer has
a mobile number, the same box and ripeness is not already subscribed to that address, and
no more than 3 subscriptions run at once.

### How a delivery happens

1. **Set up** (the maintenance loop, `SUBSCRIPTION_LEAD_DAYS` ahead): for each
   running subscription, each delivery that is now that close gets one
   *cycle* row, on its day, or on the next open day before the following
   delivery when its day is closed, full, or the box is out of stock. The
   customer is reminded to pay (WhatsApp `mandi_subscription_due` and/or a
   browser notification, as above).
2. **Pay**: the customer taps *Pay for this box* (Account, or the reminder's
   link). That makes an **ordinary unpaid order through the checkout code**:
   the unpaid-order limit and the held-boxes limit, the day's capacity and the
   time slot checked under lock, all-or-nothing stock, the usual hold of
   `holdMinutes`. If the day has filled since the reminder, the order goes on
   the next open day with room and stock before the following delivery. The
   order page then takes the payment exactly as for any order.
3. From then on it is a normal order: confirmed when paid, cancelled when the
   hold runs out unpaid (Pay is offered again while a day is left), packed,
   delivered, claims, cancellation and refund rules all unchanged.

A cycle the customer never pays for, whose last possible day has passed,
becomes **missed**; the next one is not affected.

**Why the order is made at Pay and not by the job.** The brief asks for both
"the scheduler creates a normal unpaid order" and "unpaid orders hold no stock
until paid". In this codebase an unpaid order *is* a stock hold (checkout's
`PAYMENT_PENDING` order holds its boxes for `holdMinutes`) and counts against
the one-unpaid-order limit. An order made two days ahead would either hold
stock for two days or break the existing unpaid-order rules. So the job sets
up the delivery (a cycle row, holding nothing and taking no day's room) and
sends the reminder, and the unpaid order is made, with every existing rule, the
moment the customer chooses to pay. Nothing is ever debited on its own.

**Exactly once.** Each delivery has one row per subscription and date
(`UNIQUE (subscription_id, scheduled_for)`, inserted with
`ON CONFLICT DO NOTHING`), and the reminder is queued only by the insert that
made the row. The job takes each subscription with `FOR UPDATE SKIP LOCKED` in
its own short transaction, so overlapping runs, retries and a crash halfway
through never set up a second box or send a second reminder. Pay needs an
`Idempotency-Key` (the checkout's replay table): a retry or a second tap gets
the same order; a payment already started and still held is handed back
rather than a second order.

### Skip, pause, resume, cancel (customer)

- **Skip** a date ahead of time (no box is set up for it), or a box set up and
  not paid for. A box whose payment was started is cancelled with its unpaid
  order (which frees its boxes and costs nothing). A paid box can't be skipped:
  cancel that order from its page, under the existing refund rule (a customer
  cancel before packing).
- **Pause**: no boxes are set up until resumed; a box set up and not yet paid
  for is called off. **Resume** starts from the first day that can still be
  ordered; dates passed while paused are not counted as missed.
- **Cancel**: no more boxes; it can't be restarted (start a new one). A box
  already paid for still comes.

A payment the customer started before pausing or cancelling stays an ordinary
unpaid order: its hold runs out on its own unless they pay it.

### Subscriptions list (panel, Customers → Subscriptions)

Managers and operators see every subscription with its box, days, pincode, the
customer (phone masked as `******1234`, no address) and its coming boxes, with
links to their orders. **Pause** and **Cancel** need a reason of 5 characters
or more, kept in the activity log (`PAUSE subscription`,
`CANCEL subscription` with the reason, written in the same transaction).
Staff cannot take or return money here.

### Account deletion and export

Deleting the account (DPDP) cancels its subscriptions and blanks their
address and name, calls off boxes not paid for, replaces the text of the
customer's help messages (and the replies, which may quote them) with
"(removed when the account was deleted)", resolves their requests, and skips
any queued message about either. `GET /v1/me/export` includes the customer's
help requests and subscriptions.

## API

Customer (signed in):

| Route | |
| --- | --- |
| `GET /v1/me/help` | Topics, message limits, daily limit |
| `GET /v1/me/help/requests` | The customer's requests |
| `POST /v1/me/help/requests` | `{ topic, orderId?, message }` → 201 |
| `GET /v1/me/help/requests/:id` | One request with its messages |
| `POST /v1/me/help/requests/:id/messages` | `{ message }` → 201 |
| `GET /v1/me/subscriptions` | `{ items, open, seasonEnd, leadDays }` |
| `POST /v1/me/subscriptions` | `{ sku, stage, qty, frequency, weekday, slotId, addressId, endDate }` → 201 |
| `GET /v1/me/subscriptions/:id` | One subscription, its boxes and history |
| `POST /v1/me/subscriptions/:id/pause` · `/resume` · `/cancel` | |
| `POST /v1/me/subscriptions/:id/skip` | `{ scheduledFor }` |
| `POST /v1/me/subscriptions/:id/cycles/:cycleId/pay` | Needs `Idempotency-Key`; answers as checkout's confirm (201 new, 200 replay) |

Staff (managers and operators):

| Route | |
| --- | --- |
| `GET /admin/v1/help/requests?status&topic&q` | The inbox with counts |
| `GET /admin/v1/help/requests/:id` | One request with its thread |
| `POST /admin/v1/help/requests/:id/reply` | `{ message }` → 201, audited |
| `POST /admin/v1/help/requests/:id/resolve` · `/reopen` | Audited |
| `GET /admin/v1/subscriptions?status` | Every subscription with its coming boxes |
| `POST /admin/v1/subscriptions/:id/pause` · `/cancel` | `{ reason }` (5+ characters) → 204, audited |

## Owner actions before switching on

1. **Two WhatsApp templates**, utility category, approved in WhatsApp Manager
   before `WHATSAPP_CARE_UPDATES=true` (see the table in `mango-api/README.md`):
   - `mandi_help_reply`: name, request number ("HLP-12"), link to the request;
   - `mandi_subscription_due`: name, box ("2 × Alphonso 3kg Box"), date
     ("Sat, 17 Oct"), link to the subscription.
2. **Set `SUBSCRIPTION_SEASON_END`** to the season's last delivery day before
   turning on `SUBSCRIPTIONS`; without it, no subscription can start.
3. Review the wording of the help topics and the shop pages (as for `/help`).

## Tests

- `mango-api/test/care.test.js`: every rule above (switches, ownership,
  lengths, limits, the Help desk and its audit rows, WhatsApp and push through
  the stub/log providers, roles, dates, validation, the scheduler's exactly-once
  setup under repeated and overlapping runs, fortnightly cycles and end dates,
  moving to the next day with room and stock, Pay's idempotency and holds, the
  unpaid-order limit, hold expiry, skip/pause/resume/cancel, isolation, the
  staff list and its audit, account deletion and export, message text without
  phone numbers).
- `mango-api/test/security-readiness.test.js`: an isolation case for each new
  customer route.
- `tests/care.spec.ts` (panel, mock API) and `customer-app/tests/care.spec.ts`
  (shop, real API with both switches on).
