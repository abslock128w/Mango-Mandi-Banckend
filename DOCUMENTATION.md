# Mango Ops — Admin Panel Documentation

Operations tool for MandiMangoes staff: receive stock, run quality control, move
orders through fulfilment, handle claims with replacements, and manage delivery areas.
A problem with a delivered order is settled by a replacement, never a refund. Money goes
back, always in full, only when a customer cancels a paid order before packing or a
manager cancels one we cannot deliver (plus automatic refunds of second or wrong-amount
payments). There are no partial refunds. See [docs/order-states.md](docs/order-states.md).

- **App:** React + TypeScript + Vite single-page app (`mango-admin/`)
- **Backend:** talks only to `mango-api` under `/admin/v1`
- **Companion docs:** [README.md](README.md) (dev quick-start), [../vmr_mangoes_admin.md](../vmr_mangoes_admin.md) (full spec/PRD)

---

## 1. What it's for

The panel replaces hand-written API calls (Postman) with buttons that only ever
offer valid actions. Staff can run the shop without a developer, and the UI can't
cause an oversell because **all stock and money rules live in the
API** — the panel only displays what the backend returns.

## 2. Who uses it

One login per staff member, with four roles. Managers add people and set roles on the
**Staff** screen.

| Role | Sees | Can do | Cannot do |
|------|------|--------|-----------|
| **Packer** | Pack list, Deliveries, order pages | Allocate and pack, mark packed, shipped, out for delivery, delivered or missed | Cancel or move orders, anything outside packing and delivery |
| **QC** | Batches | Receive stock, log QC, adjust stock counts, move a batch forward | Condemn a batch, see orders or customers |
| **Operator** | Every screen except Staff | Everything above, plus cancel orders, add/deactivate pincodes, claims | Condemn a batch, delete a pincode, edit rules, move a whole day |
| **Manager** | Everything | Everything, plus Staff and the activity log | — |

Packers and QC staff land on their own screen after signing in, and other screens say
"Not available for your role". Manager-only buttons appear **disabled with "Requires manager role"** for operators.

---

## 3. Getting started

### Run locally
```bash
# 1. Backend (separate terminal)
cd mango-api && npm install && npm run dev        # http://localhost:3000

# 2. Admin panel
cd mango-admin && npm install && npm run dev      # http://localhost:5173
```
The panel reads the API address from `.env` (`VITE_API_URL=http://localhost:3000`).
If it's unset, a red banner warns you.

### Seed logins (change before production)
One manager login everywhere: put it in `.local/manager-login.json` (`{"email": "...", "password": "..."}`,
git-ignored) and `scripts/start-local.mjs` makes that the only staff login on this computer, the
same one the Vercel demo uses (`PREVIEW_ADMIN_EMAIL` / `PREVIEW_ADMIN_PASSWORD`). Add riders and
other staff from the panel's Staff page. Without the file, development seeds these test logins
(CI and the end-to-end tests use them):

| Email | Password | Role |
|-------|----------|------|
| `manager@mandimangoes.test` | `manager123` | Manager |
| `ops@mandimangoes.test` | `operator123` | Operator |
| `packer@mandimangoes.test` | `packer123` | Packer |
| `qc@mandimangoes.test` | `qc123` | QC |

### Signing in
Email + password. A wrong login shows a generic "Invalid credentials" (it never
says which field was wrong). Your session is kept via an httpOnly cookie — reload
the page and you stay signed in. If the session expires you're returned to the login
screen with "Your session has ended."

---

## 4. The screens

### Everywhere (Mango Ops v2, docs/design/ops-dashboard-v2.md)
- **Attention bell** (managers, operators) in the top bar: how many problems need someone,
  red when one needs someone now; it opens the same ranked list as Today in a drawer.
- **Live dot**: *Live* while the event stream (`GET /events`) is up, *Reconnecting*, *Every 15 s*
  when the stream will not stay up and the panel polls instead, *Paused* when offline (with Reload).
  A new paid order and a missed delivery raise a toast; the account menu can add a chime and a flash.
