// Warehouse pure parts: box codes and their check symbol, scan parsing,
// CSV escaping, and label PDFs (rendered with pdftoppm and every QR decoded).
import './setup-env.js'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import jsQR from 'jsqr'
import { ALPHABET, checkOk, checkSymbol, formatBoxCode, maskToken, newBoxCode, newToken, parseScan, payloadFor } from '../src/warehouse/codes.js'
import { boxLabel, labelsPdf, labelSize, locationLabel, MIN_MODULE_MM, qrMatrix, QUIET_MODULES } from '../src/warehouse/labels.js'
import { csv, csvCell } from '../src/warehouse/reports.js'
import { can, managerOnly, OP_PERMISSION, ROLE_PERMISSIONS, WAREHOUSE_ROUTES } from '../src/warehouse/permissions.js'

describe('box codes', () => {
  test('every single-symbol error and every adjacent swap is caught', () => {
    let checked = 0
    for (let n = 0; n < 300; n++) {
      const code = newBoxCode()
      assert.ok(checkOk(code), code)
      for (let i = 0; i < code.length; i++) {
        for (const ch of ALPHABET) {
          if (ch === code[i]) continue
          assert.equal(checkOk(code.slice(0, i) + ch + code.slice(i + 1)), false, `substitution at ${i} in ${code}`)
          checked++
        }
        if (i < code.length - 1 && code[i] !== code[i + 1]) {
          const swapped = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2)
          assert.equal(checkOk(swapped), false, `swap at ${i} in ${code}`)
          checked++
        }
      }
    }
    assert.ok(checked > 80_000)
  })

  test('codes are 9 Crockford symbols, printed XXXX-XXXX-C, and tokens 26 symbols', () => {
    const c = newBoxCode()
    assert.match(c, /^[0-9A-HJKMNP-TV-Z]{9}$/)
    assert.equal(checkSymbol(c.slice(0, 8)), c[8])
    assert.match(formatBoxCode(c), /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]$/)
    assert.match(newToken(), /^[0-9A-HJKMNP-TV-Z]{26}$/)
    assert.equal(maskToken('ABCDEFGHJK'), '…GHJK')
    assert.equal(new Set(Array.from({ length: 2000 }, newToken)).size, 2000)
  })

  test('scan parsing: payloads, URL forms, typed codes and junk', () => {
    const t = newToken()
    assert.deepEqual(parseScan(`MMB1:${t}`), { kind: 'box', token: t })
    assert.deepEqual(parseScan(`mml1:${t.toLowerCase()}`), { kind: 'location', token: t })
    assert.deepEqual(parseScan(`MMC1:${t}\r\n`), { kind: 'container', token: t })
    assert.deepEqual(parseScan(`https://mandimangoes.example/b/${t}`), { kind: 'box', token: t })
    assert.deepEqual(parseScan(`https://x.example/scan?t=${t}`), { kind: 'box', token: t })
    const code = newBoxCode()
    assert.deepEqual(parseScan(formatBoxCode(code).toLowerCase()), { kind: 'box_code', code })
    // O reads as 0 and I/L as 1, as Crockford intends.
    const withZero = newBoxCode()
    if (withZero.includes('0')) assert.deepEqual(parseScan(withZero.replace(/0/g, 'O')), { kind: 'box_code', code: withZero })
    const bad = code.slice(0, 8) + ALPHABET[(ALPHABET.indexOf(code[8]) + 1) % 32]
    assert.deepEqual(parseScan(bad), { error: 'INVALID_CHECK_DIGIT' })
    assert.deepEqual(parseScan(''), { error: 'MALFORMED_CODE' })
    assert.deepEqual(parseScan('hello world'), { error: 'MALFORMED_CODE' })
    assert.deepEqual(parseScan('MMB1:short'), { error: 'MALFORMED_CODE' })
    assert.deepEqual(parseScan('X'.repeat(200)), { error: 'TOO_LONG' })
    assert.deepEqual(parseScan('javascript:alert(1)'), { error: 'MALFORMED_CODE' })
  })
})

describe('permissions', () => {
  test('roles hold the agreed bundles; approvals, recalls, overrides and locations are manager-only', () => {
    for (const p of ['qc.override', 'adjust.approve', 'recall.manage', 'recall.view_customers', 'locations.manage']) assert.ok(managerOnly(p), p)
    assert.deepEqual(ROLE_PERMISSIONS.RIDER, [])
    assert.ok(can('PACKER', 'warehouse.pick') && !can('PACKER', 'warehouse.receive'))
    assert.ok(can('QC', 'warehouse.qc') && !can('QC', 'warehouse.pick'))
    assert.ok(!can('OPERATOR', 'adjust.approve'))
    for (const [, , perm] of WAREHOUSE_ROUTES) assert.ok(ROLE_PERMISSIONS.MANAGER.includes(perm), perm)
    for (const perm of Object.values(OP_PERMISSION)) assert.ok(ROLE_PERMISSIONS.MANAGER.includes(perm))
  })
})

