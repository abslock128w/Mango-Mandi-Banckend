// Bulk Deals: managers make listings for large orders. Each listing sells one
// product from the same stock and checkout as the shop, with its own text,
// photos and quantity-based prices. The API checks every rule again and refuses
// non-managers whatever this page shows.
import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { shrinkPhoto } from '../photo'
import { RIPENESS_LABEL, dateTime, rupees, type Tone } from '../format'
import type { BulkEvent, BulkListing, BulkListingInput, BulkStatus, Product, Ripeness } from '../types'
import {
  AuthedPhoto,
  BackLink,
  Badge,
  ConfirmDialog,
  EmptyState,
  FormError,
  LinkRow,
  QueryError,
  RowLink,
  Spinner,
  StatusFilter,
  scrollRegion,
  usePageTitle,
  useToast,
} from '../ui'

const STATUSES: BulkStatus[] = ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED']
const STATUS_LABEL: Record<BulkStatus, string> = { DRAFT: 'Draft', PUBLISHED: 'Published', UNPUBLISHED: 'Unpublished', ARCHIVED: 'Archived' }
const STATUS_TONE: Record<BulkStatus, Tone> = { DRAFT: 'neutral', PUBLISHED: 'good', UNPUBLISHED: 'warn', ARCHIVED: 'neutral' }
const STAGES: Ripeness[] = ['RIPE', 'SEMI_RIPE', 'RAW']
const MAX_TIERS = 8
const MAX_PHOTOS = 8

export function StatusBadge({ status, onSale }: { status: BulkStatus; onSale?: boolean }) {
  if (status === 'PUBLISHED' && onSale === false) return <Badge tone="warn">Published, not in the shop now</Badge>
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
}

// ---------------------------------------------------------------- list

export default function BulkDeals() {
  usePageTitle('Bulk Deals')
  const navigate = useNavigate()
  const [status, setStatus] = useState<BulkStatus | null>(null)
  const [page, setPage] = useState(1)
  const q = useQuery({ queryKey: ['bulk-listings', status, page], queryFn: () => api.bulkListings(status, page) })
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1

  return (
    <>
      <div className="topbar">
        <h1>Bulk Deals</h1>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => navigate('/bulk-deals/new')}>
          New bulk deal
        </button>
      </div>
      <section className="card">
        <StatusFilter
          value={status}
          options={STATUSES}
          labels={STATUS_LABEL}
          onChange={(s) => {
            setStatus(s)
            setPage(1)
          }}
        />
        {status === null && <p className="small muted">All shows every deal except archived ones.</p>}
        {q.isPending ? (
          <Spinner label="Loading bulk deals" />
        ) : q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data.items.length ? (
          <EmptyState>{status ? `No ${STATUS_LABEL[status].toLowerCase()} deals.` : 'No bulk deals yet. Make the first one for offices and events.'}</EmptyState>
        ) : (
          <div {...scrollRegion('Bulk deals')}>
            <table>
              <thead>
                <tr>
                  <th>Deal</th>
                  <th>
                    <span className="sr-only">Photo</span>
                  </th>
                  <th>Status</th>
                  <th className="num">From</th>
                  <th className="num">Minimum</th>
                  <th>Ready to publish</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((l) => (
                  <LinkRow key={l.id}>
                    <td>
                      <RowLink to={`/bulk-deals/${l.id}`} more="(open)">
                        <strong>{l.title}</strong>
                      </RowLink>
                      <div className="small muted">{l.productName}</div>
                    </td>
                    <td>
                      {l.photoUrl ? (
                        <AuthedPhoto
                          load={() => api.bulkPhotoUrl(l.id, l.photoUrl!.split('/').pop()!)}
                          photoKey={l.photoUrl}
                          alt=""
                          what="photo"
                          className="product-thumb"
                        />
                      ) : (
                        <span className="product-thumb product-photo-empty" aria-hidden="true" />
                      )}
                    </td>
                    <td>
                      <StatusBadge status={l.status} onSale={l.onSale} />
                    </td>
                    <td className="num">{rupees(Math.min(...l.tiers.map((t) => t.unitPrice)))}</td>
                    <td className="num">{l.minQty} boxes</td>
                    <td>
                      {l.status === 'ARCHIVED' ? (
                        <span className="muted">—</span>
                      ) : l.publishProblems.length ? (
                        <span className="small">
                          {l.publishProblems.length} to fix<span className="sr-only">: {l.publishProblems.join('; ')}</span>
                        </span>
                      ) : (
                        <span className="small">Yes</span>
                      )}
                    </td>
                  </LinkRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="pager">
            <button type="button" className="btn btn-small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span className="small">
              Page {page} of {pages}
            </span>
            <button type="button" className="btn btn-small" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        )}
        <p className="small muted">
          A deal sells boxes from the same stock as the shop. Prices are per box, the same for every ripeness, and the bigger tier must be cheaper.
          Orders already placed keep the price they were sold at.
        </p>
      </section>
    </>
  )
}

// ---------------------------------------------------------------- editor

interface TierRow {
  minQty: string
  price: string
}
interface Form {
  sku: string
  title: string
  description: string
  origin: string
  stages: Ripeness[]
  minQty: string
  qtyStep: string
  maxQty: string
  tiers: TierRow[]
  startsAt: string
  endsAt: string
  sortOrder: string
}

/** ISO time → the value of a datetime-local box, in India time. */
function toLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(new Date(iso).getTime() + 330 * 60_000)
  return d.toISOString().slice(0, 16)
}
/** A datetime-local value, read as India time → ISO with its offset. */
const fromLocal = (v: string) => (v ? `${v}:00+05:30` : null)

