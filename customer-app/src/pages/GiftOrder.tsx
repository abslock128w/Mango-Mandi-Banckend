// A gift order to many recipients (MULTI_GIFT): its one payment, its one bill,
// and each recipient's delivery with its own status. The whole order can be
// cancelled while nothing is packed; once paid, one recipient can be cancelled
// on their own before their boxes are packed, refunded their part.
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, signedInPhone, type GiftOrder } from '../api'
import { STAGE_LABEL, STATUS_LABEL, day, rupees, slotText, when } from '../format'
import { MIN_PAY_SECONDS, openRazorpay } from '../payment'
import { ConfirmDialog, DocTitle, ErrorNote, PageHeader, Spinner } from '../ui'
import { useT } from '../i18n'
import type { Key } from '../i18n-core.ts'

const GIFT_STATUS: Record<GiftOrder['status'], { label: Key; tone: string }> = {
  PAYMENT_PENDING: { label: 'gift.status.pending', tone: 'warn' },
  PAID: { label: 'gift.status.paid', tone: 'good' },
  CANCELLED: { label: 'gift.status.cancelled', tone: 'muted' },
}

export default function GiftOrderPage() {
  const { id } = useParams()
  const t = useT()
  const q = useQuery({
    queryKey: ['gift-order', id],
    queryFn: () => api.giftOrder(id!),
    // While the payment is on its way, the page asks again on its own.
    refetchInterval: (query) => (query.state.data?.status === 'PAYMENT_PENDING' ? 5_000 : false),
  })
  if (q.isPending) return <Spinner label={t('gift.loadingOrder')} />
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  return <GiftOrderView g={q.data} />
}

