# Mango Ops v2: the control-tower redesign of the staff panel

Plan written 3 Nov 2026 after reviewing the current panel (`src/`, screenshots in `docs/screenshots/panel/`,
`design/tokens.css`, `design/COMPONENTS.md`) and how the best operations consoles are built: Onfleet and Toast
(map + list dispatch, unassigned tasks on top, drivers as pulsing dots, table view with bulk actions), Uber Eats
Orders (audible + visual alert per new order, one-tap stage advance, "alert nearby courier"), Linear (keyboard
first: `?` help, `g`+letter chords, `j/k/x`, sparse default view, 32–36 px rows), Stripe (dense sortable
filterable tables, today by default, monospace tabular numerals), Shopify admin (home = real-time metrics plus
tasks; merchants revolted when the 2026 redesign buried the numbers: keep numbers up top), control-tower
literature (management by exception: show only what is out of range, rank it, give every alert an owner and a
one-click playbook, measure alert response time).

## What is good today and must stay

- Orchard tokens, light/dark, 4.5:1 text contrast, `node design/check-contrast.mjs`.
- Grouped sidebar that collapses, phone tab bar + Menu sheet, skip link, disclosures with correct focus handling.
- ⌘K palette (screens, orders, batches, pincodes). Role gating (`canSee`, `GatedButton` + visible reason).
- Today: Needs attention (dead-letter view), pipeline bar + status tiles, week KPIs with sparklines, morning brief.
- Tables → cards under 640 px, `scrollRegion`, axe on every page, Playwright specs that intercept `/admin/v1`.
- No enum names on screen (`format.ts` labels). Nothing on this list may regress.

## What is missing (the gap to "best in class")

1. **No sense of time.** Tiles count statuses but never say *by when*: the morning slot's pack-by and
   dispatch-by cutoffs, how many stops are still out with 40 minutes left in the window, which orders will
   miss their slot. Ops consoles live on a clock.
2. **Attention is a wall of prose.** Items have no severity, no owner, no age, no "snooze", and the action
   sits at the end of a sentence. Exception-first design ranks them and makes the fix one click.
3. **No live view of the ground.** Riders report GPS (`rider_locations`), stops have pincode centres
   (`pincodes.lat/lng`), warehouses have coordinates (`warehouses.lat/lng`), nearest-rider assignment
   exists (`POST /manifest/auto-assign`), yet nothing draws any of it. Deliveries is a slot-by-slot list.
4. **Tables are reading tables, not working tables.** No sort, no column choice, no bulk select, no
   keyboard movement, no peek drawer; every row opens a full page.
5. **The palette navigates but cannot act.** No verbs, no recent items, no shortcut help, no chords.
6. **Everything polls at 60 s.** A new order, a failed delivery or a rider going quiet shows up a minute
   later, silently. Uber Eats Orders plays a sound and flashes for each new order for a reason.
7. **Density is uniform.** 14 px body and roomy cards are right for packers on phones, wrong for a manager
   on a 1440 px screen who wants 30 orders above the fold.
8. **Analytics is week bars.** No on-time %, slot fill, rider performance, pincode heat, variety mix.

## Design principles for v2

- **Exception first, numbers second, lists third.** Every landing screen opens with what needs a person,
  then the live state, then detail. Nothing moves on the screen while it loads (keep the placeholder sizing).
- **Every number is a link with a filter** (as the tiles already are). Every alert has: severity, owner role,
  age, one primary action, a secondary "snooze until tomorrow" (client-side, per browser) and "open".
- **Time is a first-class axis.** The operating day is drawn once (the Day strip) and every fulfilment page
  shows "due in" / "late by" next to the thing, computed from slots + rules (`/config`, `/slots`).
- **Density by pointer, not by guess.** `@media (pointer: fine)` tightens rows to 36 px, tables to 13 px,
  tabular-nums; coarse pointers keep 44 px. One `data-density="compact|comfortable"` override on `<html>`
  from the account menu, stored like the theme.
- **Keyboard first, mouse always.** `?` opens the shortcut sheet, `g` chords jump (`g t` Today, `g o` Orders,
  `g d` Deliveries, `g p` Pack list, `g b` Batches), `j/k` move in lists, `x` selects, `Enter` peeks,
  `o` opens, `a` assign rider, `/` focuses search, `Esc` closes. Chords are never active inside inputs.
