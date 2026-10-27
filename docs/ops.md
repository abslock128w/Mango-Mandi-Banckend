# Staff operations

Three tools for managers: a stock forecast that suggests how many boxes to buy,
records of the farms the shop buys from and what each batch cost (with margins),
and a Settings page where managers turn the safe customer-facing features on or
off without a redeploy.

Each sits behind its own switch, and each switch is **off by default**. With a
switch off, its API routes answer 404 and the panel shows nothing new.

## Switches and environment (mango-api)

| Variable | Default | What it turns on |
| --- | --- | --- |
| `STOCK_FORECAST` | off | "Boxes to buy" on the Planning page (managers). Read only |
| `PURCHASE_RECORDS` | off | The Farms page, a Purchase section on each batch, and margins (costs: managers only) |
| `PANEL_FEATURE_SWITCHES` | `false` | The Settings page: managers' on/off choices for the allowlisted switches below |

`STOCK_FORECAST` and `PURCHASE_RECORDS` are themselves on the Settings
allowlist, so `.env.example` leaves them **empty** rather than `false`: an
explicit `false` is a kill switch the panel can't overrule (see below).

The panel reads the switches from `GET /admin/v1/auth/me` → `features`
(`stockForecast`, `purchaseRecords`, `panelSwitches`). The local launcher
(`scripts/start-local.mjs`) turns all three on.

Migration `040_ops.sql` adds `feature_switches`, `farms` and `batch_purchases`.
The forecast needs no table.

## Stock forecast (`STOCK_FORECAST`)

`GET /admin/v1/planning/forecast`, managers only (others get 403). It never
changes stock: it only reads orders, bookings, batches and the ledger
(`src/forecast.js`).

It covers the **14 days after today** (IST), per product (SKU) and ripeness.
For each day:

| Number | How it is worked out |
| --- | --- |
| Same weekday history | The 4 most recent past days on the same weekday. A day is left out when the delivery calendar had it closed, or when nothing sold and no batch of that product was at that ripeness then (by the batch's age, the ripening profile and the 7-day cap). The day's exact count isn't stored, so a batch that sold out early still counts its days |
| Average | The mean of the days that counted. Fewer than 2 such days: **not enough history** (`null`, never 0) |
| Paid orders | Boxes on paid orders for that day (their boxes are already set aside). Free replacements count here but not in history |
| Book ahead | Paid bookings not yet turned into orders, on the first day of their week (or the first forecast day if the week has started): the earliest they may be needed |
| Still to sell | `max(average, paid orders) − paid orders + Book ahead` |
| From stock | Free boxes of current batches that will be at that ripeness that day, by the same rules the shop sells by (`inventory.js sellableAs`: QC shift, transit, the 7-day cap), oldest batch first, each box used once across the 14 days. A batch that has arrived but waits for its first QC counts too. Free boxes are cut by the expected waste first |
| Short | What stock can't cover |

Expected waste per product, over the last 28 days: (boxes counted down as
damaged or written off, plus condemned, plus boxes replaced after an approved
damage claim) ÷ (boxes sold + boxes damaged). It is capped at 50%.

**Suggested boxes** for a product = total short ÷ (1 − expected waste), rounded
up. A variety's suggestion is the sum over its products. A product with no
history at any ripeness says "not enough history" instead of a number; its
shortfall against paid orders and bookings is still shown (`shortForBookings`).
"Picked by" is the latest pluck date whose fruit would be at that ripeness and
here on the first short day.

Every input is in the answer (each history day with whether it counted and why,
the average, bookings, stock used per batch, boxes that will pass the cap
unsold, the waste numbers), and the Planning page shows them under "How this
was worked out", so a manager can check the number before trusting it.

## Farm and purchase records (`PURCHASE_RECORDS`)

| Route | Who |
| --- | --- |
| `GET /admin/v1/farms` | Managers, operators, QC |
| `POST /admin/v1/farms`, `PATCH /admin/v1/farms/:id` | Managers |
| `GET /admin/v1/batches/:id/purchases` | Managers, operators, QC: **costs only for managers** |
| `POST /admin/v1/batches/:id/purchases`, `PATCH …/purchases/:purchaseId` | Managers |
| `GET /admin/v1/purchases?from&to&farmId` | Managers |
| `GET /admin/v1/analytics/margins?from&to` | Managers |

- A farm has a name (unique, any case), place, contact name and a phone number.
  The phone is stored in full but the API only ever sends it masked
  (`******3210`), to every role, and the audit keeps it masked too.
- A purchase belongs to a batch and a farm: date, crates, boxes, cost per crate,
  transport and other costs. Money is whole paise. The server refuses a cost
  per crate of 0 or less, negative transport or other costs, fractions of a
  paisa, a future date and an unknown farm; a switched-off farm takes no new
  purchases.
- A batch's purchases can't claim more boxes than the batch received (its
  intake plus receiving corrections: short arrivals and boxes counted in). The
  batch row is locked while this is checked, so two purchases saved at once
  can't both fit. Answer: 409 `PURCHASE_EXCEEDS_BATCH` with `receivedBoxes`.
- Costs are hidden from other roles by the API, not only the panel: their
  `GET …/purchases` has no money fields at all, and `/purchases` and
  `/analytics/margins` answer 403.
- Every add and edit writes a `staff_audit` row in the same transaction
  (`farm.create`, `farm.update`, `purchase.create`, `purchase.update`), with
  what changed (before and after).
- Adding or changing a purchase asks the manager to confirm it is them
  (step-up), even with `STAFF_STEP_UP` off, because costs set the margins. The
  purchase is checked first, so a code isn't spent on a refused one. See
  [authorization.md](authorization.md).

**Margins**, for batches whose purchases fall in the date range: a batch's cost
is spread evenly over the boxes its purchases name (cost per box). Each box sold
from it (paid, not cancelled; through `order_stock`) brings what the customer
paid for it: the box price less its share of the order's promo discount; a free
replacement brings nothing. Margin = revenue − cost per box × boxes sold;
margin per box = margin ÷ boxes sold. Boxes not sold (yet, or lost) are shown
with their cost separately. Per variety is the sum of its batches. Batches with
no purchase recorded are not counted.

The panel: a **Farms** page under Stock (operators read only; managers add and
edit, and see a Margins card), and a **Purchase** section on each batch page.

## Feature switches in the panel (`PANEL_FEATURE_SWITCHES`)

Managers may turn some switches on or off on the panel's **Settings** page
(under Admin). Only the safe, customer-facing ones, kept as one list in
`mango-api/src/feature-switches.js` (`PANEL_SWITCHES`):

`FAVOURITES`, `SHOP_SORT_FILTER`, `SHOP_INSTALL`, `LIVE_TRACKING`,
`BILLS_ENABLED`, `REFERRALS`, `FUNNEL_ANALYTICS`, `MANAGER_DAILY_SUMMARY`,
`STOCK_FORECAST`, `PURCHASE_RECORDS`, `HELP_CENTRE`, `SUBSCRIPTIONS`,
`MULTI_GIFT`, `SHOP_LANGUAGES`.

The page lists only the ones this build reads (a switch from a feature not yet
merged is not offered). To add one: add an entry to `PANEL_SWITCHES` and read
the switch with `isOn('KEY')` instead of `env.KEY`.

Security, payment, refund and inventory-safety switches are **never** changeable
from the panel (`NEVER_FROM_PANEL`; the file refuses to load if one is put in
the allowlist, and `test/ops.test.js` checks it): `STAFF_STEP_UP`,
`STAFF_AUDIT_TRAIL`, `REFUND_SAFETY_CHECKS`, `PAYMENT_DAILY_RECON`,
`ORDER_RULE_CHECKS`, `STOCK_INTAKE_CHECKS`, `API_HARDENING`, the warehouse,
customer profiles, exports, and the rest of that list. The API answers 403
`NOT_SWITCHABLE` for them, and ignores any row written for them by hand.

### The effective value

For an allowlisted switch, while `PANEL_FEATURE_SWITCHES` is on:

1. **The environment says `false`: off.** The environment is a ceiling, a kill
   switch nobody on the panel can overrule. Turning it on from the panel is
   refused (409 `ENV_KILL_SWITCH`), and a choice saved earlier is ignored.
2. Otherwise **a manager's choice** (a row in `feature_switches`) applies, on or
   off. An environment `true` can be turned off this way.
3. Otherwise **the environment's value**: its default when unset (off for the
   app-feel switches; for `BILLS_ENABLED`, on outside production, as
   `docs/trust.md` says).

