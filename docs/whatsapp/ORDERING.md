# Ordering on WhatsApp

The chat (`mango-api/src/chat.js`) uses the shop's own engine for everything that matters:
stock holds, delivery dates and slots, capacity, the unpaid-order limit, prices, payment and
refunds. It never invents an order state or a price.

## Flow

1. Menu: **Order mangoes**, **Book ahead**, **My orders** (and *help*, *agent*).
2. Pincode, checked against the delivery areas.
3. The boxes in stock for the earliest delivery date, by ripeness, with prices (a list).
4. Quantity, cart, then a delivery slot when slots are on.
5. Address (the last one for that pincode is offered), then a summary with the total and **Pay**.
6. Pay books the order exactly like app checkout: a 10-minute hold on the stock, the slot
   checked again, `channel = 'whatsapp'`. Then the payment:
   - default: a **Razorpay payment link** (the reconcile loop also catches a link paid while a
     webhook was lost);
   - with `WHATSAPP_PAYMENT_CONFIG`: Payments on WhatsApp (an order details message), confirmed
     by Meta's payment status webhook (no reconcile yet, so the preflight warns).
7. The verified Razorpay webhook (or the reconcile, or Meta's payment status) confirms the
   order. Only then does the confirmation template go out; it is the payment confirmation.

Tapping Pay again resends the same link, never a second order. A hold that ran out is
cancelled (by the next checkout or the sweep) and its stock goes back on sale; Pay after that
books afresh and finds out whether stock is still there ("some of those boxes just sold out").
A payment that arrives after the hold ran out follows the shop's rule: delivered on the next
date with stock, the customer told of the new date, or refunded if they cancel.

## Questions answered from records

In the menu and the tap-driven steps, typed text is matched against:

| Customer types | Answer, from that customer's own records |
|----------------|------------------------------------------|
| An order or booking number (ORD-1093, PRE-1001) | Its status, delivery date, total, payment and refund state. Another number's order: "I can't find ORD-1093 on this WhatsApp number" |
| "where is my order", "order status", "track order", "my orders", "cancel" | The recent orders list, with cancel buttons where allowed |
| "payment", "paid", "money deducted" | Payment state of the last orders; a mismatch is sent to *agent* |
| "refund" | Refund state of the last orders |
| "delivery", "when do you deliver" | Delivery days, cutoff time, slots |
| "price", "what do you have", "in stock" | Asks for the pincode, then the real list |

There is no free-text AI: the chat only answers from these rules and the database, and hands
anything else to a person on request.

## Cancelling and refunds

My orders lists recent orders and offers Cancel until packing. A paid order cancelled by the
customer is refunded in full (the shop's one refund exception); the refund starts at Razorpay
and `mandi_refunded` says it has been started. Damaged boxes are replaced, never refunded:
customers report them in the app, or send a photo here, which goes to a person.

## Limits

Only Indian numbers can order (others get one polite reply). The chat state expires after a
period of inactivity, except an order waiting for payment.
