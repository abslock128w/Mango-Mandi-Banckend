// GSTIN checks and the GST state codes.
//
// A GSTIN is 15 characters: the 2-digit state code, the holder's 10-character
// PAN, the entity number (1-9, then A-Z), a 14th character ('Z' for normal
// registrations) and a check character (GST Council flyer "Registration under
// GST Law"). The check character is the base-36 Luhn ("mod 36") check over the
// first 14 characters, the scheme the GST portal uses.

/** GST state and union territory codes (the first two digits of a GSTIN), as printed on bills. */
export const GST_STATES = Object.freeze({
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  10: 'Bihar',
  11: 'Sikkim',
  12: 'Arunachal Pradesh',
  13: 'Nagaland',
  14: 'Manipur',
  15: 'Mizoram',
  16: 'Tripura',
  17: 'Meghalaya',
  18: 'Assam',
  19: 'West Bengal',
  20: 'Jharkhand',
  21: 'Odisha',
  22: 'Chhattisgarh',
  23: 'Madhya Pradesh',
  24: 'Gujarat',
  25: 'Daman and Diu',
  26: 'Dadra and Nagar Haveli and Daman and Diu',
  27: 'Maharashtra',
  28: 'Andhra Pradesh (before 2014)',
  29: 'Karnataka',
  30: 'Goa',
  31: 'Lakshadweep',
  32: 'Kerala',
  33: 'Tamil Nadu',
  34: 'Puducherry',
  35: 'Andaman and Nicobar Islands',
  36: 'Telangana',
  37: 'Andhra Pradesh',
  38: 'Ladakh',
  97: 'Other Territory',
  99: 'Centre Jurisdiction',
})

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]$/

/** The check character for the first 14 characters of a GSTIN. */
export function gstinCheckChar(first14) {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i])
    if (v < 0) throw new Error('not a GSTIN character')
    const p = v * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(p / 36) + (p % 36)
  }
  return CHARS[(36 - (sum % 36)) % 36]
}

/** Upper-cases and strips spaces; the form a GSTIN is stored and printed in. */
export const normaliseGstin = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase()

/**
 * Why a GSTIN is not valid, or null when it is: the shape, a known state
 * code, and the check character.
 */
export function gstinProblem(raw) {
  const g = normaliseGstin(raw)
  if (g.length !== 15) return 'A GSTIN has 15 characters'
  if (!SHAPE.test(g)) return 'That is not a GSTIN: 2-digit state code, 10-character PAN, then 3 characters'
  if (!GST_STATES[g.slice(0, 2)]) return `${g.slice(0, 2)} is not a GST state code`
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return 'That GSTIN has a typo: its last character does not match (check it against the GST certificate)'
  return null
}

export const stateName = (code) => GST_STATES[code] ?? null
