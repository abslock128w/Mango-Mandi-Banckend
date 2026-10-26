// Validated configuration. In production the app refuses to start with
// placeholder secrets.
import { z } from 'zod'
import { checkProduction, DEV_JWT } from './preflight.js'

/** Running as a Vercel Function (Vercel sets VERCEL=1). */
export const onVercel = Boolean(process.env.VERCEL)

/** An on/off setting written true or false, off unless set. */
const flag = () =>
  z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  // The address a long-running server listens on (index.js). Unset: every interface, as Docker
  // needs. SEC-01 (24 Oct audit): a local run sets 127.0.0.1, so /v1/dev is not reachable from the
  // Wi-Fi; phones reach the API only through the shop's dev-server proxy, which refuses /v1/dev.
  HOST: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().default('postgres://mango:mango@localhost:5432/mango'),
  // Neon: DATABASE_URL is the pooled (-pooler) URL; migrations need the direct one.
  DATABASE_URL_UNPOOLED: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(onVercel ? 5 : 10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  JWT_SECRET: z.string().default(DEV_JWT),
  ADMIN_ORIGIN: z.string().default('http://localhost:5173'),
  CUSTOMER_ORIGIN: z.string().default('http://localhost:5174'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Vercel's edge sets X-Forwarded-For to the client's address: one hop to trust.
  TRUST_PROXY: z.coerce.number().int().min(0).default(onVercel ? 1 : 0),
  // lax when the sites and the API share a domain (shop.x.in, api.x.in); none for *.vercel.app previews.
  COOKIE_SAMESITE: z.enum(['lax', 'none', 'strict']).default('lax'),
  // Vercel Cron sends "Authorization: Bearer CRON_SECRET" to /internal/maintenance.
  CRON_SECRET: z.string().default(''),
  // Sign in with Google: the OAuth web client ID from Google Cloud console.
  GOOGLE_CLIENT_ID: z.string().default(''),
  SENTRY_DSN: z.string().default(''),
  // Vercel Blob for delivery and claim photos; unset keeps photos in the database.
  BLOB_READ_WRITE_TOKEN: z.string().default(''),
  // Shown to a customer who gives 1 or 2 stars after the claim window has closed.
  SUPPORT_CONTACT: z.string().default('Message us on WhatsApp and we will sort it out.'),
  // "How were your mangoes?" a day after delivery. Turn on once Meta approves mandi_review_request.
  WHATSAPP_REVIEW_REQUESTS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // UX-4: "we got your claim" and "claim rejected, because …". Turn on once Meta approves
  // mandi_claim_received and mandi_claim_rejected (each with an "Open order" URL button).
  WHATSAPP_CLAIM_UPDATES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // UX-7: an "Open order" URL button (https://<shop>/orders/{{1}}) on the order update templates.
  // Turn on only once Meta has approved the new versions with that button (mango-api/README.md).
  WHATSAPP_ORDER_LINKS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // The Warehouse area (boxes, labels, scanning: docs/warehouse/). Off: its routes answer 404 and the panel hides it.
  WAREHOUSE_V2: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // App feel (docs/app-feel.md). Each is off unless set, so each can be rolled back on its own.
  // WEB_PUSH: customers may turn on browser notifications on the Account page, and order updates
  // are pushed to them beside WhatsApp. Needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT.
  WEB_PUSH: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // vapid: send to the browser's push service (production). log: write a line instead (the default,
  // so development and tests never reach a real push service).
  WEB_PUSH_PROVIDER: z.enum(['log', 'vapid']).default('log'),
  // The application server keys (RFC 8292), base64url: the public key is the 65-byte P-256 point,
  // the private key the 32-byte scalar. `node scripts/vapid-keys.mjs` makes a pair.
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  // Who the push services can contact about our messages: mailto: or https: (RFC 8292).
  VAPID_SUBJECT: z.string().default(''),
  // Push service hosts a subscription's endpoint may point at (the API posts to it, so it is an
  // allowlist, not a guess). "*.x" matches any subdomain of x.
  WEB_PUSH_HOSTS: z
    .string()
    .default('fcm.googleapis.com,updates.push.services.mozilla.com,web.push.apple.com,*.push.apple.com,*.notify.windows.com'),
  // LIVE_TRACKING: "your rider is N stops away" on the shop's order page, and the riders' Route view
  // on the panel's Deliveries page. Minutes per stop are a selling rule (minutesPerStop).
  LIVE_TRACKING: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // FAVOURITES: hearts on the shop's boxes and a Favourites list on the Account page.
  FAVOURITES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // SHOP_INSTALL: the shop registers its service worker (static app shell only) and offers "Install app".
  SHOP_INSTALL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // SHOP_SORT_FILTER: sort and filter controls on the shop's home page.
  SHOP_SORT_FILTER: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Stocktake (cycle count) sessions and their review (docs/warehouse/STOCKTAKE.md). Needs WAREHOUSE_V2.
  WAREHOUSE_STOCKTAKE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Repack, split, merge and partial damage (docs/warehouse/REPACK.md). Needs WAREHOUSE_V2.
  WAREHOUSE_REPACK: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Offer the device camera as a scanner in the panel's scan screens (docs/warehouse/SCANNING.md). Needs WAREHOUSE_V2.
  WAREHOUSE_CAMERA_SCAN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // The most boxes one intake may label (brief 8.1).
  WAREHOUSE_MAX_LOT: z.coerce.number().int().min(1).max(20000).default(5000),
  // Minutes an open scan session may sit idle before it expires.
  WAREHOUSE_OP_IDLE_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),
  // Fixes from the 24 Oct 2026 audit, security, integrations and platform part
  // (docs/audit-2026-10-24-status-B.md). Each is off unless set to true, so
  // turning one off is the rollback.
  // SEC-02, SEC-09: framework errors caused by the request answer 4xx (not 500 and a
  // Sentry event), a wrong method 405 with Allow, 503 bodies carry retryAfterSeconds, and
  // the shop and panel may read Retry-After and X-Request-Id across origins.
  API_HARDENING: flag(),
  // INT-04, INT-09, INT-10, INT-11, INT-12, INT-13, INT-14, INT-18: provider calls and messages
  // (stale messages skipped, Meta error codes, login codes, Blob timeouts and sweeps, chat retries).
  PROVIDER_CHECKS: flag(),
  // INT-03, INT-06, INT-07, INT-08: alerts that today go quiet or never fire.
  OPS_ALERTS: flag(),
  // SEC-06, PLT-06, PLT-07, PLT-08, PLT-09: dispatch dates, replacement and retry promises.
  DELIVERY_CHECKS: flag(),
  // SEC-07: adding staff, changing a role or password, two-step resets and removals ask
  // the manager for their own two-step code (or password) again.
  STAFF_STEP_UP: flag(),
  // SEC-08: staff changes are audited in their own transaction, opening customer details
  // is audited, and refused attempts are logged.
  STAFF_AUDIT_TRAIL: flag(),
  // Two-step sign-in for staff: required for managers, everyone, or nobody (each person can still turn it on).
  STAFF_TWO_STEP: z.enum(['managers', 'all', 'optional']).optional(),
  // Login codes sent per day across the shop before sending pauses (SMS pumping guard).
  OTP_DAILY_LIMIT: z.coerce.number().int().positive().default(3000),
  // The part of that budget numbers with no account may use; the rest is kept for existing customers.
  OTP_NEW_NUMBER_SHARE: z.coerce.number().min(0.05).max(1).default(0.6),
  // Cloudflare Turnstile: the secret key. Set, the shop must pass a Turnstile check before a code is sent.
  TURNSTILE_SECRET_KEY: z.string().default(''),
  TURNSTILE_SITE_KEY: z.string().default(''),
  // The production database's host (Neon main). Production must use it; previews and staging must not.
  PRODUCTION_DB_HOST: z.string().default(''),
  // Requests per address per 15 minutes before 429 (shared by everyone behind one carrier NAT).
  API_RATE_LIMIT: z.coerce.number().int().positive().default(3000),
  // Login-code requests per address per 15 minutes (ratelimit.js otpIpLimit). Unset: 200 in
  // production, 300 elsewhere. Kept well above one person's need because a mobile carrier's NAT
  // puts many customers behind one address; the per-number caps, Turnstile and the daily
  // budget are what stop SMS pumping.
  OTP_IP_LIMIT: z.coerce.number().int().positive().optional(),
  REFRESH_REUSE_GRACE_MS: z.coerce.number().int().min(0).default(10_000),
  RAZORPAY_WEBHOOK_SECRET: z.string().default('whsec_dev'),
  // While rotating the webhook secret: the old one, so Razorpay's retries of older events still verify. Remove it a day later.
  RAZORPAY_WEBHOOK_SECRET_PREVIOUS: z.string().default(''),
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  METRICS_TOKEN: z.string().default(''),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(12).optional(),
  // Previews get their own first manager, so the production password is never in a preview.
  PREVIEW_ADMIN_EMAIL: z.string().email().optional(),
  PREVIEW_ADMIN_PASSWORD: z.string().min(12).optional(),
  SMS_PROVIDER: z.enum(['log', 'jio']).default('log'),
  // With SMS_PROVIDER=log, write login codes to the log. Off unless asked for: outside
  // production the API already returns the code as devCode; on a preview it is the only way in.
  LOG_OTP_CODES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Outside production the code also comes back in the response (devCode), for the shop's test
  // mode. scripts/start-local.mjs --phone turns it off (SEC-01): the shop is then on a public link,
  // and the code is printed in the local console instead (with LOG_OTP_CODES=true).
  OTP_CODE_IN_RESPONSE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // The pepper for stored login-code hashes. Unset: JWT_SECRET, as before. Setting it later keeps
  // codes already sent working (they are checked against both until they lapse in 5 minutes).
  OTP_PEPPER: z.string().default(''),
  // SEC-05: customer details on finished orders (name, phone, address, gift details, delivery GPS)
  // are removed this many months after the delivery date. Amounts and tax fields stay.
  PII_RETENTION_MONTHS: z.coerce.number().int().min(1).max(120).default(12),
  // Staff Google sign-in only for accounts of this Google Workspace domain (the token's hd claim).
  // Unset: any verified Google account whose email is a staff email.
  STAFF_GOOGLE_HD: z.string().default(''),
  // /v1/dev (pay any order without paying). Needs this, NODE_ENV other than production and no Razorpay keys.
  ENABLE_DEV_ROUTES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // A 500 also carries the error's text (scrubbed, short), so a local run shows the cause on screen.
  // Never in production: there it stays in the logs and Sentry only.
  SHOW_ERROR_DETAILS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  JIO_SMS_URL: z.string().url().optional(),
  JIO_SMS_API_KEY: z.string().optional(),
  JIO_SMS_SENDER_ID: z.string().optional(),
  JIO_SMS_TEMPLATE_ID: z.string().optional(),
  JIO_SMS_ENTITY_ID: z.string().optional(),
  JIO_SMS_TEXT: z.string().default('{code} is your MandiMangoes login code. It expires in 5 minutes.'),
  // How a Jio reply says the SMS was accepted, copied from Jio's API documentation
  // (OPS-03): an HTTP 200 alone is not proof. A dot path into the JSON reply
  // (e.g. "status" or "data.state") and the values that mean accepted, comma
  // separated. Optional: the field holding Jio's message id, for the log.
  JIO_SMS_SUCCESS_PATH: z.string().default(''),
  JIO_SMS_SUCCESS_VALUES: z.string().default(''),
  JIO_SMS_ID_PATH: z.string().default(''),
  // The channel a login code goes by when the customer didn't choose; the other is the fallback.
  // whatsapp: WhatsApp first (works before Jio DLT is approved).
  OTP_DEFAULT_CHANNEL: z.enum(['sms', 'whatsapp']).default('sms'),
  WHATSAPP_PROVIDER: z.enum(['log', 'meta']).default('log'),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
  WHATSAPP_TEMPLATE_PREFIX: z.string().regex(/^[a-z0-9_]*$/).default('mandi_'),
  WHATSAPP_LANGUAGE: z.string().default('en'),
  // Ordering in the chat: Meta's webhook verify token and app secret (signs webhook bodies)
  WHATSAPP_VERIFY_TOKEN: z.string().default(''),
  WHATSAPP_APP_SECRET: z.string().default(''),
  // Payments on WhatsApp: the Razorpay payment configuration name from WhatsApp Manager.
  // Unset: chat orders get a Razorpay payment link instead.
  WHATSAPP_PAYMENT_CONFIG: z.string().default(''),
  SEED_DEMO_DATA: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Backups record each run in maintenance_runs: Needs attention and Sentry warn
  // when none is recorded for 26 hours. Set by deploy/compose.yml (its backup
  // service); on Vercel set it once the GitHub backup workflow has its
  // BACKUP_HEARTBEAT_DATABASE_URL secret (deploy/VERCEL.md, Backups).
  BACKUP_HEARTBEAT_EXPECTED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Fixes from the 24 Oct 2026 audit that change what staff, customers or the
  // background run may do (docs/audit-2026-10-24-status-A.md). Each is off
  // unless set to true, so turning one off is the rollback.
  // PAY-05, PAY-06: "paid back another way" is refused while Razorpay can't be
  // checked, and no refund goes out automatically while a chargeback is open.
  REFUND_SAFETY_CHECKS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // PAY-08: once a day, every payment Razorpay captured in the last 3 days is
  // matched to an order or booking, or listed in Needs attention.
  PAYMENT_DAILY_RECON: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // INV-01, INV-07, INV-10: a reschedule never overfills a delivery slot, only a
  // manager cancels a free replacement, and a chat order re-checks its pincode.
  ORDER_RULE_CHECKS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // INV-02, INV-08: a batch intake sent twice (same Idempotency-Key) makes one
  // batch, a big intake needs a manager, and stock still in transit after its
  // arrival date stops selling to new orders.
  STOCK_INTAKE_CHECKS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // With STOCK_INTAKE_CHECKS: the most boxes a non-manager may bring in with one batch.
  BATCH_INTAKE_MANAGER_BOXES: z.coerce.number().int().min(1).max(100_000).default(1000),
  // Staff operations (docs/ops.md). Each is off unless set to true.
  // STOCK_FORECAST: a read-only "boxes to buy" suggestion for the next 14 days on the Planning page (managers).
  STOCK_FORECAST: flag(),
  // PURCHASE_RECORDS: farms, what each batch cost, and margins per box and variety (costs: managers only).
  PURCHASE_RECORDS: flag(),
  // PANEL_FEATURE_SWITCHES: managers may turn the safe customer-facing switches on or off on the
  // panel's Settings page (src/feature-switches.js). An environment value of false always wins.
  PANEL_FEATURE_SWITCHES: flag(),
})

