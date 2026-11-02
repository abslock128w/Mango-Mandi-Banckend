// pg 8 warns (and pg 9 will refuse) when a client is sent a query while it is still running
// one. Code often fans out with Promise.all on one transaction client (warehouse reconciliation,
// order detail, reports), so db.js runs a client's queries one after another itself.
import './setup-env.js'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { pool, tx } from '../src/db.js'

after(() => pool.end())

test('queries sent together on one transaction client run in order, with no pg warning', async () => {
  const warnings = []
  const onWarning = (w) => warnings.push(w)
  process.on('warning', onWarning)
  try {
    const out = await tx((c) =>
      Promise.all([
        c.query('SELECT pg_sleep(0.05), 1 AS n'),
        c.query('SELECT 2 AS n'),
        c.query('SELECT 3 AS n'),
      ]),
    )
    assert.deepEqual(out.map((r) => r.rows[0].n), [1, 2, 3])
    await new Promise((r) => setImmediate(r))
  } finally {
    process.off('warning', onWarning)
  }
  assert.deepEqual(warnings.filter((w) => /already executing a query/.test(w.message)).map((w) => w.message), [])
})

test('a failed query in the queue fails alone and the next one still runs', async () => {
  const c = await pool.connect()
  try {
    const [bad, good] = await Promise.allSettled([c.query('SELECT * FROM no_such_table'), c.query('SELECT 4 AS n')])
    assert.equal(bad.status, 'rejected')
    assert.equal(good.status, 'fulfilled')
    assert.equal(good.value.rows[0].n, 4)
  } finally {
    c.release()
  }
})
