# MandiMangoes shop

The customer shop for MandiMangoes: a responsive Next.js storefront on top of mango-api's
`/v1` storefront API ([`../mango-api`](../mango-api/README.md)). Phones first at 360 px,
laptops up to a 1200 px content column, in the Orchard colours (`styles/theme.css`).

Shoppers pick a pincode and a delivery day, then a variety, a box and a ripeness
(Ripe, Semi-ripe or Raw). Stock, prices, delivery days, slots, promo codes and totals all
come from the API; the shop never works out a price on its own.

## Run it

The easiest way is the whole stack from the repo root (database, API, panel and this shop):

```bash
node scripts/start-local.mjs
```

The shop opens on http://localhost:5174. Sign in with any Indian mobile number; in
development the API returns the code and the sign-in screen shows it. Without Razorpay keys
the checkout shows test pay buttons (`next dev` only).

On its own, against an API you already run:

```bash
npm ci
```

```bash
NEXT_PUBLIC_API_URL=http://localhost:3000 npm run dev -- --port 5174
```

The API only accepts the shop from origins in its `CUSTOMER_ORIGIN` (start-local sets
`http://localhost:5174`).

## Settings

| Variable | What it does |
|----------|--------------|
| `NEXT_PUBLIC_API_URL` | mango-api's address. Empty means "this same origin" (start-local `--phone` passes `/v1` through `SHOP_API_PROXY`). |
| `NEXT_PUBLIC_SUPPORT_WHATSAPP` | The help WhatsApp number, digits only. A production build fails without it. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Optional. Google Maps in the location picker; OpenStreetMap without it. |
| `NEXT_OUTPUT=standalone` | Builds the self-contained server used by `deploy/shop.Dockerfile`. |

## How it fits the API

- **Catalogue.** `GET /v1/catalogue?pincode&delivery_date` returns one row per SKU and stage.
  `lib/catalog.ts` groups rows by variety into products with one line per box and stage.
  Before a pincode is chosen the shop shows `GET /v1/products` prices without stock.
- **Money** arrives in paise and is turned into rupees once, in `lib/api/client.ts` (`toRupees`).
  Prices include GST; delivery is free; payment is prepaid only.
- **Sign-in.** Phone OTP or Google. The access token lives in memory; the refresh token is an
  httpOnly cookie the API sets (`X-Session: cookie`).
- **Checkout.** The local cart is copied to the server cart, then quote (with an optional promo
  code), confirm with an `Idempotency-Key`, and Razorpay checkout. One unpaid order at a time.
- **Orders.** Track, cancel before packing, move the delivery day, show the delivery code, report
  a problem for a replacement within the claim window.
- **Pre-orders** book a week of the coming season; **bulk deals** go into the cart at tier prices.

## Security

`proxy.ts` sends a Content-Security-Policy with a fresh nonce on every page
(`lib/csp.ts`, checked against `../scripts/csp.ts` by `../tests/csp.spec.ts`). The production
bundle is scanned for secrets, dev routes and demo accounts (`../scripts/scan-bundle.mjs`).

## Checks

```bash
npm run lint && npm run typecheck && npm test
```

```bash
npx playwright test
```

The Playwright journey runs against a real API on http://localhost:3000 (start-local, or the CI
e2e job), at 360 px and 1280 px.

Photo credits are in [CREDITS.md](CREDITS.md).
