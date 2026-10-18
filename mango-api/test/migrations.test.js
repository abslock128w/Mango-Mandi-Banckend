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
