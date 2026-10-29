# WhatsApp conversations and staff handoff

## One conversation per number

`wa_conversations` keeps one row per WhatsApp number, made on the first message either way.
It records:

- **mode**: `BOT` (the chat answers) or `STAFF` (a person holds it; the bot is quiet);
- **status**: `OPEN`, `WAITING` (someone asked for a person and nobody has answered) or
  `CLOSED`;
- who it is **assigned** to (a manager or operator), why it was handed over, since when it waits;
- the customer's last message time, which sets the **24-hour window**;
- unread messages for staff.

Every message in and out is in `wa_messages`, including order updates (as "Order update"), so
staff see the whole story in one place.

## The 24-hour window

WhatsApp allows free-form messages (chat replies, staff replies) only within 24 hours of the
customer's last message. Outside it only approved templates may be sent.

- A staff reply outside the window is refused by the API (409 `WINDOW_CLOSED`) and the reply box
  on the panel is off with the reason.
- A reply queued inside the window but not sent before it closed is never sent: it is marked
  failed with `WINDOW_CLOSED`, before Meta is called.
- Order updates are templates and are not limited by the window.

## Handing over to a person

The bot hands the conversation to staff when the customer:

- types "agent", "human", "person", "support", "customer care", "call me", or "talk / speak /
  chat to a person / someone / the team …", or taps **Talk to us** in help;
- sends a photo, document, voice note, video, sticker, location or contact card (a damaged
  box, a question only a person can read).

The customer is told: "Thanks, a person from our team will reply here. We answer between
9 AM and 8 PM. Our order updates keep coming as usual." The conversation becomes `STAFF` and
`WAITING`, and appears first in the panel's inbox ("Waiting for us").

While `STAFF`: the bot does not answer and does not move the chat on. STOP and START still work.
Order updates keep going.

## In the panel (WhatsApp page, managers and operators)

| Action | Effect |
|--------|--------|
| Open a conversation | Shows the messages, consent, reply window, recent orders. Recorded as a read of customer data. Clears unread |
| Reply | Queued and sent at once (within the window only). Takes the conversation (`STAFF`, assigned to you if nobody was), so the bot stays quiet. In the activity log |
| Take over | `STAFF`, assigned to you, no longer waiting |
| Assign (managers) | To a manager or operator, or nobody |
| Hand back to the bot | `BOT`, unassigned. The chat restarts at the menu; a half-built cart is dropped, an order waiting for payment is kept |
| Close | `BOT`, closed, unassigned. The customer's next message reopens it |
| Stop offers / Stop all messages | Records an opt-out the customer asked for (see CONSENT.md) |
| Send again | For a reply that failed or got no answer from WhatsApp, within the window |
| Photos and files | Fetched from Meta by the API and shown; no Meta address reaches the browser |

Every change writes an activity-log row with who did it. Phones show only their last 4 digits.

## Alerts

A customer waiting more than 4 hours for a person raises a health alert ("Customers on WhatsApp
are waiting for a person"), at most once an hour, in the maintenance health check.
