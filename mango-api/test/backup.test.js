// OPS-05: Docker backups are encrypted or not taken, go off the server in the
// same run, and record a heartbeat so a missed backup shows in Needs attention.
// ops/backup.sh runs for real here, with pg_dump and psql replaced by stubs
// (no Docker, no database dump) and a throwaway GPG key.
import { adminToken, client, closeAll, resetDb, startServer, T0 } from './helpers.js'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, beforeEach, describe, test } from 'node:test'
import { setNow } from '../src/clock.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { BACKUP_STALE_MS, checkHealth } from '../src/maintenance.js'

const SCRIPT = resolve(import.meta.dirname, '../ops/backup.sh')
const DB_URL = 'postgres://mango:not-a-real-password@db.invalid:5432/mango'
const DUMP = 'PGDMP fake dump: Asha Rao, 9876543210, 12 MG Road'

let root
let gnupg // holds the private key, to check a backup decrypts
let publicKey
let privateKeyFile

before(() => {
  root = mkdtempSync(join(tmpdir(), 'mango-backup-'))
  const bin = join(root, 'bin')
  execFileSync('mkdir', ['-p', bin])
  // pg_dump: writes a fake dump to --file=, or fails when FAIL_DUMP is set.
  writeFileSync(join(bin, 'pg_dump'), `#!/usr/bin/env bash
[ -n "\${FAIL_DUMP:-}" ] && { echo "pg_dump: connection refused" >&2; exit 1; }
for a in "$@"; do case "$a" in --file=*) printf '%s' "$FAKE_DUMP" > "\${a#--file=}" ;; esac; done
`)
  // psql: records each call (arguments and SQL) instead of running it.
  writeFileSync(join(bin, 'psql'), `#!/usr/bin/env bash
{ echo "ARGS $*"; [ -t 0 ] || cat; echo; } >> "$PSQL_LOG"
`)
  chmodSync(join(bin, 'pg_dump'), 0o755)
  chmodSync(join(bin, 'psql'), 0o755)
  gnupg = join(root, 'gnupg')
  execFileSync('mkdir', ['-m', '700', '-p', gnupg])
  const gpg = (...args) => execFileSync('gpg', ['--homedir', gnupg, '--batch', '--quiet', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  gpg('--passphrase', '', '--pinentry-mode', 'loopback', '--quick-gen-key', 'Backup Test <backup@test.invalid>', 'default', 'default', 'never')
  publicKey = join(root, 'backup-public-key.asc')
  writeFileSync(publicKey, gpg('--armor', '--export', 'backup@test.invalid'))
  privateKeyFile = join(root, 'private.asc')
  writeFileSync(privateKeyFile, gpg('--armor', '--pinentry-mode', 'loopback', '--passphrase', '', '--export-secret-keys', 'backup@test.invalid'))
})

after(() => {
  spawnSync('gpgconf', ['--homedir', gnupg, '--kill', 'all'])
  rmSync(root, { recursive: true, force: true })
})

let run = 0
/** Runs ops/backup.sh with the stubs; returns its outcome, the files it left and the SQL it sent. */
function backup(extra = {}) {
  const dir = join(root, `run-${++run}`)
  const log = join(root, `psql-${run}.log`)
  writeFileSync(log, '')
  const r = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: `${join(root, 'bin')}:${process.env.PATH}`,
      HOME: root,
      DATABASE_URL: DB_URL,
      BACKUP_DIR: dir,
      FAKE_DUMP: DUMP,
      PSQL_LOG: log,
      BACKUP_HEARTBEAT: 'true',
      ...extra,
    },
  })
  const files = existsSync(dir) ? readdirSync(dir).sort() : []
  return { code: r.status, out: r.stdout + r.stderr, files, dir, sql: readFileSync(log, 'utf8') }
}

const okBeat = (sql) => /INSERT INTO maintenance_runs \(step, last_ok_at\) VALUES \('backup', now\(\)\)/.test(sql)
const errBeat = (sql) => /last_err_at/.test(sql) && /msg=backup failed while/.test(sql)