// Empty values (KEY= in .env) mean "use the default".
const parsed = schema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')))
if (!parsed.success) {
  console.error('Invalid configuration:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
export const isProd = env.NODE_ENV === 'production'
/** /v1/dev pays orders for free: never in production, never with Razorpay keys set, and only when asked for. */
export const errorDetailsOn = () => !isProd && env.SHOW_ERROR_DETAILS
export const devRoutesOn = () => !isProd && env.ENABLE_DEV_ROUTES && !env.RAZORPAY_KEY_ID && !env.RAZORPAY_KEY_SECRET
/** Which deployment this is: Vercel's production or preview, else NODE_ENV. */
export const deployEnv = process.env.VERCEL_ENV || env.NODE_ENV

// Fail closed: without NODE_ENV=production the API runs its development
// stand-ins (a fake payment gateway, login codes in the response, /v1/dev).
// On Vercel that is never wanted, previews included (vercel dev aside).
if (onVercel && !isProd && process.env.VERCEL_ENV !== 'development') {
  console.error('Refusing to start: on Vercel NODE_ENV must be production, previews too (see deploy/VERCEL.md)')
  process.exit(1)
}
env.STAFF_TWO_STEP ??= isProd ? 'all' : 'optional'

if (env.WHATSAPP_PROVIDER === 'meta' && !(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID)) {
  console.error('WHATSAPP_PROVIDER=meta needs WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID')
  process.exit(1)
}

if (env.WEB_PUSH_PROVIDER === 'vapid' && !(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT)) {
  console.error('WEB_PUSH_PROVIDER=vapid needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT')
  process.exit(1)
}

const JIO_KEYS = ['JIO_SMS_URL', 'JIO_SMS_API_KEY', 'JIO_SMS_SENDER_ID', 'JIO_SMS_TEMPLATE_ID', 'JIO_SMS_ENTITY_ID']
if (env.SMS_PROVIDER === 'jio') {
  const missing = JIO_KEYS.filter((k) => !env[k])
  if (!env.JIO_SMS_SUCCESS_PATH) missing.push('JIO_SMS_SUCCESS_PATH')
  if (!env.JIO_SMS_SUCCESS_VALUES) missing.push('JIO_SMS_SUCCESS_VALUES')
  if (missing.length || !env.JIO_SMS_TEXT.includes('{code}')) {
    console.error(`SMS_PROVIDER=jio needs ${missing.join(', ') || 'JIO_SMS_TEXT containing {code}'}`)
    process.exit(1)
  }
}

// `npm run preflight` sets PREFLIGHT=1 to print every problem instead of exiting on the first start.
if (isProd && !process.env.PREFLIGHT) {
  const { errors, warnings } = checkProduction(env, { vercel: onVercel })
  for (const w of warnings) console.warn(`Warning: ${w}`)
  if (errors.length) {
    console.error(`Refusing to start in production:\n- ${errors.join('\n- ')}\nRun npm run preflight for the full list.`)
    process.exit(1)
  }
}
