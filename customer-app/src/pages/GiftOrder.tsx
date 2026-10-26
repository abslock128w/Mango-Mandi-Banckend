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

const GIFT_STATUS: Record<GiftOrder['status'], { label: string; tone: string }> = {
  PAYMENT_PENDING: { label: 'Waiting for payment', tone: 'warn' },
  PAID: { label: 'Paid', tone: 'good' },
  CANCELLED: { label: 'Cancelled', tone: 'muted' },
}

export default function GiftOrderPage() {
  const { id } = useParams()
  const q = useQuery({
    queryKey: ['gift-order', id],
    queryFn: () => api.giftOrder(id!),
    // While the payment is on its way, the page asks again on its own.
    refetchInterval: (query) => (query.state.data?.status === 'PAYMENT_PENDING' ? 5_000 : false),
  })
  if (q.isPending) return <Spinner label="Loading your gift order" />
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  return <GiftOrderView g={q.data} />
}

function GiftOrderView({ g }: { g: GiftOrder }) {
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
      <DocTitle title={`Gift order ${g.number}`} />
      <PageHeader title={`Gift order ${g.number}`}>
        <span className={`pill pill-${status.tone}`}>{status.label}</span>
      </PageHeader>

      {thanks && g.status === 'PAID' && (
        <section className="card note-card thanks-card" ref={thanksNote} tabIndex={-1}>
          <p>
            <strong>Thank you, your gift order is placed.</strong> We'll deliver to all {g.recipientCount} recipients on {day(g.deliveryDate)}
            {g.slot && `, ${slotText(g.slot)}`}. Each one gets the delivery message on the day.
          </p>
        </section>
      )}

      {g.status === 'PAYMENT_PENDING' && (
        <section className="card note-card" aria-live="polite">
          <p>
            <strong>Waiting for your payment to be confirmed.</strong> This page updates on its own.
            {g.holdExpiresAt && holdLeftMs > 0 && <> The boxes for every recipient are held until {when(g.holdExpiresAt)}.</>}
          </p>
          {canPay && (
            <button type="button" className="btn btn-primary" disabled={payAgain.isPending} onClick={() => payAgain.mutate()}>
              Pay {rupees(g.total)}
            </button>
          )}
          {import.meta.env.DEV && !g.razorpayKeyId && (
            <div className="dev-pay">
              <p className="small muted">Test mode: Razorpay isn't set up, so choose how the payment ends.</p>
              <div className="row">
                <button type="button" className="btn btn-primary" disabled={devPay.isPending} onClick={() => devPay.mutate('captured')}>
                  Payment succeeds
                </button>
                <button type="button" className="btn" disabled={devPay.isPending} onClick={() => devPay.mutate('failed')}>
                  Payment fails
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
            <strong>This gift order was cancelled.</strong>{' '}
            {paid
              ? 'Each paid recipient is refunded their part; banks take up to 5 to 7 days to show it.'
              : g.cancelReason === 'HOLD_EXPIRED'
                ? "We didn't receive your payment in time. If you paid, it reaches us shortly and the order goes ahead."
                : 'Nothing was charged.'}
          </p>
        </section>
      )}

      <section className="card">
        <dl className="facts">
          <div>
            <dt>Arrives</dt>
            <dd>
              {day(g.deliveryDate)}
              {g.slot && `, ${slotText(g.slot)}`}
            </dd>
          </div>
          <div>
            <dt>Recipients</dt>
            <dd>
              {g.recipientCount}, {g.boxes} {g.boxes === 1 ? 'box' : 'boxes'}
            </dd>
          </div>
          {g.promoCode && (
            <div>
              <dt>Promo</dt>
              <dd>
                {g.promoCode}, −{rupees(g.discount)}
              </dd>
            </div>
          )}
          <div>
            <dt>Total</dt>
            <dd>
              <strong>{rupees(g.total)}</strong>, one payment
            </dd>
          </div>
        </dl>
      </section>

      <section className="card" aria-labelledby="recipients-title">
        <h2 id="recipients-title">Recipients</h2>
        <ol className="gift-review-list">
          {g.recipients.map((r) => (
            <li key={r.orderId} className="gift-recipient-row">
              <div>
                <strong>{r.name}</strong>
                <span className="muted small">
                  {r.address}, {r.pincode}
                </span>
                <span className="small">
                  {r.qty} × {r.boxName}
                  {r.stage && `, ${STAGE_LABEL[r.stage]}`} · {rupees(r.total)}
                </span>
                <span className="small">
                  <Link to={`/orders/${r.orderId}`}>Delivery {r.number}</Link>: {STATUS_LABEL[r.status]}
                  {r.refundStatus === 'REFUNDED' ? `, ${rupees(r.total)} refunded` : r.refundStatus === 'PENDING' ? `, refund of ${rupees(r.total)} on its way` : ''}
                </span>
              </div>
              {r.cancellable && (
                <button type="button" className="link-btn danger" onClick={() => setConfirming(r.orderId)}>
                  Cancel for {r.name}
                </button>
              )}
            </li>
          ))}
        </ol>
        {g.cancellable && (
          <button type="button" className="btn btn-block" onClick={() => setConfirming('all')}>
            Cancel the whole gift order
          </button>
        )}
        <p className="muted small">
          {paid
            ? 'You can cancel one recipient, or the whole order, for a refund of that part until their boxes are packed. After packing nothing is refunded.'
            : 'Until it is paid you can cancel the whole order. Nothing is charged.'}
        </p>
      </section>

      {g.bill && <GiftBillCard g={g} />}

      {confirming && (
        <ConfirmDialog
          title={confirming === 'all' ? 'Cancel the whole gift order?' : `Cancel the delivery for ${who?.name ?? 'this recipient'}?`}
          keepLabel="Keep it"
          confirmLabel={confirming === 'all' ? 'Cancel the gift order' : 'Cancel this recipient'}
          busyLabel="Cancelling…"
          busy={cancel.isPending}
          error={cancel.error}
          onConfirm={() => cancel.mutate(confirming)}
          onClose={() => setConfirming(null)}
        >
          <p>
            {confirming === 'all'
              ? paid
                ? `Every recipient's delivery is cancelled and ${rupees(g.recipients.filter((r) => r.status !== 'CANCELLED').reduce((s, r) => s + r.total, 0))} is refunded.`
                : 'Every recipient is cancelled and their boxes go back on sale. Nothing is charged.'
              : `Their boxes go back on sale and ${rupees(who?.total ?? 0)} is refunded. The other recipients still get theirs.`}
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}

/** The one bill for the whole gift order, with the business name and GSTIN if given. */
function GiftBillCard({ g }: { g: GiftOrder }) {
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
      <h2 id="bill-title">Your bill</h2>
      <p>
        {bill.title} <strong>{bill.number}</strong>, dated {day(bill.billDate)}, for {rupees(bill.total)}: one bill for every recipient.
      </p>
      {g.business && (
        <p className="muted small">
          Billed to {g.business.name}, GSTIN {g.business.gstin}.
        </p>
      )}
      {bill.cancelled && <p className="note small">Every recipient was cancelled, so the bill is marked cancelled. It keeps its number.</p>}
      <button type="button" className="btn btn-block" disabled={download.isPending} onClick={() => download.mutate()}>
        {download.isPending ? 'Preparing your bill…' : 'Download bill (PDF)'}
      </button>
      <ErrorNote error={download.error} />
    </section>
  )
}
