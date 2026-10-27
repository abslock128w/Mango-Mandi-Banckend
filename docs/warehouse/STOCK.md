# How stock is counted

One page on the stock engine (`mango-api/src/inventory.js`). For labelled boxes
on top of it, see [INVENTORY.md](INVENTORY.md).

## The counters

Each batch line (`batch_lines`: one product in one delivery) has four counters.

| Counter | Meaning |
|---|---|
| `on_hand` | Boxes physically in the store (or due on a truck still in transit). |
| `held` | Boxes taken by unpaid orders, for the 10-minute hold. |
| `committed` | Boxes promised to paid orders, not yet packed. |
| `reserve_buffer` | Boxes kept back from sale on purpose (staff set it on the batch). |

Free to sell = `on_hand` − `held` − `committed` − `reserve_buffer`. Stock in
transit counts at the forecast confidence (85% by default) until it arrives.
Packed boxes have already left `on_hand`.

## Order stock states

`order_stock` says which boxes each order has, on which line.

| State | Meaning |
|---|---|
| `held` | Taken at checkout, waiting for payment. Counts in `held`. |
| `committed` | Paid. Counts in `committed`. |
| `packed` | Off the shelf and with the order. No counter; `on_hand` already dropped. |
| `released` | Given back (cancel, expiry, swap). Counts nowhere. |

There is no "dispatched" or "delivered" stock state. Once boxes are packed, the
order's own status (`orders.status`: PACKED, SHIPPED, OUT_FOR_DELIVERY,
DELIVERED, RTO) says where they are. For products without labels this is the
only record. For labelled boxes, each box also has a lifecycle (picked, packed,
dispatched) that the box check compares with the packed units.

## Which ledger event moves which counter

Every movement writes a `batch_ledger` row in the same transaction. The ledger
is append-only (a trigger refuses UPDATE, DELETE and TRUNCATE).

| Event | Counter | When |
|---|---|---|
| INTAKE | `on_hand` + | A batch is received. |
| ADJUST | `on_hand` ± | A count change, a short arrival, a box made sellable or not. |
| PACK | `on_hand` − (and `committed` −) | Boxes packed for an order. |
| RESTOCK | `on_hand` + | Packed boxes put back on the shelf. |
| CONDEMN, RETIRE | `on_hand` − | A batch written off (bad fruit, or too old). |
| ADJUST_BUFFER | `reserve_buffer` ± | The buffer changes. |
| HOLD, COMMIT, RELEASE | `held` / `committed` (a record only) | Checkout, payment, give-back. |
| STATUS | nothing (delta 0) | A batch status change or a repair note. |

`on_hand` moves only through the first six (`ON_HAND_EVENTS` in inventory.js).
HOLD, COMMIT and RELEASE are kept for the story; `held` and `committed` are
checked against `order_stock`, not the ledger.

## What the audit checks

`auditLedger()` runs every hour (maintenance `runAudit`) and on Needs attention.
For every line it checks:

- `on_hand` = sum of the ledger's INTAKE, ADJUST, PACK, RESTOCK, CONDEMN and RETIRE rows;
- `reserve_buffer` = sum of the ADJUST_BUFFER rows;
- `held` = the line's `order_stock` rows in state `held`;
- `committed` = the line's `order_stock` rows in state `committed`.

Drift pages through Sentry at most hourly and lists the line on Needs
attention, where a manager can repair it from the ledger. A test
(`test/inv-review.test.js`) lists every file that runs `UPDATE batch_lines`,
so a new code path cannot change a counter without review.

With `WAREHOUSE_V2` on, the same hourly run also runs the box check
(`reconciliation()` for each active warehouse): `on_hand` of each tracked line
must equal its sellable labelled boxes, and boxes on orders must match the
packed units. A mismatch pages at most hourly and shows on Needs attention as
"Labelled boxes disagree with the stock counts". `ops/restore-check.sh` checks
the same on_hand against boxes rule on a restored backup.

## Nothing is oversold

Two guards, so two buyers can never take the same box:

1. **The conditional update.** `allocate()` takes stock with
   `UPDATE batch_lines SET held = held + n WHERE id = … AND free >= n`. If
   someone else took it first, no row changes and it re-reads and retries.
2. **The database CHECK.** `batch_lines_no_oversell`:
   `on_hand - held - committed - reserve_buffer >= 0`. Any code path that
   would oversell fails, whatever it does.

## Hold expiry

An unpaid order holds its boxes for 10 minutes (by default). The boxes come back three ways:

- **On read.** Availability counts boxes held by an expired hold as free
  (`expired_held` in inventory.js), so the shop shows them right away.
- **At checkout.** Before an order takes stock, it cancels expired unpaid
  orders on the same products (`sweepExpiredHoldsFor`), so the boxes shown as
  free can really be bought.
- **By the job.** The every-minute maintenance run cancels every expired
  unpaid order (`sweepExpiredHoldsEach`).

An order with a Razorpay order or link gets a 2-minute grace after its hold
before it is swept, as its webhook may be late. A payment after the hold still
confirms the order (it moves to the next day with stock if need be).

## Cancel, return and failed delivery

- **Cancel before it leaves** (PAYMENT_PENDING to PACKED): held and committed
  stock is released; packed boxes go back on the shelf (RESTOCK). Labelled
  boxes wait at pick staging until someone puts them away.
- **Cancel after it left, or RTO**: the boxes are not put back by themselves.
  The order shows on Needs attention under "Returned boxes to book". Staff
  either restock them (only while the batch is on sale) or write them off.
- **Returned labelled boxes are not resold by default** (D7,
  `restockable_returns = false`). They go on a return hold, then disposal. A
  product can allow resale.
- **Failed delivery**: the order is retried on the next delivery day. If the
  packed boxes would be too old by then, younger boxes are taken and packed for
  the retry, and the old ones are booked back on the shelf at once (too old to
  sell, they retire with their batch). With no younger stock the order goes
  at risk for a manager. Labelled boxes that are too old are left to a
  manager, who swaps them by scan.
- **Refunds** follow the business rule: only a customer cancel before packing,
  or a manager cancelling what we cannot deliver. Problems with delivered
  fruit are settled by replacement. No partial refunds.

## Oldest first and best-before

- **FEFO.** Stock is taken oldest batch first (by plucked date), at checkout
  and at payment.
- **Sale limit.** A box sells only if, on its delivery date, it is no older
  than `maxSellableAge` days from plucking (7 by default), and no older than
  its product's `shelf_life_days` when that is set and shorter. Day N of the
  limit still sells; day N + 1 does not. The shop's catalogue, checkout,
  payment, rebalancing and the forecast all use the same rule (`sellableAs`,
  `saleLimitDays`).
- **Best-before.** A labelled box's `best_before` is its plucked date plus the
  same limit. A pick refuses a box past its best-before on the delivery date.

## Lock order

Every transaction locks `batch_lines` rows in one order: product code
(byte order), then plucked date, then batch, then line (`LINE_LOCK_ORDER`).
That is the order `allocate()` takes them in, so checkout, payment, cancel
and batch operations wait for each other instead of deadlocking. Order rows
are locked before stock lines.