- **Nothing colour-only, nothing enum-named, nothing under 4.5:1.** Keep the Orchard tokens; add only
  what is listed under Tokens below.
- **Additive backend.** New endpoints only; existing routes and tests untouched; new tables, no altered columns.

## The screens

### 1. Shell polish (all pages)

- Top bar: brand · breadcrumb → **page header moves into the page** (title + primary actions on the right,
  sticky on scroll). Add a **Day switcher** (Today / Tomorrow / date) that fulfilment pages read from the URL
  (`?date=`), an **Attention bell** with the `attentionCount` badge (opens a right drawer listing the same
  items as Today's queue, so a problem is one click away from any page), the **Live dot** (green when the
  event stream is connected, amber "reconnecting", grey "paused" with a Reload) and the existing theme and
  account menus. Account menu gains Density and Keyboard shortcuts.
- Sidebar: unchanged groups; add a per-user **Pinned** section (drag or `⋯ → Pin`), stored in localStorage.
- Toasts gain a **sound + flash** option (off by default, per browser, in the account menu) used only for
  new orders and failed deliveries. Never autoplay before the user has interacted with the page.
- `Kbd`, `Shortcut sheet` (`?`), `PeekDrawer` (right side, 480 px, focus-trapped, `Esc`/overlay closes,
  URL `?peek=<id>` so it survives reload and back), `DataTable` (below), `DayStrip`, `Stat` (compact KPI),
  `QueueItem`, `MapView` become shared primitives in `src/ui/` (split `ui.tsx` into a folder, re-export so
  existing imports keep working).

### 2. Today → "Control tower" (managers and operators)

Layout from 1200 px: 12-column grid; under 900 px it stacks in the same order.

