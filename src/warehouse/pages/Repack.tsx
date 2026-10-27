// Repacks: boxes opened and packed again (spoiled fruit out, a split, two
// part-full boxes merged). Start one from here (it opens the scan screen).

import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { dateTime } from '../../format'
import { Badge, EmptyState, LinkRow, QueryError, RowLink, Spinner, scrollRegion, usePageTitle } from '../../ui'
import { wh } from '../api'
import { OP_STATUS_LABEL, REPACK_KIND_LABEL, REPACK_REASON_LABEL, opStatusTone } from '../labels'

export default function Repack() {
  usePageTitle('Repack')
  const q = useQuery({ queryKey: ['wh', 'repacks'], queryFn: wh.repacks })
  return (
    <>
      <div className="topbar">
        <h1>Repack</h1>
        <span className="spacer" />
        <Link to="/warehouse/scan?type=repack" className="btn btn-primary">
          Start a repack
        </Link>
      </div>
      <p className="muted">
        Scan the boxes you open, then say what came out. Each new box gets a new label and keeps the earliest best-before date and every batch it came from;
        the old labels stop scanning.
      </p>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState>No repacks yet.</EmptyState>
      ) : (
        <div {...scrollRegion('Repacks', { cards: true })}>
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Status</th>
                <th>Why</th>
                <th>Where</th>
                <th className="num">In → out</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <LinkRow key={r.id}>
                  <td className="card-title">
                    <RowLink to={`/warehouse/repack/${r.id}`}>{r.kind ? `${REPACK_KIND_LABEL[r.kind]}, ${dateTime(r.startedAt)}` : dateTime(r.startedAt)}</RowLink>
                    <div className="muted small">{r.mine ? 'You' : (r.owner ?? '—')}</div>
                  </td>
                  <td className="card-status">
                    <Badge tone={opStatusTone(r.status)}>{OP_STATUS_LABEL[r.status]}</Badge>
                  </td>
                  <td data-label="Why">
                    {REPACK_REASON_LABEL[r.reasonCode] ?? r.reasonCode}
                    <div className="muted small">{r.reason}</div>
                  </td>
                  <td data-label="Where">{r.locationName}</td>
                  <td className="num" data-label="In → out">
                    {r.sources} → {r.status === 'completed' ? r.outputs : '…'}
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
