# Repack, split, merge and partial damage

Behind `WAREHOUSE_REPACK` (default off). Code: `mango-api/src/warehouse/repack.js`;
panel: Warehouse → Repack, the Scan screen, and "Take fruit out" on a box.
Tests: `mango-api/test/warehouse-next.test.js`, `tests/warehouse-next.spec.ts`.

## A repack session

1. **Start** (`type: repack`) at a receiving, QC hold, packing or returns place
   (`REPACK_PLACES`, never a storage shelf), with a reason code
   (`spoiled_fruit`, `damaged_box`, `merge_partials`, `split`, `other`) and a note.
2. **Scan the boxes going in.** Each must be in stock and not on an order; held
   boxes are allowed (that is often why they are repacked). A box whose own
   batch, or any batch its fruit came from, is condemned or exhausted is
   refused (`BATCH_OUT_OF_SERVICE`): it would come out as sellable stock on
   another batch. Write it off instead. Another product is
   `WRONG_VARIANT`. A box already in someone else's open repack is a
   `STAGED_ELSEWHERE` warning: the first to finish gets it. Nothing changes yet.
3. **Finish** with what came out:
   `{ outputs: [{ weightG, fruitCount? }], fruitRemoved, weightLostG?, note? }`
   (1–20 new boxes, up to 50 going in). In one transaction under locks:
   - every source is checked again; one that changed since its scan stops the
     finish with `STALE_SCAN`, and one whose batch was condemned since with
     `BATCH_OUT_OF_SERVICE`; either way it is taken out of the session (in a
     transaction of its own, after the refused finish rolled back) and the
     next finish goes on without it;
   - **the weights add up**: what went in (measured weight, or nominal) must
     equal the new boxes plus `weightLostG`, within the product's weight
     tolerance of what went in (`weight_tolerance_pct`, 3% by default), else
     `WEIGHT_MISMATCH` (400, with `inGrams`, `outGrams`, `weightLostG`,
     `toleranceG`). Left out, `weightLostG` is recorded as what went in less
     what came out, so the record is never a made-up 0. The new boxes never
     weigh more than went in plus the tolerance;
   - **fruit counts add up** when every box going in and coming out has one:
     in − `fruitRemoved` = out, else `FRUIT_MISMATCH` (400);
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
     a box has one recall hold however many recalls reach it, so releasing one
     recall hands the box to any other recall still in force (reports.js
     `releaseRecall`) rather than freeing it;
   - the new boxes join their lot's label counts: `target_count` goes up by the
     number of new boxes and `generated` / `verified` are recounted over every
     box, the way the previous release counts a lot (see Rollback below);
   - the sources end as `repacked` (no location), event REPACKED with what went
     where and what was taken out; their holds are released on the ended box.

New boxes start at the repack place, so they are not sellable until put away.

## Condemned fruit after a merge

A merged box sits on the line of its oldest source, so condemning another
batch whose fruit is in it would not, by itself, take it off sale. When a
batch is condemned (`PATCH /admin/v1/batches/:id/status` CONDEMNED, with
`WAREHOUSE_V2` on), every box still here that holds its fruit (`box_origins`)
on another batch's line gets an **investigation hold** ("Holds fruit from
condemned batch …"), so it leaves stock and shows on Warehouse → Exceptions.
The orders of those other batches are locked first, with the condemned
batch's (INV-03). The response adds `heldRepackedBoxes`.

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
write the box off instead. A box with no fruit count needs `weightLostG`
(fruit taken out alone would change nothing on it).

## Rollback

New boxes are numbered from `REPACK_SEQ_BASE` (1,000,000, `lots.js`) on their
lot, so intake numbering (`addBoxes`, `generateMore`) stays below it and never
collides. They count in the lot's `target_count`, `generated_count` and
`verified_count` (they get the verification of their oldest source), because
the previous release recounts a lot over every one of its boxes: it would
otherwise find more boxes than labels (`generated_count <= target_count`
fails) and refuse every receive scan, added box and void on that lot. Tested
(`lot counts with repacked boxes`), and checked once by hand by loading the
previous release's `lots.js` and `reports.js` against a database with a
split: its reconciliation is clean and its `addBoxes` works.

The previous release's lot QC (`POST /warehouse/lots/:id/qc`) would also pass
repacked boxes still waiting for QC by the lot's sample (this release QCs them
only by scan). Before rolling back, QC or hold those boxes; ROLLBACK_037.sql
lists the query.
