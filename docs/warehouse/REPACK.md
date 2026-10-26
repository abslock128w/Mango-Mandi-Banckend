# Repack, split, merge and partial damage

Behind `WAREHOUSE_REPACK` (default off). Code: `mango-api/src/warehouse/repack.js`;
panel: Warehouse → Repack, the Scan screen, and "Take fruit out" on a box.
Tests: `mango-api/test/warehouse-next.test.js`, `tests/warehouse-next.spec.ts`.

## A repack session

1. **Start** (`type: repack`) at a receiving, QC hold, packing or returns place
   (`REPACK_PLACES`, never a storage shelf), with a reason code
   (`spoiled_fruit`, `damaged_box`, `merge_partials`, `split`, `other`) and a note.
2. **Scan the boxes going in.** Each must be in stock and not on an order; held
   boxes are allowed (that is often why they are repacked). Another product is
   `WRONG_VARIANT`. A box already in someone else's open repack is a
   `STAGED_ELSEWHERE` warning: the first to finish gets it. Nothing changes yet.
3. **Finish** with what came out:
   `{ outputs: [{ weightG, fruitCount? }], fruitRemoved, weightLostG, note? }`
   (1–20 new boxes, up to 50 going in). In one transaction under locks:
   - every source is checked again; one that changed since its scan stops the
     finish with `STALE_SCAN` and is taken out of the session;
   - the new boxes weigh no more than what went in (plus the product's tolerance);
   - each new box gets a **new code and label** (print them from the result or
     `GET /warehouse/repacks/:id/labels.pdf`; the same label PDF as intake),
     `parent_box_ids` = the sources, the **earliest best-before** of the sources,
     and sits on the stock line of that oldest source, so FEFO keeps working;
   - every lot and batch the fruit came from is linked in `box_origins`
     (a merge links all of them);
   - QC: a new box is QC pending with a QC hold when the product requires QC or
     any source had not passed; otherwise it is passed (or needs review when
     out of weight tolerance);
   - recall and investigation holds follow the fruit (a recall still releases them);
   - the sources end as `repacked` (no location), event REPACKED with what went
     where and what was taken out; their holds are released on the ended box.

New boxes start at the repack place, so they are not sellable until put away.

## Lineage, trace and recall

`GET /warehouse/trace/boxes/:id` lists `origins` (every lot in the box) and
`descendants` (boxes it was repacked into, any depth). A lot trace and a
recall walk repack descendants through `box_origins` and `parent_box_ids`, so
recalling any lot that went into a merged box holds the merged box (tested: the
recall drill finds and holds a repacked box).

## Partial damage

`POST /warehouse/boxes/:id/damage` `{ fruitRemoved?, weightLostG?, reasonCode, reason }`
for fruit taken out without repacking. The measured weight and fruit count go
down with a PARTIAL_DAMAGE event (before and after weights in its meta). Below
the product's weight tolerance a QC-passed box goes to `needs_review`, so it
stops being sellable until QC looks again. Taking everything out is refused:
write the box off instead.
