import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useInfiniteQuery, useQuery, type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query'
import { ApiError, api, type PublicReview, type RatingSummary, type ReviewPage, type Stage } from '../api'
import { STAGE_HINT, STAGE_LABEL, boxContents, day, longDate, rupees } from '../format'
import { MangoArt, ProductImage, photoAt } from '../mango'
import { Stepper } from '../forms'
import { useStore } from '../store'
import { NotifyMe, PincodeCheck, ProductRating, groupBySku } from './Shop'
import { RatingBars, Stars } from '../stars'
import { Dialog, DocTitle, ErrorNote, Skeleton } from '../ui'
import { storyFor } from '../varieties'
import { catalogueQuery, productReviewsQuery, productsQuery } from '../queries'
import { BuySkeleton } from './BuySkeleton'
import { HeartButton, HeartProblem } from '../favourites'
import { useT } from '../i18n'

/** Reviews shown before "See all", so the page stays short. */
const FIRST_REVIEWS = 3
const SUB_LABEL = { taste: 'review.sub.taste', ripenessAccuracy: 'review.sub.ripeness', packaging: 'review.sub.packaging', delivery: 'review.sub.delivery' } as const

/**
 * /mangoes/:sku — the box: pick the ripeness and how many, add to cart; then what buyers say about the variety.
 * The buy box (stock) and the reviews load side by side; neither waits for the other.
 */
export default function ProductPage() {
  const { sku = '' } = useParams()
  const { pincode, date } = useStore()
  const t = useT()
  const [stars, setStars] = useState<number | null>(null)
  const [withPhotos, setWithPhotos] = useState(false)
  // A filter keeps the reviews on screen until the matching ones arrive, instead of a blank page.
  const q = useInfiniteQuery({ ...productReviewsQuery(sku, stars, withPhotos), placeholderData: keepPreviousData })
  // The same query as the buy box's (shared): the variety's story can show as soon as either answer is in.
  const cat = useQuery({ ...catalogueQuery(pincode ?? '', date), enabled: Boolean(pincode) })
  const [open, setOpen] = useState<{ review: PublicReview; index: number } | null>(null)
  // The first three reviews show; "See all" opens the rest (a filter shows every match).
  const [showAll, setShowAll] = useState(false)

  if (q.isError && q.error instanceof ApiError && q.error.status === 404) {
    return (
      <section className="card">
        <DocTitle title={t('product.notFound')} />
        <h1>{t('product.notFound')}</h1>
        <Link to="/">{t('common.backToShop')}</Link>
      </section>
    )
  }
  const first = q.data?.pages[0]
  const onSale = cat.data?.items.find((i) => i.sku === sku)
  const story = first?.product ?? onSale
  return (
    <>
      <BuyBox sku={sku} fallbackName={first?.product.name} summary={first?.summary ?? null} />
      {/* On a desktop the story sits beside the ratings and reviews; on a phone they stack. */}
      <div className="product-more">
        {story && <VarietyStoryCard variety={story.variety} name={story.name} />}
        <div className="product-reviews">
          {q.isPending ? (
            <Skeleton label={t('product.loadingReviews')} cards={2} />
          ) : q.isError ? (
            <ErrorNote error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <Reviews
              q={q}
              stars={stars}
              withPhotos={withPhotos}
              setStars={setStars}
              setWithPhotos={setWithPhotos}
              showAll={showAll}
              onShowAll={() => setShowAll(true)}
              onPhoto={(review, index) => setOpen({ review, index })}
            />
          )}
        </div>
      </div>
      {open && <Lightbox review={open.review} start={open.index} onClose={() => setOpen(null)} />}
    </>
  )
}

type ReviewsQuery = UseInfiniteQueryResult<InfiniteData<ReviewPage>>

