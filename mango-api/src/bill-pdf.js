// A bill as an A4 PDF, written by hand like the warehouse labels
// (warehouse/labels.js): the PDF's built-in Helvetica, no font files and no
// dependency. Built-in fonts only print Latin text, so amounts say "Rs." (no
// rupee sign) and letters outside Latin are left out, with a note saying so.
// Drawn from the bill's snapshot, so a bill reads the same every time it is
// downloaded; only the CANCELLED stamp is added once the order is cancelled.
import { BILL_CANCELLED_BY, BILL_TITLES } from './bills.js'

/** The only cancel wordings a bill prints (fixed, customer-safe; a typed staff reason never reaches a bill). */
const CANCEL_WORDING = new Set(Object.values(BILL_CANCELLED_BY))

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 40
const RIGHT = PAGE_W - MARGIN

// Glyph widths (1/1000 em) for ASCII 32..126: Helvetica, and Helvetica-Bold where it differs.
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278,
  584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,
  667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333,
  584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,
  667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556,
  333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]

/** Text a built-in font can print: accents dropped, typographic marks made plain, anything else left out. */
export function printable(s) {
  return String(s ?? '')
    .replace(/₹\s?/g, 'Rs. ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/ {2,}/g, ' ')
}

/** True when printing would leave letters out (a name in Devanagari, say). */
export const losesText = (s) => /[^\x20-\x7e]/.test(String(s ?? '').normalize('NFKD').replace(/[̀-ͯ₹‘’“”–—…   ]/g, ''))

const esc = (s) => printable(s).replace(/([()\\])/g, '\\$1')

export function textWidth(s, size, bold = false) {
  const table = bold ? BOLD : REGULAR
  let w = 0
  for (const ch of printable(s)) w += table[ch.charCodeAt(0) - 32] ?? 556
  return (w * size) / 1000
}

/** Breaks text into lines no wider than `max` points (a long word is cut). */
export function wrap(s, size, max, bold = false) {
  const out = []
  for (const para of printable(s).split(/\n/)) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (textWidth(next, size, bold) <= max) {
        line = next
        continue
      }
      if (line) out.push(line)
      let rest = word
      while (textWidth(rest, size, bold) > max) {
        let cut = rest.length - 1
        while (cut > 1 && textWidth(rest.slice(0, cut), size, bold) > max) cut--
        out.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      line = rest
    }
    out.push(line)
  }
  return out
}

