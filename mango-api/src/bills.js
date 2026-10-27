// Bills: one numbered bill for every paid order (docs/trust.md).
//
// What the document is follows the seller's settings (trust-config.js) and
// the goods, from the GST law (sources in docs/trust.md):
//   - seller not registered (no BILL_SELLER_GSTIN): a plain Receipt. Someone
//     without GST registration may not charge GST, and fresh fruit alone does
//     not need registration (CGST Act s.23(1)(a)), so no tax is shown.
//   - registered, every line exempt (fresh mangoes, HSN 0804, are exempt under
//     Notification 2/2017-CT(Rate) S.No.51): a Bill of Supply (CGST Act
//     s.31(3)(c), CGST Rules rule 49).
//   - registered, tax charged on every line: a Tax Invoice (rule 46); on some
//     lines: an Invoice-cum-Bill of Supply (rule 46A). Prices are GST-inclusive,
//     so the tax is worked out of them, per line.
// A delivery charge rides with the goods (a composite supply whose principal
// supply is the fruit: CGST Act s.2(30), s.8(a)), so it is exempt with them.
//
// The number is taken once, when the order is paid: from a per-financial-year
// counter row (April to March) that the paying transaction locks, so numbers
// are gapless, never shared and never reused. Everything printed is copied
// into the bill at that moment, so later edits never change it. A cancelled or
// refunded order keeps its bill, marked cancelled.
import { now, todayIST } from './clock.js'
import { query, tx } from './db.js'
import { newId } from './ids.js'
import { logger } from './logger.js'
import { reportError } from './sentry.js'
import { trust } from './trust-config.js'
import { isOn } from './feature-switches.js'

export const BILL_TITLES = Object.freeze({
  RECEIPT: 'Receipt',
  BILL_OF_SUPPLY: 'Bill of Supply',
  TAX_INVOICE: 'Tax Invoice',
  INVOICE_CUM_BILL_OF_SUPPLY: 'Invoice-cum-Bill of Supply',
})

/** Union territories without a legislature charge UTGST in place of SGST. */
const UTGST_STATES = new Set(['04', '25', '26', '31', '35', '38', '97'])
const STAGE_WORD = { RAW: 'raw', SEMI_RIPE: 'semi-ripe', RIPE: 'ripe' }