function Reviews({
  q,
  stars,
  withPhotos,
  setStars,
  setWithPhotos,
  showAll,
  onShowAll,
  onPhoto,
}: {
  q: ReviewsQuery
  stars: number | null
  withPhotos: boolean
  setStars: (s: number | null) => void
  setWithPhotos: (on: boolean) => void
  showAll: boolean
  onShowAll: () => void
  onPhoto: (review: PublicReview, index: number) => void
}) {
  const first = q.data!.pages[0]
  const items = q.data!.pages.flatMap((p) => p.items)
  const filtered = stars != null || withPhotos
  const variety = first.product.variety || first.product.name
  const expanded = showAll || filtered
  const shown = expanded ? items : items.slice(0, FIRST_REVIEWS)
  const more = !expanded && (items.length > FIRST_REVIEWS || q.hasNextPage)
  const t = useT()
  return (
    <>
      <section className="card" aria-labelledby="ratings-title" id="reviews">
        <h2 id="ratings-title">{t('product.ratingsTitle')}</h2>
        <p className="muted small">{t('product.fromBuyers', { variety })}</p>
        <RatingBars summary={first.summary} active={stars} onPick={setStars} />
        <div className="review-filters">
          <label className="option">
            <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />
            <span>{t('product.withPhotos', { count: first.summary.withPhotos })}</span>
          </label>
          {filtered && (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setStars(null)
                setWithPhotos(false)
              }}
            >
              {t('product.showAllReviews')}
            </button>
          )}
        </div>
      </section>

      <section aria-labelledby="reviews-title" aria-busy={q.isPlaceholderData}>
        <h2 id="reviews-title" className="section-title">
          {filtered ? t('product.matchingReviews') : t('product.reviews')}
        </h2>
        {items.length === 0 ? (
          <p className="card muted">{filtered ? t('product.noMatch') : t('product.noReviews')}</p>
        ) : (
          <ul className="review-list">
            {shown.map((r) => (
              <li key={r.id} className="card review">
                <ReviewCard review={r} onPhoto={(index) => onPhoto(r, index)} />
              </li>
            ))}
          </ul>
        )}
        {more && (
          <button type="button" className="btn btn-block" onClick={onShowAll}>
            {t('product.seeAll', { count: first.summary.count })}
          </button>
        )}
        {expanded && q.hasNextPage && (
          <button type="button" className="btn btn-block" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            {q.isFetchingNextPage ? `${t('common.loading')}…` : t('product.showMore')}
          </button>
        )}
      </section>
    </>
  )
}