/** Paise as "Rs. 1,23,456.00" (Indian grouping). */
export function rupees(paise, { sign = false } = {}) {
  const neg = paise < 0
  const abs = Math.abs(Math.round(paise))
  const whole = String(Math.floor(abs / 100))
  const last3 = whole.slice(-3)
  const head = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')
  const grouped = head ? `${head},${last3}` : last3
  return `${neg ? '-' : sign ? '+' : ''}Rs. ${grouped}.${String(abs % 100).padStart(2, '0')}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** '2026-10-26' (or an instant, read in IST) → '26 Oct 2026'. */
export function dayLabel(v) {
  if (!v) return ''
  const d = v instanceof Date || /T/.test(String(v)) ? new Date(new Date(v).getTime() + 330 * 60_000).toISOString().slice(0, 10) : String(v).slice(0, 10)
  return `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`
}

/** A page being drawn: content operators, and the cursor (y, from the bottom). */
class Page {
  constructor() {
    this.ops = []
    this.y = PAGE_H - MARGIN
  }
  text(x, y, s, { size = 9.5, bold = false, align = 'left', gray = 0 } = {}) {
    const w = align === 'left' ? 0 : textWidth(s, size, bold)
    const at = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x
    this.ops.push(`BT ${gray ? `${gray} g ` : ''}/${bold ? 'F2' : 'F1'} ${size} Tf ${at.toFixed(2)} ${y.toFixed(2)} Td (${esc(s)}) Tj ET${gray ? ' 0 g' : ''}`)
  }
  line(x1, y1, x2, y2, { width = 0.5, gray = 0.6 } = {}) {
    this.ops.push(`${gray} G ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S 0 G`)
  }
  fill(x, y, w, h, gray = 0.93) {
    this.ops.push(`${gray} g ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 g`)
  }
  /** A large pale stamp across the page, at 30 degrees, drawn under the content. */
  stamp(s) {
    const c = Math.cos(Math.PI / 6).toFixed(4)
    const sn = Math.sin(Math.PI / 6).toFixed(4)
    const w = textWidth(s, 90, true)
    const x = PAGE_W / 2 - (w / 2) * Math.cos(Math.PI / 6)
    const y = PAGE_H / 2 - (w / 2) * Math.sin(Math.PI / 6)
    this.ops.unshift(`BT 0.97 0.78 0.78 rg /F2 90 Tf ${c} ${sn} -${sn} ${c} ${x.toFixed(2)} ${y.toFixed(2)} Tm (${esc(s)}) Tj ET 0 g`)
  }
}

/** Writes pages of content operators as a PDF file (latin1 bytes), with a title in its properties. */
function pdfFile(pages, title) {
  const objects = []
  const add = (body) => objects.push(body) && objects.length
  const catalog = add(null)
  const pagesObj = add(null)
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const info = add(`<< /Title (${esc(title)}) /Producer (MandiMangoes) /Creator (MandiMangoes) >>`)
  const kids = pages.map((ops) => {
    const stream = ops.join('\n')
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`)
    return add(
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`,
    )
  })
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

// Table columns (x positions in points).
const COL = { n: MARGIN, desc: MARGIN + 22, hsn: 318, qty: 400, rate: 478, amount: RIGHT }
const DESC_W = COL.hsn - COL.desc - 10

/**
 * The bill as a PDF. `bill` is a bills row (snapshot, number, dates, buyer,
 * cancelled_at). Every page carries the bill number and "page x of y".
 */
export function billPdf(bill) {
  const s = bill.snapshot
  const title = s.title ?? BILL_TITLES[bill.kind]
  const pages = []
  let page = new Page()
  pages.push(page)
  const lost = []
  const say = (v, what) => {
    if (losesText(v)) lost.push(what)
    return v
  }

  // Heading: the document's title and the brand.
  page.text(MARGIN, page.y - 14, title.toUpperCase(), { size: 18, bold: true })
  page.text(RIGHT, page.y - 12, 'MandiMangoes', { size: 12, bold: true, align: 'right' })
  page.y -= 34
  if (bill.cancelled_at) {
    const by = CANCEL_WORDING.has(bill.cancel_reason) ? bill.cancel_reason : 'cancelled'
    for (const l of wrap(`CANCELLED on ${dayLabel(bill.cancelled_at)}: the order was ${by}. This bill stays on record with its number.`, 9.5, RIGHT - MARGIN, true)) {
      page.text(MARGIN, page.y, l, { size: 9.5, bold: true })
      page.y -= 13
    }
    page.y -= 4
  }
  page.line(MARGIN, page.y, RIGHT, page.y)
  page.y -= 16

  // Seller (left) and the bill's particulars (right).
  const top = page.y
  const seller = s.seller
  let y = top
  page.text(MARGIN, y, say(seller.legalName, 'seller'), { size: 11, bold: true })
  y -= 14
  for (const a of seller.addressLines ?? []) {
    for (const l of wrap(say(a, 'seller'), 9.5, 250)) {
      page.text(MARGIN, y, l)
      y -= 12
    }
  }
  page.text(MARGIN, y, `State: ${seller.stateName} (code ${seller.stateCode})`)
  y -= 12
  page.text(MARGIN, y, seller.gstin ? `GSTIN: ${seller.gstin}` : 'Not registered under GST', { bold: Boolean(seller.gstin) })
  y -= 12
  if (seller.contact) {
    for (const l of wrap(say(seller.contact, 'seller'), 9.5, 250)) {
      page.text(MARGIN, y, l)
      y -= 12
    }
  }
  const leftBottom = y

  const KX = 330
  const VX = 430
  let ry = top
  const kv = (k, v, bold = false) => {
    page.text(KX, ry, k, { gray: 0.35 })
    page.text(VX, ry, v, { bold })
    ry -= 13
  }
  kv(`${s.kind === 'RECEIPT' ? 'Receipt' : s.kind === 'BILL_OF_SUPPLY' ? 'Bill' : 'Invoice'} no.`, bill.number, true)
  kv('Date', dayLabel(bill.bill_date))
  kv('Order', s.order.number)
  kv('Order placed', dayLabel(s.order.placedAt))
  kv('Place of supply', `${s.placeOfSupply.stateName} (${s.placeOfSupply.stateCode})`)
  page.y = Math.min(leftBottom, ry) - 8
  page.line(MARGIN, page.y, RIGHT, page.y)
  page.y -= 16

  // The buyer.
  page.text(MARGIN, page.y, 'Bill to', { bold: true })
  page.y -= 13
  if (s.buyer.businessName) {
    page.text(MARGIN, page.y, say(s.buyer.businessName, 'buyer'), { bold: true })
    page.y -= 12
  }
  if (s.buyer.gstin) {
    page.text(MARGIN, page.y, `GSTIN: ${s.buyer.gstin}`)
    page.y -= 12
  }
  if (bill.buyer_removed_at) {
    page.text(MARGIN, page.y, "Customer's name and address removed (privacy)", { gray: 0.35 })
    page.y -= 12
  } else {
    if (bill.buyer_name) {
      page.text(MARGIN, page.y, say(bill.buyer_name, 'buyer'))
      page.y -= 12
    }
    if (bill.buyer_address) {
      for (const l of wrap(`Deliver to: ${say(bill.buyer_address, 'buyer')}`, 9.5, RIGHT - MARGIN)) {
        page.text(MARGIN, page.y, l)
        page.y -= 12
      }
    }
  }
  page.y -= 10

  // The lines.
  const taxed = Boolean(s.tax)
  const header = () => {
    page.fill(MARGIN, page.y - 5, RIGHT - MARGIN, 18)
    page.text(COL.n, page.y, '#', { bold: true, size: 9 })
    page.text(COL.desc, page.y, 'Description', { bold: true, size: 9 })
    page.text(COL.hsn, page.y, 'HSN', { bold: true, size: 9 })
    page.text(COL.qty, page.y, 'Qty', { bold: true, size: 9, align: 'right' })
    page.text(COL.rate, page.y, 'Rate', { bold: true, size: 9, align: 'right' })
    page.text(COL.amount, page.y, 'Amount', { bold: true, size: 9, align: 'right' })
    page.y -= 20
  }
  const room = (h) => {
    if (page.y - h >= 90) return false
    page = new Page()
    pages.push(page)
    page.text(MARGIN, page.y - 10, `${title} ${bill.number} (continued)`, { bold: true })
    page.y -= 30
    return true
  }
  header()
  s.lines.forEach((l, i) => {
    const desc = wrap(say(l.description, 'item'), 9, DESC_W)
    if (taxed && l.ratePct) {
      const st = s.tax.stateTaxLabel ?? 'SGST'
      desc.push(...wrap(`Taxable ${rupees(l.taxableValue)}, CGST ${l.ratePct / 2}% ${rupees(l.cgst)}, ${st} ${l.ratePct / 2}% ${rupees(l[st.toLowerCase()])}`, 8, DESC_W))
    } else if (taxed) {
      desc.push('Exempt (no GST)')
    }
    if (room(desc.length * 11 + 6)) header()
    page.text(COL.n, page.y, String(i + 1), { size: 9 })
    desc.forEach((d, j) => page.text(COL.desc, page.y - j * 11, d, { size: j && taxed ? 8 : 9, gray: j && taxed ? 0.35 : 0 }))
    page.text(COL.hsn, page.y, l.hsn ?? '', { size: 9 })
    page.text(COL.qty, page.y, String(l.qty), { size: 9, align: 'right' })
    page.text(COL.rate, page.y, rupees(l.unitPrice), { size: 9, align: 'right' })
    page.text(COL.amount, page.y, rupees(l.amount), { size: 9, align: 'right' })
    page.y -= desc.length * 11 + 4
    page.line(MARGIN, page.y + 4, RIGHT, page.y + 4, { gray: 0.85 })
    page.y -= 6
  })

  // Totals, right-aligned.
  const sums = [['Goods', rupees(s.subtotal)]]
  if (s.discount) sums.push([`Promo ${s.promoCode ?? ''}`.trim(), rupees(-s.discount)])
  if (s.deliveryFee) sums.push(['Delivery charge', rupees(s.deliveryFee)])
  if (taxed) {
    const st = s.tax.stateTaxLabel ?? 'SGST'
    sums.push(['Taxable value', rupees(s.tax.taxableValue)], ['CGST', rupees(s.tax.cgst)], [st, rupees(s.tax[st.toLowerCase()] ?? 0)])
  }
  room(sums.length * 14 + 40)
  page.y -= 4
  for (const [k, v] of sums) {
    page.text(COL.rate - 40, page.y, k, { align: 'right' })
    page.text(COL.amount, page.y, v, { align: 'right' })
    page.y -= 14
  }
  page.line(COL.qty - 60, page.y + 8, RIGHT, page.y + 8)
  page.y -= 4
  page.text(COL.rate - 40, page.y, taxed ? 'Total (GST included)' : 'Total', { bold: true, size: 11, align: 'right' })
  page.text(COL.amount, page.y, rupees(s.total), { bold: true, size: 11, align: 'right' })
  page.y -= 16
  page.text(COL.rate - 40, page.y, 'Paid online', { align: 'right', gray: 0.35 })
  page.text(COL.amount, page.y, rupees(s.paid ?? s.total), { align: 'right', gray: 0.35 })
  page.y -= 24

  // Notes and declarations.
  const notes = [...(s.notes ?? [])]
  if (lost.length) notes.push(`Some letters in the ${[...new Set(lost)].join(' and ')} details could not be printed in this PDF's font; the order page shows them in full.`)
  notes.push('This is a computer-generated document and needs no signature.')
  const noteLines = notes.flatMap((n) => wrap(n, 8.5, RIGHT - MARGIN))
  room(noteLines.length * 11 + 20)
  page.text(MARGIN, page.y, 'Notes', { bold: true, size: 9 })
  page.y -= 12
  for (const l of noteLines) {
    page.text(MARGIN, page.y, l, { size: 8.5 })
    page.y -= 11
  }

  pages.forEach((p, i) => {
    p.line(MARGIN, 52, RIGHT, 52, { gray: 0.85 })
    p.text(MARGIN, 40, `${title} ${bill.number}`, { size: 8, gray: 0.35 })
    p.text(RIGHT, 40, `Page ${i + 1} of ${pages.length}`, { size: 8, gray: 0.35, align: 'right' })
    if (bill.cancelled_at) p.stamp('CANCELLED')
  })
  return pdfFile(pages.map((p) => p.ops), `${title} ${bill.number}`)
}
