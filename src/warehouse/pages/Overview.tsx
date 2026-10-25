// The warehouse at a glance: boxes by state, batches, open scan sessions, and
// links to each warehouse page this role can open.

import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../session'
import { QueryError, Spinner, usePageTitle } from '../../ui'
import { WH_LINKS, whLinkAllowed } from '../access'
import { wh } from '../api'
import { LOT_STATUS_LABEL, OP_LABEL } from '../labels'
import type { LotStatus, OpType } from '../types'
import { Counts } from '../ui'

export default function Overview() {
  usePageTitle('Warehouse')
  const { me } = useSession()
  const q = useQuery({ queryKey: ['wh', 'overview'], queryFn: wh.overview })
  const links = WH_LINKS.filter(([to, , perm]) => to !== '/warehouse' && whLinkAllowed(me, perm))

  return (
    <>
      <div className="topbar">
        <h1>Warehouse</h1>
      </div>
      <nav aria-label="Warehouse pages" className="mb-4">
        <ul className="wh-links">
          {links.map(([to, label]) => (
            <li key={to}>
              <Link to={to} className="btn">
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <h2>Boxes</h2>
          <Counts
            label="Boxes"
            items={[
              { label: 'Labels not yet received', count: q.data.boxes.awaitingReceipt },
              { label: 'In stock', count: q.data.boxes.inStock, to: '/warehouse/boxes' },
              { label: 'Sellable', count: q.data.boxes.sellable },
              { label: 'Waiting for QC', count: q.data.boxes.awaitingQc, tone: 'warn' },
              { label: 'Failed or for review', count: q.data.boxes.failedOrReview, tone: 'bad', to: '/warehouse/exceptions' },
              { label: 'Picked', count: q.data.boxes.picked },
              { label: 'Packed', count: q.data.boxes.packed },
              { label: 'Returned', count: q.data.boxes.returned },
              { label: 'Best before within 2 days', count: q.data.boxes.expiringIn2Days, tone: 'warn', to: '/warehouse/exceptions' },
            ]}
          />
          <div className="grid-2">
            <section className="card" aria-labelledby="ov-lots">
              <h2 id="ov-lots">Box batches</h2>
              <ul className="plain-list">
                {(Object.keys(LOT_STATUS_LABEL) as LotStatus[]).map((s) => (
                  <li key={s}>
                    <Link to={`/warehouse/lots?status=${s}`}>
                      {LOT_STATUS_LABEL[s]}: {q.data.lots[s] ?? 0}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            <section className="card" aria-labelledby="ov-sessions">
              <h2 id="ov-sessions">Open scan sessions</h2>
              {Object.keys(q.data.openSessions).length === 0 ? (
                <p className="muted mb-0">None open.</p>
              ) : (
                <ul className="plain-list">
                  {(Object.entries(q.data.openSessions) as [OpType, number][]).map(([t, n]) => (
                    <li key={t}>
                      {OP_LABEL[t] ?? t}: {n}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mb-0 mt-3">
                Orders waiting to be picked: <strong>{q.data.ordersToPick}</strong>
                {whLinkAllowed(me, 'warehouse.pick') && (
                  <>
                    {' '}
                    · <Link to="/warehouse/picking">Open picking</Link>
                  </>
                )}
              </p>
            </section>
          </div>
        </>
      )}
    </>
  )
}
