# Scan sessions

A scan session (an *operation*) has a type and a context fixed when it
starts. A new destination, order or QC result is a new session.

| Type | Context | Class | What an accepted scan does |
|---|---|---|---|
| receive | lot, receiving location | immediate | generated → in_stock |
| move | destination location | immediate | Moves the box (rules in `moveProblem`) |
| qc | result (passed, failed, needs_review), reason codes, note | immediate | Sets quality; a pass releases only the QC hold |
| pick | order (paid, or a free replacement) | immediate | Takes one reserved unit; box → picked; order → PROCESSING |
| unpick | order, reason | immediate | Box back to in_stock at pick staging; order rebalanced |
| pack | order | staged | Stages the box; finalize packs all of them |
| dispatch | order | staged | Stages the box; finalize dispatches all and ships the order |
| return | order, returns location | immediate | dispatched → returned with return_hold |
| stocktake | location (snapshot time) | staged | Counts the box; finalize corrects what was found and proposes what was not (STOCKTAKE.md) |
| repack | repack place, reason code, note | staged | Puts the box in; finalize makes the new boxes and ends the sources (REPACK.md) |

**Immediate** sessions commit each accepted scan in its own transaction.
**Staged** sessions change nothing until **Finalize**, which re-checks every
box under locks, requires the complete set for the order (INCOMPLETE_SET
lists what is missing; STALE_SCAN if a box changed since it was scanned) and
applies everything in one transaction. If the order cannot ship (too old,
condemned batch, at risk), nothing changes and no message is sent. One open
pack or dispatch session per order; starting again resumes your own.

## Retries and duplicates

The device makes a `scanId` (UUID) for every physical scan before sending.
Sending the same scanId again returns the stored result and changes nothing,
so the client retries freely after a timeout. A box already scanned in the
session is a `duplicate`. Up to 50 scans per request; the panel keeps up to
4 requests in flight.

## Results

Each scan answers `accepted`, `warning` (applied, with something to know),
`rejected` (nothing changed) or `duplicate`, a code and a message for staff.

| Code | Meaning |
|---|---|
| OK | Done |
| ALREADY_SCANNED | Same box twice in this session |
| UNKNOWN_CODE / MALFORMED_CODE / INVALID_CHECK_DIGIT / TOO_LONG | Not a valid MandiMangoes label (or a typo in a typed code) |
| LABEL_REVOKED | An old label replaced by a reissue |
| WRONG_LABEL_TYPE | A location label; `detail.location` lets a move session switch destination |
| WRONG_WAREHOUSE | Box belongs to another warehouse |
| WRONG_BATCH / ALREADY_RECEIVED | Receive problems |
| LOCATION_TYPE_NOT_ALLOWED / LOCATION_INACTIVE / ALREADY_AT_LOCATION | Move problems |
| QC_OVERRIDE_REQUIRED / SELF_APPROVAL / WEIGHT_OUT_OF_TOLERANCE | QC rules |
| PAYMENT_NOT_CAPTURED / WRONG_VARIANT / LINE_ALREADY_FULFILLED / EXPIRED / BOX_ON_HOLD / QC_NOT_PASSED / ALLOCATED_TO_OTHER_ORDER | Pick rules |
| NON_FEFO | From another batch than reserved: rejected until a reason is sent (`detail.needsReason`), then a warning |
| STOCK_INSUFFICIENT | The box's batch is fully promised elsewhere |
| NOT_PICKED / NOT_PACKED / NOT_FROM_THIS_ORDER / STAGED_ELSEWHERE | Pack and dispatch; STAGED_ELSEWHERE is also a repack warning (the box is in another open repack) |
| FOUND_ELSEWHERE / FOUND_MISSING / RECORDED_GONE | Stocktake warnings: what finishing the count will do with the box |
| OPERATION_LOCKED | Not a scan result: starting a count of a place someone else is counting |
| RATE_LIMITED | More than 20 unknown labels in a minute by one person |
| OPERATION_CLOSED | The session expired (30 idle minutes), was cancelled or completed |

## Undo

**Undo** reverses the session's last accepted scan while it is still that
box's latest change (receive, move, QC and pick); a staged scan is simply
unstaged. The reversal is new events (UNDONE), never an edit.

## Camera scanning (9.7)

Behind `WAREHOUSE_CAMERA_SCAN` (default off; `GET /warehouse/settings` →
`features.cameraScan`). On every scan screen, **Use camera** reads QR labels
with the browser's own `BarcodeDetector` (format `qr_code`). Each code read
is put in the **same queue as a hand scanner** (`scanQueue.ts`): it gets its
own scanId, is retried with that scanId, beeps, and a rejected one stops the
queue until someone presses Continue. The server cannot tell a camera scan
from a typed one, so every rule above applies unchanged.

- The same code is not sent again while it stays in view, nor within 2 seconds
  of last being seen (`codeGate`, `src/warehouse/camera.ts`).
- The camera starts only when asked, prefers the back camera, and is released
  when the screen closes, when the page is hidden (another tab, phone locked),
  and on **Stop camera**.
- **Light** (torch) and a camera choice appear only where the device offers them.
- Without https (`isSecureContext`), without `BarcodeDetector` or its QR
  format, with no camera, or when permission is refused, the screen says why
  and how to carry on; the hand scanner and typing keep working throughout.
  Chrome and Edge on Android have the detector; most other browsers do not
  (DECISIONS N9: no JavaScript decoder is bundled).
