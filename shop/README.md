# The shop (`shop/`)

The customer storefront at `mandimangoes.in`: the "glass" design from the owner's
`mango-house` repository (its `dist/` folder, which stays the design source), wired to
mango-api's `/v1` storefront API. It is a static site with no build tool and no packages:
`index.html`, `style.css`, `dock.css`, `catalog.js`, `shelf.js`, `app.js`, `dock.js`, `api.js`,
`sw.js`, `manifest.webmanifest`, `config.js` and `assets/` (GSAP, the fonts and the mango
photos are served from here).

It replaces the Next.js shop in [`customer-app/`](../customer-app/README.md), which stays in
the repo until it is retired (see the checklist at the end).

## The catalogue

The shelf has one card per variety the API sells (`GET /v1/products`, grouped by `variety`).
The words and photos come from the MangoKart catalogue, kept in `catalog.js`: for each of the
15 varieties and the Mixed Box, its region, origin, flavour, story, season, sweetness,
"best for" line, search words and occasions, plus a photo per stage in `assets/mangoes/`
(Unsplash, see [`CREDITS.md`](CREDITS.md)). Prices, boxes and stock always come from the API;
a variety in `catalog.js` that the API does not sell is not shown, and an API variety missing
from `catalog.js` gets a plain card with the design's stage photo. A photo uploaded on the
panel (`photoUrl`) replaces the illustrative one.

`shelf.js` draws the shelf: the ripeness rail, the occasion pills, the sort, the stage dots on
each card, search (with MangoKart's synonyms, e.g. "pickle" → raw Totapuri, "hapus" →
Alphonso), and the product sheet. `app.js` keeps the bag, checkout, orders, pre-orders and
bulk enquiries. The three are classic scripts sharing globals, loaded in that order. Why it
was built this way: [`REBUILD-PLAN.md`](REBUILD-PLAN.md).

Box size is two cards (3 kg / 5 kg, each with its price) instead of a dropdown, so picking a box
is one tap, on the shelf and in the product sheet.

## Pages (`pages.js`)

Checkout (`/checkout`), My orders (`/orders`, `/orders/:id`, and the API's `/order/:id`) and the
profile (`/account`) are full pages, not sheets. They replace the home page in place (History
API, so back and forward work and the links can be reloaded or shared); `vercel.json` and
`scripts/serve-shop.mjs` serve `index.html` for them. app.js's checkout and order flows draw
wherever `view` points: the page, or the form sheet for pre-orders and bulk enquiries.

Checkout has a step bar (Area · Sign in · Delivery · Payment · Done), delivery dates and slots as
cards, the customer's saved addresses (`GET /v1/me/addresses`) as cards, and "Use my current
location": the browser's position, turned into an address and pincode by OpenStreetMap's
Nominatim (allowed in the CSP `connect-src`). The profile shows the name and phone, saved
addresses (remove), favourites, the WhatsApp reminder switch (`PATCH /v1/me`), pre-orders and
sign out, with a Profile / My orders tab bar.

### Deliver to (location.js)

The shop bar starts with a "Deliver to" chip. Its sheet sets the area up front, by current location,
the map (with building search), a saved address or a pincode; the shop then shows that area's stock
and delivery days. First-time visitors get the sheet once, offering their current location. Only the
area is asked here: checkout starts from it (pincode, map pin, saved address, street from the
location) and asks for the flat and building. The profile page sets the customer's name
(`PATCH /v1/me {name}`; on an API without it, the name is kept on the device).

### Delivery map and order tracking

`map-picker.js` adds a map to the checkout's delivery step: Leaflet 1.9.4 (served from
`assets/leaflet/`, BSD-2) with OpenStreetMap tiles. The pin stays in the middle and the customer
moves the map onto their door; the spot becomes an address and pincode through Nominatim
(the pincode switches if it differs). Search finds a building, society or street on Enter or
the Search button only, as Nominatim's usage policy requires (no search-as-you-type, at most one
request a second). A typed or saved address is never overwritten by the map; the map offers its
address instead. The API stores the address as text only, so the pin travels in the text as a
` · Location: lat,lng` suffix (the bill leaves it out): riders and staff see the exact spot, saved addresses bring the pin back,
and the order page reads it to show its map.

`/orders/:id` is the tracking page: a status headline (with the rider's first name and the rough
arrival time from live tracking while out for delivery), a five-step tracker with times from the
order's history, the delivery code, the delivery photo once delivered, the address with its map,
the boxes with their best-by dates, and pay, cancel and WhatsApp help. It refreshes every 30 s
(5 s while awaiting payment) and only redraws when the order changed.

