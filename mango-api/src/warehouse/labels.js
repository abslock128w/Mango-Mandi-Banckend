// Label PDFs at true physical size (docs/warehouse/HARDWARE.md).
//
// The PDF is written directly: QR modules are vector squares, text uses the
// PDF's built-in Helvetica (every reader has it, so no font file is needed).
// QR codes use error correction level Q, a 4-module quiet zone, and modules
// of at least 0.4 mm. Print at 100% / "actual size": fit-to-page scaling
// breaks the label dimensions.
import QRCode from 'qrcode'
import { formatBoxCode, payloadFor } from './codes.js'

const PT_PER_MM = 72 / 25.4
const mm = (v) => v * PT_PER_MM
export const QUIET_MODULES = 4
export const MIN_MODULE_MM = 0.4

/** The label size (mm). 50 × 25 is the default stock; set WAREHOUSE_LABEL_MM=WxH to change it. */
export function labelSize(spec = process.env.WAREHOUSE_LABEL_MM) {
  const m = /^(\d{2,3})x(\d{2,3})$/.exec(spec ?? '')
  const w = m ? Number(m[1]) : 50
  const h = m ? Number(m[2]) : 25
  return { w: Math.min(Math.max(w, 30), 150), h: Math.min(Math.max(h, 15), 100) }
}

/** The QR matrix for a payload: { size, dark(row, col) }. */
export function qrMatrix(text) {
  const q = QRCode.create(text, { errorCorrectionLevel: 'Q' })
  const { size, data } = q.modules
  return { size, version: q.version, dark: (r, c) => Boolean(data[r * size + c]) }
}

// PDF strings: Latin-1 printable only, with ( ) \ escaped.
const pdfText = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/([()\\])/g, '\\$1')

const fit = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}.` : s)

/**
 * Draws one label with its lower-left corner at (x, y) in points. `label`:
 * { kind: 'box' | 'location', token, title, lines: [...], big }.
 */
function drawLabel(ops, label, x, y, size) {
  const { w, h } = size
  const qr = qrMatrix(payloadFor(label.kind, label.token))
  const total = qr.size + 2 * QUIET_MODULES
  const qrMm = h - 2 // the QR, quiet zone included, fills the label's height less 1 mm each side
  const module = qrMm / total
  if (module < MIN_MODULE_MM) throw new Error(`QR modules would be ${module.toFixed(2)} mm; labels need at least ${MIN_MODULE_MM} mm`)
  const ox = x + mm(1)
  const oy = y + mm(1)
  ops.push('0 g')
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (!qr.dark(r, c)) continue
      const px = ox + mm((c + QUIET_MODULES) * module)
      const py = oy + mm((total - QUIET_MODULES - r - 1) * module)
      ops.push(`${px.toFixed(3)} ${py.toFixed(3)} ${mm(module).toFixed(3)} ${mm(module).toFixed(3)} re`)
    }
  }
  ops.push('f')
  // Text to the right of the QR.
  const tx = ox + mm(qrMm + 1)
  const room = w - qrMm - 3 // mm left for text
  const chars = Math.floor(room / 1.55)
  let ty = y + mm(h) - mm(4.6)
  ops.push(`BT /F2 ${label.bigSize ?? 10.5} Tf ${tx.toFixed(2)} ${ty.toFixed(2)} Td (${pdfText(fit(label.big, chars))}) Tj ET`)
  ty -= mm(4)
  for (const line of label.lines.slice(0, 4)) {
    ops.push(`BT /F1 6.5 Tf ${tx.toFixed(2)} ${ty.toFixed(2)} Td (${pdfText(fit(line, Math.floor(room / 1.1)))}) Tj ET`)
    ty -= mm(3.3)
  }
}

/** A PDF document of pages, each a list of content operators, at `pageW` × `pageH` points. */
function pdfDocument(pages, pageW, pageH) {
  const objects = []
  const add = (body) => {
    objects.push(body)
    return objects.length
  }
  const catalog = add(null)
  const pagesObj = add(null)
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const kids = []
  for (const ops of pages) {
    const stream = ops.join('\n')
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`)
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${pageW.toFixed(3)} ${pageH.toFixed(3)}] ` +
          `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    )
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R /ViewerPreferences << /PrintScaling /None >> >>`
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/**
 * Labels as a PDF. layout 'roll': one label per page at the label's size
 * (thermal and roll printers). 'a4': as many labels as fit on A4 sheets, with
 * 1 mm gaps, for sheet label stock.
 */
export function labelsPdf(labels, { layout = 'roll', size = labelSize() } = {}) {
  if (layout === 'roll') {
    return pdfDocument(
      labels.map((l) => {
        const ops = []
        drawLabel(ops, l, 0, 0, size)
        return ops
      }),
      mm(size.w),
      mm(size.h),
    )
  }
  const A4 = { w: 210, h: 297 }
  const margin = 8
  const gap = 1
  const cols = Math.max(1, Math.floor((A4.w - 2 * margin + gap) / (size.w + gap)))
  const rows = Math.max(1, Math.floor((A4.h - 2 * margin + gap) / (size.h + gap)))
  const pages = []
  for (let i = 0; i < labels.length; i += cols * rows) {
    const ops = []
    labels.slice(i, i + cols * rows).forEach((l, j) => {
      const col = j % cols
      const row = Math.floor(j / cols)
      drawLabel(ops, l, mm(margin + col * (size.w + gap)), mm(A4.h - margin - (row + 1) * size.h - row * gap), size)
    })
    pages.push(ops)
  }
  return pdfDocument(pages, mm(A4.w), mm(A4.h))
}

const ist = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' }) : '')

/** The label for a box row (with the lot code). Never a price, a customer or an internal id. */
export function boxLabel(box, lotCode) {
  return {
    kind: 'box',
    token: box.label_token,
    big: formatBoxCode(box.code),
    lines: [
      box.sku_name,
      `Batch ${lotCode}`,
      `${(box.nominal_weight_g / 1000).toFixed(box.nominal_weight_g % 1000 ? 1 : 0)} kg, in ${ist(box.received_on ?? box.created_at?.toISOString?.().slice(0, 10))}`,
      `Best by ${ist(box.best_before)}`,
    ],
  }
}

export function locationLabel(loc) {
  return { kind: 'location', token: loc.label_token, big: loc.name, bigSize: 9.5, lines: [loc.zone ? `Zone ${loc.zone}` : '', `Location: ${loc.type.replace('_', ' ')}`] }
}
