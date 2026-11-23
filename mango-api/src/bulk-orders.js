// Bulk orders paid at once (mango-api/README.md, Bulk orders): from BULK_MIN_KG (100 kg) in 5 kg and 10 kg boxes,
// at bulk prices (bulk-price.js), paid in full by a Razorpay payment link when they are placed, as a pre-order is.
// Our team then calls the customer on WhatsApp to arrange the delivery (usually 5 to 7 days). A bulk order is a
// bulk_enquiries row of kind ORDER, numbered B… like every bulk record (order-number.js).
//
// Statuses (migration 084):
//   PAYMENT_PENDING  placed, waiting for the payment (BULK_PAY_MINUTES to pay; the maintenance run cancels it after)
//   PAID             paid in full: "bulk order received and paid" goes out (BULK_ORDER_PAID)
//   CONFIRMED        our team called the customer and arranged the delivery
//   DISPATCHED       on its way; from here the customer can no longer cancel it
//   DELIVERED
//   CANCELLED        by the customer (unpaid, or paid within CUSTOMER_CANCEL_HOURS of paying, refunded in full),
//                    by a manager (refunded in full when paid), or not paid in time (payment_status CANCELLED,
//                    no one cancelled it: "Pay again" opens it once more, at today's bulk prices).
// Direct orders placed before payment came in stay NEW until staff close them, as before.
//
// Money: the total is worked out here from the catalogue when the order is placed, never taken from the shop:
// the mangoes at bulk prices, plus delivery at BULK_DELIVERY_PCT of the mangoes' value. Payments follow the
// pre-order rules: only Razorpay's own link id (or the link's notes) ties a payment to an order (PAY-B11), the
// amount and currency are checked (payments.js checkCapture), replays change nothing, a second payment is refunded
// as a duplicate, a payment after the hold ran out is honoured, and one after the customer cancelled is refunded.
// Refunds use the same lease, back-off and give-up as order refunds (payments.js claimRefund).
import { now } from './clock.js'
import { query, tx } from './db.js'
import { conflict, HttpError, notFound } from './errors.js'
import { notify as notifyEvent } from './events.js'
import { newId } from './ids.js'
import { logger } from './logger.js'
import { formatOrderNumber, nextOrderNumber } from './order-number.js'
import { CUSTOMER_CANCEL_HOURS, LAZY_SWEEP_GATEWAY_GRACE_MS, SYSTEM } from './orders.js'
import { canStartCall } from './budget.js'
import { applyCapture, cancelPaymentLink, claimRefund, createPaymentLink, fetchLinkPayments, GATEWAY_CALL_MS, gatewayRefund, refundAttemptFailed, refundReceipt } from './payments.js'
import { priceBulkLines } from './bulk-price.js'
import {
  addEvent, addMessage, BULK_DELIVERY_PCT, BULK_MIN_KG, BULK_PACKS_KG, cleanLines, oneLine, quantityWords, requestHash, rupeeWords, shopUrl,
} from './bulk-enquiries.js'
import { env } from './env.js'
import { boxKg } from './products.js'

/** How long a placed bulk order waits for its payment. */
export const BULK_PAY_MINUTES = 30
/** The statuses of a paid bulk order, in order. */
export const BULK_ORDER_STEPS = ['PAYMENT_PENDING', 'PAID', 'CONFIRMED', 'DISPATCHED', 'DELIVERED']
/** What staff may move a paid bulk order to, from where. */
export const BULK_STAFF_MOVES = { PAID: ['CONFIRMED', 'DISPATCHED'], CONFIRMED: ['DISPATCHED'], DISPATCHED: ['DELIVERED'] }
/** Statuses the customer may still cancel a paid order in (within the window): not once it is on its way. */
const CUSTOMER_CANCELLABLE = ['PAID', 'CONFIRMED']
/** The customer's words when a paid order can no longer be cancelled here (a function: orders.js may load after this file). */
export const bulkCancelClosed = () => `A paid bulk order can be cancelled for a full refund within ${CUSTOMER_CANCEL_HOURS} hours of paying, until it is dispatched. After that, message us and our team will help.`

/** Where the customer sees the order (the shop's bulk order page). */
export const bulkOrderLink = (id) => `${shopUrl()}/bulk/orders/${encodeURIComponent(id)}`

