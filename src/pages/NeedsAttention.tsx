import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { dateTime } from '../format'
import type { PhotoDelivery } from '../types'
import { Dialog, FormError, useToast } from '../ui'

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
}

/**
 * The problems nobody is watching for: the background loop stalling or failing,
 * WhatsApp messages given up on, refunds that haven't gone through, and webhooks
 * that failed or named an order we don't have. Hidden when all is well.
 */
export default function NeedsAttention() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const q = useQuery({ queryKey: ['attention'], queryFn: api.attention, refetchInterval: 60_000 })
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

  if (!q.data) return null
  const a = q.data
  const calls = a.failedDeliveries ?? []
  const low = a.lowRatings ?? []
  const photos = a.photoDeliveries ?? []
  const drift = a.ledgerDrift ?? []
  const count =
    (a.loop.stale ? 1 : 0) +
    a.loop.failingSteps.length +
    a.failedMessages.length +
    a.stuckRefunds.length +
    a.webhookFailures.length +
    calls.length +
    (low.length ? 1 : 0) +
    photos.length +
    drift.length
  if (count === 0) return null

  return (
    <section className="card attention" aria-labelledby="attention-title">
      <h2 id="attention-title">Needs attention</h2>
      <ul className="attention-list">
        {a.loop.stale && (
          <li>
            <strong>The background loop has stopped.</strong>{' '}
            {a.loop.lastRunAt ? `It last ran at ${dateTime(a.loop.lastRunAt)}.` : 'It has not run yet.'} Payments, refunds, WhatsApp
            updates and hold releases wait until it runs again. Restart the API.
          </li>
        )}
        {a.loop.failingSteps.map((s) => (
          <li key={s.step}>
            <strong>{STEP_LABEL[s.step] ?? s.step} is failing</strong> since {dateTime(s.since)}
            {s.error ? <span className="muted">: {s.error}</span> : null}
          </li>
        ))}
        {calls.map((o) => (
          <li key={`call-${o.id}`}>
            <strong>Call the customer</strong> for <Link to={`/orders/${o.id}`}>{o.number}</Link>: {o.attempts} deliveries missed
            {o.name || o.phone ? <span className="muted"> ({[o.name, o.phone].filter(Boolean).join(', ')})</span> : null}. It won't be
            sent out again until a manager sends it from the order page.
          </li>
        ))}
        {photos.map((d) => (
          <li key={`photo-${d.id}`}>
            <strong>{d.method === 'staff' ? 'Check a delivery marked without proof' : 'Check a photo delivery'}</strong> of{' '}
            <Link to={`/orders/${d.order.id}`}>{d.order.number}</Link> by {d.actor} at {dateTime(d.at)}
            {d.receivedBy ? <span className="muted">, left with {d.receivedBy}</span> : null}
            {d.method === 'staff' && d.note ? <span className="muted">: {d.note}</span> : null}
            {d.flags.length ? <span className="badge badge-warn"> {d.flags.join(', ')}</span> : null}{' '}
            <button type="button" className="btn btn-small" disabled={check.isPending} onClick={() => check.mutate({ d, ok: true })}>
              Looks right<span className="sr-only"> for {d.order.number}</span>
            </button>{' '}
            <button type="button" className="btn btn-small" onClick={() => setDoubting(d)}>
              Doubtful<span className="sr-only"> for {d.order.number}</span>
            </button>
          </li>
        ))}
        {drift.map((l) => (
          <li key={`drift-${l.lineId}`}>
            <strong>Stock counts disagree with the ledger</strong> for {l.sku} in batch <Link to={`/batches/${l.batchId}`}>{l.batchId}</Link>
            <span className="muted">
              {' '}
              (on hand {l.onHand[0]} vs {l.onHand[1]}, held {l.held[0]} vs {l.held[1]}, committed {l.committed[0]} vs {l.committed[1]})
            </span>
            . Check the batch before selling more from it.
          </li>
        ))}
        {a.stuckRefunds.map((r) => (
          <li key={`${r.type}-${r.id}-${r.number}`}>
            <strong>Refund not sent</strong> for {r.type === 'order' ? <Link to={`/orders/${r.id}`}>{r.number}</Link> : r.number}, asked
            for at {dateTime(r.requestedAt)}. It retries every minute; check Razorpay if this stays.
          </li>
        ))}
        {a.failedMessages.map((m) => (
          <li key={m.id}>
            <strong>WhatsApp message not delivered</strong> ({m.kind.toLowerCase().replace(/_/g, ' ')}) for{' '}
            {m.order ? <Link to={`/orders/${m.order.id}`}>{m.order.number}</Link> : (m.preorderNumber ?? m.phone)} after {m.attempts} tries
            {m.error ? <span className="muted">: {m.error}</span> : null}{' '}
            <button type="button" className="btn btn-small" disabled={retry.isPending} onClick={() => retry.mutate(m.id)}>
              Send again<span className="sr-only"> for {m.order?.number ?? m.preorderNumber ?? 'this customer'}</span>
            </button>
          </li>
        ))}
        {low.length > 0 && (
          <li>
            <strong>
              {low.length} new {low.length === 1 ? 'review' : 'reviews'} with 1 or 2 stars
            </strong>{' '}
            ({low.map((r) => r.order.number).join(', ')}). <Link to="/reviews">Read them</Link> and check whether the customer
            needs help. A review never opens a claim by itself.
          </li>
        )}
        {a.webhookFailures.map((w) => (
          <li key={w.id}>
            <strong>{w.source === 'razorpay' ? 'Razorpay' : 'WhatsApp'} webhook problem</strong> at {dateTime(w.createdAt)}
            <span className="muted">: {w.reason}</span>
          </li>
        ))}
      </ul>
      {doubting && <DoubtDialog d={doubting} pending={check.isPending} error={check.error} onClose={() => setDoubting(null)} onSave={(note) => check.mutate({ d: doubting, ok: false, note })} />}
    </section>
  )
}

function DoubtDialog({ d, pending, error, onClose, onSave }: { d: PhotoDelivery; pending: boolean; error: unknown; onClose: () => void; onSave: (note: string) => void }) {
  const [note, setNote] = useState('')
  return (
    <Dialog
      title={`What looks wrong with ${d.order.number}?`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={pending || !note.trim()} onClick={() => onSave(note.trim())}>
            Flag for a call
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="doubt-note">Note for the order history</label>
        <textarea id="doubt-note" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="hint">The order stays delivered. Someone calls the customer to check they got it.</p>
      </div>
      <FormError error={error} />
    </Dialog>
  )
}
