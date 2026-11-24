// Order numbers on the panel: the one formatter and the one normaliser (as mango-api src/order-number.js).
// Stored: S743406080 (a letter and 9 digits: S shop order, P pre-order, G gift, B bulk order), 7434060801
// (10 digits, before), ORD-1024 / PRE-1035 / PGR-1001 / GFT-12 / BLK-0007 (older still).

const LETTERED = /^[SPGB]\d{9}$/
const TEN_DIGIT = /^[1-9]\d{9}$/

/** S743406080 is S-743 406 080 (the letter set apart: S looks like 5 and B like 8); 7434060801 is #7434060801; anything else as it is. */
export function formatOrderNumber(n: string | null | undefined): string {
  const s = String(n ?? '')
  if (LETTERED.test(s)) return `${s[0]}-${s.slice(1, 4)} ${s.slice(4, 7)} ${s.slice(7)}`
  return TEN_DIGIT.test(s) ? `#${s}` : s
}

/**
 * A number as typed or as shown, as stored: "s-743 406 080", "#S743406080" and "S-743 406 080" are all
 * S743406080; "#7434060801" is 7434060801; "pre 1035" is PRE-1035. Anything else comes back trimmed.
 */
export function normaliseOrderNumber(input: string): string {
  // Copied from the shop: its word joiner goes, a no-break or typographic hyphen is a hyphen (\s covers no-break spaces).
  const t = input.replace(/[\u200b\u2060]/g, '').replace(/[\u2010\u2011\u2013]/g, '-').trim()
  const s = t.replace(/^#\s*/, '')
  if (/^[SPGB][\s-]*\d[\d\s-]*$/i.test(s)) return s[0].toUpperCase() + s.slice(1).replace(/[\s-]/g, '')
  if (/^\d[\d\s]*$/.test(s)) return s.replace(/\s/g, '')
  const old = /^(ORD|PRE|PGR|GFT|BLK|HLP|SUB)[\s-]*(\d+)$/i.exec(s)
  if (old) return `${old[1].toUpperCase()}-${old[2]}`
  return t
}

/** Whether two numbers, typed or shown any way, are the same number. */
export const sameOrderNumber = (a: string, b: string) => normaliseOrderNumber(a).toUpperCase() === normaliseOrderNumber(b).toUpperCase()