With `PANEL_FEATURE_SWITCHES` off, or for any switch not on the list, it is the
environment's value and nothing else.

`BILLS_ENABLED` turned on from the panel in production still needs the
seller's details set on the server (409 `BILLS_NOT_CONFIGURED` otherwise).

### How it reaches every instance

Each API instance keeps the choices in memory for at most **30 seconds**
(`SWITCH_CACHE_MS`): before every request (and every maintenance run) it
re-reads the table when its copy is older than that. So a change takes effect
everywhere within about 30 seconds; the instance that saved it forgets its copy
at once. The existing switch reads use it: the favourites routes, live
tracking, bills (shop, panel, maintenance), and `GET /v1/policy` → `features`,
which the shop reads, so the shop shows the effective values.

### Changing one

`GET /admin/v1/settings/switches` lists each switch with a plain description,
the environment's value, whether the environment kills it, the manager's
choice and who made it, and the effective value.
`PUT /admin/v1/settings/switches/:key` with `{ "enabled": true | false | null }`
(`null` = back to the environment's value). Managers only.

Every change asks for the manager's password (or their two-step code, when
they have it on) again, **whether or not `STAFF_STEP_UP` is on**: it is the
existing staff step-up (`admin/step-up.js`, with its 5-tries lock). A refused
change is checked before the code is asked for, so a code isn't spent on it.
Each change writes a `staff_audit` row `feature_switch.set` (the old and new
choice and the value before), never the password.

## Tests

- `mango-api/test/ops.test.js`: the forecast with fixed dates (same-weekday
  history, skipped days, bookings, Book ahead, batch ripeness and the cap,
  waste, "not enough history", read only); farms and purchases (validation,
  the box limit, short arrivals, audit, masked phones, role refusals, costs
  hidden); margins; the switches (allowlist, step-up, audit, the env kill
  switch, env true turned off, the 30-second cache, the shop's policy).
- `tests/ops.spec.ts` (panel, mock API): the forecast and its working, Farms
  and margins, the batch purchase form, Settings with the password check, and
  who sees what.
