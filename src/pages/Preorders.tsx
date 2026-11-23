import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { RIPENESS_LABEL, date, rupees, type Tone } from '../format'
import { useSession } from '../session'
import { MONEY_CHANGE_WHY, useStepUp } from '../StepUp'
import type { Preorder, PreorderStatus, PreorderWeeks } from '../types'
import { Badge, EmptyState, FormError, GatedButton, ManagerOnlyNote, PhoneLink, QueryError, ReasonDialog, Spinner, scrollRegion, useToast, usePageTitle } from '../ui'

const STATUS_LABEL: Record<PreorderStatus, string> = {
  PAYMENT_PENDING: 'Awaiting payment',
  BOOKED: 'Paid',
  WAITLISTED: 'Waitlist',
  CONVERTED: 'Order created',
  CANCELLED: 'Cancelled',
}
const STATUS_TONE: Record<PreorderStatus, Tone> = {
  PAYMENT_PENDING: 'warn',
  BOOKED: 'info',
  WAITLISTED: 'neutral',
  CONVERTED: 'good',
  CANCELLED: 'neutral',
}
const FILTERS: (PreorderStatus | null)[] = [null, 'BOOKED', 'WAITLISTED', 'PAYMENT_PENDING', 'CONVERTED', 'CANCELLED']
const weekLabel = (d: string) => `Week of ${date(d)}`

export default function Preorders() {
  usePageTitle('Preorders')
  return (
    <>
      <div className="topbar">
        <h1>Preorders</h1>
      </div>
      <DeliveryWeeks />
      <PreorderList />
    </>
  )
}

/** Kilograms in words: 7,000 or 2.5. */
const kg = (x: number) => x.toLocaleString('en-IN', { maximumFractionDigits: 1 })

/**
 * The delivery weeks, each with its limit in kg for every box (migrations 074, 076): booked / limit per week. The
 * default limit is Planning's mangoes expected per day x 7; a manager can set a week's own expected kg here when
 * supply differs. A full week sends new pre-orders to the next one by themselves. A week lowered below what it holds
 * shows how much it is over: move some bookings to a later week (Move, in the bookings below).
 */