/** When the customer's cancel closes: CUSTOMER_CANCEL_HOURS after paying; null while unpaid. */
export const bulkCancelUntil = (e) => (e.paid_at ? new Date(new Date(e.paid_at).getTime() + CUSTOMER_CANCEL_HOURS * 3_600_000) : null)

/** Whether the customer may cancel it now (unpaid: always; paid: within the window and before dispatch). */
export function customerMayCancelBulk(e, at = now()) {
  if (e.kind !== 'ORDER') return false
  if (e.status === 'PAYMENT_PENDING') return true
  if (!CUSTOMER_CANCELLABLE.includes(e.status) || e.payment_status !== 'SUCCEEDED') return false
  const until = bulkCancelUntil(e)
  return Boolean(until) && at.getTime() <= until.getTime()
}

/** An unpaid order the maintenance run closed (no one cancelled it): it may be paid again. */
export const expiredUnpaid = (e) => e.kind === 'ORDER' && e.status === 'CANCELLED' && e.payment_status === 'CANCELLED' && !e.customer_cancelled_at && !e.staff_cancelled_at

/** The order's money: the lines at bulk prices, delivery at BULK_DELIVERY_PCT of them, and the total. */
export function bulkTotals(lines) {
  const priced = priceBulkLines(lines)
  const deliveryFee = Math.round((priced.subtotal * BULK_DELIVERY_PCT) / 100)
  return { ...priced, deliveryFee, total: priced.subtotal + deliveryFee }
}

async function lockBulk(c, id) {
  const { rows } = await c.query(`SELECT * FROM bulk_enquiries WHERE id = $1 AND kind = 'ORDER' FOR UPDATE`, [id])
  if (!rows.length) throw notFound('Bulk order not found')
  return rows[0]
}

const OWN = '(customer_id = $1 OR phone = (SELECT phone FROM customers WHERE id = $1))'
async function ownLocked(c, customerId, id) {
  const { rows } = await c.query(`SELECT * FROM bulk_enquiries WHERE id = $2 AND kind = 'ORDER' AND ${OWN} FOR UPDATE`, [customerId, id])
  if (!rows.length) throw notFound('Bulk order not found')
  return rows[0]
}

/** The checked lines of a bulk order: known boxes, 5 kg or 10 kg, BULK_MIN_KG or more in all. Returns { lines, kg }. */
export function orderLines(raw) {
  const lines = cleanLines(raw ?? [])
  if (!lines.length) throw new HttpError(400, 'VALIDATION_ERROR', 'Add boxes to your bulk list to place a bulk order.')
  if (lines.some((l) => !BULK_PACKS_KG.includes(l.packKg ?? boxKg(l.sku)))) {
    throw new HttpError(400, 'BULK_BOX_SIZE', `Bulk orders are packed in ${BULK_PACKS_KG.join(' kg or ')} kg boxes only.`)
  }
  const kg = Math.round(lines.reduce((t, l) => t + l.kg, 0))
  if (kg < BULK_MIN_KG) throw new HttpError(400, 'BULK_TOO_SMALL', `Bulk orders start at ${BULK_MIN_KG} kg. For less, use the shop's checkout.`)
  return { lines, kg }
}

/**
 * Places a bulk order for a signed-in customer, unpaid, with BULK_PAY_MINUTES to pay (the caller then makes its
 * payment link: ensureBulkPaymentLink). `b`: { name, business, email, phone, city, address, pincode, notes, lines }.
 * The same Idempotency-Key with the same body answers the first order (200); with another body it is refused (422).
 * Returns { status, row }.
 */
