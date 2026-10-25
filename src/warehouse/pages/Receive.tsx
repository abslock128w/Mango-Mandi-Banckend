// Receive: a delivery of boxes becomes a batch (a lot) with one label per box.
// Check shows the total weight and best-before date; Create makes the lot with
// an Idempotency-Key made once for this form, so a double tap or a retry after
// a dropped connection never makes two lots. The lot page then makes the
// labels, prints them and starts receive scanning.

import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { date, istDate } from '../../format'
import { FormError, QueryError, Spinner, useToast, usePageTitle } from '../../ui'
import { wh } from '../api'
import type { IntakeInput, IntakePreview } from '../types'
import { kg } from '../ui'

export default function Receive() {
  usePageTitle('Receive boxes')
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const products = useQuery({ queryKey: ['wh', 'products'], queryFn: wh.products, staleTime: 60_000 })
  const tracked = useMemo(() => (products.data ?? []).filter((p) => p.active && p.boxTrackingEnabled), [products.data])

  const today = istDate()
  const [sku, setSku] = useState('')
  const [count, setCount] = useState('')
  const [harvestedOn, setHarvestedOn] = useState(today)
  const [receivedOn, setReceivedOn] = useState(today)
  const [supplier, setSupplier] = useState('')
  const [weight, setWeight] = useState('')
  const [formError, setFormError] = useState<unknown>(null)
  const [preview, setPreview] = useState<IntakePreview | null>(null)
  // One key for this form: every retry of Create sends the same one.
  const [key] = useState(() => crypto.randomUUID())

  const activeSku = sku || tracked[0]?.sku || ''
  const product = tracked.find((p) => p.sku === activeSku)

  /** The intake, or what is wrong with it. */
  function body(): IntakeInput | string {
    const n = Number(count)
    if (!activeSku) return 'Choose a product.'
    if (!Number.isInteger(n) || n < 1) return 'Enter how many boxes came in (a whole number).'
    if (harvestedOn > today) return 'The harvest date cannot be in the future.'
    if (receivedOn > today) return 'The received date cannot be in the future.'
    if (receivedOn < harvestedOn) return 'Boxes cannot arrive before they were harvested.'
    const g = weight ? Number(weight) : undefined
    if (g !== undefined && (!Number.isInteger(g) || g < 1)) return 'Enter the box weight in whole grams.'
    return { sku: activeSku, expectedCount: n, harvestedOn, receivedOn, ...(supplier.trim() ? { supplier: supplier.trim() } : {}), ...(g ? { nominalWeightG: g } : {}) }
  }

  const check = useMutation({ mutationFn: wh.previewLot, onSuccess: setPreview })
  const create = useMutation({
    mutationFn: (b: IntakeInput) => wh.createLot(b, key),
    onSuccess: (lot) => {
      void queryClient.invalidateQueries({ queryKey: ['wh'] })
      toast.success(lot.replayed ? `Batch ${lot.code} was already made.` : `Batch ${lot.code} made.`)
      navigate(`/warehouse/lots/${lot.id}`)
    },
  })

  /** Any change asks for a fresh check before Create. */
  function edit<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v)
      setPreview(null)
      check.reset()
    }
  }

  function onCheck(e: FormEvent) {
    e.preventDefault()
    const b = body()
    setFormError(typeof b === 'string' ? b : null)
    if (typeof b !== 'string') check.mutate(b)
  }

  function onCreate() {
    const b = body()
    setFormError(typeof b === 'string' ? b : null)
    if (typeof b !== 'string') create.mutate(b)
  }

  return (
    <>
      <div className="topbar">
        <h1>Receive boxes</h1>
      </div>
      {products.isPending ? (
        <Spinner label="Loading products" />
      ) : products.isError ? (
        <QueryError error={products.error} onRetry={() => products.refetch()} />
      ) : tracked.length === 0 ? (
        <p className="notice notice-info">No product has box labels switched on yet. A manager turns them on per product.</p>
      ) : (
        <div className="grid-2">
          <form className="card" onSubmit={onCheck} noValidate aria-labelledby="intake-title">
            <h2 id="intake-title">What came in</h2>
            <div className="field">
              <label htmlFor="rc-product">Product</label>
              <select id="rc-product" value={activeSku} onChange={(e) => edit(setSku)(e.target.value)}>
                {tracked.map((p) => (
                  <option key={p.sku} value={p.sku}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rc-count">Number of boxes</label>
              <input id="rc-count" type="number" inputMode="numeric" min={1} step={1} value={count} onChange={(e) => edit(setCount)(e.target.value)} />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="rc-harvested">Harvested on</label>
                <input id="rc-harvested" type="date" max={today} value={harvestedOn} onChange={(e) => edit(setHarvestedOn)(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="rc-received">Received on</label>
                <input id="rc-received" type="date" max={today} value={receivedOn} onChange={(e) => edit(setReceivedOn)(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="rc-supplier">Supplier (optional)</label>
              <input id="rc-supplier" value={supplier} maxLength={120} onChange={(e) => edit(setSupplier)(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="rc-weight">Box weight in grams (optional)</label>
              <input
                id="rc-weight"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={weight}
                placeholder={product?.nominalWeightG ? String(product.nominalWeightG) : undefined}
                onChange={(e) => edit(setWeight)(e.target.value)}
                aria-describedby="rc-weight-hint"
              />
              <p className="hint" id="rc-weight-hint">
                {product?.nominalWeightG ? `Leave empty for the usual ${kg(product.nominalWeightG)}.` : 'The weight printed on each label.'}
              </p>
            </div>
            <FormError error={formError ?? check.error} />
            <button type="submit" className="btn" disabled={check.isPending}>
              {check.isPending ? 'Checking…' : 'Check'}
            </button>
          </form>

          <section className="card" aria-labelledby="preview-title" aria-live="polite">
            <h2 id="preview-title">Before you make labels</h2>
            {!preview ? (
              <p className="muted">Fill in what came in and press Check to see the total weight and best-before date.</p>
            ) : (
              <>
                <dl className="wh-facts">
                  <div>
                    <dt>Product</dt>
                    <dd>{preview.productName}</dd>
                  </div>
                  <div>
                    <dt>Boxes</dt>
                    <dd>{preview.boxes}</dd>
                  </div>
                  <div>
                    <dt>Total weight</dt>
                    <dd>{preview.totalKg.toLocaleString('en-IN', { maximumFractionDigits: 2 })} kg</dd>
                  </div>
                  <div>
                    <dt>Best before</dt>
                    <dd>{date(preview.bestBefore)}</dd>
                  </div>
                  <div>
                    <dt>QC</dt>
                    <dd>{preview.requiresQc ? 'Needed before sale' : 'Not needed'}</dd>
                  </div>
                  <div>
                    <dt>Labels</dt>
                    <dd>
                      {preview.labelMm.w} × {preview.labelMm.h} mm
                    </dd>
                  </div>
                </dl>
                {preview.chunked && <p className="hint">A large batch: labels are made in parts, which the next page shows as it goes.</p>}
                <FormError error={create.error} />
                <button type="button" className="btn btn-primary" onClick={onCreate} disabled={create.isPending}>
                  {create.isPending ? 'Making the batch…' : 'Create batch and labels'}
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </>
  )
}
