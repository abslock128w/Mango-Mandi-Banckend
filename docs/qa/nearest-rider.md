# Nearest-rider assignment: the rule, the tests, the defects

QA pass on "Assign nearest riders" (`POST /admin/v1/manifest/auto-assign`, `mango-api/src/nearest.js`,
migration 055), 3 Nov 2026. Suite: `mango-api/test/nearest-rider.test.js` (property-style, seeded random
riders and addresses around Bengaluru, against the real API and Postgres). Panel: `tests/security.spec.ts`
and `tests/deliveries-assign.spec.ts`; rider app: `rider-app/e2e/rider.spec.ts`.

## The rule (as written in the code, README and ASSUMPTIONS 23c)

**Which stops.** Every order on the date with no rider (`rider_id IS NULL`) in CONFIRMED, PROCESSING, PACKED,
SHIPPED or DELIVERY_FAILED; optionally only the listed `orderIds`. Stops that already have a rider, whoever
gave them (a manager by hand, a rider taking them when starting a run, an earlier auto-assign), are never
moved. Stops are handled one at a time in slot order, then order number.

**Which riders are candidates.** Every staff account whose role is RIDER, on any day, in any slot. There is
no rider roster, shift, slot or day: a rider is "on" simply by being a RIDER. Signed-out riders, riders whose
phone was revoked, riders with no phone at all (panel-only accounts) are all candidates. A deleted rider is
not (the row is gone; their stops go back to the pool).

**Where a rider is.** The latest row of `rider_locations` for that rider, if it is at most 3 hours old
(`POSITION_FRESH_MS`); otherwise the rider has no position. Rows arrive from the rider app's
`POST /rider/location` (at most one per 20 s, server time; older than 30 days are purged). The GPS accuracy
is stored but ignored. The fresh window is measured on the server clock, in absolute time: IST midnight,
the delivery date and the slot play no part.

**Where a stop is.** Its pincode's centre (`pincodes.lat/lng`). Addresses are free text. A pincode with no
coordinates means the stop has no position.

**Where a warehouse is.** `warehouses.lat/lng` of each active warehouse; one without coordinates is ignored.

**Distance.** Straight line (haversine), in km, from the rider's position to the stop. Not a road route, not
through the warehouse.

**The choice.**
1. If the stop has a position and at least one rider has a (fresh) position: the rider with the smallest
   straight-line distance to the stop. A tie in distance goes to the rider with fewer stops that day, then
   to the lower rider id. Riders without a position are not considered at all in this case, however many
   stops the placed riders already carry.
2. Otherwise (no stop position, or no rider with a fresh position): the rider with the fewest stops that
   day (orders with that rider on the date, not cancelled, delivered ones included), then the lower id.
3. The pickup warehouse is the active warehouse with coordinates that makes rider → warehouse → stop
   shortest (with no rider position: nearest the stop). It is written only when there is one; with none,
   the order keeps whatever `pickup_warehouse_id` it had. It is recorded in the order's history.

**Load.** None. Nearest-first can give one rider every stop; "a load limit is a follow-up" (ASSUMPTIONS 23c).
A rider already out with a full bag is as good a candidate as an idle one. The stop count only breaks ties.

**Manual overrides.** `POST /manifest/assign` (the Rider picker on Deliveries) sets or clears a rider on any
non-delivered order and is never touched by auto-assign, because auto-assign only looks at unassigned stops.
Clearing a rider by hand ("given to nobody") puts the stop back in the pool, so the next auto-assign may give
it to anyone.

**Moving riders.** Auto-assign is a one-off decision at the moment it is run: a rider moving away afterwards,
or a nearer rider turning up, changes nothing until a manager clears the stop and runs it again.

### Where the docs and the code disagree

- README says a rider is "where the rider app last reported him in the past 3 hours" and the code does that.
  Neither says what happens when *some* riders have positions and others do not: the code quietly drops the
  rider without a position (rule 1), even when they are the only idle rider. Recorded as a question below.
- The history line for a stop whose *pincode* has no coordinates reads "no rider's position known: fewest
  stops", which is the wrong reason (defect D1).
- Neither the README nor ASSUMPTIONS says that the panel's manual assignment wins; it does (tested).

## Test coverage (all in `mango-api/test/nearest-rider.test.js` unless noted)

| Case from the brief | Test |
|---|---|
| Random riders and addresses, hundreds of seeds | "property: … 300 seeded runs" (oracle re-implements the rule independently; asserts rider, warehouse, km and history) |
| 1 rider | "one rider gets every stop" |
| 2 riders equidistant | "an exact tie goes to the rider with fewer stops, then the lower id" |
| 20 riders | part of the property runs (1 to 20 riders per run) and "20 riders" |
| Rider with no position | "a rider with no position is skipped while another has one, and used when none has" |
| Position hours old | "a position older than 3 hours does not count; exactly 3 hours does" |
| Another slot or day | "a rider's stops on another day or slot do not matter; the date filter holds" |
| Revoked or signed-out rider | "a signed-out or revoked rider is still a candidate (rule as documented)" — see Q2 |
| Rider at the warehouse vs next to the customer | "the rider next to the customer wins over the rider at the warehouse" — see Q1 |
| IST midnight | "a position from before IST midnight still counts after it" |
| Address far outside the city | "a stop 140 km away still goes to its nearest rider; a pincode without coordinates goes to the least-loaded rider" |
| Full load | "a rider already carrying 12 stops still gets the next one if nearest" — see Q3 |
| Position moves after assignment | "assigned stops do not move when the nearest rider moves away" |
| Manual assignment not overwritten | "a manager's assignment is never overwritten, even when auto-assign runs at the same time" |
| Concurrent assignment | "two auto-assigns at once give nothing twice and spread the fewest-stops fallback" |
| Panel shows the result | `tests/deliveries-assign.spec.ts` (mocked API: toast, rider cell after refresh, no-rider case) |
| Rider app shows the result | `rider-app/e2e/rider.spec.ts` "before pickup the stop says which warehouse to collect from" (existing) and the API test "the rider's manifest carries the pickup warehouse" |

## Defects

(filled in below as found; severity: high = wrong rider or lost assignment, medium = wrong under a real
condition or misleading to staff, low = cosmetic)

## Questions for the owner (the rule was not changed for these)