describe('CSV exports', () => {
  test('cells are quoted and formula-looking values are made inert', () => {
    assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`)
    assert.equal(csvCell('+1'), `"'+1"`)
    assert.equal(csvCell('-2'), `"'-2"`)
    assert.equal(csvCell('@SUM(A1)'), `"'@SUM(A1)"`)
    assert.equal(csvCell('\tx'), `"'\tx"`)
    assert.equal(csvCell('plain, text'), '"plain, text"')
    assert.equal(csvCell(null), '')
    assert.equal(csv(['a', 'b'], [[1, '=x']]), '"a","b"\r\n"1","\'=x"\r\n')
  })
})

describe('label PDFs', () => {
  const box = (i) => ({ label_token: newToken(), code: newBoxCode(), sku_name: 'Alphonso 3kg Box', nominal_weight_g: 3000, received_on: '2026-10-15', best_before: '2026-10-22', seq: i })

  test('QR modules are at least 0.4 mm with a 4-module quiet zone at 50 × 25 mm', () => {
    const size = labelSize()
    assert.deepEqual(size, { w: 50, h: 25 })
    const qr = qrMatrix(payloadFor('box', newToken()))
    const module = (size.h - 2) / (qr.size + 2 * QUIET_MODULES)
    assert.ok(module >= MIN_MODULE_MM, `module ${module} mm`)
    assert.deepEqual(labelSize('100x50'), { w: 100, h: 50 })
    assert.deepEqual(labelSize('nonsense'), { w: 50, h: 25 })
  })

  test('every label renders at true size and every QR decodes to its payload (roll and A4)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wh-labels-'))
    try {
      const boxes = Array.from({ length: 6 }, (_, i) => box(i + 1))
      const labels = [...boxes.map((b) => boxLabel(b, 'L2610-ALP3-7K')), locationLabel({ label_token: newToken(), name: 'Storage A', zone: 'A', type: 'storage' })]
      const want = labels.map((l) => payloadFor(l.kind, l.token))
      for (const layout of ['roll', 'a4']) {
        const file = join(dir, `${layout}.pdf`)
        const bytes = labelsPdf(labels, { layout })
        writeFileSync(file, bytes)
        assert.match(bytes.subarray(0, 8).toString('latin1'), /^%PDF-1\.4/)
        assert.match(bytes.toString('latin1'), /\/PrintScaling \/None/)
        const info = execFileSync('pdfinfo', [file]).toString()
        if (layout === 'roll') {
          assert.match(info, /Pages:\s+7/)
          assert.match(info, /Page size:\s+141\.73\d* x 70\.86\d* pts/)
        } else {
          assert.match(info, /Pages:\s+1/)
          assert.match(info, /Page size:\s+595\.2\d* x 841\.8\d* pts \(A4\)/)
        }
        execFileSync('pdftoppm', ['-r', '300', '-gray', file, join(dir, layout)])
        const found = []
        for (const f of readdirSync(dir).filter((n) => n.startsWith(`${layout}-`) && n.endsWith('.pgm')).sort()) {
          const img = readPgm(readFileSync(join(dir, f)))
          if (layout === 'roll') {
            found.push(jsQR(img.rgba, img.width, img.height)?.data)
          } else {
            // A4 sheet: crop each label cell and decode it on its own.
            const px = 300 / 25.4
            const cols = Math.floor((210 - 16 + 1) / 51)
            for (let j = 0; j < labels.length; j++) {
              const x = Math.round((8 + (j % cols) * 51) * px)
              const y = Math.round((8 + Math.floor(j / cols) * 26) * px)
              const crop = cropRgba(img, x, y, Math.round(50 * px), Math.round(25 * px))
              found.push(jsQR(crop.rgba, crop.width, crop.height)?.data)
            }
          }
        }
        assert.deepEqual(found, want, layout)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('labels carry no price, customer or internal id', () => {
    const l = boxLabel(box(1), 'L2610-ALP3-7K')
    const text = [l.big, ...l.lines].join(' ')
    assert.doesNotMatch(text, /₹|Rs|price|order|phone|ord_|bl_|bat_/i)
    assert.match(text, /Alphonso 3kg Box/)
    assert.match(text, /Batch L2610-ALP3-7K/)
    assert.match(text, /Best by 22 Oct 26/)
  })
})

/** A binary PGM (P5) as RGBA for jsQR. */
function readPgm(buf) {
  let pos = 0
  const token = () => {
    while (/\s/.test(String.fromCharCode(buf[pos]))) pos++
    if (buf[pos] === 0x23) {
      while (buf[pos] !== 0x0a) pos++
      return token()
    }
    let s = ''
    while (!/\s/.test(String.fromCharCode(buf[pos]))) s += String.fromCharCode(buf[pos++])
    return s
  }
  assert.equal(token(), 'P5')
  const width = Number(token())
  const height = Number(token())
  token()
  pos++
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const v = buf[pos + i]
    rgba[i * 4] = v
    rgba[i * 4 + 1] = v
    rgba[i * 4 + 2] = v
    rgba[i * 4 + 3] = 255
  }
  return { width, height, rgba }
}

function cropRgba(img, x, y, w, h) {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let r = 0; r < h; r++) {
    const src = ((y + r) * img.width + x) * 4
    out.set(img.rgba.subarray(src, src + w * 4), r * w * 4)
  }
  return { width: w, height: h, rgba: out }
}
