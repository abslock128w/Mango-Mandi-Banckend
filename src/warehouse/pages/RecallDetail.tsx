// One recall: the batches it covers, how many boxes are held and where the
// rest went, the orders already dispatched, and Continue or Release.

import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dateTime } from '../../format'
import { BackLink, Badge, QueryError, ReasonDialog, Spinner, useToast, usePageTitle } from '../../ui'
import { useWh } from '../access'
import { wh } from '../api'
import { LIFECYCLE_LABEL, RECALL_LABEL } from '../labels'
import type { Lifecycle } from '../types'
import { Counts, TraceOrders } from '../ui'

export default function RecallDetail() {
  const { id = '' } = useParams()
  const { can } = useWh()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [releasing, setReleasing] = useState(false)
  const q = useQuery({ queryKey: ['wh', 'recall', id], queryFn: () => wh.recall(id) })
  const lots = useQuery({ queryKey: ['wh', 'lots', null], queryFn: () => wh.lots() })
  usePageTitle('Recall')
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['wh'] })
  const cont = useMutation({
    mutationFn: () => wh.continueRecall(id),
    onSuccess: (r) => {
      toast.success(`${r.held} boxes held so far.`)
      refresh()
    },
    onError: (err) => toast.error(err),
  })
  const release = useMutation({
    mutationFn: (reason: string) => wh.releaseRecall(id, reason),
    onSuccess: () => {
      setReleasing(false)
      toast.success('Recall released. Its holds are off.')
      refresh()
    },
  })
  if (q.isPending) return <Spinner />
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />
  const r = q.data
  const manage = can('recall.manage')
  return (
    <>
      <BackLink to="/warehouse/reports">Warehouse reports</BackLink>
      <div className="topbar">
        <h1>Recall</h1>
        <Badge tone={r.status === 'released' ? 'neutral' : 'warn'}>{RECALL_LABEL[r.status] ?? r.status}</Badge>
        <span className="spacer" />
        {manage && r.status === 'running' && (
          <button type="button" className="btn" disabled={cont.isPending} onClick={() => cont.mutate()}>
            {cont.isPending ? 'Holding…' : 'Continue holding'}
          </button>
        )}
        {manage && r.status !== 'released' && (
          <button type="button" className="btn" onClick={() => setReleasing(true)}>
            Release
          </button>
        )}
      </div>
      <p>
        {r.reason} <span className="muted">· started {dateTime(r.createdAt)}</span>
        {r.releasedAt && <span className="muted"> · released {dateTime(r.releasedAt)}{r.releaseReason ? `: ${r.releaseReason}` : ''}</span>}
      </p>
      <h2>Batches</h2>
      <ul className="wh-links mb-4">
        {r.lotIds.map((lotId) => (
          <li key={lotId}>
            <Link to={`/warehouse/lots/${lotId}/trace`} className="btn btn-small">
              {lots.data?.find((l) => l.id === lotId)?.code ?? lotId}
            </Link>
          </li>
        ))}
      </ul>
      <Counts
        label="Recall boxes"
        items={[
          { label: 'Held by this recall', count: r.held, tone: 'warn' },
          ...Object.entries(r.byState ?? {}).map(([s, n]) => ({ label: LIFECYCLE_LABEL[s as Lifecycle] ?? s, count: n })),
        ]}
      />
      <section className="card" aria-labelledby="rc-orders">
        <h2 id="rc-orders">Already dispatched</h2>
        <TraceOrders orders={r.dispatchedOrders ?? []} label="Orders already dispatched" />
      </section>
      {releasing && (
        <ReasonDialog
          title="Release this recall?"
          label="Why release it?"
          confirmLabel="Release recall"
          busy={release.isPending}
          error={release.error}
          onSubmit={(reason) => release.mutate(reason)}
          onClose={() => setReleasing(false)}
        >
          <p>Only the holds this recall placed come off; other holds stay.</p>
        </ReasonDialog>
      )}
    </>
  )
}
