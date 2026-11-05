// Order numbers: 10 digits since migration 056 (shown as #7434060801), ORD-1024 before.
// A new number is the order sequence multiplied by FACTOR modulo 9e9, plus 1e9: unique and gapless
// underneath, always 10 digits, and it doesn't count orders out loud. INVERSE undoes it, so the
// sequence value (the order the orders were placed in) is never lost: orderSeqSql sorts by it,
// and restore.js moves the sequence past it.
export const FACTOR = 6174259801n
export const INVERSE = 1129780201n

/** SQL for the 10-digit order number of a sequence value (an SQL expression, e.g. nextval('order_seq')). */
export const orderNumberSql = (seq) => `(1000000000 + (${seq}::numeric * ${FACTOR}) % 9000000000)::bigint::text`

/** SQL for the sequence value of an order number column, old (ORD-1024) or new: sort by this, not the number. */
export const orderSeqSql = (col) =>
  `(CASE WHEN ${col} ~ '^[1-9][0-9]{9}$' THEN ((${col}::numeric - 1000000000) * ${INVERSE}) % 9000000000 ELSE NULLIF(regexp_replace(${col}, '[^0-9]', '', 'g'), '')::numeric END)`
