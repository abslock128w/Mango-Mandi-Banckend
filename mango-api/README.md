# mango-api

The MandiMangoes backend: the `/admin/v1` API the Mango Ops panel uses, the `/v1`
storefront API, Razorpay payments, and the engine that decides which boxes can be sold
as raw, semi-ripe or ripe on each delivery date.

Node 24 (LTS, supported until 30 April 2028), Express 4, PostgreSQL 16. One process, one database; stock holds, payment
confirmation and allocation all commit in the same Postgres transaction.

## Run it locally

```bash
cd mango-api
npm ci
# Postgres with user/password mango, database mango (docker compose up db works too)
COOKIE_SECURE=false ENABLE_DEV_ROUTES=true npm run dev
```

On start it migrates, seeds products (Alphonso and Badami, 3 kg and 5 kg), Bengaluru
pincodes and four staff logins (`manager@mandimangoes.test` / `manager123`,
`ops@mandimangoes.test` / `operator123`, `packer@mandimangoes.test` / `packer123`, `qc@mandimangoes.test` / `qc123`;
not created in production), plus a spread of demo
batches when the database is empty. Point the panel at it with
`VITE_API_URL=http://localhost:3000`.

`docker compose up --build` starts Postgres and the API together. Settings are in
[`.env.example`](.env.example); in production the API refuses to start with a weak
`JWT_SECRET`, the dev webhook secret, or `COOKIE_SECURE=false`.

## Login codes by SMS (Jio)

Customers sign in with a 6-digit code. With `SMS_PROVIDER=jio` the code goes out
through the Jio SMS gateway. Production needs Jio, or WhatsApp with
`OTP_DEFAULT_CHANNEL=whatsapp` (codes by WhatsApp only, e.g. before DLT is approved). Set `JIO_SMS_URL`,
`JIO_SMS_API_KEY`, and the DLT registration (`JIO_SMS_SENDER_ID`, `JIO_SMS_TEMPLATE_ID`,
`JIO_SMS_ENTITY_ID`). `JIO_SMS_TEXT` must match the registered template exactly, with
`{code}` where the code goes. The request body is in [`src/sms.js`](src/sms.js); check it
against your Jio account's API docs before going live: **the request format in the code is
not yet verified against Jio's documentation** (remaining blocker OPS-03b). A reply counts as sent only
when the field `JIO_SMS_SUCCESS_PATH` holds one of `JIO_SMS_SUCCESS_VALUES`, both copied from
Jio's docs; anything else (including a bare HTTP 200) counts as not sent and the code goes by
WhatsApp instead. Outside production the default
`SMS_PROVIDER=log` returns the code as `devCode` (unless `OTP_CODE_IN_RESPONSE=false`); it is
written to the log only with `LOG_OTP_CODES=true` (for a preview, where `devCode` is off;
production refuses it).

If the SMS send fails and WhatsApp is set up (`WHATSAPP_PROVIDER=meta`), the code goes out
on WhatsApp instead, as the authentication template `mandi_login_code` (code in the body and
in the copy-code button). The app can also ask for WhatsApp first with
`{"channel":"whatsapp"}` on `/v1/auth/otp/request`; the response says which channel was
used. Each fallback counts in `mango_otp_fallbacks_total`. If neither works the request fails
with `OTP_NOT_SENT`.

## WhatsApp order updates

The whole WhatsApp integration (inbox, consent, templates, webhooks, retries, set-up and the
one-day activation) is described in [docs/whatsapp/](../docs/whatsapp/README.md). This section
is the short version.

Each order step queues a WhatsApp message in the `notifications` table, in the same
transaction as the step, so an update is never lost or sent for a change that rolled
back. The maintenance loop sends them, retrying after 1, 5, 15, 60 and 180 minutes, then
marks them `FAILED`; anything still unsent after 24 hours is `SKIPPED` (old news). Staff
see each message and its state on the order page.

With `WHATSAPP_PROVIDER=meta` messages go through the WhatsApp Cloud API: set
`WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`. Every message is an approved template
named `WHATSAPP_TEMPLATE_PREFIX` + kind (default prefix `mandi_`), in `WHATSAPP_LANGUAGE`:

