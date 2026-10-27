# Staff authorization, step-up and the audit trail

How the API decides who may do what, when a manager must confirm it is them, and what is written down.
Every route with its roles is in the generated [authorization-matrix.md](authorization-matrix.md).

## Who may call a route

- Managers may call every staff route. Every other role gets only the routes listed for it in
  `mango-api/src/access.js`. Anything not listed is refused (403), so a new route is closed until someone lists it.
- The policy is snapshotted in `mango-api/test/fixtures/role-policy.json`. `test/auth-matrix.test.js` calls every
  route as every role and checks the answer against it. After a deliberate change, run
  `UPDATE_ROLE_POLICY=1` with that test, then `node scripts/auth-matrix-doc.js` in `mango-api`, and review both diffs.
- A path parameter in the allowlist matches only its own format: an id is letters, digits, `_` and `-` (at most 64),
  a pincode is 6 digits, a date is `YYYY-MM-DD`. A dot, an encoded slash or anything else is refused for that role.
- Riders and packers also only see the orders on their run (`riderScope`), and customers only their own things.

## Step-up: "Confirm it's you"

Some changes ask the manager for their two-step code again, or their password if two-step is off. The panel shows a
"Confirm it's you" dialog and sends the same change again with `confirmCode`. Five wrong answers lock step-up for
15 minutes. A code is only checked after the change itself is checked, so a typo does not spend it.

The one list of these routes is `STEP_UP_ROUTES` in `mango-api/src/admin/policy.js`. `test/step-up-routes.test.js`
calls each one: without the confirmation it answers `403 REAUTH_REQUIRED` and changes nothing.

These always ask, even with `STAFF_STEP_UP` off, because they move money or set prices:

- cancelling a paid order or a paid booking (the full refund), refunding a payment that matches no order, recording a
  refund paid another way, signing every staff member out;
- adding or removing a product, and changing its price, GST rate or HSN code (a rename does not ask);
- adding or changing a promo code;
- adding a bulk deal, and changing its tiers or quantities (a new title does not ask);
- saving the shop rules (`PUT /config`);
- recording or changing what a batch cost;
- turning a feature switch on or off.

Staff account changes (adding, removing, a role or password, two-step resets and setup codes) ask when
`STAFF_STEP_UP` is on. Unset, it is on in production and off elsewhere.

## Refunds

There are only two refunds: a customer cancelling their own paid order before it is packed, and a manager cancelling
an order or booking we cannot deliver. Both are in full. Partial refunds are intentionally not offered: a problem with
delivered fruit is settled with a replacement.

## The audit trail

- Every successful staff change is written to `staff_audit`: who, their role, the route, the target and the body with
  passwords, tokens and confirmation codes removed. With `STAFF_AUDIT_TRAIL` on (the default in production), the row
  is written in the change's own transaction, so there is no change without its row. Views of customer details are
  recorded too (see the matrix).
- Changes that replace a value keep what was there before, in `detail.before`, written in the same transaction:
  a staff role, the shop rules (only the rules that changed), a promo code, a slot, a pincode, a batch purchase and a
  product.
- The table is append-only (migration 046). A row cannot be deleted, the table cannot be truncated, and a row cannot
  be edited. The one exception is the privacy scrub (`src/privacy.js`), which may only take keys out of `detail`
  when an account is deleted or old orders are anonymised. For a supervised repair, a role that owns the table can
  lift the guard for one transaction with `SET LOCAL mango.staff_audit_override = 'on'`. The app's `mango_app` login
  does not own it, so the setting does nothing for the app.
- A CSV export writes `EXPORT <kind>` before the file starts and `export.finished` with the row count after it.

## Sessions

- Access tokens last 15 minutes. Refresh tokens rotate on each use; a rotated token used again after a short grace
  window signs that person out everywhere.
- A sign-in lasts at most `STAFF_SESSION_MAX_DAYS` (7) for staff and `CUSTOMER_SESSION_MAX_DAYS` (90) for customers,
  however often it is refreshed. The refresh token carries the time the sign-in began, and each rotation keeps it.

## Rate limits

- Sign-in, login codes and refresh have their own limits (`mango-api/README.md`).
- Checkout quotes, order confirms and customer cancels are limited per signed-in customer, not per address:
  `CUSTOMER_ACTION_LIMIT` (20) a minute for each. CI raises it for the end-to-end job.

## Production defaults

`STAFF_TWO_STEP` (all), `STAFF_STEP_UP` and `STAFF_AUDIT_TRAIL` are on in production when they are left unset.
Writing `false` still turns one off, and the preflight check warns about it.
