// One batch of labelled boxes (a lot): its labels, its counts, and what can be
// done with it. A big lot is made in parts: while it says "Making labels" this
// page asks for the next part until every label exists, showing how far it got.

import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { date } from '../../format'
import { BackLink, Badge, ConfirmDialog, Dialog, FormError, QueryError, ReasonDialog, Spinner, scrollRegion, useToast, usePageTitle } from '../../ui'
import { useWh } from '../access'
import { LABELS_PER_PDF, wh } from '../api'
import { LIFECYCLE_LABEL, LOCATION_TYPE_LABEL, LOT_STATUS_LABEL, QUALITY_LABEL, lotTone } from '../labels'
import type { Lot } from '../types'
import { DownloadButton, kg } from '../ui'

type Action = 'confirm' | 'add' | 'void' | 'close' | 'qc' | 'putaway' | 'voidLot' | 'correct' | null

export default function LotDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { can } = useWh()
  const [action, setAction] = useState<Action>(null)
  const [layout, setLayout] = useState<'roll' | 'a4'>('roll')

  const q = useQuery({ queryKey: ['wh', 'lot', id], queryFn: () => wh.lot(id) })
  usePageTitle(q.data ? `Batch ${q.data.code}` : 'Batch')
  const lot = q.data

  // Making labels: one part at a time until the lot is ready.
  const generating = lot?.status === 'generating'
  const [genError, setGenError] = useState<unknown>(null)
  useEffect(() => {
    if (!generating || genError) return
    let cancelled = false
    wh.continueLot(id).then(
      (next) => {
        if (cancelled) return
        queryClient.setQueryData<Lot>(['wh', 'lot', id], (old) => ({ ...old, ...next }))
        if (next.status !== 'generating') void queryClient.invalidateQueries({ queryKey: ['wh', 'lot', id] })
      },
      (err) => !cancelled && setGenError(err),
    )
    return () => {
      cancelled = true
    }
    // Each new count asks for the next part.
  }, [generating, lot?.generatedCount, genError, id, queryClient])

  const startScan = useMutation({
    mutationFn: () => wh.startOperation('receive', { lotId: id }),
    onSuccess: (op) => navigate(`/warehouse/scan?op=${encodeURIComponent(op.id)}`),
    onError: (err) => toast.error(err),
  })

  const voidLot = useMutation({ mutationFn: (reason: string) => wh.voidLot(id, reason), onSuccess: () => done(`Batch ${lot?.code ?? ''} voided.`) })

  function done(message: string) {
    setAction(null)
    toast.success(message)
    void queryClient.invalidateQueries({ queryKey: ['wh'] })
  }

  if (q.isPending) return <Spinner />
  if (q.isError || !lot) return <QueryError error={q.error} onRetry={() => q.refetch()} />

  const open = lot.status === 'receiving' || lot.status === 'received'
  const live = lot.targetCount - lot.voidedCount
  const parts: [number, number][] = []
  for (let from = 1; from <= lot.generatedCount; from += LABELS_PER_PDF) parts.push([from, Math.min(lot.generatedCount, from + LABELS_PER_PDF - 1)])

  return (
    <>
      <BackLink to="/warehouse/lots">Box batches</BackLink>
      <div className="topbar">
        <h1>Batch {lot.code}</h1>
        <Badge tone={lotTone(lot.status)}>{LOT_STATUS_LABEL[lot.status]}</Badge>
        <span className="spacer" />
        <Link to={`/warehouse/lots/${lot.id}/trace`} className="btn">
          Trace this batch
        </Link>
        {can('warehouse.receive') && open && (
          <button type="button" className="btn btn-primary" onClick={() => startScan.mutate()} disabled={startScan.isPending}>
            {startScan.isPending ? 'Starting…' : 'Start receive scanning'}
          </button>
        )}
      </div>

      {generating && (
        <div className="card" role="status" aria-live="polite">
          <p className="mb-2">
            Making labels: {lot.generatedCount} of {lot.targetCount}
          </p>
          <progress className="wh-progress" max={lot.targetCount} value={lot.generatedCount} aria-label="Labels made">
            {lot.generatedCount} of {lot.targetCount}
          </progress>
          {genError != null && (
            <>
              <FormError error={genError} />
              <button type="button" className="btn" onClick={() => setGenError(null)}>
                Try again
              </button>
            </>
          )}
        </div>
      )}

      <div className="grid-2">
        <section className="card" aria-labelledby="lot-facts">
          <h2 id="lot-facts">{lot.productName}</h2>
          <dl className="wh-facts">
            <div>
              <dt>Received</dt>
              <dd>
                {lot.verifiedCount} of {live}
              </dd>
            </div>
            <div>
              <dt>Expected</dt>
              <dd>{lot.expectedCount}</dd>
            </div>
            <div>
              <dt>Voided</dt>
              <dd>{lot.voidedCount}</dd>
            </div>
            <div>
              <dt>Sellable</dt>
              <dd>{lot.sellable ?? '—'}</dd>
            </div>
            <div>
              <dt>Box weight</dt>
              <dd>{kg(lot.nominalWeightG)}</dd>
            </div>
            <div>
              <dt>Harvested</dt>
              <dd>{date(lot.harvestedOn)}</dd>
            </div>
            <div>
              <dt>Received on</dt>
              <dd>{date(lot.receivedOn)}</dd>
            </div>
            <div>
              <dt>Best before</dt>
              <dd>{date(lot.bestBefore)}</dd>
            </div>
            {lot.supplier && (
              <div>
                <dt>Supplier</dt>
                <dd>{lot.supplier}</dd>
              </div>
            )}
          </dl>
        </section>

        {can('labels.print') && (
          <section className="card" aria-labelledby="lot-labels">
            <h2 id="lot-labels">Labels</h2>
            {lot.generatedCount === 0 ? (
              <p className="muted">Labels appear here as they are made.</p>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="lot-layout">Printer</label>
                  <select id="lot-layout" value={layout} onChange={(e) => setLayout(e.target.value as 'roll' | 'a4')}>
                    <option value="roll">Label roll (one per label)</option>
                    <option value="a4">A4 sheets</option>
                  </select>
                </div>
                <p className="hint">Print at 100% (actual size). Files hold up to {LABELS_PER_PDF} labels each.</p>
                <ul className="plain-list wh-parts">
                  {parts.map(([from, to]) => (
                    <li key={from}>
                      <DownloadButton getUrl={() => wh.lotLabelsUrl(lot.id, from, to, layout)} filename={`labels-${lot.code}-${from}-${to}.pdf`}>
                        Labels {from}–{to}
                      </DownloadButton>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </div>

      {lot.states && lot.states.length > 0 && (
        <section aria-labelledby="lot-states" className="mb-4">
          <h2 id="lot-states">Boxes by state</h2>
          <div {...scrollRegion('Boxes by state', { cards: true })}>
            <table>
              <thead>
                <tr>
                  <th>State</th>
                  <th>QC</th>
                  <th className="num">Boxes</th>
                  <th className="num">Sellable</th>
                </tr>
              </thead>
              <tbody>
                {lot.states.map((s) => (
                  <tr key={`${s.lifecycle}-${s.quality}`}>
                    <td className="card-title">{LIFECYCLE_LABEL[s.lifecycle] ?? s.lifecycle}</td>
                    <td data-label="QC">{QUALITY_LABEL[s.quality] ?? s.quality}</td>
                    <td className="num" data-label="Boxes">
                      {s.n}
                    </td>
                    <td className="num" data-label="Sellable">
                      {s.sellable}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(can('warehouse.receive') || can('warehouse.qc') || can('warehouse.move') || can('warehouse.adjust')) && lot.status !== 'voided' && (
        <section className="card" aria-labelledby="lot-actions">
          <h2 id="lot-actions">Batch actions</h2>
          <div className="btn-row">
            {can('warehouse.receive') && open && (
              <>
                <button type="button" className="btn" onClick={() => setAction('confirm')}>
                  Confirm count without scanning
                </button>
                <button type="button" className="btn" onClick={() => setAction('add')}>
                  Add boxes
                </button>
                <button type="button" className="btn" onClick={() => setAction('void')}>
                  Void unused labels
                </button>
              </>
            )}
            {can('warehouse.qc') && lot.verifiedCount > 0 && (
              <button type="button" className="btn" onClick={() => setAction('qc')}>
                Pass QC for the batch
              </button>
            )}
            {can('warehouse.move') && lot.verifiedCount > 0 && (
              <button type="button" className="btn" onClick={() => setAction('putaway')}>
                Put away
              </button>
            )}
            {can('warehouse.receive') && open && (
              <button type="button" className="btn" onClick={() => setAction('close')}>
                Close batch
              </button>
            )}
            {can('warehouse.adjust') && lot.status !== 'closed' && (
              <>
                <button type="button" className="btn" onClick={() => setAction('correct')}>
                  Correct supplier or product
                </button>
                <button type="button" className="btn btn-danger" onClick={() => setAction('voidLot')}>
                  Void batch
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {(action === 'confirm' || action === 'add' || action === 'void') && (
        <CountDialog
          kind={action}
          lot={lot}
          onClose={() => setAction(null)}
          onDone={(l) => done(action === 'confirm' ? `${l.verifiedCount} of ${l.targetCount - l.voidedCount} received.` : action === 'add' ? 'Boxes added. Print their labels.' : 'Labels voided.')}
        />
      )}
      {action === 'qc' && <QcDialog lot={lot} onClose={() => setAction(null)} onDone={done} />}
      {action === 'putaway' && <PutAwayDialog lot={lot} onClose={() => setAction(null)} onDone={done} />}
      {action === 'voidLot' && (
        <ReasonDialog
          title={`Void batch ${lot.code}?`}
          label="Why void it?"
          confirmLabel="Void batch"
          busy={voidLot.isPending}
          error={voidLot.error}
          onSubmit={(r) => voidLot.mutate(r)}
          onClose={() => setAction(null)}
        >
          <p>Every label in this batch stops scanning and its boxes leave stock. Only possible while no box has been picked or written off.</p>
        </ReasonDialog>
      )}
      {action === 'correct' && <CorrectDialog lot={lot} onClose={() => setAction(null)} onDone={done} />}
      {action === 'close' && <CloseDialog lot={lot} onClose={() => setAction(null)} onDone={done} />}
    </>
  )
}

const COUNT_COPY = {
  confirm: { title: 'Confirm count without scanning', label: 'Boxes counted', button: 'Confirm count' },
  add: { title: 'Add boxes', label: 'Extra boxes', button: 'Add boxes' },
  void: { title: 'Void unused labels', label: 'Labels to void', button: 'Void labels' },
} as const

function CountDialog({ kind, lot, onClose, onDone }: { kind: 'confirm' | 'add' | 'void'; lot: Lot; onClose: () => void; onDone: (l: Lot) => void }) {
  const copy = COUNT_COPY[kind]
  const [count, setCount] = useState('')
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<unknown>(null)
  const m = useMutation({
    mutationFn: (b: { count: number; reason: string }) =>
      kind === 'confirm' ? wh.confirmCount(lot.id, b) : kind === 'add' ? wh.addBoxes(lot.id, b) : wh.voidBoxes(lot.id, b),
    onSuccess: onDone,
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    const n = Number(count)
    if (!Number.isInteger(n) || n < 1) return setFormError('Enter a whole number of boxes.')
    if (reason.trim().length < 3) return setFormError('Give a reason (at least 3 characters).')
    setFormError(null)
    m.mutate({ count: n, reason: reason.trim() })
  }
  return (
    <Dialog
      title={copy.title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="lot-count-form" className="btn btn-primary" disabled={m.isPending}>
            {m.isPending ? 'Saving…' : copy.button}
          </button>
        </>
      }
    >
      <form id="lot-count-form" onSubmit={submit} noValidate>
        {kind === 'confirm' && <p>Use this only when the labels cannot be scanned. Each counted box is booked as received.</p>}
        <div className="field">
          <label htmlFor="lot-count">{copy.label}</label>
          <input id="lot-count" type="number" inputMode="numeric" min={1} step={1} value={count} onChange={(e) => setCount(e.target.value)} data-autofocus />
        </div>
        <div className="field">
          <label htmlFor="lot-reason">Reason</label>
          <input id="lot-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </div>
        <FormError error={formError ?? m.error} />
      </form>
    </Dialog>
  )
}

function QcDialog({ lot, onClose, onDone }: { lot: Lot; onClose: () => void; onDone: (msg: string) => void }) {
  const [except, setExcept] = useState('')
  const [note, setNote] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const m = useMutation({
    mutationFn: async () => {
      // Boxes held back are listed by their label code; the API wants their ids.
      const codes = except.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
      const ids: string[] = []
      for (const code of codes) {
        const r = await wh.resolve(code)
        if (r.kind !== 'box') throw new Error(`${code} is not a box label.`)
        ids.push(r.box.id)
      }
      // The API passes at most 400 boxes a call: ask again while it says there is more and it made progress.
      const body = { ...(ids.length ? { exceptBoxIds: ids } : {}), ...(note.trim() ? { note: note.trim() } : {}) }
      let passed = 0
      for (;;) {
        const r = await wh.qcLot(lot.id, body)
        passed += r.passed
        setProgress(passed)
        if (!r.more || r.passed === 0) return { passed, stillPending: r.stillPending }
      }
    },
    onSuccess: (r) => onDone(`${r.passed} passed QC${r.stillPending ? `; ${r.stillPending} still waiting` : ''}.`),
  })
  return (
    <Dialog
      title="Pass QC for the batch"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="lot-qc-form" className="btn btn-primary" disabled={m.isPending}>
            {m.isPending ? 'Saving…' : 'Pass QC'}
          </button>
        </>
      }
    >
      <form
        id="lot-qc-form"
        onSubmit={(e) => {
          e.preventDefault()
          m.mutate()
        }}
        noValidate
      >
        <p>Every received box in {lot.code} passes QC, except the ones you list.</p>
        <div className="field">
          <label htmlFor="qc-except">Boxes that do not pass (optional)</label>
          <textarea id="qc-except" rows={3} value={except} onChange={(e) => setExcept(e.target.value)} aria-describedby="qc-except-hint" data-autofocus />
          <p className="hint" id="qc-except-hint">
            Scan or type their codes, one per line. Check those with a QC scan session.
          </p>
        </div>
        <div className="field">
          <label htmlFor="qc-note">Note (optional)</label>
          <input id="qc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </div>
        {m.isPending && progress !== null && (
          <p role="status">
            {progress} of {lot.verifiedCount} passed so far…
          </p>
        )}
        <FormError error={m.error} />
      </form>
    </Dialog>
  )
}

function PutAwayDialog({ lot, onClose, onDone }: { lot: Lot; onClose: () => void; onDone: (msg: string) => void }) {
  const locations = useQuery({ queryKey: ['wh', 'locations'], queryFn: wh.locations })
  const [locationId, setLocationId] = useState('')
  const [formError, setFormError] = useState<unknown>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const m = useMutation({
    // At most 400 boxes a call: ask again while there is more and boxes moved.
    mutationFn: async () => {
      let moved = 0
      const skipped: { code: string; reason: string }[] = []
      for (;;) {
        const r = await wh.putAway(lot.id, locationId)
        moved += r.moved
        skipped.push(...r.skipped.filter((x) => !skipped.some((y) => y.code === x.code)))
        setProgress(moved)
        if (!r.more || r.moved === 0) return { moved, skipped }
      }
    },
    onSuccess: (r) =>
      onDone(`${r.moved} ${r.moved === 1 ? 'box' : 'boxes'} put away${r.skipped.length ? `; ${r.skipped.length} left where they are (${r.skipped.map((s) => s.code).slice(0, 3).join(', ')})` : ''}.`),
  })
  const choices = (locations.data ?? []).filter((l) => l.active && l.type !== 'receiving')
  return (
    <Dialog
      title="Put away"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="lot-putaway-form" className="btn btn-primary" disabled={m.isPending}>
            {m.isPending ? 'Moving…' : 'Put away'}
          </button>
        </>
      }
    >
      {locations.isPending ? (
        <Spinner label="Loading locations" />
      ) : locations.isError ? (
        <QueryError error={locations.error} onRetry={() => locations.refetch()} />
      ) : (
        <form
          id="lot-putaway-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!locationId) return setFormError('Choose where the boxes go.')
            setFormError(null)
            m.mutate()
          }}
          noValidate
        >
          <p>Moves every received box of {lot.code} still in receiving. Boxes waiting for QC can only go to a QC hold location.</p>
          <div className="field">
            <label htmlFor="putaway-loc">Put away to</label>
            <select id="putaway-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)} data-autofocus>
              <option value="">Choose a location</option>
              {choices.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.zone ? `${l.zone} · ` : ''}
                  {l.name} ({LOCATION_TYPE_LABEL[l.type]})
                </option>
              ))}
            </select>
          </div>
          {m.isPending && progress !== null && (
            <p role="status">
              {progress} of {lot.verifiedCount} moved so far…
            </p>
          )}
          <FormError error={formError ?? m.error} />
        </form>
      )}
    </Dialog>
  )
}

function CorrectDialog({ lot, onClose, onDone }: { lot: Lot; onClose: () => void; onDone: (msg: string) => void }) {
  const products = useQuery({ queryKey: ['wh', 'products'], queryFn: wh.products })
  const variety = products.data?.find((p) => p.sku === lot.sku)?.variety
  // Only the same variety, with labels on: the batch itself does not change.
  const choices = (products.data ?? []).filter((p) => p.active && p.boxTrackingEnabled && p.variety === variety)
  const [supplier, setSupplier] = useState(lot.supplier ?? '')
  const [sku, setSku] = useState(lot.sku)
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<unknown>(null)
  const m = useMutation({
    mutationFn: () =>
      wh.correctLot(lot.id, {
        ...(supplier.trim() !== (lot.supplier ?? '') ? { supplier: supplier.trim() } : {}),
        ...(sku !== lot.sku ? { sku } : {}),
        reason: reason.trim(),
      }),
    onSuccess: () => onDone(sku !== lot.sku ? 'Product corrected. Reprint every label in this batch.' : 'Supplier corrected.'),
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    if (supplier.trim() === (lot.supplier ?? '') && sku === lot.sku) return setFormError('Change the supplier or the product first.')
    if (reason.trim().length < 3) return setFormError('Give a reason (at least 3 characters).')
    setFormError(null)
    m.mutate()
  }
  return (
    <Dialog
      title="Correct supplier or product"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="lot-correct-form" className="btn btn-primary" disabled={m.isPending}>
            {m.isPending ? 'Saving…' : 'Save correction'}
          </button>
        </>
      }
    >
      <form id="lot-correct-form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="lc-supplier">Supplier</label>
          <input id="lc-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={120} data-autofocus />
        </div>
        <div className="field">
          <label htmlFor="lc-product">Product</label>
          <select id="lc-product" value={sku} onChange={(e) => setSku(e.target.value)} disabled={products.isPending} aria-describedby="lc-product-hint">
            {!choices.some((p) => p.sku === lot.sku) && <option value={lot.sku}>{lot.productName}</option>}
            {choices.map((p) => (
              <option key={p.sku} value={p.sku}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="hint" id="lc-product-hint">
            Only before any box is received, and only within the same variety. Labels must be reprinted.
          </p>
        </div>
        <div className="field">
          <label htmlFor="lc-reason">Reason</label>
          <input id="lc-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </div>
        <FormError error={formError ?? m.error} />
      </form>
    </Dialog>
  )
}

function CloseDialog({ lot, onClose, onDone }: { lot: Lot; onClose: () => void; onDone: (msg: string) => void }) {
  const m = useMutation({ mutationFn: () => wh.closeLot(lot.id), onSuccess: () => onDone(`Batch ${lot.code} closed.`) })
  return (
    <ConfirmDialog title={`Close batch ${lot.code}?`} confirmLabel="Close batch" busy={m.isPending} error={m.error} onConfirm={() => m.mutate()} onClose={onClose}>
      <p>
        {lot.verifiedCount} of {lot.targetCount - lot.voidedCount} boxes are received. A closed batch takes no more boxes; every label must be received or voided first.
      </p>
    </ConfirmDialog>
  )
}
