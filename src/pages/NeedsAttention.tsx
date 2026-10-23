import { Link } from 'react-router-dom'
import { useId, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { NOTIFICATION_LABEL, dateTime, humanize, rupees } from '../format'
import type { NotificationKind, PhotoDelivery } from '../types'
import { PhoneLink, QueryError, ReasonDialog, useToast } from '../ui'

const STEP_LABEL: Record<string, string> = {
  reconcile: 'Checking missed payments',
  refunds: 'Sending refunds',
  'duplicate-payments': 'Refunding second payments',
  preorders: 'Preorder jobs',
  notifications: 'Sending WhatsApp updates',
  sweep: 'Releasing unpaid holds',
  cleanup: 'Clean-up',
  retire: 'Retiring old batches',
  'rebalance-all': 'Re-checking all open orders',
  'rebalance-at-risk': 'Re-checking at-risk orders',
  audit: 'Stock audit',
  config: 'Loading rules',
  'review-requests': 'Queueing review requests',
  'review-stats': 'Review totals check',
  backup: 'Nightly backup',
}

/** Shared with Today, which starts this query together with the summary. */
export const attentionQuery = { queryKey: ['attention'], queryFn: api.attention, refetchInterval: 60_000 } as const

/**
 * The problems nobody is watching for: the background loop stalling or failing,
 * WhatsApp messages given up on, refunds that haven't gone through, and webhooks
 * that failed or named an order we don't have. Hidden when all is well; a failed
 * load says so, with a retry.
 */
export default function NeedsAttention() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const q = useQuery(attentionQuery)
  const retry = useMutation({
    mutationFn: (id: string) => api.retryMessage(id),
    onSuccess: () => {
      toast.success('Message queued to send again')
      queryClient.invalidateQueries({ queryKey: ['attention'] })
    },
    onError: (err) => toast.error(err),
  })

  const [doubting, setDoubting] = useState<PhotoDelivery | null>(null)
  const check = useMutation({
    mutationFn: ({ d, ok, note }: { d: PhotoDelivery; ok: boolean; note?: string }) => api.reviewDelivery(d.id, ok, note),
    onSuccess: (_r, { d, ok }) => {
      toast.success(ok ? `Delivery of ${d.order.number} checked` : `${d.order.number} flagged: call the customer`)
      setDoubting(null)
      queryClient.invalidateQueries({ queryKey: ['attention'] })
    },
    onError: (err) => toast.error(err),
  })

  // FE-4: this is the only alerting surface, so a failed load must show, never look calm.
  const loadError = q.isError ? (
    <>
      <p>
        <strong>Could not load alerts.</strong> Problems that need you may be hidden until they load.
      </p>
      <QueryError error={q.error} onRetry={() => q.refetch()} />
    </>
  ) : null
  if (!q.data) {
    // A load that failed before is asked again (Retry, or every minute): keep the card meanwhile.
    if (!loadError && q.errorUpdateCount === 0) return null
    return (
      <section className="card attention" aria-labelledby="attention-title">
        <h2 id="attention-title">Needs attention</h2>
        {loadError ?? <p role="status">Loading alerts again…</p>}
      </section>
    )
  }
  const a = q.data
  const calls = a.failedDeliveries ?? []
  const low = a.lowRatings ?? []
  const photos = (a.photoDeliveries ?? []).filter((d) => d.method !== 'staff')
  const noProof = (a.photoDeliveries ?? []).filter((d) => d.method === 'staff')
  const drift = a.ledgerDrift ?? []

  const photoItem = (d: PhotoDelivery) => (
    <li key={`photo-${d.id}`}>
      <strong>{d.method === 'staff' ? 'Check a delivery marked without proof' : 'Check a photo delivery'}</strong> of{' '}
      <Link to={`/orders/${d.order.id}`}>{d.order.number}</Link> by {d.actor} at {dateTime(d.at)}
      {d.receivedBy ? <span className="muted">, left with {d.receivedBy}</span> : null}
      {d.method === 'staff' && d.note ? <span className="muted">: {d.note}</span> : null}
      {d.flags.length ? <span className="badge badge-warn"> {d.flags.join(', ')}</span> : null}{' '}
      <span className="attention-actions">
        <button type="button" className="btn btn-small" disabled={check.isPending} onClick={() => check.mutate({ d, ok: true })}>
          Looks right<span className="sr-only"> for {d.order.number}</span>
        </button>
        <button type="button" className="btn btn-small" onClick={() => setDoubting(d)}>
          Doubtful<span className="sr-only"> for {d.order.number}</span>
        </button>
      </span>
    </li>
  )

  // One group per kind of problem, most urgent first. Each shows a few items and a "Show all".
  const groups: AttentionGroup[] = [
    {
      key: 'loop',
      title: 'Background jobs',
      items: [
        ...(a.loop.stale
          ? [
              <li key="stale">
                <strong>The background loop has stopped.</strong>{' '}
                {a.loop.lastRunAt ? `It last ran at ${dateTime(a.loop.lastRunAt)}.` : 'It has not run yet.'} Payments, refunds, WhatsApp
                updates and hold releases wait until it runs again. Restart the API.
              </li>,
            ]
          : []),
        ...(a.backup?.stale
          ? [
              <li key="backup">
                <strong>No backup in the last 26 hours.</strong>{' '}
                {a.backup.lastOkAt ? `The last one finished at ${dateTime(a.backup.lastOkAt)}.` : 'No backup has been recorded yet.'} Ask
                whoever runs the server to check the backup service (deploy/README.md, Backups).
              </li>,
            ]
          : []),
        ...a.loop.failingSteps.map((s) => (
          <li key={s.step}>
            <strong>{STEP_LABEL[s.step] ?? s.step} is failing</strong> since {dateTime(s.since)}
            {s.error ? <span className="muted">: {s.error}</span> : null}
          </li>
        )),
      ],
    },
    {
      key: 'calls',
      title: 'Call the customer',
      items: calls.map((o) => (
        <li key={`call-${o.id}`}>
          <strong>Call the customer</strong> for <Link to={`/orders/${o.id}`}>{o.number}</Link>: {o.attempts} deliveries missed
          {o.name || o.phone ? (
            <span className="muted">
              {' '}
              ({o.name}
              {o.name && o.phone ? ', ' : null}
              {o.phone && <PhoneLink phone={o.phone} who={o.name ?? 'the customer'} />})
            </span>
          ) : null}
          . It won't be sent out again until a manager sends it from the order page.
        </li>
      )),
    },
    { key: 'refunds', title: 'Refunds not sent', items: a.stuckRefunds.map((r) => (
      <li key={`${r.type}-${r.id}-${r.number}`}>
        <strong>Refund not sent</strong> for {r.type === 'order' ? <Link to={`/orders/${r.id}`}>{r.number}</Link> : r.number}, asked
        for at {dateTime(r.requestedAt)}. It retries every minute; check Razorpay if this stays.
      </li>
    )) },
    { key: 'drift', title: 'Stock counts to check', items: drift.map((l) => (
      <li key={`drift-${l.lineId}`}>
        <strong>Stock counts disagree with the ledger</strong> for {l.sku} in <Link to={`/batches/${l.batchId}`}>its batch</Link>
        <span className="muted">
          {' '}
          (on hand {l.onHand[0]} vs {l.onHand[1]}, held {l.held[0]} vs {l.held[1]}, to pack {l.committed[0]} vs {l.committed[1]})
        </span>
        . Check the batch before selling more from it.
      </li>
    )) },
    { key: 'no-proof', title: 'Deliveries marked without proof', items: noProof.map(photoItem) },
    { key: 'photos', title: 'Photo deliveries to check', items: photos.map(photoItem) },
    { key: 'messages', title: 'WhatsApp messages not delivered', items: a.failedMessages.map((m) => (
      <li key={m.id}>
        <strong>WhatsApp message not delivered</strong> ({(NOTIFICATION_LABEL[m.kind as NotificationKind] ?? humanize(m.kind)).toLowerCase()}) for{' '}
        {m.order ? <Link to={`/orders/${m.order.id}`}>{m.order.number}</Link> : (m.preorderNumber ?? m.phone)} after {m.attempts} tries
        {m.error ? <span className="muted">: {m.error}</span> : null}{' '}
        <button type="button" className="btn btn-small" disabled={retry.isPending} onClick={() => retry.mutate(m.id)}>
          Send again<span className="sr-only"> for {m.order?.number ?? m.preorderNumber ?? 'this customer'}</span>
        </button>
      </li>
    )) },
    { key: 'reviews', title: 'Low ratings', items: low.length > 0 ? [
      <li key="low">
        <strong>
          {low.length} new {low.length === 1 ? 'review' : 'reviews'} with 1 or 2 stars
        </strong>{' '}
        ({low.map((r) => r.order.number).join(', ')}). <Link to="/reviews">Read them</Link> and check whether the customer
        needs help. A review never opens a claim by itself.
      </li>,
    ] : [] },
    { key: 'disputes', title: 'Payment disputes', items: (a.disputes ?? []).map((d) => (
      <li key={`dispute-${d.id}`}>
        <strong>Payment disputed</strong> ({humanize(d.status).toLowerCase()}) for{' '}
        {d.order ? <Link to={`/orders/${d.order.id}`}>{d.order.number}</Link> : (d.preorderNumber ?? d.paymentId ?? 'a payment')}
        {d.amount != null ? `, ${rupees(d.amount)}` : null}. Answer it in the Razorpay dashboard, under Disputes
        {d.respondBy ? `, by ${dateTime(d.respondBy)}` : null}.
        {d.reasonCode ? <span className="muted"> Reason: {d.reasonCode}</span> : null}
      </li>
    )) },
    { key: 'webhooks', title: 'Webhook problems', items: a.webhookFailures.map((w) => (
      <li key={w.id}>
        <strong>{w.source === 'razorpay' ? 'Razorpay' : 'WhatsApp'} webhook problem</strong> at {dateTime(w.createdAt)}
        <span className="muted">: {w.reason}</span>
      </li>
    )) },
  ].filter((g) => g.items.length > 0)
  if (groups.length === 0 && !loadError) return null

  return (
    <section className="card attention" aria-labelledby="attention-title">
      <h2 id="attention-title">Needs attention</h2>
      {loadError}
      {groups.map((g) => (
        <AttentionGroupView key={g.key} group={g} />
      ))}
      {doubting && <DoubtDialog d={doubting} pending={check.isPending} error={check.error} onClose={() => setDoubting(null)} onSave={(note) => check.mutate({ d: doubting, ok: false, note })} />}
    </section>
  )
}

