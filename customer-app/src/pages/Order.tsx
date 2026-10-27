import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, signedInPhone, type Order, type OrderBill, type OrderStatus, type Stage, type Tracking } from '../api'
import { CANCELLABLE, STAGE_LABEL, STATUS_LABEL, day, helpLink, rupees, slotText, when } from '../format'
import { tierRange } from '../bulk'
import { DayChips, SlotPicker } from '../forms'
import { MIN_PAY_SECONDS, openRazorpay } from '../payment'
import { ConfirmDialog, Dialog, DocTitle, ErrorNote, PageHeader, Spinner } from '../ui'
import { CARE, MangoArt } from '../mango'
import { useStore } from '../store'
import { useCare } from '../features'
import { useT } from '../i18n'
import { t as tr, type Key } from '../i18n-core.ts'
import { OrderReviews } from './Review'

const TONE: Partial<Record<OrderStatus, string>> = {
  PAYMENT_PENDING: 'warn',
  DELIVERED: 'good',
  CANCELLED: 'muted',
  RTO: 'muted',
  DELIVERY_FAILED: 'warn',
}
export function StatusPill({ status }: { status: OrderStatus }) {
  return <span className={`pill pill-${TONE[status] ?? 'info'}`}>{STATUS_LABEL[status]}</span>
}

const STEPS: { label: Key; status: OrderStatus; reached: OrderStatus[] }[] = [
  { label: 'status.confirmed', status: 'CONFIRMED', reached: ['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED'] },
  { label: 'status.packed', status: 'PACKED', reached: ['PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED'] },
  { label: 'status.outForDelivery', status: 'OUT_FOR_DELIVERY', reached: ['OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED'] },
  { label: 'status.delivered', status: 'DELIVERED', reached: ['DELIVERED'] },
]
/** Orders a customer can still move to another day: confirmed, before packing starts. Mirrors the API. */
const MOVABLE: OrderStatus[] = ['CONFIRMED']
/** Packed and on its way: too late to cancel or move. */
const PACKED_ON: OrderStatus[] = ['PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY']
/** How long after a hold runs out the page keeps checking for a late payment. */
const LATE_PAYMENT_WATCH_MS = 30 * 60_000
const latePaymentPossible = (o: Order | undefined) =>
  o?.status === 'CANCELLED' &&
  o.cancelReason === 'HOLD_EXPIRED' &&
  o.paymentStatus !== 'SUCCEEDED' &&
  o.refundStatus === null &&
  Boolean(o.cancelledAt) &&
  Date.now() - new Date(o.cancelledAt!).getTime() < LATE_PAYMENT_WATCH_MS
const ISSUE_LABEL = { DAMAGED: 'order.issue.damaged', WRONG_ITEM: 'order.issue.wrong', NOT_DELIVERED: 'order.issue.missing' } as const

export default function OrderPage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const t = useT()
  const q = useQuery({
    queryKey: ['order', id],
    queryFn: async () => {
      // Still waiting on the payment: the status check also asks Razorpay a
      // minute after checkout (throttled by the API), so a late webhook can't keep it waiting.
      if (queryClient.getQueryData<Order>(['order', id])?.status === 'PAYMENT_PENDING') await api.paymentStatus(id).catch(() => null)
      return api.order(id)
    },
    refetchInterval: (query) => {
      const o = query.state.data
      // Waiting on the payment: check often. On the way: notice the delivery.
      if (o?.status === 'PAYMENT_PENDING') return 3000
      if (o?.status === 'OUT_FOR_DELIVERY') return 30_000
      // The hold ran out, but a payment made just before can still land: keep watching for a while.
      if (latePaymentPossible(o)) return 10_000
      return false
    },
  })
  if (q.isPending) return <Spinner label={t('order.loading')} />
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) {
      return (
        <section className="card">
          <DocTitle title={t('order.notFound')} />
          <h1>{t('order.notFound')}</h1>
          <Link to="/orders">{t('order.seeMine')}</Link>
        </section>
      )
    }
    return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  }
  return <OrderView order={q.data} />
}

