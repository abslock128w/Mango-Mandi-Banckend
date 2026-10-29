# Running WhatsApp day to day

Panel: **Customers > WhatsApp**.

## Inbox (managers and operators)

- **Waiting for us** (the default view): customers who asked for a person or sent a photo,
  oldest first. Answer these first; one waiting over 4 hours raises an alert.
- **Mine**: assigned to you. **Held by staff**: any conversation a person holds. **All**.
- Open one, read it, reply. Replying takes it over, so the bot stays quiet.
- When done: **Hand back to the bot** (the customer can order again by chat) or **Close**.
- A damaged box: ask for a photo if they haven't sent one, then raise the claim on the Claims
  page or ask them to report it in the app. Replacement, never refund (the shop's rule).
- A customer asks to stop messages: **Stop offers for this customer** or **Stop all messages**.
- After 24 hours without a message from the customer the reply box is off. That is WhatsApp's
  rule. Ask them to write first (on a call), or let the order updates do the talking.
- "WhatsApp did not answer in time" on a message: it may have arrived. Ask the customer before
  **Send again**.

## Set-up and health (managers)

- **Configuration**: what is set and what is missing (never the values).
- **Check connection**: reads the number's name, quality rating and messaging limit, and whether
  the app is subscribed to webhooks. Run it after any change at Meta.
- **Last 24 hours**: messages in and out, updates sent, delivered, read, failed and skipped,
  customers waiting, numbers that sent STOP, the last webhook received.
- **Automated messages**: each message with its template and state:
  Ready, Waiting for Meta approval, Template not created at Meta, Template variables do not
  match, Its feature is off, Turned off here, Templates not read from Meta yet.
  **Read templates from Meta** refreshes this (it also runs daily). **Turn off** stops a
  message for everyone at once (asks your password, in the activity log); queued ones are
  skipped with the reason.
- **What failed (7 days)**: order updates (Send again), chat replies (Send again), webhook
  events not processed (Process again; safe, nothing is applied twice).
- **Account and template events from Meta**: approvals, pauses, quality changes, account alerts.

## Daily check (two minutes)

1. Waiting for us is empty, or being answered.
2. Set-up and health: the last webhook is recent (within the last hour on a trading day),
   nothing new under What failed, no new red event from Meta.
3. Number quality is not falling (Check connection). A drop means customers are blocking or
   reporting: look at which messages went out and pause any that are not wanted.

## Alerts you may get (Sentry / logs)

| Alert | Do |
|-------|----|
| WhatsApp messages are overdue | The maintenance run is not sending: check the cron and the run on Needs attention |
| WhatsApp messages failing | Check connection; read the errors under What failed (token, template, number quality) |
| Customers on WhatsApp are waiting for a person | Answer the inbox |
| WhatsApp message template status update: PAUSED / REJECTED | Fix the template in WhatsApp Manager; its messages are skipped meanwhile |
| WhatsApp phone number quality update: FLAGGED / DOWNGRADE | Stop optional messages (review, reminders) until quality recovers |
| WhatsApp account update: … BAN / RESTRICT | Open WhatsApp Manager > Account quality and follow Meta's notice |
