// Alerts that fire on Vercel (docs/alerts.md). Nothing reads ops/alerts.yml
// there, so every rule in it must have a check the maintenance job runs from the
// database (src/alert-checks.js), and each checkHealth key in that list must
// really be raised and reported to Sentry. OPS_ALERTS, which turns these on, is
// on by default in production.
import { checkout, client, closeAll, customerToken, makeBatch, resetDb, startServer, T0 } from './helpers.js'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { ALERT_CHECKS, ALERT_WINDOW_MS, NOTIFY, STEP_FAILS } from '../src/alert-checks.js'
import { setNow } from '../src/clock.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { newId } from '../src/ids.js'
import { checkHealth, cleanupExpired } from '../src/maintenance.js'
import { recordWebhookFailure } from '../src/payments.js'
import { onProblemForTests } from '../src/sentry.js'
import { OTP_ALERTS } from '../src/sms.js'

const apiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.join(apiDir, '..')
const read = (...p) => readFileSync(path.join(...p), 'utf8')

const T = new Date(T0)
const minutesAgo = (m) => new Date(T.getTime() - m * 60_000)
const saved = { ...env }
let srv
let api
let orderId
let problems = []

before(async () => {
  await resetDb()
  srv = await startServer()
  api = client(srv.base)
  await makeBatch({ age: 5, rating: 'RIPE', lines: { 'ALP-3': 10 } })
  const cust = await customerToken(api)
  const o = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
  assert.equal(o.status, 201, JSON.stringify(o.body))
  orderId = o.body.orderId
})
after(async () => {
  await srv.close()
  await closeAll()
})
beforeEach(async () => {
  setNow(T0)
  env.OPS_ALERTS = true
  problems = []
  onProblemForTests((message, context) => problems.push({ message, context }))
  for (const sql of ['DELETE FROM ops_counters', 'DELETE FROM maintenance_runs', 'DELETE FROM webhook_failures', 'DELETE FROM notifications']) await query(sql)
})
afterEach(() => {
  onProblemForTests(null)
  Object.assign(env, saved)
})

const counter = (kind, n, at = T) =>
  query('INSERT INTO ops_counters (bucket, kind, n) VALUES ($1, $2, $3)', [new Date(Math.floor(at.getTime() / 60_000) * 60_000), kind, n])

/** Rows that raise each checkHealth key in ALERT_CHECKS, and nothing else. */
const SEEDS = {
  'steps-failing': () => query(`INSERT INTO maintenance_runs (step, last_err_at, last_error, fail_count) VALUES ('stock-alerts', $1, 'relation missing', $2)`, [minutesAgo(1), STEP_FAILS]),
  failing: async () => {
    for (let i = 0; i < 3; i++) {
      await query(
        `INSERT INTO notifications (id, order_id, event_id, kind, phone, status, attempts, next_attempt_at, last_error, created_at)
         VALUES ($1, $2, $3, 'ORDER_CONFIRMED', '+919876543210', 'FAILED', 1, $4, 'template paused', $4)`,
        [newId('ntf'), orderId, newId('evt'), minutesAgo(5)],
      )
    }
  },
  webhooks: async () => {
    for (let i = 0; i < 3; i++) await recordWebhookFailure('razorpay', `processing failed ${i}`)
  },
  'whatsapp-webhooks': async () => {
    for (let i = 0; i < 3; i++) await recordWebhookFailure('whatsapp', `chat failed ${i}`)
  },
  'api-errors': () => counter('api-5xx', 11),
  'api-slow': () => counter('api-slow', 21),
  'db-busy': () => counter('db-busy', 6),
}
const healthKeys = [...new Set(Object.values(ALERT_CHECKS).flatMap((a) => a.checks.filter((c) => c.by === 'checkHealth').map((c) => c.key)))]

