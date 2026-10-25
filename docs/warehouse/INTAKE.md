# Taking a delivery in

Staff enter a delivery once per product; the server makes every box.

1. **Warehouse → Receive.** Choose the product, the number of boxes, the
   harvest date, the received date (today by default), the supplier, and
   the box weight if it differs from the product's. The preview shows the
   total weight and the best-before date (harvest + the product's shelf life,
   or the shop's 7-day sale limit).
2. **Create.** The server creates a lot (one product of one delivery, 1:1
   with a batch line) and every box with a unique code and label token. Up
   to 2000 boxes are made in the request; bigger lots (up to 5000 by
   default, `WAREHOUSE_MAX_LOT`) are made 1000 at a time with **Continue**,
   and a dropped connection loses at most one chunk (the next call carries
   on). The form sends an Idempotency-Key, so a double tap or a retry
   returns the same lot.
3. **Print labels** (`/lots/:id/labels.pdf`, 1000 per file, roll or A4).
4. **Receive.** Scan each box in a Receive session, or a supervisor confirms
   the count without scanning (marked `count_confirmed` in every report).
   Missing boxes are voided (their labels stop working); extra boxes are
   added to the lot.
5. **QC.** Pass the whole lot in one action, naming the exceptions; fail or
   review single boxes in a QC scan session with reason codes from the
   product's checklist. A weighed box outside the product's tolerance
   (±3% by default, D2) goes to review instead of passing.
6. **Batch ripeness QC.** The existing batch QC reading is still what makes
   the batch sellable by delivery date (DECISIONS B1).
7. **Put away** the whole lot to a storage, cold or ripening location. Only
   now do the boxes count as stock.
8. **Close** the lot once every box is received or voided.

A lot existing never adds stock. Mistakes: the supplier can be corrected at
any time before a box leaves; the product only before anything is received
(all labels must then be reprinted). A whole lot can be voided while no box
has left stock.

## Existing stock (legacy lots)

Stock already counted on a batch is labelled with a **legacy** intake on that
batch, with tracking still off. Once every box is received, QC-passed and put
away, the product's tracking can be turned on: the server refuses unless
every open line's on_hand equals its sellable boxes and no packed stock is
waiting on open orders (ROLLOUT.md).
