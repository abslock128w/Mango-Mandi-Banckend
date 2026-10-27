// 24 Oct 2026 audit, platform leftovers (docs/audit-2026-10-24-status-B.md):
// PLT-10 restore numbering, PLT-12 docs, PLT-13 lock_timeout, PLT-14 shutdown
// (and SEC-01's HOST), PLT-16 CI. Each test failed on the code before its fix.
import { checkout, client, closeAll, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { after, before, describe, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { pool, query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { checkLockTimeout } from '../src/preflight.js'
import { MAINTENANCE_STALE_S } from '../src/readiness.js'
import { bumpSequences, highWater } from '../src/restore.js'

const root = new URL('../..', import.meta.url)
const text = (path) => readFile(new URL(path, root), 'utf8')

let srv
let api
before(async () => {
  await resetDb()
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  await srv.close()
  await closeAll()
})

describe('PLT-13: preflight --online checks lock_timeout', () => {
  const fake = (value) => async () => ({ rows: [{ lock_timeout: value }] })

  test('unset is a warning naming the fix; set passes', async () => {
    const off = await checkLockTimeout(fake('0'))
    assert.deepEqual(off.ok, [])
    assert.match(off.warnings[0], /lock_timeout is not set.*ALTER ROLE <app role> SET lock_timeout = '5s'/)
    assert.deepEqual(await checkLockTimeout(fake('5s')), { ok: ['lock_timeout is 5s'], warnings: [] })
    // The real database answers too.
    const real = await checkLockTimeout(query)
    assert.equal(real.ok.length + real.warnings.length, 1)
  })

  test('the CLI runs it with --online, and VERCEL.md step 1 sets it', async () => {
    const cli = await text('mango-api/src/preflight-cli.js')
    assert.match(cli, /if \(online\) \{[\s\S]*await checkLockTimeout\(query\)/)
    assert.match(await text('deploy/VERCEL.md'), /ALTER ROLE mango_app SET lock_timeout = '5s';/)
  })
})

describe('PLT-10: after a restore no order number is handed out twice', () => {
  test('the numbers move past every number the database had before the restore', async () => {
    await makeBatch({ age: 4, rating: 'RIPE', lines: { 'ALP-3': 10 } })
    const cust = await customerToken(api)
    const numbers = []
    for (let i = 0; i < 3; i++) {
      const o = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
      assert.equal(o.status, 201, JSON.stringify(o.body))
      assert.equal((await api.post('/v1/dev/pay', { orderId: o.body.orderId, outcome: 'captured' })).status, 200)
      numbers.push((await query('SELECT number FROM orders WHERE id = $1', [o.body.orderId])).rows[0].number)
    }
    const before = await tx((c) => highWater(c))
    assert.equal(before.order_seq, Number(numbers.at(-1).slice(4)))
    // The restore: the counter goes back to the restore point (after the first order).
    await query(`SELECT setval('order_seq', $1::bigint, true)`, [Number(numbers[0].slice(4))])
    const next = await tx((c) => bumpSequences(c, before))
    assert.equal(next.order_seq, before.order_seq + 1)
    const fresh = (await query(`SELECT 'ORD-' || nextval('order_seq') AS n`)).rows[0].n
    assert.ok(!numbers.includes(fresh), `${fresh} was handed out before the restore`)
    // Never backwards, and a margin when the old database is gone.
    const again = await tx((c) => bumpSequences(c, { order_seq: 1 }, { margin: 1000 }))
    assert.equal(again.order_seq, Number(fresh.slice(4)) + 1001)
    assert.match(await text('deploy/VERCEL.md'), /ops\/bump-sequences\.js --old-url <backup branch URL>/)
  })

  test('gift, subscription and help numbers and the bill counter move past the restore point too', async () => {
    // Before the restore: numbers handed out on each counter, and two bills this year.
    for (const seq of ['gift_order_seq', 'subscription_seq', 'help_ticket_seq']) await query(`SELECT setval($1::regclass, 1500, true)`, [seq])
    await query(`INSERT INTO bill_counters (fy, last_no) VALUES ('2026-27', 42) ON CONFLICT (fy) DO UPDATE SET last_no = 42`)
    const before = await tx((c) => highWater(c))
    assert.equal(before.gift_order_seq, 1500)
    assert.equal(before.help_ticket_seq, 1500)
    assert.ok(before.bills['2026-27'] >= 42)
    // The restore puts every counter back.
    for (const seq of ['gift_order_seq', 'subscription_seq', 'help_ticket_seq']) await query(`SELECT setval($1::regclass, 1001, false)`, [seq])
    await query(`UPDATE bill_counters SET last_no = 3 WHERE fy = '2026-27'`)
    const next = await tx((c) => bumpSequences(c, before))
    assert.equal(next.gift_order_seq, 1501)
    assert.equal(next.subscription_seq, 1501)
    assert.equal(next.help_ticket_seq, 1501)
    assert.equal(next.bills['2026-27'], before.bills['2026-27'] + 1)
    assert.equal((await query(`SELECT 'HLP-' || nextval('help_ticket_seq') AS n`)).rows[0].n, 'HLP-1501')
    assert.equal((await query(`SELECT last_no FROM bill_counters WHERE fy = '2026-27'`)).rows[0].last_no, before.bills['2026-27'])
    // Never backwards: an older "seen" cannot lower a counter.
    const again = await tx((c) => bumpSequences(c, { bills: { '2026-27': 1 } }))
    assert.equal(again.bills['2026-27'], before.bills['2026-27'] + 1)
  })
})

describe('PLT-12: docs agree with the code', () => {
  test("the smoke test's /ready limit is /ready's own", async () => {
    const smoke = await text('mango-api/scripts/smoke.mjs')
    assert.equal(Number(smoke.match(/const MAINTENANCE_STALE_S = (\d+)/)[1]), MAINTENANCE_STALE_S)
    assert.match(await text('deploy/RELEASE.md'), new RegExp(`maintenance ran in the last ${MAINTENANCE_STALE_S} s`))
    assert.doesNotMatch(await text('deploy/RELEASE.md'), /makes this impossible to skip/)
  })
})

describe('PLT-16: CI hardening', () => {
  test('CI reads only; a fork never deploys; the Node major is pinned', async () => {
    const ci = await text('.github/workflows/ci.yml')
    assert.match(ci, /\npermissions:\n {2}contents: read\n/)
    assert.match(await text('.github/workflows/deploy.yml'), /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/)
    // Node 24 (LTS until April 2028): production, CI and the Docker images all run the same major.
    for (const file of ['mango-api/package.json', 'package.json']) {
      assert.equal(JSON.parse(await text(file)).engines.node, '>=24.11 <25', file)
    }
    assert.deepEqual([...new Set([...ci.matchAll(/node-version: (\S+)/g)].map((m) => m[1]))], ['24'])
    assert.match(await text('mango-api/Dockerfile'), /^FROM node:24-alpine$/m)
    assert.match(await text('deploy/web.Dockerfile'), /^FROM node:24-alpine /m)
  })
})

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

/**
 * Starts src/index.js (the Docker and local entry point) with its first
 * maintenance run held on a lock this test owns, stops it with SIGTERM while
 * the run waits, then lets the run go. Returns the log, the exit code and
 * whether the run got to the end (its 'tick' row).
 */
async function stopDuringARun(extra) {
  await query(`DELETE FROM maintenance_runs WHERE step = 'tick'`)
  await query(`DELETE FROM job_leases`)
  const blocker = await pool.connect()
  await blocker.query('BEGIN')
  await blocker.query(`INSERT INTO job_leases (name, holder, expires_at) VALUES ('maintenance', 'test', now() + interval '1 hour')`)
  const port = await freePort()
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      PORT: String(port),
      HOST: '127.0.0.1',
      DATABASE_URL: env.DATABASE_URL,
      LOG_LEVEL: 'info',
      JWT_SECRET: randomBytes(32).toString('hex'),
      SEED_DEMO_DATA: 'false',
      ENABLE_DEV_ROUTES: 'false',
      ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)))
  try {
    // Wait until the first run is stuck behind the test's lease row.
    let waiting = false
    for (let i = 0; i < 150 && !waiting; i++) {
      if (child.exitCode !== null) throw new Error(`index.js exited early:\n${log}`)
      const { rows } = await query(`SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%job_leases%'`)
      waiting = rows.length > 0
      if (!waiting) await delay(100)
    }
    assert.ok(waiting, `the first run never reached the lease:\n${log}`)
    const health = await fetch(`http://127.0.0.1:${port}/health`)
    assert.equal(health.status, 200)
    child.kill('SIGTERM')
    await delay(300)
  } finally {
    await blocker.query('ROLLBACK')
    blocker.release()
  }
  const code = await Promise.race([exited, delay(20_000).then(() => 'timeout')])
  if (code === 'timeout') child.kill('SIGKILL')
  const tick = (await query(`SELECT 1 FROM maintenance_runs WHERE step = 'tick'`)).rowCount === 1
  return { code, log, tick }
}

describe('PLT-14: a clean stop lets a maintenance run in progress finish (and SEC-01: HOST)', () => {
  test('with API_HARDENING: SIGTERM waits for the run, which completes; it listened on HOST only', { timeout: 60_000 }, async () => {
    const r = await stopDuringARun({ API_HARDENING: 'true' })
    assert.equal(r.code, 0, r.log)
    assert.equal(r.tick, true, `the run did not finish:\n${r.log}`)
    assert.match(r.log, /"host":"127\.0\.0\.1"[^\n]*mango-api listening/)
  })

  test('flag off: the pool closes under the run, which never finishes (the old behaviour)', { timeout: 60_000 }, async () => {
    const r = await stopDuringARun({})
    assert.equal(r.tick, false, r.log)
  })
})
