// The customer profile and the CSV exports for staff (docs/trust.md).
// Profiles: managers and operators only, phone masked to the last 4 digits,
// every search, view and reveal in staff_audit before anything is shown.
// Exports: managers only, date range capped, cells made formula-safe,
// streamed in pages, audited with the row count.
import { adminToken, checkout, client, closeAll, customerToken, forceOrderState, makeBatch, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { exportPaging, EXPORT_KINDS } from '../src/admin/exports.js'
import { addDays, now, setNow, todayIST } from '../src/clock.js'
import { query } from '../src/db.js'
import { newId } from '../src/ids.js'
import { setTrustConfig } from '../src/trust-config.js'

let srv
let api
let manager
let ops
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
  exportPaging.size = 1000
  await resetDb()
  manager = await adminToken(api)
  ops = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
  await makeBatch({ age: 6, rating: 'RIPE', lines: { 'ALP-3': 60 } })
})
afterEach(() => {
  setTrustConfig({})
  exportPaging.size = 1000
})

const BOX = 189_900
const pay = (orderId) => api.post('/v1/dev/pay', { orderId, outcome: 'captured' })
const idOf = async (token) => (await api.get('/v1/me', { token })).body.id
const audits = async (action) => (await query('SELECT * FROM staff_audit WHERE action = $1 ORDER BY created_at, id', [action])).rows

async function markDelivered(orderId) {
  await forceOrderState(`UPDATE orders SET status = 'DELIVERED' WHERE id = $1`, [orderId])
  await query(`INSERT INTO order_events (id, order_id, from_status, status, actor, created_at) VALUES ($1, $2, 'OUT_FOR_DELIVERY', 'DELIVERED', 'test', $3)`, [newId('evt'), orderId, now()])
}

