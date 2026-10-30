# Rider app: assumptions

Decisions made while building the rider app (PLAN.md) where the brief left room or the
repository pointed another way. Each says what was assumed and why.

## Data and the delivery code

1. **Hashed code, still shown to the customer.** The brief asks for codes stored hashed and for
   the shop to keep showing the code. Both hold: only `SHA-256(pepper:dc:orderId:code)` is stored
   for checking, and the 4 digits are derived from a random nonce with an HMAC under the server
   pepper (`OTP_PEPPER`, else `JWT_SECRET`) when the shop page or the WhatsApp message needs them
   (`mango-api/src/delivery-code.js`). A database copy alone reveals no code. Rotating the pepper
   changes the codes of orders on the road, so rotate it after the day's runs.
2. **The plaintext column is dropped one release later.** Dropping `orders.delivery_code` in the
   same release would break the previous release while the deploy rolls (the repo's n-minus-1
   check). So 053 stops writing it, 054 validates the new check, and the drop waits in
   `mango-api/migrations-pending/056_drop_delivery_code.sql` with instructions.
3. **Delivery code tries reset on a retry**, as before (a missed delivery goes out again with the
   same code and 3 fresh tries).
4. **Extra columns beyond the brief's list**: `delivery_photos.attempt` (photos belong to one
   delivery attempt, so a retry starts its steps over), `client_id` (idempotent uploads),
   `check_passed` and `checked_at`; `orders.delivery_code_nonce` and `handover_override_*`;
   `admin_users.phone` and `display_name`; `rider_devices.pin_hash`, `pin_failures`, `label`,
   `unlocked_until`, `last_seen_at`, `revoked_by`; and a `rider_otps` table.

## Flow

5. **One pickup photo per order**, not per physical box: an order is the unit that goes out, and
   orders here are usually one or two boxes. The photo must be today's (IST) and for the current
   attempt.
6. **Steps unlock in order on the server**: a pickup photo only before or at pickup; door,
   open-box and attempt photos only while out for delivery; the code only once the door photo
   and an open-box photo that passed (or was flagged for review) exist for this attempt.
7. **The older paths still work**: staff can still start a whole run from the panel (Deliveries,
   Start run), which sends orders out without pickup photos (the messages go through the outbox as before).
   The rider can still add the pickup photo; "Picked up" then changes nothing and sends nothing
   again. Without the photo, "Picked up" answers `PICKUP_PHOTO_REQUIRED`; the door steps work either way.
8. **Leave at the door needs a manager's OK per order** (`POST /orders/:id/handover-override`, with a
   reason, recorded on the order's history), then a photo and who took it. The "customer said yes on
   WhatsApp" path is a manager recording that reason after reading the reply in the WhatsApp inbox;
   the chat bot does not grant it on its own (a follow-up if wanted). This also applies to the
   panel's older photo delivery, which no longer works without the OK.
9. **Three wrong codes**: the third wrong code answers 422 with `triesLeft: 0` ("call ops"), and any
   further code 429 `CODE_LOCKED`. A manager can then allow leaving it, or mark it delivered with the
   existing manager override.
10. **Unassigned stops**: a rider may photograph and pick up an unassigned packed stop, which assigns
    it to them, as the existing per-order dispatch already did.

## Mango check

11. **Shadow by default.** `MANGO_CHECK` defaults to `shadow`, and is always shadow without
    `ANTHROPIC_API_KEY`. In shadow mode the verdict is stored and shown but never blocks and never
    flags for review (flagging every shadow miss would flood the review queue while the check is
    being tuned). Recommended: a week in shadow, then `on`.
12. **"Two failed checks"** counts failed checks on the order's open-box step for the current
    attempt. The rider retakes after each; after the second the app offers "Continue for review",
    which marks that photo needs_review; the delivery then appears in the existing delivery-reviews
    queue with a "mango check: needs review" flag and the open-box photo.
13. **Model call**: `claude-haiku-5-5`, structured JSON output (schema), effort `low` for speed, no
    retries, a 6-second limit. A refusal, a cut-off answer, an API error or the timeout all count as
    "the check could not run": the step passes, flagged for review.
14. **Privacy**: the prompt tells the model to ignore people and never describe faces or read out
    text; photos are re-encoded without EXIF before storage, the GPS the app read at the shutter is
    kept in its own columns, and that GPS is cleared with the customer's other details (account
    deletion, the PII retention pass).

## WhatsApp

15. **Two messages on pickup**: `OUT_FOR_DELIVERY` (utility, no code: name, order number, rider's first
    name, slot; Track order button) and `DELIVERY_CODE` (authentication `mandi_delivery_code`, the code
    in the body and the copy-code button). A gift also sends both to the recipient. They are queued in
    the same transaction as the status change (the outbox), then the pickup route sends exactly those
    rows at once; a failure keeps its row for the retry pass.
