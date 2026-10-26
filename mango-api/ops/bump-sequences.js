// After a database restore: moves the order and booking number sequences past
// every number the database had handed out before the restore, so no number
// is used twice (PLT-10, 24 Oct 2026 audit).
//
//   node --env-file=.env ops/bump-sequences.js --old-url <pre-restore DB URL>
//   node --env-file=.env ops/bump-sequences.js --margin 1000
//
// --old-url is the database as it was before the restore (Neon keeps it as a
// backup branch when you restore main). Without it, --margin skips that many
// numbers past the highest one the restored database knows: pick more than the
// orders the shop could have taken since the restore point.
import { parseArgs } from 'node:util'
import pg from 'pg'
import { closePool, tx } from '../src/db.js'
import { bumpSequences, highWater } from '../src/restore.js'

const { values } = parseArgs({ options: { 'old-url': { type: 'string' }, margin: { type: 'string' } } })
const margin = values.margin === undefined ? 0 : Number(values.margin)
if (!values['old-url'] && !(margin > 0)) {
  console.error('usage: ops/bump-sequences.js --old-url <pre-restore DB url>  |  --margin <numbers to skip>')
  process.exit(2)
}
if (!Number.isInteger(margin) || margin < 0) {
  console.error('--margin must be a whole number')
  process.exit(2)
}
let seen = {}
if (values['old-url']) {
  const old = new pg.Client({ connectionString: values['old-url'] })
  await old.connect()
  try {
    seen = await highWater(old)
  } finally {
    await old.end()
  }
}
try {
  const next = await tx((c) => bumpSequences(c, seen, { margin }))
  for (const [seq, n] of Object.entries(next)) console.log(`${seq}: the next number is ${n}`)
} finally {
  await closePool()
}
