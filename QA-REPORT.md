# QA report: MandiMangoes (API, shop, panel, rider app)

Branch `claude/qa-fix-pass-3443b2`, cut from `claude/rider-app-07905d` with
`origin/claude/mandimangoes-new-shop-and-panel` merged in (commit 75ad868).
Nothing pushed or deployed; the live Vercel demo was not touched.

Severity: **Critical** (money, data loss, security hole, a flow that cannot finish),
**High** (a flow broken for some users, a shipped vulnerability, wrong figures),
**Medium** (wrong behaviour with a workaround, a warning that becomes an error on upgrade),
**Low** (tooling, dead code, cosmetic), **Visual** (off the design tokens, however small).

## Summary

37 defects found and fixed, each in its own commit with a test that failed before and passes after.
No business rule (prices, fees, stock logic, status transitions) was changed.

| App | High | Medium | Low | Visual | Total |
|---|---|---|---|---|---|
| Shop | 1 | 7 | 4 | 3 | 15 |
| Panel | 0 | 3 | 6 | 2 | 11 |
| Rider app | 0 | 1 | 2 | 0 | 3 |
| API | 0 | 1 | 2 | 0 | 3 |
| Shop and rider app together | 1 | 0 | 1 | 3 | 5 |
| **All** | **2** | **12** | **15** | **8** | **37** |

No Critical defect was found. The API's contract walk (every route, role and bad input; every illegal
status move; double sends; hand-worked bills, stock and ripeness; IST midnight and month end; a race for
the last box) found nothing to fix in the API's behaviour; its three defects are robustness and tooling.

## Status by pass

| Pass | State | Notes |
|---|---|---|
| Setup: merge | Done | 3 conflicts (demo sign-in switches); both branches' switches kept |
| 1. Build and static | Done | 0 errors, 0 warnings in typecheck, lint, builds; knip and `audit:prod` added |
| 2. API | Done | 1,234 node tests pass; contract walk (8,316 bad-input requests, 100 illegal moves, 11 double sends, hand-worked figures) finds no API defect; upgrade from `main` checked (docs/qa/api-upgrade.md) |
| 3. Shop | Done | Crawl of 27 pages x 5 widths x Chromium and WebKit: no console errors, no sideways scroll; 230 e2e runs (5 widths x 2 browsers) pass |
| 4. Panel | Done | Crawl of 37 screens x 5 roles, 5 widths, light and dark, Chromium and WebKit (720 views): no sideways scroll; new specs for two tabs, refresh, expiry, theme, boot, new version |
| 5. Rider app | Done | 14 e2e pass: login, PIN, today, pickup, five steps, 3 wrong codes, not home, override, offline queue, wake lock, location, reinstall |
| 6. Pixel and visual | Done | Token audits of all three apps (radii, 4 px grid, disabled styles, focus rings); 44 px targets on touch; screenshot baselines in `docs/qa/screens` (890 shots); visual snapshots: panel 32, shop 60, rider 35 (`PW_VISUAL=1`) |
| 7. Accessibility and performance | Done | axe WCAG 2.1 AA clean on every screen of the shop (21 pages + cart), panel (existing `a11y.spec.ts`) and rider app (11 states). Lighthouse mobile, median: shop home 0.97, listing 0.94, product 0.98; panel 0.99; rider 0.94; accessibility 100 on all |
| 8. Cross-app journeys | Done | `tests/cross-app.spec.ts` via `scripts/qa-journey.sh`: shop order to panel pack to rider pickup and coded delivery to tracking, WhatsApp log, claim and replacement, plus payment failed, stock written off at checkout, cancel after pack, missed delivery retried then RTO: 7 of 7 |

## Defects

