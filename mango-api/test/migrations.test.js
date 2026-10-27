// Migrations must be safe to run while the previous version is still serving.
// On Vercel the build migrates the database, then the new version goes live,
// so for a minute the old code runs against the new schema. Add first, and
// remove a release later ("expand, then contract"): a file that drops,
// renames or narrows something must say so with a "-- contract:" line naming
// the release that stopped using it.
import { closeAll, resetDb } from './helpers.js'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, test } from 'node:test'
import { now } from '../src/clock.js'
import { pool, query } from '../src/db.js'
import { migrate, migrationChecksum, runMigrations } from '../src/migrate.js'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const DESTRUCTIVE = [/\bdrop\s+table\b/i, /\bdrop\s+column\b/i, /\brename\b/i, /\balter\s+column\s+\w+\s+(set\s+data\s+)?type\b/i, /\bset\s+not\s+null\b/i]
// From 048 on, dropping any other object counts too: old code may still use the
// index, function, trigger, type or view, and a dropped check or key stops
// guarding rows the previous release still writes. Dropping one and making it
// again under the same name in the same file (widening a CHECK, README "Writing
// a migration") replaces it and is fine. Earlier files ran before this rule.
const STRICT_FROM = 48
const DROPPED = /\bdrop\s+(constraint|index|function|procedure|trigger|type|domain|(?:materialized\s+)?view)\s+(?:(?:if\s+exists|concurrently)\s+)*(\w+)/gi
const remade = (code, name) =>
  new RegExp(`\\b(add\\s+constraint|create\\s+(or\\s+replace\\s+)?(unique\\s+)?(index|function|procedure|trigger|type|domain|(materialized\\s+)?view)(\\s+if\\s+not\\s+exists)?)\\s+${name}\\b`, 'i').test(code)

/** The SQL with comments, dollar-quoted bodies (functions, DO blocks) and string literals blanked out. */
export function codeOnly(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, '')
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/'(?:[^']|'')*'/g, "''")
}

export function destructive(file, sql) {
  const code = codeOnly(sql)
  const hits = DESTRUCTIVE.filter((re) => re.test(code)).map(String)
  if (Number(file.slice(0, 3)) < STRICT_FROM) return hits
  const drops = [...code.matchAll(DROPPED)].filter((m) => !remade(code, m[2])).map((m) => `drop ${m[1].toLowerCase()} ${m[2]}`)
  return [...hits, ...drops]
}

test('migrations only add, unless marked as a contract step', async () => {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  assert.ok(files.length > 0)
  for (const file of files) {
    const sql = await readFile(path.join(dir, file), 'utf8')
    if (destructive(file, sql).length) assert.match(sql, /^-- contract: .+/m, `${file} drops, renames or narrows something without a "-- contract:" line`)
  }
})

test('from 048, dropping a constraint, index, function, trigger, type or view needs a contract line', () => {
  assert.equal(destructive('048_x.sql', 'ALTER TABLE orders DROP CONSTRAINT orders_money_not_negative;').length, 1)
  assert.equal(destructive('048_x.sql', 'DROP INDEX IF EXISTS orders_refund_pending;').length, 1)
  assert.equal(destructive('050_x.sql', 'DROP FUNCTION log_append_only();').length, 1)
  assert.equal(destructive('050_x.sql', 'DROP TRIGGER t ON orders;').length, 1)
  assert.equal(destructive('050_x.sql', 'DROP TYPE mood;').length, 1)
  assert.equal(destructive('050_x.sql', 'DROP MATERIALIZED VIEW daily;').length, 1)
  assert.equal(destructive('050_x.sql', 'DROP VIEW daily;').length, 1)
  assert.deepEqual(destructive('050_x.sql', 'DROP INDEX CONCURRENTLY IF EXISTS orders_refund_pending;'), ['drop index orders_refund_pending'])
  // Made again under the same name in the same file: a replacement (widening a check), not a removal.
  assert.deepEqual(destructive('050_x.sql', `ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('A', 'B')) NOT VALID;`), [])
  assert.deepEqual(destructive('050_x.sql', 'DROP TRIGGER t_audit ON orders;\nCREATE TRIGGER t_audit AFTER UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION f();'), [])
  assert.deepEqual(destructive('050_x.sql', 'ALTER TABLE t DROP CONSTRAINT c_old;\nALTER TABLE t ADD CONSTRAINT c_new CHECK (n > 0) NOT VALID;'), ['drop constraint c_old'])
  // Earlier files dropped checks before the rule; words in comments and strings don't count.
  assert.deepEqual(destructive('041_x.sql', 'ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;'), [])
  assert.deepEqual(destructive('050_x.sql', "-- we never DROP INDEX here\nCOMMENT ON TABLE t IS 'drop index later';"), [])
  assert.deepEqual(destructive('050_x.sql', 'ALTER TABLE t ADD COLUMN n INT;'), [])
})

