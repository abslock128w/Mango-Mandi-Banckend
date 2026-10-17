import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type IssueType } from '../api'
import { ErrorNote, Spinner } from '../ui'

const ISSUES: { value: IssueType; label: string }[] = [
  { value: 'DAMAGED', label: 'Damaged or spoilt mangoes' },
  { value: 'WRONG_ITEM', label: 'Wrong box or ripeness' },
  { value: 'NOT_DELIVERED', label: "It didn't arrive" },
]

export default function ClaimPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const order = useQuery({ queryKey: ['order', id], queryFn: () => api.order(id) })
  const [issue, setIssue] = useState<IssueType | null>(null)
  const [skus, setSkus] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [photoUrl, setPhotoUrl] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: () =>
      api.raiseClaim({ orderId: id, issueType: issue!, description: description.trim(), itemSkus: skus, photoUrl: photoUrl.trim() || undefined }),
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
    if (!issue) return setFormError('Choose what went wrong.')
    if (description.trim().length < 5) return setFormError('Tell us a little about what happened.')
    if (photoUrl.trim() && !/^https:\/\//.test(photoUrl.trim())) return setFormError('A photo link must start with https://')
    send.mutate()
  }

  const skuOptions = [...new Map(order.data.items.map((i) => [i.sku, i.name])).entries()]
  return (
    <section className="card">
      <h1>Report a problem</h1>
      <p className="muted">
        Order {order.data.number}. Tell us within a day of delivery and we'll replace what went wrong with a fresh box.
      </p>
      <form onSubmit={submit} noValidate>
        <fieldset className="field">
          <legend>What went wrong?</legend>
          <div className="options">
            {ISSUES.map((i) => (
              <label key={i.value} className="option">
                <input type="radio" name="issue" value={i.value} checked={issue === i.value} onChange={() => setIssue(i.value)} />
                <span>{i.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {skuOptions.length > 1 && (
          <fieldset className="field">
            <legend>Which boxes? (optional)</legend>
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
        <div className="field">
          <label htmlFor="desc">What happened?</label>
          <textarea id="desc" rows={4} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="photo">Link to a photo (optional)</label>
          <input id="photo" type="url" inputMode="url" placeholder="https://" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} />
        </div>
        {formError && (
          <p className="field-error" role="alert">
            {formError}
          </p>
        )}
        <ErrorNote error={send.error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={send.isPending}>
          {send.isPending ? 'Sending…' : 'Send report'}
        </button>
        <Link to={`/orders/${id}`} className="btn btn-block btn-quiet">
          Back to the order
        </Link>
      </form>
    </section>
  )
}
