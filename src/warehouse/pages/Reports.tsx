// Warehouse reports: do the books match the boxes, CSV exports, recalls, and
// write-offs waiting for a second manager.

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dateTime, istDate } from '../../format'
import { Badge, Dialog, EmptyState, FormError, QueryError, ReasonDialog, Spinner, scrollRegion, useToast, usePageTitle } from '../../ui'
import { useWh } from '../access'
import { wh } from '../api'
import { RECALL_LABEL, WRITE_OFF_REASON_LABEL } from '../labels'
import type { Recall } from '../types'
import { DownloadButton } from '../ui'

export default function Reports() {
  usePageTitle('Warehouse reports')
  const { can } = useWh()
  return (
    <>
      <div className="topbar">
        <h1>Warehouse reports</h1>
      </div>
      <ReconciliationCard />
      {can('reports.export') && <Exports />}
      <Recalls />
      <WriteOffs />
    </>
  )
}

function ReconciliationCard() {
  const q = useQuery({ queryKey: ['wh', 'reconciliation'], queryFn: wh.reconciliation })
  return (
    <section className="card" aria-labelledby="rec-title">
      <h2 id="rec-title">Books against boxes</h2>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <p>
            <Badge tone={q.data.clean ? 'good' : 'bad'}>{q.data.clean ? 'Everything matches' : 'Mismatches found'}</Badge>{' '}
            <span className="muted">{q.data.trackedLines} stock lines with box labels checked.</span>
          </p>
          <ul className="plain-list small">
            <li>Stock count against sellable boxes: {q.data.stockMismatches.length}</li>
            <li>Order units against boxes: {q.data.orderUnitMismatches.length}</li>
            <li>Boxes in an impossible state: {q.data.impossibleStates.length}</li>
            <li>Batch counts: {q.data.lotCountMismatches.length}</li>
            <li>Stock ledger drift: {q.data.ledgerDrift.length}</li>
          </ul>
          {q.data.stockMismatches.length > 0 && (
            <div {...scrollRegion('Stock mismatches', { cards: true })}>
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">On the books</th>
                    <th className="num">Sellable boxes</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.stockMismatches.map((m) => (
                    <tr key={m.lineId}>
                      <td className="card-title">{m.sku}</td>
                      <td className="num" data-label="On the books">
                        {m.onHand}
                      </td>
                      <td className="num" data-label="Sellable boxes">
                        {m.sellableBoxes}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Exports() {
  const [from, setFrom] = useState(istDate(-7))
  const [to, setTo] = useState(istDate())
  return (
    <section className="card" aria-labelledby="exp-title">
      <h2 id="exp-title">Download CSV</h2>
      <div className="btn-row mb-3">
        <DownloadButton getUrl={() => wh.exportUrl('boxes')} filename="warehouse-boxes.csv">
          Boxes
        </DownloadButton>
        <DownloadButton getUrl={() => wh.exportUrl('lots')} filename="warehouse-batches.csv">
          Box batches
        </DownloadButton>
        <DownloadButton getUrl={() => wh.exportUrl('reconciliation')} filename="warehouse-reconciliation.csv">
          Reconciliation
        </DownloadButton>
      </div>
      <div className="field-inline">
        <div className="field">
          <label htmlFor="exp-from">Box history from</label>
          <input id="exp-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="exp-to">to</label>
          <input id="exp-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
        <DownloadButton getUrl={() => wh.exportUrl('events', { from, to })} filename={`warehouse-events-${from}-${to}.csv`}>
          Box history
        </DownloadButton>
      </div>
    </section>
  )
}

function Recalls() {
  const { can } = useWh()
  const toast = useToast()
  const queryClient = useQueryClient()
  const q = useQuery({ queryKey: ['wh', 'recalls'], queryFn: wh.recalls })
  const [starting, setStarting] = useState(false)
  const [releasing, setReleasing] = useState<Recall | null>(null)
  const manage = can('recall.manage')
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['wh', 'recalls'] })

  const cont = useMutation({
    mutationFn: wh.continueRecall,
    onSuccess: (r) => {
      toast.success(`${r.held} boxes held so far.`)
      refresh()
    },
    onError: (err) => toast.error(err),
  })
  const release = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => wh.releaseRecall(id, reason),
    onSuccess: () => {
      setReleasing(null)
      toast.success('Recall released. Its holds are off.')
      refresh()
    },
  })

  return (
    <section className="card" aria-labelledby="recall-title">
      <div className="topbar section-head">
        <h2 id="recall-title">Recalls</h2>
        <span className="spacer" />
        {manage && (
          <button type="button" className="btn" onClick={() => setStarting(true)}>
            Start a recall
          </button>
        )}
      </div>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState>No recalls.</EmptyState>
      ) : (
        <ul className="plain-list wh-list">
          {q.data.map((r) => (
            <li key={r.id} className="wh-row">
              <div>
                <Badge tone={r.status === 'released' ? 'neutral' : 'warn'}>{RECALL_LABEL[r.status] ?? r.status}</Badge>{' '}
                <Link to={`/warehouse/recalls/${r.id}`}>{r.reason}</Link>
                <div className="muted small">
                  {r.lotIds.length} {r.lotIds.length === 1 ? 'batch' : 'batches'} · {r.held} boxes held · {dateTime(r.createdAt)}
                </div>
              </div>
              {manage && r.status !== 'released' && (
                <div className="btn-row">
                  {r.status === 'running' && (
                    <button type="button" className="btn btn-small" disabled={cont.isPending} onClick={() => cont.mutate(r.id)}>
                      Continue holding
                    </button>
                  )}
                  <button type="button" className="btn btn-small" onClick={() => setReleasing(r)}>
                    Release
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {starting && <StartRecallDialog onClose={() => setStarting(false)} onDone={refresh} />}
      {releasing && (
        <ReasonDialog
          title="Release this recall?"
          label="Why release it?"
          confirmLabel="Release recall"
          busy={release.isPending}
          error={release.error}
          onSubmit={(reason) => release.mutate({ id: releasing.id, reason })}
          onClose={() => setReleasing(null)}
        >
          <p>Only the holds this recall placed come off; other holds stay.</p>
        </ReasonDialog>
      )}
    </section>
  )
}

function StartRecallDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const lots = useQuery({ queryKey: ['wh', 'lots', null], queryFn: () => wh.lots() })
  const [chosen, setChosen] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<unknown>(null)
  const m = useMutation({
    mutationFn: () => wh.startRecall(chosen, reason.trim()),
    onSuccess: (r) => {
      toast.success(`Recall started: ${r.held} boxes held.`)
      onDone()
      onClose()
    },
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!chosen.length) return setFormError('Choose at least one batch.')
    if (reason.trim().length < 3) return setFormError('Give a reason (at least 3 characters).')
    setFormError(null)
    m.mutate()
  }
  return (
    <Dialog
      title="Start a recall"
      tone="danger"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="recall-form" className="btn btn-danger" disabled={m.isPending}>
            {m.isPending ? 'Starting…' : 'Start recall'}
          </button>
        </>
      }
    >
      {lots.isPending ? (
        <Spinner />
      ) : lots.isError ? (
        <QueryError error={lots.error} onRetry={() => lots.refetch()} />
      ) : (
        <form id="recall-form" onSubmit={submit} noValidate>
          <p>Every box from the chosen batches goes on hold and cannot be picked.</p>
          <fieldset className="field">
            <legend className="field-label">Batches</legend>
            <ul className="plain-list option-list">
              {lots.data.slice(0, 50).map((l) => (
                <li key={l.id}>
                  <label className="check-inline">
                    <input
                      type="checkbox"
                      checked={chosen.includes(l.id)}
                      onChange={(e) => setChosen(e.target.checked ? [...chosen, l.id] : chosen.filter((x) => x !== l.id))}
                    />
                    {l.code} · {l.productName}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="field">
            <label htmlFor="recall-reason">Reason</label>
            <input id="recall-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </div>
          <FormError error={formError ?? m.error} />
        </form>
      )}
    </Dialog>
  )
}

function WriteOffs() {
  const { can } = useWh()
  const toast = useToast()
  const queryClient = useQueryClient()
  const q = useQuery({ queryKey: ['wh', 'write-offs', 'pending'], queryFn: () => wh.writeOffs('pending') })
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => (approve ? wh.approveWriteOff(id) : wh.rejectWriteOff(id)),
    onSuccess: (_r, v) => {
      toast.success(v.approve ? 'Write-off approved.' : 'Write-off rejected.')
      void queryClient.invalidateQueries({ queryKey: ['wh'] })
    },
    onError: (err) => toast.error(err),
  })
  return (
    <section className="card" id="write-offs" aria-labelledby="wo-title">
      <h2 id="wo-title">Write-offs waiting for approval</h2>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState>No write-offs waiting.</EmptyState>
      ) : (
        <ul className="plain-list wh-list">
          {q.data.map((w) => (
            <li key={w.id} className="wh-row">
              <div>
                {w.boxes} {w.boxes === 1 ? 'box' : 'boxes'} · {WRITE_OFF_REASON_LABEL[w.reasonCode] ?? w.reasonCode} · {w.reason}
                <div className="muted small">
                  Asked by {w.requestedBy ?? 'someone'} · {dateTime(w.requestedAt)}
                </div>
              </div>
              {can('adjust.approve') &&
                (w.mine ? (
                  <span className="muted small">Another manager must approve your own write-off.</span>
                ) : (
                  <div className="btn-row">
                    <button type="button" className="btn btn-small btn-primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: w.id, approve: true })}>
                      Approve
                    </button>
                    <button type="button" className="btn btn-small" disabled={decide.isPending} onClick={() => decide.mutate({ id: w.id, approve: false })}>
                      Reject
                    </button>
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