function DeliveryWeeks() {
  const { me } = useSession()
  const manager = me?.role === 'MANAGER'
  const q = useQuery({ queryKey: ['preorder-weeks'], queryFn: api.preorderWeeks })
  // Since migration 076 the limit counts kilograms; an older API counted pre-orders.
  const unit = q.data?.countsBy === 'kg' ? 'kg' : q.data?.countsBy === 'boxes' ? 'boxes' : 'pre-orders'

  return (
    <section className="card">
      <div className="topbar section-head">
        <h2>Delivery weeks</h2>
        <span className="spacer" />
        <Link className="btn" to="/planning">
          Change the daily amount
        </Link>
      </div>
      <p className="muted">
        {q.data?.dayKg
          ? `Each week takes up to ${kg(q.data.limit)} ${unit} of pre-orders across all boxes: ${kg(q.data.dayKg)} kg expected a day × 7 (Planning), unless a week has its own amount below. `
          : `Each week takes up to ${q.data ? kg(q.data.limit) : '…'} ${unit} of pre-orders across all boxes. `}
        When a week is full, new pre-orders go to the next week automatically, and the shop tells the customer their week before they pay. A week
        before delivery, paid preorders become orders on a date with stock.
      </p>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.weeks.length === 0 ? (
        <EmptyState>No delivery weeks are open for pre-orders (the season has ended, or its end date has passed).</EmptyState>
      ) : (
        <>
          {q.data.waitlisted > 0 && (
            <p className="small text-warn">
              {q.data.waitlisted} {q.data.waitlisted === 1 ? 'booking waits' : 'bookings wait'} on the waitlist: every week was full when they booked.
            </p>
          )}
          <div {...scrollRegion('Delivery weeks')}>
            <table>
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Booked</th>
                  <th>Expected this week ({unit})</th>
                  <th className="num">Left ({unit})</th>
                  <th className="num">Pre-orders</th>
                  <th className="num">Boxes</th>
                  <th className="num">Unpaid</th>
                </tr>
              </thead>
              <tbody>
                {q.data.weeks.map((w) => {
                  const pct = Math.min(100, Math.round((w.booked / Math.max(w.limit, 1)) * 100))
                  const over = w.over ?? 0
                  return (
                    <tr key={w.weekStart}>
                      <td>
                        {weekLabel(w.weekStart)}
                        {w.weekStart === q.data.nextWeek && <div className="small">New pre-orders go here</div>}
                      </td>
                      <td>
                        <div className="small">
                          {kg(w.booked)} of {kg(w.limit)} {unit}
                          {w.remaining <= 0 && over <= 0 ? ' · full' : ''}
                        </div>
                        <span className={`slot-meter${w.remaining <= 0 ? ' is-full' : ''}`} aria-hidden="true">
                          <span className="meter">
                            <span style={{ width: `${pct}%` }} />
                          </span>
                        </span>
                        {over > 0 && (
                          <div className="small text-warn">
                            <span aria-hidden="true">⚠ </span>
                            <strong>
                              Over by {kg(over)} {unit}
                            </strong>
                            <div>Move some bookings to a later week (Move, in the bookings below).</div>
                          </div>
                        )}
                      </td>
                      <td>
                        <WeekLimit week={w} unit={unit} manager={manager} defaultLimit={q.data.limit} />
                      </td>
                      <td className={`num${w.remaining <= 0 ? ' text-warn' : ''}`}>{kg(w.remaining)}</td>
                      <td className="num">{(w.orders ?? 0).toLocaleString('en-IN')}</td>
                      <td className="num">{w.boxes.toLocaleString('en-IN')}</td>
                      <td className="num">{w.unpaid}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!manager && <ManagerOnlyNote what="Changing a week's expected kg" />}
        </>
      )}
    </section>
  )
}

type Week = PreorderWeeks['weeks'][number]

/** A week's own expected kg: empty uses the default (daily x 7). Managers only; others see the number. */
function WeekLimit({ week, unit, manager, defaultLimit }: { week: Week; unit: string; manager: boolean; defaultLimit: number }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [value, setValue] = useState(week.own == null ? '' : String(week.own))
  const [formError, setFormError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (limitKg: number | null) => api.setPreorderWeekLimit(week.weekStart, limitKg),
    onSuccess: (r) => {
      toast.success(r.own == null ? `${weekLabel(week.weekStart)} uses the default again` : `${weekLabel(week.weekStart)}: ${kg(r.own)} ${unit} expected`)
      setValue(r.own == null ? '' : String(r.own))
      void queryClient.invalidateQueries({ queryKey: ['preorder-weeks'] })
    },
  })
  if (!manager) {
    return (
      <span className="small">
        {kg(week.limit)}
        {week.own == null ? ' (default)' : ''}
      </span>
    )
  }
  const id = `week-kg-${week.weekStart}`
  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const v = value.trim()
    if (v === '') return save.mutate(null)
    if (!/^\d+(\.\d+)?$/.test(v)) return setFormError('Enter kilograms, e.g. 6500, or leave it empty for the default.')
    save.mutate(Number(v))
  }
  return (
    <form onSubmit={onSubmit} noValidate className="btn-row align-end">
      <label htmlFor={id} className="sr-only">
        Expected kg for the {weekLabel(week.weekStart).toLowerCase()}
      </label>
      <input id={id} inputMode="decimal" size={7} placeholder={`${kg(defaultLimit)} (default)`} value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="submit" className="btn btn-small" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
      {formError ? <p className="small text-warn">{formError}</p> : <FormError error={save.error} />}
    </form>
  )
}

