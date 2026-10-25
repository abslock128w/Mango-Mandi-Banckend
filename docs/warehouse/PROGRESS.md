# Warehouse build progress

Branch `claude/project-thread-bpj5a6`. Every command below was run in the
Claude Code sandbox against local Postgres 16 databases created for the run
(`localhost:5432`, names ending `_test`). No command touched production,
staging or Neon.

## Stages

| # | Stage | State |
|---|---|---|
| 1 | Discovery, baseline, decisions log | Done |
| 2 | Schema, constraints, append-only events, state rules, pickable rule | Done (migration 034) |
| 3 | Batch intake, box generation, labels, receipt verification | Done |
| 4 | Scan engine: receive, move, QC | Done |
| 5 | Stock integration: pick, unpick, cancellations, shortfall | Done |
| 6 | Staged pack and dispatch, messages after commit | Done |
| 7 | Panel Warehouse area | Done |
| 8 | Recall holds and trace | Done (API) |
| 9 | Test matrix, regression suites, lint, typecheck, build | Done |
| 10 | Docs and rollout | Done (this folder) |

## Commands and results

| When | Command | Result |
|---|---|---|
| Baseline (before changes, 147347d) | `TEST_DATABASE_URL=…/mango_wh_base_test npm test` (mango-api) | 598 tests: 597 pass, 1 skip, 0 fail |
| Stage 3 | `node --test test/warehouse-units.test.js` | 8 pass, 0 fail (300 random codes × every substitution and adjacent swap; every QR on roll and A4 PDFs decoded after pdftoppm at 300 dpi) |
| Stages 3–8 | `node --test test/warehouse.test.js` | 22 pass, 0 fail |
| Full suite | `TEST_DATABASE_URL=…/mango_wh_full_test npm test` | 684 tests: 624 pass, 59 fail, 1 skip. All 59 were the two access snapshots (new warehouse routes) and the exact `/auth/me` shape in flow.test.js |
| Snapshots | `UPDATE_ROLE_POLICY=1` auth-matrix, `UPDATE_ROUTE_INVENTORY=1` security-readiness | 56 lines added to each fixture, every one a `/warehouse/` route; nothing else changed |
| Re-run | auth-matrix, flow, security-readiness, launch-review, warehouse, warehouse-units | 252 tests: 252 pass, 0 fail |
| Lint | `npx eslint mango-api/src mango-api/test` | 0 problems |
| Rollback | migrate → `ROLLBACK.sql` → migrate on `mango_wh_rb_test` | warehouse tables 4 → 0 → 5; product columns removed and re-added |
| Panel | `npm run typecheck`, `npm run lint`, `npm run build` (repo root) | all pass |
| Panel | `npm run test:unit` | 27 pass, 0 fail |
| Panel | `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test` | 372 pass, 12 skip, 0 fail (skips: specs needing a live API, screenshots, the real-API spec) |
| Panel on the real API | `tests/warehouse-real.spec.ts` with `WH_REAL_API`, `WH_REAL_DB` on `mango_wh_ui_test` (WAREHOUSE_V2, dev routes) | pass, twice on fresh databases: intake, receive, QC, put away, pick, pack, dispatch, reconciliation clean |
| After message fixes | `node --test test/warehouse.test.js test/warehouse-units.test.js` | 30 pass, 0 fail |
| Done-list checks | `node --test test/warehouse-checks.test.js` (new: receipt verification, reprint limit, idle sessions, pack and dispatch races, cancel at every stage) | 10 pass, 0 fail |
| Full API suite on PR #19's code | `TEST_DATABASE_URL=…/mango_pr19_test npm test` | 684 tests: 683 pass, 1 skip, 0 fail |
| Order suites, warehouse off | `WAREHOUSE_V2=false node --test` flow, shop-payments, business-invariants, concurrency, delivery, preorders, bulk-deals, stock-fixes, pay-fixes, lock-order | 111 tests: 110 pass, 1 fail. The one failure is the exact `/auth/me` shape in flow.test.js, which expects the flag on |
| Measurements | `node scripts/warehouse-bench.mjs` on `mango_wh_bench_test` | See PERFORMANCE.md |

## Existing tests changed

- `test/flow.test.js`: the exact `/auth/me` body now includes
  `warehouse: { enabled, permissions }`. The panel needs it to show the area.
- `test/fixtures/role-policy.json`, `test/fixtures/route-inventory.json`:
  regenerated; additions only, all warehouse routes.
- `test/setup-env.js`: `WAREHOUSE_V2=true` in tests so the role matrix covers
  the new routes (DECISIONS B5). Products still start untracked.

## Blockers

None in code. Business confirmations are listed in DECISIONS.md (D1–D12 confirm flags).

## Known gaps

- Packers cannot search Orders, so for them the scan setup finds an order
  number only while it is in the pick queue; otherwise they enter the order ID.

## Next

Open the warehouse pull request once Bulk Deals (PR #18) is merged.