export async function createBulkOrder(c, b, { customerId, idempotencyKey }) {
  const key = `bulkorder:${customerId}:${idempotencyKey}`
  const hash = requestHash(b)
  const replay = async () => {
    const { rows } = await c.query(
      'SELECT k.request_hash, e.* FROM idempotency_keys k JOIN bulk_enquiries e ON e.id = k.order_id WHERE k.key = $1',
      [key],
    )
    if (!rows.length) {
      const old = await c.query('SELECT * FROM bulk_enquiries WHERE idempotency_key = $1', [key])
      return old.rows[0] ?? null
    }
    if (rows[0].request_hash !== hash) {
      throw new HttpError(422, 'IDEMPOTENCY_KEY_REUSED', 'This request does not match the one first sent with this Idempotency-Key. Use a new key for a new order.')
    }
    return rows[0]
  }
  const first = await replay()
  if (first) return { status: 200, row: first }
  const { lines, kg } = orderLines(b.lines)
  const money = bulkTotals(lines)
  const at = now()
  const { rows: recent } = await c.query(`SELECT count(*)::int AS n FROM bulk_enquiries WHERE phone = $1 AND created_at > $2`, [b.phone, new Date(at.getTime() - 86_400_000)])
  if (recent[0].n >= env.BULK_ENQUIRY_DAILY_LIMIT) {
    throw new HttpError(429, 'BULK_LIMIT', 'You have placed several bulk orders today. Message us on WhatsApp if you need more.')
  }
  const id = newId('benq')
  const ins = await c.query('INSERT INTO idempotency_keys (key, order_id, created_at, request_hash) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [key, id, at, hash])
  if (!ins.rowCount) {
    const again = await replay()
    if (again) return { status: 200, row: again }
    throw conflict('This order is still being placed. Try again in a moment.', 'IDEMPOTENCY_IN_PROGRESS')
  }
  const number = await nextOrderNumber(c, 'B')
  await c.query(
    `INSERT INTO bulk_enquiries (id, number, customer_id, name, business, email, phone, city, notes, lines, quantity_kg, idempotency_key,
                                 created_at, updated_at, kind, status, delivery_address, pincode, shop_value, subtotal, delivery_fee, total,
                                 payment_status, payment_started_at, hold_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, 'ORDER', 'PAYMENT_PENDING', $14, $15, $16, $17, $18, $19, 'INITIATED', $13, $20)`,
    [
      id, number, customerId, b.name, b.business, b.email, b.phone, b.city, b.notes, JSON.stringify(money.lines), kg, key, at,
      b.address, b.pincode, money.shopValue, money.subtotal, money.deliveryFee, money.total, new Date(at.getTime() + BULK_PAY_MINUTES * 60_000),
    ],
  )
  await addEvent(c, id, 'RECEIVED', { type: 'customer', id: customerId }, { kind: 'ORDER', kg, total: money.total })
  await notifyEvent(c, 'bulk.enquiry', { id, number, status: 'PAYMENT_PENDING', change: 'created', kind: 'ORDER' })
  return { status: 201, row: (await c.query('SELECT * FROM bulk_enquiries WHERE id = $1', [id])).rows[0] }
}

/** Makes the payment link of an unpaid bulk order that has none yet (outside any transaction: one Razorpay call). */
export async function ensureBulkPaymentLink(id) {
  const { rows } = await query(`SELECT * FROM bulk_enquiries WHERE id = $1 AND kind = 'ORDER' AND status = 'PAYMENT_PENDING'`, [id])
  const e = rows[0]
  if (!e || e.payment_link_url) return e ?? null
  const link = await createPaymentLink({
    amount: e.total, number: e.number, bulkOrderId: e.id, name: e.name, phone: e.phone,
    description: `VMR Mangoes bulk order ${formatOrderNumber(e.number)}`, holdUntil: e.hold_expires_at,
  })
  const up = await query('UPDATE bulk_enquiries SET payment_link_id = $2, payment_link_url = $3 WHERE id = $1 AND payment_link_url IS NULL RETURNING *', [e.id, link.id, link.url])
  return up.rows[0] ?? (await query('SELECT * FROM bulk_enquiries WHERE id = $1', [id])).rows[0]
}

/**
 * The bulk order a Razorpay payment link was paid for (PAY-B11: only the link's own id or the notes we set on the
 * link count, never a payment's notes). A link replaced by "Pay again" still finds its order (LINK_REPLACED event).
 */
export async function findBulkOrderId(c, _entity, link) {
  if (!link?.id && !link?.notes?.bulkOrderId) return null
  const noted = typeof link?.notes?.bulkOrderId === 'string' ? link.notes.bulkOrderId : null
  const { rows } = await c.query(
    `SELECT id FROM bulk_enquiries WHERE payment_link_id = $1 OR (id = $2 AND payment_link_id IS NOT NULL)
      ORDER BY (payment_link_id = $1) DESC NULLS LAST LIMIT 1`,
    [link?.id ?? null, noted],
  )
  if (rows.length) return rows[0].id
  if (!link?.id) return null
  const old = await c.query(`SELECT enquiry_id FROM bulk_enquiry_events WHERE type = 'LINK_REPLACED' AND detail->>'linkId' = $1 LIMIT 1`, [link.id])
  return old.rows[0]?.enquiry_id ?? null
}

/**
 * Applies a payment to a bulk order. Paid while waiting (or after the hold ran out: honoured, no stock is held for
 * bulk): PAID, and "bulk order received and paid" is queued. Paid after the customer or a manager cancelled it:
 * recorded and refunded in full ('refund_due'). A second, different payment on a paid order: recorded as a duplicate
 * and refunded ('duplicate_payment'). Replays change nothing. Returns the result word.
 */
export async function processBulkPayment(c, { bulkOrderId, outcome, paymentId = null, amount = null, method = null, details = null }, actor = SYSTEM) {
  const e = await lockBulk(c, bulkOrderId)
  if (e.payment_status === 'SUCCEEDED' || e.payment_status === 'REFUNDED') {
    if (outcome === 'captured' && paymentId && e.payment_id && paymentId !== e.payment_id) {
      const r = await c.query(
        'INSERT INTO duplicate_payments (payment_id, bulk_enquiry_id, amount, found_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [paymentId, e.id, typeof amount === 'number' ? amount : null, now()],
      )
      if (r.rowCount) {
        logger.warn({ bulkOrderId: e.id, paymentId }, 'second payment on a paid bulk order; refunding it')
        await addEvent(c, e.id, 'DUPLICATE_PAYMENT', actor, { paymentId })
        return 'duplicate_payment'
      }
    }
    return 'already_paid'
  }
  if (outcome !== 'captured') return 'ignored' // a link can be paid again after a failed attempt
  const at = now()
  const paid = [e.id, paymentId, method, amount ?? e.total, at, details ? JSON.stringify(details) : null]
  if (e.status === 'CANCELLED' && (e.customer_cancelled_at || e.staff_cancelled_at)) {
    await c.query(
      `UPDATE bulk_enquiries SET payment_status = 'SUCCEEDED', payment_id = $2, payment_method = $3, paid_amount = $4, paid_at = $5, payment_details = $6,
              refund_requested_at = $5, updated_at = $5 WHERE id = $1`,
      paid,
    )
    await addEvent(c, e.id, 'PAID', actor, { paymentId, note: 'Paid after it was cancelled; full refund requested' })
    return 'refund_due'
  }
  if (e.status !== 'PAYMENT_PENDING' && e.status !== 'CANCELLED') return 'ignored'
  await c.query(
    `UPDATE bulk_enquiries SET status = 'PAID', payment_status = 'SUCCEEDED', payment_id = $2, payment_method = $3, paid_amount = $4, paid_at = $5,
            payment_details = $6, hold_expires_at = NULL, cancel_reason = NULL, updated_at = $5 WHERE id = $1`,
    paid,
  )
  await addEvent(c, e.id, 'PAID', actor, { paymentId, amount: amount ?? e.total, ...(e.status === 'CANCELLED' ? { note: 'Paid after the time to pay ran out' } : {}) })
  await addMessage(c, {
    enquiryId: e.id, kind: 'BULK_ORDER_PAID', eventId: `${e.id}:paid`, phone: e.phone,
    params: [oneLine(e.name, 60) || 'there', formatOrderNumber(e.number), rupeeWords(amount ?? e.total), quantityWords(e), bulkOrderLink(e.id)],
  })
  await notifyEvent(c, 'bulk.enquiry', { id: e.id, number: e.number, status: 'PAID', change: 'paid' })
  return 'paid'
}

/**
 * Unpaid bulk orders whose time to pay ran out are cancelled (no stock was held). As for pre-orders (PAY-B5), one is
 * left alone until Razorpay has been asked about it after its hold, or for 2 minutes after it, so a payment made at
 * the last moment is not cancelled. A payment that lands later still pays it.
 */
export async function expireBulkOrders(c, at = now()) {
  const { rows } = await c.query(
    `SELECT * FROM bulk_enquiries WHERE kind = 'ORDER' AND status = 'PAYMENT_PENDING' AND hold_expires_at < $1
        AND (reconcile_checked_at >= hold_expires_at OR hold_expires_at < $2)
      ORDER BY hold_expires_at LIMIT 100 FOR UPDATE SKIP LOCKED`,
    [at, new Date(at.getTime() - LAZY_SWEEP_GATEWAY_GRACE_MS)],
  )
  for (const e of rows) {
    await c.query(
      `UPDATE bulk_enquiries SET status = 'CANCELLED', payment_status = 'CANCELLED', hold_expires_at = NULL, cancel_reason = 'Not paid in time', updated_at = $2 WHERE id = $1`,
      [e.id, at],
    )
    await addEvent(c, e.id, 'EXPIRED', SYSTEM, { note: `Not paid within ${BULK_PAY_MINUTES} minutes` })
    await notifyEvent(c, 'bulk.enquiry', { id: e.id, number: e.number, status: 'CANCELLED', change: 'expired' })
  }
  return rows.length
}

/**
 * "Pay again" on an order whose time to pay ran out: it waits for payment once more, at today's bulk prices (the
 * total can change), with a new payment link (the old one is cancelled at Razorpay, and a late payment on it still
 * finds this order). An order still waiting keeps its link. Returns the row; the caller makes the link.
 */
export async function reopenBulkOrder(c, customerId, id) {
  const e = await ownLocked(c, customerId, id)
  if (e.status === 'PAYMENT_PENDING') return { row: e, oldLink: null }
  if (!expiredUnpaid(e)) {
    throw conflict(e.payment_status === 'SUCCEEDED' || e.payment_status === 'REFUNDED' ? 'This bulk order is already paid.' : 'This bulk order was cancelled. Place a new one from the bulk page.', 'NOT_PAYABLE')
  }
  const money = bulkTotals((e.lines ?? []).map(({ sku, stage, boxes, kg, packKg }) => ({ sku, stage, boxes, kg, ...(packKg ? { packKg } : {}) })))
  const at = now()
  await c.query(
    `UPDATE bulk_enquiries SET status = 'PAYMENT_PENDING', payment_status = 'INITIATED', hold_expires_at = $2, payment_started_at = $3, reconcile_checked_at = NULL,
            payment_link_id = NULL, payment_link_url = NULL, cancel_reason = NULL, lines = $4, shop_value = $5, subtotal = $6, delivery_fee = $7, total = $8, updated_at = $3
      WHERE id = $1`,
    [e.id, new Date(at.getTime() + BULK_PAY_MINUTES * 60_000), at, JSON.stringify(money.lines), money.shopValue, money.subtotal, money.deliveryFee, money.total],
  )
  await addEvent(c, e.id, 'LINK_REPLACED', { type: 'customer', id: customerId }, { linkId: e.payment_link_id, total: money.total, was: e.total })
  await notifyEvent(c, 'bulk.enquiry', { id: e.id, number: e.number, status: 'PAYMENT_PENDING', change: 'reopened' })
  return { row: (await c.query('SELECT * FROM bulk_enquiries WHERE id = $1', [id])).rows[0], oldLink: e.payment_link_id }
}

/**
 * The customer cancels. Unpaid: cancelled (a payment that still lands is refunded). Paid, within
 * CUSTOMER_CANCEL_HOURS of paying and before it is dispatched: cancelled and refunded in full. Otherwise refused
 * (409 CANCEL_WINDOW_CLOSED, or BULK_DISPATCHED once it is on its way). Returns { refund }.
 */
export async function customerCancelBulk(c, customerId, id) {
  const e = await ownLocked(c, customerId, id)
  if (e.status === 'CANCELLED') throw conflict('This bulk order is already cancelled.', 'ALREADY_CANCELLED')
  if (['DISPATCHED', 'DELIVERED'].includes(e.status)) throw conflict(`Your bulk order is ${e.status === 'DELIVERED' ? 'delivered' : 'on its way'}, so it can no longer be cancelled here. Message us and our team will help.`, 'BULK_DISPATCHED')
  if (!customerMayCancelBulk(e)) throw conflict(bulkCancelClosed(), 'CANCEL_WINDOW_CLOSED')
  const paid = e.payment_status === 'SUCCEEDED'
  const at = now()
  await c.query(
    `UPDATE bulk_enquiries SET status = 'CANCELLED', customer_cancelled_at = $2, hold_expires_at = NULL, cancel_reason = 'Cancelled by the customer',
            payment_status = CASE WHEN payment_status = 'INITIATED' THEN 'CANCELLED' ELSE payment_status END,
            refund_requested_at = CASE WHEN $3 THEN $2 ELSE refund_requested_at END, updated_at = $2 WHERE id = $1`,
    [e.id, at, paid],
  )
  await addEvent(c, e.id, 'CANCELLED', { type: 'customer', id: customerId }, { refund: paid })
  await notifyEvent(c, 'bulk.enquiry', { id: e.id, number: e.number, status: 'CANCELLED', change: 'cancelled' })
  return { refund: paid, link: paid ? null : e.payment_link_id }
}

/** A manager cancels a bulk order, any time before it is cancelled; a paid one is refunded in full. Returns { refund }. */
export async function staffCancelBulk(c, id, admin, reason) {
  const e = await lockBulk(c, id)
  if (e.status === 'CANCELLED') throw conflict('This bulk order is already cancelled.', 'ALREADY_CANCELLED')
  const paid = e.payment_status === 'SUCCEEDED'
  const at = now()
  await c.query(
    `UPDATE bulk_enquiries SET status = 'CANCELLED', staff_cancelled_at = $2, hold_expires_at = NULL, cancel_reason = $4,
            payment_status = CASE WHEN payment_status = 'INITIATED' THEN 'CANCELLED' ELSE payment_status END,
            refund_requested_at = CASE WHEN $3 THEN $2 ELSE refund_requested_at END, updated_at = $2 WHERE id = $1`,
    [e.id, at, paid, reason],
  )
  await addEvent(c, e.id, 'CANCELLED', { type: 'staff', id: admin.id }, { by: admin.email, reason, refund: paid })
  await notifyEvent(c, 'bulk.enquiry', { id: e.id, number: e.number, status: 'CANCELLED', change: 'cancelled' })
  return { refund: paid, link: paid ? null : e.payment_link_id }
}

/** Staff move a paid bulk order on: called the customer (CONFIRMED), dispatched, delivered (BULK_STAFF_MOVES). */
export async function moveBulkOrder(c, id, to, admin, note = null) {
  const e = await lockBulk(c, id)
  if (!(BULK_STAFF_MOVES[e.status] ?? []).includes(to)) {
    throw conflict(e.status === 'PAYMENT_PENDING' ? 'This bulk order is not paid yet.' : `A bulk order that is ${e.status.toLowerCase().replace('_', ' ')} can't be moved to ${to.toLowerCase()}.`, 'INVALID_TRANSITION')
  }
  const col = { CONFIRMED: 'confirmed_at', DISPATCHED: 'dispatched_at', DELIVERED: 'delivered_at' }[to]
  const at = now()
  await c.query(`UPDATE bulk_enquiries SET status = $2, ${col} = $3, updated_at = $3 WHERE id = $1`, [id, to, at])
  await addEvent(c, id, to, { type: 'staff', id: admin.id }, { by: admin.email, ...(note ? { text: note } : {}) })
  await notifyEvent(c, 'bulk.enquiry', { id, number: e.number, status: to, change: 'moved' })
}

/** Sends the full refund of a cancelled paid bulk order. Safe to repeat (claimRefund's lease, gatewayRefund's lookup). */
export async function refundBulkOrder(id) {
  const e = await claimRefund('bulk_enquiries', id)
  if (!e) return null
  let refundId
  try {
    refundId = await gatewayRefund({ paymentId: e.payment_id, amount: e.paid_amount ?? e.total, receipt: refundReceipt(e.number, e.refund_attempts), notes: { bulkOrderId: e.id } })
  } catch (err) {
    await refundAttemptFailed('bulk_enquiries', e.id, e.refund_attempts, err)
    throw err
  }
  if (!refundId) return null
  return tx(async (c) => {
    const r = await c.query(
      `UPDATE bulk_enquiries SET payment_status = 'REFUNDED', refund_id = $2, refunded_at = $3, refund_status = 'pending', refund_checked_at = NULL, updated_at = $3
        WHERE id = $1 AND refunded_at IS NULL RETURNING id`,
      [e.id, refundId, now()],
    )
    if (r.rowCount) {
      await addEvent(c, e.id, 'REFUNDED', SYSTEM, { refundId, amount: e.paid_amount ?? e.total })
      await notifyEvent(c, 'bulk.enquiry', { id: e.id, number: e.number, status: 'CANCELLED', change: 'refunded' })
    }
    return refundId
  })
}

/** Cancels a payment link nobody will use any more (best effort, never throws). */
export const dropLink = (linkId) => (linkId ? cancelPaymentLink(linkId) : Promise.resolve(false))

/**
 * Catches missed link payments (a webhook lost) on unpaid bulk orders, and on ones closed for not paying in time
 * (a late payment is honoured), for 3 days after their payment window opened, each about every 15 minutes.
 */
export async function reconcileBulkPayments() {
  const at = now()
  const { rows } = await query(
    `SELECT id, payment_link_id FROM bulk_enquiries WHERE kind = 'ORDER' AND payment_link_id IS NOT NULL AND payment_status IN ('INITIATED', 'CANCELLED')
        AND payment_started_at > $1 AND (reconcile_checked_at IS NULL OR reconcile_checked_at < $2)
      ORDER BY (payment_status = 'INITIATED') DESC, reconcile_checked_at NULLS FIRST, payment_started_at DESC LIMIT 50`,
    [new Date(at.getTime() - 3 * 86_400_000), new Date(at.getTime() - 15 * 60_000)],
  )
  let n = 0
  for (const e of rows) {
    if (!canStartCall(GATEWAY_CALL_MS)) break
    try {
      await query('UPDATE bulk_enquiries SET reconcile_checked_at = $2 WHERE id = $1', [e.id, now()])
      const captured = (await fetchLinkPayments(e.payment_link_id)).find((x) => x.status === 'captured')
      if (!captured) continue
      const r = await tx((c) => applyCapture(c, 'bulk_enquiries', e.id, captured))
      if (r === 'rejected') continue
      if (r === 'refund_due') await refundBulkOrder(e.id).catch(() => {})
      n++
    } catch (err) {
      logger.error({ err, bulkOrderId: e.id }, 'bulk order reconciliation failed')
    }
  }
  return n
}

/** The maintenance step: payments first (a payment found keeps its order), then the orders whose time ran out. */
export async function runBulkOrderJobs() {
  const reconciled = await reconcileBulkPayments()
  const expired = await tx((c) => expireBulkOrders(c))
  return { reconciled, expired }
}

/** Order fields the shop reads (money in paise, keys ending in Paise so the shop's client never converts them). */
export function bulkOrderView(e) {
  if (e.kind !== 'ORDER' || e.total == null) return null
  const until = bulkCancelUntil(e)
  return {
    amountPaise: e.total, mangoesPaise: e.subtotal, deliveryPaise: e.delivery_fee, shopValuePaise: e.shop_value,
    savingPaise: e.shop_value != null && e.subtotal != null ? e.shop_value - e.subtotal : null, deliveryPct: BULK_DELIVERY_PCT,
    address: e.delivery_address, pincode: e.pincode,
    paymentStatus: e.payment_status, payBy: e.status === 'PAYMENT_PENDING' ? e.hold_expires_at : null,
    paymentUrl: e.status === 'PAYMENT_PENDING' ? (e.payment_link_url ?? null) : null,
    payAgain: expiredUnpaid(e), paidAt: e.paid_at ?? null, paidPaise: e.paid_amount ?? null,
    receipt: e.payment_status === 'SUCCEEDED' || e.payment_status === 'REFUNDED'
      ? { paymentId: e.payment_id, method: e.payment_details?.method ?? e.payment_method ?? null, upiRef: e.payment_details?.upiRef ?? null, card: e.payment_details?.card ?? null, paidAt: e.paid_at }
      : null,
    cancelUntil: until, canCancel: customerMayCancelBulk(e), cancelHours: CUSTOMER_CANCEL_HOURS,
    cancelledAt: e.customer_cancelled_at ?? e.staff_cancelled_at ?? null, cancelledBy: e.customer_cancelled_at ? 'customer' : e.staff_cancelled_at ? 'shop' : e.status === 'CANCELLED' ? 'expired' : null,
    refund: e.refund_requested_at ? { requestedAt: e.refund_requested_at, refundedAt: e.refunded_at ?? null, status: e.refund_status ?? null, gaveUp: Boolean(e.refund_gave_up_at) } : null,
    confirmedAt: e.confirmed_at ?? null, dispatchedAt: e.dispatched_at ?? null, deliveredAt: e.delivered_at ?? null,
  }
}

export { CUSTOMER_CANCEL_HOURS }
