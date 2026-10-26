import { memo, useCallback, useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Stars } from '../stars'
import { ApiError, api, errorMessage, type CatalogueItem, type RatingSummary } from '../api'
import { STAGE_HINT, STAGE_LABEL, boxContents, day, rupees } from '../format'
import { useStore } from '../store'
import { ErrorNote } from '../ui'
import { catalogueQuery, productsQuery } from '../queries'
import { BookAheadCard } from './BookAheadCard'
import { MangoArt, ProductImage } from '../mango'
import type { Stage } from '../api'
import { UnpaidOrderBanner } from '../unpaid'
import { useFeatures } from '../features'
import { HeartButton, HeartProblem } from '../favourites'
import { InstallCard } from '../pwa'
import { DEFAULT_VIEW, SORTS, applyView, isFiltered, readView, varietiesOf, writeView, type ShopView, type SortKey, type Viewable } from '../shop-view'

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
      <UnpaidOrderBanner />
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
        >
          {/* UX-5: the boxes and prices before a pincode; the pincode is needed for stock, ripeness and adding to the cart. */}
          {!pincode && <PriceList search={search} />}
        </PincodeForm>
      ) : (
        <Catalogue pincode={pincode} date={date} onDate={pickDate} search={search} />
      )}
      {!search && <InstallCard />}
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

