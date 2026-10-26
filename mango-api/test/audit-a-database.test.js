// 24 Oct 2026 audit, database leftovers (docs/audit-2026-10-24-status-A.md).
// Each test failed on the code before its fix.
import { closeAll, makeBatch, resetDb } from './helpers.js'
import assert from 'node:assert/strict'
import { after, beforeEach, describe, test } from 'node:test'
import pg from 'pg'
import { now } from '../src/clock.js'
import { afterCommit, query, resetRetryReportsForTests, tx } from '../src/db.js'
import { earliestDeliveryDate } from '../src/delivery.js'
import { auditLedger } from '../src/inventory.js'
import { metrics } from '../src/metrics.js'
import { createOrder, processPayment, sweepExpiredHoldsEach, SYSTEM } from '../src/orders.js'
import { onProblemForTests } from '../src/sentry.js'

after(closeAll)
beforeEach(resetDb)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const TWO_SKUS = [
  { sku: 'ALP-3', stage: 'RIPE', qty: 1, unitPrice: 100 },
  { sku: 'BAD-3', stage: 'RIPE', qty: 1, unitPrice: 100 },
]

const newOrder = (c, date) =>
  createOrder(c, {
    deliveryDate: date, status: 'PAYMENT_PENDING', paymentStatus: 'INITIATED', allOrNothing: true,
    holdExpiresAt: new Date(now().getTime() + 600_000), pincode: '560034', address: 'test address 1234', lines: TWO_SKUS,
  }, SYSTEM)

async function makeOrder() {
  return tx(async (c) => {
    const o = await newOrder(c, await earliestDeliveryDate(c))
    const { rows } = await c.query('SELECT sku FROM order_stock WHERE order_id = $1 ORDER BY id', [o.id])
    return { id: o.id, first: rows[0].sku }
  })
}

/** Two unpaid 2-SKU orders whose order_stock rows (random ids) come in opposite SKU order: the pair that deadlocked. */
async function oppositePair() {
  const byFirst = { 'ALP-3': [], 'BAD-3': [] }
  while (!byFirst['ALP-3'].length || !byFirst['BAD-3'].length) {
    const o = await makeOrder()
    byFirst[o.first].push(o.id)
  }
  return [byFirst['ALP-3'][0], byFirst['BAD-3'][0]]
}

/**
 * processPayment with no retry, pausing 300 ms after its first batch_lines
 * change so the other transaction can take its first line meanwhile.
 */
const pay = (orderId, outcome = 'captured') =>
  tx(async (c) => {
    let paused = false
    const slow = {
      query: async (text, params) => {
        const r = await c.query(text, params)
        if (!paused && /^UPDATE batch_lines SET held = held -/.test(text)) {
          paused = true
          await sleep(300)
        }
        return r
      },
    }
    return (await processPayment(slow, { orderId, outcome, paymentId: `pay_${orderId}`, amount: 200 })).result
  }, { retries: 0 })

const deadlocks = async () => (await metrics.dbRetries.get()).values.filter((v) => v.labels.code === '40P01').reduce((s, v) => s + v.value, 0)

describe('DB-01: one lock order for batch lines', () => {
  beforeEach(async () => {
    await makeBatch({ variety: 'Alphonso', age: 4, rating: 'RIPE', lines: { 'ALP-3': 50 } })
    await makeBatch({ variety: 'Badami', age: 4, rating: 'RIPE', lines: { 'BAD-3': 50 } })
  })

  test('two payments for orders sharing two lines both confirm, with no retry', async () => {
    const [a, b] = await oppositePair()
    const before = await deadlocks()
    const out = await Promise.allSettled([pay(a), pay(b)])
    assert.deepEqual(out.map((r) => r.value ?? r.reason?.code), ['confirmed', 'confirmed'])
    assert.equal(await deadlocks(), before)
  })

  test('a payment and a cancel on orders sharing two lines both finish, with no retry', async () => {
    const [a, b] = await oppositePair()
    const out = await Promise.allSettled([pay(a), pay(b, 'abandoned')])
    assert.deepEqual(out.map((r) => r.value ?? r.reason?.code), ['confirmed', 'cancelled'])
  })

  test('a late payment takes the day before the lines, so a checkout for that day waits instead of deadlocking', async () => {
    const date = await tx((c) => earliestDeliveryDate(c))
    await query(
      `INSERT INTO delivery_calendar (date, is_open, max_boxes) VALUES ($1, TRUE, 1000)
       ON CONFLICT (date) DO UPDATE SET is_open = TRUE, max_boxes = 1000`,
      [date],
    )
    const { id } = await makeOrder()
    // The hold ran out a minute ago, and the sweep hasn't cancelled it yet.
    await query('UPDATE orders SET hold_expires_at = $2 WHERE id = $1', [id, new Date(now().getTime() - 60_000)])
    const paying = pay(id)
    await sleep(100)
    const buying = tx(async (c) => (await newOrder(c, date)).id, { retries: 0 })
    const out = await Promise.allSettled([paying, buying])
    assert.equal(out[0].value, 'confirmed', String(out[0].reason?.code ?? out[0].reason))
    assert.equal(out[1].status, 'fulfilled', String(out[1].reason?.code ?? out[1].reason))
  })
})

