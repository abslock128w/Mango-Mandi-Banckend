// Bulk and corporate gifting (MULTI_GIFT, docs/gifting.md): the core.
//
// One gift order (gift_orders) has many recipients; each recipient is its own
// delivery order (orders row, gift_order_id set), made at checkout with its
// stock held by createOrder, so the boxes for every recipient are held in one
// transaction or none are. One Razorpay order pays for the whole gift order;
// its payment confirms every delivery through processPayment, exactly once.
// From then on each delivery is an ordinary order: packing, riders, proof,
// claims, the recipient's gift message and a cancel before packing (refunded
// by that delivery's own amount) all work unchanged.
import { now } from './clock.js'
import { getConfig } from './config.js'
import { conflict, HttpError, notFound } from './errors.js'
import { newId } from './ids.js'
import { issueGiftBillWithPayment } from './bills.js'
import { addEvent, createOrder, customerCancel, processPayment, recordDuplicatePayment, SYSTEM } from './orders.js'

/** Statuses in which a buyer may still cancel a delivery (as for any order: before packing). */
export const GIFT_CANCELLABLE = ['PAYMENT_PENDING', 'CONFIRMED', 'PROCESSING']

/** How many boxes one recipient may get: the cart's per-line limit, and never more than one buyer may hold. */
export const perRecipientMax = () => Math.min(20, getConfig().maxHeldBoxes)

/**
 * Splits `amount` (the promo discount) over the recipients in proportion to what
 * their boxes cost, in whole paise; the last takes the rounding. Each delivery's
 * total is then its boxes less its share, so a cancelled recipient is refunded
 * exactly what they cost the buyer.
 */
export function shareDiscount(amount, prices) {
  const sum = prices.reduce((s, p) => s + p, 0)
  if (!amount || !sum) return prices.map(() => 0)
  let left = amount
  return prices.map((p, i) => {
    if (i === prices.length - 1) return left
    const part = Math.floor((amount * p) / sum)
    left -= part
    return part
  })
}

/**
 * Makes the gift order and one delivery per recipient, inside the caller's
 * transaction. Every delivery takes its stock as a hold (allOrNothing): one
 * shortfall throws STOCK_INSUFFICIENT and the caller's transaction rolls back
 * every hold. `q` is the stored quote (kind 'multi-gift').
 */
export async function createGiftOrder(c, { customerId, buyerName, phone, q, promo, business, holdExpiresAt }, actor) {
  const id = newId('gft')
  const { rows } = await c.query(`SELECT 'GFT-' || nextval('gift_order_seq') AS number`)
  const number = rows[0].number
  const recipients = q.recipients
  const subtotal = recipients.reduce((s, r) => s + r.linePrice, 0)
  const discount = promo?.discount ?? 0
  const boxes = recipients.reduce((s, r) => s + r.qty, 0)
  await c.query(
    `INSERT INTO gift_orders (id, number, customer_id, status, delivery_date, slot_id, recipient_count, boxes, subtotal, discount, total,
                              promo_code, buyer_business_name, buyer_gstin, payment_status, hold_expires_at, placed_at)
     VALUES ($1, $2, $3, 'PAYMENT_PENDING', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'INITIATED', $14, $15)`,
    [
      id, number, customerId, q.deliveryDate, q.slotId ?? null, recipients.length, boxes, subtotal, discount, subtotal - discount,
      promo?.code ?? null, business?.name ?? null, business?.gstin ?? null, holdExpiresAt, now(),
    ],
  )
  const shares = shareDiscount(discount, recipients.map((r) => r.linePrice))
  const children = []
  for (const [i, r] of recipients.entries()) {
    const child = await createOrder(
      c,
      {
        customerId, customerName: buyerName, phone, pincode: r.pincode, address: r.address,
        deliveryDate: q.deliveryDate, slotId: q.slotId ?? null, strictSlot: Boolean(q.slotId), status: 'PAYMENT_PENDING', paymentStatus: 'INITIATED',
        allOrNothing: true, holdExpiresAt,
        lines: [{ sku: r.sku, stage: r.stage, qty: r.qty, unitPrice: r.unitPrice }],
        discount: shares[i], promoCode: promo && shares[i] ? promo.code : null,
        gift: { recipientName: r.name, recipientPhone: r.phone, message: r.note || null },
        eventReason: `Gift order ${number}, recipient ${i + 1} of ${recipients.length}`,
      },
      actor,
    )
    await c.query('UPDATE orders SET gift_order_id = $2, gift_position = $3 WHERE id = $1', [child.id, id, i + 1])
    children.push(child)
  }
  return { id, number, children }
}

/**
 * A gift order's status as the buyer and staff see it: unpaid with every
 * delivery cancelled (the hold ran out) is cancelled, though a late payment
 * can still confirm it.
 */
export function giftStatus(g, kids) {
  if (g.status === 'PAYMENT_PENDING' && kids.length && kids.every((k) => k.status === 'CANCELLED')) return 'CANCELLED'
  return g.status
}

const lockGift = async (c, id) => {
  const { rows } = await c.query('SELECT * FROM gift_orders WHERE id = $1 FOR UPDATE', [id])
  if (!rows.length) throw notFound('Gift order not found')
  return rows[0]
}

export const giftChildren = async (c, giftOrderId) =>
  (await c.query('SELECT * FROM orders WHERE gift_order_id = $1 ORDER BY gift_position, id', [giftOrderId])).rows

