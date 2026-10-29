# WhatsApp webhooks

Meta posts everything to one address: `POST https://<API domain>/webhooks/whatsapp`.

## Verification (once, when the webhook is set up)

Meta calls `GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`.
The API answers the challenge only when the token equals `WHATSAPP_VERIFY_TOKEN` (constant-time
compare), else 403. The verify token only proves the address is ours to Meta; it is **not** used
to trust webhook bodies.

## Every delivery

1. **Signature first.** The raw body's HMAC-SHA256 with `WHATSAPP_APP_SECRET` must equal the
   `X-Hub-Signature-256` header (constant-time). Otherwise 401 and nothing is stored or read.
   No secret set: every body is refused. The body is read raw (1 MB limit, compressed bodies
   refused) so the signature is checked over exactly what Meta signed.
2. **Stored.** The body goes into `webhook_events` (provider `whatsapp`, deduplicated by a hash
   of the body) in its own insert. From here it survives the instance: if anything after this
   fails or the instance dies, the maintenance run replays it after 5 minutes (at most 5 times,
   then it is listed for staff). A busy database answers 503 so Meta retries.
3. **Processed**, with a 2-second answer budget. Meta wants a fast 200; most events finish well
   inside it and get `{"ok":true,"handled":n}`. A slower one (Meta slow to take our replies)
   is answered `{"ok":true,"accepted":true}` and finishes in the background. Either way the
   event is marked processed only once done.

Processing is safe to repeat: each customer message is recorded once by its Meta id
(`wa_inbound` and the unique `wa_messages.provider_id`), statuses never move a message
backwards, and template status changes are idempotent upserts. A replayed or redelivered
event therefore changes nothing twice.

A webhook for another phone number id than `WHATSAPP_PHONE_NUMBER_ID` (a test number on the
same app) is ignored, and so is an object that is not `whatsapp_business_account`.

## What is handled

| Field | What happens |
|-------|--------------|
| `messages` → `messages[]` | Customer messages: text, button and list taps, quick-reply buttons, "request_welcome" (chat opened from a link), photos, documents, voice notes, videos, stickers, locations, contacts. Reactions and unsupported types are recorded, not answered |
| `messages` → `statuses[]` | sent / delivered / read / failed for every message we sent: order updates (`notifications`) and chat or staff replies (`wa_messages`). A failed status carries Meta's error code and title |
| `messages` → `statuses[]` of type `payment` | Payments on WhatsApp (only with `WHATSAPP_PAYMENT_CONFIG`): a captured payment confirms its order with the same checks as Razorpay; a payment for no known order is listed in Needs attention |
| `message_template_status_update` | Approved, rejected, paused, disabled …: written to `wa_templates` at once, so a paused template stops being used immediately (its messages are skipped with the reason) |
| `message_template_quality_update`, `template_category_update` | Recorded; a red or yellow quality alerts |
| `phone_number_quality_update`, `phone_number_name_update` | Recorded; a flag, downgrade or rejected display name alerts |
| `account_update`, `account_review_update`, `account_alerts`, `business_capability_update`, `security` | Recorded; bans, restrictions, high or critical alerts and security events alert |

Only listed keys of each event are kept (strings clipped), so an event cannot fill the table
with arbitrary data. Anything else is logged by field name and ignored.

"Alerts" means an error in the log and, with `OPS_ALERTS`, a Sentry issue; the event also
shows on the WhatsApp page under "Account and template events from Meta".

## Correlation

Every message recorded from a webhook carries the id of the stored event
(`wa_messages.correlation_id`), and every log line of the request its request id, so one
customer message can be followed from the raw delivery to the reply that went out.

## Subscribing at Meta

The app must be subscribed to the WhatsApp Business Account (the connection check shows it),
and these fields ticked in the app dashboard's WhatsApp > Configuration > Webhook fields:
`messages`, `message_template_status_update`, `message_template_quality_update`,
`template_category_update`, `phone_number_quality_update`, `phone_number_name_update`,
`account_update`, `account_review_update`, `account_alerts`, `business_capability_update`,
`security`. See [META-CHECKLIST.md](META-CHECKLIST.md).
