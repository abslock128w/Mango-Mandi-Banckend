# Upgrade check: from the previous release (main) to this branch

Run on 2 Nov 2026, local embedded Postgres 54329, database `mango_upgrade`.

1. `main` (eaf6b20) API: `migrate.js` (001 to 051) and `seed.js` with `SEED_DEMO_DATA=true`.
2. `main`'s API on port 3998 placed five orders through the shop API and walked them with the
   panel API to PAYMENT_PENDING, CONFIRMED, PACKED, SHIPPED and OUT_FOR_DELIVERY (the last with a
   plaintext delivery code, as `main` stores it).
3. This branch: `migrate.js` applied 052, 053, 054 and 055 with no error; `seed.js` ran again.
4. This branch's API on port 3997: the orders list and every order's detail, summary, attention,
   manifest, live deliveries, pack list, analytics, `/ready` and the catalogue all answer 200.

The order out for delivery keeps only its plaintext code (no hash). `delivery-code.js` falls back
to it (`codeMatches`), so the customer's code still works at the door after the deploy;
`ops/hash-delivery-codes.js` must run before `migrations-pending/056` drops the column.

Scripts: the scratchpad copies of `upgrade-orders.mjs` and `upg-smoke.mjs` are in this folder.
