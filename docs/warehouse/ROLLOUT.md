# Rolling the warehouse out

**This plan needs CTO sign-off before any step touches production.** Nothing
here has been run against production or shared staging. Claude ran the
migration only on local disposable databases.

## 0. Before

- Merge the PR with CI green. The previous-release job proves the old API
  still passes its tests on the new schema.
- Take a backup (`ops/backup.sh`) and check a restore (`ops/restore-check.sh`).

## 1. Migration (any time before the launch window)

    # On a Neon branch made from production first, then production:
    DATABASE_URL=<unpooled url> npm --prefix mango-api run migrate

Migration 034 only adds tables, defaulted columns, two SQL functions, and a
wider ledger reason check (NOT VALID). Every product starts with box tracking
off. With `WAREHOUSE_V2` unset, every warehouse path answers 404 and the
panel hides the area. Checkout and the order flow are unchanged.

## 2. Staging trial (WAREHOUSE_V2=true on a staging deployment only)

1. Locations: rename the ten starter locations, add real ones, print their
   labels (Warehouse → Locations).
2. Product settings: box weight, tolerance, shelf life, QC checklist.
3. A test delivery: intake, print, receive, QC, put away, then pick, pack and
   dispatch a test-mode order; check Reports → Reconciliation is clean.

## 3. Labelling existing stock (per product)

1. For each open batch line of the product, create a **legacy** intake on that
   batch with its counted boxes (tracking still off).
2. Receive (or count-confirm), QC-pass and put away the boxes.
3. Wait until no box of the product is packed on an open order.
4. Turn tracking on (Warehouse → Products). The server refuses unless every
   line's on_hand equals its sellable boxes.

## 4. Turning it on in production

Set `WAREHOUSE_V2=true` and redeploy. Turn tracking on product by product.

## Turning it off

- One product: switch its tracking off. Its counters stay where they are and
  the old buttons work again; boxes stop driving stock.
- Everything: unset `WAREHOUSE_V2` and redeploy. Routes go back to 404; data
  stays.

## Rolling back the schema

Only if needed, after `WAREHOUSE_V2` is off and the previous release is live,
by a human, after a backup: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f
docs/warehouse/ROLLBACK.sql`. It deletes every box, label, scan and event.
(Tested on a local disposable database: migrate → rollback → migrate again.)

## Retention

Box events and scans are kept. How long food-traceability records must be
kept (FSSAI) needs confirming before any clean-up job is written (DECISIONS E3).