- **Keyboard**: `?` lists every shortcut; `g` then `t`/`o`/`d`/`p`/`b` goes to Today, Orders,
  Deliveries, Pack list, Batches; `/` finds on the page; in lists `j`/`k` move, `x` selects,
  `Enter` peeks, `o` opens. Never while typing in a field.
- **Density**: rows are 36 px with a mouse and 44 px on a touch screen; the account menu can fix
  it to Compact or Comfortable. **Pin** a screen to the top of the sidebar from the account menu
  or the palette. All of these are kept per browser.
- **Command palette** (Ctrl/⌘ K): screens, orders, batches and pincodes as before, plus Actions
  (assign a rider to the order on screen, receive a batch, dispatch today's run, give stops without
  a rider out, the pack list for tomorrow, switch theme), Recent (the last eight opened), `>` for
  actions only and `#1042` to jump to an order.

### Today (control tower)
Managers and operators open on the **Attention queue**: every problem ranked Now, Soon or Watch,
with the role that owns it, how old it is, one action, and *Snooze until tomorrow* (this browser
only) or *Open*. It joins Needs attention, overdue and at-risk orders, and the clock: a slot
within 30 minutes of its pack-by with orders not packed, stops with no rider near dispatch-by, a
rider silent for 30 minutes with stops left, and a stop out past its window. *All clear* when
there is nothing. Then **The day**: each delivery slot on one timeline (order cutoff, pack by,
dispatch by, the window) with where its orders are and a due-in or late-by pill; a lane opens
that slot on Deliveries. Then **On the road**: riders out, stops left, the next pickup, stock
health and a small map. The tiles, the week's numbers (now with on-time delivery and minutes
per stop), the Needs attention playbooks (each item with its fix) and stock follow, as before.
Packers, QC and riders keep their own home screens.

### Batches
**List:** variety, plucked date, age, status, latest QC rating, on-hand / committed /
available. Filter by status (filters live in the URL, so a view is bookmarkable). A
batch with no QC shows **"No QC: not sellable yet"** — the availability engine counts
it as zero until QC is logged.

**Receive batch:** pick variety, plucked date (not in the future), optional farm, and
a quantity per product. Lands you on the new batch's detail with the QC form focused.

**Batch detail:**
- **Stock** per SKU — on-hand, held (reserved by unpaid customers), committed (paid,
  not yet packed), reserve buffer, available. Hover held/committed for a plain-English
  explanation.
- **Status** — moves forward only (`Arriving → In transit → Arrived → Ripening →
  Selling → Exhausted`); the next step is the primary button, skip-ahead is a secondary
  option.
- **Condemn** (manager-only, red) — cancels every open order holding the
  batch; the dialog warns first and lists the cancelled order numbers after.
- **QC** — log ripeness (Raw / Semi-ripe / Ripe) + condition (Good / Minor blemish /
  Reject) + notes. Logging twice in a day warns that the new entry supersedes the old.
- **Adjust stock** — change on-hand or reserve buffer with a required reason. The API
  refuses a value below what's already held or committed.
- **Ledger** — every stock movement (intake, hold, commit, pack, release, adjust) with
  who and when.

### Orders
**List (workbench):** order number, customer + phone, item count, total, status, delivery
date, **Due** (the slot window, with a due-in or late-by pill on the day) and **Rider**, placed
time. Click a heading to sort the page; **Columns** hides any (kept per browser). Saved views
above the table: Tomorrow morning, Unpacked for today, Failed deliveries, Payment pending > 30 min,
and *Save this view* for any filter. Choose rows (or all on the page) for Mark packed, Assign
rider, Export CSV or Print. `Enter` or the eye button peeks at an order in a drawer (items,
customer, history, main actions); a click on the row opens the full page. Filter by status,
placed-date range, or search by order number / phone, all bookmarkable. 50 per page.

**Order detail** shows items, totals, payment, the customer, the status timeline, and
the stock allocation. The **action bar only shows valid actions** for the current
status (see §5). Highlights:
- **Allocate and pack** assigns batch stock, then the pick list appears.
- **Mark packed** is disabled with "Allocate first" until allocation is done.
- **Cancel** needs a 3-character reason; the dialog says whether held stock is released.
- There is no refund action.
- Payment-pending orders show a read-only note — there's no manual confirm, because only
  a verified payment confirms an order.

