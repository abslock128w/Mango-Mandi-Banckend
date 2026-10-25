# Warehouse model

Every physical box of mangoes has one row in `boxes` and one QR label. What
can happen to a box is decided by three separate things, so releasing one
restriction never releases another:

| Field | Values | Meaning |
|---|---|---|
| `lifecycle` | generated, in_stock, picked, packed, dispatched, returned, missing, voided, disposed, repacked | Where the box is in its life |
| `quality` | pending, passed, failed, needs_review | The latest QC verdict |
| holds (`box_holds`) | qc_hold, recall_hold, damage_hold, investigation_hold, return_hold | Each kind added and released on its own |

Location (`wh_locations`) is a fourth fact: only `storage`, `cold_storage`
and `ripening` are pickable places (D10).

## The sellable and pickable rule

One definition, in SQL, used by stock counting, pick checks and reports:

- `box_shelf_sellable(box)`: lifecycle in_stock, quality passed, no active
  hold, in an active pickable location of an active warehouse, and the batch
  is not EXHAUSTED or CONDEMNED.
- `box_pickable(box, day)`: shelf-sellable, best-before on or after `day`
  (IST), and the product has box tracking on. Expiry is read at query time,
  so a box stops being pickable at midnight IST with no job running.

`core.js pickProblem()` says *why* a box is not pickable, in the order staff
should fix things.

## Lifecycle transitions

| From | To | How |
|---|---|---|
| (none) | generated | Lot intake creates the box and its label |
| generated | in_stock | Receive scan, or a supervisor's count confirmation |
| generated | voided | Fewer boxes arrived than labelled |
| in_stock | picked | Pick scan for a paid order (D12) |
| picked | packed | Pack finalize (all boxes of the order) |
| packed | dispatched | Dispatch finalize (order → SHIPPED) |
| picked, packed | in_stock | Unpick, cancel, or move of the order to another date (box waits at pick staging) |
| dispatched | returned | Return scan (return_hold added; D7) |
| returned | in_stock | Restock, only for products that allow it; needs QC again |
| in_stock, returned, missing | disposed | Write-off (second approver above 10 boxes or 20 kg; D8) |
| generated, in_stock | voided | Lot voided before anything left stock |

Database constraints back the important ones: a box has an order exactly
while it is picked, packed or dispatched; a box on the floor has a location.

## History

`box_events` is append-only (a trigger refuses UPDATE, DELETE and TRUNCATE).
Each event stores who, when, the operation and scan, and the before and
after of lifecycle, location, quality and holds. Corrections are new events
(UNDONE, CORRECTED), never edits. Events carry an order id, never a
customer's name, phone or address.

## Concurrency

Every change goes through `changeBox()`: the box row is locked, the update
only lands if the version is unchanged, and the event is written in the same
transaction. Lock order everywhere: orders → order_stock → boxes (by id) →
batch_lines (by id). Scans of one session are serialised by locking the
session row.
