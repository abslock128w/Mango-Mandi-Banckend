// One count: what it found, the review of boxes that were not found, and
// the second person's approval when the loss is large (D8). Every rule is
// checked again by the API; this page only offers what this role may do.

import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dateTime } from '../../format'
import { Badge, BackLink, ConfirmDialog, EmptyState, FormError, QueryError, Spinner, scrollRegion, useToast, usePageTitle } from '../../ui'
import { useWh } from '../access'
import { wh } from '../api'
import { HOLD_LABEL, LIFECYCLE_LABEL, OP_STATUS_LABEL, STOCKTAKE_KIND_LABEL, STOCKTAKE_LINE_LABEL, STOCKTAKE_REVIEW_LABEL, opStatusTone } from '../labels'
import type { Stocktake, StocktakeLine } from '../types'
import { kg } from '../ui'

export default function StocktakeDetail() {
  const { id = '' } = useParams()
  const q = useQuery({ queryKey: ['wh', 'stocktake', id], queryFn: () => wh.stocktake(id) })
  usePageTitle(q.data ? `Count of ${q.data.locationName}` : 'Stocktake')
  if (q.isPending) return <Spinner />
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />
  const s = q.data
  const toReview = s.lines.filter((l) => l.status === 'proposed')
  const r = s.result

  return (
    <>
      <BackLink to="/warehouse/stocktake">Stocktake</BackLink>
      <div className="topbar">
        <h1>Count of {s.locationName}</h1>
        <Badge tone={opStatusTone(s.status)}>{s.status === 'open' ? 'Counting' : OP_STATUS_LABEL[s.status]}</Badge>
      </div>

      <section className="card" aria-labelledby="st-facts">
        <h2 id="st-facts">The count</h2>
        <dl className="wh-facts">
          <div>
            <dt>Counted by</dt>
            <dd>{s.mine ? 'You' : (s.owner ?? '—')}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{dateTime(s.startedAt)}</dd>
          </div>
          <div>
            <dt>Finished</dt>
            <dd>{s.finishedAt ? dateTime(s.finishedAt) : '—'}</dd>
          </div>
          {r && (
            <>
              <div>
                <dt>Boxes counted</dt>
                <dd>{r.counted}</dd>
              </div>
              <div>
                <dt>Where they should be</dt>
                <dd>{r.matched}</dd>
              </div>
              <div>
                <dt>Found, recorded elsewhere</dt>
                <dd>{r.foundElsewhere}</dd>
              </div>
              <div>
                <dt>Found after being missing</dt>
                <dd>{r.foundMissing}</dd>
              </div>
              <div>
                <dt>Recorded as gone (held)</dt>
                <dd>{r.foundGone}</dd>
              </div>
              <div>
                <dt>Moved during the count</dt>
                <dd>{r.movedAfterSnapshot}</dd>
              </div>
              <div>
                <dt>Not found</dt>
                <dd>{r.notFound + r.notFoundAllocated}</dd>
              </div>
            </>
          )}
        </dl>
        {s.status === 'open' && (
          <p className="notice notice-info">
            Still counting.{' '}
            {s.mine && (
              <Link to={`/warehouse/scan?op=${encodeURIComponent(s.id)}`} className="link-btn">
                Continue counting
              </Link>
            )}
          </p>
        )}
      </section>

      {s.status === 'completed' && toReview.length > 0 && <ReviewForm stocktake={s} lines={toReview} />}
      {s.review && <ReviewCard stocktake={s} />}

      <section aria-labelledby="st-lines">
        <h2 id="st-lines">Boxes that did not match</h2>
        {s.lines.length === 0 ? (
          <EmptyState>{s.status === 'completed' ? 'Every box was where it was recorded.' : 'Nothing yet: differences show when the count is finished.'}</EmptyState>
        ) : (
          <div {...scrollRegion('Boxes that did not match', { cards: true })}>
            <table>
              <thead>
                <tr>
                  <th>Box</th>
                  <th>Outcome</th>
                  <th>What the count found</th>
                  <th>Recorded before</th>
                  <th>Now</th>
                </tr>
              </thead>
              <tbody>
                {s.lines.map((l) => (
                  <tr key={l.boxId}>
                    <td className="card-title">
                      <Link to={`/warehouse/boxes/${l.boxId}`}>
                        <code>{l.code}</code>
                      </Link>
                      <div className="muted small">{l.skuName}</div>
                    </td>
                    <td className="card-status">
                      <Badge tone={l.status === 'proposed' || l.status === 'pending_approval' ? 'warn' : l.status === 'missing' ? 'bad' : 'neutral'}>{STOCKTAKE_LINE_LABEL[l.status]}</Badge>
                    </td>
                    <td data-label="Found">{STOCKTAKE_KIND_LABEL[l.kind]}</td>
                    <td data-label="Recorded before">{recorded(l)}</td>
                    <td data-label="Now">{now(l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

const recorded = (l: StocktakeLine) => [LIFECYCLE_LABEL[l.recordedLifecycle] ?? l.recordedLifecycle, l.recordedLocation].filter(Boolean).join(' · ')
const now = (l: StocktakeLine) =>
  [LIFECYCLE_LABEL[l.lifecycle] ?? l.lifecycle, l.location, l.orderNumber ? `on ${l.orderNumber}` : null, ...l.holds.map((h) => HOLD_LABEL[h] ?? h)].filter(Boolean).join(' · ')

type Choice = 'missing' | 'keep'

/** Every box the count did not find is either marked missing or kept as recorded; a box on an order can only be kept. */
function ReviewForm({ stocktake, lines }: { stocktake: Stocktake; lines: StocktakeLine[] }) {
  const { can } = useWh()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [choice, setChoice] = useState<Record<string, Choice>>({})
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<unknown>(null)
  const m = useMutation({
    mutationFn: () =>
      wh.reviewStocktake(stocktake.id, {
        missing: lines.filter((l) => choice[l.boxId] === 'missing').map((l) => l.boxId),
        keep: lines.filter((l) => choice[l.boxId] === 'keep').map((l) => l.boxId),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: (r) => {
      toast.success(
        r.status === 'pending_approval'
          ? `Sent for approval: a second person must approve marking ${r.missing} ${r.missing === 1 ? 'box' : 'boxes'} missing.`
          : `Review saved: ${r.missing} marked missing${r.superseded ? `, ${r.superseded} left alone because they changed since the count` : ''}.`,
      )
      void queryClient.invalidateQueries({ queryKey: ['wh'] })
    },
  })
  if (!can('warehouse.stocktake')) return null

  const undecided = lines.filter((l) => !choice[l.boxId]).length
  const canMiss = (l: StocktakeLine) => l.kind === 'not_found'
  function setAll(c: Choice) {
    setChoice(Object.fromEntries(lines.map((l) => [l.boxId, c === 'missing' && !canMiss(l) ? 'keep' : c])))
  }
  function submit(e: FormEvent) {
    e.preventDefault()
    if (undecided) return setFormError(`Decide every box: ${undecided} not decided yet.`)
    setFormError(null)
    m.mutate()
  }

  return (
    <section className="card" aria-labelledby="st-review">
      <h2 id="st-review">
        Review boxes not found <span className="muted">({lines.length})</span>
      </h2>
      <p>
        Mark a box missing only after looking for it. Missing boxes leave stock; a box found later goes back in stock when it is scanned. Above the write-off limit a
        second person must approve.
      </p>
      <div className="btn-row mb-4">
        <button type="button" className="btn" onClick={() => setAll('missing')}>
          Mark all missing
        </button>
        <button type="button" className="btn" onClick={() => setAll('keep')}>
          Keep all as recorded
        </button>
      </div>
      <form onSubmit={submit} noValidate>
        <ul className="plain-list wh-review">
          {lines.map((l) => (
            <li key={l.boxId}>
              <fieldset>
                <legend>
                  <code>{l.code}</code> · {l.skuName}
                </legend>
                <p className="small muted mb-2">
                  {STOCKTAKE_KIND_LABEL[l.kind]} · {now(l)}
                </p>
                <div className="option-list">
                  <label className="option-row">
                    <input type="radio" name={`st-${l.boxId}`} checked={choice[l.boxId] === 'missing'} disabled={!canMiss(l)} onChange={() => setChoice({ ...choice, [l.boxId]: 'missing' })} />
                    Mark missing
                  </label>
                  <label className="option-row">
                    <input type="radio" name={`st-${l.boxId}`} checked={choice[l.boxId] === 'keep'} onChange={() => setChoice({ ...choice, [l.boxId]: 'keep' })} />
                    Keep as recorded
                  </label>
                </div>
                {!canMiss(l) && <p className="hint">Picked, packed or returned: it can only be kept here. Take it off its order or write it off instead.</p>}
              </fieldset>
            </li>
          ))}
        </ul>
        <div className="field">
          <label htmlFor="st-note">Note (optional)</label>
          <input id="st-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </div>
        <FormError error={formError ?? m.error} />
        <button type="submit" className="btn btn-primary" disabled={m.isPending}>
          {m.isPending ? 'Saving…' : 'Save review'}
        </button>
      </form>
    </section>
  )
}

function ReviewCard({ stocktake }: { stocktake: Stocktake }) {
  const { can } = useWh()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [ask, setAsk] = useState<'approve' | 'reject' | null>(null)
  const review = stocktake.review!
  const decide = useMutation({
    mutationFn: (approve: boolean) => (approve ? wh.approveStocktake(stocktake.id) : wh.rejectStocktake(stocktake.id)),
    onSuccess: (r) => {
      setAsk(null)
      toast.success(r.status === 'applied' ? `Approved: ${r.missing} marked missing.` : 'Not approved: the boxes stay as recorded.')
      void queryClient.invalidateQueries({ queryKey: ['wh'] })
    },
  })
  const waiting = review.status === 'pending_approval'
  const mayDecide = waiting && can('adjust.approve') && !review.mine && !stocktake.mine
  return (
    <section className="card" aria-labelledby="st-review-done">
      <h2 id="st-review-done">Review</h2>
      <p>
        <Badge tone={waiting ? 'warn' : review.status === 'applied' ? 'good' : 'neutral'}>{STOCKTAKE_REVIEW_LABEL[review.status]}</Badge>
      </p>
      <dl className="wh-facts">
        <div>
          <dt>Missing</dt>
          <dd>
            {review.missing} ({kg(review.grams)})
          </dd>
        </div>
        <div>
          <dt>Kept as recorded</dt>
          <dd>{review.kept}</dd>
        </div>
        <div>
          <dt>Reviewed by</dt>
          <dd>
            {review.mine ? 'You' : (review.reviewedBy ?? '—')}, {dateTime(review.reviewedAt)}
          </dd>
        </div>
        {review.decidedAt && (
          <div>
            <dt>Decided by</dt>
            <dd>
              {review.decidedBy ?? '—'}, {dateTime(review.decidedAt)}
            </dd>
          </div>
        )}
        {review.note && (
          <div>
            <dt>Note</dt>
            <dd>{review.note}</dd>
          </div>
        )}
      </dl>
      {waiting && !mayDecide && <p className="hint">A manager who did not count or review this must approve it.</p>}
      {mayDecide && (
        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={() => setAsk('approve')}>
            Approve
          </button>
          <button type="button" className="btn" onClick={() => setAsk('reject')}>
            Do not approve
          </button>
        </div>
      )}
      {ask && (
        <ConfirmDialog
          title={ask === 'approve' ? `Mark ${review.missing} boxes missing?` : 'Keep these boxes as recorded?'}
          confirmLabel={ask === 'approve' ? 'Approve' : 'Do not approve'}
          tone={ask === 'approve' ? 'danger' : undefined}
          busy={decide.isPending}
          error={decide.error}
          onConfirm={() => decide.mutate(ask === 'approve')}
          onClose={() => setAsk(null)}
        >
          <p>
            {ask === 'approve'
              ? `They leave stock (${kg(review.grams)}). A box that changed since the count is left alone.`
              : 'Nothing changes; the boxes stay in stock where they were recorded.'}
          </p>
        </ConfirmDialog>
      )}
    </section>
  )
}
