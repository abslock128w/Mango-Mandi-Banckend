# How boxes and the stock counters agree

The shop sells from `batch_lines` counters (`on_hand`, `held`, `committed`,
`reserve_buffer`) and the append-only `batch_ledger`. Box tracking does not
replace them; it makes them follow the boxes.
What each counter means, which ledger event moves it and what the audit
checks: [STOCK.md](STOCK.md).

## The invariant

For a product with `box_tracking_enabled`, on every open batch line:

    on_hand = number of boxes on that line for which box_shelf_sellable() is true

Every box change that moves a box in or out of the sellable set records a
+1 or −1 for its line (`changeBox` deltas). `applyLineDeltas()` applies the
net change in the same transaction, as a ledger ADJUST with a BOX_* reason
code (BOX_RECEIVED, BOX_AVAILABLE, BOX_UNAVAILABLE, BOX_WRITE_OFF).

When a drop would leave less stock than is promised to orders (a QC failure,
a recall, a write-off of promised stock), it goes through the existing
short-arrival path instead (`recordShortArrival({ delta })`): the youngest
orders give their reservation back and are refilled from other batches,
moved to the next date with stock, or flagged at risk for a manager.
Nothing is ever oversold, and the `no_oversell` check still holds.

## Pick, pack and the reservation

The order's existing reservation (committed units, chosen FEFO at checkout
and payment) stays the source of truth for *how many*. Box scans decide
*which* boxes.

- **Pick** turns one committed unit into one packed unit on the box's line
  (committed −1, on_hand −1, ledger PACK with BOX_PICK). The box leaves the
  sellable set at the same moment, so on_hand still equals sellable boxes.
- **Pick from a different batch** (D5) needs a reason; one unit is reserved
  on the box's batch and released on the reserved one.
- **Unpick, cancel, or a move to another date** releases the packed unit
  (no counter change, ledger RELEASE with BOX_UNPICK). The box waits at pick
  staging, which is not a pickable place, so it is not stock until someone
  puts it away; the put-away adds it back (+1). The order is rebalanced and
  reserves a unit again.
- **Pack and dispatch** finalize only change the boxes and the order status;
  the counters already moved at pick.
- **Return** releases the packed unit; the box is held (return_hold) and is
  not stock (D7).

## The old buttons

For tracked products the counter-only steps are refused so nothing can
change stock without a box: Allocate (PICK_BY_SCAN), marking PACKED before
the pack finalize (PACK_BY_SCAN), dispatching before the dispatch finalize
(DISPATCH_BY_SCAN), and booking returned stock (USE_WAREHOUSE_RETURNS).
Products with tracking off work exactly as before.

## Checking it

`GET /warehouse/reconciliation` checks: on_hand against sellable boxes per
tracked line; picked/packed/dispatched boxes against packed units per order
and line; boxes in states their order cannot have; lot counts against their
boxes; and the existing ledger audit. Every API test story ends by asserting
it is clean. The hourly maintenance audit runs the same check for each active
warehouse (without the ledger part, which it checks on its own), pages at most
hourly when it is not clean, and lists the warehouse on Needs attention.