// Each file runs inside the transaction migrate.js opens. A file's own BEGIN or
// COMMIT would end that transaction early (the rest of the file, and its record
// in schema_migrations, would no longer be all-or-nothing), and CONCURRENTLY
// cannot run inside a transaction at all.
export function transactionProblems(sql) {
  const code = codeOnly(sql)
  const out = []
  if (/(^|;)\s*(begin|commit|rollback|abort|end|start\s+transaction|savepoint|release\s+savepoint)\b/i.test(code)) out.push('controls its own transaction')
  if (/\bconcurrently\b/i.test(code)) out.push('uses CONCURRENTLY')
  return out
}

test('the transaction lint spots BEGIN, COMMIT and CONCURRENTLY, but not function bodies', () => {
  assert.deepEqual(transactionProblems('BEGIN;\nALTER TABLE t ADD COLUMN n INT;\nCOMMIT;'), ['controls its own transaction'])
  assert.deepEqual(transactionProblems('ALTER TABLE t ADD COLUMN n INT;\ncommit;'), ['controls its own transaction'])
  assert.deepEqual(transactionProblems('START TRANSACTION; SELECT 1;'), ['controls its own transaction'])
  assert.deepEqual(transactionProblems('CREATE INDEX CONCURRENTLY i ON t (n);'), ['uses CONCURRENTLY'])
  assert.deepEqual(transactionProblems(`CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'no';
END $$;
DO $body$ BEGIN PERFORM 1; END $body$;
ALTER TABLE t ADD CONSTRAINT c CHECK (kind IN ('BEGIN', 'COMMIT')) NOT VALID; -- COMMIT here is a comment`), [])
})