| Template | Sent when | Body variables |
|----------|-----------|----------------|
| `mandi_order_confirmed` | payment confirms the order | name, order number, date ("Fri, 16 Oct"), slot ("7 AM to 11 AM") |
| `mandi_replacement_confirmed` | a free replacement is booked | same as above |
| `mandi_out_for_delivery` | the order leaves for delivery | name, order number, slot, 4-digit delivery code ("Give the rider code {{4}}") |
| `mandi_delivered` | delivered | name, order number |
| `mandi_delivery_failed` | a delivery is missed and retried | name, order number, retry date |
| `mandi_date_moved` | staff move the order to another date (one order, or a whole day), or a late payment lands on the next date with stock | name, order number, new date, slot |
| `mandi_cancelled` | a confirmed order is cancelled (unpaid holds send nothing) | name, order number |
| `mandi_login_code` | login code, only when SMS fails or the app asks for WhatsApp (authentication category) | code |
| `mandi_refunded` | Razorpay accepts a refund we started (a customer cancel of an order before packing, or a manager cancel of a paid order or preorder we can't deliver; a paid pre-order is never refunded on a customer cancel). It goes out when the refund is created, before the bank has paid it, so the approved wording must say the refund **has been started** and takes a few working days, never that the money has arrived (audit PAY-09) | name, order number, amount ("Rs 1,899") |
| `mandi_preorder_booked` | a preorder is paid (says it can't be cancelled or refunded) | name, preorder number, boxes ("2 × Alphonso 3kg Box"), week ("the week of Mon, 1 Mar") |
| `mandi_preorder_spot_open` | a waitlist spot opens | name, boxes, week, payment link |
| `mandi_preorder_moved` | a week passed without stock, so the preorder moved a week | name, preorder number, boxes, new week |
| `mandi_review_request` | about a day after delivery, once per order, if nothing on it is reviewed yet (marketing category). **Needs Meta approval; only sent once `WHATSAPP_REVIEW_REQUESTS=true`** | name, order number |
| `mandi_ripeness_guide` | a minute after `order_confirmed` or `replacement_confirmed`, only when a box arrives raw or semi-ripe (utility) | name, order number, when each box is ready ("Alphonso 3kg Box (raw): ready around Mon, 19 Oct"), storage tip |
| `mandi_back_in_stock` | a box the customer asked about is in stock again (they tapped "Tell me when it's back") | name, box ("Alphonso 3kg Box (ripe)"), first day ("Fri, 16 Oct"), shop link |
| `mandi_reorder_reminder` | a week after a delivery, only for customers who turned reminders on, between 10 AM and 7 PM, not if they ordered since (marketing) | name, box they had, shop link |
| `mandi_claim_received` | a customer reports a problem with a delivered order (utility). **New: needs Meta approval; only sent once `WHATSAPP_CLAIM_UPDATES=true`** | name, order number; "Open order" URL button |
| `mandi_claim_rejected` | staff reject a claim; a replacement sends `mandi_replacement_confirmed` instead (utility). **New: needs Meta approval; only sent once `WHATSAPP_CLAIM_UPDATES=true`** | name, order number, the reason staff gave (shown to the customer); "Open order" URL button |
| `mandi_help_reply` | staff reply to a help request (utility, docs/care.md). **New: needs Meta approval; only sent once `HELP_CENTRE=true` and `WHATSAPP_CARE_UPDATES=true`** | name, request number ("HLP-12"), link to the request |
| `mandi_partner_enquiry_received` | someone sends a Partner With Us enquiry and agrees to be contacted (utility, docs/partner-network.md). **New: needs Meta approval; only sent once `WHATSAPP_PARTNER_UPDATES=true`** | name, enquiry reference ("MMP-7K2QXD9T"), partnership type |
| `mandi_partner_team_alert` | to the numbers in `PARTNER_ALERT_PHONES`: a new enquiry or product proposal, one assigned, converted or rejected, a follow-up due or overdue (utility). **New: needs Meta approval; only sent once `WHATSAPP_PARTNER_UPDATES=true`** | what happened, enquiry reference, detail, panel link |
| `mandi_bulk_enquiry_received` | someone sends a bulk enquiry (over 100 kg) from the shop (utility). **New: needs Meta approval; sent while `WHATSAPP_BULK_UPDATES=true` (the default)** | name, enquiry number ("BLK-0012"), quantity ("120 kg (40 boxes)") |
| `mandi_bulk_quote` | staff send a quote for a bulk enquiry from the panel, again for each new quote (utility). **New: needs Meta approval; sent while `WHATSAPP_BULK_UPDATES=true`** | name, enquiry number, total ("Rs 52,500"), summary, link to the quote on the Account page |
| `mandi_subscription_due` | a subscription's next box is set up and waits for payment, `SUBSCRIPTION_LEAD_DAYS` before it (utility). **New: needs Meta approval; only sent once `SUBSCRIPTIONS=true` and `WHATSAPP_CARE_UPDATES=true`** | name, box ("2 × Alphonso 3kg Box"), date ("Sat, 17 Oct"), link to the subscription |

An order without a slot says "during the day" in place of the slot.

A payment that lands after the hold ran out, when no date has stock, confirms the order at
risk. Its `order_confirmed` is held back (shown on the order page as not sent) rather than
promise a date the shop can't keep, and the shop's order page says we're finding stock. When
stock is found the confirmation goes out with the real date; a manager may instead move or
cancel the order. There is no "we're finding stock" template yet: if the owner wants the
customer told straight away, a new utility template has to be approved in WhatsApp Manager first.

**"Open order" button (UX-7).** A template with this button has one URL button (index 0) of
type *dynamic URL*, `https://mandimangoes.in/orders/{{1}}` (the shop's real domain), whose
variable the API fills with the order id, so one tap opens the order to track, move, cancel or
report a problem. `mandi_claim_received` and `mandi_claim_rejected` are created with it. For
`mandi_order_confirmed`, `mandi_replacement_confirmed`, `mandi_out_for_delivery`,
`mandi_delivered`, `mandi_delivery_failed` and `mandi_date_moved` the button is a template
change that needs Meta's approval again: add it in WhatsApp Manager, wait for every one of them
to be approved, then set `WHATSAPP_ORDER_LINKS=true`. Until then the API sends them without the
button (a button variable sent to a template without one is refused by Meta). The gift
recipient's copy of `mandi_out_for_delivery` carries the button too; the order page asks them to
sign in as the buyer.

**Confirmation with the invoice.** `mandi_order_confirmed_invoice` is one message with the
confirmation and two dynamic URL buttons, in this order: "Track order",
`https://<shop>/orders/{{1}}` (the order id), and "Download invoice",
`https://<api>/v1/invoice/{{1}}` (a signed link, `src/bill-link.js`, that opens the bill's PDF
without a sign-in for 180 days; the PDF is not attached to the message). It replaces
`mandi_order_confirmed` for an order that has a bill (`BILLS_ENABLED`) once
`WHATSAPP_ORDER_INVOICE=true`; set that only after Meta approves the template. Orders without
a bill, and every order until then, get `mandi_order_confirmed` as before.

Suggested wording for the two new templates (the owner words the final text in WhatsApp
Manager): "Hi {{1}}, we have your report about order {{2}}. We will look at it and reply here
within a day." and "Hi {{1}}, we looked into your report about order {{2}} and could not offer
a replacement: {{3}}. Reply here if you would like to talk to us about it."

Word `mandi_date_moved` so it also says when the customer can still cancel for a full refund
(within 4 hours of placing the order, before it is packed), for example: "Hi {{1}}, order {{2}}
will now arrive on {{3}}, {{4}}. If that date doesn't suit you and it is within 4 hours of
placing the order, cancel it in the app for a full refund; otherwise reply here." That is the
opt-out for a late payment or a staff move to a date the customer didn't choose; after the
4 hours only staff can cancel it.

Outside production the default `WHATSAPP_PROVIDER=log` logs each message and marks it
sent. In production without a provider, messages are skipped with a warning.

## Ordering in the WhatsApp chat

Customers can order by messaging the business number. Meta posts each message to
`POST /webhooks/whatsapp` (signed with the app secret, `X-Hub-Signature-256`); Meta
checks the endpoint first with `GET /webhooks/whatsapp` and `WHATSAPP_VERIFY_TOKEN`.
The chat (`src/chat.js`) keeps one conversation per phone in `wa_sessions`:

1. menu: Order mangoes, Book ahead, My orders (send *help* for how it works)
2. pincode, then the boxes in stock for the earliest delivery date, by ripeness
3. quantity, cart, then a delivery slot when slots are on
4. address (the last one for that pincode is offered), then a summary with Pay

Pay books the order exactly like app checkout (10-minute hold, slot check) with
`channel = 'whatsapp'`, then sends the payment. With `WHATSAPP_PAYMENT_CONFIG` set (the
Razorpay payment configuration name in WhatsApp Manager) the customer pays inside
WhatsApp; otherwise they get a Razorpay payment link. Razorpay's `payment_link.paid`
webhook, Meta's payment status update, or the reconcile loop confirms the order, and
the usual WhatsApp updates follow. My orders lists recent orders and lets the customer
cancel within 4 hours of placing an order (before packing), with the full refund for a paid
order; an unpaid order can always be dropped. WhatsApp verifies the
phone number, so the chat needs no OTP; only Indian numbers can order. Messages are
deduplicated by id, so Meta's retries are safe.

**Book ahead** in the chat makes a preorder with the same engine as `POST /v1/preorders`
(`channel = 'whatsapp'`): pick an open week and box, the ripeness, how many, the pincode
and address, then pay by Razorpay link. A full week offers the waitlist instead (no
payment until a spot opens). The confirmation step says "Pre-order · can't be cancelled or
refunded once paid" above the Pay button. Unpaid and waitlisted bookings show in My orders
with a Cancel button; a paid pre-order (and the order it became) has none. Before pre-orders
open (`preorderOpensOn`), Book ahead says when they open instead.

## After the order: ripeness guide, alerts, reminders

- **Ripeness guide.** A minute after the confirmation, an order with a raw or semi-ripe box gets
  `mandi_ripeness_guide`: the day each box will be ready to eat (raw +5 days, semi-ripe +2 from
  the delivery date, the same days the eat-by date assumes) and how to keep them. Orders that are all ripe (sold before ripe stopped being sold) skip it. The shop's order page shows
  the same "ready to eat around" date.
- **Back in stock.** A box sold out on every open day shows "Tell me when it's back" in the shop
  (signed in). The alert lasts 14 days, at most 10 open per customer, one per box and ripeness.
  The background loop checks open alerts every run and sends `mandi_back_in_stock` once, with
  the first day it can be delivered. Customers see and stop alerts on the Account page
  (`GET/POST/DELETE /v1/stock-alerts`).
- **Reorder reminder.** Off by default. A customer turns it on under Account > WhatsApp messages
  (`PATCH /v1/me {remindersOptIn}`). Seven days after a delivery, between 10 AM and 7 PM IST,
  they get `mandi_reorder_reminder`, unless they ordered again since. One per order.

Deleting an account cancels its alerts and turns reminders off.

## Promo codes and gifts

Managers make codes on the panel's Promos page (`/admin/v1/promos`): a percentage (with
an optional cap) or a flat amount off, a smallest order, start and end dates, total and
per-customer uses, and first-order-only. The shop sends `promoCode` with the quote; the
code is checked again, with the row locked, when the order is confirmed, and the use is
recorded. A use counts while its order is not cancelled. The discount never takes the
total below ₹1.

An order can be a gift: `gift { recipientName, recipientPhone, message }` at checkout. The
pack list marks it (no price slip, the note goes in the box) and the rider sees the
recipient's name and phone. Order updates and the delivery code still go to the buyer.
A pre-order can be booked as a gift too: the same optional `gift` on `POST /v1/preorders`
(migration 070), shown as `gift` on the booking, and the order the allocator makes from it
carries the recipient. A gift's address is never saved to the buyer's address book.

### Backorders

With `BACKORDERS` on (the default), a regular box short of stock on the chosen day is still quoted
and placed when a batch on its way (`ARRIVING` or `IN_TRANSIT`) can supply it that day: its truck is
due before the day, the fruit has the chosen ripeness then, and the boxes fit in what the batch is
expected to bring (its count × `forecastConfidence`, less what is held or committed on it and less what
earlier backorders still wait for). The day must be at least `BACKORDER_LEAD_DAYS` (default 2) from
today (IST); the shop promises delivery "in `BACKORDER_LEAD_DAYS`–`BACKORDER_WINDOW_DAYS` days"
(default 2–3) and reads both numbers from `GET /v1/policy` (`backorders: { enabled, leadDays,
windowDays }`). With no such batch the box is not sold as a backorder (see Earliest delivery date).

- **Quote**: a short line comes back with `backorder: true`, and the quote with `backorder: true`
  and `backorderEta: { from, to }` (never before the chosen day). A day earlier than today + lead
  answers 409 `BACKORDER_DATE` with `{ earliest, sku }` when stock can't serve the bag on any day,
  so the shop can move the date. With the switch off, a short line is 409 `STOCK_INSUFFICIENT`.
- **Catalogue**: an item a batch on its way can still supply carries `backorder: { from, qty }`.
- **Confirm**: the order is created without all-or-nothing; the boxes in stock are held as usual,
  the rest are recorded as a shortfall (`at_risk`, so the hourly `rebalance-at-risk` fills them when
  stock arrives), `orders.backorder` is set and the short lines get `order_items.backordered`.
  Payment is unchanged; a paid backorder keeps its day and its confirmation goes out as usual
  (a genuine no-stock order's is held).
- **Customer views**: `/v1/orders` and `/v1/orders/:id` return `backorder: true` and, while boxes
  are still being sourced, `backorderEta`; `findingStock` stays true until they are allocated; each
  item has `backordered`.
- **Staff**: the panel shows a Backorder badge ("awaiting stock" until allocated). Backorders waiting
  for stock are not at-risk alarms: the ops queue lists them as a quiet item, and the
  `mango_orders_at_risk` gauge leaves them out (maintenance reports them as `backordersAwaitingStock`).
- Bulk deals and gift orders to many recipients stay all-or-nothing.

### Earliest delivery date

When the chosen day can't supply the bag, the API works out the first day that can (`src/earliest.js`):
a day the customer may book (cut-off hour, `maxDaysAhead`, closed days) on which every line has enough
sellable stock under the usual rules (QC'd stock, in-transit stock at `forecastConfidence` once its
truck is due, the box's ripeness that day) and the day still has room for the whole bag (the day's
`max_boxes` in the delivery calendar and, when slots are in use, one slot with room for every box).

- **Quote and confirm**: 409 `STOCK_INSUFFICIENT` keeps `sku` and adds `requestedDate`, `earliestDate`
  (the first such day in the window), `nextDate` (the first such day on or after the requested one),
  `lines` (per line: `available` on the requested day, its own `earliestDate`, and `otherStages`:
  the first day each other ripeness fits) and `neverFit` (lines no day can supply). The shop moves the
  date and the customer presses Pay again; nothing is changed after Pay without telling them.
- **Catalogue**: each item has `earliestDate` (null: no day in the window), and the answer lists
  `fullDates` (days with no room for even one box).
- **Packing**: boxes from a batch that is still `ARRIVING` or `IN_TRANSIT` can be held and committed
  for later days but never packed, marked PACKED or dispatched: 409 `BATCH_NOT_ARRIVED` names the batch.

## Bulk Deals

Listings for large orders (offices, events, big families), sold from the same products, stock,
holds, checkout and order lifecycle as regular boxes. Bulk is a catalogue and pricing layer
over a product, not a second stock. Tables: migration `033_bulk_deals.sql`.

- **A listing** (`bulk_listings`) names one product, its own title, description, origin and
  photos, the ripeness offered, a minimum, a step and an optional most-per-order, and up to
  8 price tiers `[{ minQty, unitPrice }]` in paise per box. Each tier runs up to the next
  tier's start, so tiers can't overlap; tiers must start at the minimum, rise, line up with
  the step, and each bigger tier must cost less. One price whatever the ripeness.
- **Status**: DRAFT → PUBLISHED ⇄ UNPUBLISHED → ARCHIVED (final). Publishing needs the
  product on sale, a photo, a 20+ character description, a minimum within `maxHeldBoxes` and
  a sale end in the future. A live listing must stay publishable on every edit. Leaving
  PUBLISHED empties the listing from every cart. An optional sale window hides it outside.
- **Prices are worked out on the server only.** The cart takes `{ listingId, stage, qty }`
  (strict: a price field is refused); the quote prices each bulk line from the listing as it
  is now; confirm locks the listing `FOR SHARE` and prices it again, and a different price
  fails with `PRICE_CHANGED` so the shop quotes again before taking money. Order items keep a
  snapshot in `order_items.pricing` (listing id, version, title, tier, unit price), so later
  edits never rewrite an order.
- **Stock**: bulk lines go through `createOrder` like any line (FEFO allocation, holds, hold
  expiry, cancel and refunds unchanged). One order can't hold the same box and ripeness both
  as a regular and a bulk line, or under two deals (`CART_CONFLICT`). The unpaid-box rule
  `maxHeldBoxes` caps one bulk order (default 40). Promo codes apply to regular boxes only.
- **History**: every change is a row in `bulk_listing_events` with the version, the changed
  fields (old and new) and who made it.
- **Photos**: JPEG, PNG or WebP up to 5 MB, checked by their bytes, re-encoded without
  metadata (at most 1600 px), at most 8; the first is the main one. Public only while the
  listing is published.

## Preorders (phase 2)

> **Since migrations 078 to 080: the pre-order plan per variety.** Each variety (`products.variety`; a Mixed Box is its
> own line) has its own expected kg a day (`preorderVarietyDayKg`, others `preorderOtherVarietyDayKg`, 20 kg placeholder)
> and a week takes 7 days of it, or the week's own kg for that variety (`preorder_variety_week_kg`). Managers change it on
> the panel's Pre-order plan page: `POST /admin/v1/preorder-plan/preview` (dry run) then `/apply` (step-up for a daily-kg
> change), which recalculates the open weeks oldest first (`src/preorder-plan.js`; weeks whose deliveries started are
> frozen). A paid booking moved later is delayed: `PREORDER_DELAYED` is queued (it waits in the outbox until WhatsApp is
> connected) and the customer may cancel it, or the order it became until it is packed, for a full refund. Moved earlier:
> `PREORDER_EARLIER`. The allocator's week-without-fruit move and a manager's move take the same path. The text below
> describes the earlier single-limit design where it differs.

### Held for pre-orders (migration 082, `src/holdback.js`)

A regular shopper never takes fruit owed to pre-orders. Every PAID booking not yet turned into a delivery order
(`BOOKED`) whose week starts on or before the hold cut-off (today + `maxDaysAhead` + 1, never before the allocator's
horizon) keeps its boxes, per box (SKU: variety and box size, the unit stock lines are kept in) and ripeness. For each
day a shopper may choose, what is left for them is `min(sellable(stage) − held(stage), sellable(all stages) −
held(all stages))` per box, never below 0 (a box raw on Monday is the same box semi-ripe on Thursday). Nothing is
stored: the hold is one indexed `GROUP BY` over the BOOKED rows, so it follows cancels, delays and moves, and stock
that is adjusted, QC-shifted or retired; the ledger audit has no new counter to check.

- **Everywhere regular stock is read** (`inventory.js availability` / `availabilityByDate`, unless `{ raw: true }`):
  catalogue, earliest date, quote, checkout, chat ordering, subscriptions, gifts, bulk, back-in-stock alerts and the
  Planning coverage grid. Backorders (`backorders.js`) also take what the bookings still wait for beyond the shelf
  off the fruit on its way.
- **Every regular take** (`allocate` with `holdBack`, the default): checkout, rebalance fills and swaps, moves, late
  payments, staff-made and replacement orders. It locks every sellable line of the box in `LINE_LOCK_ORDER`
  (`lockSkuLines`; `lockOrderLines` and batch QC/condemn/retire lock the same superset first, so the DB-01 order holds)
  and only then counts what is left, so two checkouts, or a checkout and the allocator, can't both take the same free
  boxes. There is no manager override. Exempt: the allocator's own orders (`holdBack: false`), a converted pre-order's
  order being refilled, and the re-pack for a missed delivery's retry.
- **The allocator** takes the held boxes; one run at a time (an advisory lock). Besides the maintenance run it runs
  right after a batch is received, marked arrived/ripening/selling, gets a QC reading that is not a reject, or a
  count is raised (`allocateOnStock`).
- **The panel**: the Pre-order plan shows "Held for pre-orders this week: N boxes (M kg)" per variety and ripeness
  (`GET /admin/v1/preorder-weeks` → `held`).

### Booked against the plan (migration 083, `src/plan-orders.js`)

When no bookable day can take a bag, in season, the shop can book a day after the horizon against the plan. Each variety
has **one weekly budget**: room for new pre-orders and new planned orders = expected kg − pre-order kg (`reserved_kg`) −
planned kg (`planned_kg`, its own column); `assignWeek`, `/v1/preorders/weeks` and the Pre-order plan all subtract it.

- **Answers**: the quote's and confirm's `409 STOCK_INSUFFICIENT` gain `reason: 'WEEK_BOOKED'`, `offer { weekStart, from,
  words, dates: [{ date, slots }] }` (the first week, up to 4 ahead and within the season, with room for the whole bag) and
  `boxes` (those that caused it); `earliestDate` etc. are unchanged. A catalogue item with no day has `weekBooked { reason,
  weekStart, from, dates, words }`. Quoting an offered date answers `planned: true`, `plannedWeek`. Bulk deals are excluded.
- **The order**: `orders.planned`, no stock taken, its kg in the week. Views add `planned`, `plannedWeek`, `waitingForFruit`.
- **Fulfilment** (`fulfilPlannedOrders`, after the allocator, in maintenance and after stock changes): paid orders whose day
  is within the hold cut-off, oldest first, all boxes or none, after that week's pre-orders. What they wait for is part of the hold.
- **Short**: on the earliest delivery day without fruit the order moves to the next day with real stock, else a later week
  with room; `ORDER_DELAYED` is queued and `delayed { fromDate, toDate }`, `canCancelDelayed`, `cancelUntil: 'PACKED'`
  appear: a full refund until packed. All other orders keep the 4-hour rule.
- **Recalculation**: pre-orders outrank planned orders. If a pre-order would be delayed, or a week is over its number,
  planned orders without fruit move first, newest first. The preview counts them (`planned { orders, paid, kg }`).
- **A delay is for good** (pre-orders and planned orders): `delayed_at` is never cleared, so the Delayed tag and the
  cancel right (until packed) stay, and the booking or order is never moved to an earlier week or date again: not by a
  recalculation (its current week is its floor; the preview's `delayedStay { bookings, kg, overtakenBy }` counts them), a
  manager (`409 DELAYED_NOT_EARLIER`), a reschedule or the allocator. Never-delayed bookings may still move earlier.
- WhatsApp chat ordering still books only regular days. Backorders are unchanged: this path reuses their "sold now, stock
  later" shape and the rebalance's allocate, not their incoming-batch arithmetic, because the source here is the plan.

Customers book a SKU, ripeness and quantity before the fruit exists, at the price of the
day, and pay in full by Razorpay payment link. The delivery **week** (Monday start) is not
chosen: the API gives the earliest week with room, and the shop shows it before paying.

- **One weekly limit in kg, weeks by themselves (migrations 074, 076).** A delivery week takes
  up to its expected kilograms of pre-orders across every box: the rule `preorderDayKg` ("Mangoes
  expected per day for pre-orders (kg)" on the Planning page, default 1000: one batch a day) x 7,
  so 7,000 kg by default, or the week's own expected kg (`preorder_week_kg.limit_kg`, set per week
  on the Preorders page, `PUT /admin/v1/preorder-weeks/:weekStart { limitKg | null }`, managers)
  when supply differs that week. A booking takes its weight: boxes x the box's kg (`weekLoad` in
  `src/preorders.js`, fixed on the booking as `preorders.load_kg`; `WEEK_LOAD_SQL` and the shop's
  `countsBy: 'kg'` count the same). A booking is never split: one that doesn't fit what is left of a
  week goes to the next week with room, so a lighter booking made after it can still fit the earlier
  week. One heavier than every week is refused (`409 PREORDER_TOO_BIG`). The weeks need no staff
  setup (`deliveryWeeks`): Mondays from the first week after the regular booking horizon (before the
  season: the week holding `seasonStartsOn`) week after week, to the week holding `seasonEndsOn`, or
  26 weeks when no end is set. Each week's kg counter is `preorder_week_kg.reserved_kg`, taken by one
  conditional `INSERT ... ON CONFLICT DO UPDATE ... WHERE reserved_kg + kg <= COALESCE(limit_kg,
  default)`: bookings at once queue on the week's row and the second sees the first's count, so a
  week never goes over. A booking tries the weeks in date order and takes the first with room
  (`assignWeek`); a week that looks full first frees unpaid holds that ran out.
- **A week lowered below what it holds** (the harvest came in short) is allowed: new pre-orders skip
  it, the Preorders page shows "Over by N kg", and nothing moves by itself. A manager moves bookings
  (`POST /admin/v1/preorders/:id/move { weekStart, reason }`, unpaid or paid, not yet an order) to a
  week with room for their kg (else `409 PREORDER_FULL`); the kg moves with it, `moved_count` counts it,
  and a paid booking's customer gets the moved message (`PREORDER_MOVED`). Raising a week makes room:
  the waitlist first, then new pre-orders.
- **The week the customer is told.** `POST /v1/preorders` (and each person of
  `POST /v1/preorders/groups`) takes an optional `weekStart`: the week the shop showed. When it
  is no longer the week the booking would get, nothing is booked and the answer is
  `409 PREORDER_FULL` (it filled since) or `409 PREORDER_WEEK_CHANGED` (an earlier week has room
  again, e.g. raised), with `weekStart` (the week it would get now) and `requested`; the shop reloads
  the weeks, shows the new week and asks again. Without `weekStart` the API takes the earliest week
  and the answer's `weekStart` says which. A week inside the regular booking horizon or past the
  season's end answers `400 INVALID_WEEK`.
- **`GET /v1/preorders/weeks`** answers, in kg: `limit` (the default week: daily x 7), `dayKg`,
  `countsBy: 'kg'`, `deliveryWeeks` (every week with its own `limit` and `remaining`: the shop finds a
  booking's week, the earliest with `remaining` >= its kg, person by person for a gift for several
  people, exactly as the API books it), `nextWeek { weekStart, limit, remaining }` (the earliest week
  with room for one box of the lightest box on sale; null when none has), `firstWeek`, and, as
  before, `weeks`: one entry per box on sale and week with the box's name, variety, size and price,
  the week's `capacity` (= its limit) and `remaining` (kg, shared by every box), from `firstWeek` to
  the earliest week with room for one box of it. Managers see each week with booked / limit kg, its
  own expected kg and how much it is over on the Preorders page (`GET /admin/v1/preorder-weeks`).
- **The older tables.** `preorder_capacity` (per box, set by staff before 074) decides nothing: its
  `reserved` is still counted per box and week (INV-06 per box). 074's `preorder_weeks` (one per
  booking) decides nothing since 076 either; it is kept up to date so a rollback to the release that
  booked by it finds it right. Migration 076 recorded every booking's kg and recounted each week in
  kg; the INV-06 check compares each week's kg counter with its bookings (sku `ALL` on Needs
  attention; `POST /admin/v1/preorder-capacity/:weekStart/ALL/recount`, kg to the gram).
