# Stocktake (cycle count)

Behind `WAREHOUSE_STOCKTAKE` (default off). Code: `mango-api/src/warehouse/stocktake.js`;
panel: Warehouse → Stocktake, and the Scan screen. Tests:
`mango-api/test/warehouse-next.test.js`, `tests/warehouse-next.spec.ts`.

## How a count runs

1. **Start** (`POST /warehouse/operations`, `type: stocktake`, `context.locationId`).
   The session records a snapshot time and how many boxes are recorded at the
   place (in stock, returned, picked or packed there). One open count per
   place: a second start by someone else is `OPERATION_LOCKED`; your own open
   count resumes. A database index backs this (`wh_operations_one_open_stocktake`).
2. **Scan** every box physically there. A scan changes nothing yet (staged).
   Warnings tell staff what finishing will do:

   | Code | Meaning |
   |---|---|
   | OK | Recorded here; counted |
   | FOUND_ELSEWHERE | Recorded at another place: its location is corrected at finish |
   | FOUND_MISSING | Recorded missing: back in stock here at finish |
   | RECORDED_GONE | Recorded dispatched, written off, voided, repacked or never received: an investigation hold at finish |

3. **Finish** (`POST /warehouse/operations/:id/finalize`). Under locks (session,
   then every staged box and every box recorded here, by id) and in one
   transaction:
   - boxes changed by **another** session or action after the snapshot are left
     alone (`moved_after_snapshot`, ignored): someone moved them while you counted;
   - FOUND_ELSEWHERE, FOUND_MISSING and RECORDED_GONE are applied as above, each
     with its own event (LOCATION_CORRECTED, FOUND, HOLD_ADDED);
   - a box recorded here and in stock but not scanned becomes a proposed
     `not_found` line; one that is picked, packed or returned becomes
     `not_found_allocated` (it can only be kept, then looked into);
   - nothing is marked missing yet;
   - stock lines move with the sellable boxes (`on_hand` stays equal to them);
     a shortfall on an order follows the existing shortfall path.

4. **Review** (`POST /warehouse/stocktakes/:id/review`, `warehouse.stocktake`):
   decide every proposed box as `missing` or `keep`. Up to the D8 limit
   (10 boxes and 20 kg) it applies at once; above it, it waits for a second
   person with `adjust.approve` who neither counted nor reviewed it
   (`/approve`, `/reject`; `SELF_APPROVAL` otherwise). Applying marks each box
   missing (location cleared, event MISSING) **only if nothing changed since
   the count** (same version, still in stock at that place); otherwise the
   line is `superseded` and the box left alone.

A box marked missing that turns up is scanned in any later count and goes back
in stock there. Missing boxes and counts waiting for a review are listed on
Warehouse → Exceptions.

## Concurrency (tested)

- Two finishes of one count: one applies, the other gets the stored result.
- A scan racing a finish: either it is in the count, or it is refused with
  OPERATION_CLOSED; never half-applied.
- Two people starting a count of the same place at once: one count.
- A box moved by someone else while counting: `moved_after_snapshot`, untouched.
- A box that changes between the count and the review: `superseded`.
