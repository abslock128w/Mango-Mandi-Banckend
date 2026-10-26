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
| 11 | Stocktake: staged counts, review, second approver, found boxes (J) | Done (migration 037, `WAREHOUSE_STOCKTAKE`; STOCKTAKE.md) |
| 12 | Repack, split, merge, partial damage, lineage in trace and recall (K) | Done (migration 037, `WAREHOUSE_REPACK`; REPACK.md) |
| 13 | Camera scanning in the panel (9.7) | Done (`WAREHOUSE_CAMERA_SCAN`; SCANNING.md) |

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
| Done-list checks | `node --test test/warehouse-checks.test.js` (new: receipt verification, reprint limit, idle sessions, pack and dispatch races, cancel at every stage, QC permissions, QC by scan) | 12 pass, 0 fail |
| Full API suite on PR #19's code | `TEST_DATABASE_URL=…/mango_pr19_test npm test` | 684 tests: 683 pass, 1 skip, 0 fail |
| Order suites, warehouse off | `WAREHOUSE_V2=false node --test` flow, shop-payments, business-invariants, concurrency, delivery, preorders, bulk-deals, stock-fixes, pay-fixes, lock-order | 111 tests: 110 pass, 1 fail. The one failure is the exact `/auth/me` shape in flow.test.js, which expects the flag on |
| Full API suite after the QC-by-scan fix (d1f8fc6) | `TEST_DATABASE_URL=…/mango_pr19_test npm test` | 696 tests: 695 pass, 1 skip, 0 fail |
| Measurements | `node scripts/warehouse-bench.mjs` on `mango_wh_bench_test` | See PERFORMANCE.md |

### Warehouse next (branch `wip/wh`, stages 11–13)

Databases: `localhost:5432/mango_wh_n7_test`, `mango_wh_n7full_test`,
`mango_wh_n7rb_test`, `mango_wh_n7ui_test` (user mango, password not shown).

| When | Command | Result |
|---|---|---|
| Baseline | `node --test test/warehouse.test.js test/warehouse-checks.test.js` | 34 pass, 0 fail |
| New API tests | `node --test test/warehouse-next.test.js` | 11 pass, 0 fail (stocktake ×6 incl. two finishes, a scan racing a finish and two starts at once; repack ×4 incl. two repacks racing for one box; recall drill finds and holds a repacked box) |
| Warehouse suites | warehouse, warehouse-checks, warehouse-units, migrations, warehouse-next | 46 tests: 45 pass, 1 fail: migration numbering, because 037 lands before 035 and 036 (other branches) |
| Snapshots | `UPDATE_ROUTE_INVENTORY=1 UPDATE_ROLE_POLICY=1` auth-matrix, security-readiness | 198 pass; 9 lines added to each fixture, all new warehouse routes; nothing removed |
| Full API suite | `TEST_DATABASE_URL=…/mango_wh_n7full_test npm test` | 716 tests: 714 pass, 1 skip, 1 fail (the same migration numbering gap) |
| Rollback | warehouse-next tests → `ROLLBACK_037.sql` → migrate on `mango_wh_n7rb_test` | 037 tables 4 → 0 → 4; 2 finished repacks and 3 repacked boxes kept as history |
| Panel | `npm run lint`, `npm run typecheck`, `npm run build` | all pass |
| Panel | `npm run test:unit` | 33 pass, 0 fail (5 new: camera rules) |
| Panel | `npx playwright test tests/warehouse-next.spec.ts` (phone and desktop) | 32 pass, three runs in a row |
| Panel | `npx playwright test tests/warehouse.spec.ts tests/warehouse-next.spec.ts` | 70 pass, 2 skip (screenshots) |
| Panel, every spec | `PANEL_PORT=5185 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test` | 404 pass, 14 skip, 0 fail (skips: live-API specs, screenshots, the two real-API specs) |
| Panel on the real API | `tests/warehouse-real.spec.ts` on `mango_wh_n7ui_test`, API on :3013 with every warehouse flag on, no demo data | 2 pass: the original flow, then count, review missing, found again in another place, merge two boxes, labels PDF, books match |

### Warehouse next: review fixes

