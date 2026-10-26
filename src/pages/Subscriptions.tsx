// Subscriptions (docs/care.md, SUBSCRIPTIONS): every mango season
// subscription with its coming boxes, for managers and operators. Staff can
// pause or cancel one, with a reason the API keeps in the activity log. There
// is no auto-debit and no wallet: each box is an ordinary order the customer
// pays for, so nothing here takes or returns money. Phones show only their
// last 4 digits; the address stays on the order.
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { date, ripenessLabel } from '../format'
import { useSession } from '../session'
import type { StaffSubscription, SubscriptionCycle, SubscriptionStatus } from '../types'
import { Badge, EmptyState, QueryError, ReasonDialog, Spinner, StatusFilter, usePageTitle, useToast } from '../ui'

type Filter = 'ACTIVE' | 'PAUSED' | 'CANCELLED'
const FILTERS: Filter[] = ['ACTIVE', 'PAUSED', 'CANCELLED']
export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = { ACTIVE: 'Active', PAUSED: 'Paused', CANCELLED: 'Cancelled', ENDED: 'Ended' }
const WEEKDAY = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
/** Mirrors the API: a reason of 5 characters or more. */
const MIN_REASON = 5

export default function Subscriptions() {
  usePageTitle('Subscriptions')
  const { me } = useSession()
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as Filter | null) || null
  const list = useQuery({ queryKey: ['subscriptions', status], queryFn: () => api.subscriptions(status), enabled: !!me?.features?.subscriptions })
  const [acting, setActing] = useState<{ sub: StaffSubscription; action: 'pause' | 'cancel' } | null>(null)

  if (!me?.features?.subscriptions) {
    return (
      <>
        <h1>Subscriptions</h1>
        <EmptyState>Subscriptions are switched off (SUBSCRIPTIONS on the API).</EmptyState>
      </>
    )
  }

  return (
    <>
      <div className="topbar">
        <h1>Subscriptions</h1>
      </div>
      <p className="muted">
        Each box is set up a couple of days ahead and the customer pays for it like any order (no auto-debit). A box shows on Orders once it is paid for.
      </p>
      {list.data && (
        <p className="small" data-testid="subscription-counts">
          {list.data.counts.ACTIVE} active · {list.data.counts.PAUSED} paused · {list.data.counts.CANCELLED} cancelled
        </p>
      )}
      <StatusFilter value={status} options={FILTERS} labels={SUBSCRIPTION_STATUS_LABEL} onChange={(s) => setParams(s ? { status: s } : {})} className="mb-4" />
      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <QueryError error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState>No subscriptions here.</EmptyState>
      ) : (
        list.data.items.map((s) => <SubscriptionCard key={s.id} s={s} onAct={(action) => setActing({ sub: s, action })} />)
      )}
      {acting && <ActDialog sub={acting.sub} action={acting.action} onClose={() => setActing(null)} />}
    </>
  )
}

function statusTone(s: SubscriptionStatus) {
  return s === 'ACTIVE' ? 'good' : s === 'PAUSED' ? 'warn' : 'neutral'
}