test('no migration controls its own transaction or uses CONCURRENTLY', async () => {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    const problems = transactionProblems(await readFile(path.join(dir, file), 'utf8'))
    assert.deepEqual(problems, [], `${file} ${problems.join(' and ')}: each file already runs in one transaction (src/migrate.js)`)
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

// ---------------------------------------------------------------- the runner, on the test database

describe('the migration runner', () => {
  before(resetDb)
  after(closeAll)

  const recorded = async () => new Map((await query('SELECT version, checksum FROM schema_migrations')).rows.map((r) => [r.version, r.checksum]))
  const expected = async () => {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
    return new Map(await Promise.all(files.map(async (f) => [f, migrationChecksum(await readFile(path.join(dir, f), 'utf8'))])))
  }

  test('a fresh database records every file with its checksum, the ones before 048 too', async () => {
    const got = await recorded()
    for (const [file, sum] of await expected()) assert.equal(got.get(file), sum, file)
  })

  test('checksums missing from an older database are filled on the next run', async () => {
    await query(`UPDATE schema_migrations SET checksum = NULL WHERE version < '048'`)
    await runMigrations()
    const got = await recorded()
    for (const [file, sum] of await expected()) assert.equal(got.get(file), sum, file)
  })

  test('a file changed after it was applied stops the run, naming the file, before anything else is applied', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'mig-'))
    const original = '-- a probe\nALTER TABLE notifications ADD COLUMN sum_probe INT;\n'
    try {
      await writeFile(path.join(tmp, '900_sum_probe.sql'), original)
      await migrate(pool, { dir: tmp })
      assert.equal((await recorded()).get('900_sum_probe.sql'), migrationChecksum(original))
      // The same file with Windows line endings is the same file.
      await writeFile(path.join(tmp, '900_sum_probe.sql'), original.replace(/\n/g, '\r\n'))
      await migrate(pool, { dir: tmp })

      await writeFile(path.join(tmp, '900_sum_probe.sql'), original.replace('INT', 'BIGINT'))
      await writeFile(path.join(tmp, '901_after.sql'), 'ALTER TABLE notifications ADD COLUMN after_probe INT;')
      await assert.rejects(migrate(pool, { dir: tmp }), /Migration 900_sum_probe\.sql changed after it was applied to this database: refusing to start/)
      assert.equal((await recorded()).has('901_after.sql'), false)
      assert.equal((await query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'after_probe'`)).rowCount, 0)

      // An intended edit: clear the record, and the next run takes the file as it is now.
      await query(`UPDATE schema_migrations SET checksum = NULL WHERE version = '900_sum_probe.sql'`)
      await migrate(pool, { dir: tmp })
      assert.equal((await recorded()).get('900_sum_probe.sql'), migrationChecksum(original.replace('INT', 'BIGINT')))
      assert.equal((await recorded()).has('901_after.sql'), true)
    } finally {
      await rm(tmp, { recursive: true })
      await query(`DELETE FROM schema_migrations WHERE version IN ('900_sum_probe.sql', '901_after.sql')`)
      await query('ALTER TABLE notifications DROP COLUMN IF EXISTS sum_probe, DROP COLUMN IF EXISTS after_probe')
    }
  })

  test('a file whose second statement fails leaves nothing of its first', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'mig-'))
    try {
      await writeFile(path.join(tmp, '902_half.sql'), 'CREATE TABLE half_probe (id INT);\nINSERT INTO half_probe VALUES (1);\nINSERT INTO no_such_table VALUES (1);\n')
      await assert.rejects(migrate(pool, { dir: tmp }), /Migration 902_half\.sql failed: relation "no_such_table" does not exist/)
      assert.equal((await query(`SELECT to_regclass('public.half_probe') AS t`)).rows[0].t, null)
      assert.equal((await recorded()).has('902_half.sql'), false)
    } finally {
      await rm(tmp, { recursive: true })
    }
  })

  test('the checks and keys added NOT VALID are validated (049)', async () => {
    const names = [
      'batch_ledger_reason_code_check', 'wh_operations_type_check', 'orders_money_not_negative', 'orders_refund_status_known', 'preorders_refund_status_known',
      'duplicate_payments_refund_status_known', 'notifications_kind_check', 'notifications_target', 'customers_language_check',
      'payment_disputes_order_fk', 'payment_disputes_preorder_fk', 'payment_disputes_status_known', 'duplicate_payments_amount_not_negative',
      'order_items_price_not_negative', 'order_items_listing_fk',
    ]
    const { rows } = await query(`SELECT conname, convalidated FROM pg_constraint WHERE conname = ANY($1) AND connamespace = 'public'::regnamespace`, [names])
    assert.deepEqual(rows.map((r) => r.conname).sort(), [...names].sort())
    assert.deepEqual(rows.filter((r) => !r.convalidated).map((r) => r.conname), [])
  })

  test('the new keys refuse bad rows', async () => {
    const at = now()
    await query(`INSERT INTO orders (id, number, status, delivery_date, placed_at, subtotal, total) VALUES ('ord_keys', 'ORD-KEYS', 'DELIVERED', '2026-10-16', $1, 100, 100)`, [at])
    const dispute = (id, extra) => query(
      `INSERT INTO payment_disputes (dispute_id, payment_id, order_id, preorder_id, status, last_event, created_at, updated_at) VALUES ($1, 'pay_k', $2, $3, $4, 'payment.dispute.created', $5, $5)`,
      [id, extra.orderId ?? null, extra.preorderId ?? null, extra.status ?? 'open', at],
    )
    await dispute('disp_ok', { orderId: 'ord_keys' })
    await dispute('disp_created', { status: 'created' })
    await assert.rejects(dispute('disp_o', { orderId: 'ord_missing' }), /payment_disputes_order_fk/)
    await assert.rejects(dispute('disp_p', { preorderId: 'pre_missing' }), /payment_disputes_preorder_fk/)
    await assert.rejects(dispute('disp_s', { status: 'resolved?' }), /payment_disputes_status_known/)

    const dup = (id, amount) => query('INSERT INTO duplicate_payments (payment_id, amount, found_at) VALUES ($1, $2, $3)', [id, amount, at])
    await dup('pay_dup_null', null)
    await dup('pay_dup_zero', 0)
    await assert.rejects(dup('pay_dup_neg', -1), /duplicate_payments_amount_not_negative/)

    const item = (id, unit, line, listing = null) =>
      query(`INSERT INTO order_items (id, order_id, sku, quantity, stage, unit_price, line_price, listing_id) VALUES ($1, 'ord_keys', 'ALP-3', 1, 'RIPE', $2, $3, $4)`, [id, unit, line, listing])
    await item('itm_free', 0, 0)
    await assert.rejects(item('itm_neg', -100, -100), /order_items_price_not_negative/)
    await assert.rejects(item('itm_line', 100, -1), /order_items_price_not_negative/)
    await assert.rejects(item('itm_listing', 100, 100, 'bl_missing'), /order_items_listing_fk/)
  })
})
