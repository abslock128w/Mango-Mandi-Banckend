import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { STATUS_LABEL, day, rupees } from '../format'
import { ErrorNote, Spinner } from '../ui'
import { StatusPill } from './Order'

export default function Orders() {
  const q = useQuery({ queryKey: ['orders'], queryFn: api.orders })
  if (q.isPending) return <Spinner label="Loading your orders" />
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  if (!q.data.length) {
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
      <ul className="order-list">
        {q.data.map((o) => (
          <li key={o.id}>
            <Link to={`/orders/${o.id}`} className="card order-card" aria-label={`Order ${o.number}, ${STATUS_LABEL[o.status]}, ${day(o.deliveryDate)}`}>
              <div>
                <strong>Order {o.number}</strong>
                <span className="muted small">
                  {o.itemCount} {o.itemCount === 1 ? 'box' : 'boxes'} · {rupees(o.total)} · {o.status === 'DELIVERED' ? 'delivered' : 'arrives'} {day(o.deliveryDate)}
                </span>
              </div>
              <StatusPill status={o.status} />
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
