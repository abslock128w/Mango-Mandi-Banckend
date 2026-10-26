# Bulk and corporate gifting (roadmap C9)

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

Both are in `mango-api/.env.example`.

The shop and panel read the switch from the API, so there is no front-end build
flag:

- **Shop:** `GET /v1/policy`:
  - `features.multiGift`
  - `multiGiftMaxRecipients`, sent only while the switch is on
- **Panel:** `GET /admin/v1/auth/me` → `features.multiGift`

The local launcher (`scripts/start-local.mjs`) turns `MULTI_GIFT` on for the
demo.

Migration: `mango-api/migrations/043_gifting.sql`.

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

The owner's rule holds: a refund only when the customer cancels before packing.

- **Unpaid:** the buyer can cancel the whole gift order. Nothing is charged, and the boxes go back on sale.
- **Paid, whole order:** the buyer can cancel the whole gift order while no delivery is packed. Each delivery is refunded its own amount.
  - If any delivery is packed, the whole cancel is refused with `409 NOT_CANCELLABLE`, which lists the packed deliveries, and nothing changes.
- **Paid, one recipient:** the buyer can cancel one recipient before their boxes are packed (`CONFIRMED` or `PROCESSING`). That delivery is refunded its own amount, and the others go ahead.
- **After packing:** nothing is refunded. Claims stay replacement or reject.
- **Managers:** they can still cancel an undeliverable delivery from its order page, as for any order.

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

- **Start:** the gift part of checkout links to **Send to many** (`/gifts/new`).
- **Editor:** one card per recipient, laid out for phones. It has:
  - "Download the template" and "Upload a CSV"
  - one day and time for everyone
  - the sender's name
  - optional business details for the one bill
  - a promo code
- **Review:** "Review N recipients" opens a review of every recipient and the total, then **Pay**.
- **Gift order page (`/gifts/:id`):**
  - the payment state and each recipient's delivery with its status
  - cancel for one recipient or for the whole order, while allowed
  - the bill
- **Orders page:** lists gift orders, and marks each delivery "gift for <name>".

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
  - whole and partial cancel with refunds only before packing (Razorpay stubbed)
  - cross-customer 404s
  - staff roles
  - the CSV template's formula guard
- **Isolation:** `mango-api/test/security-readiness.test.js` lists the gift routes among the customer routes checked for cross-customer access.
- **Shop:**
  - `customer-app/tests/unit/gift-csv.unit.ts` tests the CSV reader.
  - `customer-app/tests/gifting.spec.ts` is end to end against the real API, the shop and the panel.
- **Panel:** `tests/gifting.spec.ts`, against the mock API.

## Limits and owner actions

- **Partial cancel and the bill:** a partly cancelled gift order keeps its one bill as issued. There is no credit note for the cancelled part yet.
  - The refund itself goes through as usual, and the bill is marked cancelled only when every delivery is cancelled.
  - **Owner:** decide whether partial refunds need a credit note, and its format, with the accountant.
- **Buyer messages:** the buyer gets the existing order-confirmed message for each delivery, not one message for the whole gift order.
  - **Owner:** if one summary message is wanted, approve a WhatsApp template for it, so it can be added.
- **One day per order:** all recipients get the same day and slot. Different days need separate gift orders.
- **Turning it on:** set `MULTI_GIFT=true` (and optionally `MULTI_GIFT_MAX_RECIPIENTS`) on the API, and run migration 043.
