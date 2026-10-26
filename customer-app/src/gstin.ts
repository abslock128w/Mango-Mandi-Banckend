// A GSTIN typed at checkout, checked before it is sent (the API checks it
// again, the same way: mango-api/src/gstin.js). 15 characters: the 2-digit
// state code, the 10-character PAN, the entity number, 'Z' (for normal
// registrations) and a check character: the base-36 Luhn check over the first 14.

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]$/
/** GST state and union territory codes in use (the first two digits). */
const STATE_CODES = new Set([...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, '0')), '97', '99'])

/** Upper case, no spaces: the form a GSTIN is stored and printed in. */
export const tidyGstin = (s: string) => s.replace(/\s+/g, '').toUpperCase()

/** The check character for the first 14 characters. */
export function gstinCheckChar(first14: string): string {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i])
    if (v < 0) return '?'
    const p = v * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(p / 36) + (p % 36)
  }
  return CHARS[(36 - (sum % 36)) % 36]
}

/** What is wrong with a typed GSTIN, in words for the customer, or null when it is fine. */
export function gstinProblem(raw: string): string | null {
  const g = tidyGstin(raw)
  if (!g) return 'Enter the GSTIN from the GST certificate.'
  if (g.length !== 15) return `A GSTIN has 15 characters; this has ${g.length}.`
  if (!SHAPE.test(g) || !STATE_CODES.has(g.slice(0, 2))) return 'That is not a GSTIN. It starts with a 2-digit state code, then the 10-character PAN.'
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return 'That GSTIN has a typo: check it against the GST certificate.'
  return null
}
