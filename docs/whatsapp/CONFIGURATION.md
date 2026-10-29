# WhatsApp configuration

All settings are environment variables on the API (Vercel project settings, or
`deploy/.env` for Docker). None of them is ever sent to a browser: the panel's WhatsApp
page shows only whether each is set, and ids by their last 4 digits. Secrets go in the
host's secret store, never in git.

The API checks them at start-up (`mango-api/src/env.js`) and the production preflight
(`mango-api/src/preflight.js`) warns about the ones that look wrong.

## Required to send anything

| Setting | Value | Where it comes from |
|---------|-------|---------------------|
| `WHATSAPP_PROVIDER` | `meta` (default `log`: messages are only written to the log) | — |
| `WHATSAPP_TOKEN` | A **system user** access token that does not expire | Meta Business Suite > Settings > Users > System users > Generate token, with the app and permissions `whatsapp_business_messaging` and `whatsapp_business_management`. Not the 24-hour token from the API Setup page |
| `WHATSAPP_PHONE_NUMBER_ID` | The number's **id** (digits), not the phone number | WhatsApp Manager > Phone numbers, or the app's WhatsApp > API Setup page |
| `WHATSAPP_APP_SECRET` | The Meta app's secret (32 characters) | App dashboard > App settings > Basic > App secret. Every webhook is checked with it; without it every webhook is refused |
| `WHATSAPP_VERIFY_TOKEN` | A random string you choose, 16+ characters | You choose it, and paste the same value in the app dashboard's webhook settings |

The API refuses to start with `WHATSAPP_PROVIDER=meta` and no token or phone number id.

## Recommended

| Setting | Default | Why |
|---------|---------|-----|
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | empty | The WhatsApp Business Account (WABA) id. Needed for the template sync (daily, and the panel button) and the subscription check. Without it messages still go, but a paused or rejected template is only noticed from its webhook |
| `WHATSAPP_WEBHOOK_URL` | empty | `https://<API domain>/webhooks/whatsapp`. Only shown on the WhatsApp page so it is pasted correctly at Meta |
| `WHATSAPP_API_VERSION` | `v23.0` | The Graph API version. Change only after reading Meta's changelog for that version, and test on staging |
| `WHATSAPP_LANGUAGE` | `en` | The language code the templates are approved in (`en`, `en_US`, `hi` …). Must match WhatsApp Manager exactly |
| `WHATSAPP_TEMPLATE_PREFIX` | `mandi_` | Template names are this plus the kind (`mandi_order_confirmed`) |
| `MANAGER_SUMMARY_TEMPLATE` | `mandimangoes_daily_summary` | The managers' evening summary template |
| `OTP_DEFAULT_CHANNEL` | `sms` | `whatsapp` sends login codes on WhatsApp first (useful until Jio DLT is approved) |
| `OPS_ALERTS` | on in production | Failures reach Sentry (bad template or account events, failing sends) |

## Feature switches (off until Meta approves their templates)

| Setting | Turns on |
|---------|----------|
| `WHATSAPP_REVIEW_REQUESTS` | "How were your mangoes?" a day after delivery |
| `WHATSAPP_CLAIM_UPDATES` | Claim received / claim rejected |
| `WHATSAPP_CARE_UPDATES` | Help replies and subscription payment reminders |
| `WHATSAPP_ORDER_LINKS` | The "Open order" URL button on order updates (only once the new template versions with the button are approved) |
| `WHATSAPP_PAYMENT_CONFIG` | Paying inside WhatsApp (Razorpay payment configuration name). Leave unset: chat orders get a Razorpay link, which has the payment reconcile |

Each automated message can also be turned off on the WhatsApp page (managers, with password
confirmation), without a deploy.

## Limits and retention

| Setting | Default | Meaning |
|---------|---------|---------|
| `WHATSAPP_MEDIA_MAX_BYTES` | 16 MB | Largest customer photo or file staff can open |
| `WHATSAPP_MESSAGE_RETENTION_DAYS` | 90 | Message words are cleared after this; the record (type, time, status) stays 180 days |
| `WHATSAPP_WEBHOOK_ANSWER_MS` | 2000 (code constant) | How long the webhook works before answering Meta "accepted" and finishing in the background |

## Checking it

1. Deploy, then open the panel's **WhatsApp > Set-up and health** page (managers).
2. "Configuration" lists each setting as OK, Missing or Optional.
3. **Check connection** reads the phone number (name, quality, messaging limit) and the
   webhook subscription from Meta and says what is wrong in plain words (wrong token, missing
   permission, unknown id, Meta unreachable).
4. **Read templates from Meta** shows, per automated message, whether its template exists,
   is approved, and has the right number of variables.
