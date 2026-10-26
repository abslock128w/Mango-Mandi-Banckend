# Warehouse and box traceability: decisions

Each entry: the decision, the alternatives, why, how to reverse it, and whether a
person must confirm it before go-live ("Confirm: yes").

Where the brief and the repository disagree, the repository wins (brief section 3.6).
Those entries are marked **Conflict**.

## Conflicts with the brief

### C1. Stack: Express + pg, not NestJS
The backend is Express 4 + node-postgres (`pg`, TCP) with plain SQL migrations
(`mango-api/migrations/NNN_name.sql`), zod 4 validation, pino logging and the
`{ error: { code, message, requestId } }` envelope. No NestJS, no ORM. The warehouse
code follows that. Confirm: no.

### C2. Dry fruits are out of scope
The owner said on 15 Oct 2026 that dry fruit is not part of the business. Every
product today is a mango box. The design keeps per-product rules (shelf life, QC
checklist, restockable returns, tolerance) so another product type could be added,
but nothing dry-fruit-specific is built. Confirm: no.

### C3. No cash on delivery
The shop takes only online payment (Razorpay). D12 "COD confirmed" does not exist;
pickable orders are paid ones. Confirm: no.

### C4. No 3PL integration exists
Deliveries go out with the shop's own riders (`/manifest`, `dispatchOrder`, delivery
proof). There is no shipment, AWB or 3PL booking model. Warehouse dispatch therefore
hands the order to the existing dispatch path (PACKED → SHIPPED), which queues the
customer's WhatsApp update through the existing `notifications` outbox. A 3PL adapter
is future work. Confirm: yes (if a 3PL is chosen, dispatch gains a shipment step).

### C5. Refunds
The brief says "no refunds". The repository already refunds in two cases the owner
approved: a customer cancels before packing, and a manager cancels an order the shop
cannot deliver. The warehouse adds no refund path and changes neither. Confirm: no.

### C6. Timestamps come from the app clock, not `now()` in SQL
The whole codebase stamps rows with the injectable app clock (`src/clock.js` `now()`,
`setNow` in tests), so time-dependent tests can move time. Warehouse events do the
same. The clock is the server's, never the client's. Confirm: no.

### C7. A batch is a delivery with lines; the brief's "intake batch" is one line
`batches` (one supplier delivery: variety, plucked date, farm) has `batch_lines`
(one per box product, the stock counters). The brief's intake batch (one delivery of
one variant) is one batch line. Box intake adds a `box_lots` row (1:1 with a batch
line) for the counts, status and idempotency key. A delivery of two products is one
batch with two lines and two lots, which matches the brief's "two batches". See M1.