- **Deploying 076.** Expand-only: `preorderDayKg` is a new key (the previous release keeps reading
  `preorderWeekLimit`, now ignored), the kg counter a new table and `load_kg` a new nullable column.
  While the previous release still serves after 076 ran, it books by its own one-per-booking counter
  and limit; those bookings are missing from the kg counter (and have no `load_kg`; their weight is
  then read from their box). The INV-06 check shows such a week within the hour and a manager's
  recount fixes it.
- **Waitlist.** Only when every week to the season's end is full: then a booking is refused
  with `PREORDER_FULL` (`weekStart: null`), or with `waitlist: true` joins the waitlist (held on
  the season's last week until a spot opens). Freed room goes to the waitlist in booking order
  (strictly: a later booking does not go ahead of an earlier one that doesn't fit yet), each
  promoted booking taking the earliest week with room; the promoted customer gets a WhatsApp
  message with a payment link at once and 12 hours to pay. When a waitlisted booking's week
  reaches the regular booking horizon its waitlist closes: it is cancelled (nothing was paid)
  and the customer gets the cancelled message (`mandi_cancelled`).
- **Holds and late payments.** An unpaid booking holds its week's place for `holdMinutes`. A
  payment after the hold still books it (over the limit if need be), as for orders.
- **Allocator.** Every maintenance tick, each paid preorder whose week has reached one day
  past the regular booking horizon becomes a normal confirmed order on the first date in its
  week with stock. Preorders therefore claim stock before regular shoppers can book that
  date. The order carries the preorder's payment, and the usual WhatsApp updates follow.
  When a week passes with no stock, the preorder moves to the next week and the customer is
  told (`moved_count`); its place moves with it (over the limit if need be); nothing is cancelled.
- **Gifts.** `POST /v1/preorders` takes the checkout's optional
  `gift { recipientName, recipientPhone, message }`; the booking answers `gift` (or null), and
  the order it becomes is a gift order (`orders.gift_*`, migration 070).
- **A gift for several people** (MULTI_GIFT, migration 071, docs/gifting.md "Before the
  season"): `POST /v1/preorders/groups` (`Idempotency-Key` required) takes
  `{ name?, recipients: [{ sku, stage, qty, weekStart?, pincode, address, gift }] }` and books
  one gift pre-order per person in one transaction (`preorder_groups`, `preorders.group_id`),
  with one hold and ONE payment link for the group's total. Each person, in list order, gets
  the earliest week with room, so a group can straddle two weeks (some people in week N, the
  rest in N+1; one person's boxes are never split; the shop shows each person's week). A person
  whose shown week changed, or no week with room, fails the whole group (`409 PREORDER_FULL` / `PREORDER_WEEK_CHANGED`,
  message "Person N: …", `row`); a group never joins the waitlist. Paying the link (webhook, reconcile, `POST /v1/dev/pay-preorder` with any of
  its bookings) books every booking; each records its own `paid_amount`, the payment id
  stays on the group, and a staff refund of one booking refunds its own amount from it. A
  hold that runs out cancels each booking and frees its week; a late payment still books
  them all. An unpaid group is one unpaid booking (`UNPAID_PREORDER_EXISTS`); the buyer's
  cancel before paying cancels the whole group; once paid, non-refundable as any pre-order.
  `GET /v1/preorders/groups/:id` answers the group with its bookings; every booking's view
  carries `group { id, number, kind, people, lines, total, position }` (null when alone).
  A hold that runs out cancels every booking of a group together, whichever sweep finds it.
- **The pre-order bag** (migrations 089, 090: `preorder_groups.kind` `GIFT` or `BAG`): several
  boxes pre-ordered for yourself in one checkout and ONE payment, each line keeping its own
  delivery week. `POST /v1/preorders/quote` (public, no booking) takes `{ lines: [{ sku, stage, qty }] }`
  (up to 10 lines, one per box and ripeness: `400 DUPLICATE_LINE`) and answers each line's price
  and week (`weekStart`, or `tooBig` / `full`), counting the lines above it in the same variety, with
  `total`, `boxes` and `payable`. `POST /v1/preorders/confirm` (`Idempotency-Key` required) takes
  `{ lines: [{ sku, stage, qty, weekStart? }], pincode, address, name?, slotId?, nonRefundable: true }`
  and books one pre-order per line under a `P` number (a group of kind `BAG`, `201` with
  `groupView`), paid by one payment link, exactly as a gift for several people above: a changed week
  refuses the whole bag naming the line ("Line N (box): …"), one payment books every line, an unpaid
  bag is one unpaid pre-order, and cancel and delay work per line as for any pre-order. It does not
  need MULTI_GIFT. `GET /v1/preorders` keeps a bag's lines together.
- **Ask the recipient for the address** (GIFT_ADDRESS_LINKS with MULTI_GIFT, migrations 091/092,
  `src/gift-address.js`): a person in a group may have `askAddress: true` and no `pincode` or
  `address` (refused with `400 ASK_ADDRESS_OFF` while either switch is off). The booking takes
  its week by kg as usual with `addressState: 'ADDRESS_PENDING'`. Once the group is paid the
  recipient gets `GIFT_ADDRESS_REQUEST` with a button to `<shop>/gift-address/<token>` (once,
  however often the payment arrives). Public: `GET /v1/gift-address/:token` (`state`,
  `recipientName`, `fromName`, `box`, `weekStart`, `message`, `expiresAt`) and
  `POST /v1/gift-address/:token { address, pincode }` (once: `409 ADDRESS_GIVEN`; a pincode we do
  not serve `400 NOT_SERVICEABLE`; `410 LINK_EXPIRED` from the start of the day before the week,
  IST; `410 GIFT_CANCELLED`; `404 LINK_NOT_FOUND`). The giver sees `addressState`,
  `addressLink { sentAt, sendCount, expiresAt, canResend, resendAfter }` and `addressMessage` on
  each booking of `GET /v1/preorders/groups/:id` (a recipient's address is not shown back, only
  its pincode) and sends the same link again with
  `POST /v1/preorders/groups/:id/preorders/:preorderId/send-link` (every 10 minutes at most, 5
  times: `429 RESEND_TOO_SOON` with `retryAfter`, `409 RESEND_LIMIT`, `409 NOT_PAID`,
  `409 ADDRESS_GIVEN`, `409 NOT_ASKED`, `410 LINK_EXPIRED`). Five days before the week the
  maintenance step `gift-address-reminders` sends `GIFT_ADDRESS_REMINDER` to the recipient and
  `GIFT_ADDRESS_MISSING` to the giver, once each. The allocator leaves a booking without an
  address BOOKED (it keeps its kg) and converts it on the first run after the address is given.
- **Season.** Two rules on the Planning page, `seasonStartsOn` and `preorderOpensOn`
  (both optional, `src/season-phase.js`): before the season starts the shop's home page is
  the pre-order shop (phase `PREORDER`), before pre-orders open nothing can be booked
  (`BEFORE`: `POST /v1/preorders` and Book ahead refuse with `PREORDERS_NOT_OPEN`), and from
  the start date the shop sells as usual (`OPEN`; booking ahead stays open on WhatsApp, as
  before). `GET /v1/catalogue` and `GET /v1/preorders/weeks` carry
  `season: { phase, startsOn, preorderOpensOn }`. Unset start date: always `OPEN`.
  Migration 075 set the 2027 dates on a database whose live rules had no start date
  (`seasonStartsOn` 2027-03-01, `preorderOpensOn` 2026-11-01, and a season end on or before the
  start cleared); it does nothing when a start date is set or on a fresh database.
- **Non-refundable.** Pre-orders can't be cancelled or refunded once paid
  (`preorders.non_refundable`, set on every booking since migration 064). The customer can
  still drop an unpaid or waitlisted booking (`POST /v1/preorders/:id/cancel`); a paid one,
  or the order it became, answers `409 PREORDER_NON_REFUNDABLE`, and the order's
  `canCancel` is false. Bookings made before migration 064 keep the old promise: cancel
  before packing for a full refund. Unchanged: a manager's cancel (a week we can't fill)
  refunds in full; a payment after the hold ran out or after a cancel is refunded
  automatically; quality claims on the delivered order work as for any order.

## Season ops (phase 3)

- **Bulk reschedule.** `POST /admin/v1/orders/bulk-reschedule` (managers) moves every
  confirmed or processing order on `fromDate` to `toDate`, optionally only some `pincodes` or
  `orderIds`, with a `reason` that goes on each order. Send `dryRun: true` first to see what
  matches. Each order moves in its own transaction, onto `toDate` or the next open date after it
  with stock, and the customer gets `mandi_date_moved`. Orders with no stock anywhere stay put and
  come back in `notMoved` so ops can handle them. At most 500 orders per call.
- **Rider manifest.** `GET /admin/v1/manifest?date=` returns the day's run: one block per slot,
  stops by zone and pincode, each with address, phone, boxes and whether it is packed. Every
  order is prepaid, so riders collect nothing. It assumes MandiMangoes' own riders; a delivery partner
  would need an export in their format.
- **Analytics.** `GET /admin/v1/analytics?from&to` (default: the last 8 weeks to the end of this
  week) returns week-by-week sales (by delivery date), deliveries and misses, at-risk orders,
  boxes received and wasted (condemned or retired), customer cancels, refunds and claims, plus a
  per-SKU table and totals. Money is in paise.

## Proof of delivery

Riders have their own staff role, `RIDER`, which can open the Deliveries page and nothing
else. A packer, operator or manager can do the same steps.

- **Start a run.** `POST /admin/v1/manifest/dispatch` `{date, slotId}` sends every packed order
  of that slot (`slotId: null` for orders without one) out for delivery; unpacked orders are
  skipped and listed. `POST /orders/:id/dispatch` does one order, including a retry after a
  missed delivery.
- **Delivery code.** Going out for delivery gives the order a 4-digit code. The customer sees it
  in the app and in the `mandi_out_for_delivery` WhatsApp message, and reads it to the rider. A
  retry keeps the same code. Five wrong codes lock it (`CODE_LOCKED`); then the rider uses a photo.
  For a gift, the recipient gets the same message with the code (kind `GIFT_OUT_FOR_DELIVERY`,
  sent with the `mandi_out_for_delivery` template and the recipient's name), since they are the
  one at the door.
- **Delivered.** `POST /orders/:id/delivery` `{outcome: 'DELIVERED', code}`, or with
  `photoId` and `receivedBy` ("Security at the gate") when nobody can give the code. Photos are
  uploaded first as the raw body of `POST /orders/:id/delivery-photos` (JPEG, PNG or WebP, 2 MB
  at most; the panel shrinks them to about 150 KB) and kept in `delivery_photos`.
- **Photo deliveries are checked.** A delivery proven only by a photo waits in Needs attention
  (`GET /admin/v1/delivery-reviews`) until someone other than the rider marks it right, or
  doubtful with a note (`POST /admin/v1/delivery-reviews/:id {ok, note}`), which goes on the
  order history so someone calls the customer. A photo after wrong codes, or with no location,
  is flagged.
- **Missed.** `{outcome: 'FAILED', reason}` with `NOT_HOME`, `UNREACHABLE`, `WRONG_ADDRESS`,
  `REFUSED` or `OTHER` (plus a `note`), optionally a photo. The order moves to the next delivery
  day as before, with the reason on the order.
- Each attempt is a row in `delivery_attempts`, with the rider and, if the phone allows it,
  where they were. Staff moving an order to delivered from the order page is recorded as
  `staff`, with no proof. The staff order page shows every attempt and photo; the customer
  sees how it was handed over and the photo (`GET /v1/orders/:id/delivery-photo`).

## Delivery slots

Managers set up delivery windows (Planning page, or `/admin/v1/slots`), each with an
optional daily box limit. Once any slot is on, checkout requires one: the quote takes
`slotId` and refuses a full slot (`SLOT_FULL`). `GET /v1/delivery/slots` lists each
slot's remaining boxes for a date. Staff can pick a slot when moving an order. Moves
the system makes (late payments, failed-delivery retries, replacements) keep the slot
if it has room, else take the first with room, and never fail because of a slot.
Slots are switched off rather than deleted, so old orders keep theirs. The pack list
is sorted by slot.

## Delivery charge

Regular orders can carry a delivery charge (`src/delivery-fee.js`). It is **off** until a manager turns it on in the
panel (Planning → Delivery charge); off, every answer is as before and delivery is free. The settings are part of the
versioned rules (`deliveryFee` in `app_config`), so every change is a new rules version with an audit row.

- **How far.** A straight line from the nearest warehouse (the rules' `origins`, else the warehouses' saved
  positions) to the pin the customer drops on the shop's map, with the centre of the pincode being ordered to as the
  floor: the pin can raise the distance, but lower it by 1.5 km at most (`PIN_TOLERANCE_KM`, `src/delivery-fee.js`),
  for the price and for the range check alike, so a pin dropped next to the warehouse buys nothing. With no pin the
  centre is used. A pincode with no centre has no floor, so its pin is not believed and the rules' `unknownKm` is
  assumed (the order is never refused then); staff set centres on the Pincodes page, which warns about any without.
- **How much (by weight and distance).** The default table (rupees in the rules, paise everywhere else):

  | Distance | Under 5 kg | 5 kg and above |
  |---|---|---|
  | Up to 2 km | ₹30 | Free |
  | 2 to 5 km | ₹50 | ₹30 |
  | 5 to 8 km | ₹70 | ₹50 |
  | 8 to 12 km | ₹100 | ₹80 |
  | Past 12 km | Not delivered | Not delivered |

  The first band the distance fits in (`uptoKm`, inclusive) gives the row; the order's **weight** (boxes × the box
  size, `3kg`, `5kg`) gives the column: `freeFromKg` (default 5, inclusive: one 5 kg box qualifies; the one comparison
  is `heavyByWeight` in `delivery-fee.js`) or more pays the band's `fee`, lighter its `feeSmall`. What the order is
  worth decides nothing. `freeFromKg` `0`: no weight line, every order pays `feeSmall` and none is free.
- **Free delivery.** Only for orders of `freeFromKg` or more, and only at or within `freeWithinKm` (default 2 km):
  there they pay 0 whatever the band's `fee` says. Past it there is always a charge: a save (`rulesSchema`) is refused
  when a band reaching past `freeWithinKm` (or the last band, with `beyond: 'charge'`) has 0 in either column. Stored
  versions are not checked, so an older one always loads. Past the last band the order is refused with `TOO_FAR`
  (422), whatever it weighs, or pays the last band's charge (`beyond`).
- **Older rules.** `freeAbove` (the order value that picked the column before 18 Nov) still parses and is still sent
  to the shop as before, but decides nothing; the panel no longer shows it. Migration 072 moved a live `freeFromKg` of
  6 (the old "free from 6 kg at any distance") to 5 with `freeWithinKm` 2; a version without the keys gets the
  defaults on load.
- **What the shop reads.** Policy (`deliveryFee`) and `delivery` answers carry `freeFromKg` and `freeWithinKm` (and
  `freeAbove`, unused). `delivery.feeAtOrAbove` is what an order of `freeFromKg` or more pays at that distance (0
  within `freeWithinKm`), `feeBelow` what a lighter one pays, and `fee` the charge for this order (the check has no
  bag, so its `fee` is the lighter one's). A quote's `delivery` also has `weightKg`.
- **Where it shows.** `GET /v1/delivery/check?pincode=&lat=&lng=` adds `delivery` (for the bag); `GET /v1/policy`
  adds `deliveryFee` (the table); `POST /v1/checkout/quote` takes `location: { lat, lng }` and answers `deliveryFee`
  and `delivery`, with the charge in `total`. The charge is fixed with the quote. Orders answer `deliveryFee` and
  `deliveryKm`.
- **How it is stored.** No column for the charge: an order's `total` is its goods less the promo plus the charge,
  which is how the bill already reads a delivery charge (`bills.js`). `orders.delivery_km` (migration 068) keeps the
  distance it was measured over.
- **Not charged:** gift orders, pre-orders, subscriptions and staff-placed orders. Bulk orders keep their own 10%.

## Partner Network

The shop's Partner With Us form (`/v1/partner-network`, no sign-in) and the panel's Partner
Network section (`/admin/v1/partner-network`, managers and operators). Behaviour, statuses and
routes: [docs/partner-network.md](../docs/partner-network.md). Migrations 058 and 059.

| Variable | Default | What it does |
|---|---|---|
| `PARTNER_NETWORK` | `true` | On unless `false`; managers can also turn it off on the panel's Settings page. Off: every partner route answers 404 and the shop hides its links. |
| `WHATSAPP_PARTNER_UPDATES` | `false` | The applicant's receipt and the team alerts on WhatsApp (`mandi_partner_enquiry_received`, `mandi_partner_team_alert`). Turn on only after Meta approves both. |
| `PARTNER_ALERT_PHONES` | empty | Comma-separated Indian mobile numbers for the team alerts. Empty: no team alerts (the panel's Overview shows the same). |

## Bulk orders and enquiries

The shop's `/bulk` page has three tabs (`shop/bulk.js`): **Bulk order** (`/bulk`, 100 kg and above, ordered and paid
now), **Send enquiry** (`/bulk/enquiry`, 250 kg and above, a quote) and **Farm visit** (`/bulk/farm-visit`, 250 kg
and above: a farm visit enquiry, below). All three kinds live in `bulk_enquiries` (`kind` ORDER, ENQUIRY, FARM_VISIT),
are numbered `B…` (order-number.js; a farm visit enquiry is labelled "Farm visit" wherever it shows, so no new letter
is needed) and show in the panel's Bulk orders section (managers and operators), in its own list each. Money is in paise; every
total is worked out by the API. Migrations 060, 061, 067, 084 and 085.

**Bulk prices** (`src/bulk-price.js`). A box's bulk price is a manager's own price for it (`products.bulk_price`) or
the shop price less the default bulk discount (the rule `bulkDiscountPct`, 25: a ₹100 box is ₹75), rounded to whole
rupees. Bulk boxes are 5 kg or 10 kg; the 10 kg bulk box is two of a variety's 5 kg box (`packKg: 10` on the 5 kg
SKU), so it costs twice the 5 kg bulk price. Managers set both on the panel's Products page (Bulk prices, step-up).

**A bulk order** (`kind: 'ORDER'`, `src/bulk-orders.js`) is placed signed in, from a list of 100 kg or more
(`BULK_TOO_SMALL`) in 5 kg or 10 kg boxes (`BULK_BOX_SIZE`), at bulk prices, plus delivery at `BULK_DELIVERY_PCT`
(10%) of the mangoes' value. Prices sent by the shop are ignored (a `total` is refused). It is paid in full by a
Razorpay payment link, as a pre-order is: the link's own id or its notes tie a payment to it (PAY-B11), the amount and
currency are checked, a replay changes nothing, a second payment is kept in `duplicate_payments.bulk_enquiry_id` and
refunded, the reconcile loop finds a payment whose webhook was lost, and locally the shop's "Pay (test)" uses
`POST /v1/dev/pay-bulk`. Statuses:

| Status | Meaning |
| --- | --- |
| `PAYMENT_PENDING` | placed; `BULK_PAY_MINUTES` (30) to pay. The maintenance step `bulk-orders` then cancels it (`payment_status CANCELLED`, nobody cancelled it), and "Pay again" opens it once more at today's bulk prices with a new link (a payment on the old link still finds it, and is checked against today's total). A payment after the time ran out is honoured. |
| `PAID` | paid in full: `BULK_ORDER_PAID` goes to the customer ("received and paid"; our team calls on WhatsApp to arrange the delivery, usually 5 to 7 days) and `bulk.enquiry` to the panel's live stream |
| `CONFIRMED` | staff called the customer ("Called customer") |
| `DISPATCHED`, `DELIVERED` | staff steps; from `DISPATCHED` the customer can no longer cancel |
| `CANCELLED` | by the customer (unpaid; or paid, within `CUSTOMER_CANCEL_HOURS` (4) of paying and before dispatch: refunded in full), by a manager (any time; a paid one is refunded in full, step-up), or not paid in time |

Refunds use the order refunds' lease, back-off, give-up and Razorpay checks (`claimRefund('bulk_enquiries')`,
`processDueRefunds`, `reconcileRefunds`). A paid bulk order gets no numbered bill (bills belong to `orders`): the
shop's order page `/bulk/orders/:id` is its payment receipt (amount, method, payment id, lines at the prices paid).
Direct orders placed before payment came in (unpaid, status `NEW`) still list, and staff close them as before.