const toForm = (l: BulkListing | null): Form => ({
  sku: l?.sku ?? '',
  title: l?.title ?? '',
  description: l?.description ?? '',
  origin: l?.origin ?? '',
  stages: l?.stages ?? ['RIPE'],
  minQty: String(l?.minQty ?? 10),
  qtyStep: String(l?.qtyStep ?? 1),
  maxQty: l?.maxQty != null ? String(l.maxQty) : '',
  tiers: l?.tiers.map((t) => ({ minQty: String(t.minQty), price: String(t.unitPrice / 100) })) ?? [{ minQty: '10', price: '' }],
  startsAt: toLocal(l?.startsAt ?? null),
  endsAt: toLocal(l?.endsAt ?? null),
  sortOrder: String(l?.sortOrder ?? 0),
})

const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN)

/**
 * The form as the API takes it, and what is wrong with it. The same rules as the API's
 * listingProblems, so most mistakes show while typing; the API checks them all again.
 */
function readForm(f: Form): { input: BulkListingInput | null; problems: string[] } {
  const problems: string[] = []
  if (!f.sku) problems.push('Choose the product (box) this deal sells')
  if (f.title.trim().length < 3) problems.push('Give the deal a name of 3 characters or more')
  if (!f.stages.length) problems.push('Offer at least one ripeness')
  const minQty = whole(f.minQty)
  const qtyStep = whole(f.qtyStep)
  const maxQty = f.maxQty.trim() ? whole(f.maxQty) : null
  if (!(minQty >= 1)) problems.push('The minimum order is a whole number of boxes, 1 or more')
  if (!(qtyStep >= 1)) problems.push('Boxes go up in steps of 1 or more')
  if (maxQty !== null && !(maxQty >= 1)) problems.push('The most boxes per order is a whole number, or leave it empty')
  const tiers = f.tiers.map((t) => ({ minQty: whole(t.minQty), unitPrice: Math.round(Number(t.price) * 100) }))
  tiers.forEach((t, i) => {
    if (!(t.minQty >= 1)) problems.push(`Tier ${i + 1}: enter the number of boxes it starts at`)
    if (!(t.unitPrice > 0)) problems.push(`Tier ${i + 1}: enter the price per box in rupees`)
  })
  if (minQty >= 1 && qtyStep >= 1) {
    if (maxQty != null && maxQty >= 1) {
      if (maxQty < minQty) problems.push('The most boxes per order is below the minimum')
      else if ((maxQty - minQty) % qtyStep) problems.push(`The most boxes per order must be the minimum plus steps of ${qtyStep}`)
    }
    if (tiers[0]?.minQty >= 1 && tiers[0].minQty !== minQty) problems.push(`The first price tier must start at the minimum order (${minQty} boxes)`)
    tiers.forEach((t, i) => {
      if (!(t.minQty >= 1) || !(t.unitPrice > 0)) return
      const prev = tiers[i - 1]
      if (prev && t.minQty <= prev.minQty) problems.push(`Tier ${i + 1} must start at more boxes than tier ${i}`)
      if (prev && prev.unitPrice > 0 && t.unitPrice >= prev.unitPrice) problems.push(`Tier ${i + 1} must cost less per box than tier ${i}`)
      if ((t.minQty - minQty) % qtyStep) problems.push(`Tier ${i + 1} starts at ${t.minQty} boxes, which can't be ordered in steps of ${qtyStep} from ${minQty}`)
      if (maxQty != null && t.minQty > maxQty) problems.push(`Tier ${i + 1} starts above the most boxes per order`)
    })
  }
  if (f.startsAt && f.endsAt && f.endsAt <= f.startsAt) problems.push('The sale must end after it starts')
  if (problems.length) return { input: null, problems }
  return {
    problems,
    input: {
      sku: f.sku,
      title: f.title.trim(),
      description: f.description.trim(),
      origin: f.origin.trim(),
      stages: f.stages,
      minQty,
      qtyStep,
      maxQty,
      tiers,
      startsAt: fromLocal(f.startsAt),
      endsAt: fromLocal(f.endsAt),
      sortOrder: Math.max(0, Math.round(Number(f.sortOrder) || 0)),
    },
  }
}