function PincodeForm({
  initial,
  onDone,
  onCancel,
  children,
}: {
  initial: string
  onDone: (pincode: string, firstDate: string | null) => void
  onCancel?: () => void
  children?: ReactNode
}) {
  return (
    <section className="hero">
      <img src="/brand/logo-320.webp" srcSet="/brand/logo-320.webp 1x, /brand/logo-640.webp 2x" width="128" height="128" alt="MandiMangoes" className="hero-logo" />
      <h1>Mangoes picked for the day you want to eat them</h1>
      <p className="lead">Choose raw, semi-ripe or ripe, and the day it arrives. We pack each box from the batch that will be just right on that day.</p>
      <PincodeCheck initial={initial} onDone={onDone} onCancel={onCancel} />
      {children}
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

/** The pincode box: checks we deliver there and that a day is open. Also on the product page before a pincode is set. */
export function PincodeCheck({
  initial,
  onDone,
  onCancel,
  label = 'Your delivery pincode',
  submitLabel = 'Show mangoes',
}: {
  initial: string
  onDone: (pincode: string, firstDate: string | null) => void
  onCancel?: () => void
  label?: string
  submitLabel?: string
}) {
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
      <form className="pin-form" onSubmit={submit} noValidate>
        <label htmlFor="pincode">{label}</label>
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
            {check.isPending ? 'Checking…' : submitLabel}
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
  )
}

/**
 * UX-5: every box and its price before a pincode is entered (search and ad visitors, and people
 * outside our area, see what we sell). No stock or ripeness here: those depend on the delivery day.
 */
function PriceList({ search }: { search: string }) {
  const q = useQuery(productsQuery())
  const words = search.toLowerCase()
  const matching = useMemo(() => {
    const items = q.data?.items ?? []
    return words ? items.filter((p) => `${p.name} ${p.variety}`.toLowerCase().includes(words)) : items
  }, [q.data, words])
  // Before a pincode there is no stock to filter on: sort, and the variety filter, only.
  const shop = useShopView(matching, null)
  if (q.isPending) return null
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  if (!q.data.items.length) return null
  const products = shop.shown
  return (
    <section aria-labelledby="price-list" className="price-list">
      <h2 id="price-list" className="section-title">
        {search ? `Mangoes matching “${search}”` : 'Our mangoes and prices'}
      </h2>
      <p className="muted small">Price per box, free delivery. Enter your pincode to see the ripeness and days we have for you.</p>
      {shop.controls}
      {matching.length === 0 && <p className="card empty">No mangoes match “{search}”. Try another name, such as Alphonso.</p>}
      <ul className="tiles">
        {products.map((p, i) => (
          <li key={p.sku} className="card tile">
            <div className="tile-img">
              <ProductImage photoUrl={p.photoUrl} name={p.name} size={88} eager={i < FIRST_SCREEN_TILES} />
            </div>
            <div className="tile-body">
              <h3 className="tile-name">
                <Link to={`/mangoes/${p.sku}`} className="card-link">
                  {p.name}
                </Link>
              </h3>
              {/* After the name, so a screen reader hears which box it is; drawn on the photo's corner. */}
              <HeartButton sku={p.sku} name={p.name} className="tile-heart" />
              <ProductRating sku={p.sku} variety={p.variety} />
              <p className="tile-foot">
                <strong className="price">{rupees(p.price)}</strong>
                {boxContents(p) && <span className="small muted">{boxContents(p)}</span>}
                <HeartProblem sku={p.sku} />
              </p>
            </div>
          </li>
        ))}
      </ul>
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
  const q = useQuery(catalogueQuery(pincode, date))
  const { cart } = useStore()
  // Grouped once per answer, so each tile gets the same product object until the stock changes.
  const all = useMemo(() => (q.data ? groupBySku(q.data.items) : []), [q.data])
  const words = search.toLowerCase()
  const matching = useMemo(() => (words ? all.filter((p) => `${p.name} ${p.variety}`.toLowerCase().includes(words)) : all), [all, words])
  const shop = useShopView(matching, stagesOf)
  // A saved day that has passed or closed: fall back to the earliest open one.
  const stale = q.error instanceof ApiError && q.error.code === 'INVALID_DATE'
  useEffect(() => {
    if (stale) onDate(null)
  }, [stale, onDate])
  // The page's h1 stays while the mangoes load or fail, for screen-reader heading navigation.
  const quietTitle = <h1 className="sr-only">Pick your mangoes</h1>
  if (q.isPending) return <TilesSkeleton search={search} />
  if (q.isError) return <>{quietTitle}<ErrorNote error={q.error} onRetry={() => q.refetch()} /></>
  if (!q.data.serviceable) return <>{quietTitle}<ErrorNote error={`We don't deliver to ${pincode} yet.`} /></>
  const products = shop.shown
  const chosen = q.data.deliveryDate!

  return (
    <>
      <section aria-labelledby="pick">
        {/* The page's h1, at section-title size so it reads like the rest of the home page. */}
        <h1 id="pick" className="section-title">
          {search ? `Mangoes matching “${search}”` : 'Pick your mangoes'}
        </h1>
        <p className="muted small">Showing what we have for {day(chosen)}. You choose the delivery day at checkout.</p>
        {shop.controls}
        {matching.length === 0 && (
          <p className="card empty">
            No mangoes match “{search}”. Try another name, such as Alphonso.
          </p>
        )}
        <ul className="tiles">
          {products.map((p, i) => (
            <ProductTile
              key={p.sku}
              product={p}
              inCart={cart.reduce((n, l) => (l.sku === p.sku ? n + l.qty : n), 0)}
              // The first row (four across on a desktop) is on the first screen: load those photos at once.
              eager={i < FIRST_SCREEN_TILES}
            />
          ))}
        </ul>
      </section>
      {!search && <GiftBanner />}
    </>
  )
}

/** Tiles whose photos load at once rather than when scrolled to. */
const FIRST_SCREEN_TILES = 4

const stagesOf = (p: ProductGroup) => p.stages

/**
 * Sort and filter (SHOP_SORT_FILTER) over the boxes already matching the search: the choice is
 * read from and written to the address. `stages` gives stock per ripeness, or null before a
 * pincode (then only sorting and the variety filter are offered). While the switch is off the
 * boxes show as they come, with no controls.
 */
function useShopView<T extends Viewable>(items: T[], stages: ((item: T) => { stage: Stage; qty: number }[]) | null) {
  const { sortFilter } = useFeatures()
  const [params, setParams] = useSearchParams()
  const view = sortFilter ? readView(params) : DEFAULT_VIEW
  // Stars per variety, from the same answers the tiles' rating lines use; only asked for when sorting by rating.
  const varietyKeys = [...new Set(items.map((i) => i.variety || i.sku))]
  const ratings = useQueries({
    queries: varietyKeys.map((key) => {
      const sku = items.find((i) => (i.variety || i.sku) === key)!.sku
      return { queryKey: ['rating', key], queryFn: () => api.productReviews(sku, { limit: 1 }), staleTime: 5 * 60_000, enabled: view.sort === 'rating' }
    }),
  })
  const stars = new Map(varietyKeys.map((key, i) => [key, ratings[i]?.data?.summary.count ? (ratings[i].data!.summary.average ?? null) : null]))
  const shown = applyView(items, view, { stages: stages ?? undefined, rating: (i) => stars.get(i.variety || i.sku) ?? null })
  const setView = (next: ShopView) => setParams(writeView(params, next), { replace: true })
  const controls = sortFilter ? (
    <ViewControls view={view} varieties={varietiesOf(items)} stockKnown={Boolean(stages)} shown={shown.length} total={items.length} onChange={setView} />
  ) : null
  return { shown, controls }
}

function ViewControls({
  view,
  varieties,
  stockKnown,
  shown,
  total,
  onChange,
}: {
  view: ShopView
  varieties: string[]
  stockKnown: boolean
  shown: number
  total: number
  onChange: (view: ShopView) => void
}) {
  const id = useId()
  const filtered = isFiltered(view)
  if (!total) return null
  return (
    <div className="view-controls" role="group" aria-label="Sort and filter">
      <div className="view-fields">
        <div className="view-field">
          <label htmlFor={`${id}-sort`}>Sort by</label>
          <select id={`${id}-sort`} value={view.sort} onChange={(e) => onChange({ ...view, sort: e.target.value as SortKey })}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {(varieties.length > 1 || view.variety) && (
          <div className="view-field">
            <label htmlFor={`${id}-variety`}>Variety</label>
            <select id={`${id}-variety`} value={view.variety ?? ''} onChange={(e) => onChange({ ...view, variety: e.target.value || null })}>
              <option value="">All varieties</option>
              {(view.variety && !varieties.includes(view.variety) ? [...varieties, view.variety] : varieties).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        )}
        {stockKnown && (
          <div className="view-field">
            <label htmlFor={`${id}-ripe`}>Ripeness</label>
            <select id={`${id}-ripe`} value={view.ripeness ?? ''} onChange={(e) => onChange({ ...view, ripeness: (e.target.value || null) as Stage | null })}>
              <option value="">Any ripeness</option>
              {STAGES.map((st) => (
                <option key={st} value={st}>
                  {STAGE_LABEL[st]} in stock
                </option>
              ))}
            </select>
          </div>
        )}
        {stockKnown && (
          <label className="option view-stock">
            <input type="checkbox" checked={view.inStock} onChange={(e) => onChange({ ...view, inStock: e.target.checked })} />
            <span>In stock only</span>
          </label>
        )}
      </div>
      <div className="view-status">
        <p className="small muted" role="status">
          {filtered ? `Showing ${shown} of ${total} ${total === 1 ? 'box' : 'boxes'}` : `${total} ${total === 1 ? 'box' : 'boxes'}`}
        </p>
        {filtered && (
          <button type="button" className="link-btn" onClick={() => onChange({ ...DEFAULT_VIEW, sort: view.sort })}>
            Clear filters
          </button>
        )}
      </div>
      {filtered && shown === 0 && <p className="card empty">No boxes match these filters. Clear them to see every box.</p>}
    </div>
  )
}

/**
 * Placeholder tiles the same size as the real ones (title, date line, square photo, name, rating
 * and price), so the page below does not move when the mangoes arrive.
 */
function TilesSkeleton({ search }: { search: string }) {
  return (
    <section aria-labelledby="pick" aria-busy="true">
      <h1 id="pick" className="section-title">
        {search ? `Mangoes matching “${search}”` : 'Pick your mangoes'}
      </h1>
      <p className="muted small">
        <span className="sr-only">Loading mangoes…</span>
        <span aria-hidden="true">
          Showing what we have for <span className="sk-text">Thu, 22 Oct</span>. You choose the delivery day at checkout.
        </span>
      </p>
      <ul className="tiles" aria-hidden="true">
        {Array.from({ length: FIRST_SCREEN_TILES }, (_, i) => (
          <li key={i} className="card tile">
            <div className="tile-img sk" />
            <div className="tile-body">
              <h3 className="tile-name">
                <span className="sk-text">Mango 3kg Box</span>
              </h3>
              <span className="product-rating" />
              <p className="tile-foot">
                <strong className="price sk-text">₹1,899</strong>
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One tile per box on the home page. Tapping it opens the product page, where the customer picks the ripeness. */
const ProductTile = memo(function ProductTile({ product: p, inCart, eager }: { product: ProductGroup; inCart: number; eager: boolean }) {
  const soldOut = !p.stages.some((s) => s.qty > 0)
  const soonest = p.stages.map((s) => s.nextAvailableDate).filter(Boolean).sort()[0]
  return (
    <li className={soldOut ? 'card tile tile-sold-out' : 'card tile'}>
      <div className="tile-img">
        <ProductImage photoUrl={p.photoUrl} name={p.name} size={88} eager={eager} />
        {inCart > 0 && <span className="tile-badge">{inCart} in cart</span>}
      </div>
      <div className="tile-body">
        <h3 id={`p-${p.sku}`} className="tile-name">
          <Link to={`/mangoes/${p.sku}`} className="card-link">
            {p.name}
          </Link>
        </h3>
        {/* After the name, so a screen reader hears which box it is; drawn on the photo's corner. */}
        <HeartButton sku={p.sku} name={p.name} className="tile-heart" />
        <ProductRating sku={p.sku} variety={p.variety} />
        <p className="tile-foot">
          <strong className="price">{rupees(p.price)}</strong>
          {soldOut && <span className="small sold-out">Sold out{soonest ? `, back ${day(soonest)}` : ''}</span>}
          <HeartProblem sku={p.sku} />
        </p>
      </div>
    </li>
  )
})

function GiftBanner() {
  return (
    <section className="card gift-banner" aria-labelledby="gift-title">
      <div>
        <h2 id="gift-title">Send a box as a gift</h2>
        <p className="muted small">Pick any box, then tick "This is a gift" at checkout. We add your note and message them on WhatsApp.</p>
      </div>
      <Link to="/quality" className="link-btn">
        How we pick and check
      </Link>
    </section>
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

export type ProductGroup = {
  sku: string
  name: string
  variety: string
  boxSize: string
  price: number
  description: string
  photoUrl: string | null
  stages: CatalogueItem[]
}

export function groupBySku(items: CatalogueItem[]) {
  const map = new Map<string, ProductGroup>()
  for (const i of items) {
    const p = map.get(i.sku) ?? { sku: i.sku, name: i.name, variety: i.variety, boxSize: i.boxSize, price: i.price, description: i.description ?? '', photoUrl: i.photoUrl ?? null, stages: [] }
    p.stages.push(i)
    map.set(i.sku, p)
  }
  return [...map.values()]
}

/**
 * The variety's average and review count. One request per variety (the 3 and 5 kg boxes share it);
 * the product page passes the `summary` it already has instead. Its line is kept (empty) while
 * it loads and when there are no reviews yet, so nothing under it moves.
 */
export function ProductRating({ sku, variety, href, summary }: { sku: string; variety: string; href?: string; summary?: RatingSummary | null }) {
  const own = summary === undefined
  const q = useQuery({ queryKey: ['rating', variety || sku], queryFn: () => api.productReviews(sku, { limit: 1 }), staleTime: 5 * 60_000, enabled: own })
  const s = own ? q.data?.summary : summary
  if (!s || !s.count || s.average == null) return <span className="product-rating" aria-hidden="true" />
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