16. **Template version guard**: the new `mandi_out_for_delivery` has the same number of variables as the
    old one (4), so the variable count can't tell them apart. The sync's `url_button` can: until Meta
    has the version with the Track order button, the update is skipped with a reason rather than sent
    with the wrong wording. The code message is unaffected.
17. **Template sync**: Meta's template list is read-only from the API today, so creating the templates
    stays a step for the owner; `scripts/whatsapp-template-definitions.mjs` prints the exact
    create-template requests, and `docs/whatsapp/TEMPLATES.md` is regenerated from the registry.
18. **Message status** shown to riders and staff is the outbox row: `SENT`/`PENDING`/`FAILED`/`SKIPPED`,
    Meta's id, and Meta's later `delivered`/`read`/`failed`. With `WHATSAPP_PROVIDER=log` (local) the id
    is `log` and the panel shows "logged". The code is never written to the log.

## Rider sign-in

19. **Phone + PIN instead of two-step**: riders sign in with a login code to their number (the
    customers' sender: WhatsApp authentication template first, SMS fallback), then set a 4-digit PIN
    on that phone. Possession of the bound phone plus the PIN is treated as their two factors, so
    riders signed in this way are not asked to set up an authenticator app even with
    `STAFF_TWO_STEP=all`. Riders can still sign in to the panel with email and password as before.
20. **Device binding**: a refresh token (stored hashed) per phone and device id; 5 wrong PINs revoke the
    phone; a refresh without the PIN works for 12 hours after the last PIN (a shift); a manager's revoke
    also ends the rider's access tokens (session version), which signs their other phones and panel
    sessions out once their 15-minute tokens lapse and refresh.
21. **Unknown numbers** get the same answer as riders' numbers (nothing is sent), so the endpoint does
    not reveal who is a rider. Rider login codes have their own table so a rider who is also a customer
    can't use one sign-in's code for the other.
22. **Demo riders**: two seeded with the local demo data (`SEED_DEMO_DATA`, development only), `ravi.rider@mandimangoes.test` (+91 90000
    00001, Ravi Kumar) and `suresh.rider@mandimangoes.test` (+91 90000 00002, Suresh Patil), password
    `rider12345`. Placeholder numbers; never seeded in production.

23a. **Demo login code**: until the WhatsApp Business account (or Jio SMS) is ready, `DEMO_OTP` (6 digits)
    makes every phone sign-in, shop and rider app, accept that one code with nothing sent; the sign-in
    screens show it. The WhatsApp settings (`WHATSAPP_PROVIDER`, `WHATSAPP_TOKEN`,
    `WHATSAPP_PHONE_NUMBER_ID`, the templates) stay in place, unused until set. A production deploy
    refuses to start with `DEMO_OTP` set, and preflight lists it as an error there.

23b. **Demo payments**: until Razorpay is set up, `DEMO_PAYMENTS=true` lets the shop's existing "Pay (test)"
    buttons settle the customer's own order through `POST /v1/orders/:id/demo-pay`. Refunds of such orders
    have no gateway to go to. Refused in production, like `DEMO_OTP`.
23c. **Nearest rider and pickup warehouse** (`POST /manifest/auto-assign`, the panel's "Assign nearest
    riders"): a stop is placed at its pincode's centre (addresses have no coordinates yet); a rider is where
    the rider app last reported him in the past 3 hours (the app now reports whenever it is open and signed
    in, not only during a run); distances are straight lines. Each unassigned stop goes to the nearest
    rider; the pickup warehouse is the one that makes rider → warehouse → customer shortest. With no rider
    position known, the rider with the fewest stops gets it. Stops already given to a rider are not moved.
    Nearest-first can give one rider many stops; a load limit is a follow-up if that matters.

## Live view and jobs

23. **Polling, not push**: the panel polls `/deliveries/live` every 10 seconds (the brief's 10-second
    target); each answer is the whole day's stops (tens of rows) plus what changed since the cursor.
24. **Rider positions**: at most one row per rider per 20 seconds (extra posts are dropped, not
    refused); kept 30 days.
25. **Photo purge**: the daily maintenance pass removes photo images older than
    `DELIVERY_PHOTO_RETENTION_DAYS` (90), plus unfinished phone uploads older than a day; the rows keep
    step, times, GPS and the verdict. Claims must be raised within a day of delivery, so 90 days leaves
    room for any dispute.
26. **Blob uploads**: the phone uploads to a private path with a 10-minute client token; Blob's
    `onUploadCompleted` callback and the phone's own report both finish the upload (whichever comes
    second is a no-op), because the callback can't reach a local API. Without Blob (local), the phone
    posts the JPEG to the API directly.

## Rider app

27. **Routes** `/pickup?id=` and `/stop?id=` rather than `/stop/[id]`, so the service worker can precache
    them and they open with no signal between stops.
28. **Reschedule** in the rider app tells the rider to call ops; moving a date stays with staff.
