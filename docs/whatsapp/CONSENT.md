# WhatsApp consent

The rule, checked when each message is about to be sent (not when it was queued), so a STOP
sent a minute ago always counts:

| Kind of message | Sent when | Never sent when |
|-----------------|-----------|-----------------|
| **Order and service updates** (confirmation, delivery code, refund started, claim answer …) | The customer ordered, booked, claimed or asked | The number sent STOP |
| **Asked for** (back in stock alert, waitlist spot, referral thank-you, a manager's own summary) | The person asked for exactly this | The number sent STOP |
| **Promotional** (the order-again reminder) | The customer opted in: the shop's "Remind me to order again" setting, or START OFFERS on WhatsApp | No opt-in, STOP, or STOP OFFERS |
| Anything Meta bills as **marketing** (review request, referral thank-you) | As its own row says | Also after STOP OFFERS |
| **Login codes** | The person asked for a code | (always sent: they asked for it) |
| **Chat replies** | Within 24 hours of the customer's own message | Outside that window (WhatsApp's rule) |

Having an account, a phone number on file, or having ordered before is **never** promotional
consent. The registry (`mango-api/src/wa/registry.js`) gives every automated message its
consent class; `mango-api/src/wa/consent.js` `refusal()` applies the table above.

## Keywords

The whole message, any case, surrounding spaces ignored. A keyword inside a sentence ("please
don't stop my order") is not a keyword. They work in every state of the chat, also while staff
hold the conversation.

| Customer sends | Effect | Reply |
|----------------|--------|-------|
| STOP, STOP ALL, UNSUBSCRIBE, OPT OUT, OPTOUT | Order updates stopped and promotions opted out | Confirms, says how to restart, and that we still answer when they write |
| STOP OFFERS, STOP PROMOTIONS, STOP REMINDERS | Promotions opted out; the shop's reminder setting is turned off too | Confirms order updates continue |
| START, UNSTOP, RESUME | Order updates allowed again (promotions stay as they were) | Confirms |
| START OFFERS | Promotions opted in | Confirms, says STOP OFFERS stops them |

## Evidence

Every change is a row in `wa_consent_events`: the number, the customer, what changed, the
source and the evidence.

| Source | Evidence |
|--------|----------|
| `whatsapp_keyword` | Meta's id of the customer's message |
| `shop_account` | The request id of the shop's settings change (Account > WhatsApp messages) |
| `staff` | The staff member's id; the action is also in the activity log |

Staff can only record an **opt-out** the customer asked for (on a call, say): WhatsApp page >
conversation > "Stop offers" or "Stop all messages". Opting in is only ever the customer's act.

## Account deletion

Deleting an account (DPDP, `mango-api/src/privacy.js`) deletes its conversations and messages
and its consent history. A STOP or promotions opt-out is **kept**, with the events that
prove it, unlinked from the account, so a deleted customer who re-registers with the same
number is not messaged against their earlier wish. Those rows hold only the number, the
states and the evidence ids.

## Identity

The WhatsApp number is verified by WhatsApp itself (Meta's `wa_id`), so the chat needs no OTP.
A chat customer is the shop customer with the same phone number; nothing is ever merged by a
name, email or a number typed into a message. Order questions are answered only from orders
placed by that number ("I can't find ORD-1093 on this WhatsApp number").
