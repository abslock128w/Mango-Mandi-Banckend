// Stocktake: counts of one place at a time. Start one from here (it opens
// the scan screen), and open a finished one to review what was not found.

import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { dateTime } from '../../format'
import { Badge, EmptyState, LinkRow, QueryError, RowLink, Spinner, scrollRegion, usePageTitle } from '../../ui'
import { wh } from '../api'
import { OP_STATUS_LABEL, STOCKTAKE_REVIEW_LABEL, opStatusTone } from '../labels'
import type { StocktakeRow } from '../types'

export default function Stocktake() {
  usePageTitle('Stocktake')
  const q = useQuery({ queryKey: ['wh', 'stocktakes'], queryFn: wh.stocktakes })
  return (
    <>
      <div className="topbar">
        <h1>Stocktake</h1>
        <span className="spacer" />
        <Link to="/warehouse/scan?type=stocktake" className="btn btn-primary">
          Start a count
        </Link>
      </div>
      <p className="muted">
        Count one place at a time: scan every box that is physically there. Boxes found are corrected when you finish; boxes not found wait for a supervisor, and
        large losses for a second person.
      </p>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState>No counts yet.</EmptyState>
      ) : (
        <div {...scrollRegion('Counts', { cards: true })}>
          <table>
            <thead>
              <tr>
                <th>Place</th>
                <th>Status</th>
                <th>Started</th>
                <th>Counted by</th>
                <th className="num">Counted</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((s) => (
                <LinkRow key={s.id}>
                  <td className="card-title">
                    <RowLink to={`/warehouse/stocktake/${s.id}`}>{s.locationName}</RowLink>
                  </td>
                  <td className="card-status">
                    <CountBadge row={s} />
                  </td>
                  <td data-label="Started">{dateTime(s.startedAt)}</td>
                  <td data-label="Counted by">{s.mine ? 'You' : (s.owner ?? '—')}</td>
                  <td className="num" data-label="Counted">
                    {s.result ? s.result.counted : '—'}
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

function CountBadge({ row }: { row: StocktakeRow }) {
  if (row.toReview > 0) return <Badge tone="warn">{`${row.toReview} to review`}</Badge>
  if (row.toApprove > 0) return <Badge tone="warn">{STOCKTAKE_REVIEW_LABEL.pending_approval}</Badge>
  return <Badge tone={opStatusTone(row.status)}>{row.status === 'open' ? 'Counting' : OP_STATUS_LABEL[row.status]}</Badge>
}