interface AttentionGroup {
  key: string
  title: string
  items: ReactNode[]
}

/** How many items a group shows before "Show all". */
const FIRST_FEW = 3

/** One kind of problem: a heading with its count, the first few items, and "Show all N". */
function AttentionGroupView({ group }: { group: AttentionGroup }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const more = group.items.length - FIRST_FEW
  return (
    <div className="attention-group">
      <h3>
        {group.title} <span className="attention-count">{group.items.length}</span>
      </h3>
      <ul className="attention-list" id={listId}>
        {open ? group.items : group.items.slice(0, FIRST_FEW)}
      </ul>
      {more > 0 && (
        <button type="button" className="link-btn" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
          {open ? 'Show fewer' : `Show all ${group.items.length}`}
          <span className="sr-only"> {group.title.toLowerCase()}</span>
        </button>
      )}
    </div>
  )
}

function DoubtDialog({ d, pending, error, onClose, onSave }: { d: PhotoDelivery; pending: boolean; error: unknown; onClose: () => void; onSave: (note: string) => void }) {
  return (
    <ReasonDialog
      title={`What looks wrong with ${d.order.number}?`}
      tone="primary"
      label="Note for the order history"
      hint="Say what looks wrong. The order stays delivered. Someone calls the customer to check they got it."
      minLength={1}
      maxLength={300}
      confirmLabel="Flag for a call"
      busy={pending}
      error={error}
      onClose={onClose}
      onSubmit={onSave}
    />
  )
}