### C8. Ripeness, not a fixed best-before
A mango's sale is decided by the batch's age on the delivery date (`stage.js`): the
same box sells as raw one day and ripe a few days later, and stops selling after
`maxSellableAge` days (default 7). A box's `best_before` is stored at intake as
plucked date + `maxSellableAge` (or the product's `shelf_life_days` if set) and the
pick check also applies the existing age cap on the order's delivery date.

### C9. Feature flag is an environment variable
The repository's flags are env vars (`WHATSAPP_CLAIM_UPDATES` etc). `WAREHOUSE_V2`
(default `false`) hides the Warehouse routes (404) and the panel area. Per-product
`box_tracking_enabled` is a column on `products`.

## Business decisions (brief 4.4)

| # | Decision | Source | Confirm |
|---|---|---|---|
| D1 | A customer buys fixed boxes: one order unit is one box of that product (`order_items.quantity` counts boxes). | Code | no |
| D2 | Box weight: nominal and measured net weight in integer grams; per-product tolerance, default ±3%. Out of tolerance sets quality `needs_review`. | Default | yes |
| D3 | One product per box. | Code (one SKU per order line) | no |
| D4 | Late binding: a box is bound to an order at pick. Checkout keeps its quantity reservation (`order_stock` held/committed). | Default | no |
| D5 | FEFO is chosen at checkout by the allocator. Picking a box from another batch than the one allocated is a NON_FEFO warning: allowed with a reason, and the reservation moves to the box's batch line if that line has free stock. Expired and held boxes are blocked. | Default | yes |
| D6 | No partial dispatch: the order model has one delivery per order. Pack and dispatch are all-or-nothing per order. | Code | no |
| D7 | Returned mango boxes are not resold by default (`restockable_returns = false`): quarantine, then dispose. Configurable per product. | Default | yes |
| D8 | Write-offs need `warehouse.adjust`; more than 10 boxes or 20 kg in one request needs a second person with `adjust.approve`, and nobody approves their own request. | Default | yes |
| D9 | One warehouse (`wh_main`). Every warehouse row carries `warehouse_id`; transfers are deferred. | Default | no |
| D10 | Ripening and cold rooms are location types. Dwell time is reported, not enforced. | Default | no |
| D11 | Replacement orders (`orders.replacement_for`) are ordinary orders for picking and consume new boxes. | Code | no |
| D12 | Pickable orders: status CONFIRMED or PROCESSING with payment SUCCEEDED, or a zero-priced replacement (CONFIRMED). Never PAYMENT_PENDING, FAILED or CANCELLED. | Code | no |

## Model mapping (M)

### M1. Concept → table
| Brief concept | Table | Note |
|---|---|---|
| Product / variant | `products` (+ new columns) | `box_tracking_enabled`, `nominal_weight_g`, `weight_tolerance_pct`, `requires_qc`, `restockable_returns`, `shelf_life_days`, `qc_checklist` |
| Intake batch | `batch_lines` + new `box_lots` | the line holds the stock counters; the lot holds counts, status, idempotency |
| Supplier | `batches.farm` | free text today; no supplier table exists |
| Box | new `boxes` | references the batch, line and lot |
| Holds | new `box_holds` | one row per hold, released rows kept |
| Labels | new `box_labels` | every token ever issued; revoked ones kept |
| Box events | new `box_events` | append-only, trigger enforced (like `batch_ledger`) |
| Locations | new `wh_locations` | type per location; `warehouses` table for D9 |
| Operations, scans, staging | new `wh_operations`, `wh_scans`, `wh_staged` | |
| Idempotency | existing `idempotency_keys` | key namespaced `wh:<actor>:<route>:<key>` |
| Outbox | existing `notifications` | WhatsApp updates already go through it after commit |
| Stock balance | existing `batch_lines` counters + `batch_ledger` | the only writable balance (brief 12.1) |
| Reservations | existing `order_stock` (held → committed → packed) | |
| Exceptions | existing Needs attention (`/attention`) + new warehouse exceptions list | |

### M2. Stock authority for a tracked product
For a product with box tracking on, `batch_lines.on_hand` equals the number of boxes on
that line that are **shelf-sellable**: lifecycle `in_stock`, quality `passed`, no active
hold, in an active pickable location of an active warehouse. Every box change that
moves a box in or out of that set adjusts `on_hand` by the difference in the same
transaction, with a `batch_ledger` row (ADJUST, reason codes `BOX_*`). A drop below
what is promised goes through the existing short-arrival path
(`recordShortArrival`): the youngest orders give boxes back and are refilled from other
batches, moved to a later date, or flagged at-risk (the shortfall queue). Availability
therefore never goes negative (`batch_lines_no_oversell` CHECK still holds).

### M3. Pick converts the reservation
A pick takes one committed unit of the order's `order_stock` on the box's line and
turns it into a packed unit (the existing PACK step: committed −1, on_hand −1) in the
same transaction as the box going `in_stock → picked`. Free stock is unchanged, and
the packed unit is pinned: rebalancing never swaps packed stock. Unpick is the reverse
(RESTOCK +1, then the existing rebalance re-reserves the unit).

The brief's "picked" therefore maps to the repository's `order_stock.state = 'packed'`
("boxes off the shelf for this order"), and the brief's "packed" is the order reaching
PACKED status.

## Security (S)

### S1. Permissions map onto the existing role allowlist
Warehouse permissions are a table in `mango-api/src/warehouse/permissions.js`. Each
warehouse route names one permission; `access.js` builds each role's route list from
that table, so the existing role-policy snapshot test covers every warehouse route.
Handlers check finer permissions (`qc.override`, `adjust.approve`, `recall.view_customers`).

Default bundles (Confirm: yes):

| Role | Warehouse permissions |
|---|---|
| MANAGER | all |
| OPERATOR (supervisor) | view, receive, labels.print, labels.reissue, move, qc, pick, pack, dispatch, returns, stocktake, adjust, reports.export |
| QC | view, receive, labels.print, move, qc |
| PACKER | view, move, pick, pack, dispatch, returns |
| RIDER | none |

Manager only: qc.override, adjust.approve, recall.manage, recall.view_customers, locations.manage.

### S2. Tokens and codes need a staff session
Resolving any label requires a signed-in staff member with the operation's permission.
Unknown codes are throttled per staff member (20 a minute, then refused and logged).

## Engineering (E)

### E1. No new infrastructure
No Redis, queue or broker. Long jobs (big batch generation, recall holds) are chunked
and resumed by idempotent "continue" calls. Stale operations expire lazily on access
and in the existing maintenance cron.

### E2. Libraries
`qrcode` (already used by the panel) builds QR matrices on the server; the label PDF is
written directly (vector squares for QR modules, the PDF base-14 Helvetica font, so no
font file is embedded; base-14 fonts are built into every PDF reader). Tests decode
every QR with `jsqr` (dev dependency) after rendering the label page with `sharp`
(already a dependency) and, when installed, `pdftoppm`.

### E3. Retention
No code path deletes boxes, box events, scans or operations. The retention period
must be checked against FSSAI traceability and recall rules. Confirm: yes.

### E4. Event table size
At ~1,000 orders a day and ~10 events per box, `box_events` grows by about 4 million
rows a year. Revisit partitioning at 50 million rows.

## Made while building (B)

### B1. Batch ripeness QC still decides when stock can be sold
A box intake creates (or joins) a batch with status ARRIVED. The existing
batch QC reading (Batches → QC) is still what makes the batch sellable for a
delivery date and sets its ripeness stage. Box QC is separate: it decides
whether one box may be sold at all. Both are needed before a box is picked.

### B2. Bulk-first actions on a lot
Staff do not scan every box for routine work. A lot can be QC-passed in one
action (`POST /warehouse/lots/:id/qc`, naming any exceptions) and put away in
one action (`POST /warehouse/lots/:id/put-away`). Each box still gets its own
event, so its history is exact. Scans are for receiving (or a supervisor's
count), exceptions, picking, packing, dispatch and returns.

### B3. Unpicking from a packed order reopens it
Taking a box off a PACKED order (wrong box found at the dispatch bay) moves
the order back to PROCESSING with an order event saying why. This is the only
backwards step the warehouse makes. The order must then be packed again with a
pack finalize. SHIPPED and later orders cannot be unpicked; their boxes come
back through a return scan.

### B4. A non-FEFO pick moves the reservation
When the box scanned is from a different batch than the one reserved, the
scan is refused with NON_FEFO until a reason is given. With a reason, one unit
is reserved on the box's batch and one released on the reserved batch, in the
same transaction. If the box's batch has no free unit (everything there is
promised to other orders) the scan is refused with STOCK_INSUFFICIENT.

