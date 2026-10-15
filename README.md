# Mango Ops — Admin Web App

A static single-page admin tool for warehouse and operations staff. It replaces the
Postman-based admin workflow with buttons that only ever offer valid actions, so staff
can run the shop without a developer and without risking an oversell. VMR does not refund: a
problem with a delivered order is settled by sending a replacement.

Built against the spec in [`../vmr_mangoes_admin.md`](../vmr_mangoes_admin.md). The
customer-facing API and its rules live in [`../vmr_mangoes.md`](../vmr_mangoes.md).

## What it does

| Screen | Route | Requirements |
|--------|-------|--------------|
| Login | `/login` | AUTH-1 to AUTH-5 |
| Today | `/today` | DASH-1 to DASH-5 |
| Batches | `/batches` | BAT-1 to BAT-4 |
| Batch detail | `/batches/:id` | BD-1 to BD-8 |
| Orders | `/orders` | ORD-1 to ORD-3 |
| Order detail | `/orders/:id` | OD-1 to OD-9 |
| Pack list | `/pack-list` | PACK-1 to PACK-4 |
| Claims | `/claims` | CLM-1 to CLM-5 |
| Pincodes | `/pincodes` | PIN-1 to PIN-3 |

**Thin client.** The UI never computes stock or money. Every total and availability
figure is formatted straight from the API; the backend stays the single authority.

## Stack

- **Vite + React + TypeScript** — static output, typed API responses
- **React Router** — one URL per screen; filters live in the query string so views are bookmarkable
- **TanStack Query** — per-screen caching, refetch after every write, refetch on tab focus
- **Plain CSS** — colour tokens, light/dark themes and print rules in one file (`src/styles.css`)
- **Playwright** — end-to-end tests at phone (390px) and desktop (1280px) widths

## Project layout

```
src/
  api.ts            HTTP client, silent token refresh, every admin call
  types.ts          DTO shapes and status enums mirroring the API
  format.ts         rupee + IST date formatting, status display labels
  permissions.ts    operator vs manager split
  session.tsx       signed-in user context
  ui.tsx            Badge, Dialog, Toast, Spinner, EmptyState, QueryError, ErrorBoundary
  styles.css        tokens, components, dark mode, print
  App.tsx           router, auth guard, session restore, sign-out listener
  Layout.tsx        nav + per-screen error boundary
  main.tsx          React + Query + Toast providers
  pages/            one file per screen
tests/
  fixtures.ts       console-error-failing fixture
  mock-api.ts       in-memory /admin/v1 stand-in for backend-free specs
  smoke.spec.ts     backend-free: auth guard, login, session restore, banners
  screens.spec.ts   backend-free: every screen and its actions, no horizontal scroll
  a11y.spec.ts      backend-free: axe WCAG 2 A/AA on login and every screen
  day-in-the-life.spec.ts   §10 acceptance script (needs backend)
```

## Running it

```bash
cp .env.example .env          # set VITE_API_URL to the API address
npm install
npm run dev                   # http://localhost:5173
```

The API must allow this origin via its `ADMIN_ORIGIN` setting (default
`http://localhost:5173`).

### Build for production

```bash
npm run build                 # tsc --noEmit, then vite build → dist/
npm run preview               # serve the built dist/ locally
```

`dist/` is static files any host can serve. Set the API's `ADMIN_ORIGIN` to the host
you deploy to.

## Tests

```bash
npm run typecheck             # tsc --noEmit
npx playwright install chromium   # once, if not already present
npm run test:e2e              # all specs at both viewports

# Just the backend-free gate (smoke + screens + accessibility):
npx playwright test tests/smoke.spec.ts tests/screens.spec.ts tests/a11y.spec.ts

# Using an already-installed Chromium instead of Playwright's download:
PW_CHROMIUM_PATH=/path/to/chrome npm run test:e2e

# Full day-in-the-life script (needs a seeded backend + admin credentials):
E2E_EMAIL=ops@example.com E2E_PASSWORD=... npm run test:e2e
```

