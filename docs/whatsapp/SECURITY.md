# WhatsApp security and privacy

## Secrets

- `WHATSAPP_TOKEN` (system user token) and `WHATSAPP_APP_SECRET` live only in the API's
  environment (Vercel encrypted variables). They are never sent to a browser, never logged,
  and never returned by any route: the WhatsApp page shows "set" / "not set" and ids by their
  last 4 digits.
- Every call to Meta is made by the API with the token in the `Authorization` header.
- Rotate the token in Meta Business Suite and update the variable; the old one stops at once
  when revoked there. Rotate the app secret in the app dashboard, update the variable, redeploy.

## Webhooks

- Every body is checked against `X-Hub-Signature-256` (HMAC-SHA256 with the app secret, over
  the raw bytes, constant-time) before anything is stored or read. The verify token is only for
  Meta's one-time address check.
- Bodies over 1 MB and compressed bodies are refused. Only listed keys of account events are kept.

## Media

Customer photos and files stay at Meta. Staff open them through the API
(`GET /admin/v1/whatsapp/media/:id`), which asks Meta for the file with the token, accepts only
images, PDFs, voice notes and short videos (allowlist), checks the size (16 MB default) before
and after download, accepts only Meta's own media hosts (`fbcdn.net`, `facebook.com`,
`whatsapp.net`) over https, and answers with `Cache-Control: private, no-store` and
`X-Content-Type-Options: nosniff` (documents as downloads). No Meta URL reaches a browser.

## Access

| Who | May |
|-----|-----|
| Managers | Everything on the WhatsApp page, including set-up, template sync, switches (password confirmation), failures, replays |
| Operators | The inbox: read, reply, take over, assign, hand back, close, record an opt-out, Send again |
| Packers, QC, riders | Nothing |

The API enforces this (`mango-api/src/access.js`, `src/admin/policy.js`); the panel hides what
a role can't use. Opening a conversation and opening a photo are recorded reads of customer
data; every change is in the activity log (append-only).

## Personal data

- Phones are masked to their last 4 digits in lists and logs (`maskPhone`).
- Message words are kept `WHATSAPP_MESSAGE_RETENTION_DAYS` (90 days by default), then cleared;
  the record without words stays 180 days; empty conversations go after a year; account
  events after 90 days; stored webhook bodies after 7 days.
- Account deletion removes the customer's conversations and messages; a STOP is kept against
  the number alone (CONSENT.md).
- No message content goes to Sentry, metrics labels or analytics.

## No AI with access

The chat is rule-based. No language model reads messages or has access to customer data or
actions. Any future assistant would have to go through the same consent, window and
permission checks and be reviewed first.
