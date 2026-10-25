// Where a batch of boxes went: counts by state, every box (repacked ones
// included), and the orders they reached.

import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { date } from '../../format'
import { BackLink, Badge, QueryError, Spinner, scrollRegion, usePageTitle } from '../../ui'
import { wh } from '../api'
import { HOLD_LABEL, LIFECYCLE_LABEL, QUALITY_LABEL, qualityTone } from '../labels'
import type { Lifecycle } from '../types'
import { Counts, TraceOrders } from '../ui'

export default function LotTrace() {
  const { id = '' } = useParams()
  const q = useQuery({ queryKey: ['wh', 'trace', 'lot', id], queryFn: () => wh.traceLot(id) })
  usePageTitle(q.data ? `Trace ${q.data.lot.code}` : 'Batch trace')
  if (q.isPending) return <Spinner />
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />
  const t = q.data
  return (
    <>
      <BackLink to={`/warehouse/lots/${id}`}>Batch {t.lot.code}</BackLink>
      <div className="topbar">
        <h1>Trace batch {t.lot.code}</h1>
      </div>
      <p className="muted">
        {t.lot.supplier ? `${t.lot.supplier} · ` : ''}harvested {date(t.lot.harvestedOn)} · received {date(t.lot.receivedOn)} · best before {date(t.lot.bestBefore)}
      </p>
      <Counts label="Boxes by state" items={(Object.entries(t.byState) as [Lifecycle, number][]).map(([s, n]) => ({ label: LIFECYCLE_LABEL[s] ?? s, count: n }))} />
      <section className="card" aria-labelledby="lt-orders">
        <h2 id="lt-orders">Orders reached</h2>
        <TraceOrders orders={t.orders} label="Orders this batch reached" />
      </section>
      <h2>Boxes</h2>
      <div {...scrollRegion('Boxes in this batch', { cards: true })}>
        <table>
          <thead>
            <tr>
              <th>Box</th>
              <th>QC</th>
              <th>State</th>
              <th>Location</th>
              <th>Holds</th>
            </tr>
          </thead>
          <tbody>
            {t.boxes.map((b) => (
              <tr key={b.id}>
                <td className="card-title">
                  <Link to={`/warehouse/boxes/${b.id}/trace`}>{b.code}</Link>
                  {b.descendant && <div className="muted small">Repacked from this batch</div>}
                </td>
                <td className="card-status">
                  <Badge tone={qualityTone(b.quality)}>{QUALITY_LABEL[b.quality] ?? b.quality}</Badge>
                </td>
                <td data-label="State">{LIFECYCLE_LABEL[b.lifecycle] ?? b.lifecycle}</td>
                <td data-label="Location">{b.location ?? '—'}</td>
                <td data-label="Holds">{b.holds.length ? b.holds.map((h) => HOLD_LABEL[h] ?? h).join(', ') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
