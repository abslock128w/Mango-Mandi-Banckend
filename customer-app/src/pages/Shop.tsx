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
import { useT } from '../i18n'
import { HeartButton, HeartProblem } from '../favourites'
import { InstallCard } from '../pwa'
import { DEFAULT_VIEW, SORTS, applyView, isFiltered, readView, varietiesOf, writeView, type ShopView, type SortKey, type Viewable } from '../shop-view'

export default function Shop() {
  const { pincode, date, setWhere, cart } = useStore()
  const t = useT()
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
          {t('shop.deleted')}
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
            {t('shop.viewCart')} · {t('common.boxes', { count: boxes })} · {rupees(cart.reduce((s, l) => s + l.price * l.qty, 0))}
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
  const t = useT()
  return (
    <section className="hero">
      <img src="/brand/logo-320.webp" srcSet="/brand/logo-320.webp 1x, /brand/logo-640.webp 2x" width="128" height="128" alt="MandiMangoes" className="hero-logo" />
      <h1>{t('shop.heroTitle')}</h1>
      <p className="lead">{t('shop.heroLead')}</p>
      <PincodeCheck initial={initial} onDone={onDone} onCancel={onCancel} />
      {children}
      <ol className="how" aria-label={t('shop.howLabel')}>
        {([1, 2, 3] as const).map((n) => (
          <li key={n}>
            <strong>{t(`shop.how${n}.title`)}</strong>
            <span className="muted small">{t(`shop.how${n}.body`)}</span>
          </li>
        ))}
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
  label,
  submitLabel,
}: {
  initial: string
  onDone: (pincode: string, firstDate: string | null) => void
  onCancel?: () => void
  label?: string
  submitLabel?: string
}) {
  const [pin, setPin] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const t = useT()
  const check = useMutation({
    mutationFn: () => api.checkPincode(pin),
    onSuccess: (r) => {
      if (!r.serviceable) setError(t('shop.notServed', { pincode: pin }))
      else if (!r.deliveryDates.length) setError(t('shop.noDays'))
      else onDone(pin, r.earliestDeliveryDate)
    },
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(pin)) return setError(t('shop.enterPincode'))
    check.mutate()
  }
  return (
      <form className="pin-form" onSubmit={submit} noValidate>
        <label htmlFor="pincode">{label ?? t('shop.pincodeLabel')}</label>
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
            {check.isPending ? t('auth.checking') : (submitLabel ?? t('shop.showMangoes'))}
          </button>
        </div>
        {onCancel && (
          <button type="button" className="link-btn" onClick={onCancel}>
            {t('shop.keepPincode', { pincode: initial })}
          </button>
        )}
        {(error || check.error) && (
          <p id="pin-error" className="field-error" role="alert">
            {error ?? errorMessage(check.error)}
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
  const t = useT()
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
        {search ? t('shop.matching', { search }) : t('shop.pricesTitle')}
      </h2>
      <p className="muted small">{t('shop.pricesHint')}</p>
      {shop.controls}
      {matching.length === 0 && <p className="card empty">{t('shop.noMatch', { search })}</p>}
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
  const t = useT()
  return (
    <section className="guide" aria-labelledby="guide-title">
      <h2 id="guide-title" className="section-title">
        {t('shop.whichRipeness')}
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
  const t = useT()
  return (
    <ul className="promises" aria-label={t('shop.promisesLabel')}>
      {([1, 2, 3] as const).map((n) => (
        <li key={n}>
          <strong>{t(`shop.promise${n}.title`)}</strong>
          <span>{t(`shop.promise${n}.body`)}</span>
        </li>
      ))}
    </ul>
  )
}

function Catalogue({ pincode, date, onDate, search }: { pincode: string; date: string | null; onDate: (d: string | null) => void; search: string }) {
  const q = useQuery(catalogueQuery(pincode, date))
  const { cart } = useStore()
  const t = useT()
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
  const quietTitle = <h1 className="sr-only">{t('title.home')}</h1>
  if (q.isPending) return <TilesSkeleton search={search} />
  if (q.isError) return <>{quietTitle}<ErrorNote error={q.error} onRetry={() => q.refetch()} /></>
  if (!q.data.serviceable) return <>{quietTitle}<ErrorNote error={t('shop.notServed', { pincode })} /></>
  const products = shop.shown
  const chosen = q.data.deliveryDate!

  return (
    <>
      <section aria-labelledby="pick">
        {/* The page's h1, at section-title size so it reads like the rest of the home page. */}
        <h1 id="pick" className="section-title">
          {search ? t('shop.matching', { search }) : t('title.home')}
        </h1>
        <p className="muted small">{t('shop.showingFor', { day: day(chosen) })}</p>
        {shop.controls}
        {matching.length === 0 && <p className="card empty">{t('shop.noMatch', { search })}</p>}
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
  const t = useT()
  const filtered = isFiltered(view)
  if (!total) return null
  return (
    <div className="view-controls" role="group" aria-label={t('view.label')}>
      <div className="view-fields">
        <div className="view-field">
          <label htmlFor={`${id}-sort`}>{t('view.sortBy')}</label>
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
            <label htmlFor={`${id}-variety`}>{t('view.variety')}</label>
            <select id={`${id}-variety`} value={view.variety ?? ''} onChange={(e) => onChange({ ...view, variety: e.target.value || null })}>
              <option value="">{t('view.allVarieties')}</option>
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
            <label htmlFor={`${id}-ripe`}>{t('help.h.ripeness')}</label>
            <select id={`${id}-ripe`} value={view.ripeness ?? ''} onChange={(e) => onChange({ ...view, ripeness: (e.target.value || null) as Stage | null })}>
              <option value="">{t('view.anyRipeness')}</option>
              {STAGES.map((st) => (
                <option key={st} value={st}>
                  {t('view.stageInStock', { stage: STAGE_LABEL[st] })}
                </option>
              ))}
            </select>
          </div>
        )}
        {stockKnown && (
          <label className="option view-stock">
            <input type="checkbox" checked={view.inStock} onChange={(e) => onChange({ ...view, inStock: e.target.checked })} />
            <span>{t('view.inStockOnly')}</span>
          </label>
        )}
      </div>
      <div className="view-status">
        <p className="small muted" role="status">
          {filtered ? t('view.showingOf', { shown, count: total }) : t('common.boxes', { count: total })}
        </p>
        {filtered && (
          <button type="button" className="link-btn" onClick={() => onChange({ ...DEFAULT_VIEW, sort: view.sort })}>
            {t('view.clear')}
          </button>
        )}
      </div>
      {filtered && shown === 0 && <p className="card empty">{t('view.noneMatch')}</p>}
    </div>
  )
}

/**
 * Placeholder tiles the same size as the real ones (title, date line, square photo, name, rating
 * and price), so the page below does not move when the mangoes arrive.
 */
/** Shapes only (drawn as grey bars): never read out, and the same length in every language. */
const SKELETON_NAME = 'Mango 3kg Box'

function TilesSkeleton({ search }: { search: string }) {
  const t = useT()
  return (
    <section aria-labelledby="pick" aria-busy="true">
      <h1 id="pick" className="section-title">
        {search ? t('shop.matching', { search }) : t('title.home')}
      </h1>
      <p className="muted small">
        <span className="sr-only">{t('shop.loadingMangoes')}</span>
        <span aria-hidden="true">{t.rich('shop.showingFor', { day: <span className="sk-text">{day('2026-10-22')}</span> })}</span>
      </p>
      <ul className="tiles" aria-hidden="true">
        {Array.from({ length: FIRST_SCREEN_TILES }, (_, i) => (
          <li key={i} className="card tile">
            <div className="tile-img sk" />
            <div className="tile-body">
              <h3 className="tile-name">
                <span className="sk-text">{SKELETON_NAME}</span>
              </h3>
              <span className="product-rating" />
              <p className="tile-foot">
                <strong className="price sk-text">{rupees(189_900)}</strong>
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
  const t = useT()
  return (
    <li className={soldOut ? 'card tile tile-sold-out' : 'card tile'}>
      <div className="tile-img">
        <ProductImage photoUrl={p.photoUrl} name={p.name} size={88} eager={eager} />
        {inCart > 0 && <span className="tile-badge">{t('shop.inCart', { count: inCart })}</span>}
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
          {soldOut && <span className="small sold-out">{soonest ? t('shop.soldOutBack', { day: day(soonest) }) : t('shop.soldOut')}</span>}
          <HeartProblem sku={p.sku} />
        </p>
      </div>
    </li>
  )
})

function GiftBanner() {
  const t = useT()
  return (
    <section className="card gift-banner" aria-labelledby="gift-title">
      <div>
        <h2 id="gift-title">{t('shop.giftTitle')}</h2>
        <p className="muted small">{t('shop.giftBody')}</p>
      </div>
      <Link to="/quality" className="link-btn">
        {t('title.quality')}
      </Link>
    </section>
  )
}

/** Sold out on every open day: a WhatsApp message when it is back. */
export function NotifyMe({ item, label }: { item: CatalogueItem; label: string }) {
  const { profile, pincode } = useStore()
  const location = useLocation()
  const queryClient = useQueryClient()
  const t = useT()
  const alerts = useQuery({ queryKey: ['stock-alerts'], queryFn: api.stockAlerts, enabled: !!profile })
  const add = useMutation({
    mutationFn: () => api.addStockAlert({ sku: item.sku, stage: item.stage, pincode: pincode! }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stock-alerts'] }),
  })
  if (!profile) {
    return (
      <Link to={`/sign-in?next=${encodeURIComponent(location.pathname)}`} className="link-btn">
        {t('notify.signIn')}
      </Link>
    )
  }
  const waiting = alerts.data?.some((a) => a.sku === item.sku && a.stage === item.stage && !a.notifiedAt)
  if (waiting) return <span className="ok-text">{t('notify.waiting')}</span>
  return (
    <>
      <button type="button" className="link-btn" disabled={add.isPending || alerts.isPending} onClick={() => add.mutate()} aria-label={t('notify.label', { label })}>
        {t('alerts.title')}
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
  const t = useT()
  if (!s || !s.count || s.average == null) return <span className="product-rating" aria-hidden="true" />
  const body = (
    <>
      <Stars value={s.average} small />
      <span className="small">
        {s.average.toFixed(1)} · {t('stars.reviewCount', { count: s.count })}
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