- **Smoke** (`tests/smoke.spec.ts`) — auth guard, session-ended banner, offline
  banner, config banner. Runs without a backend.
- **Screens** (`tests/screens.spec.ts`) — every screen and its main actions against
  the mocked API in `tests/mock-api.ts`, including the exact request bodies, that no
  refund action appears anywhere, and the manager-only gates. Runs without a backend.
- **Accessibility** (`tests/a11y.spec.ts`) — axe-core WCAG 2 A/AA scan of the login
  screens and every signed-in screen, plus keyboard-operability checks. Runs without a backend.
- **Day-in-the-life** (`tests/day-in-the-life.spec.ts`) — the full §10 acceptance
  flow; skips unless `E2E_EMAIL`/`E2E_PASSWORD` are set and the backend is reachable.

Both viewports (390px phone, 1280px desktop) run on every spec, and a shared fixture
fails any test that logs a console error.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every PR: `npm ci`,
typecheck (app and tests), production build, then the smoke, screens and accessibility
specs on Chromium. The
Playwright report is uploaded as an artifact on failure.

## Resilience

- An **offline banner** appears while the browser is offline and clears when the
  connection returns, so staff know why actions are failing.
- A **config banner** warns when `VITE_API_URL` is unset.
- Every failed query shows a **Retry** button; a render error is caught by an
  **error boundary** that keeps the nav and offers a reload.

## Session and security notes

- The **access token** lives in memory only — never in storage, never logged.
- The **refresh token** is an **httpOnly cookie** set by the backend (v2 / Q4). JS
  cannot read it, so on every page load the app attempts one silent refresh
  (`api.bootstrap`) to restore the session; a returning user is logged straight in,
  and a failed refresh lands them on `/login?reason=expired` with a "session has
  ended" banner. All requests send credentials, so the API must allow them
  (`Access-Control-Allow-Credentials: true` + exact `ADMIN_ORIGIN`).
- On any 401 the client refreshes once and retries once; concurrent 401s share a
  single refresh call. A failed refresh signs the user out.

## Roles (v2)

The app expects `GET /admin/v1/auth/me` to return `{ email, role }` with role
`OPERATOR` or `MANAGER`. The signed-in identity shows in the nav. Irreversible actions
are **manager-only** and appear disabled with "Requires manager role" for operators:
condemning a batch and deleting a pincode. Everything else (receiving stock, QC, stock
adjustments, status moves, cancelling orders, adding/deactivating pincodes, starting
a claim review, resolving a claim as replacement or reject) is open to both roles.
See `src/permissions.ts` — confirm this split before launch (PRD Q1).

## No refunds

The business replaces products instead of refunding. The panel has no refund button
on orders, and a claim can only be resolved as **Replacement** or **Reject**. The
API's `POST /orders/:id/refund` and the `REFUND_APPROVED` claim resolution are never
called. Note that mango-api still marks a paid order's payment `REFUNDED` when the
order is cancelled or its batch is condemned; that is backend behaviour.

## Known gaps (v1 → being closed in v2)

- `RTO` order status is shown as **"Returned"** in the UI.
- Dry-fruit batch intake still needs backend availability modelling first.

## Assumed backend changes (v2 — hand to the mango-api team)

The v2 UI is built against these endpoint contracts. Until the backend ships them,
the affected screens will show errors rather than succeed.

| Endpoint | Change |
|----------|--------|
| `GET /admin/v1/auth/me` | new — `{ email, role: 'OPERATOR' \| 'MANAGER' }` |
| `POST /admin/v1/auth/login` | set httpOnly refresh cookie; drop `refreshToken` from the body |
| `POST /admin/v1/auth/refresh` | read the cookie (empty body), return `{ accessToken }` |
| `POST /admin/v1/auth/logout` | new — clear the refresh cookie |
| CORS | `Access-Control-Allow-Credentials: true`, exact `ADMIN_ORIGIN` |

See §12 of the admin PRD for the open questions (Q1–Q7) and risks.
