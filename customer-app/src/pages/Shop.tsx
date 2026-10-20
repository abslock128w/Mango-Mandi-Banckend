import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Stars } from '../stars'
import { ApiError, api, errorMessage, type CatalogueItem } from '../api'
import { STAGE_HINT, STAGE_LABEL, day, rupees } from '../format'
import { useStore } from '../store'
import { ErrorNote, Skeleton } from '../ui'
import { BookAheadCard } from './Preorder'
import { MangoArt } from '../mango'
import type { Stage } from '../api'

export default function Shop() {
  const { pincode, date, setWhere, cart } = useStore()
  const [params, setParams] = useSearchParams()
  // The header's address button opens the pincode form with ?where=1.
  const editing = params.get('where') === '1'
  const search = (params.get('q') ?? '').trim()
  const boxes = cart.reduce((n, l) => n + l.qty, 0)
  const pickDate = useCallback((d: string | null) => setWhere(pincode, d), [setWhere, pincode])
  const closeForm = () => {
    const next = new URLSearchParams(params)
    next.delete('where')
    setParams(next, { replace: true })
  }

  return (
    <>
      {params.get('deleted') === '1' && (
        <p className="note" role="status">
          Your account is deleted. Thank you for buying from MandiMangoes.
        </p>
      )}
      {editing || !pincode ? (
        <PincodeForm
          initial={pincode ?? ''}
          onCancel={pincode ? closeForm : undefined}
          onDone={(pin, first) => {
            setWhere(pin, first)
            closeForm()
          }}
        />
      ) : (
        <Catalogue pincode={pincode} date={date} onDate={pickDate} search={search} />
      )}
      {!search && <BookAheadCard />}
      {!search && <Promises />}
      {boxes > 0 && (
        <div className="sticky-cart">
          <Link to="/cart" className="btn btn-primary btn-block">
            View cart · {boxes} {boxes === 1 ? 'box' : 'boxes'} · {rupees(cart.reduce((s, l) => s + l.price * l.qty, 0))}
          </Link>
        </div>
      )}
    </>
  )
}

function PincodeForm({ initial, onDone, onCancel }: { initial: string; onDone: (pincode: string, firstDate: string | null) => void; onCancel?: () => void }) {
  const [pin, setPin] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const check = useMutation({
    mutationFn: () => api.checkPincode(pin),
    onSuccess: (r) => {
      if (!r.serviceable) setError(`We don't deliver to ${pin} yet.`)
      else if (!r.deliveryDates.length) setError('No delivery days are open right now. Please check back soon.')
      else onDone(pin, r.earliestDeliveryDate)
    },
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(pin)) return setError('Enter your 6-digit pincode.')
    check.mutate()
  }
  return (
    <section className="hero">
      <h1>Mangoes picked for the day you want to eat them</h1>
      <p className="lead">Choose raw, semi-ripe or ripe, and the day it arrives. We pack each box from the batch that will be just right on that day.</p>
      <form className="pin-form" onSubmit={submit} noValidate>
        <label htmlFor="pincode">Your delivery pincode</label>
        <div className="row">
          <input
            id="pincode"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            aria-describedby={error ? 'pin-error' : undefined}
          />
          <button type="submit" className="btn btn-primary" disabled={check.isPending}>
            {check.isPending ? 'Checking…' : 'Show mangoes'}
          </button>
        </div>
        {onCancel && (
          <button type="button" className="link-btn" onClick={onCancel}>
            Keep {initial}
          </button>
        )}
        {(error || check.error) && (
          <p id="pin-error" className="field-error" role="alert">
            {error ?? (check.error as Error).message}
          </p>
        )}
      </form>
      <ol className="how" aria-label="How it works">
        <li>
          <strong>Pick the ripeness and the day</strong>
          <span className="muted small">Raw to ripen at home, semi-ripe for later this week, or ripe to eat on arrival.</span>
        </li>
        <li>
          <strong>We pack from the right batch</strong>
          <span className="muted small">We track every batch from the day it was picked, so your box is at the ripeness you chose on that day.</span>
        </li>
        <li>
          <strong>It arrives at your door</strong>
          <span className="muted small">Free delivery in your chosen time slot, with updates on WhatsApp.</span>
        </li>
      </ol>
      <RipenessGuide />
    </section>
  )
}

const STAGES: Stage[] = ['RAW', 'SEMI_RIPE', 'RIPE']

