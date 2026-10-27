// Small pieces the warehouse pages share.

import { Link } from 'react-router-dom'
import { date } from '../format'
import type { OrderStatus } from '../types'
import { OrderBadge, scrollRegion } from '../ui'
import type { TraceOrder } from './types'

// DownloadButton lives in ../ui (the bill and CSV exports use it too).
export { DownloadButton } from '../ui'

/** A row of count tiles; a tile with a link opens the matching list. */
export function Counts({ items, label }: { items: { label: string; count: number; tone?: 'warn' | 'bad'; to?: string }[]; label: string }) {
  return (
    <ul className="tiles wh-counts" aria-label={label}>
      {items.map((i) => {
        const cls = `tile${i.tone && i.count > 0 ? ` tile-${i.tone}` : ''}`
        const body = (
          <>
            <span className="count">{i.count}</span> <span className="label">{i.label}</span>
          </>
        )
        return (
          <li key={i.label}>
            {i.to ? (
              <Link to={i.to} className={cls}>
                {body}
              </Link>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export const kg = (grams: number | null | undefined) => (grams == null ? '—' : `${(grams / 1000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} kg`)

/** Orders a trace or recall reached; name and phone only come for roles allowed to see them. */
export function TraceOrders({ orders, label }: { orders: TraceOrder[]; label: string }) {
  if (!orders.length) return <p className="muted">No orders.</p>
  const people = orders.some((o) => o.customerName !== undefined)
  return (
    <div {...scrollRegion(label, { cards: true })}>
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Status</th>
            <th>Delivery</th>
            {people && <th>Customer</th>}
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td className="card-title">
                <Link to={`/orders/${o.id}`}>{o.number}</Link>
              </td>
              <td className="card-status">
                <OrderBadge status={o.status as OrderStatus} />
              </td>
              <td data-label="Delivery">{date(o.deliveryDate)}</td>
              {people && (
                <td data-label="Customer">
                  {[o.customerName, o.phone].filter(Boolean).join(' · ') || '—'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