On phones and touch screens the sheets are solid and nothing is blurred behind them, and the
glass skips edge refraction: blur over blur redrawn while a sheet animated in made phones flicker.

### Order numbers and invoices

New orders are numbered with 10 digits and shown as `#7434060801` (mango-api `orders.js`: the
order sequence scrambled by a factor coprime with 9e9, so numbers are unique and gapless underneath
but don't reveal order volume; `restore.js` turns them back into the sequence). Older orders keep
`ORD-1024`. The shop and the panel add the `#`; the panel and chat search accept it.

The invoice is the API's numbered bill (`GET /v1/orders/:id/bill`, PDF; feature switch
`BILLS_ENABLED`). The shop offers "Download invoice" on the payment-success step and on the order
page; managers and operators download it from the order in the panel (Bill card). Since migration
`056_payment_details` the order keeps the Razorpay payment's details (`payment_details`: method,
payment ID, UPI reference number (RRN), masked UPI ID, card network and last four, bank or wallet,
time), the bill prints them under the total, and the order page shows them.

## Theme and type

`theme.js` (in `<head>`, so there is no flash) sets light or dark from the device setting until
the viewer uses the header toggle, then remembers it (`mm-theme`). `theme.css` holds the dark
colours: a warm near-black with a brighter mango yellow (#ffc93c) for accents and buying actions.
The light theme keeps the original mango-house palette (forest green, cream) with no yellow accents.
Headings are Young Serif (a warm, sign-painter serif), text is Figtree; both SIL OFL, served
from `assets/fonts/` (see `assets/fonts.css`).

## Liquid glass (`liquid.js`)

The control layer (header, search, bag, rails, chips, tags and quick add on photos, close
buttons, steppers, sheets, the dock) uses one glass material in `style.css`: a thin bright
tint, heavy blur and saturation, a specular rim, and a light that follows the pointer.
`liquid.js` adds spring physics: controls squash when pressed and wobble back, lean toward a
mouse, and the ripeness pill, the sheet's ripeness lens and the box lens slide like a drop
(stretching with speed, wobbling as they land). The bag button, dock bag bar, toast and
dialogs jiggle when they change. Elements with `data-refract` also bend what is behind their
edges (an SVG displacement map in `backdrop-filter`, Chromium only; elsewhere they keep the
blur). Reduced motion turns the physics off; reduced transparency makes the glass opaque.

To add a variety: add it on the panel's Products page (that is what the shop sells), then add
a row to `ROWS` in `catalog.js` with the same name, and its photos to `assets/mangoes/`.

## How it talks to the API

- `config.js` sets `window.MM_CONFIG = { apiUrl, supportWhatsapp }`. `apiUrl` is mango-api's
  origin; an empty `apiUrl` means this same origin (used by the local shared mode below).
- Calls go cross-origin with `credentials: 'include'` and `X-Session: cookie`: the API keeps
  the refresh token in an HttpOnly cookie, and the access token stays in memory.
- So the API's `CUSTOMER_ORIGIN` must list the shop's origin exactly (scheme, host and port, no
  trailing slash), e.g. `https://mandimangoes.in,https://www.mandimangoes.in` in production and
  `http://localhost:5174` locally. The API also builds its links from the first entry
  (`/preorders/:id` for the Razorpay return, `/order/:id`, `/orders/:id`, `/help/requests/:id`,
  `/account/...`, `/invite/:code`); those paths all serve `index.html`, which reads
  `location.pathname` on load.

## Run it locally

- Everything at once (database, API, panel, rider app and this shop):
  `node scripts/start-local.mjs`, then open http://localhost:5174.
- Only the shop, against an API already running on http://localhost:3000:
  `npm run shop:dev` (= `node scripts/serve-shop.mjs --port 5174`).

`scripts/serve-shop.mjs` is a small server with no dependencies: `--port` (default 5174),
`--host` (default `127.0.0.1`; `0.0.0.0` for the Wi-Fi), correct content types, `no-cache`, and
`index.html` for any path without a file extension (like the Vercel rewrites). With
`--api http://localhost:3000` (what `start-local --phone` and `--wifi` use) it also passes
`/v1/*` to the API with the same method, headers, cookies and body, never `/v1/dev*` (404), and
answers `/config.js` with `apiUrl: ''`, so a phone needs only port 5174.

`npm run shop:test` checks the JavaScript parses (`node --check`).

## Config and build

`config.js` is committed with the local default
(`apiUrl: 'http://localhost:3000', supportWhatsapp: ''`) so the folder runs as it is. The build,
`node shop/build-config.mjs` (`npm run shop:build`; Vercel runs it from this folder), overwrites
it from the environment:

| Variable | Meaning |
|----------|---------|
| `API_URL` | mango-api's origin, e.g. `https://api.mandimangoes.in`: no path, no trailing slash. Required when `VERCEL_ENV=production`, where it must be `https://` and not localhost. Unset elsewhere: `http://localhost:3000` |
| `SUPPORT_WHATSAPP` | the help WhatsApp number, digits only with the country code (`919800000000`). Optional |

A bad value stops the build with a message. After writing `config.js` it runs
`scripts/scan-bundle.mjs` over this folder (secrets, `/v1/dev`, demo accounts, source maps, and
on a production build any localhost address), so none of the shop's files may contain those
literally. Running the build locally changes `config.js`: run `npm run shop:build` with no
variables, or `git checkout shop/config.js`, to put the default back before committing.

## Vercel (`mandi-shop`)

- **Root Directory** `shop`. Everything else comes from `vercel.json`: no framework, no install,
  build `node build-config.mjs`, output `.`. Keep "Include files outside the root directory"
  on (the default): the build imports `../scripts/scan-bundle.mjs`. Node.js version does not
  matter.
- **Environment**: `API_URL` (production `https://api.mandimangoes.in`, preview the API preview
  URL) and `SUPPORT_WHATSAPP`. The old `NEXT_PUBLIC_*` variables do nothing here.
  See [deploy/VERCEL.md](../deploy/VERCEL.md#mandi-shop).
- **Headers** on every path: CSP, `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, HSTS; `Cache-Control: no-cache` on
  `/sw.js` and `/config.js` so a new release and a new API address reach browsers at once.
- **Rewrites** to `/index.html`: `/preorders/:id`, `/order/:id`, `/orders/:id`,
  `/help/requests/:id`, `/account/:path*`, `/invite/:code`. Vercel serves a file that exists
  before it applies rewrites, so `assets/` and the other files are not shadowed.
- The output folder is this folder, so `build-config.mjs` and `vercel.json` are served too
  (nothing secret is in them); `README.md` is kept out by `.vercelignore`.

### The CSP

```
default-src 'self'; script-src 'self' https://checkout.razorpay.com https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:;
connect-src 'self' https://api.mandimangoes.in https://*.razorpay.com https://challenges.cloudflare.com;
frame-src https://*.razorpay.com https://challenges.cloudflare.com; worker-src 'self' blob:;
manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://*.razorpay.com;
frame-ancestors 'none'
```

`'unsafe-inline'` styles because the app sets `style="..."` attributes; `blob:` for the bulk
enquiry download (`URL.createObjectURL`); `data:` images for the dock's SVG filter; Razorpay
Checkout and Turnstile are the only outside scripts, both added on demand. No inline scripts are
allowed, so keep all JavaScript in files.

**`connect-src` names the API origin literally** (`vercel.json` cannot read environment
variables). If `API_URL` is anything other than `https://api.mandimangoes.in`, for example a
preview API on `*.vercel.app`, edit `connect-src` (and keep it in step with `API_URL`), or
every API call is blocked by the browser.

## Retiring `customer-app/` (follow-ups)

`customer-app/` stays until these move to `shop/` or are removed:

- [ ] CI (`.github/workflows/ci.yml`): `npm ci`, audit, lint and the unit step in
      `customer-app`; the "Build the customer app" step (it ran `npm run shop:build`, which now
      builds this folder; point it at `npm --prefix customer-app run build` until retired) and
      `npm run shop:test`; the e2e jobs (Chromium and WebKit) that run `customer-app/tests`.
- [ ] `npm run scan:bundle` scans `customer-app/.next/static`: scan `shop` instead.
- [ ] Root `typecheck` and `lint` run customer-app's.
- [ ] `tests/csp.spec.ts` imports `customer-app/lib/csp`: test `shop/vercel.json`'s CSP instead.
- [ ] Docker: `deploy/shop.Dockerfile`, the `shop` service in `deploy/compose.yml` and
      `reverse_proxy shop:3001` in `deploy/Caddyfile` still build and serve the Next.js shop;
      serve this folder as static files instead (with the same headers and rewrites).
- [ ] `scripts/qa-journey.sh` builds and starts the Next.js shop.
- [ ] Then delete `customer-app/` and its mentions in the docs.
