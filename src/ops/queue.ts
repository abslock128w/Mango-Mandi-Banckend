// The Attention queue (docs/design/ops-dashboard-v2.md §2): every problem that needs a person,
// ranked. Each entry has a severity (Now, Soon, Watch), the role that owns it, how old it is, one
// primary action and a place to open it. Built from the Needs attention report, the summary's
// overdue and at-risk orders, and the v2 signals the operating day and the live board give
// (slots about to miss their pack-by with unpacked orders, stops with no rider near dispatch,
// riders silent while out, stops past their window). Pure, unit-tested (tests/unit/ops-queue.unit.ts).
import type { Attention, Summary } from '../types'
import type { DayPlan, LiveBoard } from './types'
import { SILENT_AFTER_MIN, ago, clock, minutesSince } from './time.ts'

export type Severity = 'now' | 'soon' | 'watch'
export type Owner = 'MANAGER' | 'OPERATOR' | 'PACKER'

export const SEVERITY_LABEL: Record<Severity, string> = { now: 'Now', soon: 'Soon', watch: 'Watch' }
export const OWNER_LABEL: Record<Owner, string> = { MANAGER: 'Manager', OPERATOR: 'Operator', PACKER: 'Packer' }
const RANK: Record<Severity, number> = { now: 0, soon: 1, watch: 2 }

export interface QueueLink {
  label: string
  to: string
}

export interface QueueEntry {
  /** Stable across refreshes, so a snooze sticks to the same problem. */
  id: string
  severity: Severity
  title: string
  why: string
  /** When the problem started, if known (the age shown beside it). */
  since: string | null
  owner: Owner
  action: QueueLink
  open?: QueueLink
}

export interface QueueInput {
  attention?: Attention | null
  summary?: Summary | null
  day?: DayPlan | null
  live?: LiveBoard | null
  nowMs: number
}

/** How long before pack-by an unpacked slot turns up as "Soon". */
export const PACK_WARN_MIN = 30

/** The fix for a Needs attention item is its playbook on Today, under the queue. */
const playbook = (key: string): QueueLink => ({ label: 'Fix', to: `/today#attention-${key}` })
const order = (id: string, label = 'Open order'): QueueLink => ({ label, to: `/orders/${id}` })
const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

