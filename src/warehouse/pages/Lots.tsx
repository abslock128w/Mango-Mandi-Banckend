// Box batches (lots): every delivery that became labelled boxes.

import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { date } from '../../format'
import { Badge, EmptyState, LinkRow, QueryError, RowLink, Spinner, StatusFilter, scrollRegion, usePageTitle } from '../../ui'
import { wh } from '../api'
import { LOT_STATUS_LABEL, lotTone } from '../labels'
import type { LotStatus } from '../types'

const STATUSES = Object.keys(LOT_STATUS_LABEL) as LotStatus[]

export default function Lots() {
  usePageTitle('Box batches')
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as LotStatus | null) || null
  const q = useQuery({ queryKey: ['wh', 'lots', status], queryFn: () => wh.lots(status) })

  return (
    <>
      <div className="topbar">
        <h1>Box batches</h1>
      </div>
      <StatusFilter className="mb-4" value={status} options={STATUSES} labels={LOT_STATUS_LABEL} onChange={(s) => setParams(s ? { status: s } : {})} />
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState>No box batches{status ? ` that are ${LOT_STATUS_LABEL[status].toLowerCase()}` : ''}.</EmptyState>
      ) : (
        <div {...scrollRegion('Box batches', { cards: true })}>
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Status</th>
                <th>Product</th>
                <th className="num">Received</th>
                <th>Best before</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((l) => (
                <LinkRow key={l.id}>
                  <td className="card-title">
                    <RowLink to={`/warehouse/lots/${l.id}`}>{l.code}</RowLink>
                    {l.supplier && <div className="muted small">{l.supplier}</div>}
                  </td>
                  <td className="card-status">
                    <Badge tone={lotTone(l.status)}>{LOT_STATUS_LABEL[l.status]}</Badge>
                  </td>
                  <td data-label="Product">{l.productName}</td>
                  <td className="num" data-label="Received">
                    {l.verifiedCount} of {l.targetCount - l.voidedCount}
                  </td>
                  <td data-label="Best before">{date(l.bestBefore)}</td>
                </LinkRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
