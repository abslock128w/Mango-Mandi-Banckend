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
import { useT } from '../i18n'
import { t, type Key } from '../i18n-core.ts'

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]
const weekdayName = (n: number) => t(`sub.day.${n}` as Key)
const STAGES: Stage[] = ['RAW', 'SEMI_RIPE', 'RIPE']
const STATUS_LABEL: Record<SubscriptionStatus, Key> = { ACTIVE: 'sub.status.active', PAUSED: 'sub.status.paused', CANCELLED: 'sub.status.cancelled', ENDED: 'sub.status.ended' }
const STATUS_TONE: Record<SubscriptionStatus, string> = { ACTIVE: 'pill-good', PAUSED: 'pill-warn', CANCELLED: 'pill-muted', ENDED: 'pill-muted' }
/** Mirrors the API's limit on boxes per delivery. */
const MAX_BOXES = 20

function StatusPill({ status }: { status: SubscriptionStatus }) {
  const t = useT()
  return <span className={`pill ${STATUS_TONE[status]}`}>{t(STATUS_LABEL[status])}</span>
}

const every = (s: { frequency: Frequency; weekday: number }) => t(s.frequency === 'WEEKLY' ? 'sub.everyWeek' : 'sub.everyOtherWeek', { day: weekdayName(s.weekday) })
const boxText = (s: Subscription) => t('sub.boxText', { qty: s.qty, name: s.productName, stage: STAGE_LABEL[s.stage] })

/** The Account page's "Your subscriptions" card. Nothing while the switch is off. */
export function YourSubscriptions() {
  const care = useCare()
  const t = useT()
  const q = useQuery({ queryKey: ['subscriptions'], queryFn: api.subscriptions, enabled: care.subscriptions })
  if (!care.subscriptions) return null
  return (
    <section className="card narrow" aria-labelledby="your-subscriptions">
      <h2 id="your-subscriptions">{t('sub.yours')}</h2>
      <p className="muted small">{t('sub.yoursLead')}</p>
      {q.isPending ? (
        <Spinner label={t('sub.loadingAll')} />
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
                      {t('sub.until', { every: every(s), day: day(s.endDate) })}
                      {due ? t('sub.dueWaiting', { day: day(due.deliveryDate ?? due.scheduledFor) }) : ''}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          {q.data.open ? (
            <Link to="/account/subscriptions/new" className="btn btn-block">
              {t('sub.start')}
            </Link>
          ) : (
            <p className="muted small">{t('sub.closed')}</p>
          )}
        </>
      )}
    </section>
  )
}

function Off() {
  const t = useT()
  return (
    <section className="card narrow">
      <h1>{t('sub.title')}</h1>
      <p>
        {t.rich('sub.off', { order: <Link to="/">{t('sub.orderBox')}</Link>, book: <Link to="/preorder">{t('sub.bookAhead')}</Link> })}
      </p>
    </section>
  )
}

