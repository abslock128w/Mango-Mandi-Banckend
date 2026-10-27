# Warehouse API

All routes are staff routes under `/admin/v1`, behind the staff sign-in, and
answer 404 to everyone while `WAREHOUSE_V2` is off. Each route needs one
permission (`mango-api/src/warehouse/permissions.js`); access.js lists it for
every role holding that permission, so the role-policy snapshot test
(`test/fixtures/role-policy.json`) covers every route. Routes whose
permission only managers hold also carry `requireManager`. Riders have no
warehouse access. Errors use the usual envelope
`{ "error": { "code", "message", "requestId" } }`; scan results use the codes
in SCANNING.md.

Every query is scoped to the staff member's warehouse (`admin_users.warehouse_id`);
a box, lot or location in another warehouse is a 404.

## Notes on specific routes

- `POST /warehouse/lots` takes an optional `Idempotency-Key` header (8–80 of
  `A-Z a-z 0-9 - _`). The same key and body returns the same lot (200,
  `replayed: true`); the same key with a different body is 422
  IDEMPOTENCY_KEY_REUSED.
- `POST /warehouse/operations/:id/scans` takes `{ scans: [{ scanId, input,
  clientScannedAt?, reason?, weightG? }] }`, 1 to 50 scans, and answers
  `{ results: [...] }` in the same order.
- `POST /warehouse/write-offs` answers 200 when applied, 202 when it waits
  for a second approver (over 10 boxes or 20 kg).
- `GET /warehouse/export/:report` is CSV (`boxes`, `events` with `from`/`to`
  dates, `lots`, `reconciliation`). Cells are quoted and a leading
  `= + - @` tab or CR is prefixed with `'`. Each download is written to
  `staff_audit` first (`EXPORT warehouse-<report>`, with the warehouse and dates).
- `GET /warehouse/trace/*` and recalls include customer name and phone only
  for roles with `recall.view_customers` (managers).
- `/auth/me` includes `warehouse: { enabled, permissions }` for the panel.
  Permissions of a feature switched off (`warehouse.stocktake` while
  `WAREHOUSE_STOCKTAKE` is off, `warehouse.repack` while `WAREHOUSE_REPACK` is
  off) are left out, and that feature's routes answer 404.
- `GET /warehouse/settings` adds `features: { stocktake, repack, cameraScan }`,
  `repackReasons`, `repackPlaces` and `damageReasons`.
- `POST /warehouse/operations/:id/finalize` takes a body only for a repack:
  `{ outputs: [{ weightG, fruitCount? }], fruitRemoved, weightLostG?, note? }`
  (REPACK.md). A staged box (pack, dispatch or repack) that changed since its
  scan answers 409 STALE_SCAN (`boxes`), and a repack source whose batch was
  condemned answers 409 BATCH_OUT_OF_SERVICE; either way the box is taken out
  of the session, so the next finish goes on without it. Weights that do not
  add up answer 400 WEIGHT_MISMATCH, fruit counts 400 FRUIT_MISMATCH.
- `POST /warehouse/stocktakes/:id/review` takes `{ missing: [boxId], keep: [boxId], rest?, note? }`
  covering every box waiting for review (`rest: 'missing' | 'keep'` decides
  the ones not listed); the counter gets 403 SELF_REVIEW unless a manager;
  the answer adds `heldToFind` (kept boxes on orders, now held); above the D8
  limit it answers `status: pending_approval` and `/approve` or `/reject` by
  a second person decides (STOCKTAKE.md).
- `PATCH /admin/v1/batches/:id/status` to CONDEMNED (warehouse on) adds
  `heldRepackedBoxes`: boxes on other batches holding its fruit, now held.
- `POST /warehouse/boxes/:id/damage` takes `{ fruitRemoved?, weightLostG?, reasonCode, reason }`
  (`weightLostG` is required for a box with no fruit count).

## Routes

