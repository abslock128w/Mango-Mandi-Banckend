# VMR Mangoes Rider

The riders' phone app: today's run, a photo of each sealed box at the warehouse,
two photos at the door with a mango check, then the customer's 4-digit code.
A Next.js 16 PWA (React 19, Tailwind v4, Serwist) over mango-api's staff API
(`/admin/v1`, role RIDER). The API contract is in [../PLAN.md](../PLAN.md).

It wears the shop's brand (`styles/theme.css`): deep green `#174631` for actions and ink accents,
mango yellow `#ffc93c` / `#ffb627` with dark ink for the key confirmations (Mark picked up, Confirm
code), a cream canvas and paper cards, and the shop's Young Serif for screen titles and numbers
(self-hosted from `styles/fonts`, lining figures on) with Inter for text. Light only: riders work
outdoors in sun. Every text pairing is 4.5:1 or better, every target at least 48 px, focus rings
are a green ring with a paper halo, and all motion (step unlock, status chips, the delivered tick,
the run summary) is short and switched off under reduced motion. The icons are the shop's logo
(`public/icons`, copied from `shop/assets`, with a maskable pair).

## Run it

```bash
npm install
npm run dev          # http://localhost:5175, API at NEXT_PUBLIC_API_URL
```

`node scripts/start-local.mjs` from the repo root starts this app on 5175 with the API on
http://localhost:3000 (it sets the API's `RIDER_ORIGIN` to http://localhost:5175). On a demo deploy without WhatsApp or SMS yet, set `DEMO_OTP=123456` (any 6 digits) on the API:
every sign-in takes that code and the screen shows it. Run on its own,
set `RIDER_ORIGIN` on the API to this app's address. Riders are added by a
manager on the panel (Staff → Add person, role Rider, with their mobile number); the sign-in code
shows on screen in development.

| Variable | Default | What it is |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3000` | mango-api base URL (no `/admin/v1`) |
| `NEXT_PUBLIC_OPS_PHONE` | `+910000000000` | The ops desk, for every "Call ops" button |

Scripts: `dev`, `build`, `start` (port 5175), `lint`, `typecheck`, `e2e` (Playwright),
`lhci` (Lighthouse CI on the production build), `check` (lint, knip and typecheck).

## Screens

1. **Sign in**: mobile number, the 6-digit code (WhatsApp, SMS fallback), then a 4-digit PIN on an
   on-screen pad with large keys. When the API returns the code (a demo deploy with `DEMO_OTP`), a
   "Demo mode" note shows it on screen.
   The phone is bound: a random device id is kept in IndexedDB and the API ties the PIN
   and refresh token to it. Later starts open straight to the PIN. A manager can revoke
   the device from Staff; five wrong PINs do the same (sign in with a code again).
2. **Today**: date, slot, "N of M stops done" with a progress bar, the current stop as a hero
   card (stop number and order number, first name, address, boxes and contents, Navigate to Google
   Maps or to the warehouse before the pickup, Call, then Pick up or At the door), a "Still to
   collect" entry naming the warehouse while boxes wait there, and the other stops in order with
   status chips.
3. **Pickup** (`/pickup?id=`): the warehouse with directions, photo of the sealed box inside a
   viewfinder, Retake, Mark picked up. The answer lists the two WhatsApp messages (out for
   delivery, delivery code) and their status.
4. **Stop** (`/stop?id=`): a vertical stepper of five cards that unlock in order (a locked card
   says what opens it): box at the door, open box
   (with a framing guide), the mango check (pass; retake with the model's reason; after
   two failures, continue for review), the customer's code in four big boxes (3 tries, then
   locked with Call ops), delivered. Customer not home (reason, optional photo), Reschedule (ops
   does it) and Call ops sit in a row at the bottom.
5. **Run complete** (`/done`): delivered, missed, time from the first pickup, and a "Done for
   today" sign-off (with the boxes to take back when some were missed).

Order numbers always go through `orderNo()` (`lib/format.ts`): S743406080 reads S-743 406 080.

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

`e2e/screens.spec.ts` checks the structure of each screen (progress, the hero, the stepper's
locked and open states, formatted order numbers, target sizes), runs axe on each, and saves a
screenshot of each at 390 × 844 to `test-results/shots/` (gitignored) for review.
`e2e/a11y.spec.ts` runs axe on every state; `e2e/visual.spec.ts` compares snapshots (`PW_VISUAL=1`).

`e2e/rider.spec.ts` runs at 390 × 844 against a stateful mock of the API (`e2e/mock-api.ts`):
sign-in with OTP and PIN, pickup with a fixture photo, a passing check, a failing check and a
retake, continue for review, a wrong code twice then the right one, three wrong codes lock,
offline photos that upload after reconnecting, and a missed delivery.

Lighthouse: `npm run build && npm run lhci`. If Playwright only has its headless shell,
point `CHROME_PATH` at it (`~/Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell`).
Budgets: performance ≥ 0.9 and accessibility ≥ 0.95 on the sign-in page (mobile, simulated 4G).
Last run (25 Nov 2026, Next 16.4.6, production build, 3 runs): performance 0.99 to 1.0,
accessibility 1.0, best practices 1.0, largest contentful paint 1.7 to 2.0 s. The start screen's
first paint (while the phone reads its session) carries the largest text, so sign-in or the PIN
replacing it is not a later, larger paint.
SEO is low on purpose: the app is marked noindex.
