import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { BATCH_STATUS_LABEL, RIPENESS_LABEL, date, istDate } from '../format'
import { ALL_BATCH_STATUSES, type BatchStatus } from '../types'
import {
  Badge,
  BatchBadge,
  DataTable,
  Dialog,
  EmptyState,
  FormError,
  QueryError,
  Spinner,
  StatusFilter,
  useToast,
  usePageTitle,
} from '../ui'
import { FreshnessStrip } from '../viz'

export default function Batches() {
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as BatchStatus | null) || null
  const receiving = params.get('receive') === '1'
  usePageTitle('Batches')

  const q = useQuery({ queryKey: ['batches', status], queryFn: () => api.batches(status) })
  // The live sell limit, for each row's freshness strip (the same summary Today reads).
  const summary = useQuery({ queryKey: ['summary'], queryFn: api.summary, staleTime: 60_000 })
  const maxAge = summary.data?.maxSellableAge ?? 7

  function setStatus(next: BatchStatus | null) {
    const p = new URLSearchParams(params)
    if (next) p.set('status', next)
    else p.delete('status')
    setParams(p)
  }
  function setReceiving(open: boolean) {
    const p = new URLSearchParams(params)
    if (open) p.set('receive', '1')
    else p.delete('receive')
    setParams(p, { replace: true })
  }

  return (
    <>
      <div className="topbar">
        <h1>Batches</h1>
        <p className="page-sub">Stock by picking batch. The strip shows each batch's age against the {maxAge}-day sell limit.</p>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => setReceiving(true)}>
          Receive batch
        </button>
      </div>

      <StatusFilter className="no-print mb-4" value={status} options={ALL_BATCH_STATUSES} labels={BATCH_STATUS_LABEL} onChange={setStatus} />

      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState>No batches{status ? ` with status ${BATCH_STATUS_LABEL[status]}` : ''}.</EmptyState>
      ) : (
        <DataTable
          label="Batches"
          storageKey="batches"
          rows={q.data}
          rowKey={(b) => b.id}
          rowName={(b) => `${b.variety} batch plucked ${date(b.pluckedOn)}`}
          rowHref={(b) => `/batches/${b.id}`}
          columns={[
            {
              key: 'variety',
              header: 'Variety',
              fixed: true,
              card: 'title',
              sort: (a, b) => a.variety.localeCompare(b.variety),
              cell: (b) => (
                <>
                  {b.variety}
                  <span className="sr-only"> batch plucked {date(b.pluckedOn)}</span>
                  {b.farm && <span className="muted small dt-sub"> {b.farm}</span>}
                </>
              ),
            },
            { key: 'plucked', header: 'Plucked', sort: (a, b) => a.pluckedOn.localeCompare(b.pluckedOn), cell: (b) => date(b.pluckedOn) },
            {
              key: 'age',
              header: 'Age',
              num: true,
              sort: (a, b) => a.ageDays - b.ageDays,
              cell: (b) => (
                <span className={`age-cell${b.ageDays > maxAge ? ' text-danger' : b.ageDays >= 5 ? ' text-warn' : ''}`}>
                  <FreshnessStrip ageDays={b.ageDays} maxAge={maxAge} />
                  {b.ageDays}d
                </span>
              ),
            },
            { key: 'status', header: 'Status', card: 'status', sort: (a, b) => BATCH_STATUS_LABEL[a.status].localeCompare(BATCH_STATUS_LABEL[b.status]), cell: (b) => <BatchBadge status={b.status} /> },
            {
              key: 'qc',
              header: 'QC',
              card: 'wide',
              cell: (b) =>
                b.latestRating ? (
                  <Badge tone={b.latestCondition === 'REJECT' ? 'bad' : 'neutral'}>
                    {RIPENESS_LABEL[b.latestRating]}
                    {b.latestCondition === 'REJECT' ? ' · Reject' : ''}
                  </Badge>
                ) : (
                  <Badge tone="warn">No QC: not sellable yet</Badge>
                ),
            },
            { key: 'onHand', header: 'On hand', num: true, sort: (a, b) => a.onHand - b.onHand, cell: (b) => b.onHand },
            { key: 'committed', header: 'To pack', num: true, sort: (a, b) => a.committed - b.committed, cell: (b) => b.committed },
            { key: 'available', header: 'Available', num: true, sort: (a, b) => a.available - b.available, cell: (b) => b.available },
          ]}
        />
      )}

      {receiving && <ReceiveDialog onClose={() => setReceiving(false)} />}
    </>
  )
}

function ReceiveDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const products = useQuery({ queryKey: ['products'], queryFn: api.products, staleTime: Infinity })
  // Removed products can't take new stock.
  const onSale = useMemo(() => (products.data ?? []).filter((p) => p.active !== false), [products.data])

  const varieties = useMemo(
    () => Array.from(new Set(onSale.map((p) => p.variety).filter(Boolean))).sort(),
    [onSale],
  )
  const [variety, setVariety] = useState('')
  const [pluckedOn, setPluckedOn] = useState(istDate())
  const [farm, setFarm] = useState('')
  const [qty, setQty] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<unknown>(null)
  // One key per intake as filled in: sending the same intake again (a double tap, a retry after a lost answer)
  // records one batch (INV-02); changing any field makes a new key.
  const lastSent = useRef<{ body: string; key: string } | null>(null)
  const keyFor = (input: Parameters<typeof api.createBatch>[0]) => {
    const body = JSON.stringify(input)
    if (lastSent.current?.body !== body) lastSent.current = { body, key: crypto.randomUUID() }
    return lastSent.current.key
  }

  const activeVariety = variety || varieties[0] || ''
  const skus = onSale.filter((p) => p.variety === activeVariety)
  const today = istDate()

  const create = useMutation({
    mutationFn: (input: Parameters<typeof api.createBatch>[0]) => api.createBatch(input, keyFor(input)),
    onSuccess: (batch) => {
      queryClient.invalidateQueries({ queryKey: ['batches'] })
      queryClient.invalidateQueries({ queryKey: ['summary'] })
      toast.success('Batch received. Log QC before it can sell.')
      navigate(`/batches/${batch.id}?focusQC=1`)
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (pluckedOn > today) return setFormError('Plucked date cannot be in the future.')
    const lines = skus
      .map((p) => ({ sku: p.sku, onHand: Number(qty[p.sku] || 0) }))
      .filter((l) => l.onHand > 0)
    if (lines.some((l) => !Number.isInteger(l.onHand))) return setFormError('Quantities must be whole numbers.')
    if (lines.length === 0) return setFormError('Enter a quantity for at least one product.')
    create.mutate({ variety: activeVariety, pluckedOn, farm: farm.trim() || undefined, lines })
  }

  return (
    <Dialog
      title="Receive batch"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="receive-form" className="btn btn-primary" disabled={create.isPending || !activeVariety}>
            {create.isPending ? 'Saving…' : 'Receive batch'}
          </button>
        </>
      }
    >
      {products.isPending ? (
        <Spinner label="Loading products" />
      ) : products.isError ? (
        <QueryError error={products.error} onRetry={() => products.refetch()} />
      ) : (
        <form id="receive-form" onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="rb-variety">Variety</label>
            <select id="rb-variety" value={activeVariety} onChange={(e) => setVariety(e.target.value)}>
              {varieties.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rb-plucked">Plucked date</label>
            <input id="rb-plucked" type="date" max={today} value={pluckedOn} onChange={(e) => setPluckedOn(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rb-farm">Farm (optional)</label>
            <input id="rb-farm" value={farm} onChange={(e) => setFarm(e.target.value)} />
          </div>
          <fieldset>
            <legend>Quantity per product</legend>
            {skus.length === 0 && <p className="muted">No products for this variety.</p>}
            {skus.map((p) => (
              <div className="field" key={p.sku}>
                <label htmlFor={`rb-qty-${p.sku}`}>
                  {p.name} <span className="muted small">{p.sku}</span>
                </label>
                <input
                  id={`rb-qty-${p.sku}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={qty[p.sku] ?? ''}
                  onChange={(e) => setQty((q) => ({ ...q, [p.sku]: e.target.value }))}
                />
              </div>
            ))}
          </fieldset>
          <FormError error={formError ?? create.error} />
        </form>
      )}
    </Dialog>
  )
}
