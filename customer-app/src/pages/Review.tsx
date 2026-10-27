import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, signedInProfile, type FollowUp, type MyReview, type Reviewable, type SubRatings } from '../api'
import { STAGE_LABEL, day, when } from '../format'
import { Field, PhotoPicker, usePhotoUploads } from '../forms'
import { StarInput, Stars } from '../stars'
import { useT } from '../i18n'
import type { Key } from '../i18n-core.ts'
import { ConfirmDialog, ErrorNote, Spinner } from '../ui'

const MAX_PHOTOS = 3
const MAX_COMMENT = 1000
const SUBS: { key: keyof SubRatings; label: Key }[] = [
  { key: 'taste', label: 'review.sub.taste' },
  { key: 'ripenessAccuracy', label: 'review.ripeAsked' },
  { key: 'packaging', label: 'review.sub.packaging' },
  { key: 'delivery', label: 'review.sub.delivery' },
]

type SentResult = { review: MyReview; followUp: FollowUp }

/** "Ravi Kumar" → "Ravi K.", as the API shows it (in English, as every buyer sees it on the product page). */
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
  // Kept here, not in the form: once sent, the refreshed list no longer has
  // this item as reviewable, and the thank-you screen must stay.
  const [done, setDone] = useState<SentResult | null>(null)
  const t = useT()
  if (done) return <Sent result={done} />
  if (q.isPending) return <Spinner />
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  const item = itemId ? q.data.reviewable.find((i) => i.orderItemId === itemId) : undefined
  const existing = reviewId ? q.data.reviews.find((r) => r.id === reviewId) : undefined
  if (existing && !existing.canEdit) {
    return (
      <section className="card narrow">
        <h1>{t('review.locked')}</h1>
        <p className="muted">{t('review.lockedBody')}</p>
        <Link to="/account" className="btn btn-primary">
          {t('review.goAccount')}
        </Link>
      </section>
    )
  }
  if (!item && !existing) {
    return (
      <section className="card narrow">
        <h1>{t('review.nothing')}</h1>
        <p className="muted">{t('review.nothingBody')}</p>
        <Link to="/orders" className="btn btn-primary">
          {t('order.seeMine')}
        </Link>
      </section>
    )
  }
  return <ReviewForm item={item} existing={existing} onSent={setDone} />
}

