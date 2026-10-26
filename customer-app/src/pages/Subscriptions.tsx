// Mango season subscriptions (docs/care.md, SUBSCRIPTIONS). A customer picks a
// box (mango, ripeness, how many), every week or every other week, a day, a
// time, a saved address and an end date no later than the season's end. There
// is no auto-debit and no wallet: a couple of days before each delivery we set
// it up and ask them to pay; Pay makes an ordinary order, paid for on its order
// page, which holds the boxes only from then. They can skip one, pause, resume
// or cancel. The API checks and decides everything; this page only shows it.
import { useId, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Frequency, type Stage, type Subscription, type SubscriptionCycle, type SubscriptionStatus } from '../api'
import { useCare } from '../features'
import { STAGE_LABEL, day, rupees, slotText } from '../format'
import { Field, Stepper } from '../forms'
import { productsQuery } from '../queries'
import { ConfirmDialog, DocTitle, ErrorNote, PageHeader, Spinner } from '../ui'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const STAGES: Stage[] = ['RAW', 'SEMI_RIPE', 'RIPE']
const STATUS_LABEL: Record<SubscriptionStatus, string> = { ACTIVE: 'Running', PAUSED: 'Paused', CANCELLED: 'Cancelled', ENDED: 'Ended' }
const STATUS_TONE: Record<SubscriptionStatus, string> = { ACTIVE: 'pill-good', PAUSED: 'pill-warn', CANCELLED: 'pill-muted', ENDED: 'pill-muted' }
/** Mirrors the API's limit on boxes per delivery. */
const MAX_BOXES = 20

