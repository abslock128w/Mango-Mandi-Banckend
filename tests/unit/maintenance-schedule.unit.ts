import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

// CRON-01: the maintenance job (expired holds, missed payments, refunds, WhatsApp and SMS sends)
// must run every minute in production. Vercel Hobby allows a cron at most once a day, so
// mango-api/vercel.json ships the daily '30 21 * * *' as a backstop, and on that plan the GitHub
// workflow .github/workflows/maintenance-ping.yml is the frequent trigger. On Vercel Pro the cron
// becomes '* * * * *' (deploy/SCHEDULER.md). Either way something must call the job, and a ping
// workflow without its secrets must fail rather than go green having called nothing.

const file = (p: string) => new URL(p, import.meta.url)
const PING = file('../../.github/workflows/maintenance-ping.yml')

const HOBBY_VS_PRO =
  "mango-api/vercel.json runs /internal/maintenance less often than every minute, and .github/workflows/maintenance-ping.yml is gone. " +
  "On Vercel Hobby a cron may run only once a day, so the ping workflow (on the default branch, with the MAINTENANCE_URL and CRON_SECRET secrets) " +
  "must call the job; on Vercel Pro set the cron to '* * * * *'. See deploy/SCHEDULER.md."

test('the maintenance job has an every-minute trigger: the Vercel Pro cron, or the ping workflow', () => {
  const vercel = JSON.parse(readFileSync(file('../../mango-api/vercel.json'), 'utf8')) as { crons?: { path: string; schedule: string }[] }
  const cron = vercel.crons?.find((c) => c.path === '/internal/maintenance')
  assert.ok(cron, 'mango-api/vercel.json has no cron for /internal/maintenance (keep at least the daily backstop)')
  assert.ok(cron.schedule === '* * * * *' || existsSync(PING), HOBBY_VS_PRO)
})

/** The shell script of the workflow's "Call the maintenance job" step, as GitHub runs it. */
function pingScript(): string {
  const yml = readFileSync(PING, 'utf8')
  const m = /- name: Call the maintenance job\n[\s\S]*?\n(\s+)run: \|\n((?:\1 {2}.*\n|\s*\n)+)/.exec(yml)
  assert.ok(m, 'maintenance-ping.yml has no "Call the maintenance job" step with a run: | script')
  const indent = m[1].length + 2
  return m[2].split('\n').map((l) => l.slice(indent)).join('\n')
}

test('the ping workflow fails when its secrets are missing, unless turned off on purpose', (t) => {
  if (!existsSync(PING)) {
    t.skip('no ping workflow: the Vercel Pro every-minute cron is the trigger')
    return
  }
  const yml = readFileSync(PING, 'utf8')
  assert.match(yml, /MAINTENANCE_PING_DISABLED: \$\{\{ vars\.MAINTENANCE_PING_DISABLED \}\}/)
  const script = pingScript()
  // No curl is reached in these cases: the script stops before calling anything.
  const run = (env: Record<string, string>) => spawnSync('bash', ['-e', '-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } })
  const missing: Record<string, string>[] = [{}, { MAINTENANCE_URL: 'https://api.example.invalid/internal/maintenance' }, { CRON_SECRET: 'x'.repeat(32) }]
  for (const env of missing) {
    const r = run(env)
    assert.equal(r.status, 1, `missing secrets must fail the run (${Object.keys(env).join(', ') || 'none set'}): ${r.stdout}${r.stderr}`)
    assert.match(r.stdout, /^::error::/m)
  }
  const off = run({ MAINTENANCE_PING_DISABLED: 'true' })
  assert.equal(off.status, 0, off.stdout + off.stderr)
  assert.match(off.stdout, /^::notice::/m)
})