function PreorderList() {
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as PreorderStatus | null) || null
  const q = useQuery({ queryKey: ['preorders', status], queryFn: () => api.preorders(status) })
  const { me } = useSession()
  const [cancelling, setCancelling] = useState<Preorder | null>(null)
  const [moving, setMoving] = useState<Preorder | null>(null)

  function setStatus(s: PreorderStatus | null) {
    const p = new URLSearchParams(params)
    if (s) p.set('status', s)
    else p.delete('status')
    setParams(p, { replace: true })
  }

  return (
    <section className="card">
      <h2>Bookings</h2>
      <div className="segmented mb-3" role="group" aria-label="Filter by status">
        {FILTERS.map((s) => (
          <button key={s ?? 'all'} type="button" className="btn btn-small" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s ? STATUS_LABEL[s] : 'All'}
          </button>
        ))}
      </div>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState>No preorders here.</EmptyState>
      ) : (
        <div {...scrollRegion('Preorders')}>
          <table>
            <thead>
              <tr>
                <th>Preorder</th>
                <th>Customer</th>
                <th>Boxes</th>
                <th>Week</th>
                <th className="num">Total</th>
                <th>State</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.number}</strong>
                    {p.channel === 'whatsapp' && <div className="muted small">via WhatsApp</div>}
                  </td>
                  <td>
                    {p.customerName ?? '—'}
                    {p.phone && (
                      <div className="small">
                        <PhoneLink phone={p.phone} who={p.customerName ?? 'the customer'} />
                      </div>
                    )}
                    {p.gift && (
                      <div className="small">
                        Gift for {p.gift.recipientName} · <PhoneLink phone={p.gift.recipientPhone} who={p.gift.recipientName} />
                        {p.gift.message && <div className="muted">“{p.gift.message}”</div>}
                      </div>
                    )}
                    {p.group && (
                      <div className="muted small">
                        Part of gift group {p.group.number ?? ''}
                        {p.group.people ? ` · ${p.group.people} ${p.group.people === 1 ? 'person' : 'people'}` : ''}
                      </div>
                    )}
                  </td>
                  <td>
                    {p.qty} × {p.productName}
                    <div className="muted small">{RIPENESS_LABEL[p.stage]}</div>
                  </td>
                  <td>
                    {weekLabel(p.weekStart)}
                    {p.movedCount > 0 && (
                      <div className="small text-warn">
                        Moved {p.movedCount === 1 ? 'once' : `${p.movedCount} times`}: no stock
                      </div>
                    )}
                  </td>
                  <td className="num">{rupees(p.total)}</td>
                  <td>
                    <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                    {p.nonRefundable && (
                      <>
                        {' '}
                        <Badge tone="neutral">Non-refundable</Badge>
                      </>
                    )}
                    {p.order && (
                      <div className="small">
                        <Link to={`/orders/${p.order.id}`}>{p.order.number}</Link> on {date(p.order.deliveryDate)}
                      </div>
                    )}
                    {p.refund && (
                      <div className="small muted">{p.refund.refundedAt ? 'Refunded' : 'Refund pending'}</div>
                    )}
                  </td>
                  <td>
                    <div className="btn-row">
                      {MOVABLE.includes(p.status) && (
                        <GatedButton allowed={me?.role === 'MANAGER'} className="btn btn-small" onClick={() => setMoving(p)}>
                          Move<span className="sr-only"> {p.number} to another week</span>
                        </GatedButton>
                      )}
                      {OPEN.includes(p.status) && (
                        <GatedButton allowed={me?.role === 'MANAGER'} className="btn btn-small" onClick={() => setCancelling(p)}>
                          Cancel<span className="sr-only"> {p.number}</span>
                        </GatedButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {me?.role !== 'MANAGER' && q.data?.some((p) => OPEN.includes(p.status)) && <ManagerOnlyNote what="Moving or cancelling a booking" />}
      {cancelling && <CancelPreorderDialog preorder={cancelling} onClose={() => setCancelling(null)} />}
      {moving && <MovePreorderDialog preorder={moving} onClose={() => setMoving(null)} />}
    </section>
  )
}

/** Bookings a manager can move to another week: unpaid or paid, not yet an order. */
const MOVABLE: PreorderStatus[] = ['PAYMENT_PENDING', 'BOOKED']