### Deliveries (Dispatch board)
Managers and operators get the stops on the left and a map on the right (a List / Map switch
below 1024 px). Tabs: **Unassigned** (stops without a rider, on top), **By rider** (each rider
with done/left, when last seen and how far from the warehouse), **By slot** (the run sheet as it
always was, with Start run, per-stop riders and Print) and **Done**. Choose stops with their box,
`x` or shift-click, then **Assign to…** (riders with distance and stops left), **Assign nearest**
(only the chosen stops; each result is listed), **Dispatch** or **Print run sheet**. The map
shows warehouses, one pin per pincode centre (stops have no coordinates of their own; a number
when several share one), riders fading as their position ages, and on request the done stops and
the last two hours of rider trails. Hovering a row lights its pin; a stop opens in the peek
drawer. Map tiles come from `VITE_MAP_TILES_URL` (OpenStreetMap by default, with its credit; use
a paid tile provider before heavy use). Riders keep their one-stop-at-a-time route.

### Pack list
Printable picking sheet for a delivery date (defaults to tomorrow). Two views:
**By order** (customer + items + which batch to pick from, with an allocate shortcut)
and **By batch** (every batch once, with its picks aggregated across orders — pick a
whole batch at a time). "Print" produces a clean black-on-white sheet with no nav.

### Claims
Queue of post-delivery claims (default: open ones). Each shows the order, customer
phone, issue type, description, affected items, and a photo link if provided.
**Start review** moves a claim to Under review. **Resolve** as Replacement (send the
affected items again) or Reject, behind a confirm dialog. There is no refund option.

### Pincodes
Serviceable delivery areas. Add a pincode (exactly 6 digits + city). **Deactivate**
(behind confirmation — customers there can no longer order) or **Delete** (manager-only,
the dialog suggests deactivating instead).

---

### Analytics
Season numbers week by week as before, plus **Operations** for any period against the one
before it: on-time delivery, minutes per stop, repeat customers, deliveries, slot fill, the
variety mix, the rider leaderboard and orders by pincode on a heat map, each with its figures.

## 5. Business rules the panel enforces

### Order status flow
Every status, every allowed move and who makes it, payment and refund states,
preorders, gift orders, and every path that puts money right (hold expiry, late
payments, second payments, failed refunds, disputes, lost webhooks) are in
**[docs/order-states.md](docs/order-states.md)**, generated from the API's order map.
In short:
```
PAYMENT_PENDING ─(payment)─▶ CONFIRMED ─▶ PROCESSING ⇄ PACKED ─▶ SHIPPED ─▶ OUT_FOR_DELIVERY ─▶ DELIVERED
                                                                                     │
                                                      RETURNED(RTO) ◀─ DELIVERY_FAILED ◀┘ (or Retry)
```
- The customer can cancel until the order is packed (a paid order is refunded in full).
- A manager can cancel a paid order until it is delivered, with a full refund; that
  includes failed and returned deliveries. Staff can cancel an unpaid order up to out for delivery.
- PACKED goes back to PROCESSING only when the warehouse takes a box off the order.
- A payment that lands after the hold ran out confirms the cancelled order after all.

`RTO` is shown as **"Returned."** The panel never offers an invalid transition, and the
database refuses one too.

### Batch status
Forward only; `Condemned` can be set from any non-final state and triggers
cancellation of affected orders.

### Destructive actions always confirm
Cancel, condemn, resolve claim, and deactivate/delete pincode each
open a dialog that names the consequence before it runs.

---

## 6. Errors & resilience

- **Session ended** → back to login with a message.
- **Someone else changed the order** (409) → "This order was just updated by someone
  else" and the screen refetches.
- **Offline** → a banner appears until the connection returns.
- **A request failed** → a Retry button, not a dead screen.
- **A screen crashes** → an error card with Reload; the nav survives.
- **Any crash or uncaught error** → reported to Sentry when the build sets
  `VITE_SENTRY_DSN`, without customers' phone numbers, addresses or search words
  (deploy/VERCEL.md, "Error reports from the shop and the panel").
