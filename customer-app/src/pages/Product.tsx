import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ApiError, api, type PublicReview } from '../api'
import { STAGE_LABEL } from '../format'
import { MangoArt } from '../mango'
import { RatingBars, Stars } from '../stars'
import { Dialog, ErrorNote, Spinner } from '../ui'

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const SUB_LABEL = { taste: 'Taste', ripenessAccuracy: 'Ripe as promised', packaging: 'Packaging', delivery: 'Delivery' } as const

/** /mangoes/:sku — what buyers say about a variety: totals, filters and approved reviews. */
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

  if (q.isPending) return <Spinner label="Loading reviews" />
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
  return (
    <>
      <section className="card" aria-labelledby="product-title">
        <header className="product-head">
          <MangoArt stage="RIPE" size={52} />
          <div className="product-name">
            <h1 id="product-title">{first.product.variety || first.product.name}</h1>
            <p className="muted small">Reviews from verified buyers of every {first.product.variety || first.product.name} box.</p>
          </div>
        </header>
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
        <Link to="/" className="btn btn-primary">
          Shop {first.product.variety || 'mangoes'}
        </Link>
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
