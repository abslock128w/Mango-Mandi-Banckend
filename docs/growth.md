# Growth (roadmap: C4, funnel analytics, S7)

Three parts, each behind its own switch, each **off by default**:

- **Refer a friend** (`REFERRALS`): every signed-in customer has a code and an
  invite link. When a new customer pays for their first order, both get a
  one-time thank-you promo code (10% off the next order of boxes by default).
- **Shop funnel** (`FUNNEL_ANALYTICS`): anonymous counts of how many browsers
  visit, look at a box, add to the cart, start checkout and pay. Managers read
  them on the panel's Analytics page.
- **Managers' evening summary** (`MANAGER_DAILY_SUMMARY`): each evening, every
  manager who opted in gets the day's numbers on WhatsApp.

With a switch off, its API routes answer 404 (the public funnel endpoint
answers 204 and stores nothing), its maintenance step does not run, and the
shop and panel look as they did before. Migration `039_growth.sql` is additive
and is safe with every switch off.

## Switches and environment (mango-api)

| Variable | Default | What it does |
| --- | --- | --- |
| `REFERRALS` | `false` | Refer a friend: Account card, checkout entry, `/invite/CODE`, rewards, the panel's Referrals section |
| `REFERRAL_REWARD_KIND` | `PERCENT` | `PERCENT` (a share of the regular boxes) or `FLAT` (a fixed amount) |
| `REFERRAL_REWARD_PERCENT` | `10` | With `PERCENT`: the percent off, 1 to 90 |
| `REFERRAL_REWARD_MAX_RUPEES` | empty | With `PERCENT`: an optional cap in rupees on each code's discount (empty = no cap) |
| `REFERRAL_REWARD_RUPEES` | `100` | With `FLAT`: each thank-you code's value, in rupees |
| `REFERRAL_MIN_ORDER_RUPEES` | `499` | The friend's first order must be at least this (regular boxes, before discount). It is also the thank-you code's minimum order |
| `REFERRAL_MAX_PER_MONTH` | `10` | Most thank-you codes one referrer can earn in an IST calendar month |
| `FUNNEL_ANALYTICS` | `false` | The shop sends its funnel steps; the API counts "paid"; the panel shows the funnel |
| `MANAGER_DAILY_SUMMARY` | `false` | The evening WhatsApp summary, the opt-in on Staff and the preview on Today |
| `MANAGER_SUMMARY_TIME` | `20:00` | When the summary goes, IST, `HH:MM` |
| `MANAGER_SUMMARY_TEMPLATE` | `mandimangoes_daily_summary` | The WhatsApp template name for the summary (no prefix is added) |

The shop reads its switches from `GET /v1/policy` → `features.referrals` and
`features.funnel`; the panel from `GET /admin/v1/auth/me` →
`features.referrals`, `features.funnelAnalytics` and
`features.managerDailySummary`. `scripts/start-local.mjs` turns all three on
for the local demo; messages there go to the log provider.

Rollback: set the switch back to `false`. Nothing else is needed. Rows already
written stay; thank-you codes already issued keep working until they expire.

## Refer a friend

### For the customer

- **Account → Refer a friend** shows the customer's code (8 letters and digits,
  without look-alike characters, made on first view and never changed), the
  invite link `<shop>/invite/CODE` with a Share button (the phone's share
  sheet, or a copy), how many friends are waiting or thanked, and their
  thank-you codes with "ready", "used" or "expired". A customer needs a mobile
  number on the account to get a code.
- **`/invite/CODE`** keeps the code on that device (`localStorage`, key
  `mm.invite`) and explains it. Nothing is sent to the API until the person
  signs in and uses it.
- **Entering a code**: a new customer enters it once, at checkout (the field is
  prefilled from the invite link and sits apart from the promo code) or on the
  Account page. Customers who have ordered before never see the field.

### Rules (all checked by the API, `src/referrals.js`)

Entering a code (`POST /v1/me/referral/apply`) is refused with:

| Code | When |
| --- | --- |
| `REFERRAL_INVALID` (400) | Not a code, or no such code |
| `PHONE_REQUIRED` (409) | The account has no mobile number yet |
| `REFERRAL_SELF` (400) | It is the customer's own code; or the code's owner has the same phone; or the two referred each other; or they share a saved delivery address (compared ignoring case, spaces and punctuation) |
| `REFERRAL_ALREADY_USED` (409) | The customer has already entered a code. One per customer, ever (`referrals.friend_id` is unique) |
| `REFERRAL_NOT_NEW` (409) | The customer has a paid order or booking already |