function RipenessGuide() {
  return (
    <section className="guide" aria-labelledby="guide-title">
      <h2 id="guide-title" className="section-title">
        Which ripeness?
      </h2>
      <ul className="guide-list">
        {STAGES.map((st) => (
          <li key={st}>
            <MangoArt stage={st} size={48} />
            <strong>{STAGE_LABEL[st]}</strong>
            <span className="muted small">{STAGE_HINT[st]}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** What every customer can count on. */
function Promises() {
  return (
    <ul className="promises" aria-label="Our promises">
      <li>
        <strong>Free delivery</strong>
        <span>Paid online, nothing to pay at the door.</span>
      </li>
      <li>
        <strong>Changed your mind?</strong>
        <span>Cancel before packing for a full refund, or move the day.</span>
      </li>
      <li>
        <strong>Damaged or wrong?</strong>
        <span>Tell us with a photo and we send a free replacement.</span>
      </li>
    </ul>
  )
}

function Catalogue({ pincode, date, onDate, search }: { pincode: string; date: string | null; onDate: (d: string | null) => void; search: string }) {
  const q = useQuery({ queryKey: ['catalogue', pincode, date], queryFn: () => api.catalogue(pincode, date) })
  // A saved day that has passed or closed: fall back to the earliest open one.
  const stale = q.error instanceof ApiError && q.error.code === 'INVALID_DATE'
  useEffect(() => {
    if (stale) onDate(null)
  }, [stale, onDate])
  if (q.isPending) return <Skeleton label="Loading mangoes" />
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  if (!q.data.serviceable) return <ErrorNote error={`We don't deliver to ${pincode} yet.`} />
  const all = groupBySku(q.data.items)
  const words = search.toLowerCase()
  const products = words ? all.filter((p) => `${p.name} ${p.variety}`.toLowerCase().includes(words)) : all
  const chosen = q.data.deliveryDate!

  return (
    <>
      {!search && <Shelves products={all} />}
      <section aria-labelledby="pick">
        <h2 id="pick" className="section-title">
          {search ? `Mangoes matching “${search}”` : 'Pick your mangoes'}
        </h2>
        <p className="muted small">Showing what we have for {day(chosen)}. You choose the delivery day at checkout.</p>
        {products.length === 0 && (
          <p className="card empty">
            No mangoes match “{search}”. Try another name, such as Alphonso.
          </p>
        )}
        <div className="products">
          {products.map((p) => (
            <ProductCard key={p.sku} product={p} />
          ))}
        </div>
      </section>
    </>
  )
}

type ShelfItem = { product: ProductGroup; stage: Stage; line: string }

/** Browse-first home: a few short shelves above the full list, each opening the box at that ripeness. */
function Shelves({ products }: { products: ProductGroup[] }) {
  const inStock = (p: ProductGroup, st: Stage) => p.stages.find((s) => s.stage === st && s.qty > 0)
  const ripe: ShelfItem[] = products.flatMap((p) => {
    const s = inStock(p, 'RIPE')
    return s ? [{ product: p, stage: 'RIPE' as Stage, line: `Eat by ${day(s.eatBy)}` }] : []
  })
  const later: ShelfItem[] = products.flatMap((p) => {
    const s = inStock(p, 'SEMI_RIPE') ?? inStock(p, 'RAW')
    return s ? [{ product: p, stage: s.stage, line: s.stage === 'RAW' ? 'Ripens at home in 3 to 4 days' : 'Ready in 1 to 2 days' }] : []
  })
  if (!ripe.length && !later.length) return null
  return (
    <>
      {ripe.length > 0 && <Shelf id="shelf-ripe" title="Ripe to eat now" note="Ready the day it arrives." items={ripe} />}
      {later.length > 0 && <Shelf id="shelf-later" title="Ripen at home this week" note="Firm on arrival, at their best a few days later." items={later} />}
      <section className="card gift-banner" aria-labelledby="gift-title">
        <div>
          <h2 id="gift-title">Send a box as a gift</h2>
          <p className="muted small">Pick any box, then tick "This is a gift" at checkout. We add your note and message them on WhatsApp.</p>
        </div>
        <Link to="/quality" className="link-btn">
          How we pick and check
        </Link>
      </section>
    </>
  )
}

function Shelf({ id, title, note, items }: { id: string; title: string; note: string; items: ShelfItem[] }) {
  return (
    <section className="shelf" aria-labelledby={id}>
      <h2 id={id} className="section-title">
        {title}
      </h2>
      <p className="muted small">{note}</p>
      <ul className="shelf-row">
        {items.map(({ product: p, stage, line }) => (
          <li key={`${p.sku}-${stage}`} className="card shelf-card">
            <MangoArt stage={stage} size={44} />
            <Link to={`/mangoes/${p.sku}?stage=${stage}`} className="card-link shelf-name">
              {p.name}
            </Link>
            <span className="small">
              <span className={`stage-dot stage-${stage.toLowerCase()}`} aria-hidden="true" /> {STAGE_LABEL[stage]}
            </span>
            <span className="muted small">{line}</span>
            <strong>{rupees(p.price)}</strong>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One box on the home page. The whole card opens the product page, where the customer picks the ripeness. */
function ProductCard({ product: p }: { product: ProductGroup }) {
  const { cart } = useStore()
  const inCart = cart.filter((l) => l.sku === p.sku).reduce((n, l) => n + l.qty, 0)
  const open = p.stages.filter((s) => s.qty > 0)
  const soonest = p.stages.map((s) => s.nextAvailableDate).filter(Boolean).sort()[0]
  return (
    <article className="card product product-card" aria-labelledby={`p-${p.sku}`}>
      <MangoArt stage="RIPE" size={56} />
      <div className="product-name">
        <h3 id={`p-${p.sku}`}>
          <Link to={`/mangoes/${p.sku}`} className="card-link">
            {p.name}
          </Link>
        </h3>
        {p.description && <p className="muted small clamp-2">{p.description}</p>}
        <ProductRating sku={p.sku} variety={p.variety} />
        <p className="product-meta">
          <strong className="price">{rupees(p.price)}</strong>
          {open.length > 0 ? (
            <span className="small stage-list">
              {open.map((s) => (
                <span key={s.stage} className="stage-pill">
                  <span className={`stage-dot stage-${s.stage.toLowerCase()}`} aria-hidden="true" />
                  {STAGE_LABEL[s.stage]}
                </span>
              ))}
            </span>
          ) : (
            <span className="small sold-out">Sold out{soonest ? `, back ${day(soonest)}` : ''}</span>
          )}
        </p>
        {inCart > 0 && (
          <p className="small ok-text">
            {inCart} in your cart
          </p>
        )}
      </div>
      <svg className="card-chevron" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </article>
  )
}

/** Sold out on every open day: a WhatsApp message when it is back. */
export function NotifyMe({ item, label }: { item: CatalogueItem; label: string }) {
  const { profile, pincode } = useStore()
  const location = useLocation()
  const queryClient = useQueryClient()
  const alerts = useQuery({ queryKey: ['stock-alerts'], queryFn: api.stockAlerts, enabled: !!profile })
  const add = useMutation({
    mutationFn: () => api.addStockAlert({ sku: item.sku, stage: item.stage, pincode: pincode! }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stock-alerts'] }),
  })
  if (!profile) {
    return (
      <Link to={`/sign-in?next=${encodeURIComponent(location.pathname)}`} className="link-btn">
        Sign in to hear when it's back
      </Link>
    )
  }
  const waiting = alerts.data?.some((a) => a.sku === item.sku && a.stage === item.stage && !a.notifiedAt)
  if (waiting) return <span className="ok-text">We'll message you on WhatsApp when it's back</span>
  return (
    <>
      <button type="button" className="link-btn" disabled={add.isPending || alerts.isPending} onClick={() => add.mutate()} aria-label={`Tell me when ${label} is back`}>
        Tell me when it's back
      </button>
      {add.isError && (
        <span className="field-error" role="alert">
          {' '}
          {errorMessage(add.error)}
        </span>
      )}
    </>
  )
}

export type ProductGroup = { sku: string; name: string; variety: string; boxSize: string; price: number; description: string; stages: CatalogueItem[] }

export function groupBySku(items: CatalogueItem[]) {
  const map = new Map<string, ProductGroup>()
  for (const i of items) {
    const p = map.get(i.sku) ?? { sku: i.sku, name: i.name, variety: i.variety, boxSize: i.boxSize, price: i.price, description: i.description ?? '', stages: [] }
    p.stages.push(i)
    map.set(i.sku, p)
  }
  return [...map.values()]
}

/** The variety's average and review count. One request per variety (the 3 and 5 kg boxes share it). */
export function ProductRating({ sku, variety, href }: { sku: string; variety: string; href?: string }) {
  const q = useQuery({ queryKey: ['rating', variety || sku], queryFn: () => api.productReviews(sku, { limit: 1 }), staleTime: 5 * 60_000 })
  const s = q.data?.summary
  if (!s || !s.count || s.average == null) return null
  const body = (
    <>
      <Stars value={s.average} small />
      <span className="small">
        {s.average.toFixed(1)} · {s.count} {s.count === 1 ? 'review' : 'reviews'}
      </span>
    </>
  )
  return href ? (
    <a href={href} className="product-rating">
      {body}
    </a>
  ) : (
    <span className="product-rating">{body}</span>
  )
}