describe('one list: every alerts.yml rule has a check on Vercel', () => {
  const rules = [...read(apiDir, 'ops', 'alerts.yml').matchAll(/^\s*-\s*alert:\s*(\w+)\s*$/gm)].map((m) => m[1])

  test('every rule in ops/alerts.yml has an entry, and every entry a rule', () => {
    assert.equal(rules.length, (read(apiDir, 'ops', 'alerts.yml').match(/\balert:/g) ?? []).length, 'every alert: line was read')
    assert.ok(rules.length >= 11)
    for (const rule of rules) assert.ok(ALERT_CHECKS[rule], `${rule} (ops/alerts.yml) has no Vercel check in src/alert-checks.js`)
    for (const rule of Object.keys(ALERT_CHECKS)) assert.ok(rules.includes(rule), `${rule} in src/alert-checks.js is not a rule in ops/alerts.yml`)
  })

  test('each entry names a real check, who is told, a runbook heading and a row in docs/alerts.md', () => {
    const slug = (h) => h.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, '').replace(/ /g, '-')
    const anchors = new Set([...read(repo, 'deploy', 'RUNBOOKS.md').matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1])))
    const doc = read(repo, 'docs', 'alerts.md')
    const sentry = read(apiDir, 'src', 'sentry.js')
    for (const [rule, a] of Object.entries(ALERT_CHECKS)) {
      assert.ok(a.vercel.length > 20, rule)
      assert.ok(a.notifies.length && a.notifies.every((n) => Object.values(NOTIFY).includes(n)), rule)
      assert.ok(anchors.has(a.runbook), `${rule}: no heading #${a.runbook} in deploy/RUNBOOKS.md`)
      assert.match(doc, new RegExp(`\\| ${rule} \\|`), `${rule} has no row in docs/alerts.md`)
      for (const c of a.checks) {
        if (c.by === 'checkHealth') assert.ok(SEEDS[c.key], `${rule}: no seed for checkHealth key ${c.key} in this test`)
        else if (c.by === 'login-codes') assert.ok(OTP_ALERTS[c.key], `${rule}: sms.js OTP_ALERTS has no ${c.key}`)
        else if (c.by === 'cron') assert.ok(sentry.includes(`monitorSlug: '${c.key}'`), rule)
        else assert.ok(['runAudit', 'ready'].includes(c.by), `${rule}: unknown check ${c.by}`)
      }
    }
    assert.deepEqual(Object.keys(SEEDS).sort(), [...healthKeys].sort(), 'a seed for each checkHealth key, and only those')
  })

  test('each checkHealth key in the list is raised from seeded rows and reported once to Sentry', async () => {
    for (const key of healthKeys) {
      for (const sql of ['DELETE FROM ops_counters', 'DELETE FROM maintenance_runs', 'DELETE FROM webhook_failures', 'DELETE FROM notifications']) await query(sql)
      problems = []
      await SEEDS[key]()
      const keys = await checkHealth({}, T)
      assert.ok(keys.includes(key), `${key}: checkHealth gave ${keys}`)
      assert.equal(problems.length, keys.length, `${key}: one report per problem`)
      const marker = (await query('SELECT last_ok_at FROM maintenance_runs WHERE step = $1', [`alert-${key}`])).rows[0]
      assert.ok(marker && Math.abs(marker.last_ok_at.getTime() - T.getTime()) < 60_000, `${key}: reported and marked for the hourly limit`)
    }
  })
})

