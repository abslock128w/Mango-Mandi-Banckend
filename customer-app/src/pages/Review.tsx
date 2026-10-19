import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, errorMessage, signedInProfile, type FollowUp, type MyReview, type Reviewable, type SubRatings } from '../api'
import { STAGE_LABEL, day, when } from '../format'
import { shrinkPhoto } from '../photo'
import { StarInput, Stars } from '../stars'
import { Dialog, ErrorNote, Spinner } from '../ui'

const MAX_PHOTOS = 3
const MAX_COMMENT = 1000
const SUBS: { key: keyof SubRatings; label: string }[] = [
  { key: 'taste', label: 'Taste' },
  { key: 'ripenessAccuracy', label: 'Ripe as promised?' },
  { key: 'packaging', label: 'Packaging' },
  { key: 'delivery', label: 'Delivery' },
]

interface Pic {
  id: string
  preview: string | null
}

/** "Ravi Kumar" → "Ravi K.", as the API shows it. */
function shownAs(name: string | null | undefined, anonymous: boolean) {
  if (anonymous) return 'Anonymous'
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'Verified buyer'
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
  return parts.length > 1 ? `${first} ${parts.at(-1)!.charAt(0).toUpperCase()}.` : first
}

/** /review/:itemId writes a new review; /reviews/:reviewId/edit changes one. */
export default function ReviewPage() {
  const { itemId, reviewId } = useParams()
  const q = useQuery({ queryKey: ['my-reviews'], queryFn: () => api.myReviews() })
  if (q.isPending) return <Spinner label="Loading" />
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  const item = itemId ? q.data.reviewable.find((i) => i.orderItemId === itemId) : undefined
  const existing = reviewId ? q.data.reviews.find((r) => r.id === reviewId) : undefined
  if (existing && !existing.canEdit) {
    return (
      <section className="card narrow">
        <h1>This review can no longer be changed</h1>
        <p className="muted">Reviews can be changed for 48 hours after you send them. You can still delete it from your account page.</p>
        <Link to="/account" className="btn btn-primary">
          Go to my account
        </Link>
      </section>
    )
  }
  if (!item && !existing) {
    return (
      <section className="card narrow">
        <h1>Nothing to review here</h1>
        <p className="muted">This item is already reviewed, or it was delivered more than 30 days ago.</p>
        <Link to="/orders" className="btn btn-primary">
          See my orders
        </Link>
      </section>
    )
  }
  return <ReviewForm item={item} existing={existing} />
}