/** A customer with two paid orders (one delivered, rated, reviewed and claimed) and one unpaid. */
async function history(phone = '9876543210') {
  const cust = await customerToken(api, phone)
  const token = cust.accessToken
  const id = await idOf(token)
  await query(`UPDATE customers SET name = 'Asha Rao', reminders_opt_in = TRUE WHERE id = $1`, [id])
  const a = await checkout(api, token, [{ sku: 'ALP-3', stage: 'RIPE', qty: 2 }])
  assert.equal(a.status, 201, JSON.stringify(a.body))
  await pay(a.body.orderId)
  await markDelivered(a.body.orderId)
  assert.equal((await api.put(`/v1/orders/${a.body.orderId}/rating`, { stars: 4, comment: 'Lovely' }, { token })).status, 204)
  const item = (await query('SELECT id FROM order_items WHERE order_id = $1', [a.body.orderId])).rows[0].id
  const rv = await api.post('/v1/reviews', { orderItemId: item, rating: 5, comment: '=HYPERLINK("http://evil.example","win")' }, { token, headers: { 'Idempotency-Key': newId('k') } })
  assert.equal(rv.status, 201, JSON.stringify(rv.body))
  const claim = await api.post('/v1/claims', { orderId: a.body.orderId, issueType: 'DAMAGED', description: '+SUM(A1:A9) two mangoes crushed', itemSkus: ['ALP-3'] }, { token })
  assert.equal(claim.status, 201, JSON.stringify(claim.body))
  const b = await checkout(api, token, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
  await pay(b.body.orderId)
  const unpaid = await checkout(api, token, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
  return { token, id, paid: [a.body.orderId, b.body.orderId], unpaid: unpaid.body.orderId, claimId: claim.body.id, reviewId: rv.body.review?.id ?? rv.body.id }
}

describe('the customer profile', () => {
  test('search by phone, view and reveal: masked by default, every step audited', async () => {
    const h = await history()
    // Any common way of typing the number finds the customer; the answer is masked.
    for (const phone of ['98765 43210', '+91 98765-43210', '09876543210']) {
      const r = await api.post('/admin/v1/customers/search', { phone }, { token: ops })
      assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.deepEqual(r.body.items.map((c) => [c.id, c.phoneMasked, c.orders]), [[h.id, '******3210', 3]])
      assert.ok(!JSON.stringify(r.body).includes('9876543210'))
    }
    assert.equal((await api.post('/admin/v1/customers/search', { phone: '12345' }, { token: ops })).status, 400)
    const searches = await audits('SEARCH customers by phone')
    assert.equal(searches.length, 3)
    assert.deepEqual(searches[0].detail, { phoneEndsWith: '3210', found: 1 }, 'the audit keeps only the last 4 digits')
    assert.ok(!JSON.stringify(searches).includes('9876543210'))

    const p = await api.get(`/admin/v1/customers/${h.id}`, { token: ops })
    assert.equal(p.status, 200, JSON.stringify(p.body))
    assert.ok(!JSON.stringify(p.body).includes('9876543210'), 'the full number is not in the profile')
    assert.equal(p.body.phoneMasked, '******3210')
    assert.equal(p.body.name, 'Asha Rao')
    assert.deepEqual(p.body.consent.remindersOptIn, true)
    assert.ok(p.body.consent.privacyAcceptedAt)
    assert.equal(p.body.stats.paidOrders, 2)
    assert.equal(p.body.stats.allOrders, 3)
    assert.equal(p.body.stats.lifetimeSpend, 3 * BOX)
    assert.ok(p.body.stats.firstOrderAt && p.body.stats.lastOrderAt)
    assert.equal(p.body.stats.averageRating, 4)
    assert.deepEqual(p.body.orders.map((o) => o.id).sort(), [...h.paid, h.unpaid].sort())
    const first = p.body.orders.find((o) => o.id === h.paid[0])
    assert.equal(first.total, 2 * BOX)
    assert.equal(first.boxes, 2)
    assert.match(first.bill.number, /^MM\/26-27\/00000[12]$/)
    assert.deepEqual(p.body.claims.map((c) => c.id), [h.claimId])
    assert.deepEqual(p.body.reviews.map((r) => [r.id, r.rating]), [[h.reviewId, 5]])
    assert.deepEqual(p.body.ratings.map((r) => r.stars), [4])
    assert.equal(p.body.addresses.length, 1)
    assert.match(p.body.addresses[0].address, /Koramangala/)
    assert.deepEqual((await audits('VIEW customer profile')).map((a) => [a.email, a.target]), [['ops@mandimangoes.test', h.id]])

    const reveal = await api.post(`/admin/v1/customers/${h.id}/reveal`, {}, { token: ops })
    assert.equal(reveal.status, 200)
    assert.equal(reveal.body.phone, '+919876543210')
    const revealed = await audits('REVEAL customer phone and email')
    assert.deepEqual(revealed.map((a) => [a.email, a.target, a.detail]), [['ops@mandimangoes.test', h.id, { phone: true, email: false }]])
    assert.ok(!JSON.stringify(revealed).includes('9876543210'), 'the audit says a reveal happened, not the number')
    // The generic after-response audit does not add a second row for these POSTs.
    await new Promise((r) => setTimeout(r, 50))
    assert.equal((await query(`SELECT COUNT(*)::int AS n FROM staff_audit WHERE action LIKE 'POST /customers%'`)).rows[0].n, 0)
    assert.equal((await api.get('/admin/v1/customers/cus_nope', { token: ops })).status, 404)
  })

  test('order detail, claims and reviews link to the profile', async () => {
    const h = await history()
    assert.equal((await api.get(`/admin/v1/orders/${h.paid[0]}`, { token: ops })).body.customerId, h.id)
    assert.equal((await api.get('/admin/v1/claims', { token: ops })).body[0].customerId, h.id)
    const { status } = (await query('SELECT status FROM reviews WHERE id = $1', [h.reviewId])).rows[0]
    const reviews = await api.get(`/admin/v1/reviews?status=${status}`, { token: ops })
    assert.equal(reviews.status, 200, JSON.stringify(reviews.body))
    assert.deepEqual(reviews.body.items.map((r) => [r.id, r.customerId]), [[h.reviewId, h.id]])
  })

  test('packers, QC and riders cannot open profiles; nothing is shown that was not audited', async () => {
    const h = await history()
    const packer = await adminToken(api, 'packer@mandimangoes.test', 'packer123')
    const qc = await adminToken(api, 'qc@mandimangoes.test', 'qc123')
    for (const token of [packer, qc]) {
      assert.equal((await api.get(`/admin/v1/customers/${h.id}`, { token })).status, 403)
      assert.equal((await api.post(`/admin/v1/customers/${h.id}/reveal`, {}, { token })).status, 403)
      assert.equal((await api.post('/admin/v1/customers/search', { phone: '9876543210' }, { token })).status, 403)
    }
    // When the audit row cannot be written, the profile and the number are not sent.
    await query(`ALTER TABLE staff_audit ADD CONSTRAINT no_profile_rows CHECK (action NOT IN ('VIEW customer profile', 'REVEAL customer phone and email')) NOT VALID`)
    try {
      const p = await api.get(`/admin/v1/customers/${h.id}`, { token: manager })
      assert.equal(p.status, 500)
      assert.ok(!JSON.stringify(p.body).includes('Asha'))
      const r = await api.post(`/admin/v1/customers/${h.id}/reveal`, {}, { token: manager })
      assert.equal(r.status, 500)
      assert.ok(!JSON.stringify(r.body).includes('9876543210'))
    } finally {
      await query('ALTER TABLE staff_audit DROP CONSTRAINT no_profile_rows')
    }
  })

  test('switched off: 404', async () => {
    const h = await history()
    setTrustConfig({ CUSTOMER_PROFILES_ENABLED: 'false' })
    assert.equal((await api.get(`/admin/v1/customers/${h.id}`, { token: manager })).status, 404)
    assert.equal((await api.post('/admin/v1/customers/search', { phone: '9876543210' }, { token: manager })).status, 404)
    assert.equal((await api.post(`/admin/v1/customers/${h.id}/reveal`, {}, { token: manager })).status, 404)
    assert.equal((await audits('VIEW customer profile')).length, 0)
  })
})

/** Parses our CSV (every cell quoted, CRLF rows). */
function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i++
    } else cell += ch
  }
  return rows
}

