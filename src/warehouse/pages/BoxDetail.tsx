// One box: where it is, its state and holds, its label, and its history.

import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { date, dateTime } from '../../format'
import { BackLink, Badge, Dialog, EmptyState, FormError, QueryError, ReasonDialog, Spinner, useToast, usePageTitle } from '../../ui'
import { useWh } from '../access'
import { wh } from '../api'
import { DAMAGE_REASON_LABEL, HOLD_LABEL, LIFECYCLE_LABEL, MANUAL_HOLDS, QUALITY_LABEL, eventLabel, qualityTone } from '../labels'
import type { Box, DamageReason, HoldKind, Lifecycle, WhPermission } from '../types'
import { WriteOffDialog } from '../WriteOffDialog'
import { DownloadButton, kg } from '../ui'

/** Who may release each hold (mirrors RELEASABLE in the API). */
const RELEASE_PERM: Record<HoldKind, WhPermission> = {
  qc_hold: 'warehouse.qc',
  damage_hold: 'warehouse.qc',
  investigation_hold: 'warehouse.qc',
  return_hold: 'warehouse.returns',
  recall_hold: 'recall.manage',
}

/** Boxes the API lets you write off. */
const WRITE_OFFABLE: Lifecycle[] = ['in_stock', 'returned', 'missing']

type Ask =
  | { kind: 'reprint' }
  | { kind: 'reissue' }
  | { kind: 'release'; hold: HoldKind }
  | { kind: 'hold' }
  | { kind: 'measure' }
  | { kind: 'restock' }
  | { kind: 'writeoff' }
  | { kind: 'damage' }
  | null

