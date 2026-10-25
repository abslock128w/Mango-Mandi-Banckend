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
| 7 | Panel Warehouse area | In progress |
| 8 | Recall holds and trace | Done (API) |
| 9 | Test matrix, regression suites, lint, typecheck, build | API done; panel pending |
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

## Next

Panel Warehouse area and its specs, then the panel regression suite, build and PR update.
