// Picking: orders waiting for their boxes, oldest delivery first.

import { useQuery } from '@tanstack/react-query'
import { date } from '../../format'
import { Badge, EmptyState, LinkRow, QueryError, RowLink, Spinner, scrollRegion, usePageTitle } from '../../ui'
import { wh } from '../api'

export default function Picking() {
  usePageTitle('Picking')
  const q = useQuery({ queryKey: ['wh', 'pick-queue'], queryFn: wh.pickQueue })
  return (
    <>
      <div className="topbar">
        <h1>Picking</h1>
      </div>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState>No orders waiting to be picked.</EmptyState>
      ) : (
        <div {...scrollRegion('Orders to pick', { cards: true })}>
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Status</th>
                <th>Delivery</th>
                <th className="num">To pick</th>
                <th className="num">Picked</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((o) => (
                <LinkRow key={o.orderId}>
                  <td className="card-title">
                    <RowLink to={`/warehouse/picking/${o.orderId}`} more="pick list">
                      {o.number}
                    </RowLink>
                  </td>
                  <td className="card-status">{o.atRisk ? <Badge tone="bad">At risk</Badge> : <Badge>Waiting</Badge>}</td>
                  <td data-label="Delivery">{date(o.deliveryDate)}</td>
                  <td className="num" data-label="To pick">
                    {o.toPick}
                  </td>
                  <td className="num" data-label="Picked">
                    {o.picked}
                  </td>
                </LinkRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
