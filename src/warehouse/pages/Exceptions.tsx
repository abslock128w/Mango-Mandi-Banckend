// Exceptions: what needs a person in the warehouse today. Each group links
// to the order, box or batch to fix.

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { date, dateTime } from '../../format'
import { QueryError, Spinner, usePageTitle } from '../../ui'
import { wh } from '../api'
import { HOLD_LABEL, OP_LABEL } from '../labels'
import type { HoldKind } from '../types'

export default function Exceptions() {
  usePageTitle('Warehouse exceptions')
  const q = useQuery({ queryKey: ['wh', 'exceptions'], queryFn: wh.exceptions })
  if (q.isPending) return <Spinner />
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />
  const x = q.data
  const total = Object.values(x).reduce((n, list) => n + (list?.length ?? 0), 0)

  return (
    <>
      <div className="topbar">
        <h1>Exceptions</h1>
      </div>
      {total === 0 && <p className="notice notice-info">Nothing needs attention in the warehouse.</p>}
      <Group title="Orders short of boxes" items={x.shortfallOrders}>
        {(r) => (
          <>
            <Link to={`/orders/${r.orderId}`}>{r.number}</Link> · delivery {date(r.deliveryDate)}
            {r.reason ? ` · ${r.reason}` : ''}
          </>
        )}
      </Group>
      <Group title="Held boxes on orders" items={x.heldBoxesOnOrders}>
        {(r) => (
          <>
            <Link to={`/warehouse/boxes/${r.boxId}`}>{r.code}</Link> on <Link to={`/orders/${r.orderId}`}>{r.number}</Link> ·{' '}
            {r.holds.map((h) => HOLD_LABEL[h as HoldKind] ?? h).join(', ')}
          </>
        )}
      </Group>
      <Group title="Batches with labels not received" items={x.unreceivedLots}>
        {(r) => (
          <>
            <Link to={`/warehouse/lots/${r.lotId}`}>{r.code}</Link> · {r.waiting} waiting since {dateTime(r.createdAt)}
          </>
        )}
      </Group>
      <Group title="Boxes to put away" items={x.boxesToPutAway}>
        {(r) => (
          <>
            <Link to={`/warehouse/boxes/${r.boxId}`}>{r.code}</Link> · {r.skuName} · since {dateTime(r.since)}
          </>
        )}
      </Group>
      <Group title="Best before soon" items={x.expiringSoon}>
        {(r) => (
          <>
            <Link to={`/warehouse/lots/${r.lotId}`}>{r.code}</Link> · {r.boxes} boxes by {date(r.bestBefore)}
          </>
        )}
      </Group>
      <Group title="Investigations" items={x.investigations}>
        {(r) => (
          <>
            <Link to={`/warehouse/boxes/${r.boxId}`}>{r.code}</Link>
            {r.reason ? ` · ${r.reason}` : ''} · since {dateTime(r.since)}
          </>
        )}
      </Group>
      <Group title="Counts waiting for a review" items={x.stocktakeReviews ?? []}>
        {(r) => (
          <>
            <Link to={`/warehouse/stocktake/${r.operationId}`}>{r.locationName}</Link> ·{' '}
            {r.toReview ? `${r.toReview} not found, to review` : `${r.toApprove} to approve by a second person`} · counted {dateTime(r.finishedAt)}
          </>
        )}
      </Group>
      <Group title="Boxes marked missing" items={x.missingBoxes ?? []}>
        {(r) => (
          <>
            <Link to={`/warehouse/boxes/${r.boxId}`}>{r.code}</Link> · {r.skuName} · since {dateTime(r.since)}
          </>
        )}
      </Group>
      <Group title="Pack or dispatch sessions left open" items={x.staleSessions}>
        {(r) => (
          <>
            {OP_LABEL[r.type] ?? r.type} by {r.owner ?? 'someone'} · last scan {dateTime(r.lastActivityAt)}
          </>
        )}
      </Group>
      <Group title="Write-offs waiting for a second manager" items={x.pendingWriteOffs}>
        {(r) => (
          <>
            {r.boxes} boxes · {r.reason} · <Link to="/warehouse/reports#write-offs">Review</Link>
          </>
        )}
      </Group>
      <Group title="Customer messages that failed" items={x.failedMessages}>
        {(r) => (
          <>
            {r.number ?? r.kind}
            {r.error ? ` · ${r.error}` : ''}
          </>
        )}
      </Group>
    </>
  )
}

function Group<T>({ title, items, children }: { title: string; items: T[]; children: (item: T) => ReactNode }) {
  if (!items.length) return null
  return (
    <section className="card" aria-label={title}>
      <h2>
        {title} <span className="muted">({items.length})</span>
      </h2>
      <ul className="plain-list wh-list">
        {items.map((item, i) => (
          <li key={i}>{children(item)}</li>
        ))}
      </ul>
    </section>
  )
}
