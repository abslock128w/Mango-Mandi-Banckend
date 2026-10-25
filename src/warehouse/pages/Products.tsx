// Box settings per product (managers): box labels on or off, the label weight
// and how far a weighed box may be off, shelf life, QC and returns rules, and
// the QC reasons offered when a box fails. Turning labels on is refused while
// the stock count and the labelled boxes disagree; that refusal lists the
// batches to fix.

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api'
import { Badge, ConfirmDialog, Dialog, EmptyState, FormError, QueryError, Spinner, scrollRegion, useToast, usePageTitle } from '../../ui'
import { wh } from '../api'
import type { MismatchedLine, ProductPatch, WhProduct } from '../types'
import { kg } from '../ui'

export default function Products() {
  usePageTitle('Box settings')
  const q = useQuery({ queryKey: ['wh', 'products'], queryFn: wh.products })
  const [editing, setEditing] = useState<WhProduct | null>(null)
  const [toggling, setToggling] = useState<WhProduct | null>(null)

  return (
    <>
      <div className="topbar">
        <h1>Box settings</h1>
      </div>
      <p className="muted">Products with box labels on are received, stored and packed box by box in the warehouse.</p>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState>No products.</EmptyState>
      ) : (
        <div {...scrollRegion('Box settings', { cards: true })}>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Box labels</th>
                <th>Box weight</th>
                <th>Shelf life</th>
                <th>QC</th>
                <th>Returns</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((p) => (
                <tr key={p.sku}>
                  <td className="card-title">
                    {p.name}
                    {!p.active && <div className="muted small">Removed from sale</div>}
                  </td>
                  <td className="card-status">
                    <Badge tone={p.boxTrackingEnabled ? 'good' : 'neutral'}>{p.boxTrackingEnabled ? 'Labels on' : 'Labels off'}</Badge>
                  </td>
                  <td data-label="Box weight">
                    {kg(p.nominalWeightG)} ± {p.weightTolerancePct}%
                  </td>
                  <td data-label="Shelf life">{p.shelfLifeDays ? `${p.shelfLifeDays} days` : '—'}</td>
                  <td data-label="QC">{p.requiresQc ? 'Needed' : 'Not needed'}</td>
                  <td data-label="Returns">{p.restockableReturns ? 'Can be resold' : 'Written off'}</td>
                  <td className="card-wide">
                    <div className="btn-row">
                      <button type="button" className="btn btn-small" onClick={() => setEditing(p)}>
                        Edit<span className="sr-only"> {p.name}</span>
                      </button>
                      <button type="button" className="btn btn-small" onClick={() => setToggling(p)}>
                        {p.boxTrackingEnabled ? 'Turn labels off' : 'Turn labels on'}
                        <span className="sr-only"> for {p.name}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <EditDialog product={editing} onClose={() => setEditing(null)} />}
      {toggling && <TrackingDialog product={toggling} onClose={() => setToggling(null)} />}
    </>
  )
}

function useSave(product: WhProduct, onSaved: (p: WhProduct) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (b: ProductPatch) => wh.updateProduct(product.sku, b),
    onSuccess: (p) => {
      void queryClient.invalidateQueries({ queryKey: ['wh', 'products'] })
      onSaved(p)
    },
  })
}

