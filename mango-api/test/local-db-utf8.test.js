// The database must store UTF-8. A Windows laptop made the local database as WIN1252, so
// moving a batch (its ledger line has "→") failed with "Internal server error". migrate()
// now refuses such a database, and scripts/local-db-utf8.mjs copies one into UTF-8 with
// its data (start-local.mjs runs that once, on its own database).
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import pg from 'pg'
import { copyDatabase, databaseEncoding } from '../../scripts/local-db-utf8.mjs'
import { closeAll, resetDb } from './helpers.js'
import { pool } from '../src/db.js'
import { migrate } from '../src/migrate.js'

// Straight to the server: a pooler (CI runs the suite through PgBouncer, as on Neon) only knows the test database.
const base = new URL(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL)
const name = (suffix) => `${base.pathname.slice(1).replace(/_test$/, '')}_${suffix}_test`
const OLD = name('win1252')
const NEW = name('utf8copy')
const urlOf = (db) => Object.assign(new URL(base), { pathname: `/${db}` }).toString()

let admin
const opened = []
async function connect(db) {
  const c = new pg.Client({ connectionString: urlOf(db) })
  await c.connect()
  opened.push(c)
  return c
}

// A schema with the awkward parts: identity and serial keys, jsonb, arrays, dates, bytea, a
// generated column, a foreign key and an append-only trigger like batch_ledger's.
const SCHEMA = `
  CREATE TABLE farms (id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE crates (
    id SERIAL PRIMARY KEY, farm_id INT NOT NULL REFERENCES farms (id), label TEXT, tags TEXT[], info JSONB,
    picked_on DATE, photo BYTEA, boxes INT NOT NULL, doubled INT GENERATED ALWAYS AS (boxes * 2) STORED
  );
  CREATE TABLE log (id TEXT PRIMARY KEY, note TEXT);
  CREATE FUNCTION log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append only'; END $$;
  CREATE TRIGGER log_no_delete BEFORE UPDATE OR DELETE ON log FOR EACH ROW EXECUTE FUNCTION log_append_only();
  CREATE TABLE schema_migrations (version TEXT PRIMARY KEY);
`

before(async () => {
  await resetDb()
  admin = new pg.Client({ connectionString: urlOf('postgres') })
  await admin.connect()
  for (const db of [OLD, NEW]) await admin.query(`DROP DATABASE IF EXISTS ${db}`)
  await admin.query(`CREATE DATABASE ${OLD} TEMPLATE template0 ENCODING 'WIN1252' LC_COLLATE 'C' LC_CTYPE 'C'`)
  await admin.query(`CREATE DATABASE ${NEW} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`)
})
after(async () => {
  for (const c of opened) await c.end().catch(() => {})
  for (const db of [OLD, NEW]) await admin.query(`DROP DATABASE IF EXISTS ${db}`)
  await admin.end()
  await closeAll()
})

test('this is the error the laptop hit: a WIN1252 database cannot store "→"', async () => {
  const old = await connect(OLD)
  await assert.rejects(old.query(`SELECT 'ARRIVING → SELLING'::text`), /has no equivalent in encoding "WIN1252"/)
  assert.equal(await databaseEncoding(admin, OLD), 'WIN1252')
  assert.equal(await databaseEncoding(admin, NEW), 'UTF8')
  assert.equal(await databaseEncoding(admin, name('missing')), null)
})

test('migrations refuse a database that is not UTF-8, before changing anything', async () => {
  const p = new pg.Pool({ connectionString: urlOf(OLD), max: 1 })
  try {
    await assert.rejects(migrate(p), /stores text as WIN1252, not UTF8/)
    const { rows } = await p.query(`SELECT to_regclass('public.schema_migrations') AS t`)
    assert.equal(rows[0].t, null)
  } finally {
    await p.end()
  }
  await migrate(pool) // the UTF-8 test database is fine
})

