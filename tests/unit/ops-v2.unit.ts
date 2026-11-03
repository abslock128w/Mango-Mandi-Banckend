import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ago, dueOf, freshness, slotPhase, span, tomorrowStartIST } from '../../src/ops/time.ts'
import { buildQueue, visible } from '../../src/ops/queue.ts'
import { backoffMs, createSseParser } from '../../src/shell/sse.ts'
import type { DayPlan, LiveBoard } from '../../src/ops/types.ts'
import type { Attention } from '../../src/types.ts'

// Mango Ops v2 (docs/design/ops-dashboard-v2.md): the day's clock, the Attention queue and the
// event stream's parser, without a browser.

const T = (hhmm: string, day = '2026-10-16') => new Date(`${day}T${hhmm}:00+05:30`).getTime()
const iso = (hhmm: string, day = '2026-10-16') => new Date(T(hhmm, day)).toISOString()

test('due in, late by, due now', () => {
  assert.equal(span(38), '38 min')
  assert.equal(span(125), '2 h 5 min')
  assert.deepEqual(dueOf(T('06:00'), iso('06:38'))?.text, 'due in 38 min')
  assert.deepEqual(dueOf(T('06:12'), iso('06:00')), { text: 'late by 12 min', late: true, minutes: -12 })
  assert.equal(dueOf(T('06:00'), iso('06:00'))?.text, 'due now')
  assert.equal(dueOf(T('06:00'), null), null)
  assert.equal(ago(T('06:04'), iso('06:00')), '4 min ago')
})

test('a rider is fresh under 5 minutes, stale under 30, then old', () => {
  assert.equal(freshness(T('06:04'), iso('06:00')), 'fresh')
  assert.equal(freshness(T('06:20'), iso('06:00')), 'stale')
  assert.equal(freshness(T('06:45'), iso('06:00')), 'old')
  assert.equal(freshness(T('06:45'), null), 'none')
})

test('a slot faces its cutoff, then pack-by, dispatch-by and the window end', () => {
  const s = { orderCutoffAt: iso('18:00', '2026-10-15'), packByAt: iso('06:00'), dispatchByAt: iso('06:45'), windowStartAt: iso('07:00'), windowEndAt: iso('11:00') }
  assert.equal(slotPhase(T('17:00', '2026-10-15'), s).nextLabel, 'Order cutoff')
  assert.equal(slotPhase(T('05:00'), s).nextLabel, 'Pack by')
  assert.equal(slotPhase(T('06:30'), s).nextLabel, 'Dispatch by')
  assert.equal(slotPhase(T('08:00'), s).nextLabel, 'Window ends')
  assert.equal(slotPhase(T('11:30'), s).phase, 'over')
})

test('a snooze until tomorrow ends at midnight IST', () => {
  assert.equal(tomorrowStartIST(T('22:30')), T('00:00', '2026-10-17'))
})

const day = (waiting: number, unassigned: number): DayPlan => ({
  date: '2026-10-16', now: iso('05:40'), rules: { packLeadMinutes: 60, dispatchLeadMinutes: 15, orderCutoff: null },
  slots: [{ id: 'slt1', label: 'Morning', startsAt: '07:00', endsAt: '11:00', capacityBoxes: 40, windowStartAt: iso('07:00'), windowEndAt: iso('11:00'), packByAt: iso('06:00'), dispatchByAt: iso('06:45'), orderCutoffAt: null, counts: { waiting, packed: 2, out: 0, delivered: 0, failed: 0 }, orders: waiting + 2, boxes: 4, unassigned }],
  unslotted: null,
})

test('the queue ranks Now before Soon before Watch, and the clock adds slot signals', () => {
  const attention = {
    loop: { lastRunAt: iso('05:00'), stale: true, failingSteps: [] },
    failedMessages: [], stuckRefunds: [], webhookFailures: [],
    lowRatings: [{ id: 'r1', rating: 1, comment: null, sku: 'ALP-3', productName: 'Alphonso', createdAt: iso('04:00'), order: { id: 'o9', number: 'ORD-9' } }],
    failedDeliveries: [{ id: 'o2', number: 'ORD-1043', name: null, phone: null, attempts: 2 }],
  } as unknown as Attention
  const q = buildQueue({ attention, day: day(3, 0), nowMs: T('05:40') })
  assert.deepEqual(q.map((e) => e.severity), ['now', 'soon', 'soon', 'watch'])
  const pack = q.find((e) => e.id.startsWith('slot-pack'))!
  assert.equal(pack.title, 'Morning: 3 orders not packed')
  assert.equal(pack.owner, 'PACKER')
  assert.equal(pack.action.to, '/pack-list?date=2026-10-16')
  // Past pack-by it is Now; nothing to pack, nothing to say.
  assert.equal(buildQueue({ day: day(3, 0), nowMs: T('06:10') })[0].severity, 'now')
  assert.equal(buildQueue({ day: day(0, 0), nowMs: T('06:10') }).length, 0)
  // Hours before pack-by the slot is not news yet.
  assert.equal(buildQueue({ day: day(3, 0), nowMs: T('03:00') }).length, 0)
})

test('a silent rider with stops left and a stop past its window are flagged; snoozed ones hide', () => {
  const live: LiveBoard = {
    date: '2026-10-16', now: iso('11:40'), warehouses: [],
    riders: [
      { id: 'r1', name: 'Ravi', email: 'r@x', lastAt: iso('11:00'), lat: 1, lng: 1, accuracy: null, stopsLeft: 2, stopsDone: 1 },
      { id: 'r2', name: 'Idle', email: 'i@x', lastAt: null, lat: null, lng: null, accuracy: null, stopsLeft: 0, stopsDone: 0 },
    ],
    stops: [{ orderId: 'o1', number: 'ORD-1042', status: 'OUT_FOR_DELIVERY', slotId: 'slt1', pincode: '400001', area: 'South', lat: 1, lng: 1, riderId: 'r1', boxes: 1, customerName: null, windowStartAt: iso('07:00'), dueAt: iso('11:00'), pickupWarehouseId: null }],
  }
  const q = buildQueue({ live, nowMs: T('11:40') })
  assert.deepEqual(q.map((e) => e.title), ['Past its window · ORD-1042', 'Rider silent · Ravi'])
  assert.equal(visible(q, { [q[0].id]: T('23:59') }, T('11:40')).length, 1)
  assert.equal(visible(q, { [q[0].id]: T('11:00') }, T('11:40')).length, 2)
})

test('the SSE parser joins chunks, reads event, data and id, and skips comments', () => {
  const push = createSseParser()
  assert.deepEqual(push(': hi\n\nevent: hello\nda'), [])
  assert.deepEqual(push('ta: {"at":"x"}\nid: 7\n\nevent: order.changed\r\ndata: {"id":"o1"}\r\n\r\n'), [
    { event: 'hello', data: '{"at":"x"}', id: '7' },
    { event: 'order.changed', data: '{"id":"o1"}', id: null },
  ])
})

test('reconnects back off to 30 s at most', () => {
  assert.equal(backoffMs(1, 0.5), 1000)
  assert.equal(backoffMs(3, 0.5), 4000)
  assert.equal(backoffMs(20, 0.5), 30_000)
})
