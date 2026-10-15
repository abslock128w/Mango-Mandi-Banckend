import pg from 'pg'
import { env } from './env.js'
import { logger } from './logger.js'

// DATE columns come back as plain "YYYY-MM-DD" strings, not JS Dates in local time.
pg.types.setTypeParser(1082, (v) => v)
// BIGINT counts (COUNT(*)) as numbers.
pg.types.setTypeParser(20, (v) => Number(v))

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
})

pool.on('error', (err) => logger.error({ err }, 'idle pg client error'))

export const query = (text, params) => pool.query(text, params)

/** Runs fn(client) inside a transaction. */
export async function tx(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Linear backoff: attempt × baseMs, up to `retries` attempts. */
export async function connectWithRetry(retries = 10, baseMs = 1000) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1')
      return
    } catch (err) {
      if (attempt >= retries) throw err
      logger.warn({ attempt, err: err.message }, 'database not ready, retrying')
      await new Promise((r) => setTimeout(r, attempt * baseMs))
    }
  }
}

export const closePool = () => pool.end()