Settling (the maintenance loop's `referrals` step, every minute):

- The friend's **first paid order** decides the referral. As soon as it is
  **paid**, the referral is rewarded (no wait for delivery). If it is
  cancelled or refunded before that, the referral ends without a reward
  (`VOID`), and a later order does not revive it.
- **Cancelled after the reward**: if that first order is later cancelled,
  refunded or has a refund requested, the referral turns `VOID`
  (`ORDER_CANCELLED_AFTER_REWARD`) and both thank-you codes that have not been
  used yet are withdrawn (`referral_rewards.withdrawn_at`, promo made
  inactive). A code already used on a live order stays used. Nothing is sent
  for a withdrawn code; a queued WhatsApp for it is skipped.
- It also ends without a reward when the first order's regular boxes (before
  discount; bulk deals do not count) come to less than
  `REFERRAL_MIN_ORDER_RUPEES`, when the order or a gift went to the referrer's
  own phone number or address, or when either account was deleted.
- **Monthly limit**: a referrer earns at most `REFERRAL_MAX_PER_MONTH` codes
  in an IST calendar month. Over the limit, only the referrer's code is
  skipped; the friend still gets theirs, and the panel marks the referral
  "Referrer over the monthly limit".
- **Exactly once**: each referral row is locked while it is settled, and
  `referral_rewards` is unique per referral and role, so a retried or doubled
  run never issues a second code. The referrer's own row is locked while the
  monthly count is taken, so two settlements at once cannot both pass the limit.

### The thank-you codes

Made through `promo_codes` (`src/promos.js`), so every promo rule applies:
`REFERRAL_REWARD_PERCENT`% (or, with `FLAT`, `REFERRAL_REWARD_RUPEES`) off
**regular boxes only** (never bulk deals),
on orders of at least `REFERRAL_MIN_ORDER_RUPEES`, one use, valid 90 days,
code `TY` + 8 characters. Each code belongs to one customer
(`promo_codes.owner_customer_id`): anyone else gets "PROMO_INVALID". These
codes are kept out of the panel's Promo codes list (they are on the Referrals
section instead). No wallet or store credit is involved; a code is only a
discount on a later order.

Each person is told through the existing outbox: a WhatsApp message (template
`mandi_referral_reward`, kind `REFERRAL_REWARD`) and, when browser
notifications are on, a push that opens the Account page.

### Panel

**Promos → Refer a friend** (managers only): the rules in words, counts
(waiting, rewarded, without a reward), and every referral with the referrer and
friend (name and masked phone), the code, the friend's first order, the status
and reason, and the thank-you codes with whether each was used or withdrawn. Filter by
status. API: `GET /admin/v1/referrals?status=PENDING|REWARDED|VOID`.

## Shop funnel

### What is sent

The shop sends `POST /v1/events` with exactly `{ browserId, step }`:

| Step | When |
| --- | --- |
| `visit` | The shop opens |
| `product_view` | A box's page opens |
| `add_to_cart` | A box (or one more of it, or a bulk deal) goes into the cart |
| `checkout_start` | The checkout page opens |

`browserId` is a random UUID made in the browser and kept in `localStorage`
(`mm.fid`). The request is sent with `credentials: 'omit'` and no token, so it
carries no account, cookie, phone, cart or page address. Nothing is sent until
`/v1/policy` says the funnel is on; steps that happened before that wait in
memory and are dropped if it is off.

`paid` is never sent by the shop. Checkout passes the same `funnelId` with
`POST /v1/checkout/confirm`; the API keeps that order-to-browser link
(`funnel_checkouts`) only until the payment is captured, when it records
`paid` for that browser and deletes the link (or for at most a day, if the
payment never comes).

### The endpoint

- Switch off: `204`, nothing stored, before any other check.
- Body is validated strictly: `browserId` must be a UUID and `step` one of the
  four above (`paid` is refused). Anything else is `400`.
- Rate limited per address: 120 events per 10 minutes (`429` after that). The
  limiter is in each instance's memory: a flood guard, not a count of people.
- Stored once per browser, step and IST day (`funnel_events` primary key), so
  repeats are free.

### Retention and rollups