function SubscriptionCard({ s, onAct }: { s: StaffSubscription; onAct: (action: 'pause' | 'cancel') => void }) {
  const running = s.status === 'ACTIVE' || s.status === 'PAUSED'
  return (
    <article className="card" aria-labelledby={`sub-${s.id}`}>
      <div className="topbar section-head">
        <h2 id={`sub-${s.id}`}>{s.number}</h2>
        <Badge tone={statusTone(s.status)}>{SUBSCRIPTION_STATUS_LABEL[s.status]}</Badge>
        <span className="spacer" />
        {s.status === 'ACTIVE' && (
          <button type="button" className="btn" onClick={() => onAct('pause')}>
            Pause<span className="sr-only"> {s.number}</span>
          </button>
        )}
        {running && (
          <button type="button" className="btn btn-danger" onClick={() => onAct('cancel')}>
            Cancel<span className="sr-only"> {s.number}</span>
          </button>
        )}
      </div>
      <dl className="kv">
        <dt>Box</dt>
        <dd>
          {s.qty} × {s.productName} ({ripenessLabel(s.stage)})
        </dd>
        <dt>When</dt>
        <dd>
          {s.frequency === 'WEEKLY' ? 'Every' : 'Every other'} {WEEKDAY[s.weekday]}, {date(s.firstDate)} to {date(s.endDate)}
        </dd>
        <dt>Customer</dt>
        <dd>
          {s.customer.name ?? 'Customer'} {s.customer.phoneMasked && <span className="muted">{s.customer.phoneMasked}</span>} · {s.pincode}
        </dd>
        {s.pausedAt && s.status === 'PAUSED' && (
          <>
            <dt>Paused</dt>
            <dd>{date(s.pausedAt.slice(0, 10))}</dd>
          </>
        )}
      </dl>
      <h3 className="small">Coming boxes</h3>
      {s.cycles.length === 0 && s.upcoming.length === 0 ? (
        <p className="muted small mb-0">None coming.</p>
      ) : (
        <ul className="sub-cycles">
          {[...s.cycles].reverse().map((y) => (
            <CycleLine key={y.id} y={y} />
          ))}
          {s.status === 'ACTIVE' &&
            s.upcoming.map((d) => (
              <li key={d}>
                {date(d)}: <span className="muted">not set up yet</span>
              </li>
            ))}
        </ul>
      )}
    </article>
  )
}

const CYCLE_LABEL: Record<SubscriptionCycle['status'], string> = {
  DUE: 'waiting for payment',
  ORDERED: 'ordered',
  SKIPPED: 'skipped by the customer',
  MISSED: 'missed (not paid in time, or no day with stock)',
  CANCELLED: 'called off',
}

function CycleLine({ y }: { y: SubscriptionCycle }) {
  const label = y.paid ? 'paid' : y.awaitingPayment ? 'payment started' : CYCLE_LABEL[y.status]
  return (
    <li>
      {date(y.deliveryDate ?? y.scheduledFor)}: {label}
      {y.order && (
        <>
          {' '}
          (<Link to={`/orders/${encodeURIComponent(y.order.id)}`}>{y.order.number}</Link>)
        </>
      )}
      {y.note && <span className="muted small"> · {y.note}</span>}
    </li>
  )
}

function ActDialog({ sub, action, onClose }: { sub: StaffSubscription; action: 'pause' | 'cancel'; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const act = useMutation({
    mutationFn: (reason: string) => (action === 'pause' ? api.pauseSubscription(sub.id, reason) : api.cancelSubscription(sub.id, reason)),
    onSuccess: () => {
      toast.success(`${sub.number} ${action === 'pause' ? 'paused' : 'cancelled'}`)
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
      onClose()
    },
  })
  return (
    <ReasonDialog
      title={`${action === 'pause' ? 'Pause' : 'Cancel'} ${sub.number}`}
      tone={action === 'cancel' ? 'danger' : 'primary'}
      minLength={MIN_REASON}
      maxLength={500}
      hint={`Kept in the activity log. At least ${MIN_REASON} characters.`}
      confirmLabel={action === 'pause' ? 'Pause subscription' : 'Cancel subscription'}
      cancelLabel="Keep it"
      busy={act.isPending}
      error={act.error}
      onSubmit={(reason) => act.mutate(reason)}
      onClose={onClose}
    >
      <p>
        {action === 'pause'
          ? 'No new boxes are set up until the customer resumes it. A box waiting for payment is called off; a paid one is delivered as usual.'
          : 'No more boxes are set up and the customer cannot restart it. A box waiting for payment is called off; a paid one is delivered as usual (cancel that order from Orders if needed).'}
      </p>
    </ReasonDialog>
  )
}
