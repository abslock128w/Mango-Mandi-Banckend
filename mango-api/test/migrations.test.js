// Migrations must be safe to run while the previous version is still serving.
// On Vercel the build migrates the database, then the new version goes live,
// so for a minute the old code runs against the new schema. Add first, and
// remove a release later ("expand, then contract"): a file that drops,
// renames or narrows something must say so with a "-- contract:" line naming
// the release that stopped using it.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const DESTRUCTIVE = [/\bdrop\s+table\b/i, /\bdrop\s+column\b/i, /\brename\b/i, /\balter\s+column\s+\w+\s+(set\s+data\s+)?type\b/i, /\bset\s+not\s+null\b/i]

test('migrations only add, unless marked as a contract step', async () => {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  assert.ok(files.length > 0)
  for (const file of files) {
    const sql = await readFile(path.join(dir, file), 'utf8')
    const code = sql.replace(/--.*$/gm, '')
    const hits = DESTRUCTIVE.filter((re) => re.test(code))
    if (hits.length) assert.match(sql, /^-- contract: .+/m, `${file} drops, renames or narrows something without a "-- contract:" line`)
  }
})

test('migration files are numbered in order with no gaps or repeats', async () => {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  files.forEach((f, i) => assert.equal(f.slice(0, 3), String(i + 1).padStart(3, '0'), `${f} is out of sequence`))
})

// Locks. Each migration runs in one transaction under a lock_timeout
// (migrate.js), and whatever it locks stays locked until it commits. Two
// things hold a busy table for as long as it takes to read all of it:
//   - ADD CONSTRAINT ... CHECK / FOREIGN KEY scans the table under an
//     ACCESS EXCLUSIVE lock (no reads or writes). Add it NOT VALID instead,
//     and VALIDATE CONSTRAINT in the next migration file (that lock lets
//     reads and writes go on).
//   - CREATE INDEX on an existing table blocks its writes while it builds.
// Either is fine on a table that is new or small: say so on a "-- locks:" line.
// Files up to 020 ran before this rule and are left as they are.
const LOCK_RULES_FROM = 21

function lockProblems(sql) {
  const code = sql.replace(/--.*$/gm, '')
  const created = new Set([...code.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)/gi)].map((m) => m[1].toLowerCase()))
  const out = []
  for (const stmt of code.split(';')) {
    const table = /\balter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(\w+)/i.exec(stmt)?.[1]?.toLowerCase()
    if (/\badd\s+(constraint\s+\w+\s+)?(check|foreign\s+key)\b/i.test(stmt) && !/\bnot\s+valid\b/i.test(stmt) && !created.has(table)) {
      out.push(`constraint on ${table} without NOT VALID`)
    }
    const idx = /\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:\w+\s+)?on\s+(?:only\s+)?(\w+)/i.exec(stmt)
    if (idx && !created.has(idx[1].toLowerCase())) out.push(`index on existing table ${idx[1]}`)
  }
  return out
}

test('the lock lint spots full-table locks on existing tables', () => {
  assert.deepEqual(lockProblems(`ALTER TABLE notifications ADD CONSTRAINT k CHECK (kind IN ('A'));`), ['constraint on notifications without NOT VALID'])
  assert.deepEqual(lockProblems(`ALTER TABLE notifications ADD CONSTRAINT k CHECK (kind IN ('A')) NOT VALID;`), [])
  assert.deepEqual(lockProblems(`ALTER TABLE orders ADD CONSTRAINT f FOREIGN KEY (x) REFERENCES y (id);`), ['constraint on orders without NOT VALID'])
  assert.deepEqual(lockProblems(`CREATE INDEX idx_a ON order_events (created_at);`), ['index on existing table order_events'])
  assert.deepEqual(lockProblems(`CREATE INDEX IF NOT EXISTS idx_a ON order_events (created_at);`), ['index on existing table order_events'])
  assert.deepEqual(lockProblems(`CREATE TABLE t (id TEXT PRIMARY KEY, n INT);\nCREATE INDEX idx_t ON t (n);\nALTER TABLE t ADD CONSTRAINT c CHECK (n > 0);`), [])
  assert.deepEqual(lockProblems(`ALTER TABLE orders ADD COLUMN note TEXT; -- CREATE INDEX x ON orders (note)`), [])
})

test('new migrations avoid full-table locks, or say why one is fine', async () => {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql') && Number(f.slice(0, 3)) >= LOCK_RULES_FROM)
  for (const file of files) {
    const sql = await readFile(path.join(dir, file), 'utf8')
    const problems = lockProblems(sql)
    if (problems.length) {
      assert.match(sql, /^-- locks: .+/m, `${file}: ${problems.join('; ')}. Use NOT VALID, then VALIDATE in a later file, or add a "-- locks:" line saying why the lock is fine`)
    }
  }
})