async function exportCsv(kind, qs, token = manager) {
  const res = await fetch(`${srv.base}/admin/v1/exports/${kind}?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
  const text = await res.text()
  return { status: res.status, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition'), text, rows: res.ok ? parseCsv(text) : null }
}
const RANGE = 'from=2026-10-01&to=2026-10-31'

describe('CSV exports', () => {
  test('every kind downloads for a manager, with a header, and is audited with its row count', async () => {
    const h = await history()
    // A manager cancels the second paid order: a refund (the only kinds there are).
    assert.equal((await api.post(`/admin/v1/orders/${h.paid[1]}/cancel`, { reason: 'Cannot deliver to this pincode', refund: true }, { token: manager })).status, 204)
    const want = { orders: 3, 'order-lines': 3, claims: 1, reviews: 1, 'bulk-orders': 0, payments: 2, refunds: 1 }
    assert.deepEqual(Object.keys(want).sort(), [...EXPORT_KINDS].sort())
    for (const kind of EXPORT_KINDS) {
      const r = await exportCsv(kind, RANGE)
      assert.equal(r.status, 200, `${kind}: ${r.text}`)
      assert.equal(r.type, 'text/csv; charset=utf-8')
      assert.match(r.disposition, new RegExp(`mandimangoes-${kind}-2026-10-01-to-2026-10-31\\.csv`))
      assert.equal(r.rows.length - 1, want[kind], `${kind} rows:\n${r.text}`)
      // Phone numbers and addresses never leave in an export.
      assert.ok(!r.text.includes('9876543210') && !r.text.includes('Koramangala'), `${kind} carries no phone or address`)
    }
    const rows = await audits('EXPORT orders')
    assert.equal(rows.length, 1)
    assert.deepEqual(rows[0].detail, { from: '2026-10-01', to: '2026-10-31', by: 'placed', rows: 3, complete: true })

    const orders = (await exportCsv('orders', RANGE)).rows
    const head = orders[0]
    const paid = orders.find((r) => r[head.indexOf('payment_status')] === 'SUCCEEDED' && r[head.indexOf('status')] !== 'CANCELLED')
    assert.equal(paid[head.indexOf('total_inr')], '3798.00')
    assert.match(paid[head.indexOf('bill_number')], /^MM\/26-27\//)
    assert.equal(paid[head.indexOf('customer_id')], h.id)
    const refunds = (await exportCsv('refunds', RANGE)).rows
    assert.equal(refunds[1][refunds[0].indexOf('reason')], 'manager cancelled (could not deliver)')
    assert.equal(refunds[1][refunds[0].indexOf('amount_inr')], '1899.00')
  })

  test('cells that a spreadsheet would run as a formula are made inert', async () => {
    await history()
    const reviews = await exportCsv('reviews', RANGE)
    assert.ok(reviews.text.includes(`"'=HYPERLINK(""http://evil.example"",""win"")"`), reviews.text)
    const claims = await exportCsv('claims', RANGE)
    assert.ok(claims.text.includes(`"'+SUM(A1:A9) two mangoes crushed"`), claims.text)
  })

  test('the range is checked and capped; operators and others cannot export', async () => {
    assert.equal((await exportCsv('orders', 'from=2026-10-01&to=2027-01-01')).status, 400)
    const long = await exportCsv('orders', 'from=2026-01-01&to=2026-12-31')
    assert.equal(JSON.parse(long.text).error.code, 'RANGE_TOO_LONG')
    assert.equal((await exportCsv('orders', 'from=2026-10-01&to=2027-01-01')).status, 400, '93 days')
    assert.equal((await exportCsv('orders', 'from=2026-10-01&to=2026-12-31')).status, 200, '92 days')
    assert.equal((await exportCsv('orders', 'from=2026-10-31&to=2026-10-01')).status, 400)
    assert.equal((await exportCsv('orders', 'from=yesterday&to=2026-10-01')).status, 400)
    assert.equal((await exportCsv('orders', 'to=2026-10-01')).status, 400)
    assert.equal((await exportCsv('nothing', RANGE)).status, 400)
    assert.equal((await audits('EXPORT orders')).length, 1, 'only the export that ran is audited')
    const packer = await adminToken(api, 'packer@mandimangoes.test', 'packer123')
    for (const token of [ops, packer]) assert.equal((await exportCsv('orders', RANGE, token)).status, 403)
    setTrustConfig({ STAFF_EXPORTS_ENABLED: 'false' })
    assert.equal((await exportCsv('orders', RANGE)).status, 404)
  })

  test('streamed a page at a time: rows across page edges come out once each, in order', async () => {
    for (let i = 0; i < 7; i++) {
      const cust = await customerToken(api)
      const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
      assert.equal(c.status, 201, JSON.stringify(c.body))
      // Pages of 3 over 7 rows: the keyset (time, id) must carry on exactly where the last page ended.
      if (i % 2) setNow(new Date(now().getTime() + 60_000).toISOString())
    }
    exportPaging.size = 3
    const r = await exportCsv('orders', RANGE)
    const numbers = r.rows.slice(1).map((row) => row[0])
    assert.equal(numbers.length, 7)
    assert.equal(new Set(numbers).size, 7)
    const placedAt = r.rows.slice(1).map((row) => row[1])
    assert.deepEqual(placedAt, [...placedAt].sort())
    assert.equal((await audits('EXPORT orders'))[0].detail.rows, 7)
  })

  test('a payment that lands days after the order was placed is in the export for the day it was paid', async () => {
    const cust = await customerToken(api)
    const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
    assert.equal(c.status, 201, JSON.stringify(c.body))
    const placedDay = todayIST()
    // A late capture (or a replay after a restore), well over a week after the order was placed.
    setNow(new Date(now().getTime() + 9 * 86_400_000).toISOString())
    const paid = await pay(c.body.orderId)
    assert.equal(paid.status, 200, JSON.stringify(paid.body))
    const payDay = todayIST()
    const number = (await query('SELECT number FROM orders WHERE id = $1', [c.body.orderId])).rows[0].number
    const r = await exportCsv('payments', `from=${payDay}&to=${payDay}`)
    assert.equal(r.status, 200, r.text)
    const head = r.rows[0]
    const row = r.rows.find((x) => x[head.indexOf('reference')] === number)
    assert.ok(row, `the payment is listed on ${payDay}:\n${r.text}`)
    assert.match(row[head.indexOf('paid_at')], new RegExp(`^${payDay}T`))
    assert.match(row[head.indexOf('bill_number')], /^MM\/26-27\//)
    // Not on the day it was placed, when nothing was paid.
    assert.ok(!(await exportCsv('payments', `from=${placedDay}&to=${placedDay}`)).text.includes(number))
  })

  test('orders by delivery date', async () => {
    const cust = await customerToken(api)
    const c = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'RIPE', qty: 1 }])
    const day = c.body.deliveryDate
    assert.equal((await exportCsv('orders', `from=${day}&to=${day}&by=delivery`)).rows.length, 2)
    assert.equal((await exportCsv('orders', `from=${addDays(day, 1)}&to=${addDays(day, 3)}&by=delivery`)).rows.length, 1, 'header only')
    assert.equal((await audits('EXPORT orders'))[0].detail.by, 'delivery')
  })
})
