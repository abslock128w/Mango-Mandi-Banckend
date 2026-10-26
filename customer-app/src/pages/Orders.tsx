import { Link } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { api, type Order, type OrderSummary } from '../api'
import { PREORDER_LABEL, STATUS_LABEL, day, rupees, week } from '../format'
import { ErrorNote, Spinner } from '../ui'
import { StatusPill } from './Order'
import { PreorderPill } from './Preorder'
import { useFeatures } from '../features'

/** The newest orders whose boxes are named on their card; older ones show the box count only. */
const NAMED = 10

/** "Alphonso 3kg Box" or "Alphonso 3kg Box + 1 more", from the order's lines. */
function boxNames(order: Order | undefined) {
  if (!order?.items.length) return null
  const names = [...new Set(order.items.map((i) => i.name))]
  return names.length > 1 ? `${names[0]} + ${names.length - 1} more` : names[0]
}

export default function Orders() {
  const q = useQuery({ queryKey: ['orders'], queryFn: api.orders })
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
  if (q.isPending || pre.isPending) return <Spinner label="Loading your orders" />
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  // A booking whose day is set shows up as its order; the rest are listed apart.
  const bookings = (pre.data ?? []).filter((p) => p.status !== 'CONVERTED')
  if (!q.data.length && !bookings.length && !giftList.length) {
    return (
      <section className="card empty">
        <h1>No orders yet</h1>
        <Link to="/" className="btn btn-primary">
          Shop mangoes
        </Link>
      </section>
    )
  }
  return (
    <>
      <h1>My orders</h1>
      {pre.isError && <ErrorNote error={pre.error} onRetry={() => pre.refetch()} />}
      {bookings.length > 0 && (
        <section aria-labelledby="booked-ahead">
          <h2 id="booked-ahead" className="section-title">
            Booked ahead
          </h2>
          <ul className="order-list">
            {bookings.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/preorders/${p.id}`}
                  className="card order-card"
                  aria-label={`Booking ${p.number}, ${PREORDER_LABEL[p.status]}, week of ${week(p.weekStart)}`}
                >
                  <div>
                    <strong>Booking {p.number}</strong>
                    <span className="muted small">
                      {p.qty} {p.qty === 1 ? 'box' : 'boxes'} · {rupees(p.total)} · week of {week(p.weekStart)}
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
            Gift orders
          </h2>
          <ul className="order-list">
            {giftList.map((g) => (
              <li key={g.id}>
                <Link to={`/gifts/${g.id}`} className="card order-card" aria-label={`Gift order ${g.number}, ${g.recipientCount} recipients, ${day(g.deliveryDate)}`}>
                  <div>
                    <strong>Gift order {g.number}</strong>
                    <span className="muted small">
                      {g.recipientCount} recipients · {rupees(g.total)} · {day(g.deliveryDate)}
                    </span>
                  </div>
                  <span className={`pill pill-${g.status === 'PAID' ? 'good' : g.status === 'CANCELLED' ? 'muted' : 'warn'}`}>
                    {g.status === 'PAID' ? 'Paid' : g.status === 'CANCELLED' ? 'Cancelled' : 'Waiting for payment'}
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
              Orders
            </h2>
          )}
          <ul className="order-list" aria-labelledby={bookings.length > 0 || giftList.length > 0 ? 'orders-list' : undefined}>
            {q.data.map((o) => (
              <li key={o.id}>
                <Link
                  to={`/orders/${o.id}`}
                  className="card order-card"
                  aria-label={`Order ${o.number}${named.get(o.id) ? `, ${named.get(o.id)}` : ''}, ${STATUS_LABEL[o.status]}, ${day(o.deliveryDate)}`}
                >
                  <div>
                    <strong>{named.get(o.id) ?? `Order ${o.number}`}</strong>
                    <span className="muted small">
                      {named.get(o.id) && `${o.number} · `}
                      {o.giftOrderId && o.giftRecipient && `gift for ${o.giftRecipient} · `}
                      {o.itemCount} {o.itemCount === 1 ? 'box' : 'boxes'} · {rupees(o.total)} · {dueWord(o)} {day(o.deliveryDate)}
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
function dueWord(o: OrderSummary) {
  if (o.status === 'DELIVERED') return 'delivered'
  if (o.status === 'CANCELLED' || o.status === 'RTO') return 'was due'
  return 'arrives'
}
