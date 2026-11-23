// Lettered order numbers (migration 077, src/order-number.js): S a shop order, P a pre-order for yourself,
// G anything sent as a gift (one sequence across orders, gift_orders, preorders and preorder_groups),
// B a bulk order. Stored S743406080, shown S-743 406 080. Older numbers (7434060801, ORD-1024, PRE-1035)
// are kept and still found, sorted and printed as before.
import { adminToken, checkout, client, closeAll, customerToken, forceOrderState, makeBatch, resetDb, signWebhook, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { addDays, setNow, todayIST } from '../src/clock.js'
import { query, tx } from '../src/db.js'
import { env } from '../src/env.js'
import { inbox } from '../src/help.js'
import { newId } from '../src/ids.js'
import { runPreorderJobs } from '../src/maintenance.js'
import { paramsFor } from '../src/notify.js'
import {
  formatOrderNumber, LETTER_SEQ, lettered, letteredNumberSql, nextOrderNumber, normaliseOrderNumber, orderNo, orderNumberSql, orderSeqSql, scramble9, unscramble9,
} from '../src/order-number.js'
import { createReplacement, SYSTEM } from '../src/orders.js'
import { refundReceipt } from '../src/payments.js'
import { bumpSequences, highWater } from '../src/restore.js'

describe('the scramble (no database)', () => {
  test('each letter: 9 digits, zero-padded, never repeating, not counting out loud, and reversible', () => {
    for (const letter of ['S', 'P', 'G', 'B']) {
      const seen = new Set()
      let rising = 0
      let prev = null
      for (let seq = 1; seq <= 5000; seq++) {
        const n = lettered(letter, seq)
        assert.match(n, new RegExp(`^${letter}\\d{9}$`))
        assert.ok(!seen.has(n), `${n} repeats`)
        seen.add(n)
        assert.equal(unscramble9(n), seq)
        const v = Number(n.slice(1))
        if (prev !== null) {
          assert.notEqual(Math.abs(v - prev), 1, `${seq}: next to the one before`)
          if (v > prev) rising++
        }
        prev = v
      }
      // Up about as often as down: the digits don't say how many orders came before.
      assert.ok(rising > 1500 && rising < 3500, `${letter}: rose ${rising} times in 4999`)
    }
    // Zero-padded: a sequence value whose digits start with 0 still has 9 of them.
    const low = Array.from({ length: 5000 }, (_, i) => scramble9(i + 1)).find((d) => d.startsWith('0'))
    assert.ok(low && low.length === 9, low)
    assert.equal(unscramble9(low), Array.from({ length: 5000 }, (_, i) => scramble9(i + 1)).indexOf(low) + 1)
    // The last value before wrapping is still distinct from the first.
    assert.notEqual(scramble9(999_999_999), scramble9(1))
  })

  test('shown grouped with the letter apart; searches take it typed any way; old numbers unchanged', () => {
    assert.equal(formatOrderNumber('S743406080'), 'S-743 406 080')
    assert.equal(formatOrderNumber('B000012345'), 'B-000 012 345')
    for (const old of ['7434060801', 'ORD-1024', 'PRE-1035', 'PGR-1001', 'GFT-12', 'BLK-0007', 'HLP-3', '', null]) assert.equal(formatOrderNumber(old), old ?? '')
    assert.equal(orderNo('S743406080'), 'S-743 406 080')
    assert.equal(orderNo('7434060801'), '#7434060801')
    assert.equal(orderNo('ORD-1024'), 'ORD-1024')
    // As the shop shows it (a word joiner after the hyphen, no-break spaces) and pasted from there, too.
    for (const typed of ['s-743 406 080', '#S743406080', 'S743406080', 'S-743 406 080', '# s 743 406080', 's743-406-080', 'S-\u2060743\u00a0406\u00a0080', 'S\u2011743 406 080']) {
      assert.equal(normaliseOrderNumber(typed), 'S743406080', typed)
    }
    assert.equal(normaliseOrderNumber('#7434060801'), '7434060801')
    assert.equal(normaliseOrderNumber('7434 0608 01'), '7434060801')
    assert.equal(normaliseOrderNumber('pre-1035'), 'PRE-1035')
    assert.equal(normaliseOrderNumber('ord 1024'), 'ORD-1024')
    assert.equal(normaliseOrderNumber('blk-0007'), 'BLK-0007')
    // A start of a number (search by prefix), and anything that is not a number, as typed.
    assert.equal(normaliseOrderNumber('g-743 4'), 'G7434')
    assert.equal(normaliseOrderNumber('  Asha Rao '), 'Asha Rao')
    assert.equal(normaliseOrderNumber('Bangalore'), 'Bangalore')
  })

  test('payment references stay inside Razorpay limits (receipt and reference_id: 40 characters)', () => {
    for (const letter of ['S', 'P', 'G', 'B']) {
      const n = lettered(letter, 999_999_999)
      assert.ok(n.length <= 40)
      assert.ok(refundReceipt(n, 99).length <= 40)
      assert.equal(refundReceipt(n, 1), `${n}-r1`)
      // The payment link's description shows it grouped; its reference_id is the number as stored.
      assert.ok(`MandiMangoes order ${formatOrderNumber(n)}`.length < 2048)
    }
  })

  test('WhatsApp template parameters show the grouped number', () => {
    assert.deepEqual(paramsFor({ kind: 'DELIVERED', customer_name: 'Asha', number: 'S743406080' }), ['Asha', 'S-743 406 080'])
    assert.deepEqual(paramsFor({ kind: 'DELIVERED', customer_name: 'Asha', number: '7434060801' }), ['Asha', '7434060801'])
  })
})

describe('with the database', () => {
  let srv
  let api
  let admin
  const saved = { MULTI_GIFT: env.MULTI_GIFT, BULK_ENQUIRIES: env.BULK_ENQUIRIES, WHATSAPP_BULK_UPDATES: env.WHATSAPP_BULK_UPDATES }
  before(async () => {
    await resetDb()
    srv = await startServer()
    api = client(srv.base)
    admin = await adminToken(api)
  })
  after(async () => {
    Object.assign(env, saved)
    await srv.close()
    await closeAll()
  })

  const orderRow = async (id) => (await query('SELECT * FROM orders WHERE id = $1', [id])).rows[0]
  const allG = async () =>
    (await query(`SELECT number FROM orders WHERE number ~ '^G' UNION ALL SELECT number FROM gift_orders UNION ALL
                  SELECT number FROM preorders WHERE number ~ '^G' UNION ALL SELECT number FROM preorder_groups`)).rows.map((r) => r.number)

  test('the SQL numbers as the code does, and sorts old and new by the order they were placed in', async () => {
    for (const seq of [1, 2, 1617, 999_999_999]) {
      assert.equal((await query(`SELECT ${letteredNumberSql('P', String(seq))} AS n`)).rows[0].n, lettered('P', seq))
    }
    // A 10-digit number from after the ORD- ones (migration 056 carried the counter on).
    const ten = (await query(`SELECT ${orderNumberSql('2000')} AS n`)).rows[0].n
    const { rows } = await query(
      `SELECT n FROM (VALUES ('S${scramble9(2)}'), ('ORD-1024'), ('P${scramble9(1)}'), ($1), ('S${scramble9(1)}'), ('ORD-9')) v(n) ORDER BY ${orderSeqSql('n')}`,
      [ten],
    )
    // ORD- first (by their counter), then the 10-digit ones, then lettered ones (each letter by its own sequence).
    assert.deepEqual(rows.map((r) => r.n).slice(0, 3), ['ORD-9', 'ORD-1024', ten])
    const lettered3 = rows.map((r) => r.n).slice(3)
    assert.ok(lettered3.indexOf(`S${scramble9(1)}`) < lettered3.indexOf(`S${scramble9(2)}`))
  })

  test('a shop order is S, a gift from the bag G, a replacement S; old numbers are still found and sorted', async () => {
    await makeBatch({ age: 4, rating: 'RIPE', lines: { 'ALP-3': 20 } })
    const cust = await customerToken(api)
    const s = await checkout(api, cust.accessToken, [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }])
    assert.equal(s.status, 201, JSON.stringify(s.body))
    assert.match(s.body.number, /^S\d{9}$/)
    assert.equal((await api.post('/v1/dev/pay', { orderId: s.body.orderId, outcome: 'captured' })).status, 200)
    // "Make this a gift" in the bag: decided before the order exists, and it is G for good.
    await api.post('/v1/cart/items', { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }, { token: cust.accessToken })
    const q = await api.post('/v1/checkout/quote', { pincode: '560034' }, { token: cust.accessToken })
    assert.equal(q.status, 200, JSON.stringify(q.body))
    const g = await api.post(
      '/v1/checkout/confirm',
      { quoteId: q.body.quoteId, address: '12, 4th Cross, Koramangala, Bengaluru', gift: { recipientName: 'Ravi', recipientPhone: '9845012345', message: null } },
      { token: cust.accessToken, headers: { 'Idempotency-Key': newId('idem') } },
    )
    assert.equal(g.status, 201, JSON.stringify(g.body))
    assert.match(g.body.number, /^G\d{9}$/)
    await forceOrderState(`UPDATE orders SET status = 'DELIVERED' WHERE id = $1`, [s.body.orderId])
    // A claim's replacement is a new shop order: S, its own number.
    const rep = await tx(async (c) => createReplacement(c, { affected_items: null }, await orderRow(s.body.orderId), SYSTEM))
    assert.match(rep.number, /^S\d{9}$/)
    assert.notEqual(rep.number, s.body.number)
    // Shown to people grouped: the confirm answer keeps the stored form; the API's text uses the grouped one.
    const view = (await api.get(`/v1/orders/${s.body.orderId}`, { token: cust.accessToken })).body
    assert.equal(view.number, s.body.number)

    // Older orders keep their numbers and are still found, sorted before the new ones.
    const ten = (await query(`SELECT ${orderNumberSql('2000')} AS n`)).rows[0].n
    for (const [id, number] of [['ord_old1', 'ORD-1024'], ['ord_old2', ten]]) {
      await query(
        `INSERT INTO orders (id, number, customer_id, status, delivery_date, placed_at, subtotal, total) VALUES ($1, $2, $3, 'CONFIRMED', '2026-10-16', '2026-10-15T04:30:00Z', 100, 100)`,
        [id, number, (await orderRow(s.body.orderId)).customer_id],
      )
    }
    const search = async (q) => (await api.get(`/admin/v1/orders?q=${encodeURIComponent(q)}`, { token: admin })).body.items.map((o) => o.number)
    const sDigits = s.body.number.slice(1)
    for (const typed of [s.body.number, `#${s.body.number}`, formatOrderNumber(s.body.number).toLowerCase(), `s-${sDigits.slice(0, 3)} ${sDigits.slice(3, 6)}`]) {
      assert.deepEqual(await search(typed), [s.body.number], typed)
    }
    assert.deepEqual(await search(`#${ten}`), [ten])
    assert.deepEqual(await search('ord-1024'), ['ORD-1024'])
    const sorted = (await query(`SELECT number FROM orders ORDER BY ${orderSeqSql('number')}`)).rows.map((r) => r.number)
    assert.deepEqual(sorted.slice(0, 2), ['ORD-1024', ten])
    assert.ok(sorted.indexOf(s.body.number) < sorted.indexOf(rep.number))

    // Help requests about an order: found by the order number typed any way.
    await query(
      `INSERT INTO help_tickets (id, number, customer_id, order_id, topic, created_at, updated_at) VALUES ('hlp_t1', 'HLP-77', $1, $2, 'DELIVERY', now(), now())`,
      [(await orderRow(s.body.orderId)).customer_id, s.body.orderId],
    )
    for (const typed of [formatOrderNumber(s.body.number), `#${s.body.number.toLowerCase()}`, 'hlp-77']) {
      const box = await inbox({ query }, { q: typed })
      assert.deepEqual((box.items ?? box).map((t) => t.id), ['hlp_t1'], typed)
    }
  })

  test('a gift for several people in season: the gift order and every delivery are G, from the one G sequence', async () => {
    env.MULTI_GIFT = true
    const cust = await customerToken(api)
    const people = [1, 2].map((i) => ({
      name: `Recipient ${i}`, phone: `90000000${i}0`, address: `${i}, 4th Cross, Koramangala, Bengaluru`, pincode: '560034', sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1,
    }))
    const q = await api.post('/v1/gifts/quote', { recipients: people }, { token: cust.accessToken })
    assert.equal(q.status, 200, JSON.stringify(q.body))
    const c = await api.post('/v1/gifts/confirm', { quoteId: q.body.quoteId, name: 'Meera' }, { token: cust.accessToken, headers: { 'Idempotency-Key': newId('k') } })
    assert.equal(c.status, 201, JSON.stringify(c.body))
    assert.match(c.body.number, /^G\d{9}$/)
    const kids = (await query('SELECT number FROM orders WHERE gift_order_id = $1 ORDER BY gift_position', [c.body.giftOrderId])).rows.map((r) => r.number)
    assert.equal(kids.length, 2)
    for (const k of kids) assert.match(k, /^G\d{9}$/)
    // Admin gift search finds it typed as shown.
    const found = (await api.get(`/admin/v1/gift-orders?q=${encodeURIComponent(formatOrderNumber(kids[1]))}`, { token: admin })).body
    assert.deepEqual(found.items.map((g) => g.id), [c.body.giftOrderId])
  })

  test('a bulk enquiry is B; the panel finds it typed with or without the hyphen', async () => {
    env.BULK_ENQUIRIES = true
    const r = await api.post(
      '/v1/bulk-enquiries',
      { name: 'Asha Rao', business: 'Rao Caterers', phone: '98765 43210', city: 'Bengaluru', lines: [{ sku: 'ALP-5', stage: 'SEMI_RIPE', boxes: 50 }] },
      { headers: { 'Idempotency-Key': newId('idem') } },
    )
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.match(r.body.number, /^B\d{9}$/)
    for (const typed of [formatOrderNumber(r.body.number), r.body.number.toLowerCase(), `#${r.body.number}`]) {
      const list = (await api.get(`/admin/v1/bulk-enquiries?q=${encodeURIComponent(typed)}`, { token: admin })).body
      assert.deepEqual((list.items ?? list).map((e) => e.number), [r.body.number], typed)
    }
    // The "we got it" message shows it grouped.
    env.WHATSAPP_BULK_UPDATES = true
    const again = await api.post(
      '/v1/bulk-enquiries',
      { name: 'Asha Rao', business: 'Rao Caterers', phone: '98765 43211', city: 'Bengaluru', lines: [{ sku: 'ALP-5', stage: 'SEMI_RIPE', boxes: 50 }] },
      { headers: { 'Idempotency-Key': newId('idem') } },
    )
    const { rows } = await query(`SELECT bulk_params FROM notifications WHERE bulk_enquiry_id = $1`, [again.body.id])
    assert.equal(rows[0].bulk_params[1], formatOrderNumber(again.body.number))
  })

  test('pre-orders: P for yourself, G as a gift and for a group; the delivery order keeps the number; G shared; restore', async () => {
    let week = addDays(todayIST(), 6)
    while (new Date(`${week}T00:00:00Z`).getUTCDay() !== 1) week = addDays(week, 1)
    setNow(`${addDays(week, -6)}T04:30:00Z`)
    for (const sku of ['ALP-3']) assert.equal((await api.put(`/admin/v1/preorder-capacity/${week}/${sku}`, { capacity: 20 }, { token: admin })).status, 200)
    env.MULTI_GIFT = true
    const book = (token, extra = {}) =>
      api.post('/v1/preorders', { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1, weekStart: week, pincode: '560034', address: '12, 4th Cross, Koramangala, Bengaluru', ...extra },
        { token, headers: { 'Idempotency-Key': newId('idem') } })
    const pre = async (id) => (await query('SELECT * FROM preorders WHERE id = $1', [id])).rows[0]
    const pay = async (p) => {
      const { raw, signature } = signWebhook({
        event: 'payment_link.paid',
        payload: { payment_link: { entity: { id: p.payment_link_id, notes: { preorderId: p.id }, status: 'paid' } }, payment: { entity: { id: `pay_${p.id}`, amount: p.total, method: 'upi' } } },
      })
      const r = await api.raw('POST', '/webhooks/razorpay', { raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature } })
      assert.equal(r.status, 200, JSON.stringify(r.body))
    }

    const a = await customerToken(api)
    const mine = await book(a.accessToken)
    assert.equal(mine.status, 201, JSON.stringify(mine.body))
    assert.match(mine.body.number, /^P\d{9}$/)
    const b = await customerToken(api)
    const gift = await book(b.accessToken, { gift: { recipientName: 'Ravi', recipientPhone: '98450 12345', message: null } })
    assert.equal(gift.status, 201, JSON.stringify(gift.body))
    assert.match(gift.body.number, /^G\d{9}$/)
    // A booking from before lettered numbers converts to a new P number and keeps its own.
    const c = await customerToken(api)
    const old = await book(c.accessToken)
    assert.equal(old.status, 201, JSON.stringify(old.body))
    await query(`UPDATE preorders SET number = 'PRE-1035' WHERE id = $1`, [old.body.id])
    const d = await customerToken(api)
    const group = await api.post('/v1/preorders/groups', {
      recipients: [1, 2].map((i) => ({
        sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1, weekStart: week, pincode: '560034', address: `${i}, 4th Cross, Koramangala, Bengaluru`,
        gift: { recipientName: `Friend ${i}`, recipientPhone: `98450 1234${i}`, message: null },
      })),
    }, { token: d.accessToken, headers: { 'Idempotency-Key': newId('idem') } })
    assert.equal(group.status, 201, JSON.stringify(group.body))
    assert.match(group.body.number, /^G\d{9}$/)
    for (const p of group.body.preorders) assert.match(p.number, /^G\d{9}$/)

    for (const id of [mine.body.id, gift.body.id, old.body.id]) await pay(await pre(id))
    await makeBatch({ age: 0, rating: 'RAW', lines: { 'ALP-3': 20 } })
    assert.ok((await runPreorderJobs()).converted >= 3)
    // One number from booking to doorstep.
    for (const id of [mine.body.id, gift.body.id]) {
      const p = await pre(id)
      assert.equal(p.status, 'CONVERTED')
      assert.equal((await orderRow(p.order_id)).number, p.number)
    }
    const o = await pre(old.body.id)
    assert.equal(o.number, 'PRE-1035')
    assert.match((await orderRow(o.order_id)).number, /^P\d{9}$/)
    // The customer's order view and the order list carry the same number as the booking.
    const view = (await api.get(`/v1/orders/${(await pre(mine.body.id)).order_id}`, { token: a.accessToken })).body
    assert.equal(view.number, mine.body.number)

    // Every G number names one thing, whichever table holds it: all from the one G sequence.
    const gs = await allG()
    const unique = [...new Set(gs)]
    assert.ok(unique.length >= 7, gs.join())
    // The only number held twice is a booking and the delivery order it became (the same thing, on purpose).
    for (const n of unique.filter((x) => gs.indexOf(x) !== gs.lastIndexOf(x))) {
      const { rows } = await query(`SELECT 1 FROM orders o JOIN preorders p ON p.order_id = o.id AND o.preorder_id = p.id WHERE o.number = $1 AND p.number = $1`, [n])
      assert.equal(rows.length, 1, n)
      assert.equal(gs.filter((x) => x === n).length, 2, n)
    }
    const seqs = unique.map(unscramble9).sort((x, y) => x - y)
    assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, i) => i + 1), 'one sequence, no gaps, no collision')

    // A restore puts the G counter back: it moves past every G stored in any of the four tables.
    const seen = await tx((c2) => highWater(c2))
    assert.equal(seen[LETTER_SEQ.G], seqs.length)
    await query(`SELECT setval($1::regclass, 1, false)`, [LETTER_SEQ.G])
    await query(`SELECT setval($1::regclass, 1, false)`, [LETTER_SEQ.P])
    const next = await tx((c2) => bumpSequences(c2, {}))
    assert.equal(next[LETTER_SEQ.G], seqs.length + 1)
    assert.ok(next[LETTER_SEQ.P] >= 3)
    const fresh = await tx((c2) => nextOrderNumber(c2, 'G'))
    assert.ok(!gs.includes(fresh), fresh)
  })
})