function ReviewForm({ item, existing, onSent }: { item?: Reviewable; existing?: MyReview; onSent: (r: SentResult) => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const t = useT()
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null)
  const [subs, setSubs] = useState<SubRatings>({
    taste: existing?.taste ?? null,
    ripenessAccuracy: existing?.ripenessAccuracy ?? null,
    packaging: existing?.packaging ?? null,
    delivery: existing?.delivery ?? null,
  })
  const [comment, setComment] = useState(existing?.comment ?? '')
  const [anonymous, setAnonymous] = useState(existing?.anonymous ?? false)
  const {
    photos,
    setPhotos,
    uploading,
    error: photoError,
    add: addPhotos,
    remove: removePhoto,
  } = usePhotoUploads((photo) => api.uploadReviewPhoto(photo), MAX_PHOTOS, existing?.photos.map((p) => ({ id: p.id, preview: null })))
  // `stars`: the problem is the missing star rating, shown under the stars; any other above the button.
  const [formError, setFormError] = useState<{ stars?: boolean; message: string } | null>(null)
  // One key per form: a retry after a dropped connection can't make a second review.
  const [idemKey] = useState(() => crypto.randomUUID())

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
  }, [existing, setPhotos])

  const productName = existing?.productName ?? item!.productName
  const stage = existing?.ripenessOrdered ?? item?.ripenessOrdered ?? null
  const orderId = existing?.orderId ?? item!.orderId

  const send = useMutation({
    mutationFn: () => {
      const body = { rating: rating!, ...subs, comment: comment.trim() || null, anonymous, photoIds: photos.map((p) => p.id) }
      return existing ? api.editReview(existing.id, body) : api.sendReview({ ...body, orderItemId: item!.orderItemId }, idemKey)
    },
    onSuccess: (r) => {
      onSent(r)
      void queryClient.invalidateQueries({ queryKey: ['my-reviews'] })
      void queryClient.invalidateQueries({ queryKey: ['order-reviews', orderId] })
      window.scrollTo(0, 0)
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!rating) return setFormError({ stars: true, message: t('review.chooseStars') })
    if (uploading) return setFormError({ message: t('claim.waitPhoto') })
    if (comment.length > MAX_COMMENT) return setFormError({ message: t('review.tooLong', { max: MAX_COMMENT }) })
    send.mutate()
  }

  // "Choose stars" shows under the stars; anything else above the button.
  const starsError = formError?.stars ? formError.message : null
  const left = MAX_COMMENT - comment.length
  return (
    <section className="card narrow" aria-labelledby="review-title">
      <h1 id="review-title">{existing ? t('title.editReview') : t('title.review')}</h1>
      <p className="muted">
        {productName}
        {stage && <> · {t('product.ordered', { stage: STAGE_LABEL[stage].toLowerCase() })}</>}
        {item && <> · {t('review.delivered', { when: when(item.deliveredAt) })}</>}
      </p>
      <form onSubmit={submit} noValidate>
        <StarInput
          label={t('review.yourRating')}
          value={rating}
          describedBy={starsError ? 'rating-error' : undefined}
          onChange={(n) => {
            setRating(n)
            // A "choose stars" message is answered once stars are chosen.
            if (formError?.stars) setFormError(null)
          }}
        />
        {starsError && (
          <p id="rating-error" className="field-error" role="alert">
            {starsError}
          </p>
        )}
        <fieldset className="field sub-ratings">
<legend>{t('review.moreDetail')}</legend>
          {SUBS.map((s) => (
            <StarInput key={s.key} label={t(s.label)} size="small" value={subs[s.key]} onChange={(n) => setSubs((v) => ({ ...v, [s.key]: n }))} />
          ))}
        </fieldset>
        <Field
          id="review-text"
          label={t('review.tellOthers')}
          hint={t('review.tellOthersHint')}
          describedBy="review-count"
        >
          {(control) => (
            <>
              <textarea {...control} rows={4} maxLength={MAX_COMMENT} value={comment} onChange={(e) => setComment(e.target.value)} />
              <p id="review-count" className={left < 50 ? 'counter warn' : 'counter'} aria-live="polite">
                {t('review.charsLeft', { count: left })}
              </p>
            </>
          )}
        </Field>
        <PhotoPicker
          id="review-photos"
          max={MAX_PHOTOS}
          accept="image/jpeg,image/png,image/webp"
          alt={(i) => t('review.yourPhoto', { n: i + 1 })}
          photos={photos}
          uploading={uploading}
          error={photoError}
          onAdd={addPhotos}
          onRemove={removePhoto}
        />
        <label className="option">
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
          <span>{t('review.anonymous')}</span>
        </label>
        <p className="muted small">{t.rich('review.shownAs', { name: <strong>{shownAs(signedInProfile()?.name, anonymous)}</strong> })}</p>
        {formError && !starsError && (
          <p className="field-error" role="alert">
            {formError.message}
          </p>
        )}
        <ErrorNote error={send.error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={send.isPending || uploading}>
          {send.isPending ? t('auth.sending') : existing ? t('review.save') : t('review.send')}
        </button>
        <button type="button" className="btn btn-block btn-quiet" onClick={() => navigate(-1)}>
          {t('common.cancel')}
        </button>
      </form>
    </section>
  )
}

function Sent({ result }: { result: SentResult }) {
  const { review, followUp } = result
  const t = useT()
  return (
    <section className="card narrow" aria-labelledby="sent-title">
      <h1 id="sent-title" tabIndex={-1} ref={(el) => el?.focus()}>
        {t('review.thanks')}
      </h1>
      <Stars value={review.rating} />
      <p className="note" role="status">
        {t('review.underReview')}
      </p>
      {followUp?.type === 'CLAIM' && (
        <div className="note note-warn">
          <p>
            {t('review.sorry')} {t('review.sorryClaim')}
          </p>
          <p className="small">{t('review.reportUntil', { when: when(followUp.claimUntil) })}</p>
          <Link to={`/orders/${followUp.orderId}/claim`} className="btn btn-primary">
            {t('title.claim')}
          </Link>
        </div>
      )}
      {followUp?.type === 'SUPPORT' && (
        <div className="note note-warn">
          <p>
            {t('review.sorry')} {followUp.contact}
          </p>
        </div>
      )}
      <Link to={`/orders/${review.orderId}`} className="btn btn-block">
        {t('common.backToOrder')}
      </Link>
    </section>
  )
}

/** The order page's reviews block: write one per delivered item, or see where each review is. */
export function OrderReviews({ orderId }: { orderId: string }) {
  const q = useQuery({ queryKey: ['order-reviews', orderId], queryFn: () => api.myReviews(orderId) })
  const t = useT()
  if (q.isPending || q.isError) return null
  const { reviews, reviewable } = q.data
  if (!reviews.length && !reviewable.length) return null
  return (
    <section className="card" aria-labelledby="order-reviews">
      <h2 id="order-reviews">{reviewable.length ? t('review.howWere') : t('review.yours')}</h2>
      <ul className="review-items">
        {reviewable.map((i) => (
          <li key={i.orderItemId}>
            <div>
              <strong>{i.productName}</strong>
              {i.ripenessOrdered && <span className="muted small"> · {STAGE_LABEL[i.ripenessOrdered]}</span>}
              <p className="muted small">{t('review.until', { day: day(i.reviewableUntil.slice(0, 10)) })}</p>
            </div>
            <Link to={`/review/${i.orderItemId}`} className="btn btn-primary">
              {t('title.review')}
              <span className="sr-only"> {t('review.ofProduct', { name: i.productName })}</span>
            </Link>
          </li>
        ))}
        {reviews.map((r) => (
          <li key={r.id}>
            <div>
              <strong>{r.productName}</strong> <Stars value={r.rating} small />
              <p className="muted small">{t(REVIEW_STATE[r.status])}</p>
            </div>
            {r.canEdit && (
              <Link to={`/reviews/${r.id}/edit`} className="btn btn-quiet">
                {t('review.change')}
                <span className="sr-only"> {t('review.reviewOf', { name: r.productName })}</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A review's state, as a dictionary key: "Under review" to "Taken down". */
const REVIEW_STATE: Record<MyReview['status'], Key> = {
  PENDING: 'review.state.pending',
  APPROVED: 'review.state.approved',
  REJECTED: 'review.state.rejected',
  HIDDEN: 'review.state.hidden',
}

/** Account page: every review I wrote, with edit (48 hours) and delete. */
export function MyReviews() {
  const queryClient = useQueryClient()
  const q = useQuery({ queryKey: ['my-reviews'], queryFn: () => api.myReviews() })
  const [deleting, setDeleting] = useState<MyReview | null>(null)
  const t = useT()
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
      <h2 id="my-reviews">{t('review.mine')}</h2>
      <ul className="review-items">
        {q.data.reviews.map((r) => (
          <li key={r.id}>
            <div>
              <strong>{r.productName}</strong> <Stars value={r.rating} small />
              <p className="muted small">
                {t(REVIEW_STATE[r.status])}
                {r.moderationReason && <>: {r.moderationReason}</>}
                {r.canEdit && <> · {t('review.editableUntil', { when: when(r.editableUntil) })}</>}
              </p>
              {r.comment && <p className="review-text">{r.comment}</p>}
            </div>
            <div className="row-actions">
              {r.canEdit && (
                <Link to={`/reviews/${r.id}/edit`} className="link-btn">
                  {t('review.change')}
                  <span className="sr-only"> {t('review.reviewOf', { name: r.productName })}</span>
                </Link>
              )}
              <button type="button" className="link-btn danger" onClick={() => setDeleting(r)}>
                {t('review.delete')}
                <span className="sr-only"> {t('review.reviewOf', { name: r.productName })}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
      {deleting && (
        <ConfirmDialog
          title={t('review.deleteConfirm')}
          keepLabel={t('review.keepIt')}
          confirmLabel={t('review.deleteReview')}
          busyLabel={t('account.deleting')}
          busy={del.isPending}
          error={del.error}
          onConfirm={() => del.mutate(deleting.id)}
          onClose={() => setDeleting(null)}
        >
          <p>{t('review.deleteBody', { name: deleting.productName })}</p>
        </ConfirmDialog>
      )}
    </section>
  )
}
