# WhatsApp reliability: retries, duplicates, timeouts, outages

## Outboxes

Nothing is sent to Meta inside a business transaction. Two outboxes, each written in the
transaction that decided to send:

| Outbox | Holds | Sender |
|--------|-------|--------|
| `notifications` | Order updates (templates) | `sendDueNotifications` in the maintenance run (every minute in production) |
| `wa_messages` (status `QUEUED`) | Chat and staff replies (free-form) | Sent right after the chat turn or staff action; `sendDueMessages` in the maintenance run picks up anything left |

Each send first **claims** its row (moves its next attempt a couple of minutes out, `SKIP
LOCKED` for templates), so two instances or an overlapping run never send the same row.

## What a failure means

`mango-api/src/whatsapp.js` `sendOutcome()` decides:

| Outcome | When | What happens |
|---------|------|--------------|
| **permanent** | Meta answered and refused it (invalid number, unknown or paused template, bad parameter) | Marked failed with Meta's message. Not retried |
| **retry** | Meta answered "not now" (rate limit, throughput, temporary error codes, 5xx), or the request never reached Meta (connection refused, DNS) | Tried again: templates after 1, 5, 15, 60, 180 minutes; replies after 1, 2, 5 minutes (each +0 to 25% jitter so a burst doesn't return together). A chat reply also gets one quick in-turn retry with `PROVIDER_CHECKS` |
| **unknown** | No answer in time, or the connection broke mid-request | **Not resent automatically.** Meta may have delivered it, and a second delivery code or confirmation is worse than a late one. Marked failed / unknown and listed on the WhatsApp page, where staff choose Send again |

A template that is known to be paused or rejected, or whose number of variables differs from
Meta's, is stopped **before** calling Meta (skipped or failed with the reason).

A message older than a day is skipped rather than sent late; an update no longer true (a
"confirmed" for an order since cancelled, a delivery code for an order no longer out for
delivery) is skipped as stale.

## Duplicates

- Inbound messages: Meta's message id is unique (`wa_inbound`, `wa_messages.provider_id`): a
  redelivery is recorded and answered once.
- Webhook bodies: stored once per body hash; replays are safe for the reason above.
- Order updates: one per `(event, kind)` in `notifications`, so the same payment webhook twice
  (or webhook plus reconcile) queues one confirmation.
- Statuses: a status never moves a message backwards; failed after read is ignored.

## Meta down or slow

- Checkout, payment webhooks and the shop never wait on Meta.
- Messages wait in their outbox and go when Meta answers again, within the retry schedule.
- The WhatsApp webhook stores first and answers within 2 seconds even when sending replies is slow.
- The health check alerts when updates or replies are overdue, failing (3+ a day with
  `OPS_ALERTS`, or over 5%), or customers wait over 4 hours for a person.

## Lost instance

A serverless instance can be stopped after answering. Stored webhook events not marked
processed are replayed after 5 minutes (5 times at most, then listed). Queued replies are sent
by the next maintenance run. Claimed rows become claimable again after 2 minutes.
