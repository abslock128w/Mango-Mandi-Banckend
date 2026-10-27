# Load test

The [k6](https://k6.io) scripts in `mango-api/ops/load/` play a peak day against
the API. Run them before the season opens, and after any change to checkout,
payments or stock. **Never against production**: they place orders and send
signed payment webhooks.

## Where to run what

- **Local copy (everything).** `ops/load/start-api.sh` starts the API with the
  production settings (no dev routes, a pool of 5 as on Vercel), with Razorpay, Jio
  SMS and Turnstile replaced by `ops/load/stub-providers.js` (through
  `provider-redirect.js`, so no real provider is ever reached; Sentry is refused).
  ```sh
  node ops/load/stub-providers.js &                       # on :3145
  DATABASE_URL=postgres://.../mango_load PORT=3141 sh ops/load/start-api.sh
  API=http://localhost:3141 STAFF_EMAIL=manager@mandimangoes.test STAFF_PASSWORD=manager123 \
    BOXES=1500 node ops/load/prepare.js                   # stock and slot room for the day
  ```
  Run these from `mango-api/`. The database must be migrated and seeded first: start the API once in development
  against it (`npm run dev`; demo stock and staff logins are on by default there),
  since production settings never seed demo data.
- **Staging.** Only `shop.js` with `CHECKOUT=0` (browsing and the panel), unless a
  staging-only deploy points SMS at a copy of the stub.

## The scenarios

| | Script | What it does | Pass marks |
|---|---|---|---|
| A | `shop.js` | A peak evening: customers browsing (pincode, catalogue, delivery days), checking out and paying (some late or never), and staff on Today, Orders, Pack list and Needs attention. `X` multiplies the planned peak (the 10x spike after a WhatsApp broadcast on a 500-order day); `X=3` is the target. | p95 under 300 ms for browsing, under 800 ms for quote, confirm and webhook; under 0.5% failed requests; no 5xx |
| B | `race.js` | Hundreds of customers try to buy the last boxes of one SKU at the same moment (`MODE=slot`: a slot's last places). | Exactly as many orders as boxes succeed, everyone else gets a 409; no 5xx |
| C | `payments.js` | Razorpay redelivering each payment webhook many times at once, a stale "failed" after it, and double payments (`storm`); payments whose webhook never comes, found by three maintenance runs at once (`delayed`). | One confirmation per order, double payments refunded; webhook p95 under 800 ms; no 5xx |
| D | `ops.js` | A delivery day in the panel on the orders scenario A left: six packers (two grabbing the same order), two managers starting the run together, riders reporting every order. | One packer wins, the other gets a 409 or 400; staff p95 under 800 ms; no 5xx |
| E | `failure.js` | `MODE=pool` far more traffic than connections (start the API with `DB_POOL_MAX=2`); `gateway` Razorpay stops answering; `sms` the SMS gateway is slow; `maintenance` checkouts while three crons run every 2 s. | Only 200s or quick 503 `BUSY` with Retry-After, never a hang or a 500; a hung gateway gives a 502 after 10 s and frees the boxes; browsing not slowed |

Example: `k6 run -e API=http://localhost:3141 -e X=3 ops/load/shop.js`. The top of
each script lists its settings.

## After a run

- `DATABASE_URL=... node ops/load/check.js`: the books balance, nothing is oversold,
  and every order agrees with its stock and its payment. Exits 1 on any problem.
  Read-only, so safe on staging.
- `node ops/load/report.js run.csv` (from `k6 run --out csv=run.csv ...`): a table
  of latency and status per request.
- `bash ops/load/sample.sh <database> <out.csv> <api pid>` while a local run goes:
  database connections and the API's CPU and memory each second. On Neon read the
  console's monitoring instead.

## Fixes the first run led to

- **LOAD-1.** At 30x the peak, payment webhooks that found no free connection
  answered 500 and raised a false "payments could not be matched" alert. They now
  answer the retryable 503 `BUSY` (`src/app.js`; `test/load-fixes.test.js`).
- **LOAD-3.** A request stuck behind a locked row until the database gave up
  answered 500. It now answers 503 `BUSY`, the order untouched. This is why the
  app role's `lock_timeout` is 5 s (RELEASE.md step 7, "Time limits").
