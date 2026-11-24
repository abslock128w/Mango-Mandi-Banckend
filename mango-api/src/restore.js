// PLT-10 (24 Oct 2026 audit): after a database restore, order and booking
// numbers must not be handed out again. A restore puts order_seq and
// preorder_seq back to the restore point, so the next order would reuse the
// number of one the restore lost (customer messages, Razorpay receipts
// <number>-r<attempt>, support). ops/bump-sequences.js runs this.
//
// The same goes for every other number a customer or the tax office sees:
// gift orders, subscriptions, help requests, and the bill number counter
// (bill_counters, one row per financial year). Since migration 077 orders,
// pre-orders, gifts and bulk orders are numbered by letter (order-number.js):
// each letter's sequence moves past the highest number of that letter stored
// in any of its tables.

import { INVERSE, INVERSE9, LETTER_SEQ } from './order-number.js'
import { financialYear } from './bills.js'
import { todayIST } from './clock.js'

/** The numbering sequences and the table and prefix each one numbers. */
export const SEQUENCES = [
  { seq: 'order_seq', table: 'orders', prefix: 'ORD-', scrambled: true },
  { seq: 'preorder_seq', table: 'preorders', prefix: 'PRE-' },
  { seq: 'gift_order_seq', table: 'gift_orders', prefix: 'GFT-' },
  { seq: 'preorder_group_seq', table: 'preorder_groups', prefix: 'PGR-' },
  { seq: 'subscription_seq', table: 'subscriptions', prefix: 'SUB-' },
  { seq: 'help_ticket_seq', table: 'help_tickets', prefix: 'HLP-' },
  // Lettered numbers (migration 077): each letter's sequence, and every table that stores that letter.
  // G is one sequence shared by four tables (order-number.js).
  { seq: LETTER_SEQ.S, letter: 'S', tables: ['orders'] },
  { seq: LETTER_SEQ.P, letter: 'P', tables: ['orders', 'preorders'] },
  { seq: LETTER_SEQ.G, letter: 'G', tables: ['orders', 'gift_orders', 'preorders', 'preorder_groups'] },
  { seq: LETTER_SEQ.B, letter: 'B', tables: ['bulk_enquiries'] },
]

/** The highest sequence value behind any stored number of a letter: its digits turned back (INVERSE9). */
const letteredHigh = (letter, tables) =>
  tables
    .map((t) => `COALESCE((SELECT MAX((substr(number, 2)::numeric * ${INVERSE9}) % 1000000000) FROM ${t} WHERE number ~ '^${letter}[0-9]{9}$'), 0)`)
    .join(', ')

/** Bill numbers per financial year: the counter, or a higher number already on a bill. */
async function billHighWater(c) {
  const { rows } = await c.query(
    `SELECT fy, MAX(n)::int AS n FROM (
       SELECT fy, last_no AS n FROM bill_counters
       UNION ALL SELECT fy, MAX(seq) FROM bills GROUP BY fy
     ) t GROUP BY fy`,
  )
  return Object.fromEntries(rows.map((r) => [r.fy, Number(r.n)]))
}

/**
 * The highest number each sequence has handed out on a database: its own
 * counter, or a higher number already stored (whichever is larger).
 */
export async function highWater(c) {
  const out = {}
  for (const { seq, table, prefix, scrambled, letter, tables } of SEQUENCES) {
    if (letter) {
      // A database from before migration 077 (an old backup) has no such sequence yet: its stored numbers still count.
      const has = (await c.query('SELECT to_regclass($1) IS NOT NULL AS ok', [seq])).rows[0].ok
      const counter = has ? `(SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM ${seq})` : '0'
      const { rows } = await c.query(`SELECT GREATEST(${counter}, ${letteredHigh(letter, tables)})::bigint AS n`)
      out[seq] = Number(rows[0].n)
      continue
    }
    // Orders numbered since the 10-digit format (orders.js) are turned back into their sequence value.
    const tenDigit = scrambled
      ? `, COALESCE((SELECT MAX(((number::numeric - 1000000000) * ${INVERSE}) % 9000000000) FROM ${table} WHERE number ~ '^[1-9][0-9]{9}$'), 0)`
      : ''
    const { rows } = await c.query(
      `SELECT GREATEST(
         (SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM ${seq}),
         COALESCE((SELECT MAX(substring(number FROM ${prefix.length + 1})::bigint) FROM ${table} WHERE number ~ $1), 0)${tenDigit}
       )::bigint AS n`,
      [`^${prefix}[0-9]+$`],
    )
    out[seq] = Number(rows[0].n)
  }
  out.bills = await billHighWater(c)
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
    // A sequence never used (a lettered one on a new database) starts at 1: setval can't go below it.
    if (top < 1) await c.query('SELECT setval($1::regclass, 1, false)', [seq])
    else await c.query('SELECT setval($1::regclass, $2::bigint, true)', [seq, top])
    next[seq] = top + 1
  }
  // Bill counters: every financial year either side knows, plus this one when
  // skipping a margin (bills taken since the restore point may be this year's).
  const bills = await billHighWater(c)
  const seenBills = seen.bills ?? {}
  const years = new Set([...Object.keys(bills), ...Object.keys(seenBills)])
  if (margin > 0) years.add(financialYear(todayIST()))
  next.bills = {}
  for (const fy of [...years].sort()) {
    const top = Math.max(bills[fy] ?? 0, Number(seenBills[fy] ?? 0)) + margin
    await c.query(
      `INSERT INTO bill_counters (fy, last_no) VALUES ($1, $2)
       ON CONFLICT (fy) DO UPDATE SET last_no = GREATEST(bill_counters.last_no, EXCLUDED.last_no)`,
      [fy, top],
    )
    next.bills[fy] = top + 1
  }
  return next
}
