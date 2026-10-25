# Measurements

Run with `node scripts/warehouse-bench.mjs` (mango-api) on 2026-10-25 in the
Claude Code sandbox: the API in-process over HTTP, local Postgres 16 on the
same machine. Real hosting (Vercel functions to Neon over the
network, through the pooler) adds round-trip time to every query, so treat
these as lower bounds and re-measure on staging.

Two runs. Run 2 is after lot-wide QC and put-away were split into chunks
of 400 boxes per request (call again while the answer says `more`).

| What | Run 1 | Run 2 |
|---|---|---|
| Intake, 2000 boxes in one request | 291 ms | 280 ms |
| Intake, 5000 boxes (1 create + 4 continue requests) | 728 ms | 680 ms |
| Label PDF, 1000 labels | 1249 ms, 12.8 MB | 1275 ms, 12.8 MB |
| Receive scans, 50 per request, one request at a time (p50 / p95 per request) | 543 / 620 ms | 479 / 553 ms (about 10 ms per scan) |
| Receive scans, 4 requests in flight, 1000 scans | 11.7 s (p50 2.2 s per request) | 10.9 s (p50 2.1 s) |
| QC pass of a 2000-box lot | 12.7 s, one request | 11.9 s over 5 requests, slowest 2.5 s |
| Put away a 2000-box lot | 5.6 s, one request | 5.8 s over 5 requests, slowest 1.2 s |
| Pick race: 20 sessions × 3 scans over the same 10 boxes at once | 216 ms; 10 accepted, 0 picked twice | 203 ms; 10 accepted, 0 picked twice |
| Reconciliation over 7000 boxes | 3.1 s, clean | 135 ms, clean |
| Overview / exceptions / pick list | 121 / 8 / 6 ms | 107 / 8 / 6 ms |
| CSV of every box (7000) | 83 ms, 927 KB | 77 ms, 927 KB |

The reconciliation time differs a lot between runs (3.1 s and 135 ms on the
same data size); the cause was not investigated. Re-measure it on staging.

## What this says

- Correctness under contention held: no box was picked twice and the books
  were clean afterwards.
- Scans of one session are serialised, so more requests in flight do not
  speed one session up; separate staff each get their own session.
- Lot-wide QC and put-away are the slow paths (each box checks the sellable
  rule before and after its change). They now run 400 boxes per request,
  so no request took over 2.5 s locally. A set-based version would be faster
  overall; not done.
- Label PDFs are large (vector squares per QR module): print in parts of a
  few hundred on slow connections.