| Method | Path (under /admin/v1) | Permission | Roles |
|---|---|---|---|
| GET | `/warehouse/overview` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| GET | `/warehouse/settings` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| GET | `/warehouse/products` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| PATCH | `/warehouse/products/:sku` | locations.manage | MANAGER |
| GET | `/warehouse/lots` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| POST | `/warehouse/lots/preview` | warehouse.receive | MANAGER, OPERATOR, QC |
| POST | `/warehouse/lots` | warehouse.receive | MANAGER, OPERATOR, QC |
| GET | `/warehouse/lots/:id` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| POST | `/warehouse/lots/:id/continue` | warehouse.receive | MANAGER, OPERATOR, QC |
| GET | `/warehouse/lots/:id/labels.pdf` | labels.print | MANAGER, OPERATOR, QC |
| POST | `/warehouse/lots/:id/confirm-count` | warehouse.receive | MANAGER, OPERATOR, QC |
| POST | `/warehouse/lots/:id/add-boxes` | warehouse.receive | MANAGER, OPERATOR, QC |
| POST | `/warehouse/lots/:id/void-boxes` | warehouse.receive | MANAGER, OPERATOR, QC |
| PATCH | `/warehouse/lots/:id` | warehouse.adjust | MANAGER, OPERATOR |
| POST | `/warehouse/lots/:id/close` | warehouse.receive | MANAGER, OPERATOR, QC |
| POST | `/warehouse/lots/:id/void` | warehouse.adjust | MANAGER, OPERATOR |
| POST | `/warehouse/lots/:id/qc` | warehouse.qc | MANAGER, OPERATOR, QC |
| POST | `/warehouse/lots/:id/put-away` | warehouse.move | MANAGER, OPERATOR, QC, PACKER |
| GET | `/warehouse/boxes` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| POST | `/warehouse/resolve` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| GET | `/warehouse/boxes/:id` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| GET | `/warehouse/boxes/:id/events` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| POST | `/warehouse/boxes/:id/reprint` | labels.print | MANAGER, OPERATOR, QC |
| POST | `/warehouse/boxes/:id/reissue` | labels.reissue | MANAGER, OPERATOR |
| GET | `/warehouse/boxes/:id/label.pdf` | labels.print | MANAGER, OPERATOR, QC |
| POST | `/warehouse/boxes/:id/holds` | warehouse.qc | MANAGER, OPERATOR, QC |
| POST | `/warehouse/boxes/:id/holds/:kind/release` | warehouse.qc | MANAGER, OPERATOR, QC |
| POST | `/warehouse/boxes/:id/measure` | warehouse.qc | MANAGER, OPERATOR, QC |
| POST | `/warehouse/boxes/:id/restock` | warehouse.returns | MANAGER, OPERATOR, PACKER |
| POST | `/warehouse/boxes/:id/damage` | warehouse.repack | MANAGER, OPERATOR |
| POST | `/warehouse/write-offs` | warehouse.adjust | MANAGER, OPERATOR |
| GET | `/warehouse/write-offs` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| POST | `/warehouse/write-offs/:id/approve` | adjust.approve | MANAGER |
| POST | `/warehouse/write-offs/:id/reject` | adjust.approve | MANAGER |
| GET | `/warehouse/locations` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| POST | `/warehouse/locations` | locations.manage | MANAGER |
| PATCH | `/warehouse/locations/:id` | locations.manage | MANAGER |
| GET | `/warehouse/locations/:id/label.pdf` | labels.print | MANAGER, OPERATOR, QC |
| GET | `/warehouse/operations` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| POST | `/warehouse/operations` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| GET | `/warehouse/operations/:id` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| POST | `/warehouse/operations/:id/scans` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| POST | `/warehouse/operations/:id/undo` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| POST | `/warehouse/operations/:id/finalize` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| POST | `/warehouse/operations/:id/cancel` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| GET | `/warehouse/orders/:id/pick-list` | warehouse.pick | MANAGER, OPERATOR, PACKER |
| GET | `/warehouse/pick-queue` | warehouse.pick | MANAGER, OPERATOR, PACKER |
| GET | `/warehouse/exceptions` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| GET | `/warehouse/reconciliation` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| GET | `/warehouse/trace/boxes/:id` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| GET | `/warehouse/trace/lots/:id` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| GET | `/warehouse/recalls` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| POST | `/warehouse/recalls` | recall.manage | MANAGER |
| POST | `/warehouse/recalls/:id/continue` | recall.manage | MANAGER |
| POST | `/warehouse/recalls/:id/release` | recall.manage | MANAGER |
| GET | `/warehouse/recalls/:id` | warehouse.view | MANAGER, OPERATOR, QC, PACKER |
| GET | `/warehouse/export/:report` | reports.export | MANAGER, OPERATOR |
| GET | `/warehouse/stocktakes` | warehouse.stocktake | MANAGER, OPERATOR |
| GET | `/warehouse/stocktakes/:id` | warehouse.stocktake | MANAGER, OPERATOR |
| POST | `/warehouse/stocktakes/:id/review` | warehouse.stocktake | MANAGER, OPERATOR |
| POST | `/warehouse/stocktakes/:id/approve` | adjust.approve | MANAGER |
| POST | `/warehouse/stocktakes/:id/reject` | adjust.approve | MANAGER |
| GET | `/warehouse/repacks` | warehouse.repack | MANAGER, OPERATOR |
| GET | `/warehouse/repacks/:id` | warehouse.repack | MANAGER, OPERATOR |
| GET | `/warehouse/repacks/:id/labels.pdf` | labels.print | MANAGER, OPERATOR, QC |

Starting, scanning and finishing a stocktake or repack session also needs
`warehouse.stocktake` or `warehouse.repack` (the session type's permission).