function GiftOrderView({ g }: { g: GiftOrder }) {
  const t = useT()
  const queryClient = useQueryClient()
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['gift-order', g.id] })
    void queryClient.invalidateQueries({ queryKey: ['orders'] })
    void queryClient.invalidateQueries({ queryKey: ['gift-orders'] })
  }
  const arrived = useLocation().state as { payError?: string; placed?: boolean } | null
  const holdLeftMs = g.holdExpiresAt ? new Date(g.holdExpiresAt).getTime() - Date.now() : 0
  const canPay = Boolean(g.razorpayKeyId && g.razorpayOrderId) && holdLeftMs > MIN_PAY_SECONDS * 1000
  const payAgain = useMutation({
    mutationFn: () =>
      openRazorpay({ orderId: g.id, key: g.razorpayKeyId!, rzp: g.razorpayOrderId!, total: g.total, number: g.number, holdExpiresAt: g.holdExpiresAt }, signedInPhone(), api.verifyGiftPayment),
    onSettled: refresh,
  })
  const devPay = useMutation({ mutationFn: (outcome: 'captured' | 'failed') => api.devPayGift(g.id, outcome), onSettled: refresh })
  const [confirming, setConfirming] = useState<'all' | string | null>(null)
  const cancel = useMutation({
    mutationFn: (target: 'all' | string) => (target === 'all' ? api.cancelGiftOrder(g.id) : api.cancelGiftRecipient(g.id, target)),
    onSuccess: () => {
      setConfirming(null)
      refresh()
    },
  })
  const paid = g.paymentStatus === 'SUCCEEDED'
  const status = GIFT_STATUS[g.status]
  const [thanks, setThanks] = useState(() => Boolean(arrived?.placed) && paid)
  const thanksNote = useRef<HTMLElement>(null)
  const was = useRef(g.status)
  useEffect(() => {
    if (was.current === 'PAYMENT_PENDING' && g.status === 'PAID') setThanks(true)
    was.current = g.status
  }, [g.status])
  useEffect(() => {
    if (thanks) thanksNote.current?.focus()
  }, [thanks])
  const who = confirming && confirming !== 'all' ? g.recipients.find((r) => r.orderId === confirming) : null

  return (
    <>
      <DocTitle title={t('gift.orderTitle', { number: g.number })} />
      <PageHeader title={t('gift.orderTitle', { number: g.number })}>
        <span className={`pill pill-${status.tone}`}>{t(status.label)}</span>
      </PageHeader>

      {thanks && g.status === 'PAID' && (
        <section className="card note-card thanks-card" ref={thanksNote} tabIndex={-1}>
          <p>
            <strong>{t('gift.thanks')}</strong>{' '}
            {t('gift.thanksBody', { count: g.recipientCount, when: g.slot ? t('gift.daySlot', { day: day(g.deliveryDate), slot: slotText(g.slot) }) : day(g.deliveryDate) })}
          </p>
        </section>
      )}

      {g.status === 'PAYMENT_PENDING' && (
        <section className="card note-card" aria-live="polite">
          <p>
            <strong>{t('order.waitingPay')}</strong> {t('order.updatesItself')}
            {g.holdExpiresAt && holdLeftMs > 0 && t('gift.heldUntil', { when: when(g.holdExpiresAt) })}
          </p>
          {canPay && (
            <button type="button" className="btn btn-primary" disabled={payAgain.isPending} onClick={() => payAgain.mutate()}>
              {t('checkout.pay', { total: rupees(g.total) })}
            </button>
          )}
          {import.meta.env.DEV && !g.razorpayKeyId && (
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
          <ErrorNote error={payAgain.error ?? devPay.error ?? (payAgain.isIdle ? (arrived?.payError ?? null) : null)} />
        </section>
      )}

      {g.status === 'CANCELLED' && (
        <section className="card note-card">
          <p>
            <strong>{t('gift.cancelledTitle')}</strong>{' '}
            {paid ? t('gift.cancelledPaid') : g.cancelReason === 'HOLD_EXPIRED' ? t('gift.cancelledLate') : t('gift.nothingCharged')}
          </p>
        </section>
      )}

      <section className="card">
        <dl className="facts">
          <div>
            <dt>{t('checkout.arrives')}</dt>
            <dd>
              {day(g.deliveryDate)}
              {g.slot && `, ${slotText(g.slot)}`}
            </dd>
          </div>
          <div>
            <dt>{t('gift.recipients')}</dt>
            <dd>
              {t('gift.recipientsBoxes', { recipients: g.recipientCount, count: g.boxes })}
            </dd>
          </div>
          {g.promoCode && (
            <div>
              <dt>{t('gift.promo')}</dt>
              <dd>{t('gift.promoValue', { code: g.promoCode, amount: rupees(g.discount) })}</dd>
            </div>
          )}
          <div>
            <dt>{t('gift.total')}</dt>
            <dd>{t.rich('gift.onePayment', { total: <strong>{rupees(g.total)}</strong> })}</dd>
          </div>
        </dl>
      </section>

      <section className="card" aria-labelledby="recipients-title">
        <h2 id="recipients-title">{t('gift.recipients')}</h2>
        <ol className="gift-review-list">
          {g.recipients.map((r) => (
            <li key={r.orderId} className="gift-recipient-row">
              <div>
                <strong>{r.name}</strong>
                <span className="muted small">
                  {r.address}, {r.pincode}
                </span>
                <span className="small">
                  {t('gift.lineQty', { qty: r.qty, box: r.boxName ?? '' })}
                  {r.stage && `, ${STAGE_LABEL[r.stage]}`} · {rupees(r.total)}
                </span>
                <span className="small">
                  <Link to={`/orders/${r.orderId}`}>{t('gift.delivery.n', { number: r.number })}</Link>: {STATUS_LABEL[r.status]}
                  {r.refundStatus === 'REFUNDED' ? t('gift.refunded', { amount: rupees(r.total) }) : r.refundStatus === 'PENDING' ? t('gift.refundOnWay', { amount: rupees(r.total) }) : ''}
                </span>
              </div>
              {r.cancellable && (
                <button type="button" className="link-btn danger" onClick={() => setConfirming(r.orderId)}>
                  {t('gift.cancelFor', { name: r.name })}
                </button>
              )}
            </li>
          ))}
        </ol>
        {g.cancellable && (
          <button type="button" className="btn btn-block" onClick={() => setConfirming('all')}>
            {t('gift.cancelAll')}
          </button>
        )}
        <p className="muted small">
          {paid ? t('gift.cancelPaidNote') : t('gift.cancelUnpaidNote')}
        </p>
      </section>

      {g.bill && <GiftBillCard g={g} />}

      {confirming && (
        <ConfirmDialog
          title={confirming === 'all' ? t('gift.cancelAllTitle') : t('gift.cancelOneTitle', { name: who?.name ?? t('gift.thisRecipient') })}
          keepLabel={t('gift.keepIt')}
          confirmLabel={confirming === 'all' ? t('gift.cancelOrder') : t('gift.cancelRecipient')}
          busyLabel={t('order.cancelling')}
          busy={cancel.isPending}
          error={cancel.error}
          onConfirm={() => cancel.mutate(confirming)}
          onClose={() => setConfirming(null)}
        >
          <p>
            {confirming === 'all'
              ? paid
                ? t('gift.cancelAllPaidBody', { amount: rupees(g.recipients.filter((r) => r.status !== 'CANCELLED').reduce((s, r) => s + r.total, 0)) })
                : t('gift.cancelAllUnpaidBody')
              : t('gift.cancelOneBody', { amount: rupees(who?.total ?? 0) })}
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}

/** The one bill for the whole gift order, with the business name and GSTIN if given. */
function GiftBillCard({ g }: { g: GiftOrder }) {
  const t = useT()
  const bill = g.bill!
  const download = useMutation({
    mutationFn: async () => {
      const url = await api.giftBillUrl(g.id)
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
      <p>
        {t.rich('gift.billLine', { title: bill.title, number: <strong>{bill.number}</strong>, day: day(bill.billDate), total: rupees(bill.total) })}
      </p>
      {g.business && (
        <p className="muted small">
          {t('bill.billedTo', { name: g.business.name, gstin: g.business.gstin })}
        </p>
      )}
      {bill.cancelled && <p className="note small">{t('gift.billCancelled')}</p>}
      <button type="button" className="btn btn-block" disabled={download.isPending} onClick={() => download.mutate()}>
        {download.isPending ? t('bill.preparing') : t('bill.download')}
      </button>
      <ErrorNote error={download.error} />
    </section>
  )
}
