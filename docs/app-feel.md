# App feel (roadmap step 3)

The shop installs like an app, can send order updates as browser notifications,
shows how many stops away the rider is, sorts and filters the home page, and
keeps favourites. Riders get a one-stop-at-a-time route view on the panel's
Deliveries page.

Every part sits behind its own switch, and every switch is **off by default**.
With a switch off, its API routes answer 404, the shop and panel look as they
did before, and nothing new is written to the database.

## Switches and environment (mango-api)

| Variable | Default | What it turns on |
| --- | --- | --- |
| `WEB_PUSH` | `false` | Browser notifications: opt-in on Account, order updates pushed beside WhatsApp |
| `WEB_PUSH_PROVIDER` | `log` | `vapid` sends to the browsers' push services; `log` writes a log line instead (development, tests, CI) |
| `VAPID_PUBLIC_KEY` | empty | Application server public key, base64url (65-byte P-256 point) |
| `VAPID_PRIVATE_KEY` | empty | Application server private key, base64url (32-byte scalar). A secret |
| `VAPID_SUBJECT` | empty | `mailto:` address or `https:` URL the push services can reach us at |
| `WEB_PUSH_HOSTS` | FCM, Mozilla, Apple, WNS hosts | Allowlist of push service hosts a subscription endpoint may point at (`*.x` matches subdomains) |
| `LIVE_TRACKING` | `false` | "Your rider is N stops away" on the shop's order page, and the rider route view on the panel |
| `FAVOURITES` | `false` | Hearts on boxes and the Favourites list on Account |
| `SHOP_INSTALL` | `false` | The shop's service worker (static app shell only), web manifest and "Install app" card |
| `SHOP_SORT_FILTER` | `false` | Sort and filter controls on the shop's home page |

Make a key pair with `node scripts/vapid-keys.mjs` (run in `mango-api/`). It
prints `VAPID_PUBLIC_KEY=` and `VAPID_PRIVATE_KEY=` lines; keep the private
key in the secret store, never in the repo.

In production, preflight refuses to start when `WEB_PUSH=true` and the provider
is not `vapid`, a key is missing or unusable, or the subject is not a `mailto:`
or `https:` value (`src/push-checks.js`). `WEB_PUSH_PROVIDER=vapid` without all
three VAPID values stops the process in any environment.

The shop and panel read the switches from the API, so there is no front-end
build flag: the shop from `GET /v1/policy` → `features`
(`installApp`, `push`, `tracking`, `favourites`, `sortFilter`; `push` is true
only when push can actually be used), with the VAPID public key from
`GET /v1/me/push`; the panel from `GET /admin/v1/auth/me` →
`features.riderRoute` (= `LIVE_TRACKING`).

### For the local launcher (`scripts/start-local.mjs`)

To show all of this in the local demo, the launcher should set on the API:

```
WEB_PUSH=true
WEB_PUSH_PROVIDER=log
VAPID_PUBLIC_KEY=<from node scripts/vapid-keys.mjs>
VAPID_PRIVATE_KEY=<from node scripts/vapid-keys.mjs>
VAPID_SUBJECT=mailto:ops@mandimangoes.test
LIVE_TRACKING=true
FAVOURITES=true
SHOP_INSTALL=true
SHOP_SORT_FILTER=true
```

With `WEB_PUSH_PROVIDER=log` nothing leaves the machine; a browser still needs
real keys to subscribe, so generate a pair once and keep it in the local env.
CI does the same for the end-to-end jobs (`.github/workflows/ci.yml`).

### Selling rule

`minutesPerStop` (default 10, 1–120) is a selling rule in `app_config`, edited
on the panel's Planning page as "Minutes per delivery stop". It sets the rough
time on the shop's tracking card.

## Data (migration `036_app_feel.sql`)

Additive only: three new tables, nothing existing is altered.

- `push_subscriptions`: one row per browser that said yes (endpoint, the
  browser's `p256dh` and `auth` keys, failures in a row). Up to 10 per customer.
  A browser belongs to whoever signed in on it last.
- `push_messages`: the push outbox, written in the same transaction as the
  WhatsApp notification for the order step (`notify.js` → `enqueueOrderPush`),
  so a rolled-back step pushes nothing. One row per order update, unique on
  `(event_id, kind)`. Finished rows are pruned after 30 days.
- `customer_favourites`: `(customer_id, sku)`. Up to 50 per customer. A product
  deleted outright takes its hearts with it.
- `customer_id` is `ON DELETE CASCADE` on all three. The only hard delete of a
  customer is the account join (`POST /v1/me/phone/verify`: a Google account
  joining the phone account that already has that number). This release first
  moves the joining account's hearts (up to the cap, the joined account's own
  kept), browsers (newest ten kept) and queued pushes to the joined account;
  the previous release does not know these tables, and the cascade keeps its
  join working on the new schema.

Live tracking needs no schema; it reads the rider's run from `orders`.

## Installable shop (C2)

- `customer-app/public/manifest.webmanifest`: name MandiMangoes, standalone,
  icons 192 and 512 from `design/brand`. The `<link rel="manifest">` is added
  only while `SHOP_INSTALL` is on.
- `customer-app/public/sw.js` caches the static app shell only: `/`, the
  manifest, icons, `/assets/*` and `/brand/*`. Pages are network-first (the
  cached `/` is the offline fallback); static files cache-first. It never
  caches `/v1`, `/admin`, another origin or any non-GET request, so no order,
  address or account data is ever stored by it.
- With `SHOP_INSTALL` off, the shop unregisters the worker and deletes its
  caches, unless the customer turned notifications on, in which case it keeps
  a push-only worker (`/sw.js?shell=off`) that caches nothing.