test('copyDatabase moves every row across, with sequences, and replaces what the migrations added', async () => {
  const old = await connect(OLD)
  const fresh = await connect(NEW)
  await old.query(SCHEMA)
  await fresh.query(SCHEMA)
  await fresh.query(`ALTER TABLE crates ADD COLUMN grade TEXT NOT NULL DEFAULT 'A'`) // a column added since
  await fresh.query(`INSERT INTO farms (name) VALUES ('added by a migration')`)
  await fresh.query(`INSERT INTO schema_migrations VALUES ('001_init.sql'), ('002_new.sql')`)

  await old.query(`INSERT INTO farms (name) VALUES ('Ratnagiri'), ('Devgad café')`)
  for (let i = 0; i < 1203; i++) {
    await old.query(`INSERT INTO crates (farm_id, label, tags, info, picked_on, photo, boxes) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
      1 + (i % 2), `crate ${i}`, ['ripe', `t${i}`], { n: i, note: 'Hapus', list: [1, 2] }, '2026-10-24', Buffer.from([0, 255, i % 256]), i,
    ])
  }
  await old.query(`INSERT INTO log VALUES ('l1', 'IN_TRANSIT - ARRIVED'), ('l2', NULL)`)
  await old.query(`INSERT INTO schema_migrations VALUES ('001_init.sql')`)

  const out = await copyDatabase(old, fresh)
  assert.deepEqual(out, { tables: 3, rows: 2 + 1203 + 2 })

  assert.deepEqual((await fresh.query('SELECT id, name FROM farms ORDER BY id')).rows, [{ id: 1, name: 'Ratnagiri' }, { id: 2, name: 'Devgad café' }])
  const crate = (await fresh.query('SELECT * FROM crates WHERE id = 8')).rows[0]
  const before = (await old.query('SELECT * FROM crates WHERE id = 8')).rows[0]
  assert.deepEqual({ ...crate, grade: undefined }, { ...before, grade: undefined })
  assert.equal(crate.grade, 'A')
  assert.equal(crate.doubled, 14)
  assert.deepEqual(crate.photo, Buffer.from([0, 255, 7]))
  assert.equal((await fresh.query('SELECT COUNT(*)::int AS n FROM crates')).rows[0].n, 1203)
  assert.deepEqual((await fresh.query('SELECT * FROM log ORDER BY id')).rows, [{ id: 'l1', note: 'IN_TRANSIT - ARRIVED' }, { id: 'l2', note: null }])
  // The new database's own migration record stays (it has run every migration).
  assert.equal((await fresh.query('SELECT COUNT(*)::int AS n FROM schema_migrations')).rows[0].n, 2)
  // Keys carry on after the copied rows, and the new database stores what the old one couldn't.
  assert.equal((await fresh.query(`INSERT INTO farms (name) VALUES ('Next') RETURNING id`)).rows[0].id, 3)
  assert.equal((await fresh.query(`INSERT INTO crates (farm_id, boxes) VALUES (1, 1) RETURNING id`)).rows[0].id, 1204)
  await fresh.query(`INSERT INTO log VALUES ('l3', 'ARRIVING → SELLING ₹')`)
  // Triggers and foreign keys are back on once the copy is done.
  await assert.rejects(fresh.query(`DELETE FROM log WHERE id = 'l1'`), /append only/)
  await assert.rejects(fresh.query(`INSERT INTO crates (farm_id, boxes) VALUES (99, 1)`), /foreign key/)
})

test('a failed copy changes nothing in the new database', async () => {
  const old = await connect(OLD)
  const fresh = await connect(NEW)
  await old.query(`CREATE TABLE IF NOT EXISTS clash (v TEXT)`)
  await fresh.query(`CREATE TABLE IF NOT EXISTS clash (v INT)`)
  await old.query(`INSERT INTO clash VALUES ('not a number')`)
  const farms = (await fresh.query('SELECT COUNT(*)::int AS n FROM farms')).rows[0].n
  await assert.rejects(copyDatabase(old, fresh), /invalid input syntax for type integer/)
  assert.equal((await fresh.query('SELECT COUNT(*)::int AS n FROM farms')).rows[0].n, farms)
})
