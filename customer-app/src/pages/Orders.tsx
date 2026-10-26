import { Link } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { api, type Order, type OrderSummary } from '../api'
import { PREORDER_LABEL, STATUS_LABEL, day, rupees, week } from '../format'
import { ErrorNote, Spinner } from '../ui'
import { StatusPill } from './Order'
import { PreorderPill } from './Preorder'
import { useFeatures } from '../features'
import { useT } from '../i18n'
import { t as tr } from '../i18n-core.ts'

/** The newest orders whose boxes are named on their card; older ones show the box count only. */
const NAMED = 10

/** "Alphonso 3kg Box" or "Alphonso 3kg Box + 1 more", from the order's lines. */
function boxNames(order: Order | undefined) {
  if (!order?.items.length) return null
  const names = [...new Set(order.items.map((i) => i.name))]
  return names.length > 1 ? tr('orders.nameAndMore', { name: names[0], count: names.length - 1 }) : names[0]
}

export default function Orders() {
  const q = useQuery({ queryKey: ['orders'], queryFn: api.orders })
  const t = useT()
  const pre = useQuery({ queryKey: ['preorders'], queryFn: api.preorders })
  // Gift orders to many recipients (MULTI_GIFT): each listed once, above its deliveries.
  const multiGift = useFeatures().multiGift === true
  const gifts = useQuery({ queryKey: ['gift-orders'], queryFn: api.giftOrders, enabled: multiGift })
  const giftList = multiGift ? (gifts.data ?? []) : []
  // The list doesn't carry the boxes' names, so each recent order's page is read (and kept for opening it).
  const details = useQueries({
    queries: (q.data ?? []).slice(0, NAMED).map((o) => ({ queryKey: ['order', o.id], queryFn: () => api.order(o.id), staleTime: 60_000 })),
  })
  const named = new Map((q.data ?? []).slice(0, NAMED).map((o, i) => [o.id, boxNames(details[i]?.data)]))
  if (q.isPending || pre.isPending) return <Spinner label={t('orders.loading')} />
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  // A booking whose day is set shows up as its order; the rest are listed apart.
  const bookings = (pre.data ?? []).filter((p) => p.status !== 'CONVERTED')
  if (!q.data.length && !bookings.length && !giftList.length) {
    return (
      <section className="card empty">
        <h1>{t('orders.none')}</h1>
        <Link to="/" className="btn btn-primary">
          {t('quality.shop')}
        </Link>
      </section>
    )
  }
  return (
    <>
      <h1>{t('title.orders')}</h1>
      {pre.isError && <ErrorNote error={pre.error} onRetry={() => pre.refetch()} />}
      {bookings.length > 0 && (
        <section aria-labelledby="booked-ahead">
          <h2 id="booked-ahead" className="section-title">
            {t('orders.bookedAhead')}
          </h2>
          <ul className="order-list">
            {bookings.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/preorders/${p.id}`}
                  className="card order-card"
                  aria-label={t('orders.bookingLabel', { number: p.number, status: PREORDER_LABEL[p.status], week: week(p.weekStart) })}
                >
                  <div>
                    <strong>{t('orders.booking', { number: p.number })}</strong>
                    <span className="muted small">
                      {t('common.boxes', { count: p.qty })} · {rupees(p.total)} · {t('orders.weekOf', { week: week(p.weekStart) })}
                    </span>
                  </div>
                  <PreorderPill status={p.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {giftList.length > 0 && (
        <section aria-labelledby="gift-orders">
          <h2 id="gift-orders" className="section-title">
            {t('orders.giftOrders')}
          </h2>
          <ul className="order-list">
            {giftList.map((g) => (
              <li key={g.id}>
                <Link to={`/gifts/${g.id}`} className="card order-card" aria-label={t('orders.giftLabel', { number: g.number, count: g.recipientCount, day: day(g.deliveryDate) })}>
                  <div>
                    <strong>{t('orders.giftOrder', { number: g.number })}</strong>
                    <span className="muted small">
                      {t('orders.recipients', { count: g.recipientCount })} · {rupees(g.total)} · {day(g.deliveryDate)}
                    </span>
                  </div>
                  <span className={`pill pill-${g.status === 'PAID' ? 'good' : g.status === 'CANCELLED' ? 'muted' : 'warn'}`}>
                    {g.status === 'PAID' ? t('gift.status.paid') : g.status === 'CANCELLED' ? t('status.cancelled') : t('status.paymentPending')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {q.data.length > 0 && (
        <section aria-labelledby="orders-list">
          {(bookings.length > 0 || giftList.length > 0) && (
            <h2 id="orders-list" className="section-title">
              {t('nav.orders')}
            </h2>
          )}
          <ul className="order-list" aria-labelledby={bookings.length > 0 || giftList.length > 0 ? 'orders-list' : undefined}>
            {q.data.map((o) => (
              <li key={o.id}>
                <Link
                  to={`/orders/${o.id}`}
                  className="card order-card"
                  aria-label={t(named.get(o.id) ? 'orders.orderLabelNamed' : 'orders.orderLabel', { number: o.number, names: named.get(o.id) ?? '', status: STATUS_LABEL[o.status], day: day(o.deliveryDate) })}
                >
                  <div>
                    <strong>{named.get(o.id) ?? t('pay.description', { number: o.number })}</strong>
                    <span className="muted small">
                      {named.get(o.id) && `${o.number} · `}
                      {o.giftOrderId && o.giftRecipient && `${t('orders.giftFor', { name: o.giftRecipient })} · `}
                      {t('common.boxes', { count: o.itemCount })} · {rupees(o.total)} · {t(dueKey(o), { day: day(o.deliveryDate) })}
                    </span>
                  </div>
                  <StatusPill status={o.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

/** Delivered on, was due (an order that won't come), or arrives. */
function dueKey(o: OrderSummary) {
  if (o.status === 'DELIVERED') return 'orders.deliveredOn' as const
  if (o.status === 'CANCELLED' || o.status === 'RTO') return 'orders.wasDue' as const
  return 'orders.arrives' as const
}
