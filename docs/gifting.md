# Bulk and corporate gifting (roadmap C9)

> **Note (4 Nov 2026):** the Next.js shop in `customer-app/` was retired in favour of the static shop in [`shop/`](../shop/README.md). The shop-side parts below that name `customer-app/` describe that previous implementation.

A buyer, often a business at festival time, sends MandiMangoes boxes to many
people in one order. They pay once and get one bill. Each recipient gets their
own delivery.

The whole feature sits behind one switch, **off by default**. With it off, the
gift-order routes answer 404, the shop and panel look as they did before, and
nothing new is written to the database.

## Switches and environment (mango-api)

| Variable | Default | What it does |
| --- | --- | --- |
| `MULTI_GIFT` | `false` | Turns on gift orders to many recipients: "Send to many" in the shop, Gift orders on the panel's Orders page, the API routes below |
| `MULTI_GIFT_MAX_RECIPIENTS` | `25` | The most recipients one gift order can have (1 to 100) |
| `GIFT_ADDRESS_LINKS` | off | With `MULTI_GIFT`: before the season, the giver may choose "Ask them on WhatsApp" for a person's address (below, "Asking the recipient for their address"). Empty lets a manager turn it on from the panel; `false` is a kill switch |

All three are in `mango-api/.env.example`.

The shop and panel read the switch from the API, so there is no front-end build
flag:

- **Shop:** `GET /v1/policy`:
  - `features.multiGift`
  - `multiGiftMaxRecipients`, sent only while the switch is on
- **Panel:** `GET /admin/v1/auth/me` → `features.multiGift`

The local launcher (`scripts/start-local.mjs`) turns `MULTI_GIFT` on for the
demo.

Migration: `mango-api/migrations/042_gifting.sql`.

## One person, many boxes (change request 02, 25 Nov 2026)

The shop now sends a gift to **one person**, with as many mangoes as they like (CR2-06, CR2-07). A gift order for several
people (below) still works on the API and still opens in the shop and the panel, but the shop never makes one.

- **Any box the shop sells** can be in a gift: every variety in `GET /v1/products` (16 today: 15 single varieties and
  Mixed Variety Mangoes), in any size and ripeness, so a new variety is giftable as soon as it is on sale. The same
  variety in two sizes or ripenesses is two box lines.
- **At most 20 boxes** in one gift (Q2): `GIFT_MAX_BOXES` in `mango-api/src/preorders.js`, `perRecipientMax()` in
  `gifts.js` (also capped by `maxHeldBoxes`), and `GET /v1/policy` → `giftMaxBoxes` for the shop.
- **One delivery.** In season the recipient is one delivery order with a line per box (`POST /v1/gifts/quote` takes
  `recipients[].lines: [{ sku, stage, qty }]`; the old `sku, stage, qty` still works). Only days with every box in stock
  are offered. Before the season `POST /v1/preorders/groups` takes `oneDelivery: true`: each entry is one box line for the
  same person and address (`400 RECIPIENTS_INVALID` otherwise; a box and ripeness twice is refused; more than 20 boxes is
  `400 GIFT_TOO_MANY_BOXES` with `maxBoxes`). Every line is booked in the **same week**: the earliest week in which every
  line has room together, which is the week of the box that is ready last (`togetherWeek`). The shop sends the week it
  showed (`weekStart`); a week that changed answers `409 PREORDER_FULL` / `PREORDER_WEEK_CHANGED` with the new
  `weekStart`, and nothing is booked. The group is stored with `preorder_groups.one_delivery` (migration 098),
  `recipient_count` 1, and the season's allocator turns its booked lines of a week into **one** delivery order (a line per
  box, the first line's number, the payment amounts added up). One payment link for the whole gift, as before.
- **Asking for the address** (`GIFT_ADDRESS_LINKS`) on a one-person gift: one link, on the first line; the address the
  recipient gives is copied to every line.
- **Landmark** (CR2-07, Q3: optional, up to 100 characters), stored apart from the address: `orders.delivery_landmark`
  and `preorders.delivery_landmark` (migration 098). Taken by `POST /v1/gifts/quote` (`recipients[].landmark`),
  `POST /v1/preorders/groups` (`recipients[].landmark`) and the recipient's address page (`POST /v1/gift-address/:token`,
  `landmark`). Shown in `GET /v1/gifts/:id` (`recipients[].landmark`), `GET /v1/orders/:id` and
  `GET /admin/v1/orders/:id` (`deliveryLandmark`), the panel's gift orders list (`children[].landmark`), the delivery run
  (`GET /admin/v1/manifest`, `deliveryLandmark`: the panel's Deliveries page, its printed run and the rider app's stop),
  and pre-orders (`landmark`). Erased with the address (account deletion, PII retention), and redacted from the logs.
  Packers do not see it (as the address).
