# WhatsApp rollback and incident recovery

## Stop one message

Panel > WhatsApp > Set-up and health > Automated messages > **Turn off**. Takes effect on the
next send; queued ones are skipped with the reason. Turn on again the same way.

## Stop all sending, keep receiving

Set `WHATSAPP_PROVIDER=log` and redeploy. Nothing reaches Meta any more: in production order
updates are skipped with "no WhatsApp provider configured", and chat replies are only written
to the log. Webhooks still
arrive and are recorded, so the inbox stays readable. Orders, payments and the shop are not
affected. To resume, set `meta` again: nothing queued before is replayed, only new messages go.

## Stop everything from Meta

In the app dashboard, untick the webhook fields (or remove the callback URL). Meta keeps
retrying undelivered webhooks for a while, so re-enable within the day to pick them up.

## Roll back the release

The migration is additive (new tables only), so the previous release runs on the new schema.
Redeploy the previous release in Vercel (Deployments > the earlier one > Promote). The new
tables stay and are simply unused. Drop them only when the data is no longer wanted, with
[ROLLBACK.sql](ROLLBACK.sql), on a Neon branch first.

## Incidents

| What happened | Do |
|---------------|----|
| Token leaked | Revoke it in Business settings > System users at once; generate a new one; update `WHATSAPP_TOKEN`; redeploy. Check WhatsApp Manager for messages you didn't send |
| App secret leaked | Reset it in App settings > Basic; update `WHATSAPP_APP_SECRET`; redeploy. Forged webhooks are refused from then on |
| Webhooks failing (500s, "not processed" growing) | Look at What failed > Webhook events and the error. Fix the cause, then Process again (safe). The maintenance run replays automatically up to 5 times |
| Messages failing | Check connection. Token errors: new token. Template errors: fix at Meta and Read templates. Number quality: stop optional messages |
| Wrong message sent to many customers | Turn the message off at once; fix the template or the cause; if needed, a corrective template message (needs approval) |
| Messages sent twice | Should not happen (claims, dedupe). Collect the notification ids from What failed / the conversation, and report it with the time; switch the kind off meanwhile |
| Meta outage | Nothing to do: messages wait and go out later; check What failed once Meta is back. Messages older than a day are skipped rather than sent late |
| Number blocked or restricted | Follow Meta's notice in WhatsApp Manager > Account quality; order updates still show in the shop |

Record each incident in `docs/incidents/` (template in its README).
