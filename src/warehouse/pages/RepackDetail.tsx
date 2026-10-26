// One repack: the boxes that went in, the new boxes that came out (with
// their labels), and the delivery batches the new boxes carry.

import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { date, dateTime } from '../../format'
import { Badge, BackLink, EmptyState, QueryError, Spinner, scrollRegion, usePageTitle } from '../../ui'
import { useWh } from '../access'
import { wh } from '../api'
import { HOLD_LABEL, LIFECYCLE_LABEL, OP_STATUS_LABEL, QUALITY_LABEL, REPACK_KIND_LABEL, REPACK_REASON_LABEL, opStatusTone, qualityTone } from '../labels'
import type { RepackBox } from '../types'
import { DownloadButton, kg } from '../ui'

export default function RepackDetail() {
  const { id = '' } = useParams()
  const { can } = useWh()
  const q = useQuery({ queryKey: ['wh', 'repack', id], queryFn: () => wh.repack(id) })
  usePageTitle(q.data?.kind ? REPACK_KIND_LABEL[q.data.kind] : 'Repack')
  if (q.isPending) return <Spinner />
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />
  const r = q.data
  const done = r.status === 'completed'

  return (
    <>
      <BackLink to="/warehouse/repack">Repack</BackLink>
      <div className="topbar">
        <h1>{r.kind ? REPACK_KIND_LABEL[r.kind] : 'Repack'}</h1>
        <Badge tone={opStatusTone(r.status)}>{OP_STATUS_LABEL[r.status]}</Badge>
        <span className="spacer" />
        {done && can('labels.print') && (
          <DownloadButton className="btn btn-primary" getUrl={() => wh.repackLabelsUrl(r.id)} filename={`repack-labels-${r.id}.pdf`}>
            Download new labels
          </DownloadButton>
        )}
      </div>

      <section className="card" aria-labelledby="rp-facts">
        <h2 id="rp-facts">What was done</h2>
        <dl className="wh-facts">
          <div>
            <dt>Why</dt>
            <dd>{REPACK_REASON_LABEL[r.reasonCode] ?? r.reasonCode}</dd>
          </div>
          <div>
            <dt>Note</dt>
            <dd>{r.reason}</dd>
          </div>
          <div>
            <dt>Where</dt>
            <dd>{r.locationName}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{dateTime(r.startedAt)}</dd>
          </div>
          <div>
            <dt>Finished</dt>
            <dd>{r.finishedAt ? dateTime(r.finishedAt) : '—'}</dd>
          </div>
          {done && (
            <>
              <div>
                <dt>Fruit taken out</dt>
                <dd>{r.fruitRemoved ?? 0}</dd>
              </div>
              <div>
                <dt>Weight taken out</dt>
                <dd>{kg(r.weightLostG ?? 0)}</dd>
              </div>
            </>
          )}
        </dl>
        {r.lots.length > 0 && (
          <>
            <h3>Delivery batches in the new boxes</h3>
            <ul className="plain-list small">
              {r.lots.map((l) => (
                <li key={l.id}>
                  <Link to={`/warehouse/lots/${l.id}/trace`}>{l.code}</Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {r.status === 'open' && r.mine && (
          <p className="notice notice-info">
            Still in progress.{' '}
            <Link to={`/warehouse/scan?op=${encodeURIComponent(r.id)}`} className="link-btn">
              Open the scan screen
            </Link>
          </p>
        )}
      </section>

      <BoxTable title={done ? 'Boxes that went in' : 'Boxes scanned in so far'} boxes={r.sources} empty="No boxes scanned in yet." />
      {done && <BoxTable title="New boxes" boxes={r.outputs} empty="No new boxes." />}
    </>
  )
}

function BoxTable({ title, boxes, empty }: { title: string; boxes: RepackBox[]; empty: string }) {
  return (
    <section aria-label={title}>
      <h2>{title}</h2>
      {boxes.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <div {...scrollRegion(title, { cards: true })}>
          <table>
            <thead>
              <tr>
                <th>Box</th>
                <th>QC</th>
                <th>State</th>
                <th className="num">Weight</th>
                <th>Best before</th>
              </tr>
            </thead>
            <tbody>
              {boxes.map((b) => (
                <tr key={b.id}>
                  <td className="card-title">
                    <Link to={`/warehouse/boxes/${b.id}`}>
                      <code>{b.code}</code>
                    </Link>
                  </td>
                  <td className="card-status">
                    <Badge tone={qualityTone(b.quality)}>{QUALITY_LABEL[b.quality] ?? b.quality}</Badge>
                  </td>
                  <td data-label="State">{[LIFECYCLE_LABEL[b.lifecycle] ?? b.lifecycle, b.locationName, ...b.holds.map((h) => HOLD_LABEL[h] ?? h)].filter(Boolean).join(' · ')}</td>
                  <td className="num" data-label="Weight">
                    {kg(b.weightG)}
                  </td>
                  <td data-label="Best before">{date(b.bestBefore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