function OrderView({ order }: { order: Order }) {
  const queryClient = useQueryClient()
  const [cancelling, setCancelling] = useState(false)
  const [moving, setMoving] = useState(false)
  const t = useT()
  const { setQty, setBulk, setWhere } = useStore()
  const navigate = useNavigate()
  const buyAgain = () => {
    for (const i of order.items) {
      if (!i.stage) continue
      // A bulk deal goes back in as the same deal (the cart checks it is still on and prices it again), never as regular boxes.
      if (i.bulk) setBulk({ listingId: i.bulk.listingId, title: i.bulk.title, sku: i.sku, name: i.name, stage: i.stage, unitPrice: i.unitPrice }, i.quantity)
      else setQty({ sku: i.sku, stage: i.stage, name: i.name, price: i.unitPrice }, i.quantity)
    }
    setWhere(order.pincode, null)
    navigate('/cart')
  }
  const stages = [...new Set(order.items.map((i) => i.stage).filter((x): x is Stage => Boolean(x)))]
  const claims = useQuery({ queryKey: ['claims'], queryFn: api.claims, enabled: order.status === 'DELIVERED' })
  const claim = claims.data?.find((c) => c.orderId === order.id)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['order', order.id] })
    void queryClient.invalidateQueries({ queryKey: ['orders'] })
  }
  // Checkout comes from the order itself, so it reopens on any device or tab.
  const payKey = order.razorpayKeyId ?? null
  const holdLeftMs = order.holdExpiresAt ? new Date(order.holdExpiresAt).getTime() - Date.now() : 0
  const holdOpen = holdLeftMs > 0
  const canPay = holdLeftMs > MIN_PAY_SECONDS * 1000
  // Straight after checkout: the order was just placed, and maybe the payment sheet failed to open.
  const arrived = useLocation().state as { payError?: string; placed?: boolean } | null
  const sheetError = arrived?.payError ?? null

  const payAgain = useMutation({
    mutationFn: () => openRazorpay({ orderId: order.id, key: payKey!, rzp: order.razorpayOrderId!, total: order.total, number: order.number, holdExpiresAt: order.holdExpiresAt }, signedInPhone()),
    onSettled: refresh,
  })
  const devPay = useMutation({ mutationFn: (outcome: 'captured' | 'failed') => api.devPay(order.id, outcome), onSettled: refresh })
  const cancel = useMutation({
    mutationFn: () => api.cancel(order.id),
    onSuccess: () => {
      setCancelling(false)
      refresh()
    },
  })
  const paid = order.paymentStatus === 'SUCCEEDED'
  // The money went back (FE-6): the total row says so rather than "Total".
  const refunded = order.refundStatus === 'REFUNDED' || order.paymentStatus === 'REFUNDED'
  const help = helpLink(`Help with order ${order.number}`)
  // The help centre (docs/care.md): a question about this order, answered in the shop.
  const care = useCare()
  // A thank-you once the payment goes through: seen here, or already done when checkout hands over.
  const [thanks, setThanks] = useState(() => Boolean(arrived?.placed) && paid && order.status !== 'CANCELLED')
  // After a cancel or a payment the button that was pressed is gone: move focus to the outcome.
  const cancelledNote = useRef<HTMLElement>(null)
  const thanksNote = useRef<HTMLElement>(null)
  const wasStatus = useRef(order.status)
  useEffect(() => {
    if (order.status === 'CANCELLED' && wasStatus.current !== 'CANCELLED') cancelledNote.current?.focus()
    // Paid: straight from waiting, or a late payment that revived an order whose hold ran out.
    const waited = wasStatus.current === 'PAYMENT_PENDING' || wasStatus.current === 'CANCELLED'
    if (waited && order.status !== 'PAYMENT_PENDING' && order.status !== 'CANCELLED') setThanks(true)
    wasStatus.current = order.status
  }, [order.status])
  useEffect(() => {
    if (thanks) thanksNote.current?.focus()
  }, [thanks])
  const canMove = MOVABLE.includes(order.status)
  // An unpaid gift order's delivery is cancelled with its whole gift order (MULTI_GIFT).
  const canCancel = CANCELLABLE.includes(order.status) && !(order.giftOrderId && order.status === 'PAYMENT_PENDING')
  const policy =
    order.status === 'CONFIRMED'
      ? t(paid ? 'order.policyConfirmedPaid' : 'order.policyConfirmed')
      : order.status === 'PROCESSING'
        ? t(paid ? 'order.policyPreparingPaid' : 'order.policyPreparing')
        : t(paid ? 'order.policyOtherPaid' : 'order.policyOther')

  return (
    <>
      <DocTitle title={t('pay.description', { number: order.number })} />
      <PageHeader title={t('pay.description', { number: order.number })}>
        <StatusPill status={order.status} />
      </PageHeader>

      {order.giftOrderId && (
        <p className="small">
          {t.rich('order.partOfGift', { link: <Link to={`/gifts/${order.giftOrderId}`}>{t('order.openGift')}</Link> })}
        </p>
      )}

      {thanks && order.status !== 'CANCELLED' && (
        <section className="card note-card thanks-card" ref={thanksNote} tabIndex={-1} aria-labelledby="thanks-title">
          <p id="thanks-title">
            <strong>{t('order.thanks')}</strong>{' '}
            {t('order.deliverOn', { when: order.slot ? `${day(order.deliveryDate)}, ${slotText(order.slot)}` : day(order.deliveryDate) })}
          </p>
        </section>
      )}

      {/* A gift order's delivery is paid with the gift order (MULTI_GIFT): pay there, never here. */}
      {order.status === 'PAYMENT_PENDING' && !order.giftOrderId && (
        <section className="card note-card" aria-live="polite">
          <p>
            <strong>{t('order.waitingPay')}</strong> {t('order.updatesItself')}
            {order.holdExpiresAt && holdOpen && <> {t('order.heldUntil', { when: when(order.holdExpiresAt) })}</>}
          </p>
          {payKey && order.razorpayOrderId && canPay && (
            <button type="button" className="btn btn-primary" disabled={payAgain.isPending} onClick={() => payAgain.mutate()}>
              {t('checkout.pay', { total: rupees(order.total) })}
            </button>
          )}
          {payKey && holdOpen && !canPay && (
            <p className="small">
              {t('order.holdEnding')}
            </p>
          )}
          {import.meta.env.DEV && !payKey && (
            <div className="dev-pay">
              <p className="small muted">{t('order.devPay')}</p>
              <div className="row">
                <button type="button" className="btn btn-primary" disabled={devPay.isPending} onClick={() => devPay.mutate('captured')}>
                  {t('order.devSucceeds')}
                </button>
                <button type="button" className="btn" disabled={devPay.isPending} onClick={() => devPay.mutate('failed')}>
                  {t('order.devFails')}
                </button>
              </div>
            </div>
          )}
          <ErrorNote error={payAgain.error ?? devPay.error ?? (payAgain.isIdle ? sheetError : null)} />
        </section>
      )}

      {order.status === 'CANCELLED' && (
        <section className="card note-card" ref={cancelledNote} tabIndex={-1}>
          <p>
            <strong>{t('order.cancelled')}</strong>{' '}
            {order.refundStatus === 'REFUNDED'
              ? t('order.refundSent', { total: rupees(order.total) })
              : order.refundStatus === 'PENDING'
                ? t('order.refundPending', { total: rupees(order.total) })
                : order.cancelReason === 'HOLD_EXPIRED'
                  ? t('order.notInTime')
                  : t('order.noPayment')}
          </p>
          {order.cancelReason === 'HOLD_EXPIRED' && order.refundStatus === null && (
            <p className="small">
              {t('order.latePayment')}{' '}
              {latePaymentPossible(order) ? t('order.keepsChecking') : t.rich('order.checkLater', { link: <Link to="/help">{t('order.contactUs')}</Link> })}
            </p>
          )}
        </section>
      )}

      {order.status === 'OUT_FOR_DELIVERY' && order.deliveryCode && (
        <section className="card note-card code-card" aria-labelledby="code-title">
          <p id="code-title">
            <strong>{t('order.onTheWay')}</strong> {t('order.giveCode')}
          </p>
          <p className="delivery-code" aria-label={t('order.codeLabel', { code: order.deliveryCode.split('').join(' ') })}>
            {order.deliveryCode}
          </p>
          <p className="muted small">{t('order.shareOnce')}</p>
        </section>
      )}

      {order.status === 'OUT_FOR_DELIVERY' && order.tracking && <RiderNearby tracking={order.tracking} />}

      {order.status === 'DELIVERED' && order.delivery && (
        <section className="card">
          <h2>{t('status.delivered')}</h2>
          <p>
            {order.delivery.method === 'code'
              ? t('order.handedWithCode', { when: when(order.delivery.at) })
              : order.delivery.method === 'photo'
                ? t('order.leftWith', { when: when(order.delivery.at), who: order.delivery.receivedBy ?? t('order.someone') })
                : t('order.deliveredAt', { when: when(order.delivery.at) })}
          </p>
          {order.delivery.hasPhoto && <DeliveryPhoto orderId={order.id} />}
        </section>
      )}

      {order.status === 'DELIVERED' &&
        (claim ? (
          <section className="card">
            <h2>{t('order.yourReport')}</h2>
            <p>
              {t(
                claim.status === 'RESOLVED'
                  ? claim.resolution === 'REPLACEMENT_APPROVED'
                    ? 'order.claimReplacing'
                    : 'order.claimRejected'
                  : 'order.claimLooking',
                { issue: t(ISSUE_LABEL[claim.issueType]) },
              )}
            </p>
            {/* UX-4: staff give a reason for every rejection; the customer sees it in their words. */}
            {claim.status === 'RESOLVED' && claim.resolution === 'REJECTED' && claim.rejectionReason && (
              <p className="claim-reason">
                <strong>{t('order.why')}</strong> {claim.rejectionReason}
              </p>
            )}
            {claim.status === 'RESOLVED' && claim.resolution === 'REJECTED' && (
              <p className="small muted">
                {t.rich('order.gotItWrong', { link: <Link to="/help">{t('order.talkToUs')}</Link> })}
              </p>
            )}
            {claim.replacementOrder && <Link to={`/orders/${claim.replacementOrder.id}`}>{t('order.seeReplacement', { number: claim.replacementOrder.number })}</Link>}
          </section>
        ) : (
          <ClaimPrompt order={order} loading={claims.isPending} />
        ))}

      {order.findingStock && (
        <section className="card note-card" role="status">
          <p>
            <strong>{t('order.findingStock')}</strong> {t('order.findingStockBody')}
          </p>
        </section>
      )}

      {order.status === 'DELIVERY_FAILED' && (
        <section className="card note-card">
          {/* No retry booked after the last attempt: never name the missed day as the next one. */}
          {order.retryScheduled === false ? (
            <p>
              <strong>{order.deliveryFailures > 1 ? t('order.missedAgain') : t('order.missed')}</strong> {t('order.willCall')}
            </p>
          ) : (
            <p>
              <strong>{t('order.missed')}</strong> {t('order.tryAgainOn', { day: day(order.deliveryDate) })}
            </p>
          )}
        </section>
      )}

      {(canMove || canCancel) && (
        <section className="card order-actions" aria-label={t('order.changeOrCancel')}>
          <p className="small">{policy}</p>
          <div className="order-actions-row">
            {canMove && (
              <button type="button" className="btn" onClick={() => setMoving(true)}>
                {t('order.changeDay')}
              </button>
            )}
            <button type="button" className="btn btn-danger-quiet" onClick={() => setCancelling(true)}>
              {t('order.cancel')}
            </button>
          </div>
        </section>
      )}
      {PACKED_ON.includes(order.status) && (
        <p className="muted small order-policy">
          {t('order.packedPolicy', { hours: order.claimWindowHours })}
        </p>
      )}

      {!['PAYMENT_PENDING', 'CANCELLED', 'RTO'].includes(order.status) && (
        <ol className="steps" aria-label={t('order.progress')}>
          {STEPS.map((s) => {
            const done = s.reached.includes(order.status)
            // The latest time the order reached this step (a retried delivery goes out more than once).
            const at = done ? order.timeline.filter((e) => e.status === s.status).slice(-1)[0]?.at : undefined
            return (
              <li key={s.label} className={done ? 'done' : ''}>
                <span className="dot" aria-hidden="true" />
                <span>
                  {t(s.label)}
                  <span className="sr-only">{done ? t('order.stepDone') : t('order.stepNotYet')}</span>
                </span>
                {at && (
                  // "19 Oct" over "10:27 am", so four steps fit side by side on a phone.
                  <span className="step-time">
                    {when(at)
                      .split(', ')
                      .map((part) => (
                        <span key={part}>{part}</span>
                      ))}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}

      <section className="card">
        <dl className="facts">
          <div>
            <dt>{order.status === 'DELIVERED' ? t('status.delivered') : t('checkout.arrives')}</dt>
            <dd>
              {day(order.deliveryDate)}
              {order.slot && `, ${slotText(order.slot)}`}
            </dd>
          </div>
          <div>
            <dt>{t('checkout.to')}</dt>
            <dd>
              {order.gift && (
                <>
                  {t('checkout.aGift', { name: order.gift.recipientName })}
                  <br />
                </>
              )}
              {order.deliveryAddress ?? '—'}, {order.pincode}
            </dd>
          </div>
          {order.gift?.message && (
            <div>
              <dt>{t('checkout.note')}</dt>
              <dd>{order.gift.message}</dd>
            </div>
          )}
        </dl>
        <ul className="lines">
          {order.items.map((i) => (
            <li key={`${i.sku}-${i.stage}`} className="line">
              <div>
                <strong>
                  {i.bulk && <span className="bulk-tag">{t('bulk.tag')}</span>}
                  {i.quantity} × {i.bulk ? i.bulk.title : i.name}
                </strong>
                {i.bulk && (
                  <span className="muted small">
                    {i.name} · {t('order.bulkPrice', { price: rupees(i.unitPrice), range: tierRange(i.bulk.tier) })}
                  </span>
                )}
                {i.stage && (
                  <span className="muted small">
                    {STAGE_LABEL[i.stage]}
                    {i.readyOn && i.readyOn !== order.deliveryDate && ` · ${t('order.readyAround', { day: day(i.readyOn) })}`}
                    {i.eatBy && ` · ${t('checkout.eatBy', { day: day(i.eatBy) })}`}
                  </span>
                )}
              </div>
              <strong className="line-price">{rupees(i.linePrice)}</strong>
            </li>
          ))}
        </ul>
        {order.discount > 0 && (
          <div className="sum-row discount">
            <span>{t('checkout.promo', { code: order.promoCode ?? '' })}</span>
            <span>−{rupees(order.discount)}</span>
          </div>
        )}
        <div className="total-row">
          <span>{refunded ? t('order.refunded') : paid ? t('gift.status.paid') : t('common.total')}</span>
          <strong>{rupees(order.total)}</strong>
        </div>
      </section>

      {order.bill && <BillCard order={order} bill={order.bill} />}

      {order.status === 'DELIVERED' && <OrderReviews orderId={order.id} />}

      {!['PAYMENT_PENDING', 'CANCELLED', 'RTO'].includes(order.status) && stages.length > 0 && <CareTips stages={stages} />}

      {['DELIVERED', 'CANCELLED'].includes(order.status) && (
        <button type="button" className="btn btn-block btn-primary" onClick={buyAgain}>
          {t('order.buyAgain')}
        </button>
      )}

      <Link to="/orders" className="btn btn-block btn-quiet">
        {t('order.allMine')}
      </Link>

      {/* UX-1: always a way to reach us; production builds always have the WhatsApp number. */}
      <p className="small muted center">
        {t('order.needHelp')}{' '}
        {care.helpCentre && (
          <>
            <Link to={`/help/requests?order=${encodeURIComponent(order.id)}`}>{t('order.askAbout')}</Link>
            {help ? ` ${t('order.or')} ` : '.'}
          </>
        )}
        {help ? (
          <a href={help} target="_blank" rel="noopener noreferrer">
            {t('order.messageWhatsApp')}<span className="sr-only"> {t('common.opensWhatsApp')}</span>
          </a>
        ) : (
          !care.helpCentre && <Link to="/help">{t('order.howToReach')}</Link>
        )}
      </p>

      {moving && <MoveDialog order={order} onClose={() => setMoving(false)} onMoved={refresh} />}

      {cancelling && (
        <ConfirmDialog
          title={t('order.cancelConfirm', { number: order.number })}
          keepLabel={t('order.keep')}
          confirmLabel={t('order.cancel')}
          busyLabel={t('order.cancelling')}
          busy={cancel.isPending}
          error={cancel.error}
          onConfirm={() => cancel.mutate()}
          onClose={() => setCancelling(false)}
        >
          <p>{paid ? t('order.cancelRefund', { total: rupees(order.total) }) : t('order.cancelNoPayment')}</p>
        </ConfirmDialog>
      )}
    </>
  )
}

/** On a delivered order: until when a problem can be reported for a free replacement, and the way to do it. */
/** "About 25 minutes", "about 1 hour 10 minutes": rounded to 5 minutes, since it is a rough guess. */
function roughTime(minutes: number) {
  const m = Math.max(5, Math.round(minutes / 5) * 5)
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (!h) return tr('order.aboutMinutes', { count: m })
  return rest ? tr('order.aboutHoursMinutes', { count: h, minutes: tr('order.minutes', { count: rest }) }) : tr('order.aboutHours', { count: h })
}

/**
 * Live tracking without GPS (LIVE_TRACKING): how many stops the rider has before this one, from
 * the rider's route order and the stops already done, and a rough time. Only a count: nothing
 * about the other stops. The page asks again every 30 seconds while the order is out.
 */
function RiderNearby({ tracking }: { tracking: Tracking }) {
  const n = tracking.stopsAway
  const t = useT()
  return (
    <section className="card note-card tracking-card" aria-labelledby="tracking-title">
      <h2 id="tracking-title" className="sub-title">
        {t('track.title')}
      </h2>
      <p role="status">
        <strong>{n === 0 ? t('track.next') : t('track.stopsAway', { count: n })}</strong> {t('track.expect', { time: roughTime(tracking.etaMinutes) })}
      </p>
      <p className="muted small">{t('track.guess', { minutes: tracking.minutesPerStop })}</p>
    </section>
  )
}

function ClaimPrompt({ order, loading }: { order: Order; loading: boolean }) {
  // The window comes from the API, from the latest delivery and the live rule.
  const deadline = order.claimUntil ? new Date(order.claimUntil) : null
  const open = deadline != null && deadline.getTime() > Date.now()
  const t = useT()
  // Until the reports load we don't know whether one was sent: keep the space, show nothing.
  if (loading) return null
  const report = (
    <Link to={`/orders/${order.id}/claim`} className="btn btn-block">
      {t('order.reportProblem')}
    </Link>
  )
  // Past our count of the window the link stays: the API has the last word on a late report.
  if (!open) return report
  return (
    <section className="card claim-prompt" aria-label={t('title.claim')}>
      <p>
        <strong>{t('order.somethingWrong')}</strong> {t('order.reportBy', { when: when(deadline!.toISOString()) })}
      </p>
      {report}
    </section>
  )
}

function DeliveryPhoto({ orderId }: { orderId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const t = useT()
  useEffect(() => {
    let made: string | null = null
    let live = true
    api
      .deliveryPhotoUrl(orderId)
      .then((u) => {
        made = u
        if (live) setUrl(u)
        else URL.revokeObjectURL(u)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [orderId])
  if (failed) return <p className="muted small">{t('error.photoUnavailable')}</p>
  if (!url) return <p className="muted small">{t('order.loadingPhoto')}</p>
  return <img className="delivery-photo" src={url} alt={t('order.photoAlt')} />
}

/** How to look after what arrived, for each ripeness in the order. */
function CareTips({ stages }: { stages: Stage[] }) {
  const t = useT()
  return (
    <section className="card" aria-labelledby="care-title">
      <h2 id="care-title">{t('order.careTitle')}</h2>
      {stages.map((st) => (
        <div key={st} className="care">
          <MangoArt stage={st} size={40} />
          <div>
            <h3>{CARE[st].title}</h3>
            <ul>
              {CARE[st].tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </section>
  )
}

/** Pick another open day (and time) for an order that isn't being packed yet. */
function MoveDialog({ order, onClose, onMoved }: { order: Order; onClose: () => void; onMoved: () => void }) {
  const days = useQuery({ queryKey: ['delivery-check', order.pincode], queryFn: () => api.checkPincode(order.pincode) })
  const t = useT()
  const [date, setDate] = useState<string | null>(null)
  const [slotId, setSlotId] = useState<string | null>(null)
  const slots = useQuery({ queryKey: ['slots', order.pincode, date], queryFn: () => api.slots(order.pincode, date!), enabled: Boolean(date) })
  const move = useMutation({
    mutationFn: () => api.reschedule(order.id, date!, slotId),
    onSuccess: () => {
      onMoved()
      onClose()
    },
  })
  const choices = (days.data?.deliveryDates ?? []).filter((d) => d !== order.deliveryDate)
  const needSlot = Boolean(slots.data?.slots.length)
  const problem = move.error instanceof ApiError && move.error.code === 'STOCK_INSUFFICIENT'
    ? t('move.notEnough')
    : move.error instanceof ApiError && move.error.code === 'SLOT_FULL'
      ? t('move.slotFull')
      : move.error

  return (
    <Dialog
      title={t('order.changeDay')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {t('move.keep', { day: day(order.deliveryDate) })}
          </button>
          <button type="button" className="btn btn-primary" disabled={!date || (needSlot && !slotId) || move.isPending} onClick={() => move.mutate()}>
            {move.isPending ? t('move.moving') : t('move.cta')}
          </button>
        </>
      }
    >
      {days.isPending ? (
        <Spinner label={t('move.loadingDays')} />
      ) : days.isError ? (
        <ErrorNote error={days.error} onRetry={() => days.refetch()} />
      ) : choices.length === 0 ? (
        <p>{t('move.noDays')}</p>
      ) : (
        <>
          <p className="muted small">{t('move.ripeness')}</p>
          <DayChips
            label={t('move.newDay')}
            days={choices}
            value={date}
            format={day}
            onChange={(d) => {
              setDate(d)
              setSlotId(null)
            }}
          />
          {date && slots.isPending && <Spinner label={t('checkout.loadingTimes')} />}
          {needSlot && <SlotPicker name="move-slot" slots={slots.data!.slots} value={slotId} onChange={setSlotId} />}
        </>
      )}
      <ErrorNote error={problem} />
    </Dialog>
  )
}

/**
 * The order's bill, once it is paid: its number and a download. Only the
 * customer who placed the order can download it (the API answers 404 to
 * anyone else). A cancelled order keeps its bill, marked cancelled.
 */
function BillCard({ order, bill }: { order: Order; bill: OrderBill }) {
  const t = useT()
  const download = useMutation({
    mutationFn: async () => {
      const url = await api.billUrl(order.id)
      const a = document.createElement('a')
      a.href = url
      a.download = `MandiMangoes-bill-${bill.number.replace(/\//g, '-')}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    },
  })
  return (
    <section className="card bill-card" aria-labelledby="bill-title">
      <h2 id="bill-title">{t('bill.title')}</h2>
      <p>{t.rich('bill.line', { title: bill.title, number: <strong>{bill.number}</strong>, day: day(bill.billDate), total: rupees(bill.total) })}</p>
      {order.business && <p className="muted small">{t('bill.billedTo', { name: order.business.name, gstin: order.business.gstin })}</p>}
      {bill.cancelled && <p className="note small">{t('bill.cancelled')}</p>}
      <button type="button" className="btn btn-block" disabled={download.isPending} onClick={() => download.mutate()}>
        {download.isPending ? t('bill.preparing') : t('bill.download')}
      </button>
      <ErrorNote error={download.error} />
    </section>
  )
}
