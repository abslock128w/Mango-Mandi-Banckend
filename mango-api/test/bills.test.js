// Bills (docs/trust.md): one numbered bill per paid order, a gapless number
// per financial year taken under a row lock, a snapshot that later edits
// never change, the document's title from the seller settings, business
// details checked at checkout, the PDF for the owner and for managers and
// operators (audited), and a cancelled order's bill kept and marked.
// Every PDF is read back with pdftotext (poppler-utils, installed in CI).
import { adminToken, client, closeAll, customerToken, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { billable, billNumber, composeBill, financialYear, issueBill, issueMissingBills, removeBillBuyers } from '../src/bills.js'
import { billPdf, printable, rupees } from '../src/bill-pdf.js'
import { setNow } from '../src/clock.js'
import { query, tx } from '../src/db.js'
import { gstinCheckChar, gstinProblem } from '../src/gstin.js'
import { newId } from '../src/ids.js'
import { checkTrustProduction, readTrustConfig, setTrustConfig, trust } from '../src/trust-config.js'

let srv
let api
let manager
before(async () => {
  srv = await startServer()
  api = client(srv.base)
})
after(async () => {
  setTrustConfig({})
  await srv.close()
  await closeAll()
})
beforeEach(async () => {
  setTrustConfig({})
  await resetDb()
  manager = await adminToken(api)
})
afterEach(() => setTrustConfig({}))

const BOX = 189_900
const ADDRESS = '12, 4th Cross, Koramangala, Bengaluru'
// A seller registered in Karnataka (state 29), with a valid check character.
const SELLER_GSTIN = `29AAACM1234A1Z${gstinCheckChar('29AAACM1234A1Z')}`
const BUYER_GSTIN = `29AABCT1332L1Z${gstinCheckChar('29AABCT1332L1Z')}`
const REGISTERED = {
  BILL_SELLER_LEGAL_NAME: 'Mandi Fresh Fruits LLP',
  BILL_SELLER_ADDRESS: '14 Mandi Road, Koramangala|Bengaluru 560034',
  BILL_SELLER_STATE_CODE: '29',
  BILL_SELLER_GSTIN: SELLER_GSTIN,
}
const UNREGISTERED = { ...REGISTERED, BILL_SELLER_GSTIN: '' }

/** The text of a PDF, as poppler reads it (proves the file parses). */
const pdfText = (bytes) => execFileSync('pdftotext', ['-layout', '-', '-'], { input: bytes }).toString('utf8')

/** GET returning the raw bytes (the JSON client reads text). */
async function download(path, token) {
  const res = await fetch(`${srv.base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const body = Buffer.from(await res.arrayBuffer())
  return { status: res.status, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition'), body }
}

async function placed(qty = 1, extra = {}) {
  const cust = extra.cust ?? (await customerToken(api))
  for (const it of [{ sku: 'ALP-3', stage: 'RIPE', qty }]) assert.equal((await api.post('/v1/cart/items', it, { token: cust.accessToken })).status, 204)
  const q = await api.post('/v1/checkout/quote', { pincode: '560034', promoCode: extra.promoCode }, { token: cust.accessToken })
  assert.equal(q.status, 200, JSON.stringify(q.body))
  const o = await api.post(
    '/v1/checkout/confirm',
    { quoteId: q.body.quoteId, address: ADDRESS, name: extra.name ?? 'Ravi Kumar', ...(extra.business ? { business: extra.business } : {}) },
    { token: cust.accessToken, headers: { 'Idempotency-Key': newId('k') } },
  )
  return { cust, o, quote: q }
}
const pay = (orderId) => api.post('/v1/dev/pay', { orderId, outcome: 'captured' })
async function paidOrder(qty = 1, extra = {}) {
  const { cust, o } = await placed(qty, extra)
  assert.equal(o.status, 201, JSON.stringify(o.body))
  assert.equal((await pay(o.body.orderId)).body.result, 'confirmed')
  return { cust, orderId: o.body.orderId }
}
const billRow = async (orderId) => (await query('SELECT * FROM bills WHERE order_id = $1', [orderId])).rows[0]

describe('GSTIN and numbering rules', () => {
  test('GSTIN shape, state code and check character', () => {
    // A GSTIN published as a worked example of the check character.
    assert.equal(gstinProblem('27AAPFU0939F1ZV'), null)
    assert.equal(gstinProblem(' 27aapfu0939f1zv '), null, 'spaces and lower case are tidied first')
    assert.match(gstinProblem('27AAPFU0939F1ZW'), /typo/)
    assert.match(gstinProblem('27AAPFU0939F1Z'), /15 characters/)
    assert.match(gstinProblem('2AAAPFU0939F1ZV'), /not a GSTIN/)
    assert.match(gstinProblem(`00AAPFU0939F1Z${gstinCheckChar('00AAPFU0939F1Z')}`), /not a GST state code/)
    assert.equal(gstinProblem(SELLER_GSTIN), null)
  })

  test('financial years run April to March, and numbers fit in 16 characters', () => {
    assert.equal(financialYear('2026-03-31'), '2025-26')
    assert.equal(financialYear('2026-04-01'), '2026-27')
    assert.equal(financialYear('2027-01-15'), '2026-27')
    assert.equal(financialYear('2099-12-31'), '2099-00')
    assert.equal(billNumber('MM', '2026-27', 7), 'MM/26-27/000007')
    assert.ok(billNumber('ABC', '2026-27', 999_999).length <= 16)
  })

  test('amounts use Indian grouping and Rs.; text is reduced to what Helvetica can print', () => {
    assert.equal(rupees(189_900), 'Rs. 1,899.00')
    assert.equal(rupees(1_23_45_678_90), 'Rs. 1,23,45,678.90')
    assert.equal(rupees(-5_000), '-Rs. 50.00')
    assert.equal(printable('₹1,899 – “Ratnagiri” Hāpus'), 'Rs. 1,899 - "Ratnagiri" Hapus')
  })

  test('the seller settings: production refuses bills without a seller, and a bad GSTIN never prints', () => {
    const prod = (extra) => readTrustConfig({ NODE_ENV: 'production', ...extra })
    assert.equal(prod({}).bills, false, 'off in production until switched on')
    assert.equal(readTrustConfig({ NODE_ENV: 'test' }).bills, true, 'on outside production')
    assert.match(checkTrustProduction(prod({ BILLS_ENABLED: 'true' })).errors.join(), /BILL_SELLER_LEGAL_NAME/)
    const ok = checkTrustProduction(prod({ BILLS_ENABLED: 'true', ...UNREGISTERED }))
    assert.deepEqual(ok.errors, [])
    assert.match(ok.warnings.join(), /plain receipts/)
    const bad = prod({ BILLS_ENABLED: 'true', ...REGISTERED, BILL_SELLER_GSTIN: '29AAACM1234A1ZZ' })
    assert.equal(bad.seller.gstin, null)
    assert.match(checkTrustProduction(bad).errors.join(), /BILL_SELLER_GSTIN/)
    const otherState = prod({ BILLS_ENABLED: 'true', ...REGISTERED, BILL_SELLER_STATE_CODE: '27' })
    assert.equal(otherState.seller.gstin, null)
    assert.match(otherState.problems.join(), /registered in state 29/)
  })

  test('the document follows the seller and the goods: Receipt, Bill of Supply, never a Tax Invoice without tax', () => {
    const o = { number: 'MM-1', subtotal: 2 * BOX, discount: 0, total: 2 * BOX, pincode: '560034', placed_at: new Date(), delivery_date: '2026-10-16' }
    const items = [{ sku: 'ALP-3', product_name: 'Alphonso 3 kg', stage: 'RIPE', quantity: 2, unit_price: BOX, line_price: 2 * BOX, hsn_code: '08045020', gst_rate: 0 }]
    const cfg = (env) => readTrustConfig({ NODE_ENV: 'test', ...env })
    assert.equal(composeBill(o, items, cfg(UNREGISTERED)).kind, 'RECEIPT')
    const bos = composeBill(o, items, cfg(REGISTERED))
    assert.equal(bos.kind, 'BILL_OF_SUPPLY')
    assert.equal(bos.snapshot.tax, null)
    assert.match(bos.snapshot.notes.join(), /HSN 0804/)
    // A delivery charge rides with the exempt fruit (composite supply).
    const withFee = composeBill({ ...o, total: 2 * BOX + 4_900 }, items, cfg(REGISTERED))
    assert.equal(withFee.kind, 'BILL_OF_SUPPLY')
    assert.equal(withFee.snapshot.deliveryFee, 4_900)
    assert.match(withFee.snapshot.notes.join(), /composite supply/)
    // Only a line that actually carries GST makes it an invoice, and the tax is worked out of the price.
    const taxed = composeBill(o, [{ ...items[0], gst_rate: 0.05, hsn_code: '20079910' }], cfg(REGISTERED))
    assert.equal(taxed.kind, 'TAX_INVOICE')
    assert.equal(taxed.snapshot.tax.taxableValue + taxed.snapshot.tax.cgst + taxed.snapshot.tax.sgst, 2 * BOX)
    assert.equal(composeBill(o, [{ ...items[0], gst_rate: 0.05 }], cfg(UNREGISTERED)).kind, 'RECEIPT', 'an unregistered seller never charges GST')
    const mixed = composeBill({ ...o, subtotal: 3 * BOX, total: 3 * BOX }, [items[0], { ...items[0], sku: 'X', quantity: 1, line_price: BOX, gst_rate: 0.12 }], cfg(REGISTERED))
    assert.equal(mixed.kind, 'INVOICE_CUM_BILL_OF_SUPPLY')
    // An order that does not add up is never billed.
    assert.throws(() => composeBill({ ...o, subtotal: BOX }, items, cfg(REGISTERED)), /add up/)
    assert.equal(billable({ payment_status: 'SUCCEEDED', total: 0, status: 'CONFIRMED', replacement_for: 'ord_x' }), false)
  })
})

describe('issuing bills', () => {
  beforeEach(() => makeBatch({ age: 5, rating: 'SEMI_RIPE', lines: { 'ALP-3': 60 } }))

  test('paying issues the bill; the owner downloads it; nobody else can', async () => {
    setTrustConfig(REGISTERED)
    const { o, cust } = await placed(2)
    assert.equal(o.status, 201, JSON.stringify(o.body))
    const id = o.body.orderId
    const before = await download(`/v1/orders/${id}/bill`, cust.accessToken)
    assert.equal(before.status, 404)
    assert.equal(JSON.parse(before.body).error.code, 'BILL_NOT_ISSUED')
    assert.equal((await api.get(`/v1/orders/${id}`, { token: cust.accessToken })).body.bill, null)

    await pay(id)
    const view = (await api.get(`/v1/orders/${id}`, { token: cust.accessToken })).body.bill
    assert.equal(view.number, 'MM/26-27/000001')
    assert.equal(view.title, 'Bill of Supply')
    assert.equal(view.total, 2 * BOX)
    assert.equal(view.cancelled, false)

    const pdf = await download(`/v1/orders/${id}/bill`, cust.accessToken)
    assert.equal(pdf.status, 200)
    assert.equal(pdf.type, 'application/pdf')
    assert.match(pdf.disposition, /attachment; filename="MandiMangoes-bill-MM-26-27-000001\.pdf"/)
    const text = pdfText(pdf.body)
    for (const want of ['BILL OF SUPPLY', 'MM/26-27/000001', 'Mandi Fresh Fruits LLP', `GSTIN: ${SELLER_GSTIN}`, 'Karnataka (code 29)', '08045020', 'Rs. 1,899.00', 'Rs. 3,798.00', 'Ravi Kumar', 'Koramangala', 'Notification 2/2017', 'Page 1 of 1']) {
      assert.ok(text.includes(want), `the PDF says ${want}:\n${text}`)
    }
    assert.ok(!/Tax Invoice/i.test(text), 'no tax, so never called a Tax Invoice')

    // Someone else's order is not found, signed out is refused.
    const other = await customerToken(api)
    assert.equal((await download(`/v1/orders/${id}/bill`, other.accessToken)).status, 404)
    assert.equal((await download(`/v1/orders/${id}/bill`)).status, 401)
  })

  test('an unregistered seller issues a plain Receipt that says no GST is charged', async () => {
    setTrustConfig(UNREGISTERED)
    const { orderId, cust } = await paidOrder()
    const text = pdfText((await download(`/v1/orders/${orderId}/bill`, cust.accessToken)).body)
    assert.match(text, /^\s*RECEIPT/m)
    assert.match(text, /Not registered under GST/)
    assert.match(text, /no GST is charged/)
    assert.ok(!/Bill of Supply|Tax Invoice/i.test(text))
  })

  test('managers and operators download from the panel, audited; packers, QC and riders cannot', async () => {
    const { orderId } = await paidOrder()
    const ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
    const detail = (await api.get(`/admin/v1/orders/${orderId}`, { token: ops })).body
    assert.equal(detail.bill.number, 'MM/26-27/000001')
    assert.ok(detail.customerId)
    for (const token of [manager, ops]) {
      const r = await download(`/admin/v1/orders/${orderId}/bill`, token)
      assert.equal(r.status, 200)
      assert.match(pdfText(r.body), /MM\/26-27\/000001/)
    }
    const audit = (await query(`SELECT email, action, target, detail FROM staff_audit WHERE action = 'DOWNLOAD bill' ORDER BY created_at`)).rows
    assert.deepEqual(audit.map((a) => [a.email, a.target, a.detail.bill]), [
      ['manager@mandimangoes.test', orderId, 'MM/26-27/000001'],
      ['ops@mandimangoes.test', orderId, 'MM/26-27/000001'],
    ])
    const packer = await adminToken(api, 'packer@mandimangoes.test', 'packer123')
    const qc = await adminToken(api, 'qc@mandimangoes.test', 'qc123')
    for (const token of [packer, qc]) assert.equal((await download(`/admin/v1/orders/${orderId}/bill`, token)).status, 403)
  })

  test('numbers are gapless and never shared when payments land at the same moment', async () => {
    const orders = []
    for (let i = 0; i < 12; i++) {
      const { o } = await placed(1)
      assert.equal(o.status, 201, JSON.stringify(o.body))
      orders.push(o.body.orderId)
    }
    // Each payment, and a replay of it, at once.
    const results = await Promise.all([...orders, ...orders].map(pay))
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.body)))
    const bills = (await query('SELECT order_id, fy, seq, number FROM bills ORDER BY seq')).rows
    assert.equal(bills.length, 12, 'one bill per order, replays included')
    assert.deepEqual(bills.map((b) => b.seq), Array.from({ length: 12 }, (_, i) => i + 1))
    assert.equal(new Set(bills.map((b) => b.order_id)).size, 12)
    assert.equal((await query(`SELECT last_no FROM bill_counters WHERE fy = '2026-27'`)).rows[0].last_no, 12)
  })

  test('the counter row lock holds under direct concurrent issuing, and a rolled-back bill gives its number back', async () => {
    setTrustConfig({ BILLS_ENABLED: 'false' })
    const ids = []
    for (let i = 0; i < 10; i++) ids.push((await paidOrder()).orderId)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM bills')).rows[0].n, 0, 'switched off: no bills')
    setTrustConfig({})
    // A transaction that takes a number and then fails: the number is not used up.
    await assert.rejects(
      tx(async (c) => {
        await issueBill(c, ids[0])
        throw new Error('payment rolled back')
      }),
      /rolled back/,
    )
    // Ten transactions at once, each holding the counter until it commits.
    await Promise.all(
      ids.map((id) =>
        tx(async (c) => {
          await c.query('SELECT 1 FROM orders WHERE id = $1 FOR UPDATE', [id])
          await issueBill(c, id)
          await c.query('SELECT pg_sleep(0.02)')
        }),
      ),
    )
    const seqs = (await query('SELECT seq FROM bills ORDER BY seq')).rows.map((r) => r.seq)
    assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    // The database refuses a second bill for an order, and a reused number.
    await assert.rejects(
      query(`INSERT INTO bills (id, order_id, fy, seq, number, kind, issued_at, bill_date, total, snapshot) SELECT 'bil_dup', order_id, fy, 99, 'MM/26-27/000099', kind, issued_at, bill_date, total, snapshot FROM bills WHERE seq = 1`),
      /bills_order_id_key/,
    )
    await assert.rejects(
      query(`INSERT INTO bills (id, order_id, fy, seq, number, kind, issued_at, bill_date, total, snapshot) SELECT 'bil_dup', $1, fy, 1, 'MM/26-27/000100', kind, issued_at, bill_date, total, snapshot FROM bills WHERE seq = 1`, [(await placed()).o.body.orderId]),
      /bills_fy_seq_key/,
    )
  })

  test('a new financial year starts again at 1, on the IST date', async () => {
    setTrustConfig({ BILLS_ENABLED: 'false' })
    const a = (await paidOrder()).orderId
    const b = (await paidOrder()).orderId
    const c2 = (await paidOrder()).orderId
    setTrustConfig({})
    const issue = (id, at) => tx(async (c) => issueBill(c, id, new Date(at)))
    assert.equal((await issue(a, '2027-03-31T18:29:00Z')).number, 'MM/26-27/000001') // 23:59 IST, 31 March
    assert.equal((await issue(b, '2027-03-31T18:31:00Z')).number, 'MM/27-28/000001') // 00:01 IST, 1 April
    assert.equal((await issue(c2, '2027-04-02T05:00:00Z')).number, 'MM/27-28/000002')
    assert.equal((await billRow(b)).bill_date, '2027-04-01')
  })

  test('the bill is a snapshot: later edits to the order, product, promo or seller never change it', async () => {
    setTrustConfig(REGISTERED)
    assert.equal((await api.post('/admin/v1/promos', { code: 'MANGO10', kind: 'PERCENT', value: 10 }, { token: manager })).status, 201)
    const { orderId, cust } = await paidOrder(2, { promoCode: 'MANGO10' })
    const first = await download(`/v1/orders/${orderId}/bill`, cust.accessToken)
    const text = pdfText(first.body)
    assert.match(text, /Promo MANGO10\s+-Rs\. 379\.80/)
    assert.match(text, /Total\s+Rs\. 3,418\.20/)

    await query(`UPDATE products SET name = 'Renamed', price = 1 WHERE sku = 'ALP-3'`)
    await query(`UPDATE orders SET customer_name = 'Someone Else', delivery_address = 'Elsewhere', buyer_business_name = 'Late Co' WHERE id = $1`, [orderId])
    await query(`UPDATE order_items SET line_price = 1 WHERE order_id = $1`, [orderId])
    await query(`UPDATE promo_codes SET value = 50 WHERE code = 'MANGO10'`)
    setTrustConfig({ ...REGISTERED, BILL_SELLER_LEGAL_NAME: 'New Name Pvt Ltd' })
    const again = await download(`/v1/orders/${orderId}/bill`, cust.accessToken)
    assert.deepEqual(again.body, first.body, 'byte for byte the same file')

    // The database itself refuses changing an issued bill, or deleting it.
    await assert.rejects(query(`UPDATE bills SET total = 1 WHERE order_id = $1`, [orderId]), /cannot be changed/)
    await assert.rejects(query(`UPDATE bills SET snapshot = '{}' WHERE order_id = $1`, [orderId]), /cannot be changed/)
    await assert.rejects(query(`UPDATE bills SET buyer_name = 'X' WHERE order_id = $1`, [orderId]), /only be removed/)
    await assert.rejects(query(`DELETE FROM bills WHERE order_id = $1`, [orderId]), /never deleted/)
  })

  test('business details: checked at checkout, printed on the bill', async () => {
    setTrustConfig(REGISTERED)
    const bad = await placed(1, { business: { name: 'Tasty Caterers', gstin: '29AABCT1332L1ZZ' } })
    assert.equal(bad.o.status, 400)
    assert.match(JSON.stringify(bad.o.body), /typo/)
    const short = await placed(1, { business: { name: 'T', gstin: BUYER_GSTIN } })
    assert.equal(short.o.status, 400)
    assert.equal(bad.quote.body.bills, true, 'the quote says business details are taken')

    const { orderId, cust } = await paidOrder(1, { business: { name: 'Tasty Caterers Pvt Ltd', gstin: BUYER_GSTIN.toLowerCase() } })
    const mine = (await api.get(`/v1/orders/${orderId}`, { token: cust.accessToken })).body
    assert.deepEqual(mine.business, { name: 'Tasty Caterers Pvt Ltd', gstin: BUYER_GSTIN })
    const text = pdfText((await download(`/v1/orders/${orderId}/bill`, cust.accessToken)).body)
    assert.ok(text.includes('Tasty Caterers Pvt Ltd'))
    assert.ok(text.includes(`GSTIN: ${BUYER_GSTIN}`))

    setTrustConfig({ BILLS_ENABLED: 'false' })
    const off = await placed(1, { business: { name: 'Tasty Caterers', gstin: BUYER_GSTIN } })
    assert.equal(off.o.status, 400)
    assert.equal(off.o.body.error.code, 'BILLS_OFF')
  })

  test('a cancelled order keeps its bill and number, marked cancelled; a free replacement gets none', async () => {
    const { orderId, cust } = await paidOrder()
    const r = await api.post(`/admin/v1/orders/${orderId}/cancel`, { reason: 'Pincode flooded, cannot deliver', refund: true }, { token: manager })
    assert.equal(r.status, 204, JSON.stringify(r.body))
    const b = await billRow(orderId)
    assert.equal(b.number, 'MM/26-27/000001')
    assert.ok(b.cancelled_at)
    const view = (await api.get(`/v1/orders/${orderId}`, { token: cust.accessToken })).body.bill
    assert.equal(view.cancelled, true)
    const text = pdfText((await download(`/v1/orders/${orderId}/bill`, cust.accessToken)).body)
    assert.match(text, /CANCELLED on/)
    assert.match(text, /Pincode\s+flooded/)
    // The next bill takes the next number: a cancelled number is never reused.
    assert.equal((await billRow((await paidOrder()).orderId)).number, 'MM/26-27/000002')

    // Delivered, claimed, replaced: the replacement is free and has no bill of its own.
    const d = await paidOrder()
    await api.post(`/admin/v1/orders/${d.orderId}/allocate`, undefined, { token: manager })
    for (const s of ['PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      const body = s === 'DELIVERED' ? { status: s, override: true, reason: 'Customer confirmed by phone' } : { status: s }
      assert.equal((await api.patch(`/admin/v1/orders/${d.orderId}/status`, body, { token: manager })).status, 204, s)
    }
    const claim = await api.post('/v1/claims', { orderId: d.orderId, issueType: 'DAMAGED', description: 'Two mangoes crushed', itemSkus: ['ALP-3'] }, { token: d.cust.accessToken })
    assert.equal(claim.status, 201, JSON.stringify(claim.body))
    await api.post(`/admin/v1/claims/${claim.body.id}/review`, undefined, { token: manager })
    assert.equal((await api.post(`/admin/v1/claims/${claim.body.id}/resolve`, { resolution: 'REPLACEMENT_APPROVED' }, { token: manager })).status, 204)
    const rep = (await query('SELECT id FROM orders WHERE replacement_for = $1', [d.orderId])).rows[0]
    assert.equal(await billRow(rep.id), undefined)
    assert.equal(JSON.parse((await download(`/admin/v1/orders/${rep.id}/bill`, manager)).body).error.code, 'BILL_NOT_ISSUED')
  })

  test('a Bulk Deals order is billed with its deal on the line', async () => {
    const c = await api.post(
      '/admin/v1/bulk-listings',
      {
        sku: 'ALP-3', title: 'Alphonso for offices', description: 'Hand-picked Ratnagiri Alphonso in 3 kg boxes, for offices and events.',
        origin: 'Ratnagiri, Maharashtra', stages: ['RIPE'], minQty: 10, qtyStep: 1, maxQty: null, tiers: [{ minQty: 10, unitPrice: 159_900 }],
      },
      { token: manager },
    )
    assert.equal(c.status, 201, JSON.stringify(c.body))
    const sharp = (await import('sharp')).default
    const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#f4a300' } }).jpeg().toBuffer()
    assert.equal((await api.raw('POST', `/admin/v1/bulk-listings/${c.body.id}/photos`, { raw: jpeg, token: manager, headers: { 'Content-Type': 'image/jpeg' } })).status, 201)
    assert.equal((await api.post(`/admin/v1/bulk-listings/${c.body.id}/publish`, {}, { token: manager })).status, 200)
    const cust = await customerToken(api)
    assert.equal((await api.post('/v1/cart/bulk', { listingId: c.body.id, stage: 'RIPE', qty: 10 }, { token: cust.accessToken })).status, 204)
    const q = await api.post('/v1/checkout/quote', { pincode: '560034' }, { token: cust.accessToken })
    const o = await api.post('/v1/checkout/confirm', { quoteId: q.body.quoteId, address: ADDRESS }, { token: cust.accessToken, headers: { 'Idempotency-Key': newId('k') } })
    assert.equal(o.status, 201, JSON.stringify(o.body))
    await pay(o.body.orderId)
    const text = pdfText((await download(`/v1/orders/${o.body.orderId}/bill`, cust.accessToken)).body)
    assert.match(text, /Bulk Deal: Alphonso for offices/)
    assert.match(text, /Rs\. 15,990\.00/)
  })

  test('a preorder that becomes an order is billed by the maintenance step; privacy removes the buyer but keeps the bill', async () => {
    setTrustConfig({ BILLS_ENABLED: 'false' })
    const { orderId } = await paidOrder()
    setTrustConfig({})
    // As a converted preorder (or a payment whose bill failed) would be: paid, no bill yet.
    assert.equal(await issueMissingBills(), 1)
    assert.equal(await issueMissingBills(), 0, 'only once')
    const b = await billRow(orderId)
    assert.equal(b.buyer_name, 'Ravi Kumar')
    await removeBillBuyers({ query }, 'SELECT $1::text', [orderId])
    const gone = await billRow(orderId)
    assert.equal(gone.buyer_name, null)
    assert.equal(gone.buyer_address, null)
    assert.equal(gone.number, b.number)
    const text = pdfText(billPdf(gone))
    assert.match(text, /removed \(privacy\)/)
    assert.ok(!text.includes('Ravi Kumar'))
  })

  test('switched off: no bill is issued and the downloads answer 404', async () => {
    setTrustConfig({ BILLS_ENABLED: 'false' })
    assert.equal(trust.bills, false)
    const { orderId, cust } = await paidOrder()
    assert.equal(await billRow(orderId), undefined)
    assert.equal((await download(`/v1/orders/${orderId}/bill`, cust.accessToken)).status, 404)
    assert.equal((await download(`/admin/v1/orders/${orderId}/bill`, manager)).status, 404)
    assert.equal((await api.get(`/admin/v1/orders/${orderId}`, { token: manager })).body.bill, null)
  })
})

// A long bill runs onto more pages, each with the number and "page x of y".
test('a long bill breaks across pages', () => {
  const lines = Array.from({ length: 60 }, (_, i) => ({ sku: `S${i}`, description: `Alphonso 3 kg, ripe, box ${i + 1}`, hsn: '08045020', qty: 1, unitPrice: BOX, amount: BOX, gstRate: 0 }))
  const snapshot = {
    kind: 'RECEIPT', title: 'Receipt', seller: { legalName: 'MandiMangoes', addressLines: ['Bengaluru'], stateCode: '29', stateName: 'Karnataka', gstin: null },
    buyer: {}, placeOfSupply: { stateCode: '29', stateName: 'Karnataka' }, order: { number: 'MM-1', placedAt: '2026-10-15T04:30:00Z', deliveryDate: '2026-10-16' },
    lines, subtotal: 60 * BOX, discount: 0, deliveryFee: 0, tax: null, total: 60 * BOX, paid: 60 * BOX, notes: [],
  }
  const text = pdfText(billPdf({ number: 'MM/26-27/000042', kind: 'RECEIPT', bill_date: '2026-10-15', snapshot, buyer_name: 'राम' }))
  const pages = [...text.matchAll(/Page (\d) of (\d)/g)].map((m) => [Number(m[1]), Number(m[2])])
  assert.ok(pages.length >= 2, text)
  assert.deepEqual(pages, pages.map((_, i) => [i + 1, pages.length]))
  assert.match(text, /MM\/26-27\/000042 \(continued\)/)
  assert.match(text, /box 60/)
  assert.match(text, /Rs\. 1,13,940\.00/)
  assert.match(text, /could not be printed/, 'a name the font cannot print is called out')
})

// Keep setNow untouched for other files.
after(() => setNow(null))
