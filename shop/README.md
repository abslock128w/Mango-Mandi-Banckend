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