| # | Sev | App | Where | What was wrong | Fix | Guard |
|---|---|---|---|---|---|---|
| 1 | Low | Panel | `src/pages/NeedsAttention.tsx` | The rider app's nightly `delivery-photo-purge` step had no label, so a failure showed the raw step name | dae77e8 | `tests/unit/step-labels.unit.ts` (was failing) |
| 2 | Low | Rider | `rider-app/playwright.config.ts` | e2e reused any server on 5175, so with the local stack up the ops-phone test failed | bfe4134 | `e2e/rider.spec.ts` "three wrong codes lock" |
| 3 | Low | Shop, Rider | 13 exports in `lib/`, `components/`, `features/` | Dead code: never used anywhere (one carried a raw colour) | f24073d | `npm run deadcode` (knip), part of `npm run check` |
| 4 | High | Shop, Rider | `package.json` | Shipped deps had 3 (shop) and 6 (rider) high advisories: zod < 4.6.6, glob, minimatch | 77d642b | `npm run audit:prod` |
| 5 | Medium | Shop | `features/*/store.ts` | Zustand stores read Node's `localStorage` global during server rendering (warning on every build; no storage) | 04f219b | `tests/unit/server-storage.test.ts` |
| 6 | Low | Shop | `next.config.ts` | No `turbopack.root`: every build warned it guessed the workspace root | 4b1aa85 | `tests/unit/next-config.test.ts` |
| 7 | Low | Panel | `package.json` | No `"type": "module"`: every unit run printed MODULE_TYPELESS_PACKAGE_JSON warnings | a41d70d | `tests/unit/module-type.unit.ts` |
| 8 | Medium | API | `src/db.js` (callers: `warehouse/reports.js` and ~30 `Promise.all` on one client) | Concurrent queries on one pg client: DeprecationWarning at start, refused by pg 9 | 6caa371 | `test/db-serial.test.js` |
| 9 | Low | API | `src/bulk.js`, `admin/bulk.js`, `bulk-routes.js`, `warehouse/*.js`, `ops-counters.js` | Five dead exports; the shop photo link builder written twice | aa5e1be | `npm run deadcode` (knip) |
| 10 | Low | API ops | `ops/backup.sh` | GNU `timeout` only: on a Mac every backup with an upload failed after writing the local file | 285f311 | `test/backup.test.js` (23/23 on macOS, was 21) |
| 11 | High | Shop | `features/catalog/hooks/queries.ts` and home, listing, product, search | A failed catalogue (or delivery-day) request showed loading skeletons for ever, no message, no retry | 6256864 | `e2e/states.spec.ts` |
| 12 | Medium | Shop | `features/catalog/components/listing.tsx`, `filters.ts` | Filters and sort were React state only: lost on refresh, Back left the page, no shareable link | b63cdea | `e2e/listing.spec.ts`, `tests/unit/filters.test.ts` |
| 13 | Medium | Shop | `features/shell/offline-notice.tsx` (new) | No offline handling at all: stale pages, broken image icons, silent failures | f5456e5 | `e2e/offline.spec.ts` |
| 14 | Medium | Shop | `features/checkout/payment.ts`, `dev-pay.tsx` | "Fail payment (test)" (also the demo's DEMO_PAYMENTS) spun 10 s, then left the page with no word; the customer could not retry in place | c28beae | `e2e/flows.spec.ts` checkout |
| 15 | Low | Shop | 11 places, `features/orders/components/sign-in-prompt.tsx` | "Log in", "Login to proceed" and "Sign in" mixed; the orders sign-in prompt had no heading and a different look | 5ab7330 | `tests/unit/copy.test.ts`, `e2e/flows.spec.ts` account |
| 16 | Medium | Panel | `src/api.ts`, `App.tsx`, `pages/Login.tsx` | Signing out in one tab left other tabs signed in (access token valid up to 15 min): a shared warehouse computer stayed open | 1abd7fc | `tests/sessions.spec.ts` |
| 17 | Medium | Panel | `src/api.ts` `bootstrap()`, `App.tsx` | A 429/503 or no connection while restoring the session showed the sign-in form to a signed-in person | 1382123 | `tests/boot.spec.ts` |
| 18 | Low | Panel | `src/ui.tsx` ErrorBoundary | After a deploy, open tabs showed "This screen hit a problem" and reported a crash to Sentry; now "A newer version is ready, Reload" | 1efc320 | `tests/new-version.spec.ts` |
| 19 | Medium | Panel (Safari) | `src/ui.tsx` Dialog | Closing any dialog dropped focus on `<body>`/`<main>` in Safari (buttons are not focused by a click there) | db4d7b3 | `tests/screens.spec.ts`, `tests/reviews.spec.ts` in WebKit |
| 20 | Low | Panel | `src/pages/Deliveries.tsx` | A rider's empty day asked for days riders may not open (403s) and claimed "Nothing in the next 3 days" | e0c6987 | `tests/rider-lookahead.spec.ts` |
| 21 | Medium | Rider | `rider-app/lib/run-context.tsx` | After calling ops about a locked code, the run took up to 30 s to show the manager's override | 0b3283f | `e2e/run.spec.ts` |
| 22 | Visual | Shop | footer, header, chips, breadcrumbs, card name, box toggle, summary, location button, carousel dots | Controls under the 44 px minimum (16 to 40 px); 2 and 3 px radii off the scale | 41f5966 | `e2e/tap-targets.spec.ts` |
| 23 | Visual | Shop | `product-card.tsx` | At 360 px "3 kg box" under the price wrapped to two lines beside ADD | ad9c641 | `e2e/tap-targets.spec.ts` (one line) |
| 24 | Low | Shop | `logo.tsx`, `product-detail.tsx`, `search-view.tsx` | Next.js image warnings on every page: the logo drawn a fraction off its size; the largest image loaded lazily | 8318018 | `e2e/console.spec.ts` |
| 25 | Visual | Panel | `styles/components.css`, `shell.css`, `Reviews.tsx` | On touch screens: order numbers, cell links, the All filter, review checkboxes and the skip link under 44 px | 85ebc98 | `tests/touch-targets.spec.ts` |
| 26 | Visual | Panel | `src/styles/*.css` | 30 raw radii (8 px and 1 to 3 px off the scale) and 42 spacings off the 4 px grid | 14c7b10 | `tests/unit/css-tokens.unit.ts` |
| 27 | Visual | Shop, Rider | 36 files | 98 Tailwind half steps (6, 10, 14 px) off the 4 px grid | d6d797c | `tests/unit/spacing.test.ts` |
| 28 | Visual | Shop, Rider | 5 shop controls, `rider-app/components/ui.tsx` | Disabled controls faded with opacity instead of the disabled tokens (rider primary read as live) | a355952 | `tests/unit/copy.test.ts` |
| 29 | Medium | Shop | `orders/components/success-view.tsx` | Success page spun "Confirming your payment" for ever: for a missing order (404) and after its 30 s wait | 776cdf8 | `e2e/states.spec.ts` |
| 30 | Visual | Shop | `home/components/product-rail.tsx` | Rail headings ran 4 px from "see all" at 360 px (no gap) | 2ca2e73 | `e2e/tap-targets.spec.ts` |
| 31 | Visual | Shop, Rider | `app/globals.css` | Focus ring without the light halo the panel has: lost on teal buttons and photos | fb6a604 | `tests/unit/next-config.test.ts` |
| 32 | Medium | Shop | `product-detail.tsx` | Sweetness and star ratings named with aria-label on a plain span (not allowed; screen readers could skip them) | 2e8aa0a | `e2e/a11y.spec.ts` |
| 33 | Low | Panel | `src/App.tsx` | The new "Can't reach" screen (defect 17's fix) put role=alert on `<main>` (ARIA, Lighthouse 0.99) | f806692, 8395143 | `tests/boot.spec.ts` (axe with best practice) |
| 34 | Medium | Shop | `product-page.tsx`, `lib/varieties.ts` | Product page photo waited for the catalogue API: LCP 4.6 s, Lighthouse 0.78 | 889f877 | `e2e/states.spec.ts` |
| 35 | Low | Rider | `.gitignore`, `eslint.config.mjs`, `tsconfig.json`, `e2e/a11y.spec.ts` | Separate build folders rewrote tsconfig and filled the lint; an unused import (from this QA) | fc57049 | `npm run lint` |
| 36 | Low | Shop | `checkout-view.tsx` | Stock running short at Pay showed (and announced) the same error twice | 9c6917c | `tests/cross-app.spec.ts` |
| 37 | Low | Panel | `src/App.tsx` | "You are still signed in" shown to people who never signed in | 6d989dd | `tests/boot.spec.ts` |

## Final run (2 Nov 2026, on the last commit's code)

| Check | Result |
|---|---|
| Typecheck (panel, tests, shop, rider), lint (all four apps), knip (shop, rider, API) | Pass, 0 warnings |
| Builds (panel, shop, rider) and bundle scan | Pass, 0 warnings |
| `npm audit --omit=dev` (shop, rider) | 0 vulnerabilities |
| API node tests (`npm test`, 1,275 incl. the contract walk) | 1,273 pass, 1 skipped; the one failure (a retry-timing assertion, 229acce) passes 6 of 6 after its fix |
| Panel unit tests | 39 pass |
| Shop unit tests (vitest) | 15 pass |
| Panel e2e (Chromium, 390 and 1280 px) | 557 pass; 3 timed out under load and pass alone |
| Shop e2e (360 and 1280 px; the matrix of 5 widths x 2 browsers ran earlier) | 78 pass; 1 timing-sensitive test hardened (929c74c), 8 of 8 since |
| Rider e2e | 15 pass |
| Cross-app journeys (`scripts/qa-journey.sh`) | 7 of 7 |
| Lighthouse mobile (median) | Shop 0.97 / 0.94 / 0.98, panel 0.99, rider 0.94; accessibility 100 everywhere |

Nothing was pushed or deployed.

## Questions for the owner (business rules not changed)

- **Language switch.** The brief asks to test it, but the new shop (`customer-app/`) is English only:
  there is no switch, though the API has `SHOP_LANGUAGES` and `PUT /v1/me/language` and the old shop
  had Hindi and Kannada. Building it is new work, not a fix. Should it be built before launch?
- **Gift orders to many people (MULTI_GIFT).** The API has them (`/v1/gifts/*`); the new shop only has
  the single "send as a gift" option at checkout. Same question.
- **Focus ring width.** `design/COMPONENTS.md` says a 3 px ring; the panel (and now the shop) draw
  2 px with a 2 px halo, the rider app 3 px. Which is right? The doc or the code should change.
- **Packers on rider routes.** `access.js` gives PACKER every delivery route (pickup, door photos, the
  delivery code, rider location). That is how it is designed ("packers also hand over"), recorded here
  only because the contract walk's access snapshot shows it.

## Not verifiable locally

- Real WhatsApp (Meta Cloud API): `WHATSAPP_PROVIDER=log` writes messages to the outbox log only.
- Real Vercel Blob uploads: photos go to the API as the request body locally.
- The Claude Haiku mango check: `MANGO_CHECK=shadow` with no `ANTHROPIC_API_KEY` locally.
- Razorpay: test-mode pay routes (`/v1/dev`) stand in for the gateway.

## Left open

- **Shop LCP budget on a first visit.** `customer-app/lighthouserc.cjs` also asserts LCP of 2.5 s or
  less. Home (2.6 s) and the listing (3.0 s) miss it on a first visit because the "Where should we
  deliver?" sheet opens after the app loads and its heading becomes the largest paint. The brief's
  targets (performance 90+, accessibility 100) are met; changing when the sheet opens is a product call.
- **Carousel dots** are 24 x 44 px, not 44 x 44 (44 px wide dots would spread the pager across a third
  of a phone; slides also swipe; WCAG 2.5.8 AA is 24 px). Recorded in `e2e/tap-targets.spec.ts`.
- **Shop and rider dark mode**: neither app has a dark theme (light only, by design), so there are no
  dark baselines for them.

- Dev-only `npm audit` advisories (Lighthouse CI's puppeteer/zod 3, ESLint's minimatch): the only fix
  is a breaking downgrade of `@lhci/cli`; none of it ships.

## Test environment notes

- WebKit on macOS does not move focus to buttons and links with Tab unless the system setting
  "Keyboard navigation" is on (Safari's default). Five panel keyboard tests (`a11y.spec.ts` Tab order,
  Skip link, the phone Menu) fail in WebKit here for that reason only; they pass in Chromium and in
  CI's Linux WebKit, which tabs to everything.
- The local stack must run with `API_RATE_LIMIT` raised for QA runs (`API_RATE_LIMIT=1000000 node
  scripts/start-local.mjs`): the crawls and the e2e matrix send more than the production 3,000 requests
  per 15 minutes from one address.

- The shop's dev server does not pick up a new Tailwind `@utility` until it restarts (seen when adding
  `tap`); builds are unaffected.
- Under heavy parallel load a few panel specs time out (Ctrl+K palette, stocktake, 375 px fit); each
  passes alone and in the normal run.
- Visual snapshots are platform-specific: the committed baselines are macOS's (`PW_VISUAL=1`).

## Process notes

- `scripts/start-local.mjs` runs Postgres from npm (embedded-postgres), so no Docker is needed.
- `pdftotext` (bills) and `gpg` (backups) were installed with Homebrew to run those API tests here.
