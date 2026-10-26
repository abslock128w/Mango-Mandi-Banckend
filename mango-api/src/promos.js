// Promo codes. A quote shows the discount; confirm checks the code again with
// the code's row locked, so a limited code can't be over-used by a race.
import { now, todayIST } from './clock.js'
import { badRequest } from './errors.js'

export const normaliseCode = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '')

const fail = (message, code) => badRequest(message, code)

/** The discount in paise for a subtotal, or an error saying why the code doesn't apply. */
export async function applyPromo(c, rawCode, customerId, subtotal, { lock = false } = {}) {
  const code = normaliseCode(rawCode)
  if (!/^[A-Z0-9]{3,20}$/.test(code)) throw fail('That promo code is not valid', 'PROMO_INVALID')
  const { rows } = await c.query(`SELECT * FROM promo_codes WHERE code = $1${lock ? ' FOR UPDATE' : ''}`, [code])
  const p = rows[0]
  if (!p || !p.active) throw fail('That promo code is not valid', 'PROMO_INVALID')
  // A referral thank-you (docs/growth.md) is for the one customer it was given to.
  if (p.owner_customer_id && p.owner_customer_id !== customerId) throw fail('That promo code is not valid', 'PROMO_INVALID')
  const today = todayIST()
  if (p.starts_on && today < p.starts_on) throw fail('That promo code is not active yet', 'PROMO_NOT_STARTED')
  if (p.ends_on && today > p.ends_on) throw fail('That promo code has expired', 'PROMO_EXPIRED')
  if (subtotal < p.min_subtotal) throw fail(`This code needs an order of at least ₹${Math.ceil(p.min_subtotal / 100)}`, 'PROMO_MIN_SUBTOTAL')
  // A checkout cancelled for non-payment still counts for half an hour: its
  // payment can land late (links stay open 16 minutes) and revive the order,
  // which would otherwise push a limited code past its limit.
  const used = await c.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE r.customer_id = $2)::int AS mine
       FROM promo_redemptions r JOIN orders o ON o.id = r.order_id
      WHERE r.code = $1
        AND (o.status <> 'CANCELLED'
             OR (o.payment_status IN ('INITIATED', 'CANCELLED') AND o.customer_cancelled_at IS NULL
                 AND o.staff_cancelled_at IS NULL AND o.placed_at > $3))`,
    [code, customerId, new Date(now().getTime() - 30 * 60_000)],
  )
  if (p.max_uses != null && used.rows[0].total >= p.max_uses) throw fail('That promo code has been fully used', 'PROMO_USED_UP')
  if (used.rows[0].mine >= p.per_customer) throw fail("You've already used this promo code", 'PROMO_ALREADY_USED')
  if (p.first_order_only) {
    const prior = await c.query(`SELECT 1 FROM orders WHERE customer_id = $1 AND status <> 'CANCELLED' AND replacement_for IS NULL LIMIT 1`, [customerId])
    if (prior.rowCount) throw fail('This code is for your first order', 'PROMO_FIRST_ORDER')
  }
  let discount = p.kind === 'PERCENT' ? Math.floor((subtotal * p.value) / 100) : p.value
  if (p.max_discount != null) discount = Math.min(discount, p.max_discount)
  discount = Math.min(discount, subtotal - 100) // at least ₹1 is still paid
  if (discount <= 0) throw fail('That promo code does not apply to this order', 'PROMO_INVALID')
  return { code, discount, description: p.description }
}

export async function recordRedemption(c, { orderId, code, customerId, discount }) {
  await c.query('INSERT INTO promo_redemptions (order_id, code, customer_id, discount, created_at) VALUES ($1, $2, $3, $4, $5)', [
    orderId, code, customerId, discount, now(),
  ])
}

export const promoView = (p, uses = 0) => ({
  code: p.code, kind: p.kind, value: p.value, maxDiscount: p.max_discount, minSubtotal: p.min_subtotal,
  startsOn: p.starts_on, endsOn: p.ends_on, maxUses: p.max_uses, perCustomer: p.per_customer,
  firstOrderOnly: p.first_order_only, active: p.active, description: p.description, uses, createdBy: p.created_by, createdAt: p.created_at,
})