- The "Install app" card shows only when the browser offers installation
  (`beforeinstallprompt`), never on a search, and "Not now" hides it for
  30 days on that device. It never opens anything by itself.

## Notifications (Web Push)

- Opt-in is only on the Account page ("Order updates in this browser" → Turn on
  notifications). The browser's permission prompt appears only after that tap;
  nothing asks on page load.
- `PUT /v1/me/push/subscription` stores the subscription after checking the
  endpoint is `https:` on an allowlisted host (`WEB_PUSH_HOSTS`) and the keys
  have the right lengths. Turn off notifications → `DELETE`, then the browser
  unsubscribes. Signing out removes this browser's subscription; signing out
  everywhere and account erasure remove all of them.
- Pushed for: order confirmed, replacement confirmed, out for delivery,
  delivered, delivery failed, date moved, cancelled. The payload is fixed text
  per kind plus a link to `/orders/<id>`; no name, address, phone, amount or
  item. An update about an order that has since moved on is skipped, not sent
  late; anything older than a day is dropped.
- It follows the WhatsApp message's holds. A late payment that finds no stock
  (INV-B) holds the "confirmed" push with the WhatsApp confirmation; once stock
  is found only the new confirmation is pushed. A missed delivery that is not
  rescheduled on its own (attempts used up, or the boxes too old for the retry
  day, INV-E) is pushed as "We missed you: MandiMangoes will be in touch about
  your order" (kind `DELIVERY_FAILED_NO_RETRY`) instead of "will be tried
  again".
- The maintenance loop's `push` step sends due messages. A 404 or 410 from the
  push service deletes the subscription at once; 429 and 5xx are retried with
  backoff; other refusals count towards removal after repeated failures.
- `src/webpush.js` implements RFC 8291 (aes128gcm message encryption) and
  RFC 8292 (VAPID ES256 JWT) with `node:crypto`; no new dependency. The sender
  is replaceable (`usePushSender`) so tests never reach a push service.
- Logs show the push service host and the last characters of the endpoint
  only. The data export lists the customer's notification browsers by push
  service host only.

## Rider N stops away (C3 + S2)

- No GPS. Stops are counted along the same route order the rider's manifest
  uses (`ROUTE_ORDER` in `src/route.js`: slot, zone, pincode, order number).
  "Stops ahead" = the rider's other orders still out for delivery that day,
  earlier in that order, counted once per address; the customer's own address
  never counts.
- The order detail gets `tracking: { stopsAway, minutesPerStop, etaMinutes }`
  only while the order is out for delivery with a rider. The customer sees a
  count and a rough time for their own order, never which orders or where.
- The shop's order page shows the status timeline and a "Where's my rider?"
  card: "Your rider is N stops away" or "You're the rider's next stop", with
  the time rounded to 5 minutes.
- Panel, Deliveries, signed in as RIDER with the switch on: a route view of
  today's stops in the same order, Start route (takes the packed run out for
  delivery), the current stop with Call and Map, and large Delivered and Next
  stop buttons fixed to the bottom of the screen on a phone (up to 640px wide;
  the route leaves room under its list so the last stop is never hidden).
  Delivered opens the existing proof dialog, so the delivery-proof rules are
  unchanged. Next stop moves on in the page (the skipped stop comes round
  again); the put-off stops are kept in that tab's `sessionStorage` for the
  day (order ids only), so a reload keeps them. It changes nothing on the
  server, so the customer's "N stops away" still counts in route order. The
  full list stays one tap away.

## Sort and filter (C6)

Home page controls: sort by featured, price (low first / high first), rating,
name; filter by variety, ripeness in stock, in stock only. The state lives in
the address (`sort`, `variety`, `ripe`, `stock=1`) next to `?q=`, so a reload,
a shared link and Back keep it. Boxes with no rating sort last. A status line
announces the count, and Clear filters resets the view.

## Favourites (C7)

- A heart (a toggle button with `aria-pressed`) on each tile and on the
  product page.
- Guests: kept on the device (`localStorage`, up to 50). Signed in: kept on the
  server; the device's hearts are merged in on sign-in and leave the device
  once the API has them (after a failed merge they stay and go next visit).
  The account's list is read only after the merge has landed (or failed), so
  a read from before the merge never hides the merged hearts.
- Account → Favourites: one tap adds one box of a ripeness in stock to the
  cart; a sold-out favourite offers the existing back-in-stock alert.
- Routes: `GET /v1/me/favourites`, `PUT`/`DELETE /v1/me/favourites/:sku`,
  `POST /v1/me/favourites/merge`. Included in the data export; removed on
  erasure.

## Rollback

Turn the switch off. Push: messages stop being queued and sent; existing
subscriptions stay until a later sign-out or erasure (or can be deleted).
Install: the next visit removes the worker and its caches. The tables can stay;
the previous release never reads them.

## Tests

- API: `mango-api/test/app-feel.test.js` (RFC 8291 example vector, encryption
  round trip, VAPID token, stubbed sender with calls asserted, 404/410 removal,
  tracking counts, favourites, switches off → 404).
- Shop unit: `customer-app/tests/unit/shop-view.unit.ts`, `sw.unit.ts` (what
  the worker caches and where a notification may link).
- Shop end-to-end: `customer-app/tests/app-feel.spec.ts` (needs the API with the
  switches on, as in CI).
- Panel: `tests/rider-route.spec.ts`.

## Limits

- The ETA is minutes per stop times stops, not a measurement.
- A stop the rider put off with Next stop is not known to the server: the
  customer's count still follows route order until that stop is delivered.
- Push on iOS needs the shop added to the home screen (Safari 16.4+).
- Favourites add one box per tap; the customer picks the ripeness.
