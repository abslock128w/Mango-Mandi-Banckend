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

Severity: high = the wrong rider gets a stop, or a stop is lost; medium = wrong under a real condition, or
staff are told something false; low = cosmetic. Each fix is its own commit on `claude/nearest-rider-qa`
with the test that failed before it.

| # | Severity | Defect | Fix | Test |
|---|---|---|---|---|
| D3 | medium | Two auto-assigns at once (the button pressed twice, two managers, or the API called once per stop) each counted the riders' stops before the other committed, so the fewest-stops fallback stacked every stop on one rider: six stops went 4/2 or 6/0 on every try. | A transaction-level advisory lock serialises assignment (`assignNearest`). | "two auto-assigns at once give nothing twice and spread the fewest-stops fallback" |
| D4 | medium | A stop already out for delivery whose rider was removed from Staff (which frees their stops) was skipped by auto-assign, so nobody got it and the panel said every stop already had a rider; the manual picker could still hand it out. | OUT_FOR_DELIVERY is assignable when the stop has no rider. | "a stop out for delivery whose rider was removed can be given to the nearest rider again" |
| D2 | medium | With no RIDER account on Staff the API answered an empty list and the panel's toast said "Every stop already has a rider". | The answer carries `riders` (how many there are); the panel says to add one on Staff. | "no riders at all: nothing is assigned and the answer says so"; `tests/deliveries-assign.spec.ts` |
| D1 | low | A stop whose pincode has no coordinates got the history line "no rider's position known: fewest stops" even when every rider was placed, sending staff to the wrong cause. | The line names the pincode that has no place on the map. | "a pincode without coordinates goes to the least-loaded rider and says so" |
| D5 | low | The Deliveries rider picker and the "Rider:" note showed the account email, while the auto-assign toast, the order history and the rider app said "Ravi Kumar". | `GET /riders` carries the display name; the panel shows it, email as the fallback. | "the manifest for the rider and for staff carries the rider and the pickup warehouse"; `tests/deliveries-assign.spec.ts` |

Counts: 0 high, 3 medium, 2 low. No defect in the choice itself: across 300 seeded runs (1 to 20 riders,
fresh, stale and missing positions, random addresses and warehouses, hand-assigned stops, whole-day and
listed-stop calls) the chosen rider, warehouse, distance and history matched the independent oracle every
time, and a second run never moved a stop.

### Not defects, by the rule as written (tested so a change would show)

- A rider next to the customer beats a rider standing at the warehouse, although the first must ride to the
  warehouse and back (about twice the trip). See Q1.
- A rider whose phone was revoked, or who signed out, is still given stops while a position of theirs is
  under 3 hours old. See Q2.
- A rider already carrying twelve stops gets the thirteenth if nearest. See Q3.
- A rider with no position is never considered while any other rider has one, even if they are idle and the
  placed rider is across the city with seven stops. See Q4.
- An assigned stop never moves, whoever comes nearer afterwards; only clearing it by hand puts it back.
- Positions are compared by server time: one reported at 23:50 IST counts at 00:10 the next day.

### Runs

- `TEST_DATABASE_URL=postgres://mango:mango@localhost:54329/nearest_test npm test` in `mango-api`
  (3 Nov 2026, this branch): 1,296 tests, 1,290 pass, 1 skipped, 3 fail. The 3 are `backup.test.js`
  (needs `psql`, not installed on this Mac; the same gap QA-REPORT.md records). The nearest-rider suite
  takes about 30 s, the property test 5 to 10 s of it.
- Panel: `PANEL_PORT=5199 CI=1 npx playwright test tests/a11y.spec.ts tests/deliveries-assign.spec.ts
  tests/security.spec.ts tests/rider-lookahead.spec.ts --project=desktop`: 44 pass.
- Rider app: `npx playwright test e2e/rider.spec.ts -g warehouse` in `rider-app`: pass (unchanged code).
- Not verified: a real phone's GPS; the live panel against the real API (the panel checks are against the
  mocked API, the data shape against the real one in the API suite).

## Questions for the owner (the rule was not changed for these)

- **Q1. Nearest to the customer, or shortest trip?** Every box is collected at a warehouse, so the real
  cost of a stop is rider → warehouse → customer. Today the rider is picked by straight-line distance to the
  customer alone, and the warehouse chosen afterwards. A rider at the Yeshwanthpur mandi (14.6 km from a
  Koramangala stop) loses to a rider standing on the customer's street, whose trip is 29 km. If riders set
  out from the warehouse with the day's boxes already loaded, nearest-to-customer is right; if they fetch
  each box, shortest trip is. The code can switch to trip length in one line (`choose` already computes it).
- **Q2. Is a signed-out or revoked rider off duty?** The rule only asks for a RIDER role and a position
  under 3 hours old, so a rider who signed out ten minutes ago still gets stops. Ending the day could clear
  their position, or candidates could be limited to riders with a live phone, but panel-only rider accounts
  (no phone, assigned by hand) would then never be chosen.
- **Q3. A load limit?** Nearest-first can give one rider every stop in their area while others idle.
  ASSUMPTIONS 23c already notes a limit as a follow-up; what is a bag's capacity (boxes), and should a full
  rider drop out of the candidates or only lose ties?
- **Q4. Riders without a position.** While any rider has a fresh position, riders without one are never
  used. Should an idle rider with no position (a panel-only account, a dead phone) be preferred over a
  placed rider who is far away or heavily loaded, say beyond N km or N stops?
- **Q5. A 3-hour window, and GPS accuracy.** A rider whose last fix is 3 h 1 min old counts as nowhere,
  even if it is next door; a fix with 5 km accuracy (a coarse network location) counts like a precise one.
  The rider app reports every 20 s while open, so a stale position usually means the app was closed; is 3 h
  the right window, and should coarse fixes (say accuracy over 500 m) be ignored?
- **Q6. Assigning tomorrow's stops.** Auto-assign for a future date uses where riders are now. If managers
  assign the evening before, the choice is by where riders happened to be at that moment.
- **Q7. Near-ties.** Two riders 10 m apart in distance are told apart by that 10 m, not by load; GPS
  accuracy is worse than that. A tolerance (within 100 m, prefer fewer stops) would spread load better.
