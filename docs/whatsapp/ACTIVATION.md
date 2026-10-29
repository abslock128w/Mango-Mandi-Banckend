# WhatsApp activation: one day

Do this on staging first (the Vercel preview of the `staging` branch with its own Neon branch),
then repeat the same day in production. It assumes the slow items in
[META-CHECKLIST.md](META-CHECKLIST.md) section A are done (business verified, number added,
display name approved) and the templates in section D are **approved**. Those can take days;
start them early.

Each step says how to check it. Stop at a failed check, fix it, then go on.

## Morning: credentials and webhook (about 1 hour)

1. **Collect the values** (META-CHECKLIST B): system user token, phone number id, WABA id, app
   secret, a new verify token (24+ random characters). Keep them in the password manager.
2. **Set them on the API** (Vercel > project > Settings > Environment variables, the right
   environment):
   `WHATSAPP_PROVIDER=meta`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`,
   `WHATSAPP_WEBHOOK_URL=https://<API domain>/webhooks/whatsapp`, `WHATSAPP_LANGUAGE` (as the
   templates). Leave the four feature switches off for now. Redeploy.
   *Check:* the deploy succeeds; the preflight log has no WhatsApp warning.
3. **Panel > WhatsApp > Set-up and health.**
   *Check:* Configuration says everything required is OK.
4. **Check connection.**
   *Check:* "Connected", the right number and display name, quality GREEN or unknown, a
   messaging limit. If not, the line says what is wrong (token, permission, id).
5. **Webhook at Meta** (META-CHECKLIST C): paste the URL and verify token, Verify and save,
   tick the webhook fields.
   *Check:* Meta shows it verified; Check connection says "this app is subscribed".
6. **Read templates from Meta.**
   *Check:* every launch template shows Ready. "Variables do not match" means the template's
   `{{n}}` count differs from TEMPLATES.md: fix the template at Meta, not the code.

## Midday: test with your own phones (about 2 hours)

Use two staff phones that are not customers yet.

7. **Inbound and reply.** From phone A send "hi" to the business number.
   *Check:* the menu arrives within seconds; Set-up and health shows a recent last webhook.
8. **Order by chat.** Order one box to a real pincode, pay the Razorpay link (on staging:
   Razorpay test mode; in production: a real small payment you will cancel).
   *Check:* `mandi_order_confirmed` arrives; the order shows on the panel with channel
   WhatsApp; the message shows Delivered then Read on the conversation.
9. **Questions.** Send "where is my order", then the order number, then "refund".
   *Check:* answers match the panel. From phone B send phone A's order number.
   *Check:* "I can't find … on this WhatsApp number".
10. **Handoff.** From phone A send "agent", then a photo.
    *Check:* the conversation is in Waiting for us; the photo opens on the panel; the bot stays
    quiet. Reply from the panel; *check* it arrives. Hand back; send "hi"; *check* the menu.
11. **Consent.** Send STOP OFFERS, then STOP, then START.
    *Check:* each reply arrives, and the conversation on the panel shows "Order updates:
    allowed · Offers and reminders: opted out" at the end.
12. **Order updates.** On the panel move the order through Processing, Packed, Out for delivery,
    Delivered.
    *Check:* out for delivery (with the code) and delivered arrive; nothing under What failed.
13. **Cancel and refund.** Place a second paid order from phone B and cancel it in the chat.
    *Check:* `mandi_cancelled` and `mandi_refunded` arrive; the refund shows at Razorpay.
14. **Login code.** If `OTP_DEFAULT_CHANNEL=whatsapp`: sign in to the shop with phone B.
    *Check:* the code arrives on WhatsApp.

## Afternoon: switch on and watch (about 1 hour, then the evening)

15. Turn on the optional switches whose templates are approved (`WHATSAPP_CLAIM_UPDATES`,
    `WHATSAPP_CARE_UPDATES`, `WHATSAPP_REVIEW_REQUESTS`, `WHATSAPP_ORDER_LINKS`), one at a time,
    redeploying after each. *Check:* Read templates from Meta shows them Ready.
16. Put the WhatsApp number on the shop (`VITE_SUPPORT_WHATSAPP`) and the boxes.
17. Write the evidence in the go-live log: date, who ran it, the steps above with pass / fail.
18. Watch until evening: Waiting for us answered, nothing new under What failed, quality
    rating unchanged.

## If something goes wrong

Set `WHATSAPP_PROVIDER=log` and redeploy: messages stop at once (orders and payments are not
affected), queued ones wait. See [ROLLBACK.md](ROLLBACK.md).
