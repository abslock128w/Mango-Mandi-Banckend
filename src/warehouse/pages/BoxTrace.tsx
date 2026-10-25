// A box's whole story: the delivery and harvest it came from, any boxes it
// was repacked from, every event, and the orders it went to.

import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { date, dateTime } from '../../format'
import { BackLink, QueryError, Spinner, usePageTitle } from '../../ui'
import { wh } from '../api'
import { HOLD_LABEL, LIFECYCLE_LABEL, QUALITY_LABEL, eventLabel } from '../labels'
import type { HoldKind, Lifecycle, Quality } from '../types'
import { TraceOrders } from '../ui'

export default function BoxTrace() {
  const { id = '' } = useParams()
  const q = useQuery({ queryKey: ['wh', 'trace', 'box', id], queryFn: () => wh.traceBox(id) })
  usePageTitle(q.data ? `Trace ${q.data.box.code}` : 'Box trace')
  if (q.isPending) return <Spinner />
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />
  const t = q.data
  return (
    <>
      <BackLink to={`/warehouse/boxes/${id}`}>Box {t.box.code}</BackLink>
      <div className="topbar">
        <h1>
          Trace <code>{t.box.code}</code>
        </h1>
      </div>
      <div className="grid-2">
        <section className="card" aria-labelledby="tr-origin">
          <h2 id="tr-origin">Where it came from</h2>
          <dl className="wh-facts">
            <div>
              <dt>Batch of boxes</dt>
              <dd>{t.lot ? <Link to={`/warehouse/lots/${t.lot.id}/trace`}>{t.lot.code}</Link> : '—'}</dd>
            </div>
            <div>
              <dt>Supplier</dt>
              <dd>{t.lot?.supplier ?? '—'}</dd>
            </div>
            <div>
              <dt>Harvested</dt>
              <dd>{date(t.lot?.harvestedOn)}</dd>
            </div>
            <div>
              <dt>Received</dt>
              <dd>{date(t.lot?.receivedOn)}</dd>
            </div>
            <div>
              <dt>Best before</dt>
              <dd>{date(t.lot?.bestBefore)}</dd>
            </div>
            <div>
              <dt>Stock batch</dt>
              <dd>{t.batch ? <Link to={`/batches/${t.batch.id}`}>{`${t.batch.variety}, plucked ${date(t.batch.pluckedOn)}`}</Link> : '—'}</dd>
            </div>
            {t.batch?.farm && (
              <div>
                <dt>Farm</dt>
                <dd>{t.batch.farm}</dd>
              </div>
            )}
          </dl>
          {t.parents.length > 0 && (
            <>
              <h3>Repacked from</h3>
              <ul className="plain-list small">
                {t.parents.map((p) => (
                  <li key={p.id}>
                    <Link to={`/warehouse/boxes/${p.id}/trace`}>{p.code}</Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section className="card" aria-labelledby="tr-orders">
          <h2 id="tr-orders">Orders</h2>
          <TraceOrders orders={t.orders} label="Orders this box was on" />
        </section>
      </div>
      <section aria-labelledby="tr-events">
        <h2 id="tr-events">Every event</h2>
        <ol className="timeline">
          {t.events.map((e, i) => (
            <li key={i}>
              <strong>{eventLabel(e.type)}</strong>
              <div className="muted small">
                {dateTime(e.at)}
                {e.actor ? ` · ${e.actor}` : ''}
              </div>
              <div className="small">
                {[
                  e.toLifecycle && e.toLifecycle !== e.fromLifecycle ? LIFECYCLE_LABEL[e.toLifecycle as Lifecycle] ?? e.toLifecycle : null,
                  // Trace events carry only the quality after the event: show it where QC set it.
                  e.quality && /QC|MEASURED|RESTOCK/.test(e.type) ? QUALITY_LABEL[e.quality as Quality] ?? e.quality : null,
                  e.holdAdded ? `${HOLD_LABEL[e.holdAdded as HoldKind] ?? e.holdAdded} added` : null,
                  e.holdReleased ? `${HOLD_LABEL[e.holdReleased as HoldKind] ?? e.holdReleased} released` : null,
                  e.reason,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
