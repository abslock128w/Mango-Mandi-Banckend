import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { RIPENESS_LABEL, date, istDate } from '../format'
import type { Manifest } from '../types'
import { Badge, EmptyState, OrderBadge, QueryError, Spinner, scrollRegion } from '../ui'

const runTitle = (r: Manifest['runs'][number]) => (r.slot ? `${r.slot.label} · ${r.slot.startsAt}–${r.slot.endsAt}` : 'No slot')
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The rider manifest: each slot's run, stop by stop, ready to print and hand over. */
export default function Deliveries() {
  const [params, setParams] = useSearchParams()
  const day = params.get('date') || istDate(1)
  const q = useQuery({ queryKey: ['manifest', day], queryFn: () => api.manifest(day) })

  function setDay(value: string) {
    const p = new URLSearchParams(params)
    if (value) p.set('date', value)
    else p.delete('date')
    setParams(p, { replace: true })
  }

  return (
    <>
      <div className="print-only">
        <h1>Deliveries · {date(day)}</h1>
      </div>
      <div className="topbar no-print">
        <h1>Deliveries</h1>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="dl-date" className="sr-only">
            Delivery date
          </label>
          <input id="dl-date" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => window.print()}>
          Print
        </button>
      </div>

      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.runs.length === 0 ? (
        <EmptyState>No deliveries on {date(day)}.</EmptyState>
      ) : (
        <>
          <p className="muted">
            {count(q.data.orders, 'order', 'orders')}, {count(q.data.boxes, 'box', 'boxes')}. Every order is
            paid: riders collect nothing.
          </p>
          {q.data.runs.map((r) => (
            <section key={r.slot?.id ?? 'none'} className="card pack-order">
              <div className="topbar" style={{ marginBottom: '0.5rem' }}>
                <h2 style={{ margin: 0 }}>{runTitle(r)}</h2>
                <span className="muted small">
                  {count(r.orders, 'order', 'orders')}, {count(r.boxes, 'box', 'boxes')}
                </span>
              </div>
              {r.stops.map((s) => (
                <div key={s.pincode} style={{ marginTop: '0.75rem' }}>
                  <h3 style={{ margin: '0 0 0.25rem' }}>
                    {s.pincode}
                    {s.city ? ` · ${s.city}` : ''}
                    {s.zone ? ` · ${s.zone}` : ''}
                  </h3>
                  <div {...scrollRegion(`${runTitle(r)}, ${s.pincode}`)}>
                    <table>
                      <thead>
                        <tr>
                          <th>Order</th>
                          <th>Customer</th>
                          <th>Address</th>
                          <th>Boxes</th>
                          <th>State</th>
                          <th className="print-only">Delivered</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.orders.map((o) => (
                          <tr key={o.id}>
                            <td>
                              <Link to={`/orders/${o.id}`}>{o.number}</Link>
                            </td>
                            <td>
                              {o.customerName}
                              <br />
                              <a href={`tel:+91${o.phone}`} className="small">
                                {o.phone}
                              </a>
                            </td>
                            <td>{o.deliveryAddress ?? '—'}</td>
                            <td>
                              {o.items.map((i) => (
                                <div key={`${i.sku}-${i.stage}`} className="small">
                                  {i.quantity} × {i.productName}
                                  {i.stage ? ` (${RIPENESS_LABEL[i.stage]})` : ''}
                                </div>
                              ))}
                            </td>
                            <td>
                              {o.packed ? <OrderBadge status={o.status} /> : <Badge tone="warn">Not packed yet</Badge>}
                            </td>
                            <td className="print-only" aria-hidden="true">
                              ☐
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </>
      )}
    </>
  )
}
