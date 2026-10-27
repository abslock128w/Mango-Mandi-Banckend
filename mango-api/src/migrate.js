// Applies migrations/*.sql in filename order, each in its own transaction,
// under an advisory lock so concurrent deploys never race. The lock is a
// session lock, so on Neon this runs on the direct (unpooled) connection: on
// Vercel it is the API's build step (npm run vercel-build), and a failed
// migration fails the build, so that version never goes live.
//
// Each applied file's sha256 is kept in schema_migrations.checksum (added by
// 048). A file that changed after it was applied stops the run before anything
// else is applied: what the database holds would no longer match the file.
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'
import { pool as appPool } from './db.js'
import { deployEnv, env } from './env.js'
import { logger } from './logger.js'

const MIGRATION_LOCK = 427714201
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

/**
 * How long one migration statement may wait for a table lock. An ALTER TABLE
 * queued behind a long transaction would otherwise hold every order write up
 * behind it; with this it gives up, the transaction rolls back, and the
 * runner tries again a little later (then fails the build).
 */
export const MIGRATION_LOCK_TIMEOUT = process.env.MIGRATION_LOCK_TIMEOUT || '5s'
const LOCK_ATTEMPTS = 3
const LOCK_RETRY_MS = 3_000
const LOCK_NOT_AVAILABLE = '55P03'

export async function runMigrations() {
  const direct = env.DATABASE_URL_UNPOOLED ? new pg.Pool({ connectionString: env.DATABASE_URL_UNPOOLED, max: 1 }) : null
  try {
    await migrate(direct ?? appPool)
  } finally {
    await direct?.end()
  }
}

/**
 * Every database remembers which environment it belongs to (app_meta), set
 * by the first migration. A preview or development build pointed at the
 * production database (an env var copied to the wrong environment) is
 * refused before it can migrate, seed or serve it, and the other way round.
 * If a move is intended: UPDATE app_meta SET value = '<env>' WHERE key = 'environment'.
 */
export const isProductionEnv = (e) => e === 'production'

export async function checkDatabaseEnvironment(c, target = deployEnv, { claim = false } = {}) {
  if (claim) await c.query('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  else if (!(await c.query(`SELECT to_regclass('public.app_meta') AS t`)).rows[0].t) return target // not migrated yet
  const { rows } = await c.query(`SELECT value FROM app_meta WHERE key = 'environment'`)
  const owner = rows[0]?.value
  if (!owner) {
    if (claim) await c.query(`INSERT INTO app_meta (key, value) VALUES ('environment', $1) ON CONFLICT DO NOTHING`, [target])
    return target
  }
  if (isProductionEnv(owner) !== isProductionEnv(target)) {
    throw new Error(`This database belongs to ${owner}, and this is a ${target} deployment: refusing to use it. Point DATABASE_URL at the right Neon branch.`)
  }
  return owner
}

/**
 * The app writes ₹, → and names in any script, so the database must store UTF-8. A database in
 * another encoding (Windows makes WIN1252 by default) would fail those writes one by one with
 * "Internal server error", so it is refused here, before anything runs on it.
 */
export async function checkUtf8(client) {
  const { rows } = await client.query('SHOW server_encoding')
  const enc = rows[0].server_encoding
  if (enc !== 'UTF8') {
    throw new Error(`This database stores text as ${enc}, not UTF8, so it can't save ₹ or →. Create it with ENCODING 'UTF8' (TEMPLATE template0). scripts/start-local.mjs converts its own database by itself.`)
  }
}

/**
 * The sha256 of a migration file. Windows line endings count as Unix ones, so a
 * checkout with git's autocrlf on is not taken for an edit.
 */
export const migrationChecksum = (sql) => createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')

const hasChecksumColumn = async (client) =>
  (await client.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'schema_migrations' AND column_name = 'checksum'`)).rowCount > 0

/** Throws when a file in `dir` was applied with other content than it has now. */
function checkApplied(applied, sums) {
  const changed = [...sums].filter(([file, sum]) => applied.get(file) && applied.get(file) !== sum).map(([file]) => file)
  if (!changed.length) return
  throw new Error(
    `Migration ${changed.join(', ')} changed after it was applied to this database: refusing to start. ` +
      'Put the file back as it was and make the change in a new migration file. If the edit is harmless (a comment) and intended, ' +
      `clear its record so it is taken again: UPDATE schema_migrations SET checksum = NULL WHERE version = '${changed[0]}';`,
  )
}

export async function migrate(pool, { dir = DIR, lockTimeout = MIGRATION_LOCK_TIMEOUT, attempts = LOCK_ATTEMPTS, retryMs = LOCK_RETRY_MS } = {}) {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK])
    await checkUtf8(client)
    await checkDatabaseEnvironment(client, deployEnv, { claim: true })
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
    let withSums = await hasChecksumColumn(client)
    const applied = new Map((await client.query(`SELECT version, ${withSums ? 'checksum' : 'NULL AS checksum'} FROM schema_migrations`)).rows.map((r) => [r.version, r.checksum]))
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
    const texts = new Map()
    for (const file of files) texts.set(file, await readFile(path.join(dir, file), 'utf8'))
    const sums = new Map(files.map((f) => [f, migrationChecksum(texts.get(f))]))
    checkApplied(applied, sums)
    for (const file of files) {
      if (applied.has(file)) continue
      const sql = texts.get(file)
      for (let attempt = 1; ; attempt++) {
        try {
          await client.query('BEGIN')
          await client.query(`SELECT set_config('lock_timeout', $1, true)`, [lockTimeout])
          await client.query(sql)
          // The file that adds the column (048) is recorded with its checksum too.
          const sum = withSums || (await hasChecksumColumn(client)) ? sums.get(file) : null
          if (sum) await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [file, sum])
          else await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file])
          await client.query('COMMIT')
          withSums ||= Boolean(sum)
          applied.set(file, sum)
          logger.info({ file }, 'migration applied')
          break
        } catch (err) {
          await client.query('ROLLBACK')
          if (err.code === LOCK_NOT_AVAILABLE && attempt < attempts) {
            logger.warn({ file, attempt }, 'migration waited too long for a table lock; trying again')
            await new Promise((r) => {
              setTimeout(r, retryMs)
            })
            continue
          }
          const hint = err.code === LOCK_NOT_AVAILABLE ? ` (a table it changes stayed locked for over ${lockTimeout}, ${attempts} times: look for a long transaction in pg_stat_activity)` : ''
          throw new Error(`Migration ${file} failed: ${err.message}${hint}`)
        }
      }
    }
    // Files applied before checksums were kept (earlier, or earlier in this run), or whose record was
    // cleared, are recorded as they are now.
    if (withSums) {
      for (const file of files) {
        if (applied.has(file) && !applied.get(file)) {
          await client.query('UPDATE schema_migrations SET checksum = $2 WHERE version = $1 AND checksum IS NULL', [file, sums.get(file)])
        }
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {})
    client.release()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => appPool.end())
    .catch((err) => {
      logger.error(err.message)
      process.exit(1)
    })
}
