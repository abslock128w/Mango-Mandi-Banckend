# Rider app: proof of pickup and delivery

The riders' phone app (`rider-app/`) and what it changes in the API and the panel.
Setup and env vars: [rider-app/README.md](../../rider-app/README.md) and
[deploy/VERCEL.md, step 9](../../deploy/VERCEL.md#9-the-rider-app-fourth-project).
Decisions and their reasons: [ASSUMPTIONS.md](../../ASSUMPTIONS.md).

## The flow

1. **Sign in** on the rider's own phone: mobile number, a 6-digit code (WhatsApp, SMS fallback),
   then a 4-digit PIN for that phone. Later the app opens with the PIN.
2. **Today**: the rider's stops for the day, the current one on top with Navigate and Call.
3. **Pickup** at the warehouse, per order: a photo of the sealed box, then **Picked up**. The order
   goes `SHIPPED → OUT_FOR_DELIVERY`, the 4-digit code is made (stored hashed), and the customer gets
   two WhatsApp messages at once: the out-for-delivery update (with the rider's first name and a Track
   order button) and the code in its own authentication message. The app shows each message's status.
4. **At the door**: a photo of the box as handed over, then a photo of the opened box. Claude Haiku
   checks the open-box photo for an open box of mangoes. A failed check asks for a retake with the
   reason; after two, the rider can continue and the delivery is flagged for review.
5. **The code**: the customer reads it once they have seen their mangoes. Three wrong codes lock the
   order: the rider calls ops.
6. **Not home**: a reason (and optionally a photo); the order retries on the next delivery day as before.
   Leaving the box needs a manager's OK for that order (Deliveries → Allow leave at door).

Every photo carries the phone's GPS and the time at the shutter. Everything the rider does is queued on
the phone and sent when there is signal, so a dead zone between stops loses nothing.

## Who gets which stop

On Deliveries, **Assign nearest riders** gives every stop without a rider to the rider nearest to it
(where the rider app last reported him in the past 3 hours) and picks the warehouse that makes his trip
shortest: rider → warehouse → customer. The rider app then says "Collect from <warehouse>" with
directions there, and after the pickup, directions to the customer. A stop is placed at its pincode's
centre (`pincodes.lat/lng`, seeded for Bengaluru); warehouses need `warehouses.lat/lng`. A stop given to
a rider by hand (the Rider picker) is never moved; one whose rider was removed from Staff, even out for
delivery, is given out again. The full rule, its edge cases and the open questions: `docs/qa/nearest-rider.md`.

## On the panel

- **Deliveries**: refreshes every 10 seconds. Each stop shows its pickup, door and open-box photos, the
  mango check and its confidence, each WhatsApp message (sent, delivered, read, failed), and the rider's
  last position. A yellow **Needs review** chip opens the existing delivery review.
- **Order**: a Proof section with every photo, its GPS, times and the check's full answer.
- **Staff**: a rider's number and name, and the phones they are signed in on, with Revoke.
- **Today**: a short notice when a stop is picked up or delivered.

## Mango check modes (`MANGO_CHECK`)

| Mode | What happens |
|------|--------------|
| `shadow` (default; always without `ANTHROPIC_API_KEY`) | The answer is stored and shown on the panel; it never blocks the rider |
| `on` | A failed check means retake; after two failures the rider continues and it is flagged |
| `off` | No call; the step passes |

A model error or no answer in 6 seconds passes the step, flagged for review.

## Screenshots

Taken on 30 Oct 2026 from real orders walked end to end on a local stack (API, panel, shop and
rider app, `WHATSAPP_PROVIDER=log`), with `rider-app/e2e/live-walkthrough.mjs` (390 px) and
`tests/rider-app-live-walkthrough.mjs` (1280 px).

Rider app, 390 px (ORD-1003, mango check in shadow mode: no key):

| | |
|---|---|
| [Sign in](rider-01-sign-in.png) · [Code](rider-02-code.png) · [Set a PIN](rider-03-set-pin.png) | Phone, 6-digit code (shown on screen in development), PIN |
| [Today](rider-04-today.png) | Current stop with Navigate and Call |
| [Pickup photo](rider-05-pickup-photo.png) · [Picked up](rider-06-picked-up-whatsapp.png) | Both WhatsApp messages and their status ("logged" locally) |
| [Door checklist](rider-07-stop-checklist.png) · [Door photo](rider-08-door-photo.png) · [Checked](rider-09-mango-check.png) | Steps unlock in order |
| [Wrong code](rider-10-wrong-code.png) · [Delivered](rider-11-delivered.png) | 2 tries left after a wrong code |
| [Run](rider-12-after-delivery.png) · [Run complete](rider-13-run-complete.png) | |

Shop, 390 px: [order out for delivery](shop-01-out-for-delivery.png) with the rider's name, the code and the new line.

Panel, 1280 px (ORD-1002, mango check `on` with a deliberately invalid key, so the check could not
run and the delivery was flagged for review):

| | |
|---|---|
| [Today: picked-up notice](panel-01-today-picked-up-toast.png) | Arrived 6.9 s after the rider's pickup |
| [Deliveries: live proof](panel-02-deliveries-live.png) | Photos, mango check, WhatsApp status, Needs review |
| [Needs review](panel-03-needs-review-dialog.png) | The existing delivery review, with the open-box photo |
| [Order: Proof](panel-04-order-proof.png) ([whole page](panel-04b-order-proof-full.png)) | GPS, times, verdict JSON |
| [Staff](panel-05-staff-riders.png) · [Rider number and phones](panel-06-staff-rider-phones.png) | Edit the number, revoke a phone |