Every day the maintenance loop's `funnel-retention` step (after `retention`)
writes the daily totals into `funnel_daily` (browsers per step per day), then
deletes event rows older than 90 days and stale checkout links. It runs
whatever the switch, so turning the funnel off still lets old rows expire.

### Panel

**Analytics → Shop funnel** (managers only): the range's totals as bars, each
with the conversion from a visit and from the step before, and a table by day
with each step's count and conversion. Pick a range with From and To (up to
90 days; defaults to the last 14). API:
`GET /admin/v1/analytics/funnel?from=YYYY-MM-DD&to=YYYY-MM-DD`.

## Managers' evening summary

- **Opting in**: on the **Staff** page, under "My evening summary", a manager
  turns it on with the WhatsApp number to send it to (an Indian mobile), or
  stops it. Each manager sets only their own (`PUT /admin/v1/me/daily-summary`).
  The People table shows who has it on. Other roles cannot receive it.
- **Sending**: from `MANAGER_SUMMARY_TIME` (IST) to midnight, the maintenance
  loop's `manager-summary` step takes the day's numbers once and queues one
  WhatsApp message per opted-in manager through the existing outbox.
- **Exactly once a day**: a job lease (`manager-summary`) keeps two runs from
  working at the same time, and `manager_summaries` has one row per day and
  manager, whose id is the message's event id (`notifications` is unique per
  event and kind). If the loop is down from the set time until midnight, that
  day's summary is skipped, not sent late the next day.
- A queued message is dropped unsent if the manager turned the summary off or
  changed the number before it went.
- **Preview**: on **Today**, managers have "Preview today's summary": the
  numbers so far and the message as it would read now, with how many managers
  will get it. It sends nothing (`GET /admin/v1/daily-summary/preview`).

The numbers (IST day):

| Number | Meaning |
| --- | --- |
| Orders and revenue | Paid orders placed that day, not cancelled since; replacements are not counted |
| Boxes delivered / failed | Boxes on orders that turned Delivered / Delivery failed that day |
| New claims | Claims raised that day |
| Unhappy ratings | 1 or 2 stars that day, on an order rating or a box review |
| Needs attention | The same count as the panel's Needs attention list at that moment |

## Privacy

- Funnel rows hold only a random browser id, a step and a day. No account,
  phone, address, IP address or page address is stored with them.
- Phones on the panel's Referrals section and the summary setting are masked
  (`+919876••••10`). Growth's own log lines carry ids and counts only. The
  development `log` WhatsApp provider prints each message's variables, as it
  does for every message, with the phone masked.
- Thank-you codes are visible only to their owner (Account page) and to
  managers.

## Owner actions (Meta WhatsApp templates)

Both templates must be approved in WhatsApp Manager **before** turning on the
matching switch. Until then messages fail at the provider and show on Needs
attention as failed WhatsApp messages.

1. **`mandi_referral_reward`** (category: Marketing or Utility, language
   English). Five body variables:
   `{{1}}` name, `{{2}}` amount (e.g. ₹100), `{{3}}` the code, `{{4}}` the last
   day it works (e.g. 24 January 2027), `{{5}}` the minimum order (e.g. ₹499).
   Suggested body: "Hi {{1}}, thank you for sharing MandiMangoes! Here is
   {{2}} off your next order of boxes: use code {{3}} by {{4}} on an order of
   {{5}} or more."
2. **`mandimangoes_daily_summary`** (category: Utility, language English), or
   the name set in `MANAGER_SUMMARY_TEMPLATE`. Eight body variables:
   `{{1}}` the day, `{{2}}` orders, `{{3}}` revenue, `{{4}}` boxes delivered,
   `{{5}}` boxes failed, `{{6}}` new claims, `{{7}}` unhappy ratings, `{{8}}`
   needs attention. Suggested body: "MandiMangoes, {{1}}. Orders: {{2}} ({{3}}).
   Boxes delivered: {{4}}, failed: {{5}}. New claims: {{6}}. Unhappy ratings:
   {{7}}. Needs attention: {{8}}."

Then set the switches (and, if wanted, the reward amounts and summary time) in
the API's environment and redeploy.

## Tests

- API: `mango-api/test/growth.test.js` (every rule above, the abuse cases, and
  each switch off answering 404 or 204).
- Panel: `tests/growth.spec.ts` (mock API).
- Shop: `customer-app/tests/growth.spec.ts`, against a real API with
  `REFERRALS` and `FUNNEL_ANALYTICS` on.