export default function BoxDetail() {
  const { id = '' } = useParams()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { can } = useWh()
  const [ask, setAsk] = useState<Ask>(null)

  const q = useQuery({ queryKey: ['wh', 'box', id], queryFn: () => wh.box(id) })
  const events = useQuery({ queryKey: ['wh', 'box', id, 'events'], queryFn: () => wh.boxEvents(id) })
  usePageTitle(q.data ? `Box ${q.data.code}` : 'Box')

  function done(message: string) {
    setAsk(null)
    toast.success(message)
    void queryClient.invalidateQueries({ queryKey: ['wh', 'box', id] })
  }
  const reprint = useMutation({ mutationFn: (reason: string) => wh.reprint(id, reason), onSuccess: () => done('Reprint recorded. Download the label to print it.') })
  const reissue = useMutation({ mutationFn: (reason: string) => wh.reissue(id, reason), onSuccess: () => done('New label made; the old one no longer scans. Print the new one.') })
  const restock = useMutation({ mutationFn: (reason: string) => wh.restock(id, reason), onSuccess: () => done('Back in stock as needs review: QC it before it sells.') })
  const release = useMutation({
    mutationFn: ({ hold, reason }: { hold: HoldKind; reason: string }) => wh.releaseHold(id, hold, reason),
    onSuccess: () => done('Hold released.'),
  })

  if (q.isPending) return <Spinner />
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />
  const b = q.data
  /** Fruit can come out of a box in stock that is not on an order (the API checks again). */
  const canDamage = can('warehouse.repack') && b.lifecycle === 'in_stock' && !b.orderId

  return (
    <>
      <BackLink to="/warehouse/boxes">Boxes</BackLink>
      <div className="topbar">
        <h1>
          Box <code>{b.code}</code>
        </h1>
        <Badge tone={b.sellable ? 'good' : 'neutral'}>{b.sellable ? 'Sellable' : 'Not sellable'}</Badge>
        <span className="spacer" />
        <Link to={`/warehouse/boxes/${b.id}/trace`} className="btn">
          Trace this box
        </Link>
      </div>

      {(can('warehouse.qc') || canDamage || (can('warehouse.returns') && b.lifecycle === 'returned') || (can('warehouse.adjust') && WRITE_OFFABLE.includes(b.lifecycle))) && (
        <div className="btn-row mb-4">
          {can('warehouse.qc') && (
            <button type="button" className="btn" onClick={() => setAsk({ kind: 'measure' })}>
              Weigh
            </button>
          )}
          {canDamage && (
            <button type="button" className="btn" onClick={() => setAsk({ kind: 'damage' })}>
              Take fruit out
            </button>
          )}
          {can('warehouse.returns') && b.lifecycle === 'returned' && (
            <button type="button" className="btn" onClick={() => setAsk({ kind: 'restock' })}>
              Put back in stock
            </button>
          )}
          {can('warehouse.adjust') && WRITE_OFFABLE.includes(b.lifecycle) && (
            <button type="button" className="btn" onClick={() => setAsk({ kind: 'writeoff' })}>
              Write off
            </button>
          )}
        </div>
      )}

      <div className="grid-2">
        <section className="card" aria-labelledby="box-facts">
          <h2 id="box-facts">{b.skuName}</h2>
          <dl className="wh-facts">
            <div>
              <dt>State</dt>
              <dd>{LIFECYCLE_LABEL[b.lifecycle] ?? b.lifecycle}</dd>
            </div>
            <div>
              <dt>QC</dt>
              <dd>
                <Badge tone={qualityTone(b.quality)}>{QUALITY_LABEL[b.quality] ?? b.quality}</Badge>
              </dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{b.locationName ?? '—'}</dd>
            </div>
            <div>
              <dt>Batch</dt>
              <dd>{b.lotCode ? <Link to={`/warehouse/lots/${b.lotId}`}>{b.lotCode}</Link> : '—'}</dd>
            </div>
            <div>
              <dt>Best before</dt>
              <dd>{date(b.bestBefore)}</dd>
            </div>
            <div>
              <dt>Weight</dt>
              <dd>{kg(b.measuredWeightG ?? b.nominalWeightG)}</dd>
            </div>
            <div>
              <dt>Order</dt>
              <dd>{b.orderId && b.orderNumber ? <Link to={`/orders/${b.orderId}`}>{b.orderNumber}</Link> : '—'}</dd>
            </div>
            <div>
              <dt>Label reprints</dt>
              <dd>{b.reprintCount}</dd>
            </div>
          </dl>
        </section>

        <section className="card" aria-labelledby="box-holds">
          <h2 id="box-holds">Holds</h2>
          {b.holds.length === 0 ? (
            <p className="muted">No holds.</p>
          ) : (
            <ul className="plain-list wh-holds">
              {b.holds.map((h) => (
                <li key={h}>
                  <Badge tone="warn">{HOLD_LABEL[h] ?? h}</Badge>
                  {can(RELEASE_PERM[h]) && (
                    <button type="button" className="btn btn-small" onClick={() => setAsk({ kind: 'release', hold: h })}>
                      Release {HOLD_LABEL[h] ?? h}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {can('warehouse.qc') && (
            <button type="button" className="btn mt-3" onClick={() => setAsk({ kind: 'hold' })}>
              Put on hold
            </button>
          )}
        </section>
      </div>

      {(can('labels.print') || can('labels.reissue')) && (
        <section className="card" aria-labelledby="box-label">
          <h2 id="box-label">Label</h2>
          <div className="btn-row">
            {can('labels.print') && (
              <>
                <DownloadButton getUrl={() => wh.boxLabelUrl(b.id)} filename={`label-${b.code}.pdf`}>
                  Download label
                </DownloadButton>
                <button type="button" className="btn" onClick={() => setAsk({ kind: 'reprint' })}>
                  Record a reprint
                </button>
              </>
            )}
            {can('labels.reissue') && (
              <button type="button" className="btn" onClick={() => setAsk({ kind: 'reissue' })}>
                Replace label
              </button>
            )}
          </div>
          <p className="hint">Replace the label when it is lost or copied: the old one stops scanning.</p>
        </section>
      )}

      <section aria-labelledby="box-history">
        <h2 id="box-history">History</h2>
        {events.isPending ? (
          <Spinner label="Loading history" />
        ) : events.isError ? (
          <QueryError error={events.error} onRetry={() => events.refetch()} />
        ) : events.data.length === 0 ? (
          <EmptyState>No history yet.</EmptyState>
        ) : (
          <ol className="timeline">
            {events.data.map((e) => (
              <li key={e.id}>
                <strong>{eventLabel(e.type)}</strong>
                <div className="muted small">
                  {dateTime(e.at)}
                  {e.actor ? ` · ${e.actor}` : ''}
                </div>
                {(e.fromLocation || e.toLocation) && (
                  <div className="small">
                    {e.fromLocation ?? '—'} → {e.toLocation ?? '—'}
                  </div>
                )}
                {e.reason && <div className="small">{e.reason}</div>}
              </li>
            ))}
          </ol>
        )}
      </section>

      {ask?.kind === 'reprint' && (
        <ReasonDialog
          title="Record a reprint"
          label="Why reprint?"
          confirmLabel="Record reprint"
          tone="primary"
          busy={reprint.isPending}
          error={reprint.error}
          onSubmit={(r) => reprint.mutate(r)}
          onClose={() => setAsk(null)}
        />
      )}
      {ask?.kind === 'reissue' && (
        <ReasonDialog
          title="Replace this label?"
          label="Why replace it?"
          confirmLabel="Replace label"
          busy={reissue.isPending}
          error={reissue.error}
          onSubmit={(r) => reissue.mutate(r)}
          onClose={() => setAsk(null)}
        >
          <p>The current label stops scanning straight away.</p>
        </ReasonDialog>
      )}
      {ask?.kind === 'release' && (
        <ReasonDialog
          title={`Release ${HOLD_LABEL[ask.hold].toLowerCase()}`}
          label="Why release it?"
          confirmLabel="Release hold"
          tone="primary"
          busy={release.isPending}
          error={release.error}
          onSubmit={(reason) => release.mutate({ hold: ask.hold, reason })}
          onClose={() => setAsk(null)}
        />
      )}
      {ask?.kind === 'restock' && (
        <ReasonDialog
          title="Put this returned box back in stock?"
          label="Why can it be resold?"
          confirmLabel="Put back in stock"
          tone="primary"
          busy={restock.isPending}
          error={restock.error}
          onSubmit={(r) => restock.mutate(r)}
          onClose={() => setAsk(null)}
        >
          <p>It comes back as needs review in the returns area: pass QC and put it away before it sells.</p>
        </ReasonDialog>
      )}
      {ask?.kind === 'damage' && <DamageDialog box={b} onClose={() => setAsk(null)} onDone={done} />}
      {ask?.kind === 'measure' && <MeasureDialog box={b} onClose={() => setAsk(null)} onDone={done} />}
      {ask?.kind === 'writeoff' && <WriteOffDialog boxIds={[b.id]} what={`box ${b.code}`} onClose={() => setAsk(null)} />}
      {ask?.kind === 'hold' && <HoldDialog box={b} onClose={() => setAsk(null)} onDone={() => done('Box put on hold.')} />}
    </>
  )
}

function MeasureDialog({ box, onClose, onDone }: { box: Box; onClose: () => void; onDone: (msg: string) => void }) {
  const [weight, setWeight] = useState('')
  const [fruit, setFruit] = useState('')
  const [formError, setFormError] = useState<unknown>(null)
  const m = useMutation({
    mutationFn: () => wh.measure(box.id, { weightG: Number(weight), ...(fruit ? { fruitCount: Number(fruit) } : {}) }),
    onSuccess: (r) => onDone(r.outOfTolerance ? `Weighed ${kg(Number(weight) || null)}: outside the allowed range, so the box needs review.` : `Weighed ${kg(Number(weight) || null)}.`),
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    const g = Number(weight)
    if (!Number.isInteger(g) || g < 1 || g > 100_000) return setFormError('Enter the weight in whole grams.')
    if (fruit && (!Number.isInteger(Number(fruit)) || Number(fruit) < 1 || Number(fruit) > 200)) return setFormError('Fruit count is a whole number, 1 to 200.')
    setFormError(null)
    m.mutate()
  }
  return (
    <Dialog
      title={`Weigh ${box.code}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="measure-form" className="btn btn-primary" disabled={m.isPending}>
            {m.isPending ? 'Saving…' : 'Save weight'}
          </button>
        </>
      }
    >
      <form id="measure-form" onSubmit={submit} noValidate>
        <p>The label says {kg(box.nominalWeightG)}.</p>
        <div className="field">
          <label htmlFor="ms-weight">Weight in grams</label>
          <input id="ms-weight" type="number" inputMode="numeric" min={1} step={1} value={weight} onChange={(e) => setWeight(e.target.value)} data-autofocus />
        </div>
        <div className="field">
          <label htmlFor="ms-fruit">Fruit in the box (optional)</label>
          <input id="ms-fruit" type="number" inputMode="numeric" min={1} max={200} step={1} value={fruit} onChange={(e) => setFruit(e.target.value)} />
        </div>
        <FormError error={formError ?? m.error} />
      </form>
    </Dialog>
  )
}

function HoldDialog({ box, onClose, onDone }: { box: Box; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<HoldKind>(MANUAL_HOLDS.find((h) => !box.holds.includes(h)) ?? 'damage_hold')
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<unknown>(null)
  const m = useMutation({ mutationFn: () => wh.addHold(box.id, kind, reason.trim()), onSuccess: onDone })
  function submit(e: FormEvent) {
    e.preventDefault()
    if (reason.trim().length < 3) return setFormError('Give a reason (at least 3 characters).')
    setFormError(null)
    m.mutate()
  }
  return (
    <Dialog
      title="Put on hold"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="box-hold-form" className="btn btn-primary" disabled={m.isPending}>
            {m.isPending ? 'Saving…' : 'Put on hold'}
          </button>
        </>
      }
    >
      <form id="box-hold-form" onSubmit={submit} noValidate>
        <p>A held box cannot be picked or sold until the hold is released.</p>
        <div className="field">
          <label htmlFor="hold-kind">Hold</label>
          <select id="hold-kind" value={kind} onChange={(e) => setKind(e.target.value as HoldKind)} data-autofocus>
            {MANUAL_HOLDS.map((h) => (
              <option key={h} value={h}>
                {HOLD_LABEL[h]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="hold-reason">Reason</label>
          <input id="hold-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </div>
        <FormError error={formError ?? m.error} />
      </form>
    </Dialog>
  )
}

const DAMAGE_REASONS = Object.keys(DAMAGE_REASON_LABEL) as DamageReason[]

/** Partial damage: fruit taken out of a box without repacking it. Below the weight tolerance the box goes to review. */
function DamageDialog({ box, onClose, onDone }: { box: Box; onClose: () => void; onDone: (msg: string) => void }) {
  const [reasonCode, setReasonCode] = useState<DamageReason>('spoiled_fruit')
  const [fruit, setFruit] = useState('')
  const [grams, setGrams] = useState('')
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<unknown>(null)
  const m = useMutation({
    mutationFn: () =>
      wh.damage(box.id, {
        reasonCode,
        reason: reason.trim(),
        ...(fruit.trim() ? { fruitRemoved: Number(fruit) } : {}),
        ...(grams.trim() ? { weightLostG: Number(grams) } : {}),
      }),
    onSuccess: (r) =>
      onDone(r.needsReview ? 'Recorded. The box is now under its weight range and needs review before it sells.' : `Recorded. The box now weighs ${kg(r.box.measuredWeightG ?? r.box.nominalWeightG)}.`),
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    const f = fruit.trim() ? Number(fruit) : 0
    const g = grams.trim() ? Number(grams) : 0
    if (!Number.isInteger(f) || f < 0 || f > 200) return setFormError('Fruit taken out is a whole number, up to 200.')
    if (!Number.isInteger(g) || g < 0 || g > 100_000) return setFormError('Weight taken out is in whole grams.')
    if (!f && !g) return setFormError('Say how much fruit or weight came out.')
    if (reason.trim().length < 3) return setFormError('Say what happened (at least 3 characters).')
    setFormError(null)
    m.mutate()
  }
  return (
    <Dialog
      title={`Take fruit out of ${box.code}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="damage-form" className="btn btn-primary" disabled={m.isPending}>
            {m.isPending ? 'Saving…' : 'Record'}
          </button>
        </>
      }
    >
      <form id="damage-form" onSubmit={submit} noValidate>
        <p>
          The box keeps its label. It weighs {kg(box.measuredWeightG ?? box.nominalWeightG)} now; below its weight range it goes to review. To open it and pack again,
          use Repack.
        </p>
        <div className="field">
          <label htmlFor="dm-code">Why</label>
          <select id="dm-code" value={reasonCode} onChange={(e) => setReasonCode(e.target.value as DamageReason)} data-autofocus>
            {DAMAGE_REASONS.map((r) => (
              <option key={r} value={r}>
                {DAMAGE_REASON_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="dm-fruit">Fruit taken out</label>
          <input id="dm-fruit" type="number" inputMode="numeric" min={0} max={200} step={1} value={fruit} onChange={(e) => setFruit(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="dm-grams">Weight taken out (g)</label>
          <input id="dm-grams" type="number" inputMode="numeric" min={0} step={1} value={grams} onChange={(e) => setGrams(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="dm-reason">What happened</label>
          <input id="dm-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </div>
        <FormError error={formError ?? m.error} />
      </form>
    </Dialog>
  )
}