1. **Header row.** "Today, Tuesday 3 November" · live dot and "updated 10:42" · `Preview today's summary`.
2. **Attention queue** (full width, replaces Needs attention's prose). A ranked list of `QueueItem`s:
   severity chip (Now / Soon / Watch), what ("Refund not sent · ORD-1040"), why in one line, age ("23 min"),
   owner role chip, primary action button, overflow (Snooze until tomorrow, Open). Grouped by severity,
   collapsed past 8 with "Show 14 more". Sources: today's `/attention` lists + `/summary` overdue + at-risk
   + new v2 signals (slot about to miss cutoff with unpacked orders; rider silent > 30 min while out; stop
   out for > 2× `minutesPerStop` × stops). The "All clear" state stays: one calm line, no empty box.
3. **Day strip** (full width): the operating day as a horizontal timeline, IST, now-marker, one lane per
   delivery slot: order cutoff → pack by → dispatch by → window. Each lane shows a stacked progress
   (ordered / packed / out / delivered / failed) and a "due in 38 min" or "late by 12 min" pill. Click a
   lane → Deliveries for that slot. Data: new `GET /admin/v1/day?date=`.
4. **Live row** (3 Stats + a mini map, 4 columns): Riders out (n of m, last ping age), Stops left (with
   the oldest), Next pickup (warehouse, count ready), Stock health (batches near limit, low SKUs); mini
   `MapView` with riders + remaining stops, click → Dispatch board.
5. **Orders in progress**: keep the pipeline bar and tiles, denser (one row on desktop).
6. **Week KPIs** (managers): keep, add On-time delivery % and Avg minutes per stop.
7. **Stock**: keep the two tables; rows get the freshness strip and a Receive batch action.

Packers keep Pack list as home; QC keep Batches; riders the rider app. Operators see 1–5 and 7.

### 3. Deliveries → "Dispatch board"

A split view from 1024 px (list left 440 px, map right); under 1024 px a segmented control toggles List / Map.

- **Left: stops and riders.** Tabs: *Unassigned (n)* · *By rider* · *By slot* · *Done*. Unassigned on top,
  Onfleet style. Each stop row: order number (mono), customer, pincode · area, boxes, slot pill, state
  badge, due-in pill, assigned rider avatar. Multi-select (`x`, shift-click) → sticky action bar:
  **Assign to… (rider picker with distance and stop count)**, **Assign nearest** (calls
  `/manifest/auto-assign` with the selected ids; shows the result per stop: rider, distance, warehouse),
  **Dispatch**, **Print run sheet**. Rider lanes: avatar, name/email, stops (done/left), last seen ("2 min
  ago" green / "41 min" amber / "no position" grey), distance to warehouse, "Call".
- **Right: MapView.** Leaflet via npm (`leaflet` + types; no react-leaflet), tiles from
  `VITE_MAP_TILES_URL` (default OpenStreetMap standard tiles with the required attribution; document that a
  paid tile provider should replace it before heavy use). Markers: warehouse (house glyph), stops (pin,
  colour by state, number = sequence when assigned, cluster when > 50), riders (pulsing dot, opacity by
  freshness, label on hover). Hover a row → marker highlights and vice versa; click a stop → PeekDrawer with
  the order summary and the same actions. Layer toggles: slots, done stops, rider trails (last 2 h from
  `rider_locations`). Fit-to-bounds button. Keyboard: the map is skippable; everything on it is also in
  the list.
- **Riders' own view** (role RIDER on the panel) stays the one-stop-at-a-time route; unchanged.
- Data: new `GET /admin/v1/live?date=` (riders with last position + age, stops with pincode coords and
  state, warehouses) refreshed by the event stream; existing `/manifest`, `/riders`, `/manifest/assign`,
  `/manifest/auto-assign`, `/manifest/dispatch`.

### 4. Orders → "Workbench"

- `DataTable`: sticky header, sortable columns (server-side where the API sorts, else client-side on the page),
  column chooser (localStorage), density aware, row hover actions, `j/k/x/Enter/o`, select-all-on-page,
  bulk bar (Mark packed where allowed, Assign rider, Export CSV via the existing exports feature, Print).
- **Saved views** as chips above the table from URL params: *Tomorrow morning*, *Unpacked for today*,
  *Failed deliveries*, *Payment pending > 30 min*, plus "Save this view" (localStorage, per user).
- **Peek drawer** on Enter/click: order header, items, customer, timeline, the 4 primary actions; `o` or the
  title opens the full page. Full `OrderDetail` is unchanged.
- Columns add **Due** (slot window with due-in/late pill) and **Rider**.
- Same `DataTable` is then applied to Batches, Claims, Preorders and Pack list (pack list keeps its 48 px work
  targets on coarse pointers).

### 5. Command palette v2

- Sections: *Actions* (verbs with context: "Assign rider to ORD-1042", "Receive a batch", "Dispatch morning
  run", "Open pack list for tomorrow", "Switch to dark"), *Recent* (last 8 opened items, localStorage),
  *Screens*, *Orders*, *Batches*, *Pincodes*, *Customers* (when the feature is on). Actions respect
  `canSee`/`can`. Typing `>` filters to actions; `#1042` jumps to the order.
- `?` shortcut sheet lists everything; chords shown as `g` `o` keycaps. `aria-keyshortcuts` on buttons.

### 6. Live updates

- New `GET /admin/v1/events` Server-Sent Events (Node runtime, Fluid Compute; not Edge). Emits
  `order.changed {id, status, date}`, `rider.position {riderId, at}`, `attention.changed {count}`,
  `heartbeat` every 25 s. Implemented with an in-process emitter fed from the places that already write
  order history, rider locations and the attention report; a Postgres `LISTEN/NOTIFY` bridge so several
  instances agree. If the platform cuts the connection (Vercel function max duration), the client reconnects
  with backoff and falls back to 15 s polling with `If-None-Match` after three failures; the Live dot says
  which mode it is in. React Query invalidation on events, nothing else re-fetched blindly.
- Toast + optional chime for `order.changed` to CONFIRMED (new paid order) and to DELIVERY_FAILED.

### 7. Analytics v2 (managers)

- Period picker with comparison (this week vs last, custom ranges), kept in the URL.
- New cards: **On-time delivery %** (delivered inside its slot window), **Slot fill** (orders per slot vs
  capacity), **Minutes per stop** (median, from dispatch to delivered / stops), **Rider leaderboard**
  (delivered, failed, median minutes, photo-check flags), **Pincode heat** (MapView choropleth of orders per
  pincode), **Variety mix** (BarList), **Repeat customers %**. Every chart keeps a table beside or under it
  (saffron is below 3:1; the existing rule). Export the current view as CSV when exports are on.
- Data: new `GET /admin/v1/analytics/ops?from&to` (additive; the existing `/analytics` untouched).

## Backend additions (all additive, all behind the existing manager/operator access rules)

| Route | Returns |
| --- | --- |
| `GET /admin/v1/day?date=` | slots with cutoffs from `/config` rules (order cutoff, pack-by = window start − packMinutes, dispatch-by), per-slot counts by state, per-slot capacity, `now` |
| `GET /admin/v1/live?date=` | riders `{id, name, email, phone?, lastAt, lat, lng, accuracy, stopsLeft, stopsDone}`, stops `{orderId, number, status, slotId, pincode, lat, lng, riderId, boxes, dueAt}`, warehouses `{id, name, lat, lng}` |
| `GET /admin/v1/events` | SSE stream as above |
| `GET /admin/v1/analytics/ops` | on-time, slot fill, minutes per stop, rider stats, per-pincode counts, variety mix, repeat rate |
| `GET /admin/v1/riders/:id/trail?date=` | positions for the day (managers/operators), for the trail layer |

Add to `access.js` with the same role sets as `/manifest`; add tests beside the existing API tests. Seed
(`src/seed.js`) must give the demo warehouse, demo pincodes and demo riders coordinates and a few recent
`rider_locations` rows so the map is never empty on a fresh deploy; today the shop's demo addresses are
Mumbai and the rider QA used Bengaluru: pick one city (Mumbai: the seed's addresses) and make them agree.

## Tokens and CSS additions (only these)

- `--row-h: 44px` (coarse) / `36px` (fine or compact), `--table-font: var(--text-sm)`, `font-variant-numeric:
  tabular-nums` on `.num`, `.mono` for ids.
- Severity: reuse `--color-error` (Now), `--color-warning` (Soon), `--color-info` (Watch): no new hues.
- Map marker colours map to the existing pipeline tones; the rider dot uses `--color-staff`.
- Leaflet CSS imported from the package, themed with the tokens (controls, popups, attribution) in
  `src/styles/map.css`; dark mode uses a CSS filter on the tile layer (`invert(1) hue-rotate(180deg)
  brightness(.9)`) which is what most dark dashboards do with OSM tiles.

## Delivery plan for the build session

1. Read this plan, `design/COMPONENTS.md`, `src/Layout.tsx`, `src/pages/Today.tsx`, `src/pages/Deliveries.tsx`,
   `src/pages/Orders.tsx`, `src/CommandPalette.tsx`, `mango-api/src/admin/reports.js`, `deliveries.js`,
   `nearest.js`, `access.js`, `seed.js`, `docs/qa/nearest-rider.md`. Commit this plan as
   `docs/design/ops-dashboard-v2.md` first.
2. Primitives + shell (DataTable, PeekDrawer, DayStrip, Stat, QueueItem, Kbd, shortcut sheet, density,
   Day switcher, bell, live dot). Specs for each with route interception.
3. Backend `day`, `live`, `events`, trail, `analytics/ops`, seed coordinates, API tests.
4. Control tower (Today). 5. Dispatch board with map. 6. Orders workbench and DataTable roll-out.
7. Palette v2. 8. Live updates wired through. 9. Analytics v2.
10. QA: `npm run typecheck`, `npm run lint`, `npm run test:unit`, API tests, `npm run test:e2e` (phone and
    desktop projects) including axe on every new screen and drawer, `node design/check-contrast.mjs`, bundle
    scan, new screenshots into `docs/screenshots/panel/` (light/dark 1280, light 390 for Today, Deliveries,
    Orders), update `design/COMPONENTS.md` and `DOCUMENTATION.md`, write `docs/design/ops-dashboard-v2.md`'s
    "What shipped / what did not" section honestly.
11. Open a PR against `claude/qa-fix-pass-3443b2` (stacked on PR #2) with before/after screenshots.

## Open questions for the owner (do not block; choose the default in brackets)

- Tile provider for the map [OpenStreetMap standard tiles for the demo, env-switchable].
- Pack-by lead time before a slot window [60 minutes] and dispatch-by [15 minutes before the window].
- "Rider silent" threshold [30 minutes while out on a run].
- Should operators be able to snooze attention items, or only managers [both; snooze is per browser].
- New-order chime default [off].