**An enquiry** (`kind: 'ENQUIRY'`) asks for a price, from `BULK_ENQUIRY_MIN_KG` (250 kg; less: `400
BULK_ENQUIRY_TOO_SMALL`, "Enquiries are for 250 kg and above. From 100 kg you can order and pay directly."). Nothing is
paid. Staff quote it (lines starting from today's bulk prices; the quote can be lower; extras; delivery at 10% of the
mangoes; a valid-until date): the quote goes on WhatsApp (`mandi_bulk_quote`) and to the shop's Account page, where
the customer accepts or declines it. An order sent to the enquiry form is refused with `400 BULK_ORDER_PAY_ONLINE`.

**A farm visit enquiry** (`kind: 'FARM_VISIT'`, migration 087) is the Farm visit tab's form: always open, signed in or
not, no farm switch needed. Name, mobile, city, which mango (a variety we sell, or not sure yet), about how many kg
(`FARM_VISIT_MIN_KG`, 250, the farm visit's own minimum; 100 until 24 Nov 2026), a preferred date (not in the past)
or flexible, how many people, a note, and optionally the language to speak with them (`preferred_language`: English,
Telugu, Hindi, Tamil, Kannada or Other) and another mobile number (`alt_phone`, migration 094). The same Idempotency-Key rules, daily per-phone limit and connection limit as an enquiry. It
queues `FARM_VISIT_ENQUIRY_RECEIVED` on WhatsApp and the live `bulk.enquiry` event (`kind: 'FARM_VISIT'`). Staff move it
NEW → CONTACTED ("Called customer") → VISIT_PLANNED (the agreed date, `planned_visit_date`) → VISITED, or close it
with a reason (`close_reason`, shown to the customer); every step is an event with who and when. Needs attention and
Today list the new ones (`farmVisitEnquiries`), and the panel's Bulk orders menu item shows their count. The full
Farm Experience booking (docs/farm-experience.md) stays for staff use later; the tab links to it only while it is on
and bookings are open.

| Route | Who | What |
|---|---|---|
| `POST /v1/farm-visit-enquiries` | anyone (a signed-in customer's token links it) | `{name, phone, city, variety?, kg, visitDate?, flexible?, people, notes?}`; `201 {id, number, status: 'NEW', kind: 'FARM_VISIT'}`. Listed in `GET /v1/me/bulk-enquiries` with `farmVisit: {variety, kg, preferredDate, flexible, people, plannedDate, contactedAt, visitPlannedAt, visitedAt, closeReason}` |
| `POST /admin/v1/bulk-enquiries/:id/farm-status` | managers, operators | `{to: 'CONTACTED' \| 'VISIT_PLANNED' \| 'VISITED', date?, note?}` (VISIT_PLANNED needs a date from today); closing is `/close` with `{reason}` (required for a farm visit) |
| `GET /v1/bulk/prices` | anyone | `{discountPct, items: [{sku, variety, name, custom, packs: [{packKg: 5 \| 10, price, bulkPrice, savingPct}]}]}` (paise): every variety on sale with a 5 kg box |
| `POST /v1/bulk-enquiries` | anyone (a signed-in customer's token links it to the account) | an enquiry: `{name, business?, email?, phone, city, notes?, lines: [{sku, stage, boxes, packKg?}] \| quantityKg, ripeness?}`, 250 kg or more; `Idempotency-Key` honoured for the same sender and body (another body: `422`); `BULK_ENQUIRY_DAILY_LIMIT` per phone a day, 10 an hour per connection. Answers `{id, number, status, kind}` |
| `POST /v1/me/bulk-orders` | signed-in customer | a bulk order: `{name, business?, email?, phone, city, address, pincode, notes?, lines}`, `Idempotency-Key` required. `201` with the order as `GET /v1/me/bulk-enquiries/:id` shows it, its link made |
| `POST /v1/me/bulk-orders/:id/pay` | signed-in customer | the payment link again, or "Pay again" after the time ran out (`409 NOT_PAYABLE` for a paid or cancelled one) |
| `POST /v1/me/bulk-orders/:id/cancel` | signed-in customer | unpaid: cancelled; paid: within 4 hours of paying and before dispatch, refunded in full (`409 CANCEL_WINDOW_CLOSED`, `409 BULK_DISPATCHED`) |
| `GET /v1/me/bulk-enquiries`, `GET /v1/me/bulk-enquiries/:id` | signed-in customer | their enquiries and orders (sent signed in, or from the number they signed in with); `unread` while a quote is unopened. An order paid online carries `order: {amountPaise, mangoesPaise, deliveryPaise, shopValuePaise, savingPaise, deliveryPct, address, pincode, paymentStatus, payBy, paymentUrl, payAgain, paidAt, paidPaise, receipt, cancelUntil, canCancel, cancelHours, cancelledAt, cancelledBy, refund, confirmedAt, dispatchedAt, deliveredAt}` and its lines `unitPaise`, `shopUnitPaise`, `linePaise` (paise, named so the shop's client never converts them) |
| `POST /v1/me/bulk-enquiries/:id/seen`, `.../respond` | signed-in customer | opened the quote; `{decision: 'ACCEPT' \| 'DECLINE', message?}` on a QUOTED enquiry |
| `GET /admin/v1/bulk-enquiries?status&kind&q` | managers, operators | the list (`kind` ORDER, ENQUIRY or FARM_VISIT), paid orders still to deliver first, with `counts` per status, `kinds` (per kind and status, for the panel's tabs and badges), what was paid and the refund state |
| `GET /admin/v1/bulk-enquiries/:id` | managers, operators | one: lines with catalogue and bulk prices, the order's money and payment, the quote and its text, events, WhatsApp messages |
| `POST /admin/v1/bulk-enquiries/:id/status` | managers, operators | `{to: 'CONFIRMED' \| 'DISPATCHED' \| 'DELIVERED', note?}` on a paid order |
| `POST /admin/v1/bulk-enquiries/:id/cancel` | managers (step-up when it refunds) | `{reason}`: cancels a bulk order, refunding a paid one in full |
| `POST /admin/v1/bulk-enquiries/:id/quote`, `/close`, `/note` | managers, operators | an enquiry's quote (not a paid order: `409 BULK_ORDER_NO_QUOTE`), closing it (a paid order is cancelled instead), a staff note |
| `GET /admin/v1/bulk-prices` | managers, operators | the editor's list per variety (5 kg box, its own bulk price, the 5 kg and 10 kg prices customers pay) |
| `PUT /admin/v1/bulk-prices` | managers, step-up | `{discountPct, prices: [{sku, bulkPrice: paise \| null}]}` (5 kg boxes only, whole rupees, never above the shop price); the discount is saved as a rules version |

| Variable | Default | What it does |
|---|---|---|
| `BULK_ENQUIRIES` | `true` | On unless `false`; managers can also turn it off on the panel's Settings page. Off: every route above answers 404 and the panel hides the section (refunds already due still go out). |
| `BULK_ENQUIRY_DAILY_LIMIT` | `5` | Bulk orders and enquiries one phone number may send in 24 hours. |
| `WHATSAPP_BULK_UPDATES` | `true` | "We got your enquiry", "your quote is ready" and "bulk order received and paid" on WhatsApp. Until Meta approves the templates they fail or are skipped with the reason; the shop and panel show the same. |

## Order numbers

Since migration 077 (`src/order-number.js`) every new order, pre-order, gift and bulk order gets a letter and
9 scrambled digits, stored as `S743406080` and shown to people as `S-743 406 080` (the letter set apart: S
looks like 5 and B like 8). The letter is decided when the record is made and never changes:

| Letter | What | Issued by |
| --- | --- | --- |
| S | a normal shop order | checkout, the WhatsApp chat, a subscription's order, a claim's replacement |
| P | a pre-order for yourself | `bookPreorder`; the delivery order it becomes (`allocatePreorders`) keeps the same number |
| G | anything sent as a gift | a gift from the bag, a gift order for several people and each delivery in it, a gift pre-order, a gift pre-order for several people and each booking in it |
| B | a bulk order or enquiry | the shop's bulk page (`bulk-orders.js`, `bulk-enquiries.js`) |

The digits are the letter's sequence value x `FACTOR9` mod 1e9, zero-padded: unique, not counting orders out loud,
and reversible (`INVERSE9`), so `orderSeqSql` still sorts by the order things were placed in and `restore.js`
moves each sequence past every number already stored. S, P and B each have their own sequence; **G has one
sequence shared by orders, gift_orders, preorders and preorder_groups**, so one G number never names two things
(a booking and the delivery order it became share theirs on purpose). Older numbers (`7434060801`, shown
`#7434060801`; `ORD-1024`, `PRE-1035`, `PGR-1001`, `GFT-12`, `BLK-0007`) are kept as they are and still found,
sorted and printed. Searches (panel orders, gift orders, bulk, help desk; WhatsApp chat lookups) take a number
typed with or without the hyphen, spaces, lowercase or a leading `#` (`normaliseOrderNumber`). Bill numbers
are their own series; the bill prints the order number beside it. The one formatter per app: `orderNo` /
`formatOrderNumber` here, `orderNo` in `shop/app.js`, `src/orderNumber.ts` in the panel, `orderNo` in
`rider-app/lib/format.ts`.

## The rules it enforces

The two specs split the work: the technical plan fixes the API contract, and the
*Backend Architecture and Edge-Case Playbook* fixes the engine. The business rules
below override both.

- **No refunds for problems with delivered fruit, only replacements.** A claim resolves
  as `REPLACEMENT_APPROVED` (a free replacement order on the earliest date with stock) or
  `REJECTED`. Money goes back in full in two cases only: a customer cancels a paid order
  within 4 hours of placing it and before packing, or a **manager** cancels a paid order or booking that we can't deliver
  (a short truck, a third missed delivery, an at-risk order, a crop failure for a
  booking). The panel asks the manager to confirm the refund; operators can't do it.
- **Claim limits.** A customer can raise 3 claims in 30 days from the app (then they are
  asked to message us), and an order already replaced can't be claimed again. A
  replacement needs a manager when the customer had 2 or more in 90 days, or when they
  say "not delivered" on an order their own delivery code confirmed.
- **Ripeness comes from age on the delivery date.** Day of pluck is age 0. By default
  a batch reaches the warehouse at age 1 (`transitDays`), sells as raw at ages 1–3 and
  semi-ripe at 4–7, and is spoilt, never sold, from age 8 (batches retire then). Nothing is
  sold as ripe: QC may still record a ripe reading, which shifts a batch by up to a day
  (QC'd ripe while the profile expected semi-ripe = a fast ripener; past the last window
  inside the cap it stays semi-ripe), and orders sold as ripe before this rule stay
  honoured by boxes that are semi-ripe on the day. Nothing older than 7 days on its
  delivery date is sold (fewer when the product has a shorter `shelf_life_days`).
  Physical stock needs an intake QC before it is sold; stock still in transit sells only
  for dates after its arrival, at 85% of its count. With next-day delivery a batch that
  arrives at age 1 is in practice delivered raw at ages 2 and 3 only, and the last day it
  can be ordered is the day before its last delivery day (`sellWindow`, delivery.js).
  Migration 063 moved existing databases to these rules.
- **Delivery dates.** Order before 18:00 IST for next-day delivery, after it for the day
  after. There is no same-day delivery. Closed days and per-day box limits come from the delivery calendar. Customers
  can book up to 5 days ahead.
- **Holds and FEFO.** Checkout holds stock for 10 minutes, oldest batch first, with a
  conditional `UPDATE` so two buyers can never take the same box. A database `CHECK`
  backs it up. Payment turns the hold into a commitment. How the counters, ledger
  events, hold expiry, returns and lock order fit together:
  [docs/warehouse/STOCK.md](../docs/warehouse/STOCK.md).
- **Rebalancing, never cancelling.** After QC, a status change, a condemned batch and
  hourly, every open order is re-checked. Stock that no longer fits is swapped to another
  batch with the same SKU and stage. What can't be swapped flags the order **at risk**
  for ops, and later rebalances fill it if stock arrives.
- **Late payments** (user decision): a payment that lands after the hold expired still
  confirms the order. If its stock is gone it moves to the next date that has stock.
- **Failed deliveries** (user decision): `DELIVERY_FAILED` reschedules the order to the
  next delivery day for a retry. If the packed boxes would pass the 7-day limit by
  then, the order is flagged at risk. After 3 missed deliveries it is not rescheduled
  on its own: the Needs attention card asks staff to call the customer, and the usual
  "we'll retry on" message is not sent.
- **Failed payment attempts** keep the hold: the customer can try again on the same
  payment page until the hold ends. Only the hold expiring cancels an unpaid order.
- **Double charges**: a second payment captured for an order or preorder that is
  already paid is refunded on its own (`duplicate_payments`); the order is untouched.
  So is a captured payment that fails the amount or currency check. Every refund the
  system sends on its own is listed in deploy/VERCEL.md ("Refunds the system sends on
  its own").
  Payment links expire 16 minutes after they are made, and the shop's payment window
  closes when the hold ends.
- **Customer cancels** of a paid order are allowed only within 4 hours of placing it
  (`CUSTOMER_CANCEL_HOURS` in `src/orders.js`, told to the shop as `cancelWindowHours` in
  `GET /v1/policy`) and only while it is not yet packed; after that the API answers
  `409 CANCEL_WINDOW_CLOSED` (or `NOT_CANCELLABLE` once packed). The same rule covers the
  app, gift deliveries and the WhatsApp chat; an unpaid order can always be dropped, and
  staff and manager cancels are not bound by it. Orders carry `canCancel` and `cancelUntil`.
  A paid order cancelled in time is refunded in full: the refund is requested in the cancel transaction, sent to Razorpay right
  after, and retried by the maintenance loop with a growing wait (2 minutes up to an
  hour, 8 attempts, then a manager settles it; it checks for an existing refund first,
  so retries never pay twice). Every state and money path: docs/order-states.md. A payment that arrives after the customer
  cancelled is refunded too, and a replayed payment can't revive the order. Staff can
  cancel an unpaid order up to out-for-delivery; a paid one needs a manager and is
  refunded in full. A payment that lands after a staff cancel is refunded, not
  revived. Boxes not yet shipped go back on the shelf.

- **Customers can move their own order** to another open day (and slot) while it is
  confirmed and not yet being packed, if that day has stock at the ripeness they chose.
  Staff can still move processing orders too.
- **Ratings**: after delivery a customer gives 1 to 5 stars and a note. Staff see it on the
  order, and Analytics shows the average and lists 1 and 2 star orders to call back.
- **Sold-out choices** in the catalogue carry `nextAvailableDate`, the next bookable day
  with stock for that box and ripeness, so the shop can offer that day instead.
  Every item also carries `availability`, `[{date, qty}]` for the chosen day and each later
  bookable day (0 included). The shop uses it to let a box that is only ready later go in the
  bag, and moves the order to the earliest day on which everything in the bag is in stock.

All the numbers above live in the versioned `app_config` table (`GET/PUT
/admin/v1/config`). Each order records the version it was placed under.

## API

| Area | Routes |
|------|--------|
| System | `GET /health`, `GET /ready`, `GET /metrics` (optional bearer `METRICS_TOKEN`; Docker path only, 404 on Vercel) |
| Staff auth | `POST /admin/v1/auth/login`, `/refresh`, `/logout`, `GET /auth/me`. Refresh token is the httpOnly `mango_admin_rt` cookie, rotated on each use. |
| Dashboard | `GET /admin/v1/summary` (adds `atRiskOrders`), `GET /products` |
| Bulk Deals (manager) | `GET /bulk-listings?status&page`, `POST /bulk-listings`, `GET/PATCH /bulk-listings/:id`, `POST /bulk-listings/:id/publish`, `/unpublish`, `/archive`, `GET /bulk-listings/:id/history`, `POST /bulk-listings/:id/photos`, `PUT /bulk-listings/:id/photos/order`, `GET/DELETE /bulk-listings/:id/photos/:photoId` |
| Products (manager) | `POST /products`, `PATCH /products/:sku` (rename, reprice, `active: true` to put back on sale; the variety is fixed once a batch holds it), `DELETE /products/:sku` (deletes a never-used product, otherwise takes it off sale and keeps it for history). Starter products are seeded only into an empty database. |
| Batches | `GET/POST /batches`, `GET /batches/:id`, `PATCH /batches/:id/status`, `POST /batches/:id/qc`, `PATCH /batches/:id/lines/:lineId`, `GET /batches/:id/ledger` |
| Orders | `GET /orders` (`?status&from&to&q&atRisk&page`), `GET /orders/:id`, `PATCH /orders/:id/status`, `POST /orders/:id/allocate`, `/cancel`, `/rebalance`, `/reschedule` |
| Fulfilment | `GET /pack-list?date=`, `GET /manifest?date=` |
| Season ops | `POST /orders/bulk-reschedule` (managers), `GET /analytics?from&to` |
| Staff | `GET/POST /staff`, `PATCH/DELETE /staff/:id`, `GET /audit?staff&target&from&to&page` (all managers only) |
| Operations | `GET /attention` (loop heartbeat, failing steps, failed messages, stuck refunds, rejected webhooks), `POST /notifications/:id/retry` |
| Claims | `GET /claims`, `POST /claims/:id/review`, `POST /claims/:id/resolve` |
| Pincodes | `GET/POST /pincodes`, `PATCH/DELETE /pincodes/:pincode` |
| Rules | `GET/PUT /config`, `GET/PUT/DELETE /calendar/:date`, `GET /coverage` (sellable boxes per SKU and stage, and boxes booked per slot, for each bookable date) |
| Slots | `GET/POST /slots`, `PATCH /slots/:id` (managers only for changes) |
| Preorders | `GET /preorders?status&week`, `GET /preorder-weeks`, `PUT /preorder-weeks/:weekStart` (managers: a week's expected kg), `POST /preorders/:id/move` (managers), `POST /preorders/:id/cancel` (managers), `GET /preorder-capacity`, `PUT /preorder-capacity/:weekStart/:sku` (managers; decides nothing since 074) |
| Customer auth | `POST /v1/auth/otp/request`, `/otp/verify`, `/token/refresh`, `/logout` |
| Storefront | `GET /v1/delivery/check?pincode=`, `GET /v1/delivery/slots?pincode=&delivery_date=`, `GET /v1/catalogue?pincode=&delivery_date=`, `GET/POST /v1/cart`, `DELETE /v1/cart/items/:sku` |
| Customer bulk deals | `GET /v1/bulk-deals?pincode&page`, `GET /v1/bulk-deals/:id?pincode` (stock per open day and ripeness), `GET /v1/bulk-deals/:id/price?qty=`, `GET /v1/bulk-deals/:id/photos/:photoId` (public); `POST /v1/cart/bulk`, `DELETE /v1/cart/bulk/:listingId?stage=` (signed in) |
| Checkout | `POST /v1/checkout/quote`, `POST /v1/checkout/confirm` (requires `Idempotency-Key`) |
| Customer preorders | `GET /v1/preorders/weeks?sku=`, `POST /v1/preorders` (requires `Idempotency-Key`), `GET /v1/preorders`, `GET /v1/preorders/:id`, `POST /v1/preorders/:id/cancel`, `POST /v1/preorders/groups` (MULTI_GIFT; requires `Idempotency-Key`), `GET /v1/preorders/groups/:id`, `POST /v1/preorders/groups/:id/preorders/:preorderId/send-link` (GIFT_ADDRESS_LINKS); public `GET`/`POST /v1/gift-address/:token` |
| Orders and claims | `GET /v1/orders`, `GET /v1/orders/:id`, `/payment-status` (asks Razorpay when an order is still unpaid a minute after checkout, at most every 30 s), `POST /v1/orders/:id/verify-payment` (Checkout's `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature`: the signature is checked with the key secret, then the payment is fetched from Razorpay and applied), `POST /v1/orders/:id/cancel`, `POST /v1/orders/:id/reschedule` (confirmed orders, before packing), `PUT /v1/orders/:id/rating` (delivered orders), `GET/POST /v1/claims` |
| Saved addresses | `GET /v1/me/addresses`, `DELETE /v1/me/addresses/:id` (an order saves its address; at most five, gifts are not saved) |
| Ordered before | `GET /v1/me/ordered-products` → `[{ variety, sku, stage, times, lastDeliveredOn }]`: per variety, the signed-in customer's DELIVERED orders (an order made from a pre-order counts once delivered; placed, cancelled or failed ones do not), the last one's box and ripeness, and its day (IST). The shop's "Ordered before" tag and the card's "Order again" |
| Payment failed | Unpaid orders, pre-orders, gift pre-order groups and gift orders say `paymentFailed` (the last payment attempt failed, migration 086 `payment_failed_at`; it can still be paid on the same order until its hold ends: the shop's "Try payment again") and `paymentClosed` (closed unpaid by us when the hold ran out or the payment failed, not cancelled by the customer or the shop: the shop offers Order again) in `GET /v1/orders`, `/orders/:id`, `/preorders`, `/preorders/:id`, `/preorders/groups/:id`, `/gifts` and `/gifts/:id` |
| Payments | `POST /webhooks/razorpay` (HMAC-SHA256 over the raw body, deduplicated; `payment.authorized`, `payment.captured`, `payment.failed`, `payment_link.paid`, `refund.processed`, `refund.failed`, `payment.dispute.*` recorded for Needs attention; `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` is also accepted while set) |
| WhatsApp | `GET /webhooks/whatsapp` (Meta's verify handshake), `POST /webhooks/whatsapp` (signed messages and payment updates) |
| Dev only | `POST /v1/dev/pay`, `/v1/dev/mark-paid-at-gateway`, `/v1/dev/reconcile` (mounted only with `ENABLE_DEV_ROUTES=true`, outside production, with no Razorpay keys set) |

The staff routes live in one file per area under [`src/admin/`](src/admin): `auth.js` (sign-in,
`/auth/me`, `/me/*`), `reports.js` (summary, analytics, attention, audit), `products.js`,
`batches.js`, `bulk.js` (Bulk Deals), `orders.js` (with the pack list), `deliveries.js` (manifest, dispatch, riders, proof
of delivery), `promos.js`, `staff.js`, `claims.js`, `planning.js` (pincodes, rules, calendar,
slots, coverage) and `preorders.js`, with helpers more than one area uses in `shared.js`.
[`src/admin.js`](src/admin.js) only builds `/admin/v1`: the sign-in routes, then the gate
(`requireAdmin`, two-step setup, `limitByRole`, `riderScope`, the audit), then each area's
router. Manager-only routes carry `requireManager` on the route itself, which is where the role
matrix test looks for it; a new area router must be mounted after the gate.

Errors are `{ error: { code, message, requestId } }`. Admin routes are the contract in
the panel's `src/types.ts`; extra fields (`atRisk`, `atRiskReason`, `replacementFor`,
`eatBy`, `replacementOrder`, `slot`, `notifications`) are additive.

Cart lines carry a stage (`{ sku, stage, qty }`), unlike the technical plan's
`{ sku, qty }`. The same box can sell as raw on one date and ripe on another, so the
customer picks the stage.

## Background work

Every 60 seconds, on exactly one instance (a lease row in `job_leases`, so no
connection is held open for the run): reconcile pending payments with Razorpay, cancel
unpaid orders whose hold expired, send due refunds (and refunds of double charges) and
WhatsApp updates, prune expired OTPs, quotes, idempotency keys, webhooks, sessions and
rate-limit counters, and retire batches at age 8. A run has a 45-second budget (Vercel
stops functions at 60): each loop checks the time before a slow call and leaves the
rest for the next minute, and the full order re-check saves where it stopped. Each run
checks in with Sentry's cron monitor, which alerts when a minute is missed. Steps that
call Razorpay or WhatsApp each get a slice of the run (8–10 seconds), so a slow outside
service can't starve the rest, and the cheap database steps (hold sweep, batch
retirement, audit) run first. Hourly it rebalances only the open orders that are at
risk and runs the ledger audit, which checks `on_hand` against the ledger and
`held`/`committed` against the order allocations; once a day (or right after a rules
change) it rebalances every open order. Drift is logged and exported as
`mango_ledger_drift_lines`. With `WAREHOUSE_V2` on, the same hourly audit runs the box
check for each active warehouse (labelled boxes against `on_hand` and the packed units);
a mismatch alerts at most hourly and shows on Needs attention.

Transactions that hit a deadlock or serialization failure are retried twice with
jitter (`tx` in `src/db.js`), and slot capacity is locked per delivery date, so
checkouts for different days don't queue behind each other. A request that can't get
a database connection within 5 seconds answers `503 BUSY` with `Retry-After`.

Sign-in rate limits (login codes, staff passwords) are counted in Postgres so every
instance shares them. One address may ask for 5 codes an hour and 10 a day for a number
(so someone else asking for your number can't use up your allowance), a number gets at
most 16 codes a day from all addresses, and each code allows 3 tries (at most 48 guesses a
day at one number). A refused request never replaces the code already sent. Token refresh
has its own limit, counted per person rather than per address, so customers sharing a
carrier-NAT address don't sign each other out. A sign-in lasts at most 7 days for staff and
90 days for customers, however often it is refreshed (`STAFF_SESSION_MAX_DAYS`,
`CUSTOMER_SESSION_MAX_DAYS`). Checkout quotes, confirms and cancels are limited per signed-in
customer (`CUSTOMER_ACTION_LIMIT`, 20 a minute each). The shop has a
daily budget (`OTP_DAILY_LIMIT`, Sentry warns at 80%) after which codes pause until
midnight IST. Numbers with no account may use only `OTP_NEW_NUMBER_SHARE` of it (60%),
so a bot flooding new numbers can't lock existing customers out. With
`TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` set, the shop must also pass a Cloudflare
Turnstile check before a code is sent. Session refresh and logout refuse requests from
other sites' origins.

Checkout and booking need an `Idempotency-Key`, scoped to the customer. A retry with the
same key and the same body gets the first answer back; the same key with a different
body is refused with `422 IDEMPOTENCY_KEY_REUSED`.

Every job is also safe if two instances ever run the loop at once. Each WhatsApp message is
claimed with `FOR UPDATE SKIP LOCKED` before it is sent, each refund is claimed with a
two-minute lease before Razorpay is called (and Razorpay gets an idempotency key), and each
Razorpay webhook event id is stored in the same transaction as its effect, so a repeat is
ignored and an out-of-order `payment.failed` never undoes a capture.

## Security and privacy notes

- **Riders' stops.** Each order can be given to a rider (`orders.rider_id`). Managers and
  operators do it on the Deliveries page, per stop or per slot (`POST /admin/v1/manifest/assign`
  `{date, riderId, orderIds?, slotId?}`; `GET /admin/v1/riders` lists riders), or when starting a
  run (`riderId` on `/manifest/dispatch`). A rider who sends out a packed stop nobody has takes
  it. Riders see only their own stops (plus how many packed ones nobody has), another rider's
  stop answers 404, and delivered stops from before today drop out of their view. Removing a
  rider puts their stops back in the pool.
- **No caching.** Every signed-in answer and every sign-in answer carries
  `Cache-Control: no-store`; photos keep their own `private` caching.
- **Sign out everywhere.** `POST /v1/me/sign-out-everywhere` (the shop's Account page) ends
  every refresh session and raises the account's `session_version`, so access tokens already
  issued stop working (at once on this instance, within 30 seconds on others).
- **Login codes.** Codes are stored as a SHA-256 of the code with a pepper: `OTP_PEPPER`, or
  `JWT_SECRET` when that is unset. Setting `OTP_PEPPER` later keeps codes already sent working
  for their five minutes. Outside production the code also comes back as `devCode` unless
  `OTP_CODE_IN_RESPONSE=false` (the local launcher's `--phone` mode sets it).
- **Turnstile.** A token counts only when Cloudflare says it passed, on one of the
  `CUSTOMER_ORIGIN` host names, for the action `otp` (the shop's widget sets it).
- **Degraded-mode answers (a known trade-off).** While the day's share of codes for new
  numbers is used up (`OTP_PAUSED`), or Cloudflare cannot be reached (`CAPTCHA_UNAVAILABLE`),
  numbers with an account still get a code and new numbers get a 503. Someone watching the
  answers during such a window can tell whether a number has an account. Answering everyone
  alike would mean either locking existing customers out during an SMS-pumping attack or a
  Cloudflare outage, or telling a new customer a code was sent when it was not. We keep
  existing customers signed in and accept the narrow oracle; it lasts only while the shop is
  under attack or Cloudflare is down, and Sentry is told when the budget runs out.
- **Logs.** Phone numbers are logged only masked (`maskPhone` in `src/logger.js`, e.g.
  `+9198*****`); phones and addresses inside logged objects are redacted, and
  `test/log-safety.test.js` fails on a logger call that passes a raw phone.
- **Photos.** Claim and delivery photos are re-encoded on upload (like review photos), so the
  phone's EXIF data (GPS, device) is not kept.
- **Constant-time checks** for the cron secret, `METRICS_TOKEN` and the WhatsApp verify token.

## Staff roles and the audit trail

Five roles: `MANAGER`, `OPERATOR`, `PACKER`, `QC` and `RIDER`. Riders only reach
their own stops (see "Riders' stops" below) on yesterday's, today's or tomorrow's run that
are packed or on the road; any other order id answers 404. With `STAFF_TWO_STEP=all` (the production default) every
staff account must use two-step sign-in; `managers` limits it to managers and operators.
Where it is required, setting it up needs a one-time setup code from a manager as well as
the password (shown once when a manager adds someone, resets their two-step sign-in, or
presses "Setup code" on the Staff page; it lasts 7 days). The first manager to set it up
needs none. Ten wrong passwords for one account in 15 minutes pause password sign-in for
that account until the 15 minutes are up (unknown emails are counted the same way);
Google sign-in still works, and a manager setting a new password lifts the pause. Managers and operators reach every
route except the manager-only ones. Every role but managers, operators included, gets an
allowlist in [`src/access.js`](src/access.js) and is refused everything else, so a new
route stays closed to them until it is added there; a test fails until each route is
either on the operator list or manager-only. Packers may only move orders through
`PROCESSING`, `PACKED`, `SHIPPED`, `OUT_FOR_DELIVERY`, `DELIVERED` and `DELIVERY_FAILED`.

Managers add, change and remove staff through `/staff`. A role change, password change,
two-step reset or removal ends that person's sessions, and their access tokens stop working
at once: every staff request checks the token's role and session version against the staff
row (cached for 5 seconds per instance). In production the first manager comes from `ADMIN_BOOTSTRAP_EMAIL` /
`ADMIN_BOOTSTRAP_PASSWORD`; on Vercel previews from `PREVIEW_ADMIN_EMAIL` /
`PREVIEW_ADMIN_PASSWORD` instead, so the production login never reaches a preview.

Staff passwords are at least 12 characters and may not be on the bundled list of common
passwords ([`src/data/common-passwords.txt`](src/data/common-passwords.txt), from SecLists,
checked ignoring case). Anyone can change their own password on the panel's Two-step sign-in
page (`POST /admin/v1/me/password` with the current one); their other sessions end. With
`STAFF_GOOGLE_HD` set (say `mandimangoes.in`), staff Google sign-in only accepts accounts of
that Google Workspace domain.

Who may call which staff route is snapshotted in
[`test/fixtures/role-policy.json`](test/fixtures/role-policy.json), one route per line, and
the role matrix test checks the code against it. A change to `src/access.js` or a new route
fails that test until the snapshot is regenerated (`UPDATE_ROLE_POLICY=1 npm test`) and the
diff is reviewed with the change.

Every successful staff change (any non-GET admin request) and every sign-in is written to
`staff_audit`: who, their role, the route, what it was done to, and the request body with
passwords and tokens removed. Read it at `GET /admin/v1/audit` or on the panel's Staff
screen. The table is append-only (migration 046): rows are never edited or deleted, except
that the privacy scrub removes personal keys. Refunds, prices, promo codes, the shop rules
and batch costs ask the manager to confirm it is them. The whole picture is in
[docs/authorization.md](../docs/authorization.md), and every route with its roles is in the
generated [docs/authorization-matrix.md](../docs/authorization-matrix.md).

## Operations

- **Needs attention.** The Today screen shows a card only when something is wrong: the loop
  has not run for 5 minutes, a loop step keeps failing, a WhatsApp message failed (with a
  Send again button), a refund has been stuck for 30 minutes, or a webhook was rejected.
  It reads `GET /admin/v1/attention`. Each loop step's last success and error are kept in
  `maintenance_runs`; rejected webhooks are kept in `webhook_failures` for 30 days.
- **Alerts** ([docs/alerts.md](../docs/alerts.md) has every alert, what checks it and who
  is told). On Vercel the maintenance job is the alert checker: every minute it reads
  shared state from Postgres and sends a Sentry warning (at most hourly each) for overdue
  messages or refunds, failing webhooks, steps failing 3 times in a row, a missed backup,
  ledger drift, and, from the per-minute `ops_counters` table (migration 050,
  `src/ops-counters.js`), API errors, slow answers and a busy database pool. Sentry's alert
  rule and its cron monitor `maintenance`, and Better Stack Uptime on `/ready` (phone call
  and SMS), tell the on-call people
  ([deploy/VERCEL.md, Watch it](../deploy/VERCEL.md#8-watch-it)). `OPS_ALERTS` turns the
  newer checks on; unset, it is on in production and off elsewhere. `SLOW_REQUEST_MS` and
  `ALERT_API_ERRORS`, `ALERT_SLOW_REQUESTS`, `ALERT_DB_BUSY` set the thresholds.
  **Docker path only:** [`ops/alerts.yml`](ops/alerts.yml) holds Prometheus alert rules for
  the loop stopping, failing steps, failing WhatsApp sends, webhook errors, login codes on
  fallback, ledger drift, API errors and slowness, and the database pool. Scrape `/metrics`
  with `METRICS_TOKEN` as a bearer token and route the alerts to the phone of whoever is on
  call. `/metrics` answers 404 on Vercel, so neither the metrics nor these rules apply
  there; [`src/alert-checks.js`](src/alert-checks.js) names the Vercel check for each rule,
  and a test fails when a rule has none.
- **Backups.** [`ops/backup.sh`](ops/backup.sh) writes a `pg_dump` custom-format file,
  encrypted to a GPG public key (`BACKUP_GPG_PUBLIC_KEY_FILE` or `BACKUP_GPG_RECIPIENT`;
  with neither it refuses), and keeps 14 days (`RETAIN_DAYS`). `BACKUP_UPLOAD_CMD` copies
  it off the host in the same run, and `BACKUP_HEARTBEAT=true` records each outcome as the
  step `backup` in `maintenance_runs`. With `BACKUP_HEARTBEAT_EXPECTED=true` on the API
  (the Docker deploy sets both), Needs attention and the health check warn when no backup
  has succeeded for 26 hours.
  [`ops/restore-check.sh`](ops/restore-check.sh) restores a dump into a scratch database,
  prints the migrations and row counts, checks the stock ledger balances, then drops it.
  Run it weekly and after each schema change; a backup nobody has restored is a guess.
  The nightly GitHub workflow [`backup.yml`](../.github/workflows/backup.yml) runs it for Neon.
  That workflow fails (red, with an email) when its secrets are missing; a copy with no
  production database sets the repository variable `BACKUP_DISABLED=true` instead. Its
  last step records the heartbeat with [`ops/backup-heartbeat.sh`](ops/backup-heartbeat.sh)
  over `BACKUP_HEARTBEAT_DATABASE_URL`, a role that may write only that record (grants in
  the script and in [deploy/VERCEL.md](../deploy/VERCEL.md#backups-and-restore-drill));
  with `BACKUP_HEARTBEAT_EXPECTED=true` on Vercel a missed backup warns as on Docker.
- **Ready.** `GET /ready` answers 503 when the database doesn't answer, when the last
  maintenance run finished over 5 minutes ago, and, in production, when no run has ever
  finished (the cron is missing or its secret is wrong). Previews and development may have
  no run yet.
- **Retention.** Sent, failed and skipped WhatsApp messages are deleted after 180 days
  ([`src/retention.js`](src/retention.js)), up to 5,000 a run. Once a day, orders delivered,
  cancelled or returned more than `PII_RETENTION_MONTHS` (default 12) months ago lose the
  customer's name, phone, address and gift details, and their delivery attempts lose who took
  the box and the rider's location; amounts, items, tax fields, payment and refund ids stay
  for the books. Orders with money still owed back wait until it is paid. The same run deletes
  those orders' photos: the rider's delivery photos, and the photos on their problem reports
  once the report is resolved (from Vercel Blob and from the row). The shop's privacy notice
  states the 12 months: change it there too if you change `PII_RETENTION_MONTHS`.
- **Bills are kept longer.** Neither that run nor account deletion touches bills: tax law
  needs them kept as issued. A bill keeps the buyer's name and delivery address for
  `BILL_RETENTION_MONTHS` (default 96, 8 years from the bill date); then the same daily run
  removes them, up to 5,000 bills a day. Resolved Razorpay webhook problems are kept as long.
  Production refuses a value under 72 and warns under 96. **The client's CA must confirm the
  period** ([docs/trust.md](../docs/trust.md#how-long-bills-are-kept) has the law and a table
  of what every cleanup removes). The privacy notice and the account page say 8 years: change
  them too if you change it.
- **Erasure and export.** Customers delete their account in the shop (`DELETE /v1/me`) and
  download what we hold about them (`GET /v1/me/export`, JSON). For a deletion request that
  arrives by email or WhatsApp, check it comes from the number's owner, then run
  `node --env-file=.env ops/erase-customer.js --phone <number>` (it shows the account), and
  again with `--yes` to delete it. It refuses while an order is open, like the app. Keep the
  printed id with the request: `ops/reapply-deletions.js --ids <id>` repeats it after a restore.
- **Connections.** `DB_POOL_MAX` sets each instance's pool (default 5 on Vercel, 10
  elsewhere) and `DB_CONNECT_TIMEOUT_MS` how long a request waits for a connection before
  answering 503 BUSY (default 5000). On Vercel, keep instances × `DB_POOL_MAX` under the
  Neon pooler's limit. Each BUSY answer counts in `mango_db_pool_busy_total`, and a query
  slower than `DB_SLOW_QUERY_MS` (default 500; 0 turns it off) is logged as `slow query`
  with its time and the start of its SQL, never its values.

### Writing a migration

Migrations run while the previous version is still serving (see
`test/migrations.test.js`), each in one transaction, with `lock_timeout` 5 s
(`MIGRATION_LOCK_TIMEOUT`). A migration that can't get its table lock in that time is
rolled back and tried again twice, 3 s apart; then the build fails and nothing is
half-applied. Look for a long transaction in `pg_stat_activity` and deploy again.
Keep the locks short:

- **Add, then remove a release later.** Drops, renames and narrowing need a
  `-- contract:` line. From file 048 on that includes dropping a constraint, index,
  function, trigger, type or view, unless the same file makes it again under the
  same name (widening a CHECK, below).
- **No `BEGIN`, `COMMIT` or `CONCURRENTLY` in a file.** Each file already runs in one
  transaction; the test refuses a file that ends it early.
- **Never edit a file that has run.** Each applied file's sha256 is kept in
  `schema_migrations.checksum` (048), and the runner refuses to start when an applied
  file has changed, naming it. Make the change in a new file. For a harmless edit
  (a comment), clear the record as the error says: the next run records the file again.
- **New CHECK or FOREIGN KEY on an existing table: `NOT VALID`.** A plain
  `ADD CONSTRAINT` reads the whole table while nothing else can touch it. Add it
  `NOT VALID` (new rows are checked from then on) and
  `ALTER TABLE ... VALIDATE CONSTRAINT ...` in the next migration file, which reads the
  table without blocking writes. To change a CHECK (a new notification kind):
  ```sql
  ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
  ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (...)) NOT VALID;
  -- next file: ALTER TABLE notifications VALIDATE CONSTRAINT notifications_kind_check;
  ```
- **Indexes on existing tables block writes while they build.** `CONCURRENTLY` can't run
  inside the migration transaction, so on a big table build it by hand first
  (`CREATE INDEX CONCURRENTLY IF NOT EXISTS ...`) and keep the same `IF NOT EXISTS`
  statement in the migration.
- When a lock is fine (the table is new or small), say why on a `-- locks:` line. The
  migration test fails without one, from file 021 on.
- **After a restore.** A restored database has lost the orders, payments and account
  deletions made since the restore point, while Razorpay still holds the money.
  [`ops/replay-payments.js`](ops/replay-payments.js) `--from <restore point>` applies the
  captured payments as the webhook would and lists payments whose order is gone
  (`--refund-missing` refunds those). [`ops/reapply-deletions.js`](ops/reapply-deletions.js)
  deletes again the accounts deleted since then, from the pre-restore branch (`--old-url`,
  `--since`) or a list of ids (`--ids`). Prefer fixing data forward; restore only when it
  can't be repaired.

## Tests

```bash
npm test   # needs a Postgres database named *_test; default postgres://mango:mango@localhost:5432/mango_test
TEST_DATABASE_URL=postgres://user:pass@host:5432/mango_test npm test
```

The suite drops and recreates the schema of that database, and refuses to run against
one whose name doesn't end in `_test`. It covers the stage engine, staff and customer
auth (refresh rotation and reuse detection, OTP lockout), the full order flow through
claim and replacement, hold expiry and late payments, condemn and rebalance, failed
delivery retries, retirement and the ledger audit, customer cancels and refunds, delivery
slots and WhatsApp updates, preorders, WhatsApp chat ordering, bulk reschedule, the rider
manifest and analytics, double-send and double-refund guards, staff roles and the audit trail, the login code fallback and
the Needs attention view, plus a race of 30 buyers for 10 boxes.

## Not in phase 1

Redis, S3 photo storage and rider
proof of delivery. Dry fruit is out of scope.