describe('the Vercel checks from the database', () => {
  test('API errors: more than ALERT_API_ERRORS 5xx answers of any kind in 10 minutes', async () => {
    await counter('api-5xx', 6)
    await counter('db-busy', 2, minutesAgo(3))
    await counter('db-unavailable', 2, minutesAgo(9))
    await counter('api-5xx', 50, new Date(T.getTime() - ALERT_WINDOW_MS - 60_000)) // too old to count
    assert.deepEqual(await checkHealth({}, T), [], '10 is not more than 10')
    await counter('api-5xx', 1, minutesAgo(1))
    assert.deepEqual(await checkHealth({}, T), ['api-errors'])
    assert.equal(problems.length, 1)
    assert.match(problems[0].message, /^The API is answering with server errors \(5xx\)/)
    assert.deepEqual(problems[0].context, { lastTenMinutes: 11, threshold: 10, busy: 2, unavailable: 2 })
  })

  test('slow answers and a busy pool, each over its own threshold; the thresholds are settings', async () => {
    await counter('api-slow', 20)
    await counter('db-busy', 5)
    assert.deepEqual(await checkHealth({}, T), [])
    await counter('api-slow', 1, minutesAgo(2))
    await counter('db-busy', 1, minutesAgo(2))
    assert.deepEqual((await checkHealth({}, T)).sort(), ['api-slow', 'db-busy'])
    assert.ok(problems.some((p) => /^API answers are slow/.test(p.message) && p.context.slowerThanMs === 2000))
    assert.ok(problems.some((p) => /^The database pool is exhausted/.test(p.message) && p.context.lastTenMinutes === 6))
    await query('DELETE FROM maintenance_runs')
    Object.assign(env, { ALERT_SLOW_REQUESTS: 50, ALERT_DB_BUSY: 50 })
    assert.deepEqual(await checkHealth({}, T), [])
  })

  test('reported at most hourly, with the same message each time so Sentry groups it', async () => {
    await counter('api-5xx', 30)
    await checkHealth({}, T)
    await counter('api-5xx', 30, new Date(T.getTime() + 30 * 60_000))
    assert.deepEqual(await checkHealth({}, new Date(T.getTime() + 30 * 60_000)), ['api-errors'], 'still a problem')
    assert.equal(problems.length, 1, 'not reported again within the hour')
    const later = new Date(T.getTime() + 61 * 60_000)
    await counter('api-5xx', 30, later)
    await checkHealth({}, later)
    assert.equal(problems.length, 2)
    assert.equal(problems[1].message, problems[0].message)
  })

  test(`a step that failed ${STEP_FAILS} times in a row, still being run; not 2, and not one that stopped a day ago`, async () => {
    await query(`INSERT INTO maintenance_runs (step, last_err_at, last_error, fail_count) VALUES ('refunds', $1, 'x', 2), ('push', $2, 'x', 9)`, [
      minutesAgo(1), minutesAgo(26 * 60),
    ])
    assert.deepEqual(await checkHealth({}, T), [])
    await query(`UPDATE maintenance_runs SET fail_count = 3 WHERE step = 'refunds'`)
    assert.deepEqual(await checkHealth({}, T), ['steps-failing'])
    assert.match(problems[0].message, /^Maintenance steps have failed 3 times in a row/)
    assert.deepEqual(problems[0].context, { steps: [{ step: 'refunds', failCount: 3 }] })
  })

  test('OPS_ALERTS off: none of these checks run', async () => {
    env.OPS_ALERTS = false
    for (const key of ['steps-failing', 'api-errors', 'api-slow', 'db-busy']) await SEEDS[key]()
    assert.deepEqual(await checkHealth({}, T), [])
    assert.equal(problems.length, 0)
  })

  test('the cleanup step deletes counters older than 7 days', async () => {
    await counter('api-5xx', 1, new Date(T.getTime() - 8 * 86_400_000))
    await counter('api-5xx', 1, new Date(T.getTime() - 6 * 86_400_000))
    await cleanupExpired(T)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM ops_counters')).rows[0].n, 1)
  })
})

describe('OPS_ALERTS default', () => {
  const opsAlerts = (extra) => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', "const { env } = await import('./src/env.js'); console.log(JSON.stringify(env.OPS_ALERTS))"], {
      cwd: apiDir, encoding: 'utf8', env: { PATH: process.env.PATH, PREFLIGHT: '1', ...extra },
    })
    assert.equal(r.status, 0, r.stderr)
    return JSON.parse(r.stdout.trim())
  }

  test('on in production unless written false; off elsewhere unless written true', () => {
    assert.equal(opsAlerts({ NODE_ENV: 'production' }), true)
    assert.equal(opsAlerts({ NODE_ENV: 'production', OPS_ALERTS: 'false' }), false)
    assert.equal(opsAlerts({ NODE_ENV: 'production', OPS_ALERTS: '' }), true, 'empty means unset')
    assert.equal(opsAlerts({ NODE_ENV: 'development' }), false)
    assert.equal(opsAlerts({ NODE_ENV: 'development', OPS_ALERTS: 'true' }), true)
  })
})
