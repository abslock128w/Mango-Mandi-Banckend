// Applies migrations/*.sql in filename order, each in its own transaction,
// under an advisory lock so concurrent instances never race.
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { pool } from './db.js'
import { logger } from './logger.js'

const MIGRATION_LOCK = 427714201
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

export async function runMigrations() {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK])
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
    const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version))
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      if (done.has(file)) continue
      const sql = await readFile(path.join(dir, file), 'utf8')
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file])
        await client.query('COMMIT')
        logger.info({ file }, 'migration applied')
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${file} failed: ${err.message}`)
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {})
    client.release()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      logger.error(err.message)
      process.exit(1)
    })
}
