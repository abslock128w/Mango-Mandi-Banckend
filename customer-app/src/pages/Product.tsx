import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ApiError, api, type PublicReview, type Stage } from '../api'
import { STAGE_HINT, STAGE_LABEL, day, rupees } from '../format'
import { MangoArt } from '../mango'
import { useStore } from '../store'
import { NotifyMe, ProductRating, groupBySku } from './Shop'
import { RatingBars, Stars } from '../stars'
import { Dialog, ErrorNote, Skeleton } from '../ui'
import { storyFor } from '../varieties'

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const SUB_LABEL = { taste: 'Taste', ripenessAccuracy: 'Ripe as promised', packaging: 'Packaging', delivery: 'Delivery' } as const

/** /mangoes/:sku — the box: pick the ripeness and how many, add to cart; then what buyers say about the variety. */
export default function ProductPage() {
  const { sku = '' } = useParams()
  const [stars, setStars] = useState<number | null>(null)
  const [withPhotos, setWithPhotos] = useState(false)
  const q = useInfiniteQuery({
    queryKey: ['product-reviews', sku, stars, withPhotos],
    queryFn: ({ pageParam }) => api.productReviews(sku, { stars, withPhotos, cursor: pageParam, limit: 10 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
  const [open, setOpen] = useState<{ review: PublicReview; index: number } | null>(null)

  if (q.isPending) return <Skeleton label="Loading this box" cards={2} tall />
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) {
      return (
        <section className="card">
          <h1>Mango not found</h1>
          <Link to="/">Back to the shop</Link>
        </section>
      )
    }
    return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  }
  const first = q.data.pages[0]
  const items = q.data.pages.flatMap((p) => p.items)
  const filtered = stars != null || withPhotos
  const variety = first.product.variety || first.product.name
  return (
    <>
      <BuyBox sku={sku} fallbackName={first.product.name} />
      <VarietyStoryCard variety={first.product.variety} name={first.product.name} />
      <section className="card" aria-labelledby="ratings-title" id="reviews">
        <h2 id="ratings-title">Ratings and reviews</h2>
        <p className="muted small">From verified buyers of every {variety} box.</p>
        <RatingBars summary={first.summary} active={stars} onPick={setStars} />
        <div className="review-filters">
          <label className="option">
            <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />
            <span>Only reviews with photos ({first.summary.withPhotos})</span>
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
              Show all reviews
            </button>
          )}
        </div>
      </section>

      <section aria-labelledby="reviews-title">
        <h2 id="reviews-title" className="section-title">
          {filtered ? 'Matching reviews' : 'Reviews'}
        </h2>
        {items.length === 0 ? (
          <p className="card muted">{filtered ? 'No reviews match. Try showing all reviews.' : 'No reviews yet. Buyers can review after delivery.'}</p>
        ) : (
          <ul className="review-list">
            {items.map((r) => (
              <li key={r.id} className="card review">
                <ReviewCard review={r} onPhoto={(index) => setOpen({ review: r, index })} />
              </li>
            ))}
          </ul>
        )}
        {q.hasNextPage && (
          <button type="button" className="btn btn-block" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            {q.isFetchingNextPage ? 'Loading…' : 'Show more reviews'}
          </button>
        )}
      </section>
      {open && <Lightbox review={open.review} start={open.index} onClose={() => setOpen(null)} />}
    </>
  )
}

