# WhatsApp Business Platform

MandiMangoes talks to customers on WhatsApp through Meta's **WhatsApp Cloud API**, directly
(no reseller). This folder describes the whole integration.

| Document | What it covers |
|----------|----------------|
| [README.md](README.md) | Architecture, modules, data and migration (this page) |
| [CONFIGURATION.md](CONFIGURATION.md) | Every setting, where its value comes from at Meta |
| [TEMPLATES.md](TEMPLATES.md) | Every automated message: template, category, variables, wording (generated) |
| [WEBHOOKS.md](WEBHOOKS.md) | How Meta's webhook is checked, stored, processed and replayed |
| [CONSENT.md](CONSENT.md) | Who may be sent what; STOP, START, opt-ins and their evidence |
| [CONVERSATIONS.md](CONVERSATIONS.md) | The 24-hour window, handoff to staff, the inbox |
| [ORDERING.md](ORDERING.md) | Ordering, payment and order questions in the chat |
| [RELIABILITY.md](RELIABILITY.md) | Retries, duplicates, timeouts, outages |
| [SECURITY.md](SECURITY.md) | Secrets, signatures, privacy, retention, access |
| [OPERATIONS.md](OPERATIONS.md) | The panel's WhatsApp page and day-to-day work |
| [TESTS.md](TESTS.md) | What is tested, how, and what is not verified yet |
| [META-CHECKLIST.md](META-CHECKLIST.md) | Everything to set up at Meta |
| [ACTIVATION.md](ACTIVATION.md) | The one-day runbook to switch it on |
| [ROLLBACK.md](ROLLBACK.md) | Turning it off, rolling back, and incident recovery |

## What it does

- **Order and payment updates** (templates): confirmation (which is also the payment
  confirmation), date moves, out for delivery with the delivery code, delivered, missed
  delivery, cancelled, refund started, bookings ahead, claims, help replies, subscriptions,
  back in stock, ripeness guide, and the opt-in reminder and review request.
- **Two-way chat**: customers order, book ahead, ask where their order is, about payments,
  refunds and delivery, and cancel, all answered from their own records.
- **Support handoff**: "agent", "talk to a person", a photo or a voice note hands the
  conversation to staff. The bot then stays quiet until staff hand it back.
- **Staff inbox and set-up** on the panel's WhatsApp page.
- **Login codes** by WhatsApp (authentication template) when SMS is not used or fails.

## How it fits together

```
Meta Cloud API ── webhook (signed) ──▶ POST /webhooks/whatsapp
                                        │ 1. signature checked (app secret)
                                        │ 2. body stored (webhook_events), then
                                        │ 3. processed: messages, statuses, account events
                                        ▼
   src/chat.js  handleInbound ─▶ consent keywords, handoff, chat step (orders.js, payments.js)
                                        │ replies written QUEUED to wa_messages in the same transaction
                                        ▼
   src/wa/conversations.js  sendQueued ─▶ 24-hour window check ─▶ Meta /messages (free-form)

   order, payment, claim … changes ─▶ notifications (outbox, same transaction)
   src/notify.js  sendOne ─▶ switch, consent, template status and variables ─▶ Meta /messages (template)

   maintenance run (every minute): due notifications and queued replies, webhook replay,
   daily template sync, retention, health alerts
```

Nothing calls Meta inside an order or payment transaction. Every message to send is
first written to an outbox row in the same transaction as the change that caused it, and
sent after commit. Meta being slow or down never blocks a checkout, a payment or a webhook.

## Modules

| File | Role |
|------|------|
| `mango-api/src/whatsapp.js` | Cloud API clients: template sender, chat messenger, login codes; signature check; what a failed send means (`sendOutcome`) |
| `mango-api/src/chat.js` | Inbound messages: dedupe, customer, consent keywords, handoff, the ordering chat, typed questions; the webhook body walker |
| `mango-api/src/wa/conversations.js` | Conversations and messages, the 24-hour window, the reply outbox and its retries, delivery statuses, handoff actions |
| `mango-api/src/wa/consent.js` | STOP / START keywords, consent per number, the send-time consent rule |
| `mango-api/src/wa/registry.js` | The one list of automated messages (template, category, consent class, variables, trigger) |
| `mango-api/src/wa/events.js` | Account, phone-number quality and template status webhooks |
| `mango-api/src/wa/meta-admin.js` | Readiness, connection check, template sync, customer media for staff |
| `mango-api/src/wa/retention.js` | Clears message words after the retention period, deletes old records |
| `mango-api/src/notify.js` | The order-update outbox (`notifications`) and its sender |
| `mango-api/src/webhook-events.js` | Durable webhook intake and replay (shared with Razorpay) |
| `mango-api/src/admin/whatsapp.js` | Staff API for the inbox and set-up |
| `mango-api/src/maintenance.js` | The scheduled steps and health alerts |
| `src/pages/WhatsApp.tsx` | The panel's WhatsApp page |

## Data (migration 051_whatsapp.sql)

Additive only: seven new tables, nothing existing changed, so the previous release keeps
running on the new schema.

| Table | Holds |
|-------|-------|
| `wa_conversations` | One per WhatsApp number: bot or staff, open / waiting / closed, assigned person, last customer and business message (the 24-hour window), unread count |
| `wa_messages` | Every message in and out: type, words (cleared after the retention period), author (customer, bot, system, `staff:<id>`), Meta id (unique), status sent → delivered → read or failed / unknown, error, attempts, the webhook event it came in |
| `wa_consent` | Per number: order updates allowed or stopped; promotions none / opted in / opted out |
| `wa_consent_events` | Every consent change with its source (WhatsApp keyword, shop setting, staff) and evidence (Meta message id, request id, staff id) |
| `wa_templates` | Meta's last word on each template: status, category, number of variables, URL button |
| `wa_account_events` | Account, number-quality, template events from Meta and the panel's connection checks (90 days) |
| `wa_automations` | A manager's on/off switch per automated message (no row: on) |

Existing tables it uses: `notifications` (order-update outbox, unchanged), `wa_sessions`
and `wa_inbound` (chat state and inbound dedupe, unchanged), `webhook_events`
(durable intake), `customers.reminders_opt_in` (the shop's reminder setting).

Rollback SQL for the new tables: [ROLLBACK.sql](ROLLBACK.sql), only after the previous
release is back and the data is no longer wanted.

## What is done and what is not

See [TESTS.md](TESTS.md) for the evidence. In short: built and tested against Meta's
documented request and webhook formats with Meta stubbed; **not yet run against a real Meta
account**, because the account, number, templates and credentials don't exist yet. Those
are the owner's steps in [META-CHECKLIST.md](META-CHECKLIST.md) and [ACTIVATION.md](ACTIVATION.md).