function TrackingDialog({ product, onClose }: { product: WhProduct; onClose: () => void }) {
  const toast = useToast()
  const on = !product.boxTrackingEnabled
  const save = useSave(product, (p) => {
    toast.success(p.boxTrackingEnabled ? `Box labels are on for ${p.name}.` : `Box labels are off for ${p.name}.`)
    onClose()
  })
  const err = save.error instanceof ApiError && save.error.code === 'RECONCILIATION_NEEDED' ? save.error : null
  const lines = (err?.extra.lines as MismatchedLine[] | undefined) ?? []
  return (
    <ConfirmDialog
      title={on ? `Turn box labels on for ${product.name}?` : `Turn box labels off for ${product.name}?`}
      confirmLabel={on ? 'Turn labels on' : 'Turn labels off'}
      tone={on ? undefined : 'danger'}
      busy={save.isPending}
      error={err ? null : save.error}
      onConfirm={() => save.mutate({ boxTrackingEnabled: on })}
      onClose={onClose}
    >
      <p>
        {on
          ? 'From now on every box is received with a label, and stock counts follow the scanned boxes.'
          : 'Stock goes back to plain counts; existing labels stop being checked.'}
      </p>
      {err && (
        <div className="notice notice-bad" role="alert">
          <p className="mb-2">
            <strong>Not turned on.</strong> {err.message}
          </p>
          {lines.length > 0 && (
            <div {...scrollRegion('Batches that do not match', { cards: true })}>
              <table>
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th className="num">Stock count</th>
                    <th className="num">Labelled sellable boxes</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.lineId}>
                      <td className="card-title">
                        <Link to={`/batches/${l.batchId}`}>{l.batchId}</Link>
                      </td>
                      <td className="num" data-label="Stock count">
                        {l.onHand}
                      </td>
                      <td className="num" data-label="Labelled sellable boxes">
                        {l.sellableBoxes}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </ConfirmDialog>
  )
}

const optionalInt = (v: string) => (v.trim() === '' ? null : Number(v))

function EditDialog({ product, onClose }: { product: WhProduct; onClose: () => void }) {
  const toast = useToast()
  const [weight, setWeight] = useState(product.nominalWeightG?.toString() ?? '')
  const [tolerance, setTolerance] = useState(String(product.weightTolerancePct))
  const [shelfLife, setShelfLife] = useState(product.shelfLifeDays?.toString() ?? '')
  const [requiresQc, setRequiresQc] = useState(product.requiresQc)
  const [restockable, setRestockable] = useState(product.restockableReturns)
  const [checklist, setChecklist] = useState((product.qcChecklist ?? []).join('\n'))
  const [formError, setFormError] = useState<unknown>(null)
  const save = useSave(product, (p) => {
    toast.success(`Saved ${p.name}.`)
    onClose()
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    const g = optionalInt(weight)
    const days = optionalInt(shelfLife)
    const pct = Number(tolerance)
    const codes = checklist
      .split(/[\n,]+/)
      .map((c) => c.trim().toUpperCase().replace(/\s+/g, '_'))
      .filter(Boolean)
    if (g !== null && (!Number.isInteger(g) || g < 1 || g > 100_000)) return setFormError('Box weight is whole grams, 1 to 100000.')
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) return setFormError('Tolerance is 0 to 50%.')
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) return setFormError('Shelf life is 1 to 365 days.')
    if (codes.some((c) => !/^[A-Z_]{2,30}$/.test(c))) return setFormError('QC reasons use letters and underscores only, e.g. BRUISED or UNDER_WEIGHT.')
    if (codes.length > 20) return setFormError('At most 20 QC reasons.')
    setFormError(null)
    save.mutate({
      nominalWeightG: g,
      weightTolerancePct: pct,
      shelfLifeDays: days,
      requiresQc,
      restockableReturns: restockable,
      ...(codes.length ? { qcChecklist: codes } : {}),
    })
  }

  return (
    <Dialog
      title={`Box settings: ${product.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="product-form" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="product-form" onSubmit={submit} noValidate>
        <div className="field-row">
          <div className="field">
            <label htmlFor="pr-weight">Box weight in grams</label>
            <input id="pr-weight" type="number" inputMode="numeric" min={1} step={1} value={weight} onChange={(e) => setWeight(e.target.value)} data-autofocus />
          </div>
          <div className="field">
            <label htmlFor="pr-tolerance">Weight tolerance (%)</label>
            <input id="pr-tolerance" type="number" inputMode="decimal" min={0} max={50} step={0.5} value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="pr-shelf">Shelf life in days</label>
          <input id="pr-shelf" type="number" inputMode="numeric" min={1} max={365} step={1} value={shelfLife} onChange={(e) => setShelfLife(e.target.value)} aria-describedby="pr-shelf-hint" />
          <p className="hint" id="pr-shelf-hint">
            Sets the best-before date on new labels. Leave empty for the usual rule.
          </p>
        </div>
        <div className="field">
          <label className="check-inline">
            <input type="checkbox" checked={requiresQc} onChange={(e) => setRequiresQc(e.target.checked)} />
            Boxes need QC before they can be sold
          </label>
          <label className="check-inline">
            <input type="checkbox" checked={restockable} onChange={(e) => setRestockable(e.target.checked)} />
            Returned boxes can be resold
          </label>
        </div>
        <div className="field">
          <label htmlFor="pr-checklist">QC reasons</label>
          <textarea id="pr-checklist" rows={4} value={checklist} onChange={(e) => setChecklist(e.target.value)} aria-describedby="pr-checklist-hint" />
          <p className="hint" id="pr-checklist-hint">
            One per line, e.g. BRUISED. Offered when a box fails QC.
          </p>
        </div>
        <FormError error={formError ?? save.error} />
      </form>
    </Dialog>
  )
}
