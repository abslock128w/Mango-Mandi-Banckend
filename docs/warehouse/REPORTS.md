# Warehouse reports

All computed from boxes, events and the stock counters when asked.

- **Overview**: boxes awaiting receipt, in stock, sellable, awaiting QC,
  failed or in review, picked, packed, returned, expiring within 2 days;
  lots in progress; open sessions by type; orders waiting to be picked.
- **Pick queue**: paid (or replacement) orders with labelled stock still to
  pick, by delivery date. **Pick list** per order: per item how many are
  left and the boxes to take, oldest reserved batch first, with their place.
- **Exceptions**: orders short of labelled stock (at risk), held boxes still
  on an order, lots with boxes unreceived after 24 hours, pack or dispatch
  sessions idle over 15 minutes, lots with boxes expiring within 2 days,
  WhatsApp messages that failed in the last 3 days, write-offs waiting for
  approval, sellable boxes left in staging, packing or receiving for over
  2 hours, open investigations.
- **Reconciliation**: see INVENTORY.md "Checking it". `clean: true` means
  every check passed.
- **Trace**: back from a box (lot, batch, supplier, harvest date, parent
  boxes, every event, the orders it was on) and forward from a lot (every
  box and descendant, its state and place, and the orders boxes went to).
- **Recalls**: hold every box of chosen lots that is still here (200 per
  call, Continue for more), list the orders boxes already went to, and
  release only the recall's own holds.
- **CSV**: boxes, events (date range, IST days), lots, reconciliation.