Two reviews found: condemned fruit could be repacked back into sellable stock;
a merged box from two recalled lots was freed by releasing one recall; the
previous release broke on lots holding repacked boxes (rollback); big counts
could not be reviewed; repack weights were not reconciled; a kept box on an
order raised nothing; the counter could review their own count; partial damage
by fruit alone on an uncounted box changed nothing; the camera re-sent two
codes in view every frame and could start while the page was hidden. All
fixed (REPACK.md, STOCKTAKE.md, DECISIONS N2, N3, N8, N11–N14). Also fixed: a
pack or dispatch finish refusing a stale box no longer leaves it staged.

Databases: `localhost:5432/mango_wh_fix_test`, `mango_wh_fixfull_test`, `mango_wh_fixui_test`.

| When | Command | Result |
|---|---|---|
| New API tests on the old code | `node --test test/warehouse-next.test.js` with `mango-api/src` stashed | 11 new fail, 11 old pass |
| New API tests | `node --test test/warehouse-next.test.js` | 22 pass, 0 fail |
| Previous release on repack data | throwaway probe: 61ac961's `lots.js` and `reports.js` loaded against a database with a split | reconciliation clean, `addBoxes` and `refreshLotCounts` work (with the builder's code: fails) |
| Related suites, fixtures | warehouse-next, warehouse, warehouse-checks, warehouse-units, auth-matrix, security-readiness, migrations with `UPDATE_ROUTE_INVENTORY=1 UPDATE_ROLE_POLICY=1` | 266 tests: 265 pass, 1 fail (migration numbering gap, 035/036 on other branches); fixtures unchanged |
| Full API suite | `TEST_DATABASE_URL=…/mango_wh_fixfull_test npm test` | 727 tests: 725 pass, 1 skip, 1 fail (the same numbering gap) |
| Panel | `npm run lint`, `npm run typecheck`, `npx eslint mango-api/src mango-api/test` | all pass |
| Panel | `npm run test:unit` | 37 pass, 0 fail (new: per-code camera gate, review body) |
| Panel | `npx playwright test tests/warehouse-next.spec.ts tests/warehouse.spec.ts` | 76 pass, 2 skip (screenshots); the two new camera specs fail on the old camera code |
| Panel on the real API | `tests/warehouse-real.spec.ts` on `mango_wh_fixui_test`, API on :3013, every warehouse flag on | 2 pass |

## Existing tests changed

- `test/flow.test.js`: the exact `/auth/me` body now includes
  `warehouse: { enabled, permissions }`. The panel needs it to show the area.
- `test/fixtures/role-policy.json`, `test/fixtures/route-inventory.json`:
  regenerated; additions only, all warehouse routes.
- `test/setup-env.js`: `WAREHOUSE_V2=true` in tests so the role matrix covers
  the new routes (DECISIONS B5). Products still start untracked.
- Warehouse next: `test/setup-env.js` also sets `WAREHOUSE_STOCKTAKE`,
  `WAREHOUSE_REPACK` and `WAREHOUSE_CAMERA_SCAN` to true (unless set), so the
  matrix covers the new routes; the fixtures gained 9 lines each, additions only.
  Panel: `tests/warehouse-mock.ts` gives OPERATOR `warehouse.repack` (as the API
  now does), answers the new routes, and leaves out a switched-off feature's
  permission as the API does; the lineage example is on its own box so the
  existing trace test is unchanged.

## Blockers

None in code. Business confirmations are listed in DECISIONS.md (D1–D12 confirm flags).

## Known gaps

- `test/migrations.test.js` fails on this branch alone: 037 needs 035 and 036,
  which other branches add. It passes once they are merged.
- Found, not changed: in a pack or dispatch finalize, STALE_SCAN deletes the
  stale staged rows and then throws in the same transaction, so the delete is
  rolled back and the box stays staged. Repack does it right (the route drops
  them in their own transaction); pack and dispatch were left as they are.
- No JavaScript QR decoder: browsers without BarcodeDetector (Safari, Firefox)
  get the explanation and typing only (DECISIONS N9).

- Packers cannot search Orders, so for them the scan setup finds an order
  number only while it is in the pick queue; otherwise they enter the order ID.

## Next

Open the warehouse pull request once Bulk Deals (PR #18) is merged.
