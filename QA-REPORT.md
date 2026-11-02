# QA report: MandiMangoes (API, shop, panel, rider app)

Branch `claude/qa-fix-pass-3443b2`, cut from `claude/rider-app-07905d` with
`origin/claude/mandimangoes-new-shop-and-panel` merged in (commit 75ad868).
Nothing pushed or deployed; the live Vercel demo was not touched.

Severity: **Critical** (money, data loss, security hole, a flow that cannot finish),
**High** (a flow broken for some users, a shipped vulnerability, wrong figures),
**Medium** (wrong behaviour with a workaround, a warning that becomes an error on upgrade),
**Low** (tooling, dead code, cosmetic), **Visual** (off the design tokens, however small).

## Status by pass

| Pass | State | Notes |
|---|---|---|
| Setup: merge | Done | 3 conflicts (demo sign-in switches); both branches' switches kept |
| 1. Build and static | Done | 0 errors, 0 warnings in typecheck, lint, builds; knip and `audit:prod` added |
| 2. API | Done | 1,234 node tests pass; contract walk (8,316 bad-input requests, 100 illegal moves, 11 double sends, hand-worked figures) finds no API defect; upgrade from `main` checked (docs/qa/api-upgrade.md) |
| 3. Shop | Done | Crawl of 27 pages x 5 widths x Chromium and WebKit: no console errors, no sideways scroll; 230 e2e runs (5 widths x 2 browsers) pass |
| 4. Panel | Done | Crawl of 37 screens x 5 roles, 5 widths, light and dark, Chromium and WebKit (720 views): no sideways scroll; new specs for two tabs, refresh, expiry, theme, boot, new version |
| 5. Rider app | Done | 14 e2e pass: login, PIN, today, pickup, five steps, 3 wrong codes, not home, override, offline queue, wake lock, location, reinstall |
| 6. Pixel and visual | Not started | |
| 7. Accessibility and performance | Not started | |
| 8. Cross-app journeys | Not started | |

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

## Questions for the owner (business rules not changed)

- **Language switch.** The brief asks to test it, but the new shop (`customer-app/`) is English only:
  there is no switch, though the API has `SHOP_LANGUAGES` and `PUT /v1/me/language` and the old shop
  had Hindi and Kannada. Building it is new work, not a fix. Should it be built before launch?
- **Gift orders to many people (MULTI_GIFT).** The API has them (`/v1/gifts/*`); the new shop only has
  the single "send as a gift" option at checkout. Same question.
- **Packers on rider routes.** `access.js` gives PACKER every delivery route (pickup, door photos, the
  delivery code, rider location). That is how it is designed ("packers also hand over"), recorded here
  only because the contract walk's access snapshot shows it.

## Not verifiable locally

- Real WhatsApp (Meta Cloud API): `WHATSAPP_PROVIDER=log` writes messages to the outbox log only.
- Real Vercel Blob uploads: photos go to the API as the request body locally.
- The Claude Haiku mango check: `MANGO_CHECK=shadow` with no `ANTHROPIC_API_KEY` locally.
- Razorpay: test-mode pay routes (`/v1/dev`) stand in for the gateway.

## Left open

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

## Process notes

- `scripts/start-local.mjs` runs Postgres from npm (embedded-postgres), so no Docker is needed.
- `pdftotext` (bills) and `gpg` (backups) were installed with Homebrew to run those API tests here.