describe('ops/backup.sh', () => {
  test('with the public key, the only file written is an encrypted .dump.gpg that the private key opens', () => {
    const r = backup({ BACKUP_GPG_PUBLIC_KEY_FILE: publicKey })
    assert.equal(r.code, 0, r.out)
    assert.equal(r.files.length, 1, r.files.join(', '))
    assert.match(r.files[0], /^mango-\d{8}T\d{6}Z\.dump\.gpg$/)
    const sealed = readFileSync(join(r.dir, r.files[0]))
    assert.ok(!sealed.includes('Asha Rao'), 'the dump is not readable without the key')
    const opened = execFileSync('gpg', ['--homedir', gnupg, '--batch', '--quiet', '--decrypt', join(r.dir, r.files[0])], { stdio: ['ignore', 'pipe', 'pipe'] })
    assert.equal(opened.toString(), DUMP)
    assert.ok(okBeat(r.sql), r.sql)
    assert.ok(!r.out.includes('not-a-real-password'))
  })

  test('with no key it refuses: no dump at all, and the failure is recorded', () => {
    const r = backup({})
    assert.notEqual(r.code, 0)
    assert.deepEqual(r.files, [])
    assert.match(r.out, /never written unencrypted/)
    assert.ok(errBeat(r.sql), r.sql)
    assert.ok(!okBeat(r.sql))
    assert.ok(!r.out.includes('not-a-real-password'))
  })

  test('a private key on the server is refused', () => {
    const r = backup({ BACKUP_GPG_PUBLIC_KEY_FILE: privateKeyFile })
    assert.notEqual(r.code, 0)
    assert.deepEqual(r.files, [])
    assert.match(r.out, /PRIVATE key/)
    assert.ok(errBeat(r.sql))
  })

  test('a missing key file is refused', () => {
    const r = backup({ BACKUP_GPG_PUBLIC_KEY_FILE: join(root, 'nope.asc') })
    assert.notEqual(r.code, 0)
    assert.deepEqual(r.files, [])
  })

  test('the upload command gets the encrypted file, in the same run', () => {
    const offsite = join(root, 'offsite')
    execFileSync('mkdir', ['-p', offsite])
    const r = backup({ BACKUP_GPG_PUBLIC_KEY_FILE: publicKey, BACKUP_REQUIRE_UPLOAD: 'true', BACKUP_UPLOAD_CMD: `cp "$BACKUP_FILE" ${offsite}/` })
    assert.equal(r.code, 0, r.out)
    assert.deepEqual(readdirSync(offsite), r.files)
    assert.match(r.files[0], /\.dump\.gpg$/)
    assert.ok(okBeat(r.sql))
  })

  test('with an upload required but not set, the run fails (the local copy stays) and no success is recorded', () => {
    const r = backup({ BACKUP_GPG_PUBLIC_KEY_FILE: publicKey, BACKUP_REQUIRE_UPLOAD: 'true' })
    assert.notEqual(r.code, 0)
    assert.equal(r.files.length, 1)
    assert.match(r.files[0], /\.dump\.gpg$/)
    assert.match(r.out, /only on this server/)
    assert.ok(errBeat(r.sql) && !okBeat(r.sql), r.sql)
  })

  test('a failed upload fails the run', () => {
    const r = backup({ BACKUP_GPG_PUBLIC_KEY_FILE: publicKey, BACKUP_UPLOAD_CMD: 'echo "storage said no" >&2; exit 3' })
    assert.notEqual(r.code, 0)
    assert.ok(errBeat(r.sql) && !okBeat(r.sql), r.sql)
    assert.match(r.sql, /msg=backup failed while copying the backup off the server/)
  })

  test('a failed dump leaves no half-written file behind', () => {
    const r = backup({ BACKUP_GPG_PUBLIC_KEY_FILE: publicKey, FAIL_DUMP: '1' })
    assert.notEqual(r.code, 0)
    assert.deepEqual(r.files, [])
    assert.match(r.sql, /msg=backup failed while dumping the database/)
  })

  test('without BACKUP_HEARTBEAT (the GitHub Action) nothing is written to the database', () => {
    const r = backup({ BACKUP_GPG_PUBLIC_KEY_FILE: publicKey, BACKUP_HEARTBEAT: '' })
    assert.equal(r.code, 0, r.out)
    assert.equal(r.sql, '')
  })
})

describe('a missed backup shows in Needs attention', () => {
  let srv
  let api
  let admin
  before(async () => {
    srv = await startServer()
    api = client(srv.base)
  })
  after(async () => {
    env.BACKUP_HEARTBEAT_EXPECTED = false
    await srv.close()
    await closeAll()
  })
  beforeEach(async () => {
    env.BACKUP_HEARTBEAT_EXPECTED = false
    await resetDb()
    admin = await adminToken(api)
  })
  const attention = async () => (await api.get('/admin/v1/attention', { token: admin })).body
  const recordBackup = (at) =>
    query(`INSERT INTO maintenance_runs (step, last_ok_at) VALUES ('backup', $1) ON CONFLICT (step) DO UPDATE SET last_ok_at = $1`, [at])

  test('no backup expected and none recorded (Vercel): no warning', async () => {
    assert.equal((await attention()).backup, null)
    assert.ok(!(await checkHealth({})).includes('backup'))
  })

  test('on the Docker server, no backup recorded yet is a warning', async () => {
    env.BACKUP_HEARTBEAT_EXPECTED = true
    assert.deepEqual((await attention()).backup, { lastOkAt: null, stale: true })
    assert.ok((await checkHealth({})).includes('backup'))
  })

  test('a recent backup is fine; one older than 26 hours is a warning', async () => {
    env.BACKUP_HEARTBEAT_EXPECTED = true
    await recordBackup(new Date(new Date(T0).getTime() - 3_600_000))
    let a = await attention()
    assert.equal(a.backup.stale, false)
    assert.ok(!(await checkHealth({})).includes('backup'))
    setNow(new Date(new Date(T0).getTime() + BACKUP_STALE_MS).toISOString())
    a = await attention()
    assert.equal(a.backup.stale, true)
    assert.ok(a.backup.lastOkAt)
  })

  test('once a backup has been recorded, it is checked even without the flag', async () => {
    await recordBackup(new Date(new Date(T0).getTime() - 30 * 3_600_000))
    assert.equal((await attention()).backup.stale, true)
  })

  test("the script's failure record shows as a failing step", async () => {
    env.BACKUP_HEARTBEAT_EXPECTED = true
    await recordBackup(new Date(new Date(T0).getTime() - 3_600_000))
    await query(`UPDATE maintenance_runs SET last_err_at = $1, last_error = 'backup failed while copying the backup off the server' WHERE step = 'backup'`, [new Date(T0)])
    const a = await attention()
    assert.deepEqual(a.loop.failingSteps.map((s) => [s.step, s.error]), [['backup', 'backup failed while copying the backup off the server']])
  })
})
