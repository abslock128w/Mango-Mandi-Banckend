import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type IssueType } from '../api'
import { Field, PhotoPicker, usePhotoUploads } from '../forms'
import { useT, type T } from '../i18n'
import { ErrorNote, Spinner } from '../ui'

const MAX_PHOTOS = 3
/** The claim window in words, from the order's live rule ("a day" while we don't know it). */
const within = (t: T, hours: number | undefined) => (!hours || hours === 24 ? t('claim.aDay') : t('claim.hours', { count: hours }))

const ISSUES: { value: IssueType; label: 'claim.issue.damaged' | 'claim.issue.wrong' | 'claim.issue.missing' }[] = [
  { value: 'DAMAGED', label: 'claim.issue.damaged' },
  { value: 'WRONG_ITEM', label: 'claim.issue.wrong' },
  { value: 'NOT_DELIVERED', label: 'claim.issue.missing' },
]

export default function ClaimPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const t = useT()
  const order = useQuery({ queryKey: ['order', id], queryFn: () => api.order(id) })
  const [issue, setIssue] = useState<IssueType | null>(null)
  const [skus, setSkus] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const { photos, uploading, error: photoError, add: addPhotos, remove: removePhoto } = usePhotoUploads(api.uploadClaimPhoto, MAX_PHOTOS)
  const [formError, setFormError] = useState<{ at?: 'issue' | 'desc'; message: string } | null>(null)
  const send = useMutation({
    mutationFn: () =>
      api.raiseClaim({ orderId: id, issueType: issue!, description: description.trim(), itemSkus: skus, photoIds: photos.map((p) => p.id) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['claims'] })
      navigate(`/orders/${id}`, { replace: true })
    },
  })

  if (order.isPending) return <Spinner />
  if (order.isError) return <ErrorNote error={order.error} onRetry={() => order.refetch()} />

  function submit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!issue) return setFormError({ at: 'issue', message: t('claim.chooseIssue') })
    if (description.trim().length < 5) return setFormError({ at: 'desc', message: t('claim.tellUs') })
    if (uploading) return setFormError({ message: t('claim.waitPhoto') })
    send.mutate()
  }

  const skuOptions = [...new Map(order.data.items.map((i) => [i.sku, i.name])).entries()]
  return (
    <section className="card">
      <h1>{t('title.claim')}</h1>
      <p className="muted">{t('claim.intro', { number: order.data.number, within: within(t, order.data.claimWindowHours) })}</p>
      <form onSubmit={submit} noValidate>
        <fieldset className="field" aria-describedby={formError?.at === 'issue' ? 'issue-error' : undefined}>
          <legend>{t('claim.whatWrong')}</legend>
          <div className="options">
            {ISSUES.map((i) => (
              <label key={i.value} className="option">
                <input type="radio" name="issue" value={i.value} checked={issue === i.value} onChange={() => setIssue(i.value)} />
                <span>{t(i.label)}</span>
              </label>
            ))}
          </div>
          {formError?.at === 'issue' && (
            <p id="issue-error" className="field-error" role="alert">
              {formError.message}
            </p>
          )}
        </fieldset>
        {skuOptions.length > 1 && (
          <fieldset className="field">
            <legend>{t('claim.whichBoxes')}</legend>
            <div className="options">
              {skuOptions.map(([sku, name]) => (
                <label key={sku} className="option">
                  <input
                    type="checkbox"
                    checked={skus.includes(sku)}
                    onChange={(e) => setSkus((s) => (e.target.checked ? [...s, sku] : s.filter((x) => x !== sku)))}
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <Field id="desc" label={t('claim.whatHappened')} error={formError?.at === 'desc' ? formError.message : null}>
          <textarea rows={4} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <PhotoPicker
          id="photos"
          max={MAX_PHOTOS}
          accept="image/*"
          alt={(i) => t('forms.photoN', { n: i + 1 })}
          photos={photos}
          uploading={uploading}
          error={photoError}
          onAdd={addPhotos}
          onRemove={removePhoto}
        />
        {formError && !formError.at && (
          <p className="field-error" role="alert">
            {formError.message}
          </p>
        )}
        <ErrorNote error={send.error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={send.isPending || uploading}>
          {send.isPending ? t('auth.sending') : t('claim.send')}
        </button>
        <Link to={`/orders/${id}`} className="btn btn-block btn-quiet">
          {t('common.backToOrder')}
        </Link>
      </form>
    </section>
  )
}
