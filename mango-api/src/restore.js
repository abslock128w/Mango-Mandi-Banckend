// PLT-10 (24 Oct 2026 audit): after a database restore, order and booking
// numbers must not be handed out again. A restore puts order_seq and
// preorder_seq back to the restore point, so the next order would reuse the
// number of one the restore lost (customer messages, Razorpay receipts
// <number>-r<attempt>, support). ops/bump-sequences.js runs this.

/** The numbering sequences and the table and prefix each one numbers. */
export const SEQUENCES = [
  { seq: 'order_seq', table: 'orders', prefix: 'ORD-' },
  { seq: 'preorder_seq', table: 'preorders', prefix: 'PRE-' },
]

/**
 * The highest number each sequence has handed out on a database: its own
 * counter, or a higher number already stored (whichever is larger).
 */
export async function highWater(c) {
  const out = {}
  for (const { seq, table, prefix } of SEQUENCES) {
    const { rows } = await c.query(
      `SELECT GREATEST(
         (SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM ${seq}),
         COALESCE((SELECT MAX(substring(number FROM ${prefix.length + 1})::bigint) FROM ${table} WHERE number ~ $1), 0)
       )::bigint AS n`,
      [`^${prefix}[0-9]+$`],
    )
    out[seq] = Number(rows[0].n)
  }
  return out
}

/**
 * Moves each sequence past `seen` (from the database as it was before the
 * restore) plus `margin`, and never backwards. Returns each sequence's next
 * number.
 */
export async function bumpSequences(c, seen = {}, { margin = 0 } = {}) {
  const here = await highWater(c)
  const next = {}
  for (const { seq } of SEQUENCES) {
    const top = Math.max(here[seq], Number(seen[seq] ?? 0)) + margin
    await c.query('SELECT setval($1::regclass, $2::bigint, true)', [seq, top])
    next[seq] = top + 1
  }
  return next
}
