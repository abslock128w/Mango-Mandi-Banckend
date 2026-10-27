// Box codes, label tokens and QR payloads (docs/warehouse/IDENTIFIERS.md).
//
// Three identifiers per box: the internal UUID (never printed), the human box
// code (8 Crockford Base32 symbols and a check symbol, shown as XXXX-XXXX-C)
// and the label token (26 symbols, 130 random bits) that the QR encodes as
// MMB1:<token>. The database row is the truth; a label only points at it.
import { randomBytes } from 'node:crypto'

export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const VALUE = new Map([...ALPHABET].map((ch, i) => [ch, i]))

// ---------------------------------------------------------------- the check symbol
// Damm's algorithm over GF(32): x ∘ y = 2·x + y. Total antisymmetry holds
// because 2 ≠ 1, so the check catches every single-symbol mistake and every
// swap of two neighbouring symbols (test/warehouse-codes.test.js proves both
// over every case).
const gfMul2 = (x) => {
  const v = x << 1
  return v & 32 ? (v ^ 0b100101) & 31 : v // x^5 = x^2 + 1
}
const step = (interim, digit) => gfMul2(interim) ^ digit

/** The check symbol for a string of Crockford symbols. */
export function checkSymbol(body) {
  let interim = 0
  for (const ch of body) interim = step(interim, VALUE.get(ch))
  // The digit d with step(interim, d) = 0: d = 2·interim (characteristic 2).
  return ALPHABET[gfMul2(interim)]
}

/** True when the last symbol is the right check symbol for the rest. */
export function checkOk(code) {
  let interim = 0
  for (const ch of code) {
    const v = VALUE.get(ch)
    if (v === undefined) return false
    interim = step(interim, v)
  }
  return interim === 0
}

const randomSymbols = (n) => {
  const bytes = randomBytes(Math.ceil((n * 5) / 8) + 1)
  let bits = 0
  let acc = 0
  let out = ''
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5 && out.length < n) {
      bits -= 5
      out += ALPHABET[(acc >> bits) & 31]
    }
    acc &= (1 << bits) - 1
  }
  return out
}

/** A new human box code: 8 random symbols and the check symbol (stored without hyphens). */
export function newBoxCode() {
  const body = randomSymbols(8)
  return body + checkSymbol(body)
}

/** XXXX-XXXX-C, as printed. */
export const formatBoxCode = (code) => `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`

/** A new label token: 26 symbols, 130 random bits. */
export const newToken = () => randomSymbols(26)

/** Logs and messages show at most the last 4 symbols of a token. */
export const maskToken = (t) => (t ? `…${String(t).slice(-4)}` : null)

// ---------------------------------------------------------------- reading a scan
export const MAX_INPUT = 128
const PREFIX = { MMB1: 'box', MMC1: 'container', MML1: 'location' }

/** Crockford decoding: case-insensitive, O reads as 0 and I or L as 1; spaces and hyphens ignored. */
const crockford = (s) => s.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')

/**
 * What a scanned or typed string is. Returns one of:
 *   { kind: 'box' | 'container' | 'location', token }   from a QR payload (or its future URL form)
 *   { kind: 'box_code', code }                           a typed human box code
 *   { error: 'MALFORMED_CODE' | 'INVALID_CHECK_DIGIT' | 'TOO_LONG' }
 * Control characters and whitespace are stripped first.
 */
export function parseScan(raw) {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f\s]/g, '')
  if (!s) return { error: 'MALFORMED_CODE' }
  if (s.length > MAX_INPUT) return { error: 'TOO_LONG' }
  // A URL form for later labels: https://…/b/<token>, …?t=<token>, or …/MMB1:<token>.
  let payload = s
  if (/^https?:\/\//i.test(s)) {
    let url
    try {
      url = new URL(s)
    } catch {
      return { error: 'MALFORMED_CODE' }
    }
    const t = url.searchParams.get('t')
    const m = /\/(b|c|l)\/([0-9A-Za-z]+)\/?$/.exec(url.pathname)
    const typed = /(MM[BCL]1:[0-9A-Za-z]+)/i.exec(decodeURIComponent(url.pathname + url.search))
    if (typed) payload = typed[1]
    else if (m) payload = `${{ b: 'MMB1', c: 'MMC1', l: 'MML1' }[m[1]]}:${m[2]}`
    else if (t) payload = `MMB1:${t}`
    else return { error: 'MALFORMED_CODE' }
  }
  const typed = /^(MM[BCL]1):(.+)$/i.exec(payload)
  if (typed) {
    const token = crockford(typed[2])
    if (!/^[0-9A-HJKMNP-TV-Z]{26,40}$/.test(token)) return { error: 'MALFORMED_CODE' }
    return { kind: PREFIX[typed[1].toUpperCase()], token }
  }
  // A typed box code: 9 symbols once hyphens and spaces are gone.
  const code = crockford(payload)
  if (/^[0-9A-HJKMNP-TV-Z]{9}$/.test(code)) return checkOk(code) ? { kind: 'box_code', code } : { error: 'INVALID_CHECK_DIGIT' }
  return { error: 'MALFORMED_CODE' }
}

/** The QR payload for a box, container or location token. */
export const payloadFor = (kind, token) => `${{ box: 'MMB1', container: 'MMC1', location: 'MML1' }[kind]}:${token}`