### B5. Tests run with the warehouse routes on
`test/setup-env.js` sets `WAREHOUSE_V2=true` (unless the environment sets it),
so the role and route matrix tests cover every warehouse route. Every product
still starts with box tracking off, so all existing tests run the old stock
flow unchanged. `test/warehouse.test.js` turns the flag off to prove the 404s.

### B6. Old order buttons refuse labelled stock
For a product with tracking on: Allocate refuses with PICK_BY_SCAN, a manual
move to PACKED refuses with PACK_BY_SCAN until the boxes are packed by scan,
and Dispatch from PACKED refuses with DISPATCH_BY_SCAN until a dispatch
finalize. Returned boxes are booked with a Return scan (USE_WAREHOUSE_RETURNS
on the old Returned stock button). A missed delivery whose boxes would be too
old for the retry stops for a manager (as when no younger stock is free).

## Warehouse next: stocktake, repack, camera (N)

| # | Decision | Confirm |
|---|---|---|
| N1 | Supervisors (OPERATOR) may repack, split, merge and record partial damage (`warehouse.repack`), as they may count and write off. | yes |
| N2 | The person who counted may also review the count below the D8 limit (both need `warehouse.stocktake`); above it a second person with `adjust.approve`, who neither counted nor reviewed, decides. | yes |
| N3 | A count marks nothing missing by itself: not-found boxes wait for a review. A box picked, packed or returned but not found can only be kept (take it off its order, or write it off). | yes |
| N4 | A review applies to a box only if nothing changed since the count (version, lifecycle and place); otherwise that box is `superseded` and left alone. Boxes changed by someone else during the count are ignored. | no |
| N5 | A box scanned in a count that is recorded dispatched, written off, voided, repacked or never received gets an investigation hold; nothing else changes. | yes |
| N6 | New boxes from a repack need QC again when the product requires QC or any source had not passed; recall and investigation holds follow the fruit; damage and QC holds are what the repack deals with. | yes |
| N7 | Repacks happen at receiving, QC hold, packing or returns places, never on a storage shelf, so new boxes are not sellable until put away. | yes |
| N8 | New boxes live on the lot and stock line of their oldest source (earliest best-before, so FEFO holds), numbered above 1,000,000 and excluded from intake counts, and link every lot they contain in `box_origins`. | no |
| N9 | Camera scanning uses the browser's BarcodeDetector only; no JavaScript QR decoder is bundled. Warehouse phones are Android Chrome (which has it) and hand scanners stay the main tool; a decoder would add bundle weight and a dependency for a fallback. Revisit if iPhones are used on the floor. | yes |
| N10 | Each part has its own flag, default off: `WAREHOUSE_STOCKTAKE`, `WAREHOUSE_REPACK`, `WAREHOUSE_CAMERA_SCAN` (on top of `WAREHOUSE_V2`). | no |