/** /bulk-deals/:id (or /bulk-deals/new): the editor, photos, publishing, a preview and the history. */
export function BulkDealEditor() {
  const { id = 'new' } = useParams()
  const isNew = id === 'new'
  const q = useQuery({ queryKey: ['bulk-listing', id], queryFn: () => api.bulkListing(id), enabled: !isNew })
  const products = useQuery({ queryKey: ['products'], queryFn: api.products })
  usePageTitle(isNew ? 'New bulk deal' : (q.data?.title ?? 'Bulk deal'))

  if (!isNew && q.isPending) return <Spinner label="Loading the deal" />
  if (!isNew && q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />
  if (products.isPending) return <Spinner label="Loading products" />
  if (products.isError) return <QueryError error={products.error} onRetry={() => products.refetch()} />
  const listing = isNew ? null : q.data!
  // Keyed by version, so the form starts again from what was saved after each change.
  return <Editor key={listing ? `${listing.id}-${listing.version}` : 'new'} listing={listing} products={products.data} />
}

function Editor({ listing, products }: { listing: BulkListing | null; products: Product[] }) {
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [f, setF] = useState<Form>(() => toForm(listing))
  const [tried, setTried] = useState(false)
  const archived = listing?.status === 'ARCHIVED'
  const { input, problems } = useMemo(() => readForm(f), [f])
  const product = products.find((p) => p.sku === f.sku)
  const dirty = JSON.stringify(f) !== JSON.stringify(toForm(listing))

  const done = (l: BulkListing) => {
    queryClient.setQueryData(['bulk-listing', l.id], l)
    void queryClient.invalidateQueries({ queryKey: ['bulk-listings'] })
    void queryClient.invalidateQueries({ queryKey: ['bulk-history', l.id] })
  }
  const save = useMutation({
    mutationFn: (i: BulkListingInput) => (listing ? api.updateBulkListing(listing.id, i) : api.addBulkListing(i)),
    onSuccess: (l) => {
      done(l)
      toast.success(listing ? 'Saved' : 'Draft saved. Add photos, then publish.')
      if (!listing) navigate(`/bulk-deals/${l.id}`, { replace: true })
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setTried(true)
    if (input) save.mutate(input)
  }
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const setTier = (i: number, k: keyof TierRow, v: string) => setF({ ...f, tiers: f.tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)) })

  return (
    <>
      <BackLink to="/bulk-deals">Bulk Deals</BackLink>
      <div className="topbar">
        <h1>{listing ? listing.title : 'New bulk deal'}</h1>
        {listing && <StatusBadge status={listing.status} onSale={listing.onSale} />}
      </div>
      {listing && <Publishing listing={listing} dirty={dirty} onDone={done} />}

      <div className="bulk-editor">
        <form className="card" onSubmit={submit} noValidate aria-labelledby="deal-form-title">
          <h2 id="deal-form-title">Details and prices</h2>
          {archived && <p className="notice notice-info">This deal is archived. It is kept for past orders and can't be changed.</p>}
          <fieldset disabled={archived} className="bulk-fields">
            <div className="field">
              <label htmlFor="deal-product">Product (box)</label>
              <select id="deal-product" value={f.sku} onChange={set('sku')}>
                <option value="">Choose a product</option>
                {products.map((p) => (
                  <option key={p.sku} value={p.sku}>
                    {p.name} ({p.sku}){p.active === false ? ', not on sale' : ''}
                  </option>
                ))}
              </select>
              <p className="hint">The deal sells this box from the same stock as the shop.{product?.price != null && ` A single box is ${rupees(product.price)}.`}</p>
            </div>
            <div className="field">
              <label htmlFor="deal-title">Deal name</label>
              <input id="deal-title" maxLength={80} value={f.title} onChange={set('title')} />
              <p className="hint">What customers see, like "Alphonso for offices".</p>
            </div>
            <div className="field">
              <label htmlFor="deal-description">Description</label>
              <textarea id="deal-description" rows={3} maxLength={2000} value={f.description} onChange={set('description')} />
              <p className="hint">At least 20 characters before it can be published.</p>
            </div>
            <div className="field">
              <label htmlFor="deal-origin">Where it is from (optional)</label>
              <input id="deal-origin" maxLength={120} value={f.origin} onChange={set('origin')} />
            </div>
            <fieldset className="field">
              <legend>Ripeness offered</legend>
              {STAGES.map((s) => (
                <label key={s} className="check-inline">
                  <input
                    type="checkbox"
                    checked={f.stages.includes(s)}
                    onChange={(e) => setF({ ...f, stages: e.target.checked ? STAGES.filter((x) => x === s || f.stages.includes(x)) : f.stages.filter((x) => x !== s) })}
                  />{' '}
                  {RIPENESS_LABEL[s]}
                </label>
              ))}
              <p className="hint">One price whatever the ripeness.</p>
            </fieldset>
            <div className="field-row">
              <div className="field">
                <label htmlFor="deal-min">Minimum boxes</label>
                <input id="deal-min" inputMode="numeric" value={f.minQty} onChange={set('minQty')} />
              </div>
              <div className="field">
                <label htmlFor="deal-step">In steps of</label>
                <input id="deal-step" inputMode="numeric" value={f.qtyStep} onChange={set('qtyStep')} />
              </div>
              <div className="field">
                <label htmlFor="deal-max">Most per order (optional)</label>
                <input id="deal-max" inputMode="numeric" value={f.maxQty} onChange={set('maxQty')} />
              </div>
            </div>
            <fieldset className="field">
              <legend>Price per box, by quantity</legend>
              <table className="tier-table">
                <thead>
                  <tr>
                    <th scope="col">From boxes</th>
                    <th scope="col">Price per box (₹)</th>
                    <th scope="col">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {f.tiers.map((t, i) => (
                    <tr key={i}>
                      <td>
                        <input aria-label={`Tier ${i + 1} starts at, boxes`} inputMode="numeric" value={t.minQty} onChange={(e) => setTier(i, 'minQty', e.target.value)} />
                      </td>
                      <td>
                        <input aria-label={`Tier ${i + 1} price per box, rupees`} inputMode="decimal" value={t.price} onChange={(e) => setTier(i, 'price', e.target.value)} />
                      </td>
                      <td>
                        {f.tiers.length > 1 && (
                          <button type="button" className="btn btn-small" onClick={() => setF({ ...f, tiers: f.tiers.filter((_, j) => j !== i) })}>
                            Remove<span className="sr-only"> tier {i + 1}</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {f.tiers.length < MAX_TIERS && (
                <button type="button" className="btn btn-small" onClick={() => setF({ ...f, tiers: [...f.tiers, { minQty: '', price: '' }] })}>
                  Add a tier
                </button>
              )}
              <p className="hint">Each tier runs until the next one starts. The first starts at the minimum; each bigger tier must cost less per box.</p>
            </fieldset>
            <div className="field-row">
              <div className="field">
                <label htmlFor="deal-starts">Sale starts (optional, India time)</label>
                <input id="deal-starts" type="datetime-local" value={f.startsAt} onChange={set('startsAt')} />
              </div>
              <div className="field">
                <label htmlFor="deal-ends">Sale ends (optional, India time)</label>
                <input id="deal-ends" type="datetime-local" value={f.endsAt} onChange={set('endsAt')} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="deal-order">Position in Bulk Deals</label>
              <input id="deal-order" inputMode="numeric" value={f.sortOrder} onChange={set('sortOrder')} />
              <p className="hint">Lower numbers show first.</p>
            </div>
            {problems.length > 0 && (tried || listing) && (
              <div className="notice notice-warn" role={tried ? 'alert' : undefined}>
                <strong>Fix these to save:</strong>
                <ul>
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            <FormError error={save.error} />
            <div className="bulk-actions">
              <button type="submit" className="btn btn-primary" disabled={save.isPending || (Boolean(listing) && !dirty)}>
                {save.isPending ? 'Saving…' : listing ? 'Save changes' : 'Save draft'}
              </button>
              {listing && dirty && (
                <button type="button" className="btn" onClick={() => setF(toForm(listing))}>
                  Undo changes
                </button>
              )}
            </div>
            {listing?.status === 'PUBLISHED' && <p className="small muted">This deal is live: a change applies from the next checkout. Orders already placed keep their price.</p>}
          </fieldset>
        </form>

        <div className="bulk-side">
          {listing ? <Photos listing={listing} onDone={done} /> : <section className="card"><h2>Photos</h2><p className="muted">Save the draft first, then add photos.</p></section>}
          <Preview form={f} input={input} product={product} listing={listing} />
          {listing && <History listingId={listing.id} />}
        </div>
      </div>
    </>
  )
}

/** Publish, unpublish and archive, with what stops publishing. */
function Publishing({ listing, dirty, onDone }: { listing: BulkListing; dirty: boolean; onDone: (l: BulkListing) => void }) {
  const toast = useToast()
  const [confirm, setConfirm] = useState<'unpublish' | 'archive' | null>(null)
  const move = useMutation({
    mutationFn: (to: 'publish' | 'unpublish' | 'archive') => api.moveBulkListing(listing.id, to),
    onSuccess: (l, to) => {
      onDone(l)
      setConfirm(null)
      toast.success(to === 'publish' ? 'Published: it is in the shop' : to === 'unpublish' ? 'Unpublished: taken out of the shop' : 'Archived')
    },
  })
  if (listing.status === 'ARCHIVED') return null
  const canPublish = listing.status !== 'PUBLISHED' && !listing.publishProblems.length
  return (
    <section className="card" aria-labelledby="publish-title">
      <h2 id="publish-title">Publishing</h2>
      {listing.status === 'PUBLISHED' ? (
        <p>
          {listing.onSale ? 'Customers can see and buy this deal now.' : "Published, but not in the shop right now: it is outside its sale dates, or its product is not on sale."}
        </p>
      ) : listing.publishProblems.length ? (
        <div className="notice notice-warn">
          <strong>Before it can be published:</strong>
          <ul>
            {listing.publishProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p>Ready to publish.</p>
      )}
      {listing.status === 'PUBLISHED' && listing.publishProblems.length > 0 && (
        <div className="notice notice-warn">
          <ul>
            {listing.publishProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {dirty && <p className="small muted">Save your changes before publishing.</p>}
      <FormError error={confirm ? null : move.error} />
      <div className="bulk-actions">
        {listing.status !== 'PUBLISHED' && (
          <button type="button" className="btn btn-primary" disabled={!canPublish || dirty || move.isPending} onClick={() => move.mutate('publish')}>
            Publish
          </button>
        )}
        {listing.status === 'PUBLISHED' && (
          <button type="button" className="btn" disabled={move.isPending} onClick={() => setConfirm('unpublish')}>
            Unpublish
          </button>
        )}
        <button type="button" className="btn" disabled={move.isPending} onClick={() => setConfirm('archive')}>
          Archive
        </button>
      </div>
      {confirm && (
        <ConfirmDialog
          title={confirm === 'archive' ? `Archive ${listing.title}?` : `Unpublish ${listing.title}?`}
          tone={confirm === 'archive' ? 'danger' : undefined}
          confirmLabel={confirm === 'archive' ? 'Archive deal' : 'Unpublish'}
          cancelLabel="Keep it"
          busy={move.isPending}
          error={move.error}
          onClose={() => setConfirm(null)}
          onConfirm={() => move.mutate(confirm)}
        >
          <p>
            {confirm === 'archive'
              ? 'It leaves the shop for good and can no longer be changed or published. Past orders keep it.'
              : 'It leaves the shop now, and customers who had it in their cart are asked to remove it. You can publish it again later.'}
          </p>
          <p className="small muted">Orders already placed are not affected.</p>
        </ConfirmDialog>
      )}
    </section>
  )
}

/** The gallery: the first photo is the main one. Add, reorder and remove. */
function Photos({ listing, onDone }: { listing: BulkListing; onDone: (l: BulkListing) => void }) {
  const toast = useToast()
  const [error, setError] = useState<unknown>(null)
  const archived = listing.status === 'ARCHIVED'
  const add = useMutation({
    mutationFn: async (files: File[]) => {
      let l = listing
      for (const file of files.slice(0, MAX_PHOTOS - listing.photos.length)) {
        let photo: Blob
        try {
          photo = await shrinkPhoto(file)
        } catch {
          throw new Error(`${file.name} is not a photo. Choose JPEG, PNG or WebP images.`)
        }
        l = await api.addBulkPhoto(listing.id, photo)
        onDone(l)
      }
      return l
    },
    onSuccess: () => toast.success('Photos added'),
    onError: setError,
  })
  const order = useMutation({ mutationFn: (ids: string[]) => api.orderBulkPhotos(listing.id, ids), onSuccess: onDone, onError: setError })
  const remove = useMutation({ mutationFn: (photoId: string) => api.removeBulkPhoto(listing.id, photoId), onSuccess: onDone, onError: setError })
  const ids = listing.photos.map((p) => p.id)
  const moveTo = (from: number, to: number) => {
    const next = [...ids]
    const [x] = next.splice(from, 1)
    next.splice(to, 0, x)
    setError(null)
    order.mutate(next)
  }
  const busy = add.isPending || order.isPending || remove.isPending
  return (
    <section className="card" aria-labelledby="photos-title">
      <h2 id="photos-title">
        Photos <span className="small muted">({listing.photos.length} of {MAX_PHOTOS})</span>
      </h2>
      {!listing.photos.length && <p className="muted">No photos yet. A deal needs at least one to be published.</p>}
      <ol className="bulk-photos">
        {listing.photos.map((p, i) => (
          <li key={p.id}>
            <AuthedPhoto load={() => api.bulkPhotoUrl(listing.id, p.id)} photoKey={p.id} alt={`Photo ${i + 1}${p.primary ? ', the main photo' : ''}`} className="bulk-photo" />
            {p.primary && <Badge tone="info">Main photo</Badge>}
            {!archived && (
              <div className="bulk-actions">
                {i > 0 && (
                  <button type="button" className="btn btn-small" disabled={busy} onClick={() => moveTo(i, 0)}>
                    Make main<span className="sr-only"> photo {i + 1}</span>
                  </button>
                )}
                {i > 0 && (
                  <button type="button" className="btn btn-small" disabled={busy} onClick={() => moveTo(i, i - 1)}>
                    Earlier<span className="sr-only">: photo {i + 1}</span>
                  </button>
                )}
                {i < ids.length - 1 && (
                  <button type="button" className="btn btn-small" disabled={busy} onClick={() => moveTo(i, i + 1)}>
                    Later<span className="sr-only">: photo {i + 1}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => {
                    setError(null)
                    remove.mutate(p.id)
                  }}
                >
                  Remove<span className="sr-only"> photo {i + 1}</span>
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {!archived && listing.photos.length < MAX_PHOTOS && (
        <div className="field">
          <label htmlFor="bulk-photo-input" className="btn btn-small">
            {add.isPending ? 'Uploading…' : 'Add photos'}
          </label>
          <input
            id="bulk-photo-input"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={busy}
            aria-describedby="bulk-photo-hint"
            onChange={(e) => {
              setError(null)
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (files.length) add.mutate(files)
            }}
          />
          <p className="hint" id="bulk-photo-hint">
            JPEG, PNG or WebP, up to 5 MB each. Location and camera details are removed. The first photo is the main one in the shop.
          </p>
        </div>
      )}
      <FormError error={error} />
    </section>
  )
}

/** How the shop will show the prices: each tier's range and box price, and a saving only where a tier is cheaper than a single box. */
function Preview({ form, input, product, listing }: { form: Form; input: BulkListingInput | null; product: Product | undefined; listing: BulkListing | null }) {
  const retail = product?.price ?? null
  const tiers = input?.tiers ?? []
  const cap = listing?.orderMax
  return (
    <section className="card" aria-labelledby="preview-title">
      <h2 id="preview-title">Preview</h2>
      <p className="eyebrow">Bulk deal</p>
      <p>
        <strong>{form.title || 'Deal name'}</strong>
        <br />
        <span className="small muted">{product ? `${product.name} · ${product.variety}` : 'Choose a product'}</span>
      </p>
      {form.description && <p className="small">{form.description}</p>}
      {input ? (
        <table>
          <caption className="sr-only">Price per box</caption>
          <thead>
            <tr>
              <th>Boxes</th>
              <th className="num">Per box</th>
              <th className="num">Saving</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t, i) => {
              const upTo = tiers[i + 1] ? tiers[i + 1].minQty - 1 : input.maxQty
              return (
                <tr key={t.minQty}>
                  <td>{upTo == null ? `${t.minQty}+` : upTo === t.minQty ? `${t.minQty}` : `${t.minQty} to ${upTo}`}</td>
                  <td className="num">{rupees(t.unitPrice)}</td>
                  <td className="num">{retail != null && retail > t.unitPrice ? `${rupees(retail - t.unitPrice)} a box` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <p className="small muted">The price table shows once the rules are complete.</p>
      )}
      {retail != null && tiers.some((t) => t.unitPrice >= retail) && (
        <p className="small notice notice-warn">A tier costs the same as or more than a single box ({rupees(retail)}); the shop shows no saving for it.</p>
      )}
      {input && (
        <p className="small muted">
          Customers order {input.minQty} boxes or more{input.qtyStep > 1 ? `, in steps of ${input.qtyStep}` : ''}
          {cap != null ? `, up to ${cap} per order` : ''}.
          {cap != null && input.maxQty != null && cap < input.maxQty && ' The unpaid-box rule (Planning → Rules) caps it lower than the most per order you set.'}
        </p>
      )}
      {listing?.status === 'PUBLISHED' && listing.onSale && (
        <p className="small">Live in the shop under the Bulk Deals tab.</p>
      )}
    </section>
  )
}

const ACTION_LABEL: Record<string, string> = {
  CREATED: 'Created',
  EDITED: 'Edited',
  PRICING_CHANGED: 'Prices or quantities changed',
  PUBLISHED: 'Published',
  UNPUBLISHED: 'Unpublished',
  ARCHIVED: 'Archived',
  PHOTO_ADDED: 'Photo added',
  PHOTO_REMOVED: 'Photo removed',
  PHOTOS_REORDERED: 'Photos reordered',
}
const FIELD_LABEL: Record<string, string> = {
  sku: 'product', title: 'name', description: 'description', origin: 'origin', stages: 'ripeness', minQty: 'minimum', qtyStep: 'step', maxQty: 'most per order',
  tiers: 'prices', startsAt: 'sale start', endsAt: 'sale end', sortOrder: 'position',
}

function changeText(e: BulkEvent): string | null {
  if (e.action === 'CREATED') return null
  const fields = Object.keys(e.changes ?? {}).filter((k) => k in FIELD_LABEL)
  if (!fields.length) return null
  const tiers = e.changes.tiers as { from: { minQty: number; unitPrice: number }[]; to: { minQty: number; unitPrice: number }[] } | undefined
  const fmt = (ts: { minQty: number; unitPrice: number }[]) => ts.map((t) => `${t.minQty}+ ${rupees(t.unitPrice)}`).join(', ')
  return [
    `Changed ${fields.map((k) => FIELD_LABEL[k]).join(', ')}`,
    tiers?.from && tiers?.to ? `prices were ${fmt(tiers.from)}, now ${fmt(tiers.to)}` : null,
  ]
    .filter(Boolean)
    .join('; ')
}

function History({ listingId }: { listingId: string }) {
  const q = useQuery({ queryKey: ['bulk-history', listingId], queryFn: () => api.bulkHistory(listingId) })
  return (
    <section className="card" aria-labelledby="history-title">
      <h2 id="history-title">History</h2>
      {q.isPending ? (
        <Spinner label="Loading history" />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <ol className="bulk-history">
          {q.data.map((e) => (
            <li key={e.id}>
              <strong>{ACTION_LABEL[e.action] ?? e.action}</strong> <span className="small muted">version {e.version}</span>
              <div className="small muted">
                {dateTime(e.at)}
                {e.by ? ` · ${e.by}` : ''}
              </div>
              {changeText(e) && <div className="small">{changeText(e)}</div>}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
