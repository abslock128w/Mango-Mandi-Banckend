# Rider app: plan

Branch `claude/rider-app-07905d`. Extends the delivery backend that already exists
(delivery-proof.js, admin/deliveries.js, notify.js, photos.js); nothing is duplicated.
Assumptions are in ASSUMPTIONS.md.

## Phases (one commit each)

1. **API data + delivery proof**: migration 053, hashed codes, photo steps, pickup, stricter `recordDelivery`.
2. **API mango check, rider auth, location, live feed**.
3. **API WhatsApp** (two templates, send-now on pickup, message ids), photo purge job, unit tests.
4. **rider-app/** (Next.js 16 PWA). Built in parallel with phases 1-3 against the contract below.
5. **Panel** (Deliveries live view, Proof on order detail, Staff devices, Today toasts) and **shop** line.
6. **Verification**: local stack, 390 px rider walk-through, 1280 px panel, Playwright, Lighthouse, screenshots in docs/rider-app/.
7. **Docs**: ASSUMPTIONS.md, rider-app/README.md, deploy/VERCEL.md, docs/whatsapp/TEMPLATES.md, docs/order-states.md.

## Data (migration 053, additive only)

- `delivery_photos`: `step` (pickup | door | open_box | attempt), `lat`, `lng`, `accuracy`, `taken_at`,
  `verdict JSONB`, `needs_review BOOLEAN DEFAULT false`, `check_passed BOOLEAN`, `checked_at`,
  `client_id` (unique per order: idempotent uploads), `attempt INT` (delivery attempt the photo belongs to).
- `orders`: `delivery_code_hash TEXT`, `delivery_code_nonce TEXT`, `handover_override_by/_at/_reason` (leave at door).
  The plaintext `delivery_code` is no longer written. The 4 digits are `HMAC(pepper, orderId:nonce) mod 10000`,
  re-derived for the shop page and the WhatsApp code message; checked by `SHA-256(pepper:orderId:code)` timing-safe.
  `migrations-pending/056_drop_delivery_code.sql` drops the column in the next release (n-minus-1 rule).
- `admin_users`: `phone` (unique), `display_name`.
- `rider_otps (phone PK, code_hash, expires_at, attempts)`.
- `rider_devices (id, rider_id, device_id, label, pin_hash, pin_failures, refresh_hash, unlocked_until, last_seen_at, created_at, revoked_at)`.
- `rider_locations (id, rider_id, lat, lng, accuracy, at)`.
- `notifications.kind` gains `DELIVERY_CODE` and `GIFT_DELIVERY_CODE`.

## API contract (base `/admin/v1`, bearer staff access token)

Rider auth (public, before the staff gate):
- `POST /rider/otp/request {phone}` → `{sent:true, channel, devCode?}` (same answer for unknown numbers; nothing sent).
- `POST /rider/otp/verify {phone, code, deviceId}` → `{setupToken, rider:{id, name}}` (10-minute token to set a PIN).
- `POST /rider/pin/set {setupToken, deviceId, pin}` → `{accessToken, expiresIn, refreshToken, rider}`.
- `POST /rider/pin/unlock {deviceId, refreshToken, pin}` → same shape; 5 wrong PINs revoke the device (OTP again).
- `POST /rider/session/refresh {deviceId, refreshToken}` → same shape; only within 12 h of the last PIN unlock.

Rider routes (role RIDER, riderScope):
- `GET /manifest?date=` (existing). Each order now also has `pickup`, `proof` (photos by step with verdict), `codeTriesLeft`, `riderName`.
- `POST /orders/:id/photos/token {step, clientId, lat?, lng?, accuracy?, takenAt}` → `{mode:'blob', pathname, clientToken}` or `{mode:'direct'}`.
- `POST /orders/:id/photos` either raw `image/jpeg` body with headers `X-Step`, `X-Client-Id`, `X-Lat`, `X-Lng`, `X-Accuracy`, `X-Taken-At`,
  or JSON `{pathname, step, clientId, lat, lng, accuracy, takenAt}` after a Blob upload → `{id, step, duplicate}`. Idempotent by clientId.
- `POST /webhooks/blob/delivery-photos` (public, signed by Blob): onUploadCompleted, same finalize as above.
- `POST /orders/:id/pickup {clientId}` → `{status:'OUT_FOR_DELIVERY', messages:[{kind, status, providerId, deliveryStatus}]}`. Idempotent.
- `POST /orders/:id/photos/:photoId/check {continueForReview?}` → `{passed, needsReview, failures, canContinue, reason, verdict, mode}`.
- `POST /orders/:id/delivery` (existing): code path needs door + open_box (passed or needs_review); 3 tries; 429 `CODE_LOCKED`.
- `POST /rider/location {lat, lng, accuracy, at}` → `{stored}` (one row per 20 s).

Panel:
- `GET /deliveries/live?date=&since=` → `{cursor, changed:[orderId], stops:[…], riders:[{id, name, lat, lng, at}]}`.
- `POST /orders/:id/handover-override {reason}` (manager): allows photo-and-recipient delivery (leave at door).
- `GET /staff/:id/devices`, `POST /staff/:id/devices/:deviceId/revoke`, `PATCH /staff/:id {phone, displayName}`.

## Mango check

`claude-haiku-5-5` via `@anthropic-ai/sdk`, image resized to 1024 px, expected varieties and ripeness in the prompt,
JSON `{isMango, mangoCount, boxVisible, boxOpen, damage, confidence, reason}`, no faces. Pass = isMango && boxOpen &&
confidence ≥ 0.7. `MANGO_CHECK=on|off|shadow` (default shadow without a key). Error or 6 s timeout: pass with needs_review.
After 2 failed checks for the order, `continueForReview` marks the photo needs_review.

## WhatsApp

Pickup: `setOrderStatus(OUT_FOR_DELIVERY)` queues `OUT_FOR_DELIVERY` (utility, no code: name, order number, rider first
name, slot words; Track order button) and `DELIVERY_CODE` (authentication `mandi_delivery_code`, copy-code button,
expiry 90 min, TTL 900 s) in the outbox, then the pickup route sends exactly those rows at once through the existing
sender. Failures stay in the outbox for the retry pass. Provider ids land in `notifications.provider_id`, statuses
from the webhook in `delivery_status`.
