// The recipients CSV for a gift order to many (MULTI_GIFT): read in the
// browser, so the buyer sees every row's problems before anything is sent.
// The API checks every recipient again (mango-api/src/gift-routes.js), so this
// is a convenience, never the rule. The columns are the template's, which the
// API serves (GET /v1/gifts/template.csv); a cell the template made safe for
// spreadsheets ('=...) is read back without its leading apostrophe.
import type { GiftRecipientInput, RecipientProblem, Stage } from './api'

export const CSV_COLUMNS = ['name', 'phone', 'address', 'pincode', 'box', 'ripeness', 'boxes', 'note'] as const

/** RFC 4180 rows: quoted cells with "" for a quote, commas and line breaks inside quotes, CRLF or LF, a BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
      continue
    }
    if (ch === '"' && cell === '') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** A cell as typed: the apostrophe the template puts before = + - @ (so a spreadsheet never runs it) comes off. */
const unguard = (c: string) => c.replace(/^'(?=[=+\-@\t\r])/, '').trim()

const STAGE_WORDS: Record<string, Stage> = { raw: 'RAW', 'semi-ripe': 'SEMI_RIPE', semi_ripe: 'SEMI_RIPE', 'semi ripe': 'SEMI_RIPE', semiripe: 'SEMI_RIPE', ripe: 'RIPE' }

/**
 * The recipients in a CSV, and every problem by row (row 1 = the first
 * recipient, under the header). `boxes` are the boxes on sale, matched by code
 * (ALP-3) or by name (Alphonso 3kg Box), ignoring case.
 */
export function recipientsFromCsv(
  text: string,
  boxes: { sku: string; name: string }[],
  maxRecipients: number,
): { recipients: GiftRecipientInput[]; problems: RecipientProblem[] } {
  const rows = parseCsv(text)
  const problems: RecipientProblem[] = []
  if (!rows.length) return { recipients: [], problems: [{ row: 0, field: 'file', message: 'The file is empty.' }] }
  const head = rows[0].map((h) => unguard(h).toLowerCase())
  const at = Object.fromEntries(CSV_COLUMNS.map((c) => [c, head.indexOf(c)])) as Record<(typeof CSV_COLUMNS)[number], number>
  const missing = CSV_COLUMNS.filter((c) => c !== 'note' && at[c] < 0)
  if (missing.length) {
    return { recipients: [], problems: [{ row: 0, field: 'file', message: `The first row must name the columns. Missing: ${missing.join(', ')}. Start from the template.` }] }
  }
  const body = rows.slice(1)
  if (body.length > maxRecipients) problems.push({ row: 0, field: 'file', message: `A gift order can have up to ${maxRecipients} recipients; this file has ${body.length}.` })
  const recipients: GiftRecipientInput[] = []
  body.slice(0, maxRecipients).forEach((cells, i) => {
    const row = i + 1
    const get = (c: (typeof CSV_COLUMNS)[number]) => (at[c] >= 0 ? unguard(cells[at[c]] ?? '') : '')
    const boxText = get('box').toLowerCase()
    const box = boxes.find((b) => b.sku.toLowerCase() === boxText || b.name.toLowerCase() === boxText)
    const stage = STAGE_WORDS[get('ripeness').toLowerCase()] ?? (['RAW', 'SEMI_RIPE', 'RIPE'].includes(get('ripeness').toUpperCase()) ? (get('ripeness').toUpperCase() as Stage) : null)
    const qty = Number(get('boxes'))
    const r: GiftRecipientInput = {
      name: get('name'), phone: get('phone'), address: get('address'), pincode: get('pincode'),
      sku: box?.sku ?? get('box'), stage: stage ?? 'RIPE', qty: Number.isInteger(qty) ? qty : 0, note: get('note') || null,
    }
    for (const p of recipientProblems(r)) problems.push({ row, ...p })
    if (!box) problems.push({ row, field: 'sku', message: get('box') ? `"${get('box')}" is not a box we sell` : 'Choose a box' })
    if (!stage) problems.push({ row, field: 'stage', message: 'Ripeness must be raw, semi-ripe or ripe' })
    recipients.push(r)
  })
  return { recipients, problems }
}

/** The quick checks the shop makes on one recipient before the API checks everything again. */
export function recipientProblems(r: GiftRecipientInput): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = []
  if (!r.name.trim()) out.push({ field: 'name', message: "Enter the recipient's name" })
  if (!/^(\+?91|0)?[6-9]\d{9}$/.test(r.phone.replace(/[\s-]/g, ''))) out.push({ field: 'phone', message: 'Enter a 10-digit Indian mobile number' })
  if (r.address.trim().length < 10) out.push({ field: 'address', message: 'Enter the full delivery address' })
  if (!/^\d{6}$/.test(r.pincode.trim())) out.push({ field: 'pincode', message: 'The pincode must be 6 digits' })
  if (!Number.isInteger(r.qty) || r.qty < 1) out.push({ field: 'qty', message: 'At least 1 box' })
  if ((r.note ?? '').length > 200) out.push({ field: 'note', message: 'The note can be up to 200 characters' })
  return out
}
