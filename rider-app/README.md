# MandiMangoes Rider

The riders' phone app: today's run, a photo of each sealed box at the warehouse,
two photos at the door with a mango check, then the customer's 4-digit code.
A Next.js 16 PWA (React 19, Tailwind v4, Serwist) over mango-api's staff API
(`/admin/v1`, role RIDER). The API contract is in [../PLAN.md](../PLAN.md).

## Run it

```bash
npm install
npm run dev          # http://localhost:5175, API at NEXT_PUBLIC_API_URL
```

`node scripts/start-local.mjs` from the repo root starts this app on 5175 with the API on
http://localhost:3000 (it sets the API's `RIDER_ORIGIN` to http://localhost:5175). Run on its own,
set `RIDER_ORIGIN` on the API to this app's address. Demo riders: 9000000001 (Ravi) and
9000000002 (Suresh); the sign-in code shows on screen in development.

| Variable | Default | What it is |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3000` | mango-api base URL (no `/admin/v1`) |
| `NEXT_PUBLIC_OPS_PHONE` | `+910000000000` | The ops desk, for every "Call ops" button |

Scripts: `dev`, `build`, `start` (port 5175), `lint`, `typecheck`, `e2e` (Playwright),
`lhci` (Lighthouse CI on the production build), `check` (lint and typecheck).

## Screens

1. **Sign in**: mobile number, the 6-digit code (WhatsApp, SMS fallback), then a 4-digit PIN.
   The phone is bound: a random device id is kept in IndexedDB and the API ties the PIN
   and refresh token to it. Later starts open straight to the PIN. A manager can revoke
   the device from Staff; five wrong PINs do the same (sign in with a code again).
2. **Today**: date, slot, stops done of total, a sticky card for the current stop
   (first name, address, boxes and contents, Navigate to Google Maps, Call), the other
   stops folded with status chips.
3. **Pickup** (`/pickup?id=`): photo of the sealed box, Retake, Mark picked up. The answer
   lists the two WhatsApp messages (out for delivery, delivery code) and their status.
4. **Stop** (`/stop?id=`): five steps that unlock in order: box at the door, open box
   (with a framing guide), the mango check (pass; retake with the model's reason; after
   two failures, continue for review), the customer's code (3 tries, then locked with
   Call ops), delivered. Customer not home (reason, optional photo), Reschedule (ops does
   it) and Call ops are below.
5. **Run complete** (`/done`): delivered, missed, time from the first pickup.

Pages are static (the stop comes from `?id=`), so the service worker precaches all of
them and the app opens with no signal.

## Offline: the queue

Every action is a job in IndexedDB (Dexie, `lib/queue.ts`): photos (with the image), pickups,
checks, codes and missed deliveries. Each job has a client-generated id that the API uses
for idempotency, so a retry after a lost answer is never applied twice. The queue drains on
`online`, when the app comes back to the front, and every 15 s. Jobs for one order go in the
order they were made; a check waits for its photo to upload. "N pending uploads" shows while
anything is waiting.

The screen moves on as soon as a photo is taken (the preview comes from IndexedDB), but the
code step only opens once the server has the door photo and a passing (or for-review) mango
check: those need the server.

Photos are compressed in a web worker (browser-image-compression, at most 1280 px and
0.4 MB, JPEG). The worker loads the library from `/vendor/browser-image-compression.js`
(precached), not from a CDN. GPS (high accuracy, 8 s timeout) and the time are taken at
the shutter and sent with the photo. Uploads use a Vercel Blob client token when the API
offers one (`mode: "blob"`), else the photo goes to the API as the request body.

While a stop is out for delivery the screen is kept on (Screen Wake Lock, asked for again
when the app returns to the front) and the position goes to ops every 20 s or after 50 m.

## Tests

```bash
npx playwright install chromium   # once
npm run e2e
```

`e2e/rider.spec.ts` runs at 390 × 844 against a stateful mock of the API (`e2e/mock-api.ts`):
sign-in with OTP and PIN, pickup with a fixture photo, a passing check, a failing check and a
retake, continue for review, a wrong code twice then the right one, three wrong codes lock,
offline photos that upload after reconnecting, and a missed delivery.

Lighthouse: `npm run build && npm run lhci`. If Playwright only has its headless shell,
point `CHROME_PATH` at it (`~/Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell`).
Budgets: performance ≥ 0.9 and accessibility ≥ 0.95 on the sign-in page (mobile, simulated 4G).
Last run (30 Oct 2026, production build, 3 runs): performance 0.92 to 0.97, accessibility 1.0,
best practices 1.0. Largest contentful paint is about 2.5 to 2.6 s, so its 2.5 s check only warns.
SEO is low on purpose: the app is marked noindex.
