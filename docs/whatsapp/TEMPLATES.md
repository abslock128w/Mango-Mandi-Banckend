# WhatsApp templates

Generated from `mango-api/src/wa/registry.js` by `mango-api/scripts/whatsapp-templates-doc.mjs`. Do not edit by hand.

Each automated message is one Meta template in `WHATSAPP_LANGUAGE` (default `en`), named `WHATSAPP_TEMPLATE_PREFIX` (default `mandi_`) plus the kind, except the managers' summary (`MANAGER_SUMMARY_TEMPLATE`, default `mandimangoes_daily_summary`). The variables are filled in the order listed; a template with a different number of variables is refused before Meta is called (the WhatsApp page shows "Template variables do not match").

The category is what to ask Meta for; Meta decides the final one. A STOP OFFERS also stops every template Meta bills as marketing.

The wording is a suggestion for the submission. Keep the variables, their order and the button; Meta rejects utility templates with promotional text.

| Kind | Template | Category | Variables | Button |
|------|----------|----------|-----------|--------|
| ORDER_CONFIRMED | `mandi_order_confirmed` | UTILITY | 4 | Open order |
| ORDER_CONFIRMED (with the invoice) | `mandi_order_confirmed_invoice` | UTILITY | 4 | Track order, Download invoice |
| REPLACEMENT_CONFIRMED | `mandi_replacement_confirmed` | UTILITY | 4 | Open order |
| RIPENESS_GUIDE | `mandi_ripeness_guide` | UTILITY | 4 | — |
| DATE_MOVED | `mandi_date_moved` | UTILITY | 4 | Open order |
| OUT_FOR_DELIVERY | `mandi_out_for_delivery` | UTILITY | 4 | Track order |
| DELIVERY_CODE | `mandi_delivery_code` | AUTHENTICATION | 1 | Copy code |
| GIFT_OUT_FOR_DELIVERY | `mandi_out_for_delivery` | UTILITY | 4 | Track order |
| GIFT_DELIVERY_CODE | `mandi_delivery_code` | AUTHENTICATION | 1 | Copy code |
| DELIVERED | `mandi_delivered` | UTILITY | 2 | Open order |
| DELIVERY_FAILED | `mandi_delivery_failed` | UTILITY | 3 | Open order |
| CANCELLED | `mandi_cancelled` | UTILITY | 2 | — |
| REFUNDED | `mandi_refunded` | UTILITY | 3 | — |
| PREORDER_BOOKED | `mandi_preorder_booked` | UTILITY | 4 | — |
| PREORDER_SPOT_OPEN | `mandi_preorder_spot_open` | UTILITY | 4 | — |
| PREORDER_MOVED | `mandi_preorder_moved` | UTILITY | 4 | — |
| PREORDER_DELAYED | `mandi_preorder_delayed` | UTILITY | 5 | — |
| PREORDER_EARLIER | `mandi_preorder_earlier` | UTILITY | 5 | — |
| ORDER_DELAYED | `mandi_order_delayed` | UTILITY | 5 | — |
| GIFT_ADDRESS_REQUEST | `mandi_gift_address_request` | UTILITY | 4 | Add my address |
| GIFT_ADDRESS_REMINDER | `mandi_gift_address_reminder` | UTILITY | 4 | Add my address |
| GIFT_ADDRESS_MISSING | `mandi_gift_address_missing` | UTILITY | 5 | — |
| BACK_IN_STOCK | `mandi_back_in_stock` | UTILITY | 4 | — |
| REORDER_REMINDER | `mandi_reorder_reminder` | MARKETING | 3 | — |
| REVIEW_REQUEST | `mandi_review_request` | MARKETING | 2 | — |
| CLAIM_RECEIVED | `mandi_claim_received` | UTILITY | 2 | Open order |
| CLAIM_REJECTED | `mandi_claim_rejected` | UTILITY | 3 | Open order |
| REFERRAL_REWARD | `mandi_referral_reward` | MARKETING | 5 | — |
| HELP_REPLY | `mandi_help_reply` | UTILITY | 3 | — |
| SUBSCRIPTION_DUE | `mandi_subscription_due` | UTILITY | 4 | — |
| PARTNER_ENQUIRY_RECEIVED | `mandi_partner_enquiry_received` | UTILITY | 3 | — |
| PARTNER_TEAM_ALERT | `mandi_partner_team_alert` | UTILITY | 4 | — |
| BULK_ENQUIRY_RECEIVED | `mandi_bulk_enquiry_received` | UTILITY | 3 | — |
| BULK_QUOTE | `mandi_bulk_quote` | UTILITY | 5 | — |
| BULK_ORDER_PAID | `mandi_bulk_order_paid` | UTILITY | 5 | — |
| FARM_VISIT_ENQUIRY_RECEIVED | `mandi_farm_visit_enquiry_received` | UTILITY | 3 | — |
| FARM_BOOKING_UPDATE | `mandi_farm_booking_update` | UTILITY | 4 | — |
| FARM_TEAM_ALERT | `mandi_farm_team_alert` | UTILITY | 4 | — |
| MANAGER_DAILY_SUMMARY | `mandimangoes_daily_summary` | UTILITY | 8 | — |
| LOGIN_CODE | `mandi_login_code` | AUTHENTICATION | 1 | Copy code (Meta's one-time password button) |

## ORDER_CONFIRMED

- Template: `mandi_order_confirmed`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: A verified payment (Razorpay or Meta payment webhook, or the reconcile) moves the order to CONFIRMED. This is also the payment confirmation.
- Button: URL button "Open order", `https://<shop>/orders/{{1}}`, sent only with WHATSAPP_ORDER_LINKS=true once Meta approved the button
- If it can't be sent: Not sent: the order page in the shop shows the same status, and staff see the failure on the WhatsApp page.
- Variables:
  1. name (example: Asha)
  2. order number (example: S-618 033 989)
  3. delivery date (example: Fri, 16 Oct)
  4. slot (example: 7 AM to 11 AM)

Suggested wording: Hi {{1}}, your MandiMangoes order {{2}} is confirmed and paid. It will be delivered on {{3}}, {{4}}.

### ORDER_CONFIRMED with the invoice

- Template: `mandi_order_confirmed_invoice`, category UTILITY, the same 4 variables in the same order
- Sent in place of `mandi_order_confirmed` when the order has a bill (`BILLS_ENABLED`) and `WHATSAPP_ORDER_INVOICE=true`. One message: the confirmation, a button to track the order and a button to the invoice. The PDF itself is not attached.
- Buttons, in this order (the order matters: the API fills them by position):
  1. URL button "Track order", `https://<shop>/orders/{{1}}` (the order id; example: ord_3f9c2a7b1d4e5f60a1b2)
  2. URL button "Download invoice", `https://<api>/v1/invoice/{{1}}` (a signed link that opens the invoice PDF without a sign-in for 180 days; example: ord_3f9c2a7b1d4e5f60a1b2.t9x2k1.Zk3mQ0aB7cD9eF1gH2iJ4kL6mN8oP0qR)
- Until Meta approves it, and for an order without a bill, `mandi_order_confirmed` is sent as before. After a template sync, a template that is missing, not approved or without its buttons is not used.

Suggested wording: Hi {{1}}, your MandiMangoes order {{2}} is confirmed and paid. It will be delivered on {{3}}, {{4}}. Your invoice is ready.

## REPLACEMENT_CONFIRMED

- Template: `mandi_replacement_confirmed`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: Staff approve a claim and the free replacement order is CONFIRMED.
- Button: URL button "Open order", `https://<shop>/orders/{{1}}`, sent only with WHATSAPP_ORDER_LINKS=true once Meta approved the button
- If it can't be sent: Not sent: the order page in the shop shows the same status, and staff see the failure on the WhatsApp page.
- Variables:
  1. name (example: Asha)
  2. order number (example: S-236 067 978)
  3. delivery date (example: Sat, 17 Oct)
  4. slot (example: 7 AM to 11 AM)

Suggested wording: Hi {{1}}, your replacement order {{2}} is booked at no cost. It will be delivered on {{3}}, {{4}}.

## RIPENESS_GUIDE

- Template: `mandi_ripeness_guide`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: A minute after ORDER_CONFIRMED, only when a box arrives raw or semi-ripe.
- Button: none
- If it can't be sent: Not sent: the order page in the shop shows the same status, and staff see the failure on the WhatsApp page.
- Variables:
  1. name (example: Asha)
  2. order number (example: S-618 033 989)
  3. when each box is ready (example: Alphonso 3kg Box (raw): ready around Mon, 19 Oct)
  4. storage tip (example: Keep them in a paper bag at room temperature.)

Suggested wording: Hi {{1}}, a guide for order {{2}}: {{3}}. {{4}}

## DATE_MOVED

- Template: `mandi_date_moved`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: Staff move the order (one or a whole day), the customer moves it, or a late payment lands on the next date with stock.
- Button: URL button "Open order", `https://<shop>/orders/{{1}}`, sent only with WHATSAPP_ORDER_LINKS=true once Meta approved the button
- If it can't be sent: Not sent: the order page in the shop shows the same status, and staff see the failure on the WhatsApp page.
- Variables:
  1. name (example: Asha)
  2. order number (example: S-618 033 989)
  3. new date (example: Sat, 17 Oct)
  4. slot (example: 7 AM to 11 AM)

Suggested wording: Hi {{1}}, order {{2}} will now arrive on {{3}}, {{4}}. If that date doesn't suit you, cancel it in the app before it is packed for a full refund.

## OUT_FOR_DELIVERY

- Template: `mandi_out_for_delivery`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: The rider photographs the sealed box at the warehouse and taps Picked up (rider app), or staff dispatch it: the order moves to OUT_FOR_DELIVERY. Sent at once on pickup; the outbox retries. No delivery code: that is DELIVERY_CODE.
- Button: URL button "Track order", `https://<shop>/orders/{{1}}` (always sent; part of this template version)
- If it can't be sent: Not sent: the order page in the shop shows the rider is on the way, and staff see the failure on the WhatsApp page.
- Variables:
  1. name (example: Asha)
  2. order number (example: S-618 033 989)
  3. rider first name (example: Ravi)
  4. slot (example: 7 AM to 11 AM)

Suggested wording: Hi {{1}}, your MandiMangoes order {{2}} is on its way with {{3}} and arrives {{4}}. Your delivery code comes in the next message: share it with the rider only after you have seen your mangoes.

## DELIVERY_CODE

- Template: `mandi_delivery_code`
- Category: AUTHENTICATION
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: Sent with OUT_FOR_DELIVERY: the 4-digit code the customer reads to the rider once they have seen their mangoes.
- Authentication settings: code_expiration_minutes 90, message_send_ttl_seconds 900, add_security_recommendation true
- Button: Copy code (Meta's one-time password button; the code is the button's parameter too)
- If it can't be sent: Not sent: the delivery code is also on the order page in the shop.
- Variables:
  1. delivery code (example: 4821)

Suggested wording: (Meta's fixed authentication wording: "{{1}} is your verification code." with the security recommendation and the expiry footer; copy-code button)

## GIFT_OUT_FOR_DELIVERY

- Template: `mandi_out_for_delivery` (shared with OUT_FOR_DELIVERY)
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: A gift order goes OUT_FOR_DELIVERY: the recipient hears too.
- Button: URL button "Track order", `https://<shop>/orders/{{1}}` (always sent; part of this template version)
- If it can't be sent: Not sent: the buyer sees the update on the order page.
- Variables:
  1. recipient name (example: Ravi)
  2. order number (example: G-854 101 967)
  3. rider first name (example: Suresh)
  4. slot (example: 7 AM to 11 AM)

Suggested wording: (shares mandi_out_for_delivery)

## GIFT_DELIVERY_CODE

- Template: `mandi_delivery_code` (shared with DELIVERY_CODE)
- Category: AUTHENTICATION
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: A gift order goes OUT_FOR_DELIVERY: the recipient, who is at the door, gets the code.
- Authentication settings: code_expiration_minutes 90, message_send_ttl_seconds 900, add_security_recommendation true
- Button: Copy code (Meta's one-time password button; the code is the button's parameter too)
- If it can't be sent: Not sent: the buyer has the code on the order page.
- Variables:
  1. delivery code (example: 4821)

Suggested wording: (shares mandi_delivery_code)

## DELIVERED

- Template: `mandi_delivered`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: The rider marks the order DELIVERED (code, photo or manager override).
- Button: URL button "Open order", `https://<shop>/orders/{{1}}`, sent only with WHATSAPP_ORDER_LINKS=true once Meta approved the button
- If it can't be sent: Not sent: the order page in the shop shows the same status, and staff see the failure on the WhatsApp page.
- Variables:
  1. name (example: Asha)
  2. order number (example: S-618 033 989)

Suggested wording: Hi {{1}}, order {{2}} has been delivered. If a box is damaged, report it in the app within a day and we will replace it.

## DELIVERY_FAILED

- Template: `mandi_delivery_failed`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: The rider reports DELIVERY_FAILED; it retries on the next delivery.
- Button: URL button "Open order", `https://<shop>/orders/{{1}}`, sent only with WHATSAPP_ORDER_LINKS=true once Meta approved the button
- If it can't be sent: Not sent: the order page in the shop shows the same status, and staff see the failure on the WhatsApp page.
- Variables:
  1. name (example: Asha)
  2. order number (example: S-618 033 989)
  3. retry date (example: Sat, 17 Oct)

Suggested wording: Hi {{1}}, we couldn't deliver order {{2}} today. We will bring it on {{3}}.

## CANCELLED

- Template: `mandi_cancelled`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: A confirmed order is cancelled (unpaid holds send nothing), or a waitlisted pre-order is closed because its week reached the booking horizon (variable 2 is then the booking number, PRE-…).
- Button: none
- If it can't be sent: Not sent: the order page in the shop shows the same status, and staff see the failure on the WhatsApp page.
- Variables:
  1. name (example: Asha)
  2. order number (example: S-618 033 989)

Suggested wording: Hi {{1}}, order {{2}} has been cancelled. If you paid for it, the refund has been started.

## REFUNDED

- Template: `mandi_refunded`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: Razorpay accepts a refund we started (an order the customer cancels before packing, or a manager cancel we cannot deliver; paid pre-orders are not refunded on a customer cancel). The wording must say the refund has been started.
- Button: none
- If it can't be sent: Not sent: the order page in the shop shows the same status, and staff see the failure on the WhatsApp page.
- Variables:
  1. name (example: Asha)
  2. order or booking number (example: S-618 033 989)
  3. amount (example: Rs 1,899)

Suggested wording: Hi {{1}}, the refund for {{2}} of {{3}} has been started. Your bank usually shows it within 5 to 7 working days.

## PREORDER_BOOKED

- Template: `mandi_preorder_booked`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: A pre-order is paid. The wording must say harvest can move the week, and that a paid pre-order can't be cancelled unless we delay it.
- Button: none
- If it can't be sent: Not sent: the order page in the shop shows the same status, and staff see the failure on the WhatsApp page.
- Variables:
  1. name (example: Asha)
  2. booking number (example: P-618 033 989)
  3. boxes (example: 2 × Alphonso 3kg Box)
  4. week (example: the week of Mon, 1 Mar)

Suggested wording: Hi {{1}}, pre-order {{2}} is confirmed and paid: {{3}} for {{4}}. We will confirm the delivery day nearer the time. Harvest varies with the weather, so the week can change. It can't be cancelled once paid, unless we delay it: then you can cancel for a full refund until it is packed.

## PREORDER_SPOT_OPEN

- Template: `mandi_preorder_spot_open`
- Category: UTILITY
- Who may receive it: Asked for by the person: sent unless the number sent STOP
- Sent when: A waitlisted booking gets a spot and a payment link. The wording must say pre-orders can't be cancelled or refunded once paid.
- Button: none
- If it can't be sent: Not sent: the booking page in the shop shows the payment link.
- Variables:
  1. name (example: Asha)
  2. boxes (example: 2 × Alphonso 3kg Box)
  3. week (example: the week of Mon, 1 Mar)
  4. payment link (example: https://rzp.io/i/abc)

Suggested wording: Hi {{1}}, a spot opened for {{2}} for {{3}}. Pay here to keep it: {{4}} Pre-orders can't be cancelled or refunded once paid.

## PREORDER_MOVED

- Template: `mandi_preorder_moved`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: No longer queued (since migration 079 every move is PREORDER_DELAYED or PREORDER_EARLIER); kept so messages queued before it still send.
- Button: none
- If it can't be sent: Not sent: the order page in the shop shows the same status, and staff see the failure on the WhatsApp page.
- Variables:
  1. name (example: Asha)
  2. booking number (example: P-618 033 989)
  3. boxes (example: 2 × Alphonso 3kg Box)
  4. new week (example: the week of Mon, 8 Mar)

Suggested wording: Hi {{1}}, pre-order {{2}} ({{3}}) moves to {{4}} because the mangoes were not ready. If the new week doesn't work for you, message us.

## PREORDER_DELAYED

- Template: `mandi_preorder_delayed`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: We move a PAID pre-order to a later week: the Pre-order plan recalculated (a variety expects fewer kg), a week passed without fruit (the allocator), or a manager moved it. Once per move. It now may be cancelled for a full refund until it is packed: the wording must say so. Waits in the outbox until WhatsApp is connected.
- Button: none
- If it can't be sent: Not sent yet: the booking in the shop shows Delayed with the cancel button, and the Pre-order plan shows the message as queued.
- Variables:
  1. name (example: Asha)
  2. booking number (example: P-618 033 989)
  3. old week (example: the week of Mon, 1 Mar)
  4. new week (example: the week of Mon, 8 Mar)
  5. booking link (example: https://mandimangoes.in/preorders/pre_1)

Suggested wording: Hi {{1}}, your VMR Mangoes pre-order {{2}} will now be delivered in {{4}} instead of {{3}}, because this season's harvest is smaller than expected. Sorry for the wait. If you would rather not wait, you can cancel it for a full refund any time before it is packed: {{5}}

## PREORDER_EARLIER

- Template: `mandi_preorder_earlier`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: The Pre-order plan recalculated (more kg expected) or a manager moved it, and a PAID pre-order now comes in an earlier week. Once per move; no cancel right. Waits in the outbox until WhatsApp is connected.
- Button: none
- If it can't be sent: Not sent yet: the booking in the shop shows the new week.
- Variables:
  1. name (example: Asha)
  2. booking number (example: P-618 033 989)
  3. new week (example: the week of Mon, 1 Mar)
  4. old week (example: the week of Mon, 8 Mar)
  5. booking link (example: https://mandimangoes.in/preorders/pre_1)

Suggested wording: Good news, {{1}}: your VMR Mangoes pre-order {{2}} will now arrive in {{3}}, earlier than {{4}}. See it here: {{5}}

## ORDER_DELAYED

- Template: `mandi_order_delayed`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: We move a PAID regular order booked against the pre-order plan to a later date: its fruit came in short, or a lowered plan left its week short (pre-orders come first). Once per move. It now may be cancelled for a full refund until it is packed: the wording must say so. Waits in the outbox until WhatsApp is connected.
- Button: none
- If it can't be sent: Not sent yet: the order in the shop shows Delayed with the cancel button.
- Variables:
  1. name (example: Asha)
  2. order number (example: S-618 033 989)
  3. old date (example: Tue, 2 Mar)
  4. new date (example: Mon, 8 Mar)
  5. order link (example: https://mandimangoes.in/orders/ord_1)

Suggested wording: Hi {{1}}, your VMR Mangoes order {{2}} will now be delivered on {{4}} instead of {{3}}, because less fruit came in than we planned. Sorry for the wait. If you would rather not wait, you can cancel it for a full refund until it is packed: {{5}}

## GIFT_ADDRESS_REQUEST

- Template: `mandi_gift_address_request`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: A gift for several people booked before the season is paid, and the giver chose "Ask them on WhatsApp" for this person (GIFT_ADDRESS_LINKS): the recipient is asked for their address. Sent again, with the same link, when the giver taps Send again (at most every 10 minutes, 5 times).
- Only with `GIFT_ADDRESS_LINKS=true`
- Button: URL button "Add my address", `https://<shop>/gift-address/{{1}}` (the link's token; always sent)
- If it can't be sent: Not sent: the giver sees it was not delivered on the gift page and can send the link again or share it themselves.
- Variables:
  1. recipient first name (example: Ravi)
  2. from (the giver) (example: Asha Rao)
  3. the box (example: 1 × Alphonso 3kg Box)
  4. week (example: the week of Mon, 1 Mar)

Suggested wording: Hi {{1}}, {{2}} is sending you a gift of VMR Mangoes: {{3}}, to be delivered in {{4}}. Tap the button below to tell us where to deliver it.

## GIFT_ADDRESS_REMINDER

- Template: `mandi_gift_address_reminder`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: Five days before the delivery week, once, when the recipient has still not given their address (GIFT_ADDRESS_LINKS).
- Only with `GIFT_ADDRESS_LINKS=true`
- Button: URL button "Add my address", `https://<shop>/gift-address/{{1}}` (the link's token; always sent)
- If it can't be sent: Not sent: the giver is told (GIFT_ADDRESS_MISSING) and can send the link again.
- Variables:
  1. recipient first name (example: Ravi)
  2. from (the giver) (example: Asha Rao)
  3. the box (example: 1 × Alphonso 3kg Box)
  4. week (example: the week of Mon, 1 Mar)

Suggested wording: Hi {{1}}, your gift of VMR Mangoes from {{2}} ({{3}}) is due in {{4}}, and we still need your delivery address. Tap the button below to add it.

## GIFT_ADDRESS_MISSING

- Template: `mandi_gift_address_missing`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: Five days before the delivery week, once, to the giver, when a recipient asked on WhatsApp has still not given their address (GIFT_ADDRESS_LINKS). Until the address is given the booking is not turned into a delivery.
- Only with `GIFT_ADDRESS_LINKS=true`
- Button: none
- If it can't be sent: Not sent: the gift page in the shop shows the address is still missing.
- Variables:
  1. giver first name (example: Asha)
  2. recipient name (example: Ravi Kumar)
  3. the box (example: 1 × Alphonso 3kg Box)
  4. week (example: the week of Mon, 1 Mar)
  5. gift link (example: https://mandimangoes.in/gifts/pre/pgr_1)

Suggested wording: Hi {{1}}, {{2}} has not given their delivery address yet for your gift ({{3}}, {{4}}). You can send them the link again from your gift’s page: {{5}}

## BACK_IN_STOCK

- Template: `mandi_back_in_stock`
- Category: UTILITY
- Who may receive it: Asked for by the person: sent unless the number sent STOP
- Sent when: A box the customer asked about ("Tell me when it is back") is in stock again.
- Button: none
- If it can't be sent: Not sent: the alert is marked done; the shop shows the box.
- Variables:
  1. name (example: Asha)
  2. box (example: Alphonso 3kg Box (ripe))
  3. first day (example: Fri, 16 Oct)
  4. shop link (example: https://mandimangoes.in)

Suggested wording: Hi {{1}}, {{2}} is back. The first delivery day is {{3}}. Order here: {{4}}

## REORDER_REMINDER

- Template: `mandi_reorder_reminder`
- Category: MARKETING
- Who may receive it: Promotional: only with an opt-in (shop setting or START OFFERS), never after STOP or STOP OFFERS
- Sent when: A week after delivery, for customers who turned reminders on, 10 AM to 7 PM, not if they ordered since.
- Button: none
- If it can't be sent: Not sent.
- Variables:
  1. name (example: Asha)
  2. box they had (example: Alphonso 3kg Box)
  3. shop link (example: https://mandimangoes.in)

Suggested wording: Hi {{1}}, enjoyed the {{2}}? Order again here: {{3}}. Reply STOP OFFERS to stop these reminders.

## REVIEW_REQUEST

- Template: `mandi_review_request`
- Category: MARKETING
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: About a day after delivery, once per order, if nothing on it is reviewed yet.
- Only with `WHATSAPP_REVIEW_REQUESTS=true`
- Button: none
- If it can't be sent: Not sent: the order page asks for a review.
- Variables:
  1. name (example: Asha)
  2. order number (example: S-618 033 989)

Suggested wording: Hi {{1}}, how were the mangoes in order {{2}}? Rate them in the app; it helps other customers choose.

## CLAIM_RECEIVED

- Template: `mandi_claim_received`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: A customer reports a problem with a delivered order.
- Only with `WHATSAPP_CLAIM_UPDATES=true`
- Button: URL button "Open order", `https://<shop>/orders/{{1}}` (always sent)
- If it can't be sent: Not sent: the order page in the shop shows the same status, and staff see the failure on the WhatsApp page.
- Variables:
  1. name (example: Asha)
  2. order number (example: S-618 033 989)

Suggested wording: Hi {{1}}, we have your report about order {{2}}. We will look at it and reply here within a day.

## CLAIM_REJECTED

- Template: `mandi_claim_rejected`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: Staff reject a claim (a replacement sends REPLACEMENT_CONFIRMED instead).
- Only with `WHATSAPP_CLAIM_UPDATES=true`
- Button: URL button "Open order", `https://<shop>/orders/{{1}}` (always sent)
- If it can't be sent: Not sent: the order page in the shop shows the same status, and staff see the failure on the WhatsApp page.
- Variables:
  1. name (example: Asha)
  2. order number (example: S-618 033 989)
  3. reason (example: The photo shows the box was opened before delivery.)

Suggested wording: Hi {{1}}, we looked into your report about order {{2}} and could not offer a replacement: {{3}}. Reply here if you would like to talk to us about it.

## REFERRAL_REWARD

- Template: `mandi_referral_reward`
- Category: MARKETING
- Who may receive it: Asked for by the person: sent unless the number sent STOP
- Sent when: A friend's first order is paid; both get the reward code (REFERRALS).
- Button: none
- If it can't be sent: Not sent: the code is on the Account page.
- Variables:
  1. name (example: Asha)
  2. reward (example: 10%)
  3. code (example: THANKS-7K2)
  4. valid until (example: Sun, 30 Nov)
  5. minimum order (example: Rs 999)

Suggested wording: Hi {{1}}, thank you for bringing a friend to MandiMangoes. Here is {{2}} off your next order of {{5}} or more: code {{3}}, valid until {{4}}.

## HELP_REPLY

- Template: `mandi_help_reply`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: Staff reply to a help request (HELP_CENTRE).
- Only with `WHATSAPP_CARE_UPDATES=true`
- Button: none
- If it can't be sent: Not sent: the reply is on the help request page.
- Variables:
  1. name (example: Asha)
  2. request number (example: HLP-12)
  3. link (example: https://mandimangoes.in/help/requests/hlp_1)

Suggested wording: Hi {{1}}, we replied to your help request {{2}}. Read it here: {{3}}

## SUBSCRIPTION_DUE

- Template: `mandi_subscription_due`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: A subscription's next box is set up and waits for payment (SUBSCRIPTIONS).
- Only with `WHATSAPP_CARE_UPDATES=true`
- Button: none
- If it can't be sent: Not sent: the subscription page shows the payment.
- Variables:
  1. name (example: Asha)
  2. box (example: 2 × Alphonso 3kg Box)
  3. date (example: Sat, 17 Oct)
  4. link (example: https://mandimangoes.in/account/subscriptions/sub_1)

Suggested wording: Hi {{1}}, your next subscription box, {{2}}, is set for {{3}}. Pay here to confirm it: {{4}}

## PARTNER_ENQUIRY_RECEIVED

- Template: `mandi_partner_enquiry_received`
- Category: UTILITY
- Who may receive it: Asked for by the person: sent unless the number sent STOP
- Sent when: Someone sends a Partner With Us enquiry and agrees to be contacted (PARTNER_NETWORK, docs/partner-network.md).
- Only with `WHATSAPP_PARTNER_UPDATES=true`
- Button: none
- If it can't be sent: Not sent: the confirmation page shows the reference.
- Variables:
  1. name (example: Asha)
  2. enquiry reference (example: MMP-7K2QXD9T)
  3. partnership type (example: Farmers & Suppliers)

Suggested wording: (write it in WhatsApp Manager)

## PARTNER_TEAM_ALERT

- Template: `mandi_partner_team_alert`
- Category: UTILITY
- Who may receive it: Asked for by the person: sent unless the number sent STOP
- Sent when: To the numbers in PARTNER_ALERT_PHONES: a new enquiry or product proposal, an enquiry assigned, converted or rejected, and a follow-up due or overdue.
- Only with `WHATSAPP_PARTNER_UPDATES=true`
- Button: none
- If it can't be sent: Not sent: the Partner Network overview shows the same.
- Variables:
  1. what happened (example: New partner enquiry)
  2. enquiry reference (example: MMP-7K2QXD9T)
  3. detail (example: Farmers & Suppliers, Ratnagiri, Maharashtra)
  4. panel link (example: https://ops.mandimangoes.in/partner-network/enquiries/pen_1)

Suggested wording: (write it in WhatsApp Manager)

## BULK_ENQUIRY_RECEIVED

- Template: `mandi_bulk_enquiry_received`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: Someone sends a bulk enquiry (over 100 kg) from the shop (BULK_ENQUIRIES, mango-api/README.md, Bulk enquiries).
- Only with `WHATSAPP_BULK_UPDATES=true`
- Button: none
- If it can't be sent: Not sent: the shop shows the enquiry number on screen and on the Account page.
- Variables:
  1. name (example: Asha)
  2. enquiry number (example: B-618 033 989)
  3. quantity (example: 120 kg (40 boxes))

Suggested wording: Hi {{1}}, we have your MandiMangoes bulk enquiry {{2}} for {{3}}. We will price it and send you a quote here soon.

## BULK_QUOTE

- Template: `mandi_bulk_quote`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: Staff send a quote for a bulk enquiry from the panel (again for each new quote).
- Only with `WHATSAPP_BULK_UPDATES=true`
- Button: none
- If it can't be sent: Not sent: the quote is on the Account page in the shop (with a banner and a badge), and the panel offers an Open in WhatsApp link with the quote written out.
- Variables:
  1. name (example: Asha)
  2. enquiry number (example: B-618 033 989)
  3. total (example: Rs 52,500)
  4. summary (example: 40 × Alphonso 3 kg box, special packaging)
  5. link (example: https://mandimangoes.in/account?enquiry=benq_1)

Suggested wording: Hi {{1}}, your quote for bulk enquiry {{2}} is ready: {{3}} for {{4}}. See the details and accept it here: {{5}}

## BULK_ORDER_PAID

- Template: `mandi_bulk_order_paid`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: A bulk order placed on the shop (100 kg or more, at bulk prices) is paid in full. The wording must say our team will call on WhatsApp to arrange the delivery (usually 5 to 7 days), and that it can be cancelled for a full refund within 4 hours of paying, until it is dispatched.
- Only with `WHATSAPP_BULK_UPDATES=true`
- Button: none
- If it can't be sent: Not sent: the shop shows the order, its payment and the cancel window on the bulk order page, and the panel lists it first under Bulk orders.
- Variables:
  1. name (example: Asha)
  2. order number (example: B-618 033 989)
  3. amount paid (example: Rs 41,250)
  4. quantity (example: 150 kg (30 boxes))
  5. order link (example: https://mandimangoes.in/bulk/orders/benq_1)

Suggested wording: Hi {{1}}, we have your VMR Mangoes bulk order {{2}} for {{4}}, paid in full ({{3}}). Our team will call you on WhatsApp to arrange the delivery, usually within 5 to 7 days. You can cancel it for a full refund within 4 hours of paying, until it is dispatched: {{5}}

## FARM_VISIT_ENQUIRY_RECEIVED

- Template: `mandi_farm_visit_enquiry_received`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: Someone sends a farm visit enquiry from the Farm visit tab on the shop’s Bulk page (250 kg or more). The wording must say our team will call on WhatsApp to plan the visit.
- Only with `WHATSAPP_BULK_UPDATES=true`
- Button: none
- If it can't be sent: Not sent: the shop shows the enquiry number on screen and on the Account page, and the panel lists it under Farm visit enquiries.
- Variables:
  1. name (example: Asha)
  2. enquiry number (example: B-618 033 989)
  3. what they asked (example: 150 kg of Alphonso, 6 people, around Sat, 12 Dec)

Suggested wording: Hi {{1}}, we have your VMR Mangoes farm visit enquiry {{2}}: {{3}}. Our team will call you on WhatsApp to plan your visit.

## FARM_BOOKING_UPDATE

- Template: `mandi_farm_booking_update`
- Category: UTILITY
- Who may receive it: Order and service update: sent unless the number sent STOP
- Sent when: A Farm Experience booking is made, confirmed, moved, cancelled, ready for the visit, reminded two days before, billed after weighing, paid, or a double payment refunded (FARM_EXPERIENCE, docs/farm-experience.md).
- Only with `WHATSAPP_FARM_UPDATES=true`
- Button: none
- If it can't be sent: Not sent: the booking page in the shop shows the same status.
- Variables:
  1. name (example: Asha)
  2. booking number (example: MMF-7K2QXD9T)
  3. what happened (example: Your farm visit on Sat, 10 Apr is confirmed. Your itinerary and check-in code are in your booking.)
  4. booking link (example: https://mandimangoes.in/farm-bookings/fbk_1)

Suggested wording: (write it in WhatsApp Manager)

## FARM_TEAM_ALERT

- Template: `mandi_farm_team_alert`
- Category: UTILITY
- Who may receive it: Asked for by the person: sent unless the number sent STOP
- Sent when: To the numbers in FARM_ALERT_PHONES: a new booking, a customer request, or a declined stay proposal.
- Only with `WHATSAPP_FARM_UPDATES=true`
- Button: none
- If it can't be sent: Not sent: the Farm Experience Bookings list shows the same.
- Variables:
  1. what happened (example: New farm booking)
  2. booking number (example: MMF-7K2QXD9T)
  3. detail (example: 300 kg Alphonso, Sat, 10 Apr, 6 guests)
  4. panel link (example: https://ops.mandimangoes.in/farm/bookings/fbk_1)

Suggested wording: (write it in WhatsApp Manager)

## MANAGER_DAILY_SUMMARY

- Template: `mandimangoes_daily_summary`
- Category: UTILITY
- Who may receive it: Asked for by the person: sent unless the number sent STOP
- Sent when: Each evening, to managers who turned the summary on (MANAGER_DAILY_SUMMARY). Its full template name is MANAGER_SUMMARY_TEMPLATE.
- Button: none
- If it can't be sent: Not sent: the Daily summary page shows the same numbers.
- Variables:
  1. the day (example: Thu, 16 Oct)
  2. orders (example: 42)
  3. revenue (example: Rs 98,430)
  4. boxes delivered (example: 61)
  5. boxes failed (example: 1)
  6. new claims (example: 2)
  7. unhappy ratings (example: 0)
  8. needs attention (example: 3)

Suggested wording: MandiMangoes, {{1}}: {{2}} orders, {{3}} taken. Delivered {{4}} boxes, failed {{5}}. New claims {{6}}, unhappy ratings {{7}}, needs attention {{8}}.

## LOGIN_CODE

- Template: `mandi_login_code`, category AUTHENTICATION, Meta's fixed authentication wording with a copy-code button
- Sent when: A customer asks for a login code and WhatsApp is chosen, or SMS fails.
- Sent directly by `src/sms.js`, not through the order-update outbox; an opt-out does not stop a code the person asked for.