function ReviewCard({ review: r, onPhoto }: { review: PublicReview; onPhoto: (index: number) => void }) {
  const subs = (Object.keys(SUB_LABEL) as (keyof typeof SUB_LABEL)[]).filter((k) => r[k] != null)
  const t = useT()
  return (
    <article aria-label={t('product.reviewBy', { name: r.displayName, rating: r.rating })}>
      <header className="review-head">
        <Stars value={r.rating} small />
        <span className="badge-verified">{t('product.verified')}</span>
      </header>
      <p className="muted small">
        <strong className="reviewer">{r.displayName}</strong> · {longDate(r.createdAt)} · {r.productName}
        {r.ripenessOrdered && <>, {t('product.ordered', { stage: STAGE_LABEL[r.ripenessOrdered].toLowerCase() })}</>}
      </p>
      {subs.length > 0 && (
        <dl className="sub-scores">
          {subs.map((k) => (
            <div key={k}>
              <dt>{t(SUB_LABEL[k])}</dt>
              <dd>
                <Stars value={r[k]!} small />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {/* Plain text: React escapes it, and nothing here renders HTML. */}
      {r.comment && <p className="review-text">{r.comment}</p>}
      {r.photos.length > 0 && (
        <ul className="review-photos" aria-label={t('product.buyerPhotos')}>
          {r.photos.map((p, i) => (
            <li key={p.id}>
              <button type="button" onClick={() => onPhoto(i)} aria-label={t('product.openPhoto', { n: i + 1, total: r.photos.length, name: r.displayName })}>
                {/* An 88 px thumbnail: the API sends it 160 or 320 px wide (for sharper screens), not the full photo. */}
                <img src={photoAt(p.url, 160)} srcSet={`${photoAt(p.url, 160)} 1x, ${photoAt(p.url, 320)} 2x`} alt="" loading="lazy" decoding="async" width={88} height={88} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {r.reply && (
        <div className="brand-reply">
          <p className="small">
            <strong>{t('product.reply')}</strong>
          </p>
          <p className="review-text">{r.reply.body}</p>
        </div>
      )}
    </article>
  )
}

/** Where the variety comes from and what it is best for (only for varieties we have a story for). */
function VarietyStoryCard({ variety, name }: { variety: string; name: string }) {
  const story = storyFor(variety, name)
  const t = useT()
  if (!story) return null
  return (
    <section className="card story" aria-labelledby="story-title">
      <h2 id="story-title">{t('story.about', { name: story.name })}</h2>
      <dl className="story-facts">
        <div>
          <dt>{t('story.from')}</dt>
          <dd>{story.from}</dd>
        </div>
        <div>
          <dt>{t('review.sub.taste')}</dt>
          <dd>{story.taste}</dd>
        </div>
        <div>
          <dt>{t('story.bestFor')}</dt>
          <dd>{story.bestFor}</dd>
        </div>
        <div>
          <dt>{t('story.season')}</dt>
          <dd>{story.season}</dd>
        </div>
      </dl>
      <Link to="/quality" className="link-btn">
        {t('quality.title')}
      </Link>
    </section>
  )
}

/** The Amazon-style buy box: ripeness, how many, Add to cart. Stock is for the day the shop is showing. */
function BuyBox({ sku, fallbackName, summary }: { sku: string; fallbackName?: string; summary: RatingSummary | null }) {
  const { pincode, date, setWhere, cart, setQty } = useStore()
  const t = useT()
  const q = useQuery({ ...catalogueQuery(pincode ?? '', date), enabled: Boolean(pincode) })
  // A home shelf opens the box at its ripeness with ?stage=.
  const [params] = useSearchParams()
  const asked = params.get('stage')
  const [picked, setPicked] = useState<Stage | null>(asked === 'RAW' || asked === 'SEMI_RIPE' || asked === 'RIPE' ? asked : null)
  const [count, setCount] = useState(1)
  const [added, setAdded] = useState<string | null>(null)
  // After "Show stock for" another day: the day the shop showed before, to go back to.
  const [switched, setSwitched] = useState<{ date: string | null; shown: string } | null>(null)
  const switchedNote = useRef<HTMLParagraphElement>(null)
  // UX-5: before a pincode, the box and its price still show (stock waits for the pincode).
  const listing = useQuery({ ...productsQuery(), enabled: !pincode })
  // The ripeness that was sold out, so it is the one picked on the new day.
  const wanted = useRef<Stage | null>(null)
  const first = useRef(true)
  useEffect(() => {
    // Keep the shelf's ripeness on first load; reset when the box or day changes.
    if (first.current) {
      first.current = false
      return
    }
    setPicked(wanted.current)
    wanted.current = null
    setCount(1)
    setAdded(null)
  }, [sku, date])
  // The link that switched the day is gone once that ripeness is in stock: move focus to the news.
  const switchedReady = Boolean(switched) && q.isSuccess
  useEffect(() => {
    if (switchedReady) switchedNote.current?.focus()
  }, [switchedReady])

  if (!pincode) {
    const known = listing.data?.items.find((x) => x.sku === sku)
    const name = known?.name ?? fallbackName
    const contents = known ? boxContents(known) : null
    return (
      <section className="card buy" aria-labelledby="product-title">
        {name && <DocTitle title={name} />}
        <div className="buy-media">
          {known?.photoUrl ? <ProductImage photoUrl={known.photoUrl} name={known.name} className="product-hero" fit="hero" priority /> : <span className="buy-art"><MangoArt stage="RIPE" size={240} /></span>}
        </div>
        <div className="buy-body">
          <header className="product-head">
            <div className="product-name">
              <h1 id="product-title">{name ?? <span className="sk-text">{t('product.placeholderName')}</span>}</h1>
              {known && <HeartButton sku={known.sku} name={known.name} className="product-heart" />}
              {known && <HeartProblem sku={known.sku} />}
              {known && <ProductRating sku={known.sku} variety={known.variety} href="#reviews" summary={summary} />}
              {known && (
                <p className="buy-price">
                  <strong>{rupees(known.price)}</strong> <span className="muted small">{t('product.perBox')}</span>
                </p>
              )}
            </div>
          </header>
          {known?.description && <p>{known.description}</p>}
          {contents && (
            <p className="box-contents">
              <strong>{t('product.inTheBox')}</strong> {contents}
            </p>
          )}
          <p>{t('product.enterPincode')}</p>
          <PincodeCheck initial="" label={t('shop.pincodeLabel')} submitLabel={t('product.checkDelivery')} onDone={(pin, first) => setWhere(pin, first)} />
        </div>
      </section>
    )
  }
  if (q.isPending) return <BuySkeleton />
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  const all = groupBySku(q.data.items)
  const p = all.find((x) => x.sku === sku)
  if (!q.data.serviceable || !p) {
    const name = fallbackName ?? sku
    return (
      <section className="card" aria-labelledby="product-title">
        <DocTitle title={name} />
        <h1 id="product-title">{name}</h1>
        <p>{q.data.serviceable ? t('product.notOnSale', { pincode }) : t('shop.notServed', { pincode })}</p>
        <Link to="/">{t('product.seeAllMangoes')}</Link>
      </section>
    )
  }
  const sizes = all.filter((x) => x.variety && x.variety === p.variety)
  const open = p.stages.filter((s) => s.qty > 0)
  // Ripe is the usual pick, so it is chosen first when it is in stock. UX-6: when the ripeness
  // wanted (Ripe, or the one the link asked for) is sold out, nothing is chosen for the customer:
  // a note says so and they pick another ripeness themselves.
  const wantedStage: Stage = asked === 'RAW' || asked === 'SEMI_RIPE' || asked === 'RIPE' ? asked : 'RIPE'
  const stage = picked && open.some((s) => s.stage === picked) ? picked : open.some((s) => s.stage === wantedStage) && !picked ? wantedStage : null
  const unavailable = !stage && open.length > 0 ? (picked ?? wantedStage) : null
  const contents = boxContents(p.stages[0] ?? {})
  const item = p.stages.find((s) => s.stage === stage) ?? null
  const inCart = item ? cart.find((l) => l.sku === sku && l.stage === item.stage)?.qty ?? 0 : 0
  const room = item ? Math.max(0, Math.min(20, item.qty) - inCart) : 0
  const n = Math.max(1, Math.min(count, room))
  const label = item ? `${p.name}, ${STAGE_LABEL[item.stage]}` : ''
  const shownDay = q.data.deliveryDate!

  function add() {
    if (!item || room === 0) return
    setQty({ sku: item.sku, stage: item.stage, name: item.name, price: item.price }, inCart + n)
    setAdded(t('product.added', { count: n, label }))
    setCount(1)
  }

  return (
    <section className="card buy" aria-labelledby="product-title">
      <DocTitle title={p.name} />
      {/* The photo: on top on a phone, the left column on a desktop (a large drawn mango there when there is no photo). */}
      <div className="buy-media">
        {p.photoUrl ? <ProductImage photoUrl={p.photoUrl} name={p.name} className="product-hero" fit="hero" priority /> : <span className="buy-art"><MangoArt stage={item?.stage ?? 'RIPE'} size={240} /></span>}
      </div>
      <div className="buy-body">
        <header className="product-head">
          {!p.photoUrl && <span className="head-art"><MangoArt stage={item?.stage ?? 'RIPE'} size={72} /></span>}
          <div className="product-name">
            <h1 id="product-title">{p.name}</h1>
            <HeartButton sku={p.sku} name={p.name} className="product-heart" />
            <HeartProblem sku={p.sku} />
            <ProductRating sku={p.sku} variety={p.variety} href="#reviews" summary={summary} />
            <p className="buy-price">
              <strong>{rupees(p.price)}</strong> <span className="muted small">{t('product.perBox')}</span>
            </p>
          </div>
        </header>
        {p.description && <p>{p.description}</p>}
        {contents && (
          <p className="box-contents">
            <strong>{t('product.inTheBox')}</strong> {contents}
          </p>
        )}

        {sizes.length > 1 && (
          <div className="field">
            <span className="label" id="size-label">
              {t('product.boxSize')}
            </span>
            <div className="chips" role="group" aria-labelledby="size-label">
              {sizes.map((x) => (
                <Link key={x.sku} to={`/mangoes/${x.sku}`} replace className="chip" aria-current={x.sku === sku ? 'true' : undefined}>
                  {x.boxSize || x.name} · {rupees(x.price)}
                </Link>
              ))}
            </div>
          </div>
        )}

        {unavailable && (
          <p className="note" id="ripe-note">
            {t(p.stages.find((s) => s.stage === unavailable)?.nextAvailableDate ? 'product.stageSoldOutOther' : 'product.stageSoldOut', {
              stage: STAGE_LABEL[unavailable],
              stageLower: STAGE_LABEL[unavailable].toLowerCase(),
              day: day(shownDay),
            })}
          </p>
        )}
        <fieldset className="field" aria-describedby={unavailable ? 'ripe-note' : undefined}>
          <legend>{t('product.chooseRipeness')}</legend>
          <ul className="ripe-options">
            {p.stages.map((s) => {
              const id = `st-${s.stage}`
              const sold = s.qty === 0
              return (
                <li key={s.stage} className={`ripe-option${s.stage === stage ? ' is-picked' : ''}${sold ? ' is-sold' : ''}`}>
                  <label>
                    <input
                      type="radio"
                      name="stage"
                      value={s.stage}
                      checked={s.stage === stage}
                      disabled={sold}
                      onChange={() => {
                        setPicked(s.stage)
                        setAdded(null)
                      }}
                      aria-labelledby={`${id}-name`}
                      aria-describedby={`${id}-info`}
                    />
                    <span className={`stage-dot stage-${s.stage.toLowerCase()}`} aria-hidden="true" />
                    <span className="stage-text">
                      <strong id={`${id}-name`}>{STAGE_LABEL[s.stage]}</strong>
                      <span id={`${id}-info`} className="muted small">
                        {STAGE_HINT[s.stage]} {sold ? t('product.soldOutDay') : t('product.eatBy', { day: day(s.eatBy) })}
                        {!sold && s.qty <= 5 && <span className="low"> {t('product.onlyLeft', { count: s.qty })}</span>}
                      </span>
                    </span>
                  </label>
                  {sold && (
                    <span className="small ripe-extra">
                      {s.nextAvailableDate ? (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => {
                            wanted.current = s.stage
                            setSwitched({ date, shown: shownDay })
                            setWhere(pincode, s.nextAvailableDate!)
                          }}
                        >
                          {t('product.showStockFor', { day: day(s.nextAvailableDate) })}
                        </button>
                      ) : (
                        <NotifyMe item={s} label={`${p.name}, ${STAGE_LABEL[s.stage]}`} />
                      )}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </fieldset>

        {item ? (
          <>
            <div className="field">
              <Stepper
                label={t('product.howMany')}
                showLabel
                value={n}
                shown={room === 0 ? 0 : n}
                min={1}
                max={room}
                onChange={setCount}
                lessLabel={t('product.oneFewer')}
                moreLabel={t('product.oneMore')}
              />
              {inCart > 0 && (
                <p className="muted small">
                  {t(room === 0 ? 'product.inCartMax' : 'product.inCartAlready', { count: inCart })}
                </p>
              )}
            </div>
            {/* Sticks to the bottom of a phone screen (above the tabs) until the buy box scrolls past. */}
            <div className="buy-bar">
              <button type="button" className="btn btn-primary btn-block" onClick={add} disabled={room === 0}>
                {t('product.addToCart')} · {rupees(item.price * (room === 0 ? 0 : n))}
              </button>
            </div>
          </>
        ) : open.length > 0 ? (
          <>
            {/* UX-6: nothing picked yet. The button stays where it will be, and says why it waits. */}
            <div className="buy-bar">
              <button type="button" className="btn btn-primary btn-block" disabled aria-describedby="pick-first">
                {t('product.addToCart')}
              </button>
            </div>
            <p className="muted small" id="pick-first">
              {t('product.pickFirst')}
            </p>
          </>
        ) : (
          <p className="sold-out">{t('product.allSoldOut', { day: day(shownDay) })}</p>
        )}
        {switched && (
          <p className="note" role="status" tabIndex={-1} ref={switchedNote}>
            {t('product.nowShowing', { day: day(shownDay) })}{' '}
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setWhere(pincode, switched.date)
                setSwitched(null)
              }}
            >
              {t('product.backTo', { day: day(switched.shown) })}
            </button>
          </p>
        )}
        {added && (
          <p className="note" role="status">
            {added} <Link to="/cart">{t('shop.viewCart')}</Link>
          </p>
        )}
        <p className="muted small">{t('product.showingStock', { day: day(shownDay) })}</p>
      </div>
    </section>
  )
}

/** Full-size photos, one at a time; arrow keys or buttons move, Escape closes. */
function Lightbox({ review, start, onClose }: { review: PublicReview; start: number; onClose: () => void }) {
  const [i, setI] = useState(start)
  const n = review.photos.length
  const move = (d: number) => setI((x) => (x + d + n) % n)
  const t = useT()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setI((x) => (x + 1) % n)
      if (e.key === 'ArrowLeft') setI((x) => (x - 1 + n) % n)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [n])
  return (
    <Dialog
      title={t('product.photoTitle', { n: i + 1, total: n, name: review.displayName })}
      onClose={onClose}
      footer={
        <>
          {n > 1 && (
            <>
              <button type="button" className="btn" onClick={() => move(-1)}>
                {t('common.previous')}
              </button>
              <button type="button" className="btn" onClick={() => move(1)}>
                {t('common.next')}
              </button>
            </>
          )}
          <button type="button" className="btn btn-primary" data-autofocus onClick={onClose}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <div className="lightbox">
        <img src={api.publicPhotoUrl(review.photos[i].url)} alt={t('product.photoAlt', { n: i + 1, product: review.productName, name: review.displayName })} />
      </div>
    </Dialog>
  )
}
