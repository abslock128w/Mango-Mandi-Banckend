// Order numbers. Three generations, all still stored and found as they were issued:
//   - ORD-1024 (and PRE-1035, PGR-1001, GFT-12, BLK-0007): before migration 056 / 077;
//   - 7434060801: 10 digits, migration 056 to 077 (shown as #7434060801);
//   - S743406080: since migration 077, a letter and 9 digits (shown as S-743 406 080).
//
// The letter says what was bought, fixed when the record is made and never changed:
//   S  a normal shop order (checkout, WhatsApp, subscription, a replacement)
//   P  a pre-order for yourself (and the delivery order it becomes: it keeps the number)
//   G  anything sent as a gift: a gift order in season, a gift from the bag, a gift
//      pre-order, a gift for several people and each person's order or booking in it
//   B  a bulk order
// S, P and B each have their own sequence. Every G number comes from ONE sequence, whichever
// table it is stored in (orders, gift_orders, preorders, preorder_groups), so a G number never
// names two things.
//
// The 9 digits are the sequence value multiplied by FACTOR9 modulo 1e9, zero-padded: unique
// (FACTOR9 is coprime to 1e9) and they don't count orders out loud. INVERSE9 undoes it, so the
// sequence value is never lost: orderSeqSql sorts by it and restore.js moves each sequence past it.
// The 10-digit numbers use FACTOR and INVERSE the same way (modulo 9e9, plus 1e9).
export const FACTOR = 6174259801n
export const INVERSE = 1129780201n
export const FACTOR9 = 618033989n
export const INVERSE9 = 1536909n
const MOD9 = 1000000000n

/** The letters, and the sequence each one draws from (migration 077). */
export const ORDER_LETTERS = ['S', 'P', 'G', 'B']
export const LETTER_SEQ = { S: 'order_number_s_seq', P: 'order_number_p_seq', G: 'order_number_g_seq', B: 'order_number_b_seq' }

/** A number of the current scheme, as stored: S743406080. */
export const LETTERED = /^[SPGB][0-9]{9}$/
const TEN_DIGIT = /^[1-9][0-9]{9}$/

/** The 9 digits of a sequence value (pure; the SQL below does the same). */
export const scramble9 = (seq) => String((BigInt(seq) * FACTOR9) % MOD9).padStart(9, '0')
/** The sequence value of 9 digits (or of a whole lettered number). */
export const unscramble9 = (digits) => Number((BigInt(String(digits).replace(/^[SPGB]/, '')) * INVERSE9) % MOD9)
/** The lettered number of a sequence value: lettered('S', 1) is S618033989. */
export const lettered = (letter, seq) => `${letter}${scramble9(seq)}`

/** SQL for the 10-digit order number of a sequence value (the previous scheme; kept for the previous release and tests). */
export const orderNumberSql = (seq) => `(1000000000 + (${seq}::numeric * ${FACTOR}) % 9000000000)::bigint::text`

/** SQL for a lettered number of a sequence value (an SQL expression, e.g. nextval('order_number_s_seq')). */
export const letteredNumberSql = (letter, seq) => {
  if (!ORDER_LETTERS.includes(letter)) throw new Error(`unknown order letter ${letter}`)
  return `('${letter}' || lpad(((${seq})::numeric * ${FACTOR9} % 1000000000)::bigint::text, 9, '0'))`
}

/** The next number for a letter, from its sequence (inside the caller's transaction, or not: a sequence never rolls back). */
export async function nextOrderNumber(c, letter) {
  const { rows } = await c.query(`SELECT ${letteredNumberSql(letter, `nextval('${LETTER_SEQ[letter]}')`)} AS n`)
  return rows[0].n
}

/**
 * SQL for the sort key of an order number column: the order the orders were placed in. Old (ORD-1024)
 * first, then the 10-digit ones, then the lettered ones (each letter by its own sequence: two letters
 * placed the same minute are not in a strict order between them; the lists that need that sort by
 * placed_at first).
 */
export const orderSeqSql = (col) =>
  `(CASE WHEN ${col} ~ '^[SPGB][0-9]{9}$' THEN 10000000000 + (substr(${col}, 2)::numeric * ${INVERSE9}) % 1000000000` +
  ` WHEN ${col} ~ '^[1-9][0-9]{9}$' THEN ((${col}::numeric - 1000000000) * ${INVERSE}) % 9000000000` +
  ` ELSE NULLIF(regexp_replace(${col}, '[^0-9]', '', 'g'), '')::numeric END)`

/**
 * An order number as people read it: S743406080 is S-743 406 080 (the letter set apart: S looks like
 * 5 and B like 8). Anything else is returned as it is (7434060801, ORD-1024, PRE-1035, HLP-12).
 * WhatsApp parameters, exports and audit text use this.
 */
export function formatOrderNumber(n) {
  const s = String(n ?? '')
  return LETTERED.test(s) ? `${s[0]}-${s.slice(1, 4)} ${s.slice(4, 7)} ${s.slice(7)}` : s
}

/** As the shop and the bills print it: S-743 406 080, #7434060801 (the 10-digit ones keep their #), ORD-1024. */
export const orderNo = (n) => (TEN_DIGIT.test(String(n ?? '')) ? `#${n}` : formatOrderNumber(n))

/**
 * A number as someone typed it, as stored: "s-743 406 080", "#S743406080" and "S 743406080" are all
 * S743406080; "#7434060801" is 7434060801; "pre-1035" and "PRE 1035" are PRE-1035. A start of a
 * number works too (search boxes match by prefix): "s-743 4" is S7434. Anything that isn't a number
 * (a name, a phone) comes back trimmed and otherwise unchanged.
 */
export function normaliseOrderNumber(input) {
  // Copied from the shop: its word joiner goes, a no-break or typographic hyphen is a hyphen (\s covers no-break spaces).
  const t = String(input ?? '').replace(/[\u200b\u2060]/g, '').replace(/[\u2010\u2011\u2013]/g, '-').trim()
  const s = t.replace(/^#\s*/, '')
  if (/^[SPGB][\s-]*[0-9][0-9\s-]*$/i.test(s)) return s[0].toUpperCase() + s.slice(1).replace(/[\s-]/g, '')
  if (/^[0-9][0-9\s]*$/.test(s)) return s.replace(/\s/g, '')
  const old = /^(ORD|PRE|PGR|GFT|BLK|HLP|SUB)[\s-]*([0-9]+)$/i.exec(s)
  if (old) return `${old[1].toUpperCase()}-${old[2]}`
  return t
}
