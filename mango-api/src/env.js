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

if (isProd) {
  const problems = []
  if (env.JWT_SECRET.length < 32 || env.JWT_SECRET === DEV_JWT || env.JWT_SECRET.startsWith('dev-only-change-me')) {
    problems.push('JWT_SECRET too weak: set a random string of 32+ characters')
  }
  if (env.RAZORPAY_WEBHOOK_SECRET === 'whsec_dev') problems.push('RAZORPAY_WEBHOOK_SECRET is the dev default')
  if (!env.COOKIE_SECURE) problems.push('COOKIE_SECURE must be true in production')
  if (problems.length) {
    console.error(`Refusing to start in production:\n- ${problems.join('\n- ')}`)
    process.exit(1)
  }
}