function ReviewForm({ item, existing }: { item?: Reviewable; existing?: MyReview }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null)
  const [subs, setSubs] = useState<SubRatings>({
    taste: existing?.taste ?? null,
    ripenessAccuracy: existing?.ripenessAccuracy ?? null,
    packaging: existing?.packaging ?? null,
    delivery: existing?.delivery ?? null,
  })
  const [comment, setComment] = useState(existing?.comment ?? '')
  const [anonymous, setAnonymous] = useState(existing?.anonymous ?? false)
  const [photos, setPhotos] = useState<Pic[]>(existing?.photos.map((p) => ({ id: p.id, preview: null })) ?? [])
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState<{ review: MyReview; followUp: FollowUp } | null>(null)
  // One key per form: a retry after a dropped connection can't make a second review.
  const [idemKey] = useState(() => crypto.randomUUID())
  const previews = useRef(photos)
  previews.current = photos
  useEffect(() => () => previews.current.forEach((p) => p.preview && URL.revokeObjectURL(p.preview)), [])

  // Photos already on a review being edited are fetched with the sign-in.
  useEffect(() => {
    if (!existing) return
    let live = true
    for (const p of existing.photos) {
      api
        .myReviewPhotoUrl(p.url)
        .then((url) => live && setPhotos((all) => all.map((x) => (x.id === p.id ? { ...x, preview: url } : x))))
        .catch(() => undefined)
    }
    return () => {
      live = false
    }
  }, [existing])

  const productName = existing?.productName ?? item!.productName
  const stage = existing?.ripenessOrdered ?? item?.ripenessOrdered ?? null
  const orderId = existing?.orderId ?? item!.orderId

  const send = useMutation({
    mutationFn: () => {
      const body = { rating: rating!, ...subs, comment: comment.trim() || null, anonymous, photoIds: photos.map((p) => p.id) }
      return existing ? api.editReview(existing.id, body) : api.sendReview({ ...body, orderItemId: item!.orderItemId }, idemKey)
    },
    onSuccess: (r) => {
      setDone(r)
      void queryClient.invalidateQueries({ queryKey: ['my-reviews'] })
      void queryClient.invalidateQueries({ queryKey: ['order-reviews', orderId] })
      window.scrollTo(0, 0)
    },
  })

  async function addPhotos(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])].slice(0, MAX_PHOTOS - photos.length)
    e.target.value = ''
    if (!files.length) return
    setPhotoError(null)
    setUploading(true)
    try {
      for (const file of files) {
        const small = await shrinkPhoto(file)
        const { id } = await api.uploadReviewPhoto(small)
        setPhotos((p) => [...p, { id, preview: URL.createObjectURL(small) }])
      }
    } catch (err) {
      setPhotoError(errorMessage(err))
    } finally {
      setUploading(false)
    }
  }
  function removePhoto(id: string) {
    setPhotos((p) => {
      const gone = p.find((x) => x.id === id)
      if (gone?.preview) URL.revokeObjectURL(gone.preview)
      return p.filter((x) => x.id !== id)
    })
  }
  function submit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!rating) return setFormError('Choose from 1 to 5 stars.')
    if (uploading) return setFormError('Wait for the photo to finish uploading.')
    if (comment.length > MAX_COMMENT) return setFormError(`Keep the review to ${MAX_COMMENT} characters.`)
    send.mutate()
  }

  if (done) return <Sent result={done} />

  const left = MAX_COMMENT - comment.length
  return (
    <section className="card narrow" aria-labelledby="review-title">
      <h1 id="review-title">{existing ? 'Change your review' : 'Write a review'}</h1>
      <p className="muted">
        {productName}
        {stage && <> · ordered {STAGE_LABEL[stage].toLowerCase()}</>}
        {item && <> · delivered {when(item.deliveredAt)}</>}
      </p>
      <form onSubmit={submit} noValidate>
        <StarInput label="Your rating" value={rating} onChange={setRating} />
        <fieldset className="field sub-ratings">
          <legend>More detail (optional)</legend>
          {SUBS.map((s) => (
            <StarInput key={s.key} label={s.label} size="small" value={subs[s.key]} onChange={(n) => setSubs((v) => ({ ...v, [s.key]: n }))} />
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor="review-text">Tell other buyers about them (optional)</label>
          <textarea
            id="review-text"
            rows={4}
            maxLength={MAX_COMMENT}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            aria-describedby="review-count review-help"
          />
          <p id="review-count" className={left < 50 ? 'counter warn' : 'counter'} aria-live="polite">
            {left} characters left
          </p>
          <p id="review-help" className="muted small">
            Please leave out phone numbers, emails and links. Reviews are checked by our team before they appear.
          </p>
        </div>
        <div className="field">
          <span className="label" id="review-photos-label">
            Photos (optional, up to {MAX_PHOTOS})
          </span>
          {photos.length > 0 && (
            <ul className="claim-photos" aria-labelledby="review-photos-label">
              {photos.map((p, i) => (
                <li key={p.id}>
                  {p.preview ? <img src={p.preview} alt={`Your photo ${i + 1}`} /> : <span className="photo-wait">Photo {i + 1}</span>}
                  <button type="button" className="link-btn" onClick={() => removePhoto(p.id)}>
                    Remove<span className="sr-only"> photo {i + 1}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {photos.length < MAX_PHOTOS && (
            <label className="btn btn-quiet photo-pick">
              {uploading ? 'Uploading…' : photos.length ? 'Add another photo' : 'Add a photo'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                disabled={uploading}
                onChange={addPhotos}
                aria-describedby={photoError ? 'review-photo-error' : 'review-photos-label'}
              />
            </label>
          )}
          {photoError && (
            <p id="review-photo-error" className="field-error" role="alert">
              {photoError}
            </p>
          )}
        </div>
        <label className="option">
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
          <span>Post without my name</span>
        </label>
        <p className="muted small">
          Shown as <strong>{shownAs(signedInProfile()?.name, anonymous)}</strong>, with a “Verified purchase” badge. We never show your phone, email or
          address.
        </p>
        {formError && (
          <p className="field-error" role="alert">
            {formError}
          </p>
        )}
        <ErrorNote error={send.error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={send.isPending || uploading}>
          {send.isPending ? 'Sending…' : existing ? 'Save changes' : 'Send review'}
        </button>
        <button type="button" className="btn btn-block btn-quiet" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </form>
    </section>
  )
}

function Sent({ result }: { result: { review: MyReview; followUp: FollowUp } }) {
  const { review, followUp } = result
  return (
    <section className="card narrow" aria-labelledby="sent-title">
      <h1 id="sent-title" tabIndex={-1} ref={(el) => el?.focus()}>
        Thank you for your review
      </h1>
      <Stars value={review.rating} />
      <p className="note" role="status">
        It is under review. Our team checks every review, usually within a day, and then it appears on the product page.
      </p>
      {followUp?.type === 'CLAIM' && (
        <div className="note note-warn">
          <p>Sorry the mangoes let you down. If something was wrong with the fruit, report it and we will send a fresh box.</p>
          <p className="small">You can report it until {when(followUp.claimUntil)}.</p>
          <Link to={`/orders/${followUp.orderId}/claim`} className="btn btn-primary">
            Report a problem
          </Link>
        </div>
      )}
      {followUp?.type === 'SUPPORT' && (
        <div className="note note-warn">
          <p>Sorry the mangoes let you down. {followUp.contact}</p>
        </div>
      )}
      <Link to={`/orders/${review.orderId}`} className="btn btn-block">
        Back to the order
      </Link>
    </section>
  )
}

/** The order page's reviews block: write one per delivered item, or see where each review is. */
export function OrderReviews({ orderId }: { orderId: string }) {
  const q = useQuery({ queryKey: ['order-reviews', orderId], queryFn: () => api.myReviews(orderId) })
  if (q.isPending || q.isError) return null
  const { reviews, reviewable } = q.data
  if (!reviews.length && !reviewable.length) return null
  return (
    <section className="card" aria-labelledby="order-reviews">
      <h2 id="order-reviews">{reviewable.length ? 'How were your mangoes?' : 'Your reviews'}</h2>
      <ul className="review-items">
        {reviewable.map((i) => (
          <li key={i.orderItemId}>
            <div>
              <strong>{i.productName}</strong>
              {i.ripenessOrdered && <span className="muted small"> · {STAGE_LABEL[i.ripenessOrdered]}</span>}
              <p className="muted small">You can review this until {day(i.reviewableUntil.slice(0, 10))}.</p>
            </div>
            <Link to={`/review/${i.orderItemId}`} className="btn btn-primary">
              Write a review<span className="sr-only"> of {i.productName}</span>
            </Link>
          </li>
        ))}
        {reviews.map((r) => (
          <li key={r.id}>
            <div>
              <strong>{r.productName}</strong> <Stars value={r.rating} small />
              <p className="muted small">{REVIEW_STATE[r.status]}</p>
            </div>
            {r.canEdit && (
              <Link to={`/reviews/${r.id}/edit`} className="btn btn-quiet">
                Change<span className="sr-only"> review of {r.productName}</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export const REVIEW_STATE: Record<MyReview['status'], string> = {
  PENDING: 'Under review',
  APPROVED: 'Published',
  REJECTED: 'Not published',
  HIDDEN: 'Taken down',
}

/** Account page: every review I wrote, with edit (48 hours) and delete. */
export function MyReviews() {
  const queryClient = useQueryClient()
  const q = useQuery({ queryKey: ['my-reviews'], queryFn: () => api.myReviews() })
  const [deleting, setDeleting] = useState<MyReview | null>(null)
  const del = useMutation({
    mutationFn: (id: string) => api.deleteReview(id),
    onSuccess: () => {
      setDeleting(null)
      void queryClient.invalidateQueries({ queryKey: ['my-reviews'] })
      void queryClient.invalidateQueries({ queryKey: ['order-reviews'] })
    },
  })
  if (q.isPending || q.isError || !q.data.reviews.length) return null
  return (
    <section className="card narrow" aria-labelledby="my-reviews">
      <h2 id="my-reviews">My reviews</h2>
      <ul className="review-items">
        {q.data.reviews.map((r) => (
          <li key={r.id}>
            <div>
              <strong>{r.productName}</strong> <Stars value={r.rating} small />
              <p className="muted small">
                {REVIEW_STATE[r.status]}
                {r.moderationReason && <>: {r.moderationReason}</>}
                {r.canEdit && <> · can be changed until {when(r.editableUntil)}</>}
              </p>
              {r.comment && <p className="review-text">{r.comment}</p>}
            </div>
            <div className="row-actions">
              {r.canEdit && (
                <Link to={`/reviews/${r.id}/edit`} className="link-btn">
                  Change<span className="sr-only"> review of {r.productName}</span>
                </Link>
              )}
              <button type="button" className="link-btn danger" onClick={() => setDeleting(r)}>
                Delete<span className="sr-only"> review of {r.productName}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
      {deleting && (
        <Dialog
          title="Delete this review?"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDeleting(null)}>
                Keep it
              </button>
              <button type="button" className="btn btn-danger" disabled={del.isPending} onClick={() => del.mutate(deleting.id)}>
                {del.isPending ? 'Deleting…' : 'Delete review'}
              </button>
            </>
          }
        >
          <p>Your review of {deleting.productName} and its photos will be removed. You can't write a new one for the same item.</p>
          <ErrorNote error={del.error} />
        </Dialog>
      )}
    </section>
  )
}