/** The Indian financial year (April to March) an IST date falls in, e.g. 2026-10-26 → '2026-27'. */
export function financialYear(date) {
  const y = Number(date.slice(0, 4))
  const start = Number(date.slice(5, 7)) >= 4 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

/** 'MM', '2026-27', 7 → 'MM/26-27/000007' (at most 16 characters: rules 46(b) and 49(b)). */
export const billNumber = (prefix, fy, seq) => `${prefix}/${fy.slice(2)}/${String(seq).padStart(6, '0')}`

/** A paid order with money taken gets a bill; a free replacement does not (the original's bill stands). */
export const billable = (o) =>
  Boolean(o) && o.payment_status === 'SUCCEEDED' && o.total > 0 && !o.replacement_for && !o.gift_order_id && !['PAYMENT_PENDING', 'CANCELLED'].includes(o.status)

/** Splits `amount` over `weights` in proportion, in whole paise; the last share takes the rounding. */
function share(amount, weights) {
  const total = weights.reduce((s, w) => s + w, 0)
  if (!amount || !total) return weights.map(() => 0)
  let left = amount
  return weights.map((w, i) => {
    if (i === weights.length - 1) return left
    const part = Math.floor((amount * w) / total)
    left -= part
    return part
  })
}

function lineDescription(i) {
  const name = i.product_name ?? i.sku
  const stage = i.stage ? `, ${STAGE_WORD[i.stage] ?? i.stage.toLowerCase()}` : ''
  const bulk = i.pricing?.kind === 'bulk' ? ` (Bulk Deal: ${i.pricing.title})` : ''
  return `${name}${stage}${bulk}`
}

/**
 * What the bill says, worked out from the order, its items (with the product's
 * HSN and GST rate) and the seller settings. Pure; throws when the order does
 * not add up, so a wrong bill is never issued.
 */
export function composeBill(o, items, cfg = trust) {
  const seller = cfg.seller
  if (!seller.legalName || !seller.stateCode) {
    throw new Error('Bill seller details are not set: BILL_SELLER_LEGAL_NAME and BILL_SELLER_STATE_CODE')
  }
  if (!items.length) throw new Error(`order ${o.number} has no items to bill`)
  const lines = items.map((i) => ({
    sku: i.sku,
    description: lineDescription(i),
    hsn: i.hsn_code ?? null,
    qty: i.quantity,
    unitPrice: i.unit_price,
    amount: i.line_price,
    gstRate: Number(i.gst_rate ?? 0),
    bulk: i.pricing?.kind === 'bulk' ? { listingId: i.listing_id, title: i.pricing.title, tierMinQty: i.pricing.tier?.minQty ?? null } : null,
    retail: !i.listing_id,
  }))
  const subtotal = lines.reduce((s, l) => s + l.amount, 0)
  if (subtotal !== o.subtotal) throw new Error(`order ${o.number}: its items add up to ${subtotal} paise but the order says ${o.subtotal}`)
  const discount = o.discount ?? 0
  // Anything the order charges above its goods less the promo is the delivery charge (none today).
  const deliveryFee = o.total - (subtotal - discount)
  if (deliveryFee < 0) throw new Error(`order ${o.number}: total ${o.total} is below its goods less discount (${subtotal - discount})`)

  const registered = Boolean(seller.gstin)
  const taxedCount = registered ? lines.filter((l) => l.gstRate > 0).length : 0
  const kind = !registered ? 'RECEIPT' : taxedCount === 0 ? 'BILL_OF_SUPPLY' : taxedCount === lines.length ? 'TAX_INVOICE' : 'INVOICE_CUM_BILL_OF_SUPPLY'

  // The goods are delivered to the buyer's address, inside the seller's state (the shop only
  // delivers to its own pincodes), so the place of supply is the seller's state and any tax is
  // CGST plus SGST (or UTGST).
  const placeOfSupply = { stateCode: seller.stateCode, stateName: seller.stateName }
  let tax = null
  if (taxedCount) {
    // The promo comes off regular boxes only (bulk deals carry their own price); the delivery
    // charge goes with the line of highest value (the principal supply).
    const retail = lines.map((l) => (l.retail ? l.amount : 0))
    const off = share(discount, retail)
    const principal = lines.reduce((best, l, i) => (l.amount > lines[best].amount ? i : best), 0)
    const state = UTGST_STATES.has(seller.stateCode) ? 'utgst' : 'sgst'
    tax = { cgst: 0, [state]: 0, taxableValue: 0, stateTaxLabel: state === 'utgst' ? 'UTGST' : 'SGST' }
    lines.forEach((l, i) => {
      const value = l.amount - off[i] + (i === principal ? deliveryFee : 0)
      if (!(l.gstRate > 0)) {
        l.taxableValue = value
        return
      }
      const pct = Math.round(l.gstRate * 10_000) / 100 // 0.05 → 5
      l.taxableValue = Math.round((value * 100) / (100 + pct))
      const t = value - l.taxableValue
      l.cgst = Math.floor(t / 2)
      l[state] = t - l.cgst
      l.ratePct = pct
      tax.cgst += l.cgst
      tax[state] += l[state]
      tax.taxableValue += l.taxableValue
    })
  }

  const notes = []
  if (seller.placeholder) notes.push('Sample bill: the seller details are placeholders (BILL_SELLER_* settings are not set).')
  if (kind === 'RECEIPT') {
    notes.push('The seller is not registered under GST, so no GST is charged.')
  } else if (kind === 'BILL_OF_SUPPLY') {
    const mangoes = lines.every((l) => String(l.hsn ?? '').startsWith('0804'))
    notes.push(
      mangoes
        ? 'Exempt supply, no GST charged: fresh mangoes (HSN 0804), Notification 2/2017-Central Tax (Rate), S. No. 51.'
        : 'Exempt supply, no GST charged.',
    )
    if (deliveryFee > 0) notes.push('The delivery charge is part of this supply of goods (a composite supply) and is exempt with it.')
  } else {
    notes.push('Prices include GST. The tax in them is shown per line.')
  }
  notes.push('Paid online in full before delivery.')

  return {
    kind,
    total: o.total,
    snapshot: {
      version: 1,
      kind,
      title: BILL_TITLES[kind],
      seller: {
        legalName: seller.legalName,
        addressLines: seller.addressLines,
        stateCode: seller.stateCode,
        stateName: seller.stateName,
        gstin: seller.gstin,
        contact: seller.contact,
        placeholder: Boolean(seller.placeholder),
      },
      buyer: { businessName: o.buyer_business_name ?? null, gstin: o.buyer_gstin ?? null, pincode: o.pincode ?? null },
      placeOfSupply,
      // No delivery day: it may still move after payment (a reschedule), and the bill never changes.
      order: {
        number: o.number,
        placedAt: o.placed_at instanceof Date ? o.placed_at.toISOString() : o.placed_at,
        channel: o.channel,
        preorder: Boolean(o.preorder_id),
      },
      lines: lines.map(({ retail: _retail, ...l }) => l),
      subtotal,
      discount,
      promoCode: o.promo_code ?? null,
      deliveryFee,
      tax,
      total: o.total,
      paid: o.payment_amount ?? o.total,
      notes,
    },
  }
}

const ITEMS_SQL = `SELECT i.*, p.name AS product_name, p.hsn_code, p.gst_rate
                     FROM order_items i LEFT JOIN products p ON p.sku = i.sku
                    WHERE i.order_id = $1 ORDER BY i.sku, i.stage`

/**
 * Issues the order's bill inside the caller's transaction, or returns the one
 * it already has. The caller holds the order row lock (lockOrder). Returns
 * null for an order that gets no bill.
 */
export async function issueBill(c, orderId, at = now()) {
  const had = await c.query('SELECT * FROM bills WHERE order_id = $1', [orderId])
  if (had.rows.length) return had.rows[0]
  const o = (await c.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0]
  if (!billable(o)) return null
  const items = (await c.query(ITEMS_SQL, [orderId])).rows
  const { kind, total, snapshot } = composeBill(o, items)
  const billDate = todayIST(at)
  const fy = financialYear(billDate)
  // The counter row: inserted for a new year, else incremented. Either way the row stays locked
  // until this transaction ends, so a second payment waits here and takes the next number.
  const { rows } = await c.query(
    `INSERT INTO bill_counters (fy, last_no) VALUES ($1, 1)
     ON CONFLICT (fy) DO UPDATE SET last_no = bill_counters.last_no + 1 RETURNING last_no`,
    [fy],
  )
  const seq = rows[0].last_no
  const number = billNumber(trust.numberPrefix, fy, seq)
  const address = [o.delivery_address, o.pincode].filter(Boolean).join(', ') || null
  const ins = await c.query(
    `INSERT INTO bills (id, order_id, fy, seq, number, kind, issued_at, bill_date, total, snapshot, buyer_name, buyer_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [newId('bil'), orderId, fy, seq, number, kind, at, billDate, total, snapshot, o.customer_name ?? null, address],
  )
  logger.info({ orderId, bill: number }, 'bill issued')
  return ins.rows[0]
}

/**
 * issueBill for the payment path: a problem with the bill must never undo a
 * payment, so it runs under a savepoint. On failure the payment still
 * commits, the error goes to the log and Sentry, and the maintenance run
 * issues the bill a minute later (issueMissingBills), or keeps failing loudly
 * as a failing maintenance step on Needs attention.
 */
export async function issueBillWithPayment(c, orderId) {
  if (!isOn('BILLS_ENABLED')) return null
  await c.query('SAVEPOINT issue_bill')
  try {
    const bill = await issueBill(c, orderId)
    await c.query('RELEASE SAVEPOINT issue_bill')
    return bill
  } catch (err) {
    await c.query('ROLLBACK TO SAVEPOINT issue_bill')
    logger.error({ err, orderId }, 'bill not issued with the payment; the maintenance run will issue it')
    reportError(err, { orderId, step: 'bill' })
    return null
  }
}

/** How far before bills were first switched on the catch-up step looks for paid orders still without a bill. */
export const BILL_CATCH_UP_DAYS = 7

/**
 * When bills were first switched on: written once, by the first catch-up run
 * with bills on, and kept. The catch-up looks back from this fixed moment, not
 * from now, so a paid order whose bill keeps failing never ages out of it.
 */
async function billsStartedAt(at) {
  await query('INSERT INTO bills_started (singleton, started_at) VALUES (TRUE, $1) ON CONFLICT (singleton) DO NOTHING', [at])
  return (await query('SELECT started_at FROM bills_started')).rows[0].started_at
}

/**
 * Bills for paid orders that have none: preorders that became orders (their
 * conversion runs in the maintenance loop), and any payment whose bill failed.
 * Every paid order placed or paid since bills were switched on (less
 * BILL_CATCH_UP_DAYS) is a candidate, however old, so a bill that keeps
 * failing keeps the step failing on Needs attention until it is issued.
 * One short transaction per order, locking the order first (as payments and
 * cancels do). Throws after the batch if any failed.
 */
export async function issueMissingBills(at = now(), limit = 200) {
  if (!isOn('BILLS_ENABLED')) return 0
  const since = new Date((await billsStartedAt(at)).getTime() - BILL_CATCH_UP_DAYS * 86_400_000)
  const { rows } = await query(
    `SELECT o.id FROM orders o
      WHERE o.payment_status = 'SUCCEEDED' AND o.total > 0 AND o.replacement_for IS NULL
        AND o.status NOT IN ('PAYMENT_PENDING', 'CANCELLED')
        AND (o.placed_at >= $1 OR EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.status = 'CONFIRMED' AND e.created_at >= $1))
        AND o.gift_order_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.order_id = o.id)
      ORDER BY o.placed_at, o.id LIMIT $2`,
    [since, limit],
  )
  let issued = 0
  const failed = []
  for (const { id } of rows) {
    try {
      const bill = await tx(async (c) => {
        await c.query('SELECT 1 FROM orders WHERE id = $1 FOR UPDATE', [id])
        return issueBill(c, id)
      })
      if (bill) issued++
    } catch (err) {
      failed.push(id)
      logger.error({ err, orderId: id }, 'bill could not be issued')
    }
  }
  // Gift orders (MULTI_GIFT): one bill for the whole order, issued with its payment or here.
  const gifts = await query(
    `SELECT g.id FROM gift_orders g
      WHERE g.payment_status = 'SUCCEEDED' AND g.total > 0 AND g.paid_at >= $1
        AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.gift_order_id = g.id)
      ORDER BY g.paid_at, g.id LIMIT $2`,
    [since, limit],
  )
  for (const { id } of gifts.rows) {
    try {
      const bill = await tx(async (c) => {
        await c.query('SELECT 1 FROM gift_orders WHERE id = $1 FOR UPDATE', [id])
        return issueGiftBill(c, id)
      })
      if (bill) issued++
    } catch (err) {
      failed.push(id)
      logger.error({ err, giftOrderId: id }, 'gift order bill could not be issued')
    }
  }
  if (failed.length) throw new Error(`${failed.length} paid order(s) still without a bill, e.g. ${failed[0]}`)
  return issued
}

/**
 * MULTI_GIFT: the one bill of a gift order, for every delivery in it, with the
 * buyer's business name and GSTIN if they gave them. Composed by composeBill
 * from the parent's totals and its deliveries' items (the same box and
 * ripeness on many deliveries is one line), numbered like any bill and kept on
 * the first delivery (bills.order_id) with gift_order_id set. The caller holds
 * the gift order's row lock. Returns null while it has nothing billable (not
 * paid, or every delivery was cancelled before it was paid).
 */
export async function issueGiftBill(c, giftOrderId, at = now()) {
  const had = await c.query('SELECT * FROM bills WHERE gift_order_id = $1', [giftOrderId])
  if (had.rows.length) return had.rows[0]
  const g = (await c.query('SELECT * FROM gift_orders WHERE id = $1', [giftOrderId])).rows[0]
  if (!g || g.payment_status !== 'SUCCEEDED' || !(g.total > 0)) return null
  const { rows: kids } = await c.query('SELECT * FROM orders WHERE gift_order_id = $1 ORDER BY gift_position, id', [giftOrderId])
  if (!kids.length || kids.every((k) => k.status === 'CANCELLED')) return null
  const { rows: raw } = await c.query(
    `SELECT i.sku, i.stage, i.unit_price, i.listing_id, i.pricing, SUM(i.quantity)::int AS quantity, SUM(i.line_price)::int AS line_price,
            MIN(p.name) AS product_name, MIN(p.hsn_code) AS hsn_code, MIN(p.gst_rate) AS gst_rate
       FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN products p ON p.sku = i.sku
      WHERE o.gift_order_id = $1
      GROUP BY i.sku, i.stage, i.unit_price, i.listing_id, i.pricing
      ORDER BY i.sku, i.stage, i.unit_price`,
    [giftOrderId],
  )
  const order = {
    number: g.number, subtotal: g.subtotal, discount: g.discount, total: g.total, promo_code: g.promo_code,
    buyer_business_name: g.buyer_business_name, buyer_gstin: g.buyer_gstin, pincode: null, placed_at: g.placed_at,
    channel: 'app', preorder_id: null, payment_amount: g.payment_amount,
  }
  const { kind, total, snapshot } = composeBill(order, raw)
  snapshot.order.gift = { recipients: g.recipient_count, deliveries: kids.map((k) => k.number) }
  const billDate = todayIST(at)
  const fy = financialYear(billDate)
  const { rows } = await c.query(
    `INSERT INTO bill_counters (fy, last_no) VALUES ($1, 1)
     ON CONFLICT (fy) DO UPDATE SET last_no = bill_counters.last_no + 1 RETURNING last_no`,
    [fy],
  )
  const seq = rows[0].last_no
  const number = billNumber(trust.numberPrefix, fy, seq)
  const ins = await c.query(
    `INSERT INTO bills (id, order_id, fy, seq, number, kind, issued_at, bill_date, total, snapshot, buyer_name, buyer_address, gift_order_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, $12) RETURNING *`,
    [newId('bil'), kids[0].id, fy, seq, number, kind, at, billDate, total, snapshot, kids[0].customer_name ?? null, giftOrderId],
  )
  logger.info({ giftOrderId, bill: number }, 'gift order bill issued')
  return ins.rows[0]
}

/** issueGiftBill on the payment path, under a savepoint: a bill problem never undoes the payment (issueMissingBills retries). */
export async function issueGiftBillWithPayment(c, giftOrderId) {
  if (!trust.bills) return null
  await c.query('SAVEPOINT issue_gift_bill')
  try {
    const bill = await issueGiftBill(c, giftOrderId)
    await c.query('RELEASE SAVEPOINT issue_gift_bill')
    return bill
  } catch (err) {
    await c.query('ROLLBACK TO SAVEPOINT issue_gift_bill')
    logger.error({ err, giftOrderId }, 'gift order bill not issued with the payment; the maintenance run will issue it')
    reportError(err, { giftOrderId, step: 'bill' })
    return null
  }
}

/**
 * What a cancelled bill says about who cancelled. Fixed, customer-safe words:
 * the reason staff type stays on the order's history and is never printed on
 * a document the customer downloads.
 */
export const BILL_CANCELLED_BY = Object.freeze({ BUYER: 'cancelled by the buyer', SHOP: 'cancelled by the shop' })

/** Marks the order's bill cancelled (the bill itself stays, with its number). Inside the cancel transaction. `by`: 'BUYER' or 'SHOP'. */
export async function markBillCancelled(c, orderId, by, at = now()) {
  // A gift order's bill covers all its deliveries: it is cancelled once every one is (markGiftBillIfAllCancelled).
  await c.query('UPDATE bills SET cancelled_at = $2, cancel_reason = $3 WHERE order_id = $1 AND gift_order_id IS NULL AND cancelled_at IS NULL', [
    orderId, at, BILL_CANCELLED_BY[by] ?? null,
  ])
  const { rows } = await c.query('SELECT gift_order_id FROM orders WHERE id = $1', [orderId])
  if (rows[0]?.gift_order_id) await markGiftBillIfAllCancelled(c, rows[0].gift_order_id, by, at)
}

/** MULTI_GIFT: the gift order's bill is marked cancelled when its last open delivery is cancelled. */
export async function markGiftBillIfAllCancelled(c, giftOrderId, by, at = now()) {
  await c.query(
    `UPDATE bills SET cancelled_at = $2, cancel_reason = $3
      WHERE gift_order_id = $1 AND cancelled_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.gift_order_id = $1 AND o.status <> 'CANCELLED')`,
    [giftOrderId, at, BILL_CANCELLED_BY[by] ?? null],
  )
}

/**
 * Catches bills up with what happened to their orders outside this code: a
 * cancel, an account deletion or a retention run done by a release without
 * bills (for example while rolled back on this schema). Marks cancelled the
 * bills of cancelled orders, and removes the consumer's name and address from
 * bills whose order has had its details removed or whose customer deleted
 * their account. Idempotent; part of the maintenance step `bills`.
 */
export async function reconcileBills(at = now()) {
  if (!isOn('BILLS_ENABLED')) return { cancelled: 0, buyersRemoved: 0 }
  const cancelled = await query(
    `UPDATE bills b
        SET cancelled_at = COALESCE((SELECT MAX(e.created_at) FROM order_events e WHERE e.order_id = o.id AND e.status = 'CANCELLED'), $1),
            cancel_reason = CASE WHEN o.customer_cancelled_at IS NOT NULL THEN $2 ELSE $3 END
       FROM orders o
      WHERE o.id = b.order_id AND o.status = 'CANCELLED' AND b.cancelled_at IS NULL AND b.gift_order_id IS NULL`,
    [at, BILL_CANCELLED_BY.BUYER, BILL_CANCELLED_BY.SHOP],
  )
  // A gift order's bill (MULTI_GIFT): cancelled once every one of its deliveries is.
  const gifts = await query(
    `UPDATE bills b
        SET cancelled_at = $1,
            cancel_reason = CASE WHEN EXISTS (SELECT 1 FROM orders o WHERE o.gift_order_id = b.gift_order_id AND o.customer_cancelled_at IS NOT NULL) THEN $2 ELSE $3 END
      WHERE b.gift_order_id IS NOT NULL AND b.cancelled_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.gift_order_id = b.gift_order_id AND o.status <> 'CANCELLED')`,
    [at, BILL_CANCELLED_BY.BUYER, BILL_CANCELLED_BY.SHOP],
  )
  cancelled.rowCount += gifts.rowCount
  const removed = await query(
    `UPDATE bills b SET buyer_name = NULL, buyer_address = NULL, buyer_removed_at = $1
       FROM orders o LEFT JOIN customers cu ON cu.id = o.customer_id
      WHERE o.id = b.order_id AND b.buyer_removed_at IS NULL AND (o.pii_removed_at IS NOT NULL OR cu.deleted_at IS NOT NULL)`,
    [at],
  )
  if (cancelled.rowCount || removed.rowCount) logger.warn({ cancelled: cancelled.rowCount, buyersRemoved: removed.rowCount }, 'bills caught up with their orders')
  return { cancelled: cancelled.rowCount, buyersRemoved: removed.rowCount }
}

/**
 * Privacy: the consumer's name and address come off their bills (account
 * deletion, or PII_RETENTION_MONTHS after delivery). The number, date, lines,
 * amounts and any business name and GSTIN stay for the books. `orders` is a
 * SELECT of order ids with its parameters.
 */
export async function removeBillBuyers(c, orders, params, at = now()) {
  const n = params.length + 1
  await c.query(
    `UPDATE bills SET buyer_name = NULL, buyer_address = NULL, buyer_removed_at = $${n}
      WHERE order_id IN (${orders}) AND buyer_removed_at IS NULL`,
    [...params, at],
  )
}

/** What the shop and the panel show about a bill. */
export const billView = (b) =>
  b
    ? {
        id: b.id,
        number: b.number,
        kind: b.kind,
        title: BILL_TITLES[b.kind],
        issuedAt: b.issued_at,
        billDate: b.bill_date,
        total: b.total,
        cancelled: Boolean(b.cancelled_at),
        cancelledAt: b.cancelled_at,
      }
    : null

export async function billFor(c, orderId) {
  const { rows } = await c.query('SELECT * FROM bills WHERE order_id = $1', [orderId])
  return rows[0] ?? null
}

/** The file name a bill downloads as: MandiMangoes-bill-MM-26-27-000001.pdf. */
export const billFileName = (b) => `MandiMangoes-bill-${b.number.replace(/\//g, '-')}.pdf`