/** Moves a booking to another delivery week with room for its kg; a paid booking's customer is told. */
function MovePreorderDialog({ preorder, onClose }: { preorder: Preorder; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const weeks = useQuery({ queryKey: ['preorder-weeks'], queryFn: api.preorderWeeks })
  const choices = (weeks.data?.weeks ?? []).filter((w) => w.weekStart !== preorder.weekStart)
  const [to, setTo] = useState('')
  const chosen = to || choices.find((w) => w.weekStart > preorder.weekStart && w.remaining > 0)?.weekStart || choices[0]?.weekStart || ''
  const move = useMutation({
    mutationFn: (reason: string) => api.movePreorder(preorder.id, chosen, reason),
    onSuccess: () => {
      toast.success(`${preorder.number} moved to the ${weekLabel(chosen).toLowerCase()}`)
      void queryClient.invalidateQueries({ queryKey: ['preorders'] })
      void queryClient.invalidateQueries({ queryKey: ['preorder-weeks'] })
      onClose()
    },
  })
  return (
    <ReasonDialog
      title={`Move preorder ${preorder.number}?`}
      tone="primary"
      confirmLabel="Move booking"
      busyLabel="Moving…"
      hint="At least 3 characters. Saved on the booking's history."
      busy={move.isPending}
      error={move.error}
      onClose={onClose}
      onSubmit={(reason) => chosen && move.mutate(reason)}
    >
      <div className="field">
        <label htmlFor="move-week">Move to</label>
        <select id="move-week" value={chosen} onChange={(e) => setTo(e.target.value)}>
          {choices.map((w) => (
            <option key={w.weekStart} value={w.weekStart}>
              {weekLabel(w.weekStart)} · {kg(w.remaining)} kg left
            </option>
          ))}
        </select>
      </div>
      <p className="muted small">
        Now in the {weekLabel(preorder.weekStart).toLowerCase()}. Its kg moves with it.{' '}
        {preorder.status === 'BOOKED' ? 'The customer gets a message with the new week.' : 'It is not paid yet: the customer sees the new week when they pay.'}
      </p>
    </ReasonDialog>
  )
}

/** Bookings a manager can still cancel. One already turned into an order is cancelled from the order page. */
const OPEN: PreorderStatus[] = ['PAYMENT_PENDING', 'BOOKED', 'WAITLISTED']

function CancelPreorderDialog({ preorder, onClose }: { preorder: Preorder; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const paid = preorder.paymentStatus === 'SUCCEEDED'
  // A paid booking is refunded: the manager confirms it is them (the server's STEP_UP_ROUTES).
  const stepUp = useStepUp(MONEY_CHANGE_WHY)
  const cancel = useMutation({
    mutationFn: (reason: string) => stepUp.run((code) => api.cancelPreorder(preorder.id, reason, code)),
    onSuccess: (r) => {
      toast.success(r.refunded ? `${preorder.number} cancelled; ${rupees(preorder.total)} is being refunded` : `${preorder.number} cancelled`)
      void queryClient.invalidateQueries({ queryKey: ['preorders'] })
      void queryClient.invalidateQueries({ queryKey: ['preorder-weeks'] })
      onClose()
    },
  })
  return (
    <>
      <ReasonDialog
        title={`Cancel preorder ${preorder.number}?`}
        confirmLabel={paid ? 'Cancel and refund' : 'Cancel booking'}
        cancelLabel="Keep booking"
        busyLabel="Cancelling…"
        hint="At least 3 characters. Saved on the booking's history."
        busy={cancel.isPending}
        error={cancel.error}
        onClose={onClose}
        onSubmit={(reason) => cancel.mutate(reason)}
      >
        <p>
          {paid
            ? `The customer paid ${rupees(preorder.total)}. It goes back to them in full${preorder.nonRefundable ? ' (non-refundable only stops the customer cancelling; a cancel by us always refunds)' : ''}. Use this when we can't fill the booking (crop failure, the season ending).`
            : 'The booking has not been paid, so there is nothing to refund.'}{' '}
          Its place goes back to the week.
        </p>
      </ReasonDialog>
      {stepUp.dialog}
    </>
  )
}
