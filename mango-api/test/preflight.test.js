import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { env, STRICT_SWITCHES, strictDefaults } from '../src/env.js'
import { AUDIT_FIXES_OFF, checkProduction, DEV_JWT } from '../src/preflight.js'

const good = {
  JWT_SECRET: 'a'.repeat(64),
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  COOKIE_SECURE: true,
  RAZORPAY_KEY_ID: 'rzp_live_abc',
  RAZORPAY_KEY_SECRET: 's3cret',
  RAZORPAY_WEBHOOK_SECRET: 'whsec_live',
  SMS_PROVIDER: 'jio',
  JIO_SMS_SUCCESS_PATH: 'status',
  JIO_SMS_SUCCESS_VALUES: 'accepted',
  ADMIN_ORIGIN: 'https://admin.mandimangoes.in',
  CUSTOMER_ORIGIN: 'https://mandimangoes.in,https://www.mandimangoes.in',
  WHATSAPP_PROVIDER: 'meta',
  WHATSAPP_VERIFY_TOKEN: 'v'.repeat(24),
  WHATSAPP_APP_SECRET: 'a'.repeat(32),
  WHATSAPP_BUSINESS_ACCOUNT_ID: '1234567890',
  TRUST_PROXY: 1,
  GOOGLE_CLIENT_ID: 'web.apps.googleusercontent.com',
  SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1',
  CRON_SECRET: 'c'.repeat(32),
  DATABASE_URL: 'postgres://u:p@ep-x-pooler.ap-southeast-1.aws.neon.tech/mango',
  DATABASE_URL_UNPOOLED: 'postgres://u:p@ep-x.ap-southeast-1.aws.neon.tech/mango',
  BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x',
  PRODUCTION_DB_HOST: 'ep-x.ap-southeast-1.aws.neon.tech',
  TURNSTILE_SITE_KEY: '0x4AAA',
  TURNSTILE_SECRET_KEY: '0x4BBB',
}
// A preview on the Neon staging branch.
const staging = {
  ...good,
  RAZORPAY_KEY_ID: 'rzp_test_x',
  DATABASE_URL: 'postgres://u:p@ep-y-pooler.ap-southeast-1.aws.neon.tech/mango',
  DATABASE_URL_UNPOOLED: 'postgres://u:p@ep-y.ap-southeast-1.aws.neon.tech/mango',
}

