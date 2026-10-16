// Background loop, every 60 seconds. pg_try_advisory_lock makes sure only one
// instance runs it per tick. Order matters: payments are reconciled before
// the hold sweeper, so a paid order is never cancelled for non-payment.
import { addDays, todayIST } from './clock.js'
import { getConfig, loadConfig } from './config.js'
import { pool, query, tx } from './db.js'
import { auditLedger } from './inventory.js'
import { logger } from './logger.js'
import { metrics } from './metrics.js'
import { OPEN_STATUSES, rebalanceOrder, SYSTEM, sweepExpiredHolds, takeBatchOutOfService } from './orders.js'
import { sendDueNotifications } from './notify.js'
import { processDueRefunds, reconcilePendingPayments } from './payments.js'
import { now } from './clock.js'

const MAINTENANCE_LOCK = 427714202
const TICK_MS = 60_000
const HOURLY_MS = 3_600_000

let timer = null
let rebalanceRequested = false
let lastFullRebalance = 0
let lastAudit = 0

/** Asks the next tick to re-check every open order (after a rules change). */
export function triggerRebalanceAll() {
  rebalanceRequested = true
}

async function step(name, fn) {
  try {
    return await fn()
  } catch (err) {
    metrics.maintenanceErrors.inc({ step: name })
    logger.error({ err, step: name }, 'maintenance step failed')
    return null
  }
}

export async function cleanupExpired(at = now()) {
  const day = 86_400_000
  await query('DELETE FROM otps WHERE expires_at < $1', [new Date(at.getTime() - HOURLY_MS)])
  await query('DELETE FROM quotes WHERE expires_at < $1', [at])
  await query('DELETE FROM idempotency_keys WHERE created_at < $1', [new Date(at.getTime() - 7 * day)])
  await query('DELETE FROM processed_webhooks WHERE created_at < $1', [new Date(at.getTime() - 30 * day)])
  await query('DELETE FROM wa_inbound WHERE received_at < $1', [new Date(at.getTime() - 7 * day)])
  await query('DELETE FROM refresh_sessions WHERE expires_at < $1', [new Date(at.getTime() - day)])
}

/** Batches at the retirement age leave the storefront (status EXHAUSTED). */
export async function retireBatches() {
  const cutoff = addDays(todayIST(), -getConfig().retireAge)
  const { rows } = await query(`SELECT id FROM batches WHERE status NOT IN ('EXHAUSTED', 'CONDEMNED') AND plucked_on <= $1`, [cutoff])
  for (const { id } of rows) {
    await tx(async (c) => {
      const { rows: b } = await c.query('SELECT status FROM batches WHERE id = $1 FOR UPDATE', [id])
      if (['EXHAUSTED', 'CONDEMNED'].includes(b[0].status)) return
      await c.query(`UPDATE batches SET status = 'EXHAUSTED' WHERE id = $1`, [id])
      const r = await takeBatchOutOfService(c, id, 'EXHAUSTED', SYSTEM)
      logger.info({ batchId: id, ...r }, 'batch retired at age limit')
    })
  }
  return rows.length
}

export async function rebalanceAllOpen() {
  const { rows } = await query(
    `SELECT id FROM orders o WHERE status = ANY($1)
        AND (at_risk OR EXISTS (SELECT 1 FROM order_stock s WHERE s.order_id = o.id AND s.state IN ('held', 'committed', 'packed')))
      ORDER BY placed_at`,
    [OPEN_STATUSES],
  )
  let touched = 0
  for (const { id } of rows) {
    const r = await step('rebalance', () => tx((c) => rebalanceOrder(c, id, SYSTEM)))
    if (r?.changed) touched++
  }
  return touched
}

export async function runAudit() {
  const drift = await tx((c) => auditLedger(c))
  metrics.ledgerDrift.set(drift.length)
  if (drift.length) logger.error({ drift: drift.slice(0, 20) }, 'ledger audit: counters disagree with their sources')
  return drift
}

/** One maintenance tick. Returns { skipped: true } when another instance holds the lock. */
export async function runMaintenance({ forceAll = false } = {}) {
  await step('config', loadConfig) // every instance keeps its rules fresh
  const client = await pool.connect()
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [MAINTENANCE_LOCK])
    if (!rows[0].ok) return { skipped: true }
    try {
      const out = {}
      out.reconciled = await step('reconcile', () => reconcilePendingPayments())
      out.refunded = await step('refunds', processDueRefunds)
      out.notified = await step('notifications', () => sendDueNotifications())
      out.expired = await step('sweep', () => tx((c) => sweepExpiredHolds(c)))
      if (out.expired) metrics.holdsExpired.inc(out.expired)
      await step('cleanup', () => cleanupExpired())
      out.retired = await step('retire', retireBatches)
      const t = Date.now()
      if (forceAll || rebalanceRequested || t - lastFullRebalance > HOURLY_MS) {
        rebalanceRequested = false
        lastFullRebalance = t
        out.rebalanced = await rebalanceAllOpen()
      }
      if (forceAll || t - lastAudit > HOURLY_MS) {
        lastAudit = t
        out.drift = (await step('audit', runAudit))?.length ?? null
      }
      const risk = await query(`SELECT COUNT(*)::int AS n FROM orders WHERE at_risk AND status = ANY($1)`, [OPEN_STATUSES])
      metrics.ordersAtRisk.set(risk.rows[0].n)
      return out
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MAINTENANCE_LOCK]).catch(() => {})
    }
  } finally {
    client.release()
  }
}

export function startMaintenance() {
  if (timer) return
  timer = setInterval(() => {
    runMaintenance().catch((err) => logger.error({ err }, 'maintenance tick failed'))
  }, TICK_MS)
  timer.unref()
}

export function stopMaintenance() {
  clearInterval(timer)
  timer = null
}