- Unknown URLs show a Not-found page.

## 7. Security

- Access token kept in memory only — never stored, never logged.
- Refresh token in an httpOnly cookie set by the backend.
- No customer data in URLs or logs beyond order numbers. Error reports to Sentry mask
  phone numbers, e-mails and codes, drop query strings, and carry no text from the page.
- All API text is rendered as plain text; the app ships no third-party scripts.
- Use HTTPS in production and set the API's `ADMIN_ORIGIN` to the panel's host.
- Riders see only the stops given to them. Managers and operators give stops (one, or a whole
  slot) to a rider with the picker on the Deliveries page; a rider can also take the packed
  stops nobody has yet ("Take them and start").
- Staff passwords are at least 12 characters and not a common password. Everyone can change
  their own on the Two-step sign-in page (Your password); their other sessions end.

## 8. Deploying

```bash
cd mango-admin
npm run build          # type-checks, then builds to dist/
```
`dist/` is static files any host serves (Netlify, Vercel, S3, Nginx…). Set
`VITE_API_URL` to the production API and the API's `ADMIN_ORIGIN` to the panel's URL.

## 9. Testing

```bash
npm run typecheck                                  # tsc --noEmit
npm run lint && npm run test:unit                  # ESLint (hooks, unused) and unit tests
npx playwright test tests/smoke.spec.ts tests/a11y.spec.ts   # no backend needed
# full flow against a live backend:
E2E_EMAIL=manager@mandimangoes.test E2E_PASSWORD=manager123 \
  npx playwright test tests/day-in-the-life.spec.ts --project=desktop
```
CI (`.github/workflows/ci.yml`) runs typecheck + build + smoke + accessibility on every
push. The accessibility suite runs axe-core (WCAG 2 A/AA) with zero violations.

## 10. Known limitations

- **Needs `mango-api` running.** The panel is a thin client; with no backend it shows
  errors, not data.
- Staff roles and the httpOnly-cookie auth assume the matching backend
  endpoints (all implemented in the current `mango-api`).
- Dry-fruit intake isn't supported yet (needs the backend availability engine to model
  it) — batch intake is mango-only.
- The role split (operator vs manager) is a sensible default; confirm it with the real
  team before launch.

## 11. Reference — screen → endpoint

| Screen | Endpoints (`/admin/v1`) |
|--------|-------------------------|
| Login / session | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me` |
| Today | `GET /summary`, `/attention`, `/day?date=`, `/live?date=`, `/analytics/ops` |
| Everywhere | `GET /events` (Server-Sent Events: `hello`, `order.changed`, `rider.position`, `attention.changed`, `heartbeat`, `bye`) |
| Deliveries | `GET /manifest`, `/live`, `/riders`, `/riders/:id/trail`; `POST /manifest/assign`, `/manifest/auto-assign`, `/manifest/dispatch`, `/orders/:id/dispatch` |
| Analytics | `GET /analytics`, `/analytics/ops?from&to` |
| Batches | `GET /batches`, `GET /batches/:id`, `POST /batches`, `GET /products`, `GET /batches/:id/ledger` |
| Batch actions | `PATCH /batches/:id/status`, `POST /batches/:id/qc`, `PATCH /batches/:id/lines/:lineId` |
| Orders | `GET /orders` (also `delivery`, `slot`, `unpacked`, `olderThanMinutes`), `GET /orders/:id`, `GET /slots` |
| Order actions | `PATCH /orders/:id/status`, `POST /orders/:id/allocate`, `/cancel` |
| Pack list | `GET /pack-list?date=` |
| Claims | `GET /claims`, `POST /claims/:id/review`, `POST /claims/:id/resolve` |
| Pincodes | `GET/POST /pincodes`, `PATCH/DELETE /pincodes/:pincode` |

All responses use the error shape `{ error: { code, message, requestId } }`.

---

*Admin panel v2 — documented 2026-10-09. Pair with the README for dev setup and the PRD
(`vmr_mangoes_admin.md`) for the full requirement specification.*
