// One order's pick list: what is left to pick per item and the boxes to take,
// oldest batch first (FEFO), with where each one is.

import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { date } from '../../format'
import { BackLink, Badge, QueryError, Spinner, useToast, usePageTitle } from '../../ui'
import { useWh } from '../access'
import { wh } from '../api'
import { LIFECYCLE_LABEL } from '../labels'
import type { OpType } from '../types'

export default function PickList() {
  const { orderId = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useWh()
  const q = useQuery({ queryKey: ['wh', 'pick-list', orderId], queryFn: () => wh.pickList(orderId) })
  usePageTitle(q.data ? `Pick ${q.data.number}` : 'Pick list')
  const start = useMutation({
    mutationFn: (type: OpType) => wh.startOperation(type, { orderId }),
    onSuccess: (op) => navigate(`/warehouse/scan?op=${encodeURIComponent(op.id)}`),
    onError: (err) => toast.error(err),
  })

  if (q.isPending) return <Spinner />
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />
  const p = q.data
  const left = p.items.reduce((n, i) => n + i.toPick, 0)

  return (
    <>
      <BackLink to="/warehouse/picking">Picking</BackLink>
      <div className="topbar">
        <h1>Pick {p.number}</h1>
        {p.atRisk && <Badge tone="bad">At risk</Badge>}
        <span className="spacer" />
        {left > 0 ? (
          <button type="button" className="btn btn-primary" disabled={start.isPending} onClick={() => start.mutate('pick')}>
            {start.isPending ? 'Starting…' : 'Start picking'}
          </button>
        ) : (
          can('warehouse.pack') && (
            <button type="button" className="btn btn-primary" disabled={start.isPending} onClick={() => start.mutate('pack')}>
              {start.isPending ? 'Starting…' : 'Start packing'}
            </button>
          )
        )}
      </div>
      <p className="muted">
        Delivery {date(p.deliveryDate)} · {left ? `${left} ${left === 1 ? 'box' : 'boxes'} left to pick` : 'Everything is picked'}
      </p>
      {p.items.map((i) => (
        <section key={i.itemId} className="card" aria-label={`${i.sku}: ${i.toPick} to pick`}>
          <h2>
            {i.sku} <span className="muted">· {i.toPick} of {i.quantity} to pick</span>
          </h2>
          {i.suggestions.length > 0 && (
            <>
              <h3>Take these</h3>
              <ul className="plain-list wh-list">
                {i.suggestions.map((s) => (
                  <li key={s.lot}>
                    Batch <strong>{s.lot}</strong>: {s.quantity}
                    <ul className="plain-list small">
                      {s.boxes.map((b) => (
                        <li key={b.id}>
                          <code>{b.code}</code> · {b.location ?? 'no location'} · best before {date(b.bestBefore)}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          )}
          {i.picked.length > 0 && (
            <>
              <h3>Picked</h3>
              <ul className="plain-list small">
                {i.picked.map((b) => (
                  <li key={b.id}>
                    <code>{b.code}</code> · {LIFECYCLE_LABEL[b.lifecycle] ?? b.lifecycle}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ))}
    </>
  )
}