function ReviewCard({ review: r, onPhoto }: { review: PublicReview; onPhoto: (index: number) => void }) {
  const subs = (Object.keys(SUB_LABEL) as (keyof typeof SUB_LABEL)[]).filter((k) => r[k] != null)
  return (
    <article aria-label={`Review by ${r.displayName}, ${r.rating} out of 5 stars`}>
      <header className="review-head">
        <Stars value={r.rating} small />
        <span className="badge-verified">Verified purchase</span>
      </header>
      <p className="muted small">
        <strong className="reviewer">{r.displayName}</strong> · {dateFmt.format(new Date(r.createdAt))} · {r.productName}
        {r.ripenessOrdered && <>, ordered {STAGE_LABEL[r.ripenessOrdered].toLowerCase()}</>}
      </p>
      {subs.length > 0 && (
        <dl className="sub-scores">
          {subs.map((k) => (
            <div key={k}>
              <dt>{SUB_LABEL[k]}</dt>
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
        <ul className="review-photos" aria-label="Photos from this buyer">
          {r.photos.map((p, i) => (
            <li key={p.id}>
              <button type="button" onClick={() => onPhoto(i)} aria-label={`Open photo ${i + 1} of ${r.photos.length} from ${r.displayName}`}>
                <img src={api.publicPhotoUrl(p.url)} alt="" loading="lazy" width={88} height={88} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {r.reply && (
        <div className="brand-reply">
          <p className="small">
            <strong>Reply from MandiMangoes</strong>
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
  if (!story) return null
  return (
    <section className="card story" aria-labelledby="story-title">
      <h2 id="story-title">About {story.name}</h2>
      <dl className="story-facts">
        <div>
          <dt>Where it grows</dt>
          <dd>{story.from}</dd>
        </div>
        <div>
          <dt>Taste</dt>
          <dd>{story.taste}</dd>
        </div>
        <div>
          <dt>Best for</dt>
          <dd>{story.bestFor}</dd>
        </div>
        <div>
          <dt>Season</dt>
          <dd>{story.season}</dd>
        </div>
      </dl>
      <Link to="/quality" className="link-btn">
        How we pick and check every box
      </Link>
    </section>
  )
}

/** The Amazon-style buy box: ripeness, how many, Add to cart. Stock is for the day the shop is showing. */
function BuyBox({ sku, fallbackName }: { sku: string; fallbackName: string }) {
  const { pincode, date, setWhere, cart, setQty } = useStore()
  const q = useQuery({ queryKey: ['catalogue', pincode, date], queryFn: () => api.catalogue(pincode!, date), enabled: Boolean(pincode) })
  // A home shelf opens the box at its ripeness with ?stage=.
  const [params] = useSearchParams()
  const asked = params.get('stage')
  const [picked, setPicked] = useState<Stage | null>(asked === 'RAW' || asked === 'SEMI_RIPE' || asked === 'RIPE' ? asked : null)
  const [count, setCount] = useState(1)
  const [added, setAdded] = useState<string | null>(null)
  const first = useRef(true)
  useEffect(() => {
    // Keep the shelf's ripeness on first load; reset when the box or day changes.
    if (first.current) {
      first.current = false
      return
    }
    setPicked(null)
    setCount(1)
    setAdded(null)
  }, [sku, date])

  if (!pincode) {
    return (
      <section className="card" aria-labelledby="product-title">
        <h1 id="product-title">{fallbackName}</h1>
        <p>Tell us your pincode to see the ripeness we have and add a box.</p>
        <Link to="/" className="btn btn-primary">
          Enter your pincode
        </Link>
      </section>
    )
  }
  if (q.isPending) return <Skeleton label="Loading this box" cards={1} tall />
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  const all = groupBySku(q.data.items)
  const p = all.find((x) => x.sku === sku)
  if (!q.data.serviceable || !p) {
    return (
      <section className="card" aria-labelledby="product-title">
        <h1 id="product-title">{fallbackName}</h1>
        <p>{q.data.serviceable ? `This box isn't on sale for ${pincode} right now.` : `We don't deliver to ${pincode} yet.`}</p>
        <Link to="/">See all mangoes</Link>
      </section>
    )
  }
  const sizes = all.filter((x) => x.variety && x.variety === p.variety)
  const open = p.stages.filter((s) => s.qty > 0)
  // Ripe is the usual pick, so it is chosen first when it is in stock.
  const stage = picked && open.some((s) => s.stage === picked) ? picked : (open.find((s) => s.stage === 'RIPE') ?? open[0])?.stage ?? null
  const item = p.stages.find((s) => s.stage === stage) ?? null
  const inCart = item ? cart.find((l) => l.sku === sku && l.stage === item.stage)?.qty ?? 0 : 0
  const room = item ? Math.max(0, Math.min(20, item.qty) - inCart) : 0
  const n = Math.max(1, Math.min(count, room))
  const label = item ? `${p.name}, ${STAGE_LABEL[item.stage]}` : ''

  function add() {
    if (!item || room === 0) return
    setQty({ sku: item.sku, stage: item.stage, name: item.name, price: item.price }, inCart + n)
    setAdded(`Added ${n} ${n === 1 ? 'box' : 'boxes'} of ${label}.`)
    setCount(1)
  }

  return (
    <section className="card buy" aria-labelledby="product-title">
      <header className="product-head">
        <MangoArt stage={item?.stage ?? 'RIPE'} size={72} />
        <div className="product-name">
          <h1 id="product-title">{p.name}</h1>
          <ProductRating sku={p.sku} variety={p.variety} href="#reviews" />
          <p className="buy-price">
            <strong>{rupees(p.price)}</strong> <span className="muted small">per box · free delivery</span>
          </p>
        </div>
      </header>
      {p.description && <p>{p.description}</p>}

      {sizes.length > 1 && (
        <div className="field">
          <span className="field-label" id="size-label">
            Box size
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

      <fieldset className="field">
        <legend>Choose ripeness</legend>
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
                      {STAGE_HINT[s.stage]} {sold ? 'Sold out for this day.' : `Eat by ${day(s.eatBy)}.`}
                      {!sold && s.qty <= 5 && <span className="low"> Only {s.qty} left.</span>}
                    </span>
                  </span>
                </label>
                {sold && (
                  <span className="small ripe-extra">
                    {s.nextAvailableDate ? (
                      <button type="button" className="link-btn" onClick={() => setWhere(pincode, s.nextAvailableDate!)}>
                        Available {day(s.nextAvailableDate)}
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
            <span className="field-label" id="qty-label">
              How many boxes
            </span>
            <div className="stepper" role="group" aria-labelledby="qty-label">
              <button type="button" onClick={() => setCount(n - 1)} disabled={n <= 1} aria-label="One box fewer">
                −
              </button>
              <span aria-live="polite">{room === 0 ? 0 : n}</span>
              <button type="button" onClick={() => setCount(n + 1)} disabled={n >= room} aria-label="One box more">
                +
              </button>
            </div>
            {inCart > 0 && (
              <p className="muted small">
                {inCart} already in your cart{room === 0 ? ', the most we can send for this day.' : '.'}
              </p>
            )}
          </div>
          <button type="button" className="btn btn-primary btn-block" onClick={add} disabled={room === 0}>
            Add to cart · {rupees(item.price * (room === 0 ? 0 : n))}
          </button>
        </>
      ) : (
        <p className="sold-out">Every ripeness is sold out for {day(q.data.deliveryDate!)}.</p>
      )}
      {added && (
        <p className="note" role="status">
          {added} <Link to="/cart">View cart</Link>
        </p>
      )}
      <p className="muted small">Showing stock for {day(q.data.deliveryDate!)}. You choose the delivery day at checkout.</p>
    </section>
  )
}

/** Full-size photos, one at a time; arrow keys or buttons move, Escape closes. */
function Lightbox({ review, start, onClose }: { review: PublicReview; start: number; onClose: () => void }) {
  const [i, setI] = useState(start)
  const n = review.photos.length
  const move = (d: number) => setI((x) => (x + d + n) % n)
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
      title={`Photo ${i + 1} of ${n} from ${review.displayName}`}
      onClose={onClose}
      footer={
        <>
          {n > 1 && (
            <>
              <button type="button" className="btn" onClick={() => move(-1)}>
                Previous
              </button>
              <button type="button" className="btn" onClick={() => move(1)}>
                Next
              </button>
            </>
          )}
          <button type="button" className="btn btn-primary" data-autofocus onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="lightbox">
        <img src={api.publicPhotoUrl(review.photos[i].url)} alt={`Photo ${i + 1} of the ${review.productName} from ${review.displayName}`} />
      </div>
    </Dialog>
  )
}