describe('DB-02: the scheduled sweep cancels each expired hold in its own transaction', () => {
  test('30 expired 2-SKU holds: every one cancelled, no transaction longer than 50 statements', async () => {
    await makeBatch({ variety: 'Alphonso', age: 4, rating: 'RIPE', lines: { 'ALP-3': 100 } })
    await makeBatch({ variety: 'Badami', age: 4, rating: 'RIPE', lines: { 'BAD-3': 100 } })
    const ids = []
    for (let i = 0; i < 30; i++) ids.push((await makeOrder()).id)
    await query('UPDATE orders SET hold_expires_at = $2 WHERE id = ANY($1)', [ids, new Date(now().getTime() - 60_000)])

    const open = new Map()
    let longest = 0
    const orig = pg.Client.prototype.query
    pg.Client.prototype.query = function (text, ...rest) {
      const sql = typeof text === 'string' ? text : text?.text
      if (sql === 'BEGIN') open.set(this, 0)
      else if (sql === 'COMMIT' || sql === 'ROLLBACK') {
        longest = Math.max(longest, open.get(this) ?? 0)
        open.delete(this)
      } else if (open.has(this)) open.set(this, open.get(this) + 1)
      return orig.call(this, text, ...rest)
    }
    let n
    try {
      n = await sweepExpiredHoldsEach()
    } finally {
      pg.Client.prototype.query = orig
    }
    assert.equal(n, 30)
    const { rows } = await query(`SELECT count(*)::int AS n FROM orders WHERE id = ANY($1) AND status = 'CANCELLED'`, [ids])
    assert.equal(rows[0].n, 30)
    assert.ok(longest > 0 && longest <= 50, `longest transaction: ${longest} statements`)
    assert.deepEqual(await tx((c) => auditLedger(c)), [])
  })

  test('an order that cannot be cancelled is flagged and the rest still go', async () => {
    await makeBatch({ variety: 'Alphonso', age: 4, rating: 'RIPE', lines: { 'ALP-3': 20 } })
    await makeBatch({ variety: 'Badami', age: 4, rating: 'RIPE', lines: { 'BAD-3': 20 } })
    const ids = [(await makeOrder()).id, (await makeOrder()).id]
    await query('UPDATE orders SET hold_expires_at = $2 WHERE id = ANY($1)', [ids, new Date(now().getTime() - 60_000)])
    // Both hold a box on the one ALP-3 line; the counter says 1, so only one release fits.
    const { rows: s } = await query(`SELECT line_id FROM order_stock WHERE order_id = $1 AND sku = 'ALP-3'`, [ids[0]])
    await query('UPDATE batch_lines SET held = 1 WHERE id = $1', [s[0].line_id])
    assert.equal(await sweepExpiredHoldsEach(), 1)
    const { rows } = await query('SELECT status, at_risk, at_risk_reason FROM orders WHERE id = ANY($1) ORDER BY status', [ids])
    assert.deepEqual(rows.map((r) => r.status), ['CANCELLED', 'PAYMENT_PENDING'])
    assert.equal(rows[1].at_risk, true)
    assert.match(rows[1].at_risk_reason, /could not be cancelled/)
  })
})