- **City from the pincode:** `GET /v1/delivery/check` → `city` (the served pincode's city), shown read-only on the form.
- **WhatsApp:** the approved confirmation templates (`ORDER_CONFIRMED`, `PREORDER_BOOKED`) have no address variable,
  so the landmark is not in them. Adding it needs a new template version approved by Meta (**owner action**).

## How it works

### The data

- **Parent:** one `gift_orders` row per gift order, numbered `GFT-1001` onward. It holds:
  - the buyer
  - the shared delivery date and slot
  - the totals and the promo code
  - the business name and GSTIN, if given
  - the one Razorpay order and the one payment
- **Children:** each recipient is an ordinary `orders` row with `gift_order_id` and `gift_position` set.
  - The recipient's name, phone and note go in the order's existing gift fields.
  - The child is made at checkout as `PAYMENT_PENDING`.
- **Shared:** from then on, a child is packed, sent, delivered, claimed and cancelled like any other order, under the existing roles and permissions.

### Recipients

- **Count:** 1 to `MULTI_GIFT_MAX_RECIPIENTS` recipients. Each one has:
  - a name
  - a 10-digit Indian mobile number
  - an address
  - a pincode
  - a box, its ripeness and a count
  - an optional note of up to 200 characters
- **Pincode:** must be one we serve.
- **Box count:** a recipient can get up to the cart's per-line limit (20), and never more than one buyer may hold (`maxHeldBoxes`).
- **Whole order:** all recipients together must stay within the hold limit, and within stock for the day.
- **Ripeness:** has no effect on price, as everywhere else.
- **Delivery:** everyone shares one delivery date and slot. The existing rules for open dates, cut-off and slot capacity apply.
- **CSV:** recipients are added one by one, or from a CSV.
  - The template comes from `GET /v1/gifts/template.csv`, with the columns `name, phone, address, pincode, box, ripeness, boxes, note` and one example row.
  - Every cell is quoted. A cell starting with `= + - @`, a tab or a carriage return gets a leading `'`, so a spreadsheet never runs it as a formula (the same guard as the CSV exports).
  - The shop reads the file in the browser (`customer-app/src/gift-csv.ts`). It takes the `'` guard off, matches a box by code or name, and lists every problem by row before anything is sent.
- **Server check:** the API checks every recipient again at quote and at Pay. It answers `400 RECIPIENTS_INVALID` with `detail.rows: [{ row, field, message }]`, and the shop puts each message on that recipient's field.
  - Other errors: `TOO_MANY_RECIPIENTS` (with `maxRecipients`), `RECIPIENTS_REQUIRED`, `HOLD_LIMIT` and `STOCK_INSUFFICIENT`.
  - At Pay, a pincode that stopped being served in the meantime is refused.

### Checkout and payment

- **Pay:** creates every child in one transaction, each through the existing `createOrder`, so stock is held for all recipients or none.
  - A price that changed since the quote answers `409 PRICE_CHANGED`, and nothing is held.
  - The Pay call takes an `Idempotency-Key`. A retry with the same key returns the same gift order.
- **Unpaid limit:** a gift order counts as one unpaid order.
- **Promo:** a promo applies under the existing rules, to the whole order, and is redeemed once.
  - The discount is split over the deliveries in proportion to their price, in whole paise. The last delivery takes the rounding.
  - Each delivery's own total is what a cancel of that recipient refunds.
- **One payment:** one Razorpay order covers the whole gift order.
  - The webhook, the verify call, the reconcile loop and the test payment all go through `processGiftPayment`, which confirms each delivery exactly once.
  - A replay changes nothing. A second, different payment is recorded as a duplicate and refunded. A short payment is refused.
  - The payment id is kept on the parent only. Refunds for a delivery go against the parent's payment, and each refund counts only its own delivery's amount.
- **Holds:** the hold time is the usual one. If the hold runs out before the payment arrives, every delivery is cancelled and its boxes go back on sale, and the gift order shows as cancelled.
  - A payment that arrives later follows the existing late-payment rules for each delivery, as for any order paid after its hold ran out.
  - A delivery the buyer cancelled before the late payment arrived is refunded.

### After payment

- **Deliveries:** each recipient's delivery goes ahead as its own order. The recipient gets the existing gift message (`GIFT_OUT_FOR_DELIVERY`) on the day.
- **Bill (`BILLS_ENABLED`):** one bill covers the whole gift order.
  - It has one line per box and ripeness across all recipients, and the business name and GSTIN if given.
  - It is stored against the first delivery, with `bills.gift_order_id` set. No delivery gets a bill of its own.
  - The buyer downloads it from the gift order page (`GET /v1/gifts/:id/bill`). Staff download it from the first delivery's order page.
  - It is marked cancelled only when every delivery is cancelled.

### Cancelling

The owner's rule holds: a refund only when the customer cancels a paid order within 4 hours of placing it (`CUSTOMER_CANCEL_HOURS`, the same window as any order) and before packing. After the 4 hours every buyer cancel below is refused with `409 CANCEL_WINDOW_CLOSED`, and the gift view's `cancellable` flags turn false; `cancelUntil` on the gift order says when the window closes (null while unpaid).

- **Unpaid:** the buyer can cancel the whole gift order. Nothing is charged, and the boxes go back on sale.
- **Paid, whole order:** the buyer can cancel the whole gift order within the 4 hours, while no delivery is packed. Each delivery is refunded its own amount.
  - If any delivery is packed, the whole cancel is refused with `409 NOT_CANCELLABLE`, which lists the packed deliveries, and nothing changes.
- **Paid, one recipient:** the buyer can cancel one recipient within the 4 hours, before their boxes are packed (`CONFIRMED` or `PROCESSING`). That delivery is refunded its own amount, and the others go ahead.
- **After packing, or after the 4 hours:** nothing is refunded on the buyer's cancel (a manager can still cancel with a refund). Claims stay replacement or reject.
- **Managers:** they can still cancel an undeliverable delivery from its order page, as for any order.

### Before the season: a gift for several people as pre-orders

A gift for one person and a gift for several people are the same thing with more people (the owner's rule), so both can be pre-ordered before the season (migration 071).

- **Shop:** before the season "Send as a gift" is open (it no longer waits for the season). The buyer adds the people as in season (name, mobile, pincode, address, box, ripeness, boxes, note; the same limits and checks). There is no delivery day or slot: each person's boxes go in the earliest delivery week with room for their kg (every box shares one weekly limit in kg, migrations 074 and 076; one person's boxes are never split), worked out from `GET /v1/preorders/weeks` (`deliveryWeeks`) in list order as the API books them, and shown per person before paying; a group can straddle two weeks. When people get different weeks, or a week is full so a person moves to the next open week, the review says so plainly; when no week has room for someone, Pay is off and says why.
- **Review and pay:** the review states, prominently, that it is a pre-order, the delivery week, that it is paid in full now and can't be cancelled or refunded once paid, with the same tick-box as one gift pre-order, and the one total. Pay books the group and opens the one payment (the payment link; locally the test payment). The done screen lists each person's pre-order; Your orders lists each one with the Pre-order and Gift tags.
- **API:** `POST /v1/preorders/groups` (`Idempotency-Key`) with `{ name?, recipients: [{ sku, stage, qty, weekStart?, pincode, address, gift: { recipientName, recipientPhone, message? } }] }` (`weekStart`: the week the shop showed for that person; the API refuses the group if it changed), and `GET /v1/preorders/groups/:id`. Both answer 404 while `MULTI_GIFT` is off. See mango-api/README.md, Preorders.
- **Data:** one `preorder_groups` row (`PGR-1001` onward: the total, the hold, the one payment link and the payment id), and one ordinary gift pre-order per person with `preorders.group_id` and `group_position`. Every booking carries the group's link.
- **One payment:** paying the link (webhook, reconcile loop, the test payment with any of the bookings) books every booking at once; a replay changes nothing, a second payment is a duplicate and is refunded. Each booking records its own amount; the payment id stays on the group.
- **Holds:** one hold for all. If it runs out, each booking is cancelled and its week's room freed; a payment that lands later still books them all.
- **Rules kept:** an unpaid group is one unpaid booking (`UNPAID_PREORDER_EXISTS`); a person whose shown week changed since, or with no week with room, fails the whole group (`409 PREORDER_FULL` or `PREORDER_WEEK_CHANGED`, "Person N: …") and nothing is booked; groups never join the waitlist. The buyer can cancel before paying, and then the whole group; once paid nothing can be cancelled by the buyer (non-refundable). A manager can still cancel one booking (a week we can't fill), which refunds that booking's own amount from the group's payment.
- **Season:** when the season's allocation runs, each booking becomes its own delivery order carrying its recipient, as for one gift pre-order. In season, "Send as a gift" is the gift order above, unchanged.
- **Panel:** the Preorders page shows each booking with its recipient and a "Part of gift group PGR-… · N people" hint.

### Asking the recipient for their address (GIFT_ADDRESS_LINKS)

The giver often doesn't know the full address, and used to learn only at Pay whether we deliver there. Before the season,
a gift for several people may leave a person's address to them (migrations 091 and 092, `mango-api/src/gift-address.js`).

- **Booking:** a person in `POST /v1/preorders/groups` may have `askAddress: true` and no `pincode` or `address`; the gift's
  name and mobile are then required. The booking is made with `address_state = ADDRESS_PENDING` and no pincode or address.
  Its week is worked out by kg as for any booking (it doesn't depend on the pincode). While either switch is off,
  `askAddress` is refused (`400 ASK_ADDRESS_OFF`). Pre-orders stay paid in full and non-refundable once paid.
- **After payment:** when the group's one payment is captured, each pending booking gets one link (`gift_address_links`)
  and the recipient gets `GIFT_ADDRESS_REQUEST` on WhatsApp, whose "Add my address" button opens
  `<shop>/gift-address/<token>`. A replayed webhook adds nothing (one live link per booking).
- **The token:** an HMAC of the link's random id with a key derived from `JWT_SECRET` (`gift-address-token.js`). Only its
  sha256 is stored, so a copy of the database opens no link, and the same link can be sent again without storing it.
  Request logs write `/v1/gift-address/:token`, never the token. Changing `JWT_SECRET` stops links already sent; the next
  send works again.
- **The recipient's page** (`shop/gift-address.js`, no sign-in): who it is from, the box and its week, the gift note; no
  price and nothing else about the giver. They enter their address and pincode. The pincode is checked as typed and
  again by the API, against the served pincodes as at checkout (`400 NOT_SERVICEABLE`). The address is taken **once**
  (`409 ADDRESS_GIVEN` after), in one transaction with the booking locked, and the booking becomes `ADDRESS_GIVEN`.
- **When it stops working:** at the start of the day before the booking's week (IST), `410 LINK_EXPIRED`; at once when the
  booking is cancelled, `410 GIFT_CANCELLED`; when the giver's account is erased (privacy). A recipient who opens it
  again after giving the address sees "thank you", not an error.
- **The giver:** `GET /v1/preorders/groups/:id` gives each booking `addressState` (null: typed at booking,
  `ADDRESS_PENDING`, `ADDRESS_GIVEN`), `addressLink` (`sentAt`, `sendCount`, `expiresAt`, `canResend`, `resendAfter`) and
  `addressMessage` (the words the recipient gets). An address the recipient gave is not shown back to the giver; only its
  pincode is. The shop shows this on the done screen and on `/gifts/pre/:id` (linked from each booking's sheet,
  "See everyone"), with **Send link** and a preview of the WhatsApp message.
- **Send link:** `POST /v1/preorders/groups/:id/preorders/:preorderId/send-link` sends the same link again: the giver's own
  group only (else 404), once paid (`409 NOT_PAID`), while pending (`409 ADDRESS_GIVEN`, `409 NOT_ASKED`), before it
  expires (`410 LINK_EXPIRED`), at most every 10 minutes (`429 RESEND_TOO_SOON` with `retryAfter`) and 5 times
  (`409 RESEND_LIMIT`).
- **The reminder:** maintenance (step `gift-address-reminders`) finds paid bookings still pending whose week is 5 days away
  or less, and queues `GIFT_ADDRESS_REMINDER` to the recipient once and `GIFT_ADDRESS_MISSING` to the giver once (with a
  link to the gift's page, where Send link is). A message queued before the gift was cancelled, the address given or the
  link expired is skipped, not sent.
- **Season:** the allocator leaves a pending booking `BOOKED` (it keeps its week's kg) and logs it. The first run after the
  address is given turns it into its delivery order, as for any booking.
- **In season:** the gift order (`/v1/gifts/quote`) still needs every address: its delivery day is a day or two away.

## API

Customer routes (signed in, with a phone number; 404 while `MULTI_GIFT` is off):

| Route | What it does |
| --- | --- |
| `GET /v1/gifts/template.csv` | The recipients template |
| `POST /v1/gifts/quote` | Checks every recipient, stock, the day and slot, and the promo. Returns the quote |
| `POST /v1/gifts/confirm` | Pay: creates and holds every delivery, and starts the one payment (`Idempotency-Key`) |
| `GET /v1/gifts` | The buyer's gift orders |
| `GET /v1/gifts/:id` | One gift order with its recipients, what can be cancelled, and the bill |
| `POST /v1/gifts/:id/verify-payment` | The Razorpay checkout's signed result |
| `POST /v1/gifts/:id/cancel` | Cancels the whole gift order |
| `POST /v1/gifts/:id/recipients/:orderId/cancel` | Cancels one recipient |
| `GET /v1/gifts/:id/bill` | The one bill as a PDF |
| `POST /v1/dev/pay-gift` | Test payment (development only, `ENABLE_DEV_ROUTES`) |

- **Ownership:** another customer's gift order answers 404.
- **Order list:** `GET /v1/orders` marks each delivery with `giftOrderId` and `giftRecipient`.

Staff routes (managers and operators, as for the order list; 404 while off):

| Route | What it does |
| --- | --- |
| `GET /admin/v1/gift-orders?q=&page=` | Gift orders with their deliveries. Search by gift order number, delivery number, buyer or recipient name |
| `GET /admin/v1/gift-orders/:id` | One gift order with its payment and bill |

- **Order detail:** `GET /admin/v1/orders/:id` gives a delivery's `giftOrder` (number, position, recipient count).

## Shop

The static shop (`shop/gifts.js`, helpers in `shop/gift-rows.js`, styles in `shop/style.css`) sends a gift in two
screens (change request 02).

- **Screen 1, `/gifts`: "Send a gift of the season" · "Choose the mangoes".**
  - "Pick as many mangoes as you like for one person. You pay once, and everything arrives together." Steps "1 Choose
    the mangoes · 2 Who gets it". Before the season a chip "Pre-order · arrives together week of 1 Mar · Details"
    (Details opens the pre-order pop-up).
  - One card per variety from the live catalogue, Mixed Variety Mangoes first with "Most gifted", then A to Z; a search
    box filters them. Each card: photo, name, shop price, size (3 kg / 5 kg, or "One size"), the ripeness with
    **Change**, and **+ Add to gift**, which becomes a stepper "− 1 in gift +".
  - The sticky bar: "Gift for one person · 3 boxes · 9 kg · ₹5,597 · Arrives together · week of 1 Mar" and
    **Next: who gets it**, off until there is a box. At 20 boxes + is off, with a friendly line.
  - While `MULTI_GIFT` is off a card's button is **Add to bag as a gift** instead (`shop/gift-bag.js`).
- **Screen 2, `/gifts/send`: "Who gets it?".**
  - **Their gift**: one row per box line (photo, name, size · ripeness, − qty +, price; 0 takes it out), **+ Add more
    mangoes** (screen 1, everything kept), the boxes and kg, and "Arrives together · week of 1 Mar" with the rule.
  - **Who gets it**: Name, WhatsApp number (+91), House / flat, street, area, Landmark (optional), Pincode (checked as it
    is typed) and City (from the pincode, read-only). Before the season, when the API offers it, "Ask them on WhatsApp".
  - **With the gift**: the gift note, From, and "The price is hidden".
  - In season: the day (only days with every box) and time, and the optional GST details for the one bill.
  - The sticky bar: the pre-order tick (before the season), "Gift for one person · 3 boxes · 9 kg", "Arrives together ·
    week of 1 Mar" and **Pay ₹5,597**. Pay checks the details, the tick, then sign-in (it comes back to `/gifts/send`),
    then books: before the season `POST /v1/preorders/groups` with `oneDelivery`, in season quote → confirm → Razorpay.
  - The selection and the person are this tab's draft (`sessionStorage` `mm-gift-draft`, version 4); a draft for several
    people from before opens as a gift for its first person.
  - `/gifts/send/review` is kept for old links and opens screen 2.
- **Gift order page (`/gifts/:id`)** and **gift pre-order page (`/gifts/pre/:id`)**: a one-person gift shows the person,
  their address and landmark, and every box; older gifts for several people show each person.
- **The bag** no longer offers "Make this a gift" on a line (Q5): it links to Gifts ("Sending a gift? Gifts →"). A gift
  line already in a bag still shows and checks out, and can be moved back ("This one is for me").

## Panel

- **Orders page:** shows **All orders | Gift orders** while the switch is on.
  - Gift orders lists each gift order with its status, buyer, recipients, boxes, total and business details, and a table of its deliveries. Each delivery links to its order page.
  - In All orders, a delivery is marked "Gift delivery".
- **Order page:** a delivery's page says which gift order it belongs to, and links back.
- **Phones:** only the masked number shows in the panel, as before.

## Tests

- **API:** `mango-api/test/gifting.test.js`. It covers:
  - the switch
  - the recipient limit and row errors
  - served pincodes, including a re-check at Pay
  - per-recipient box limits and the hold limit
  - all-or-nothing holds
  - `PRICE_CHANGED`
  - the promo split
  - idempotent Pay and webhook, duplicate and short payments
  - the recipient's gift message
  - the one bill with GSTIN
  - whole and partial cancel with refunds only before packing (Razorpay stubbed), and only within the 4-hour window
  - cross-customer 404s
  - staff roles
  - the CSV template's formula guard
- **Address links:** `mango-api/test/gift-address.test.js`: a group with one asked and one typed address books and pays;
  the link message is queued once, even when the payment is replayed; the page shows PENDING; an unserved pincode is
  refused and nothing is saved; the address is accepted once (a second try is `409`); an expired link answers `410`;
  the Send link rules; the reminder is queued once, 5 days before the week and not earlier; the allocator skips a
  pending booking and converts it once the address is given; both switches; another customer's group answers 404.
- **Isolation:** `mango-api/test/security-readiness.test.js` lists the gift routes among the customer routes checked for cross-customer access.
- **One person, many boxes:** `mango-api/test/gift-one-person.test.js`: many lines for one recipient in one delivery and
  one payment (in season and before the season, through the allocator), the 20-box cap, the shared week, the landmark in
  the order, the gift view, the panel and the delivery run, and the city from the pincode.
- **Shop:**
  - `tests/unit/gift-rows.unit.ts` tests the shop's gifting helpers (the draft in every shape, the WhatsApp number, the box lines and the cap, the shared week, the booking bodies).
  - `customer-app/tests/unit/gift-csv.unit.ts` tested the CSV reader of the retired Next.js shop.
  - `customer-app/tests/gifting.spec.ts` is end to end against the real API, the shop and the panel.
- **Panel:** `tests/gifting.spec.ts`, against the mock API.

## Limits and owner actions

- **Partial cancel and the bill:** a partly cancelled gift order keeps its one bill as issued. There is no credit note for the cancelled part yet.
  - The refund itself goes through as usual, and the bill is marked cancelled only when every delivery is cancelled.
  - **Owner:** decide whether partial refunds need a credit note, and its format, with the accountant.
- **Buyer messages:** the buyer gets the existing order-confirmed message for each delivery, not one message for the whole gift order.
  - **Owner:** if one summary message is wanted, approve a WhatsApp template for it, so it can be added.
- **One day per order:** all recipients get the same day and slot. Different days need separate gift orders.
- **Address links, owner actions:**
  - **Owner:** get the three WhatsApp templates approved by Meta (`mandi_gift_address_request`,
    `mandi_gift_address_reminder`, `mandi_gift_address_missing`; wording and variables in `docs/whatsapp/TEMPLATES.md`),
    then set `GIFT_ADDRESS_LINKS=true` and run migrations 091 and 092. Until then the shop never offers "Ask them on WhatsApp".
  - A recipient whose address is not in by the day before their week is not delivered that week: their booking stays
    booked, and staff see it in the allocator's log. **Owner:** decide what staff do then (call the giver, move the week).
  - The recipient changes a given address by replying to our WhatsApp message (staff change it); the link takes it once.
- **Turning it on:** set `MULTI_GIFT=true` (and optionally `MULTI_GIFT_MAX_RECIPIENTS`) on the API, and run migration 042.