export function buildQueue({ attention: a, summary: s, day, live, nowMs }: QueueInput): QueueEntry[] {
  const out: QueueEntry[] = []
  const seen = new Set<string>()
  const add = (e: QueueEntry) => {
    if (seen.has(e.id)) return
    seen.add(e.id)
    out.push(e)
  }

  if (a) {
    if (a.loop.stale) {
      add({ id: 'loop-stale', severity: 'now', title: 'Background run stopped', why: `Messages, refunds and stock checks wait until it runs again${a.loop.lastRunAt ? `; last ran ${ago(nowMs, a.loop.lastRunAt)}` : ''}.`, since: a.loop.lastRunAt, owner: 'MANAGER', action: playbook('loop') })
    }
    if (a.backup?.stale) add({ id: 'backup-stale', severity: 'now', title: 'Nightly backup missed', why: a.backup.lastOkAt ? `Last good backup ${ago(nowMs, a.backup.lastOkAt)}.` : 'No backup has worked yet.', since: a.backup.lastOkAt, owner: 'MANAGER', action: playbook('loop') })
    for (const f of a.loop.failingSteps) {
      add({ id: `step-${f.step}`, severity: 'now', title: 'A background step is failing', why: f.error ? `${f.step}: ${f.error}` : f.step, since: f.since, owner: 'MANAGER', action: playbook('loop') })
    }
    for (const r of a.stuckRefunds) {
      const manager = r.state === 'needs_manager'
      add({ id: `refund-${r.type}-${r.id}`, severity: manager ? 'now' : 'soon', title: `Refund not sent · ${r.number}`, why: r.state === 'held' ? 'Held while a chargeback on the payment is open.' : manager ? `Failed ${r.attempts ?? 'several'} times: a manager decides.` : 'Still retrying on its own.', since: r.requestedAt, owner: 'MANAGER', action: playbook('refunds'), ...(r.type === 'order' ? { open: order(r.id) } : {}) })
    }
    for (const d of a.disputes ?? []) {
      add({ id: `dispute-${d.id}`, severity: 'now', title: `Payment disputed${d.order ? ` · ${d.order.number}` : ''}`, why: d.respondBy ? `Answer in the Razorpay dashboard by ${clock(d.respondBy)} on its day.` : 'Answer it in the Razorpay dashboard, under Disputes.', since: d.createdAt, owner: 'MANAGER', action: playbook('disputes'), ...(d.order ? { open: order(d.order.id) } : {}) })
    }
    for (const o of a.retryDecisions ?? []) {
      add({ id: `retry-${o.id}`, severity: 'soon', title: `Missed delivery needs a decision · ${o.number}`, why: o.reason ?? 'The retry cannot go out as packed.', since: null, owner: 'MANAGER', action: order(o.id, 'Decide'), open: playbook('retry') })
    }
    for (const o of a.failedDeliveries ?? []) {
      add({ id: `calls-${o.id}`, severity: 'soon', title: `Call the customer · ${o.number}`, why: `Missed ${n(o.attempts, 'time', 'times')}: check the address before it goes out again.`, since: null, owner: 'OPERATOR', action: order(o.id, 'Call'), open: playbook('calls') })
    }
    for (const w of a.webhookFailures) {
      add({ id: `webhook-${w.id}`, severity: 'soon', title: `${w.source === 'razorpay' ? 'Razorpay' : 'WhatsApp'} webhook problem`, why: w.reason, since: w.createdAt, owner: 'MANAGER', action: playbook('webhooks') })
    }
    for (const m of a.failedMessages) {
      add({ id: `message-${m.id}`, severity: 'soon', title: `WhatsApp message ${m.status === 'SKIPPED' ? 'never sent' : 'not delivered'}${m.order ? ` · ${m.order.number}` : m.preorderNumber ? ` · ${m.preorderNumber}` : ''}`, why: m.error ?? `After ${n(m.attempts, 'try', 'tries')}.`, since: m.createdAt, owner: 'OPERATOR', action: playbook('messages'), ...(m.order ? { open: order(m.order.id) } : {}) })
    }
    for (const d of a.ledgerDrift ?? []) add({ id: `drift-${d.lineId}`, severity: 'soon', title: `Stock counts disagree · ${d.sku}`, why: 'The counters and the stock ledger do not match.', since: null, owner: 'MANAGER', action: playbook('drift'), open: { label: 'Open batch', to: `/batches/${d.batchId}` } })
    for (const b of a.boxMismatches ?? []) add({ id: `boxes-${b.warehouseId}`, severity: 'soon', title: `Labelled boxes disagree · ${b.name}`, why: 'The hourly box check found differences.', since: null, owner: 'MANAGER', action: playbook('drift') })
    for (const l of a.lateArrivals ?? []) add({ id: `late-${l.id}`, severity: l.sellingPaused ? 'soon' : 'watch', title: `Batch late · ${l.variety}`, why: `Due ${l.etaDate}${l.farm ? ` from ${l.farm}` : ''}; ${n(l.promised, 'box', 'boxes')} promised${l.sellingPaused ? ', no longer selling' : ''}.`, since: null, owner: 'OPERATOR', action: { label: 'Open batch', to: `/batches/${l.id}` } })
    for (const p of a.preorderCapacityDrift ?? []) add({ id: `pcap-${p.sku}-${p.weekStart}`, severity: 'watch', title: `Preorder capacity off · ${p.sku}`, why: `${p.reserved} reserved against ${p.booked} booked for the week of ${p.weekStart}.`, since: null, owner: 'MANAGER', action: playbook('drift') })
    for (const p of a.preorderDecisions ?? []) add({ id: `pre-${p.id}`, severity: 'watch', title: `Preorder for a manager · ${p.number}`, why: p.reason, since: null, owner: 'MANAGER', action: playbook('preorders') })
    for (const r of a.returnedStock ?? []) add({ id: `returned-${r.id}`, severity: 'watch', title: `Returned boxes to book · ${r.number}`, why: `${n(r.boxes, 'box', 'boxes')} to put back or write off.`, since: null, owner: 'OPERATOR', action: order(r.id, 'Book boxes'), open: playbook('returned') })
    for (const d of a.photoDeliveries ?? []) add({ id: `photo-${d.id}`, severity: 'watch', title: `${d.method === 'staff' ? 'Delivered without proof' : 'Photo delivery to check'} · ${d.order.number}`, why: d.receivedBy ? `Left with ${d.receivedBy}.` : 'Someone other than the rider checks it.', since: d.at, owner: 'MANAGER', action: playbook(d.method === 'staff' ? 'no-proof' : 'photos'), open: order(d.order.id) })
    for (const m of a.failedPushes ?? []) add({ id: `push-${m.id}`, severity: 'watch', title: 'Browser notification not delivered', why: m.error ?? `After ${n(m.attempts, 'try', 'tries')}.`, since: m.createdAt, owner: 'OPERATOR', action: playbook('push') })
    const low = a.lowRatings ?? []
    if (low.length) add({ id: `low-${low.map((r) => r.id).join('-')}`, severity: 'watch', title: `${n(low.length, 'new low rating', 'new low ratings')}`, why: `1 or 2 stars on ${low.map((r) => r.order.number).join(', ')}.`, since: low[0].createdAt, owner: 'OPERATOR', action: { label: 'Read them', to: '/reviews' } })
  }

  // Overdue orders come in both reports; the attention one wins (same ids).
  for (const o of [...(a?.overdueOrders ?? []), ...(s?.overdueOrders ?? [])]) {
    add({ id: `overdue-${o.id}`, severity: 'now', title: `Overdue · ${o.number}`, why: o.reason, since: o.outSince, owner: 'OPERATOR', action: order(o.id, 'Find it'), open: playbook('overdue') })
  }
  for (const o of s?.atRiskOrders ?? []) {
    add({ id: `risk-${o.id}`, severity: 'now', title: `Order at risk · ${o.number}`, why: o.reason ?? 'Its stock went bad or ran out: it needs a new date or new stock.', since: null, owner: 'OPERATOR', action: order(o.id, 'Rebalance') })
  }

  // v2: the clock. Only today's slots that have not ended.
  if (day) {
    for (const sl of day.slots) {
      const end = new Date(sl.windowEndAt).getTime()
      if (nowMs >= end) continue
      const packBy = new Date(sl.packByAt).getTime()
      const toPackBy = (packBy - nowMs) / 60_000
      if (sl.counts.waiting > 0 && toPackBy <= PACK_WARN_MIN) {
        const late = toPackBy < 0
        add({
          id: `slot-pack-${day.date}-${sl.id}`,
          severity: late ? 'now' : 'soon',
          title: `${sl.label}: ${n(sl.counts.waiting, 'order', 'orders')} not packed`,
          why: `${late ? 'Pack-by was' : 'Pack by'} ${clock(sl.packByAt)} · dispatch by ${clock(sl.dispatchByAt)} · window ${sl.startsAt}–${sl.endsAt}.`,
          since: late ? sl.packByAt : null,
          owner: 'PACKER',
          action: { label: 'Open pack list', to: `/pack-list?date=${day.date}` },
        })
      }
      const toDispatch = (new Date(sl.dispatchByAt).getTime() - nowMs) / 60_000
      if (sl.unassigned > 0 && toDispatch <= PACK_WARN_MIN) {
        add({
          id: `slot-riders-${day.date}-${sl.id}`,
          severity: toDispatch < 0 ? 'now' : 'soon',
          title: `${sl.label}: ${n(sl.unassigned, 'stop has', 'stops have')} no rider`,
          why: `Dispatch by ${clock(sl.dispatchByAt)}.`,
          since: toDispatch < 0 ? sl.dispatchByAt : null,
          owner: 'OPERATOR',
          action: { label: 'Assign riders', to: `/deliveries?date=${day.date}&tab=unassigned` },
        })
      }
    }
  }
  if (live) {
    for (const r of live.riders) {
      if (r.stopsLeft === 0) continue
      const silent = minutesSince(nowMs, r.lastAt)
      if (silent < SILENT_AFTER_MIN) continue
      add({
        id: `silent-${live.date}-${r.id}`,
        severity: 'soon',
        title: `Rider silent · ${r.name}`,
        why: `${r.lastAt ? `Last position ${ago(nowMs, r.lastAt)}` : 'No position yet'}, with ${n(r.stopsLeft, 'stop', 'stops')} left.`,
        since: r.lastAt,
        owner: 'OPERATOR',
        action: { label: 'Open dispatch', to: `/deliveries?date=${live.date}&tab=riders` },
      })
    }
    for (const st of live.stops) {
      if (st.status !== 'OUT_FOR_DELIVERY' || !st.dueAt || nowMs <= new Date(st.dueAt).getTime()) continue
      add({ id: `late-stop-${st.orderId}`, severity: 'now', title: `Past its window · ${st.number}`, why: `Due by ${clock(st.dueAt)}${st.area ? ` in ${st.area}` : ''}; still out for delivery.`, since: st.dueAt, owner: 'OPERATOR', action: order(st.orderId, 'Find it') })
    }
  }

  return out.sort((x, y) => RANK[x.severity] - RANK[y.severity] || (x.since ? new Date(x.since).getTime() : nowMs) - (y.since ? new Date(y.since).getTime() : nowMs))
}

/** Entries not snoozed (snoozes: id → until, epoch ms). */
export function visible(entries: QueueEntry[], snoozes: Record<string, number>, nowMs: number) {
  return entries.filter((e) => !(snoozes[e.id] > nowMs))
}