describe('DB-03: the ledger audit reads an index', () => {
  test('auditLedger uses batch_ledger_audit_idx', async () => {
    await makeBatch({ variety: 'Alphonso', age: 4, rating: 'RIPE', lines: { 'ALP-3': 10 } })
    const plan = await tx(async (c) => {
      await c.query('SET LOCAL enable_seqscan = off')
      let text = ''
      await auditLedger({
        query: async (sql, params) => {
          const r = await c.query(`EXPLAIN ${sql}`, params)
          text = r.rows.map((x) => x['QUERY PLAN']).join('\n')
          return { rows: [] }
        },
      })
      return text
    })
    assert.match(plan, /batch_ledger_audit_idx/)
  })
})

describe('DB-05: retries are reported, and counters count commits', () => {
  /** Two transactions that lock two products in opposite orders: one deadlocks and is retried. */
  async function race(counter) {
    const one = (first, second) =>
      tx(async (c) => {
        await c.query('SELECT sku FROM products WHERE sku = $1 FOR UPDATE', [first])
        await sleep(200)
        await c.query('SELECT sku FROM products WHERE sku = $1 FOR UPDATE', [second])
        afterCommit(c, () => counter.n++)
      }, { retries: 1 })
    await Promise.all([one('ALP-3', 'BAD-3'), one('BAD-3', 'ALP-3')])
  }

  test('the first deadlock retry in an hour goes to Sentry; an after-commit counter counts once per commit', async () => {
    resetRetryReportsForTests()
    const seen = []
    onProblemForTests((message, context) => seen.push({ message, context }))
    try {
      const before = await deadlocks()
      const counter = { n: 0 }
      await race(counter)
      assert.equal((await deadlocks()) - before, 1, 'one transaction was retried')
      assert.equal(counter.n, 2, 'two commits, two counts; the rolled-back attempt counts nothing')
      assert.equal(seen.length, 1)
      assert.match(seen[0].message, /retried after a deadlock \(40P01\)/)
      assert.deepEqual(seen[0].context, { sqlState: '40P01', attempt: 1 })
      await race(counter)
      assert.equal(seen.length, 1, 'once per hour per SQL state')
    } finally {
      onProblemForTests(null)
    }
  })

  test('afterCommit never runs for a transaction that rolls back', async () => {
    let ran = 0
    await assert.rejects(
      tx(async (c) => {
        afterCommit(c, () => ran++)
        throw new Error('boom')
      }),
      /boom/,
    )
    assert.equal(ran, 0)
    await tx(async (c) => afterCommit(c, () => ran++))
    assert.equal(ran, 1)
  })
})

describe('DB-07: money and refund states have database backstops', () => {
  test('a negative total or an unknown refund state is refused', async () => {
    await makeBatch({ variety: 'Alphonso', age: 4, rating: 'RIPE', lines: { 'ALP-3': 10 } })
    await makeBatch({ variety: 'Badami', age: 4, rating: 'RIPE', lines: { 'BAD-3': 10 } })
    const { id } = await makeOrder()
    await assert.rejects(query('UPDATE orders SET total = -1 WHERE id = $1', [id]), /orders_money_not_negative/)
    await assert.rejects(query('UPDATE orders SET payment_amount = -100 WHERE id = $1', [id]), /orders_money_not_negative/)
    await assert.rejects(query(`UPDATE orders SET refund_status = 'sent' WHERE id = $1`, [id]), /orders_refund_status_known/)
    for (const s of ['pending', 'processed', 'failed', 'manual']) {
      await query('UPDATE orders SET refund_status = $2 WHERE id = $1', [id, s])
    }
  })
})

describe('DB-08: cleanup columns and foreign keys are indexed', () => {
  test('every index from 038 exists', async () => {
    const want = [
      'idempotency_keys_created_idx', 'processed_webhooks_created_idx', 'quotes_expires_idx', 'otps_expires_idx', 'claims_order_idx',
      'claims_replacement_order_idx', 'orders_replacement_for_idx', 'orders_preorder_idx', 'notifications_stock_alert_idx',
      'order_ratings_customer_idx', 'claim_photos_customer_idx',
    ]
    const { rows } = await query('SELECT indexname FROM pg_indexes WHERE indexname = ANY($1)', [want])
    assert.deepEqual(rows.map((r) => r.indexname).sort(), [...want].sort())
  })
})
