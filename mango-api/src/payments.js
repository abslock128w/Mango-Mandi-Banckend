// Razorpay adapter, webhook verification and payment reconciliation.
// Without API keys (development and tests) an in-memory dev gateway stands in.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { now } from './clock.js'
import { query, tx } from './db.js'
import { env, isProd } from './env.js'
import { HttpError } from './errors.js'
import { newId } from './ids.js'
import { logger } from './logger.js'
import { processPayment } from './orders.js'

const hasKeys = () => Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET)
const RAZORPAY = 'https://api.razorpay.com/v1'

/** razorpayOrderId → { status: 'captured' | 'failed', id, amount } */
export const devGateway = new Map()

async function razorpay(method, path, body) {
  const res = await fetch(`${RAZORPAY}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Razorpay ${method} ${path} failed: ${res.status}`)
  return res.json()
}

export async function createGatewayOrder({ amount, receipt, orderId }) {
  if (hasKeys()) {
    const o = await razorpay('POST', '/orders', { amount, currency: 'INR', receipt, notes: { orderId } })
    return o.id
  }
  if (isProd) throw new HttpError(503, 'PAYMENTS_UNAVAILABLE', 'Payments are not configured')
  return `order_dev_${newId('rzp').slice(4)}`
}

async function fetchPayments(razorpayOrderId) {
  if (hasKeys()) return (await razorpay('GET', `/orders/${encodeURIComponent(razorpayOrderId)}/payments`)).items ?? []
  if (isProd) return []
  const p = devGateway.get(razorpayOrderId)
  return p ? [p] : []
}

export function verifySignature(raw, signature) {
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false
  const expected = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest()
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'))
}

async function findOrderId(c, entity) {
  const { rows } = await c.query('SELECT id FROM orders WHERE razorpay_order_id = $1 OR id = $2 LIMIT 1', [
    entity.order_id ?? null,
    entity.notes?.orderId ?? null,
  ])
  return rows[0]?.id ?? null
}

/**
 * Handles one verified webhook body. The dedupe row is written in the same
 * transaction, so a processing error rolls it back and Razorpay's retry runs.
 */
export async function handleWebhook(event, eventId) {
  const kind = event?.event
  if (kind !== 'payment.captured' && kind !== 'payment.failed') return { ignored: true }
  const entity = event.payload?.payment?.entity ?? {}
  const dedupeKey = eventId || `${kind}:${entity.id}`
  return tx(async (c) => {
    const ins = await c.query('INSERT INTO processed_webhooks (dedupe_key, created_at) VALUES ($1, $2) ON CONFLICT DO NOTHING', [dedupeKey, now()])
    if (!ins.rowCount) return { duplicate: true }
    const orderId = await findOrderId(c, entity)
    if (!orderId) {
      logger.warn({ razorpayOrderId: entity.order_id }, 'webhook for an unknown order')
      return { unknownOrder: true }
    }
    const r = await processPayment(c, {
      orderId,
      outcome: kind === 'payment.captured' ? 'captured' : 'failed',
      paymentId: entity.id ?? null,
      amount: typeof entity.amount === 'number' ? entity.amount : null,
      method: entity.method ?? null,
    })
    return { result: r.result }
  })
}

/** Catches up on missed webhooks for orders stuck in PAYMENT_PENDING. */
export async function reconcilePendingPayments({ minAgeSeconds = 120 } = {}) {
  if (!hasKeys() && isProd) return 0
  const { rows } = await query(
    `SELECT id, razorpay_order_id FROM orders
      WHERE status = 'PAYMENT_PENDING' AND razorpay_order_id IS NOT NULL AND placed_at < $1
      ORDER BY placed_at LIMIT 100`,
    [new Date(now().getTime() - minAgeSeconds * 1000)],
  )
  let n = 0
  for (const o of rows) {
    try {
      const payments = await fetchPayments(o.razorpay_order_id)
      const captured = payments.find((p) => p.status === 'captured')
      if (captured) {
        await tx((c) => processPayment(c, { orderId: o.id, outcome: 'captured', paymentId: captured.id, amount: captured.amount, method: captured.method }))
        n++
      }
    } catch (err) {
      logger.error({ err, orderId: o.id }, 'payment reconciliation failed for order')
    }
  }
  return n
}