describe('production preflight', () => {
  it('passes a complete live setup', () => {
    assert.deepEqual(checkProduction(good, { vercel: false }), { errors: [], warnings: [] })
    assert.deepEqual(checkProduction(good, { vercel: true }), { errors: [], warnings: [] })
  })

  it('refuses the launch blockers', () => {
    const { errors } = checkProduction({
      ...good,
      JWT_SECRET: DEV_JWT,
      COOKIE_SECURE: false,
      RAZORPAY_KEY_SECRET: '',
      RAZORPAY_WEBHOOK_SECRET: 'whsec_dev',
      SMS_PROVIDER: 'log',
      ADMIN_ORIGIN: 'http://admin.mandimangoes.in',
      CUSTOMER_ORIGIN: 'https://localhost:5174',
    })
    assert.equal(errors.length, 7)
    assert.ok(errors.some((e) => e.startsWith('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET')))
    assert.ok(errors.some((e) => e.includes('ADMIN_ORIGIN must be https')))
    assert.ok(errors.some((e) => e.includes('CUSTOMER_ORIGIN points at localhost')))
  })

  it('warns about test keys and features left off', () => {
    const { errors, warnings } = checkProduction({ ...good, RAZORPAY_KEY_ID: 'rzp_test_x', WHATSAPP_APP_SECRET: '', TRUST_PROXY: 0 })
    assert.deepEqual(errors, [])
    assert.equal(warnings.length, 3)
    assert.match(warnings[0], /test key/)
  })

  it('on Vercel, needs the cron secret and Neon\'s direct connection', () => {
    const { errors, warnings } = checkProduction({ ...good, CRON_SECRET: '', DATABASE_URL_UNPOOLED: undefined, BLOB_READ_WRITE_TOKEN: '' }, { vercel: true })
    assert.equal(errors.length, 3)
    assert.ok(errors.some((e) => e.startsWith('CRON_SECRET')))
    assert.ok(errors.some((e) => e.startsWith('DATABASE_URL_UNPOOLED')))
    // Production must not fall back to keeping photos in Postgres.
    assert.ok(errors.some((e) => e.startsWith('BLOB_READ_WRITE_TOKEN')))
    assert.deepEqual(warnings, [])
  })

  it('previews must use test payment keys; Blob is optional there', () => {
    const live = checkProduction({ ...staging, RAZORPAY_KEY_ID: 'rzp_live_abc', BLOB_READ_WRITE_TOKEN: '' }, { vercel: true, target: 'preview' })
    assert.equal(live.errors.length, 1)
    assert.match(live.errors[0], /live key on a preview/)
    assert.ok(live.warnings.some((w) => w.startsWith('BLOB_READ_WRITE_TOKEN')))
    assert.deepEqual(checkProduction(staging, { vercel: true, target: 'preview' }), { errors: [], warnings: [] })
    const logged = checkProduction({ ...staging, SMS_PROVIDER: 'log', LOG_OTP_CODES: true }, { vercel: true, target: 'preview' })
    assert.deepEqual(logged.errors, [])
    assert.match(logged.warnings[0], /only written to the logs/)
    const quiet = checkProduction({ ...staging, SMS_PROVIDER: 'log' }, { vercel: true, target: 'preview' })
    assert.deepEqual(quiet.errors, [])
    assert.match(quiet.warnings[0], /LOG_OTP_CODES is off/)
  })

  it('refuses logged login codes and the dev routes in production (SEC-11, PAY-7)', () => {
    const { errors } = checkProduction({ ...good, LOG_OTP_CODES: true, ENABLE_DEV_ROUTES: true })
    assert.equal(errors.length, 2)
    assert.ok(errors.some((e) => e.startsWith('LOG_OTP_CODES must be off')))
    assert.ok(errors.some((e) => e.startsWith('ENABLE_DEV_ROUTES is set')))
  })

  it('warns when only managers must use two-step sign-in (SEC-4)', () => {
    const { warnings } = checkProduction({ ...good, STAFF_TWO_STEP: 'managers' })
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /packers, QC and riders/)
    assert.deepEqual(checkProduction({ ...good, STAFF_TWO_STEP: 'all' }).warnings, [])
  })

  it('step-up, the audit trail, two-step, the ops alerts and the audit fixes are on by default in production only, and can still be turned off', () => {
    const SIX = ['API_HARDENING', 'PROVIDER_CHECKS', 'DELIVERY_CHECKS', 'REFUND_SAFETY_CHECKS', 'ORDER_RULE_CHECKS', 'STOCK_INTAKE_CHECKS']
    const all = (v) => Object.fromEntries(['STAFF_STEP_UP', 'STAFF_AUDIT_TRAIL', 'OPS_ALERTS', ...SIX].map((k) => [k, v]))
    assert.deepEqual(STRICT_SWITCHES.toSorted(), Object.keys(all(true)).toSorted())
    assert.deepEqual(strictDefaults({}, true), { STAFF_TWO_STEP: 'all', ...all(true) })
    assert.deepEqual(strictDefaults({}, false), { STAFF_TWO_STEP: 'optional', ...all(false) })
    assert.deepEqual(strictDefaults(all(false), true), { STAFF_TWO_STEP: 'all', ...all(false) })
    assert.deepEqual(strictDefaults({ STAFF_STEP_UP: true }, false).STAFF_STEP_UP, true)
    assert.equal(strictDefaults({ OPS_ALERTS: true }, false).OPS_ALERTS, true)
    for (const key of SIX) {
      assert.equal(strictDefaults({ [key]: false }, true)[key], false, key)
      assert.equal(strictDefaults({ [key]: true }, false)[key], true, key)
    }
  })

  it('warns when step-up, the audit trail, the ops alerts or an audit fix is turned off in production', () => {
    assert.deepEqual(Object.keys(AUDIT_FIXES_OFF).toSorted(), STRICT_SWITCHES.filter((k) => !['STAFF_STEP_UP', 'STAFF_AUDIT_TRAIL', 'OPS_ALERTS'].includes(k)).toSorted())
    for (const key of STRICT_SWITCHES) {
      const { errors, warnings } = checkProduction({ ...good, [key]: false })
      assert.deepEqual(errors, [])
      assert.equal(warnings.length, 1)
      assert.ok(warnings[0].startsWith(`${key} is false`), warnings[0])
      assert.deepEqual(checkProduction({ ...good, [key]: true }).warnings, [])
    }
  })

  // env.js itself, as each kind of deployment reads it (PREFLIGHT=1 only stops it refusing to start
  // for the missing production settings).
  const read = (vars) =>
    promisify(execFile)(process.execPath, ['--input-type=module', '-e', `const { env } = await import('./src/env.js'); console.log(JSON.stringify(${JSON.stringify(STRICT_SWITCHES)}.map((k) => env[k])))`], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { PATH: process.env.PATH, DATABASE_URL: 'postgres://nobody@localhost:5432/none_test', ...vars },
    }).then((r) => JSON.parse(r.stdout))

  it('env.js: every safeguard on in production unless written false; off in development unless written true', async () => {
    const n = STRICT_SWITCHES.length
    assert.deepEqual(await read({ NODE_ENV: 'production', PREFLIGHT: '1' }), Array(n).fill(true))
    assert.deepEqual(await read({ NODE_ENV: 'production', PREFLIGHT: '1', API_HARDENING: '' }), Array(n).fill(true), 'empty means unset')
    const offs = Object.fromEntries(STRICT_SWITCHES.map((k) => [k, 'false']))
    assert.deepEqual(await read({ NODE_ENV: 'production', PREFLIGHT: '1', ...offs }), Array(n).fill(false))
    assert.deepEqual(await read({ NODE_ENV: 'development' }), Array(n).fill(false))
    const ons = Object.fromEntries(STRICT_SWITCHES.map((k) => [k, 'true']))
    assert.deepEqual(await read({ NODE_ENV: 'development', ...ons }), Array(n).fill(true))
  })

  it('the tests run with them off unless a test turns one on', () => {
    for (const key of STRICT_SWITCHES) assert.equal(env[key], false, key)
  })

  it('production must use the production database, and previews must not', () => {
    const onProd = checkProduction({ ...staging, DATABASE_URL: good.DATABASE_URL, DATABASE_URL_UNPOOLED: good.DATABASE_URL_UNPOOLED }, { vercel: true, target: 'preview' })
    assert.ok(onProd.errors.some((e) => e.includes('production database on a preview')))
    // Only the migration URL pointing at production is enough to refuse.
    const half = checkProduction({ ...staging, DATABASE_URL_UNPOOLED: good.DATABASE_URL_UNPOOLED }, { vercel: true, target: 'preview' })
    assert.ok(half.errors.some((e) => e.includes('production database on a preview')))
    const wrong = checkProduction({ ...good, DATABASE_URL: staging.DATABASE_URL, DATABASE_URL_UNPOOLED: staging.DATABASE_URL_UNPOOLED }, { vercel: true })
    assert.ok(wrong.errors.some((e) => e.startsWith('DATABASE_URL is not the production database')))
    const unset = checkProduction({ ...good, PRODUCTION_DB_HOST: '' }, { vercel: true })
    assert.ok(unset.errors.some((e) => e.startsWith('PRODUCTION_DB_HOST is unset')))
    // Given as a whole URL, it still compares by host.
    assert.deepEqual(checkProduction({ ...good, PRODUCTION_DB_HOST: good.DATABASE_URL }, { vercel: true }).errors, [])
  })

  it('previews never carry the production bootstrap login', () => {
    const r = checkProduction({ ...staging, ADMIN_BOOTSTRAP_EMAIL: 'boss@mandimangoes.in', ADMIN_BOOTSTRAP_PASSWORD: 'x'.repeat(16) }, { vercel: true, target: 'preview' })
    assert.ok(r.errors.some((e) => e.startsWith('ADMIN_BOOTSTRAP_* is set on previews')))
  })

  it('Turnstile needs both keys, and production needs it (previews only warn)', () => {
    assert.ok(checkProduction({ ...good, TURNSTILE_SITE_KEY: '' }).errors.some((e) => e.includes('TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY')))
    const off = checkProduction({ ...good, TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' })
    assert.ok(off.errors.some((e) => e.startsWith('TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY are required')))
    const preview = checkProduction({ ...staging, TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' }, { vercel: true, target: 'preview' })
    assert.ok(!preview.errors.some((e) => e.includes('TURNSTILE')))
    assert.ok(preview.warnings.some((w) => w.startsWith('TURNSTILE_SECRET_KEY is unset')))
  })

  it('Jio needs its documented accepted status; WhatsApp-only codes are allowed with a warning (OPS-03)', () => {
    const noContract = checkProduction({ ...good, JIO_SMS_SUCCESS_PATH: '', JIO_SMS_SUCCESS_VALUES: '' })
    assert.ok(noContract.errors.some((e) => e.startsWith('JIO_SMS_SUCCESS_PATH and JIO_SMS_SUCCESS_VALUES are required')))
    const waOnly = checkProduction({ ...good, SMS_PROVIDER: 'log', OTP_DEFAULT_CHANNEL: 'whatsapp' })
    assert.deepEqual(waOnly.errors, [])
    assert.ok(waOnly.warnings.some((w) => w.startsWith('Login codes go by WhatsApp only')))
    const smsFirstWithoutSms = checkProduction({ ...good, SMS_PROVIDER: 'log' })
    assert.ok(smsFirstWithoutSms.errors.some((e) => e.includes('set OTP_DEFAULT_CHANNEL=whatsapp')))
    const nothing = checkProduction({ ...good, SMS_PROVIDER: 'log', WHATSAPP_PROVIDER: 'log' })
    assert.ok(nothing.errors.some((e) => e.startsWith('No way to send login codes')))
  })

  it('production needs Sentry; a preview only warns (OPS-09)', () => {
    assert.ok(checkProduction({ ...good, SENTRY_DSN: '' }).errors.some((e) => e.startsWith('SENTRY_DSN is required in production')))
    const preview = checkProduction({ ...staging, SENTRY_DSN: '' }, { vercel: true, target: 'preview' })
    assert.ok(!preview.errors.some((e) => e.includes('SENTRY_DSN')))
  })

  it('bills are kept long enough for tax law: under 72 months is refused, under 96 warns', () => {
    const at = (months) => checkProduction({ ...good, BILL_RETENTION_MONTHS: months })
    const short = at(60)
    assert.deepEqual(short.errors, [short.errors.find((e) => e.startsWith('BILL_RETENTION_MONTHS is 60: GST law needs bills kept at least 72 months'))])
    assert.ok(!short.warnings.some((w) => w.includes('BILL_RETENTION_MONTHS')))
    assert.ok(checkProduction({ ...staging, BILL_RETENTION_MONTHS: 60 }, { vercel: true, target: 'preview' }).errors.some((e) => e.startsWith('BILL_RETENTION_MONTHS is 60')))
    assert.deepEqual(at(72).errors, [])
    assert.deepEqual(at(80), { errors: [], warnings: [at(80).warnings.find((w) => w.startsWith('BILL_RETENTION_MONTHS is 80: a bill from early in a financial year'))] })
    // The default, or longer, is fine.
    for (const months of [96, 120, undefined]) assert.deepEqual(at(months), { errors: [], warnings: [] }, String(months))
  })
})

describe('WhatsApp settings (docs/whatsapp/CONFIGURATION.md)', () => {
  it('warns about a short app secret or verify token and a missing business account id', () => {
    const w = (over) => checkProduction({ ...good, ...over }, { vercel: false }).warnings
    assert.match(w({ WHATSAPP_APP_SECRET: 'short' }).join('\n'), /WHATSAPP_APP_SECRET is too short/)
    assert.match(w({ WHATSAPP_VERIFY_TOKEN: 'abc' }).join('\n'), /WHATSAPP_VERIFY_TOKEN is short/)
    assert.match(w({ WHATSAPP_BUSINESS_ACCOUNT_ID: '' }).join('\n'), /WHATSAPP_BUSINESS_ACCOUNT_ID is unset/)
    // Nothing of this when WhatsApp is not on Meta.
    assert.doesNotMatch(w({ WHATSAPP_PROVIDER: 'log', WHATSAPP_BUSINESS_ACCOUNT_ID: '' }).join('\n'), /BUSINESS_ACCOUNT_ID/)
  })
})
