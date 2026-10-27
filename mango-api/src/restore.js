// PLT-10 (24 Oct 2026 audit): after a database restore, order and booking
// numbers must not be handed out again. A restore puts order_seq and
// preorder_seq back to the restore point, so the next order would reuse the
// number of one the restore lost (customer messages, Razorpay receipts
// <number>-r<attempt>, support). ops/bump-sequences.js runs this.
//
// The same goes for every other number a customer or the tax office sees:
// gift orders, subscriptions, help requests, and the bill number counter
// (bill_counters, one row per financial year).

import { financialYear } from './bills.js'
import { todayIST } from './clock.js'

/** The numbering sequences and the table and prefix each one numbers. */
export const SEQUENCES = [
  { seq: 'order_seq', table: 'orders', prefix: 'ORD-' },
  { seq: 'preorder_seq', table: 'preorders', prefix: 'PRE-' },
  { seq: 'gift_order_seq', table: 'gift_orders', prefix: 'GFT-' },
  { seq: 'subscription_seq', table: 'subscriptions', prefix: 'SUB-' },
  { seq: 'help_ticket_seq', table: 'help_tickets', prefix: 'HLP-' },
]

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
    await c.query('SELECT setval($1::regclass, $2::bigint, true)', [seq, top])
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
