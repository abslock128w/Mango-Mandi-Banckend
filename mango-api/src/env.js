// Validated configuration. In production the app refuses to start with
// placeholder secrets.
import { z } from 'zod'

const DEV_JWT = 'dev-only-change-me-0123456789abcdef0123456789'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().default('postgres://mango:mango@localhost:5432/mango'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  JWT_SECRET: z.string().default(DEV_JWT),
  ADMIN_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  REFRESH_REUSE_GRACE_MS: z.coerce.number().int().min(0).default(10_000),
  RAZORPAY_WEBHOOK_SECRET: z.string().default('whsec_dev'),
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  METRICS_TOKEN: z.string().default(''),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(12).optional(),
  SMS_PROVIDER: z.enum(['log', 'jio']).default('log'),
  JIO_SMS_URL: z.string().url().optional(),
  JIO_SMS_API_KEY: z.string().optional(),
  JIO_SMS_SENDER_ID: z.string().optional(),
  JIO_SMS_TEMPLATE_ID: z.string().optional(),
  JIO_SMS_ENTITY_ID: z.string().optional(),
  JIO_SMS_TEXT: z.string().default('{code} is your VMR Mangoes login code. It expires in 5 minutes.'),
  WHATSAPP_PROVIDER: z.enum(['log', 'meta', 'gupshup']).default('log'),
  GUPSHUP_API_KEY: z.string().optional(),
  GUPSHUP_APP_NAME: z.string().optional(),
  GUPSHUP_SOURCE_NUMBER: z.string().regex(/^\+?\d{10,15}$/, 'digits with country code, e.g. 919876543210').optional(),
  // JSON object: template name → the id Gupshup gave it, e.g. {"vmr_order_confirmed":"8f1c…"}
  GUPSHUP_TEMPLATE_IDS: z
    .string()
    .default('{}')
    .transform((v, ctx) => {
      try {
        const o = JSON.parse(v)
        if (o && typeof o === 'object' && !Array.isArray(o)) return o
      } catch {}
      ctx.addIssue({ code: 'custom', message: 'must be a JSON object of template name to id' })
      return z.NEVER
    }),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
  WHATSAPP_TEMPLATE_PREFIX: z.string().regex(/^[a-z0-9_]*$/).default('vmr_'),
  WHATSAPP_LANGUAGE: z.string().default('en'),
  SEED_DEMO_DATA: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
})

// Empty values (KEY= in .env) mean "use the default".
const parsed = schema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')))
if (!parsed.success) {
  console.error('Invalid configuration:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
export const isProd = env.NODE_ENV === 'production'

if (env.WHATSAPP_PROVIDER === 'meta' && !(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID)) {
  console.error('WHATSAPP_PROVIDER=meta needs WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID')
  process.exit(1)
}

if (env.WHATSAPP_PROVIDER === 'gupshup') {
  const missing = ['GUPSHUP_API_KEY', 'GUPSHUP_APP_NAME', 'GUPSHUP_SOURCE_NUMBER'].filter((k) => !env[k])
  const kinds = ['order_confirmed', 'replacement_confirmed', 'out_for_delivery', 'delivered', 'delivery_failed', 'cancelled', 'refunded']
  const noId = kinds.map((k) => `${env.WHATSAPP_TEMPLATE_PREFIX}${k}`).filter((t) => !env.GUPSHUP_TEMPLATE_IDS[t])
  if (missing.length || noId.length) {
    console.error(`WHATSAPP_PROVIDER=gupshup needs ${[...missing, ...noId.map((t) => `GUPSHUP_TEMPLATE_IDS.${t}`)].join(', ')}`)
    process.exit(1)
  }
}

const JIO_KEYS = ['JIO_SMS_URL', 'JIO_SMS_API_KEY', 'JIO_SMS_SENDER_ID', 'JIO_SMS_TEMPLATE_ID', 'JIO_SMS_ENTITY_ID']
if (env.SMS_PROVIDER === 'jio') {
  const missing = JIO_KEYS.filter((k) => !env[k])
  if (missing.length || !env.JIO_SMS_TEXT.includes('{code}')) {
    console.error(`SMS_PROVIDER=jio needs ${missing.join(', ') || 'JIO_SMS_TEXT containing {code}'}`)
    process.exit(1)
  }
}

if (isProd) {
  const problems = []
  if (env.JWT_SECRET.length < 32 || env.JWT_SECRET === DEV_JWT || env.JWT_SECRET.startsWith('dev-only-change-me')) {
    problems.push('JWT_SECRET too weak: set a random string of 32+ characters')
  }
  if (env.RAZORPAY_WEBHOOK_SECRET === 'whsec_dev') problems.push('RAZORPAY_WEBHOOK_SECRET is the dev default')
  if (!env.COOKIE_SECURE) problems.push('COOKIE_SECURE must be true in production')
  if (env.SMS_PROVIDER !== 'jio') problems.push('SMS_PROVIDER must be jio: customers could not receive login codes')
  if (problems.length) {
    console.error(`Refusing to start in production:\n- ${problems.join('\n- ')}`)
    process.exit(1)
  }
}
