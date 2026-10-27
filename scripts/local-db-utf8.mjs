// The local database must store text as UTF-8. On Windows, older launchers let the
// database take the computer's own encoding (WIN1252), which has no ₹, → or Indian
// scripts, so any write carrying one failed with "Internal server error" (moving a
// batch writes "ARRIVING → SELLING" to its ledger). start-local.mjs now creates new
// databases as UTF-8 and uses copyDatabase to move an old one across, once.
//
// Both functions take connected node-postgres clients, so this file needs no packages.

/** The encoding a database stores text in ('UTF8', 'WIN1252', ...), or null if it doesn't exist. */
export async function databaseEncoding(client, name) {
  const { rows } = await client.query('SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1', [name])
  return rows[0]?.enc ?? null
}

async function tables(client) {
  const { rows } = await client.query(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition ORDER BY c.relname`,
  )
  return rows.map((r) => r.name)
}

async function columns(client, table, { insertable = false } = {}) {
  const { rows } = await client.query(
    `SELECT a.attname AS name FROM pg_attribute a
      WHERE a.attrelid = format('public.%I', $1::text)::regclass AND a.attnum > 0 AND NOT a.attisdropped
        AND ($2::boolean IS FALSE OR a.attgenerated = '')
      ORDER BY a.attnum`,
    [table, insertable],
  )
  return rows.map((r) => r.name)
}

const PAGE = 500

/**
 * Copies every row of `from` into `to`, which already has the schema (all migrations
 * run, nothing else in it). Rows the migrations themselves added in `to` are replaced
 * by `from`'s. Columns only one side has are left out (a column `to` added since gets
 * its default). Sequences continue where `from`'s were. All in one transaction, with
 * triggers and foreign-key checks off for this session only (the rows were already
 * valid in `from`), so the copy can go table by table in any order.
 * Returns { tables, rows }.
 */
export async function copyDatabase(from, to, { skip = ['schema_migrations'] } = {}) {
  const source = (await tables(from)).filter((t) => !skip.includes(t))
  const target = new Set((await tables(to)).filter((t) => !skip.includes(t)))
  let copied = 0
  await to.query('BEGIN')
  try {
    await to.query("SET LOCAL session_replication_role = 'replica'")
    for (const t of target) await to.query(`DELETE FROM public.${to.escapeIdentifier(t)}`)
    for (const t of source) {
      if (!target.has(t)) continue
      const theirs = new Set(await columns(to, t, { insertable: true }))
      const cols = (await columns(from, t)).filter((c) => theirs.has(c))
      if (!cols.length) continue
      const list = cols.map((c) => to.escapeIdentifier(c)).join(', ')
      const table = `public.${to.escapeIdentifier(t)}`
      // ctid pages through the table in a stable order without needing a key.
      for (let offset = 0; ; offset += PAGE) {
        const { rows } = await from.query(
          `SELECT row_to_json(x)::text AS j FROM (SELECT ${list} FROM public.${from.escapeIdentifier(t)} ORDER BY ctid LIMIT ${PAGE} OFFSET ${offset}) x`,
        )
        if (!rows.length) break
        await to.query(
          `INSERT INTO ${table} (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM json_populate_recordset(NULL::${table}, $1::json)`,
          [`[${rows.map((r) => r.j).join(',')}]`],
        )
        copied += rows.length
        if (rows.length < PAGE) break
      }
    }
    const { rows: seqs } = await from.query(`SELECT sequencename AS name, last_value FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL`)
    const { rows: ours } = await to.query(`SELECT sequencename AS name FROM pg_sequences WHERE schemaname = 'public'`)
    const known = new Set(ours.map((s) => s.name))
    for (const s of seqs) {
      if (known.has(s.name)) await to.query('SELECT setval(format($1, $2::text)::regclass, $3, true)', ['public.%I', s.name, s.last_value])
    }
    await to.query('COMMIT')
  } catch (err) {
    await to.query('ROLLBACK').catch(() => {})
    throw err
  }
  return { tables: source.filter((t) => target.has(t)).length, rows: copied }
}