/**
 * Applies a payment outcome to a gift order, as processPayment does for one
 * order, and is as idempotent: once the gift order is paid, a replay (a
 * webhook retry, the reconcile loop, verify-payment) changes nothing, and a
 * second payment is recorded as a duplicate and refunded. A captured payment
 * confirms each delivery through processPayment (paymentId stays on the parent;
 * each delivery records its own amount), so a late payment, a delivery the
 * buyer cancelled before paying (refunded) and the day's stock rules work as
 * for any order. Then the one bill is issued (BILLS_ENABLED).
 * Returns { result, refundOrderIds }.
 */
export async function processGiftPayment(c, { giftOrderId, outcome, paymentId = null, amount = null, method = null }, actor = SYSTEM) {
  const g = await lockGift(c, giftOrderId)
  const kids = await giftChildren(c, g.id)
  if (g.payment_status === 'SUCCEEDED') {
    if (outcome === 'captured' && paymentId && g.payment_id && paymentId !== g.payment_id && kids.length) {
      if (await recordDuplicatePayment(c, { orderId: kids[0].id, paymentId, amount })) {
        await addEvent(c, kids[0].id, kids[0].status, kids[0].status, actor, `A second payment (${paymentId}) was taken for gift order ${g.number}; it is being refunded`)
        return { result: 'duplicate_payment', refundOrderIds: [] }
      }
    }
    return { result: 'already_paid', refundOrderIds: [] }
  }
  if (outcome === 'abandoned' || outcome === 'failed') {
    if (g.status !== 'PAYMENT_PENDING') return { result: 'ignored', refundOrderIds: [] }
    for (const k of kids) await processPayment(c, { orderId: k.id, outcome }, actor)
    if (outcome === 'failed') return { result: 'attempt_failed', refundOrderIds: [] }
    await c.query(`UPDATE gift_orders SET status = 'CANCELLED', payment_status = 'FAILED', hold_expires_at = NULL, cancelled_at = $2 WHERE id = $1`, [g.id, now()])
    return { result: 'cancelled', refundOrderIds: [] }
  }
  await c.query(
    `UPDATE gift_orders SET payment_status = 'SUCCEEDED', status = CASE WHEN status = 'CANCELLED' THEN 'CANCELLED' ELSE 'PAID' END,
            payment_id = COALESCE($2, payment_id), payment_method = COALESCE($3, payment_method), payment_amount = COALESCE($4, payment_amount),
            paid_at = $5, hold_expires_at = NULL WHERE id = $1`,
    [g.id, paymentId, method, amount, now()],
  )
  const refundOrderIds = []
  let late = false
  for (const k of kids) {
    const r = await processPayment(c, { orderId: k.id, outcome: 'captured', amount: k.total, method }, actor)
    if (r.result === 'refund_due') refundOrderIds.push(k.id)
    if (r.result === 'confirmed_late') late = true
  }
  await issueGiftBillWithPayment(c, g.id)
  const result = kids.length && refundOrderIds.length === kids.length ? 'refund_due' : late ? 'confirmed_late' : 'confirmed'
  return { result, refundOrderIds }
}

/** Whether every delivery is cancelled; then the gift order is too. */
async function closeIfAllCancelled(c, g) {
  const { rows } = await c.query(`SELECT COUNT(*) FILTER (WHERE status <> 'CANCELLED')::int AS open FROM orders WHERE gift_order_id = $1`, [g.id])
  if (rows[0].open > 0 || g.status === 'CANCELLED') return
  await c.query(
    `UPDATE gift_orders SET status = 'CANCELLED', cancelled_at = $2,
            payment_status = CASE WHEN payment_status = 'INITIATED' THEN 'CANCELLED' ELSE payment_status END, hold_expires_at = NULL
      WHERE id = $1`,
    [g.id, now()],
  )
}

/**
 * The buyer cancels the whole gift order: every delivery, as long as none is
 * packed yet (the owner's rule: a refund only before packing). An unpaid one
 * is simply cancelled; a paid one is refunded delivery by delivery, so each
 * refund matches what that delivery cost. Returns the deliveries due a refund.
 */
export async function cancelGiftOrder(c, giftOrderId, customerId, actor) {
  const g = await lockGift(c, giftOrderId)
  if (g.customer_id !== customerId) throw notFound('Gift order not found')
  const kids = await giftChildren(c, g.id)
  const open = kids.filter((k) => k.status !== 'CANCELLED')
  if (!open.length) throw conflict('This gift order is already cancelled.', 'NOT_CANCELLABLE')
  const late = open.filter((k) => !GIFT_CANCELLABLE.includes(k.status))
  if (late.length) {
    throw new HttpError(
      409,
      'NOT_CANCELLABLE',
      `Some deliveries are already packed or on their way (${late.map((k) => k.number).join(', ')}), so the whole order can no longer be cancelled. You can still cancel the recipients not yet packed, one by one.`,
      { orders: late.map((k) => k.number) },
    )
  }
  const refundOrderIds = []
  for (const k of open) if (await customerCancel(c, k.id, customerId, actor, { wholeGift: true })) refundOrderIds.push(k.id)
  await closeIfAllCancelled(c, g)
  return refundOrderIds
}

/**
 * The buyer cancels one recipient of a paid gift order, before it is packed
 * (customerCancel's rule). That delivery is refunded its own amount; the others
 * go ahead. Returns true when a refund is due.
 */
export async function cancelGiftRecipient(c, giftOrderId, orderId, customerId, actor) {
  const g = await lockGift(c, giftOrderId)
  if (g.customer_id !== customerId) throw notFound('Gift order not found')
  const { rows } = await c.query('SELECT id FROM orders WHERE id = $1 AND gift_order_id = $2', [orderId, g.id])
  if (!rows.length) throw notFound('Recipient not found')
  const refund = await customerCancel(c, orderId, customerId, actor)
  await closeIfAllCancelled(c, g)
  return refund
}