function StatusPill({ status }: { status: SubscriptionStatus }) {
  return <span className={`pill ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>
}

const every = (s: { frequency: Frequency; weekday: number }) => `${s.frequency === 'WEEKLY' ? 'Every' : 'Every other'} ${WEEKDAYS[s.weekday - 1]}`
const boxText = (s: Subscription) => `${s.qty} × ${s.productName} (${STAGE_LABEL[s.stage]})`

/** The Account page's "Your subscriptions" card. Nothing while the switch is off. */
export function YourSubscriptions() {
  const care = useCare()
  const q = useQuery({ queryKey: ['subscriptions'], queryFn: api.subscriptions, enabled: care.subscriptions })
  if (!care.subscriptions) return null
  return (
    <section className="card narrow" aria-labelledby="your-subscriptions">
      <h2 id="your-subscriptions">Your subscriptions</h2>
      <p className="muted small">A box every week or every other week this season. We remind you to pay a couple of days before each one; nothing is taken from your account on its own.</p>
      {q.isPending ? (
        <Spinner label="Loading your subscriptions" />
      ) : q.isError ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          {q.data.items.length > 0 && (
            <ul className="plain-list">
              {q.data.items.map((s) => {
                const due = s.cycles.find((y) => y.canPay || y.awaitingPayment)
                return (
                  <li key={s.id}>
                    <Link to={`/account/subscriptions/${encodeURIComponent(s.id)}`}>
                      <strong>{boxText(s)}</strong>
                    </Link>{' '}
                    <StatusPill status={s.status} />
                    <span className="muted small help-preview">
                      {every(s)}, until {day(s.endDate)}
                      {due ? ` · Box for ${day(due.deliveryDate ?? due.scheduledFor)} waiting for payment` : ''}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          {q.data.open ? (
            <Link to="/account/subscriptions/new" className="btn btn-block">
              Start a subscription
            </Link>
          ) : (
            <p className="muted small">New subscriptions are closed for this season.</p>
          )}
        </>
      )}
    </section>
  )
}

function Off() {
  return (
    <section className="card narrow">
      <h1>Subscriptions</h1>
      <p>
        Subscriptions aren't open right now. <Link to="/">Order a box</Link> or <Link to="/preorder">book ahead</Link> instead.
      </p>
    </section>
  )
}

/** /account/subscriptions/new */
export function NewSubscription() {
  const care = useCare()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const formId = useId()
  const products = useQuery({ ...productsQuery(), enabled: care.subscriptions })
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: api.addresses, enabled: care.subscriptions })
  const list = useQuery({ queryKey: ['subscriptions'], queryFn: api.subscriptions, enabled: care.subscriptions })
  const [sku, setSku] = useState('')
  const [stage, setStage] = useState<Stage>('RIPE')
  const [qty, setQty] = useState(1)
  const [frequency, setFrequency] = useState<Frequency>('WEEKLY')
  const [weekday, setWeekday] = useState(6)
  const [addressId, setAddressId] = useState<string | null>(null)
  const [slotId, setSlotId] = useState<string | null>(null)
  const [endDate, setEndDate] = useState('')
  const [tried, setTried] = useState(false)
  const address = addresses.data?.find((a) => a.id === addressId) ?? null
  // Times are the shop's daily delivery times; which ones have room is checked for each delivery.
  const slots = useQuery({ queryKey: ['subscription-slots', address?.pincode], queryFn: () => api.slots(address!.pincode, ''), enabled: !!address })
  const create = useMutation({
    mutationFn: () => api.subscribe({ sku, stage, qty, frequency, weekday, slotId, addressId: addressId!, endDate }),
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
      queryClient.setQueryData(['subscription', s.id], s)
      navigate(`/account/subscriptions/${encodeURIComponent(s.id)}`)
    },
  })

  if (!care.subscriptions) return <Off />
  if (products.isPending || addresses.isPending || list.isPending) return <Spinner label="Loading" />
  const loadError = products.error ?? addresses.error ?? list.error
  if (loadError) return <ErrorNote error={loadError} />
  const seasonEnd = list.data?.seasonEnd ?? null
  if (!list.data?.open || !seasonEnd) return <Off />
  const product = products.data?.items.find((p) => p.sku === sku) ?? null
  const slotList = slots.data?.slots ?? []
  const errors = {
    sku: tried && !sku ? 'Choose a box' : null,
    address: tried && !addressId ? 'Choose where to deliver' : null,
    slot: tried && slotList.length > 0 && !slotId ? 'Choose a delivery time' : null,
    endDate: tried && !endDate ? 'Choose the last day' : null,
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setTried(true)
    if (!sku || !addressId || !endDate || (slotList.length > 0 && !slotId)) return
    create.mutate()
  }

  return (
    <section className="card narrow" aria-labelledby={`${formId}-title`}>
      <Link to="/account" className="back-link">
        ← Your account
      </Link>
      <h1 id={`${formId}-title`}>Start a subscription</h1>
      <p>
        We set up each box a couple of days before it comes and send you a reminder to pay for it. Nothing is taken from your account on its
        own, and there is no wallet: you pay for each box like any order. Skip, pause or cancel any time from your account.
      </p>
      {addresses.data && addresses.data.length === 0 ? (
        <p className="note">
          Subscriptions go to an address you have ordered to before. <Link to="/">Order a box</Link> first, and it is saved for next time.
        </p>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <Field id={`${formId}-sku`} label="Box" error={errors.sku}>
            <select value={sku} onChange={(e) => setSku(e.target.value)}>
              <option value="">Choose a box</option>
              {products.data?.items.map((p) => (
                <option key={p.sku} value={p.sku}>
                  {p.name}, {rupees(p.price)}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="field">
            <legend>Ripeness when it arrives</legend>
            <div className="options">
              {STAGES.map((s) => (
                <label key={s} className="option">
                  <input type="radio" name={`${formId}-stage`} checked={stage === s} onChange={() => setStage(s)} />
                  <span>{STAGE_LABEL[s]}</span>
                </label>
              ))}
            </div>
            <p className="muted small">The same price for every ripeness.</p>
          </fieldset>
          <div className="field">
            <Stepper label="Boxes each time" showLabel value={qty} min={1} max={MAX_BOXES} onChange={setQty} lessLabel="One box fewer" moreLabel="One box more" />
            {product && <p className="muted small">{rupees(product.price * qty)} each time.</p>}
          </div>
          <fieldset className="field">
            <legend>How often</legend>
            <div className="options">
              <label className="option">
                <input type="radio" name={`${formId}-freq`} checked={frequency === 'WEEKLY'} onChange={() => setFrequency('WEEKLY')} />
                <span>Every week</span>
              </label>
              <label className="option">
                <input type="radio" name={`${formId}-freq`} checked={frequency === 'FORTNIGHTLY'} onChange={() => setFrequency('FORTNIGHTLY')} />
                <span>Every other week</span>
              </label>
            </div>
          </fieldset>
          <Field id={`${formId}-day`} label="Delivery day">
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAYS.map((w, i) => (
                <option key={w} value={i + 1}>
                  {w}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="field" aria-describedby={errors.address ? `${formId}-addr-error` : undefined}>
            <legend>Deliver to</legend>
            <div className="options">
              {addresses.data?.map((a) => (
                <label key={a.id} className="option">
                  <input
                    type="radio"
                    name={`${formId}-address`}
                    checked={addressId === a.id}
                    onChange={() => {
                      setAddressId(a.id)
                      setSlotId(null)
                    }}
                  />
                  <span className="option-text">
                    {a.name && <strong>{a.name}</strong>}
                    <span>{a.address}</span>
                  </span>
                </label>
              ))}
            </div>
            {errors.address && (
              <p id={`${formId}-addr-error`} className="field-error" role="alert">
                {errors.address}
              </p>
            )}
          </fieldset>
          {slotList.length > 0 && (
            <fieldset className="field" aria-describedby={errors.slot ? `${formId}-slot-error` : undefined}>
              <legend>Delivery time</legend>
              <div className="options">
                {slotList.map((s) => (
                  <label key={s.id} className="option">
                    <input type="radio" name={`${formId}-slot`} checked={slotId === s.id} onChange={() => setSlotId(s.id)} />
                    <span>{slotText(s)}</span>
                  </label>
                ))}
              </div>
              <p className="muted small">If your time is full on a day, we use another time that day.</p>
              {errors.slot && (
                <p id={`${formId}-slot-error`} className="field-error" role="alert">
                  {errors.slot}
                </p>
              )}
            </fieldset>
          )}
          <ErrorNote error={slots.error} />
          <Field id={`${formId}-end`} label="Last delivery no later than" hint={`The season ends on ${day(seasonEnd)}.`} error={errors.endDate}>
            <input type="date" value={endDate} max={seasonEnd} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <ErrorNote error={create.error} />
          <button type="submit" className="btn btn-primary btn-block" disabled={create.isPending}>
            {create.isPending ? 'Starting…' : 'Start subscription'}
          </button>
        </form>
      )}
    </section>
  )
}

/** /account/subscriptions/:id */
export function SubscriptionPage() {
  const { id = '' } = useParams()
  const care = useCare()
  const q = useQuery({ queryKey: ['subscription', id], queryFn: () => api.subscription(id), enabled: care.subscriptions })
  if (!care.subscriptions) return <Off />
  if (q.isPending) return <Spinner label="Loading your subscription" />
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  return <Detail s={q.data} />
}

function Detail({ s }: { s: Subscription }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [cancelling, setCancelling] = useState(false)
  const [skipping, setSkipping] = useState<string | null>(null)
  const payKey = useRef<{ cycleId: string; key: string } | null>(null)
  const saved = (next: Subscription) => {
    queryClient.setQueryData(['subscription', s.id], next)
    queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
  }
  const pause = useMutation({ mutationFn: () => api.pauseSubscription(s.id), onSuccess: saved })
  const resume = useMutation({ mutationFn: () => api.resumeSubscription(s.id), onSuccess: saved })
  const cancel = useMutation({
    mutationFn: () => api.cancelSubscription(s.id),
    onSuccess: (next) => {
      saved(next)
      setCancelling(false)
    },
  })
  const skip = useMutation({
    mutationFn: (date: string) => api.skipDelivery(s.id, date),
    onSuccess: (next) => {
      saved(next)
      setSkipping(null)
    },
  })
  const pay = useMutation({
    mutationFn: (cycleId: string) => {
      // One key per delivery while this page is open: a second tap or a retry gets the same order.
      if (payKey.current?.cycleId !== cycleId) payKey.current = { cycleId, key: crypto.randomUUID() }
      return api.payDelivery(s.id, cycleId, payKey.current.key)
    },
    onSuccess: (o) => {
      queryClient.invalidateQueries({ queryKey: ['subscription', s.id] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      navigate(`/orders/${encodeURIComponent(o.orderId)}`)
    },
    onError: () => {
      payKey.current = null
    },
  })
  const running = s.status === 'ACTIVE' || s.status === 'PAUSED'
  const cycles = [...s.cycles].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
  const coming = cycles.filter((y) => y.canPay || y.awaitingPayment || (y.paid && y.order && !['DELIVERED', 'CANCELLED', 'RTO'].includes(y.order.status)))
  const past = cycles.filter((y) => !coming.includes(y)).reverse()

  return (
    <>
      <section className="card narrow" aria-labelledby="sub-title">
        <DocTitle title={`Subscription ${s.number}`} />
        <Link to="/account" className="back-link">
          ← Your account
        </Link>
        <PageHeader title={<span id="sub-title">{boxText(s)}</span>}>
          <StatusPill status={s.status} />
        </PageHeader>
        <dl className="details">
          <dt>When</dt>
          <dd>
            {every(s)}, until {day(s.endDate)}
          </dd>
          {s.unitPrice != null && (
            <>
              <dt>Each box</dt>
              <dd>{rupees(s.unitPrice * s.qty)}, paid each time (no auto-debit)</dd>
            </>
          )}
          {s.address && (
            <>
              <dt>Deliver to</dt>
              <dd>
                {s.address.name && <strong>{s.address.name}, </strong>}
                {s.address.address}
              </dd>
            </>
          )}
          <dt>Number</dt>
          <dd>{s.number}</dd>
        </dl>
        {s.status === 'PAUSED' && <p className="note">Paused: no boxes are set up until you resume.</p>}
        {s.status === 'ENDED' && <p className="note">This subscription has reached its end date.</p>}
        <div className="row">
          {s.status === 'ACTIVE' && (
            <button type="button" className="btn" disabled={pause.isPending} onClick={() => pause.mutate()}>
              {pause.isPending ? 'Pausing…' : 'Pause'}
            </button>
          )}
          {s.status === 'PAUSED' && (
            <button type="button" className="btn btn-primary" disabled={resume.isPending} onClick={() => resume.mutate()}>
              {resume.isPending ? 'Resuming…' : 'Resume'}
            </button>
          )}
          {running && (
            <button type="button" className="btn btn-quiet" onClick={() => setCancelling(true)}>
              Cancel subscription
            </button>
          )}
        </div>
        <ErrorNote error={pause.error ?? resume.error} />
      </section>

      <section className="card narrow" aria-labelledby="sub-coming">
        <h2 id="sub-coming">Coming boxes</h2>
        {coming.length === 0 && (s.status !== 'ACTIVE' || s.upcoming.length === 0) ? (
          <p className="muted">None coming.</p>
        ) : (
          <ul className="sub-cycles">
            {coming.map((y) => (
              <CycleRow key={y.id} y={y} onPay={() => pay.mutate(y.id)} paying={pay.isPending && pay.variables === y.id} onSkip={y.canPay ? () => setSkipping(y.scheduledFor) : undefined} />
            ))}
            {s.status === 'ACTIVE' &&
              s.upcoming.map((d) => (
                <li key={d}>
                  <span>{day(d)}</span>
                  <span className="muted small">We remind you to pay a couple of days before.</span>
                  <button type="button" className="link-btn" onClick={() => setSkipping(d)}>
                    Skip<span className="sr-only"> {day(d)}</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
        <ErrorNote error={pay.error} />
      </section>

      {past.length > 0 && (
        <section className="card narrow" aria-labelledby="sub-past">
          <h2 id="sub-past">Earlier boxes</h2>
          <ul className="sub-cycles">
            {past.map((y) => (
              <li key={y.id}>
                <span>{day(y.deliveryDate ?? y.scheduledFor)}</span>
                <span className="muted small">{pastText(y)}</span>
                {y.order && <Link to={`/orders/${encodeURIComponent(y.order.id)}`}>Order {y.order.number}</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {skipping && (
        <ConfirmDialog
          title={`Skip the box for ${day(skipping)}?`}
          keepLabel="Keep it"
          confirmLabel="Skip this box"
          busyLabel="Skipping…"
          busy={skip.isPending}
          error={skip.error}
          onConfirm={() => skip.mutate(skipping)}
          onClose={() => setSkipping(null)}
        >
          <p>Nothing comes that week, and your next box is not affected.</p>
        </ConfirmDialog>
      )}
      {cancelling && (
        <ConfirmDialog
          title="Cancel this subscription?"
          keepLabel="Keep subscription"
          confirmLabel="Cancel subscription"
          busyLabel="Cancelling…"
          busy={cancel.isPending}
          error={cancel.error}
          onConfirm={() => cancel.mutate()}
          onClose={() => setCancelling(false)}
        >
          <p>No more boxes are set up. A box you have already paid for still comes; you can cancel that order from its page before it is packed.</p>
        </ConfirmDialog>
      )}
    </>
  )
}

function CycleRow({ y, onPay, paying, onSkip }: { y: SubscriptionCycle; onPay: () => void; paying: boolean; onSkip?: () => void }) {
  const date = day(y.deliveryDate ?? y.scheduledFor)
  return (
    <li>
      <span>{date}</span>
      {y.paid && y.order ? (
        <Link to={`/orders/${encodeURIComponent(y.order.id)}`}>Paid · order {y.order.number}</Link>
      ) : y.awaitingPayment && y.order ? (
        <Link to={`/orders/${encodeURIComponent(y.order.id)}`} className="btn btn-primary">
          Finish paying<span className="sr-only"> for {date}</span>
        </Link>
      ) : (
        <button type="button" className="btn btn-primary" disabled={paying} onClick={onPay}>
          {paying ? 'Setting up…' : 'Pay for this box'}
          <span className="sr-only"> for {date}</span>
        </button>
      )}
      {onSkip && (
        <button type="button" className="link-btn" onClick={onSkip}>
          Skip<span className="sr-only"> {date}</span>
        </button>
      )}
      {y.note && <span className="muted small help-preview">{y.note}</span>}
    </li>
  )
}

function pastText(y: SubscriptionCycle) {
  if (y.paid) return 'Paid'
  if (y.status === 'SKIPPED') return 'Skipped'
  if (y.status === 'MISSED') return 'Missed: not paid for in time, or no day had stock'
  if (y.status === 'CANCELLED') return 'Called off'
  if (y.order?.status === 'CANCELLED') return 'Payment not finished'
  if (y.status === 'DUE') return 'Not paid for in time'
  return y.status.toLowerCase()
}