/** /account/subscriptions/new */
export function NewSubscription() {
  const care = useCare()
  const t = useT()
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
  if (products.isPending || addresses.isPending || list.isPending) return <Spinner label={t('common.loading')} />
  const loadError = products.error ?? addresses.error ?? list.error
  if (loadError) return <ErrorNote error={loadError} />
  const seasonEnd = list.data?.seasonEnd ?? null
  if (!list.data?.open || !seasonEnd) return <Off />
  const product = products.data?.items.find((p) => p.sku === sku) ?? null
  const slotList = slots.data?.slots ?? []
  const errors = {
    sku: tried && !sku ? t('sub.chooseBox') : null,
    address: tried && !addressId ? t('sub.chooseAddress') : null,
    slot: tried && slotList.length > 0 && !slotId ? t('sub.chooseTime') : null,
    endDate: tried && !endDate ? t('sub.chooseEnd') : null,
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
        {t('sub.backAccount')}
      </Link>
      <h1 id={`${formId}-title`}>{t('sub.start')}</h1>
      <p>{t('sub.newLead')}</p>
      {addresses.data && addresses.data.length === 0 ? (
        <p className="note">
          {t.rich('sub.needAddress', { order: <Link to="/">{t('sub.orderBox')}</Link> })}
        </p>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <Field id={`${formId}-sku`} label={t('sub.box')} error={errors.sku}>
            <select value={sku} onChange={(e) => setSku(e.target.value)}>
              <option value="">{t('sub.chooseBox')}</option>
              {products.data?.items.map((p) => (
                <option key={p.sku} value={p.sku}>
                  {t('sub.boxOption', { name: p.name, price: rupees(p.price) })}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="field">
            <legend>{t('sub.ripeness')}</legend>
            <div className="options">
              {STAGES.map((s) => (
                <label key={s} className="option">
                  <input type="radio" name={`${formId}-stage`} checked={stage === s} onChange={() => setStage(s)} />
                  <span>{STAGE_LABEL[s]}</span>
                </label>
              ))}
            </div>
            <p className="muted small">{t('sub.samePrice')}</p>
          </fieldset>
          <div className="field">
            <Stepper label={t('sub.boxesEach')} showLabel value={qty} min={1} max={MAX_BOXES} onChange={setQty} lessLabel={t('sub.oneFewer')} moreLabel={t('sub.oneMore')} />
            {product && <p className="muted small">{t('sub.eachTime', { price: rupees(product.price * qty) })}</p>}
          </div>
          <fieldset className="field">
            <legend>{t('sub.howOften')}</legend>
            <div className="options">
              <label className="option">
                <input type="radio" name={`${formId}-freq`} checked={frequency === 'WEEKLY'} onChange={() => setFrequency('WEEKLY')} />
                <span>{t('sub.weekly')}</span>
              </label>
              <label className="option">
                <input type="radio" name={`${formId}-freq`} checked={frequency === 'FORTNIGHTLY'} onChange={() => setFrequency('FORTNIGHTLY')} />
                <span>{t('sub.fortnightly')}</span>
              </label>
            </div>
          </fieldset>
          <Field id={`${formId}-day`} label={t('sub.day')}>
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAYS.map((n) => (
                <option key={n} value={n}>
                  {weekdayName(n)}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="field" aria-describedby={errors.address ? `${formId}-addr-error` : undefined}>
            <legend>{t('sub.deliverTo')}</legend>
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
              <legend>{t('sub.time')}</legend>
              <div className="options">
                {slotList.map((s) => (
                  <label key={s.id} className="option">
                    <input type="radio" name={`${formId}-slot`} checked={slotId === s.id} onChange={() => setSlotId(s.id)} />
                    <span>{slotText(s)}</span>
                  </label>
                ))}
              </div>
              <p className="muted small">{t('sub.timeFull')}</p>
              {errors.slot && (
                <p id={`${formId}-slot-error`} className="field-error" role="alert">
                  {errors.slot}
                </p>
              )}
            </fieldset>
          )}
          <ErrorNote error={slots.error} />
          <Field id={`${formId}-end`} label={t('sub.lastDay')} hint={t('sub.seasonEnds', { day: day(seasonEnd) })} error={errors.endDate}>
            <input type="date" value={endDate} max={seasonEnd} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <ErrorNote error={create.error} />
          <button type="submit" className="btn btn-primary btn-block" disabled={create.isPending}>
            {create.isPending ? t('sub.starting') : t('sub.startBtn')}
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
  const t = useT()
  const q = useQuery({ queryKey: ['subscription', id], queryFn: () => api.subscription(id), enabled: care.subscriptions })
  if (!care.subscriptions) return <Off />
  if (q.isPending) return <Spinner label={t('sub.loadingOne')} />
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  return <Detail s={q.data} />
}

function Detail({ s }: { s: Subscription }) {
  const t = useT()
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
        <DocTitle title={t('sub.docTitle', { number: s.number })} />
        <Link to="/account" className="back-link">
          {t('sub.backAccount')}
        </Link>
        <PageHeader title={<span id="sub-title">{boxText(s)}</span>}>
          <StatusPill status={s.status} />
        </PageHeader>
        <dl className="details">
          <dt>{t('sub.when')}</dt>
          <dd>{t('sub.until', { every: every(s), day: day(s.endDate) })}</dd>
          {s.unitPrice != null && (
            <>
              <dt>{t('sub.eachBox')}</dt>
              <dd>{t('sub.paidEachTime', { price: rupees(s.unitPrice * s.qty) })}</dd>
            </>
          )}
          {s.address && (
            <>
              <dt>{t('sub.deliverTo')}</dt>
              <dd>
                {s.address.name && <strong>{s.address.name}, </strong>}
                {s.address.address}
              </dd>
            </>
          )}
          <dt>{t('sub.number')}</dt>
          <dd>{s.number}</dd>
        </dl>
        {s.status === 'PAUSED' && <p className="note">{t('sub.pausedNote')}</p>}
        {s.status === 'ENDED' && <p className="note">{t('sub.endedNote')}</p>}
        <div className="row">
          {s.status === 'ACTIVE' && (
            <button type="button" className="btn" disabled={pause.isPending} onClick={() => pause.mutate()}>
              {pause.isPending ? t('sub.pausing') : t('sub.pause')}
            </button>
          )}
          {s.status === 'PAUSED' && (
            <button type="button" className="btn btn-primary" disabled={resume.isPending} onClick={() => resume.mutate()}>
              {resume.isPending ? t('sub.resuming') : t('sub.resume')}
            </button>
          )}
          {running && (
            <button type="button" className="btn btn-quiet" onClick={() => setCancelling(true)}>
              {t('sub.cancel')}
            </button>
          )}
        </div>
        <ErrorNote error={pause.error ?? resume.error} />
      </section>

      <section className="card narrow" aria-labelledby="sub-coming">
        <h2 id="sub-coming">{t('sub.coming')}</h2>
        {coming.length === 0 && (s.status !== 'ACTIVE' || s.upcoming.length === 0) ? (
          <p className="muted">{t('sub.none')}</p>
        ) : (
          <ul className="sub-cycles">
            {coming.map((y) => (
              <CycleRow key={y.id} y={y} onPay={() => pay.mutate(y.id)} paying={pay.isPending && pay.variables === y.id} onSkip={y.canPay ? () => setSkipping(y.scheduledFor) : undefined} />
            ))}
            {s.status === 'ACTIVE' &&
              s.upcoming.map((d) => (
                <li key={d}>
                  <span>{day(d)}</span>
                  <span className="muted small">{t('sub.remind')}</span>
                  <button type="button" className="link-btn" onClick={() => setSkipping(d)}>
                    {t('sub.skip')}
                    <span className="sr-only"> {day(d)}</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
        <ErrorNote error={pay.error} />
      </section>

      {past.length > 0 && (
        <section className="card narrow" aria-labelledby="sub-past">
          <h2 id="sub-past">{t('sub.earlier')}</h2>
          <ul className="sub-cycles">
            {past.map((y) => (
              <li key={y.id}>
                <span>{day(y.deliveryDate ?? y.scheduledFor)}</span>
                <span className="muted small">{pastText(y)}</span>
                {y.order && <Link to={`/orders/${encodeURIComponent(y.order.id)}`}>{t('sub.order', { number: y.order.number })}</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {skipping && (
        <ConfirmDialog
          title={t('sub.skipTitle', { day: day(skipping) })}
          keepLabel={t('sub.keepIt')}
          confirmLabel={t('sub.skipBox')}
          busyLabel={t('sub.skipping')}
          busy={skip.isPending}
          error={skip.error}
          onConfirm={() => skip.mutate(skipping)}
          onClose={() => setSkipping(null)}
        >
          <p>{t('sub.skipBody')}</p>
        </ConfirmDialog>
      )}
      {cancelling && (
        <ConfirmDialog
          title={t('sub.cancelTitle')}
          keepLabel={t('sub.keepSub')}
          confirmLabel={t('sub.cancel')}
          busyLabel={t('sub.cancelling')}
          busy={cancel.isPending}
          error={cancel.error}
          onConfirm={() => cancel.mutate()}
          onClose={() => setCancelling(false)}
        >
          <p>{t('sub.cancelBody')}</p>
        </ConfirmDialog>
      )}
    </>
  )
}

function CycleRow({ y, onPay, paying, onSkip }: { y: SubscriptionCycle; onPay: () => void; paying: boolean; onSkip?: () => void }) {
  const t = useT()
  const date = day(y.deliveryDate ?? y.scheduledFor)
  return (
    <li>
      <span>{date}</span>
      {y.paid && y.order ? (
        <Link to={`/orders/${encodeURIComponent(y.order.id)}`}>{t('sub.paidOrder', { number: y.order.number })}</Link>
      ) : y.awaitingPayment && y.order ? (
        <Link to={`/orders/${encodeURIComponent(y.order.id)}`} className="btn btn-primary">
          {t('sub.finishPaying')}
          <span className="sr-only">{t('sub.forDate', { day: date })}</span>
        </Link>
      ) : (
        <button type="button" className="btn btn-primary" disabled={paying} onClick={onPay}>
          {paying ? t('sub.settingUp') : t('sub.payBox')}
          <span className="sr-only">{t('sub.forDate', { day: date })}</span>
        </button>
      )}
      {onSkip && (
        <button type="button" className="link-btn" onClick={onSkip}>
          {t('sub.skip')}
          <span className="sr-only"> {date}</span>
        </button>
      )}
      {y.note && <span className="muted small help-preview">{y.note}</span>}
    </li>
  )
}

function pastText(y: SubscriptionCycle) {
  if (y.paid) return t('sub.past.paid')
  if (y.status === 'SKIPPED') return t('sub.past.skipped')
  if (y.status === 'MISSED') return t('sub.past.missed')
  if (y.status === 'CANCELLED') return t('sub.past.calledOff')
  if (y.order?.status === 'CANCELLED') return t('sub.past.payNotFinished')
  if (y.status === 'DUE') return t('sub.past.notPaid')
  return y.status.toLowerCase()
}
