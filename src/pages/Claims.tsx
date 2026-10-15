import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { ISSUE_LABEL, RESOLUTION_LABEL, dateTime, paiseToInput, rupees, rupeesToPaise } from '../format'
import { MANAGER_ONLY_HINT, can } from '../permissions'
import { useSession } from '../session'
import type { Claim, ClaimResolution, ClaimStatus } from '../types'
import { Badge, ClaimBadge, Dialog, EmptyState, FormError, QueryError, Spinner, useToast } from '../ui'

const FILTERS: { value: ClaimStatus | null; label: string }[] = [
  { value: null, label: 'All open' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'RESOLVED', label: 'Resolved' },
]

function useClaimsRefresh() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['claims'] })
    queryClient.invalidateQueries({ queryKey: ['summary'] })
  }
}

export default function Claims() {
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as ClaimStatus | null) || null
  const q = useQuery({ queryKey: ['claims', status], queryFn: () => api.claims(status) })
  const [resolving, setResolving] = useState<Claim | null>(null)

  return (
    <>
      <div className="topbar">
        <h1>Claims</h1>
      </div>
      <div className="segmented" role="group" aria-label="Filter claims" style={{ marginBottom: '1rem' }}>
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            className="btn btn-small"
            aria-pressed={status === f.value}
            onClick={() => setParams(f.value ? { status: f.value } : {})}
          >
            {f.label}
          </button>
        ))}
      </div>

      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState>No claims here.</EmptyState>
      ) : (
        q.data.map((c) => <ClaimCard key={c.id} claim={c} onResolve={() => setResolving(c)} />)
      )}

      {resolving && <ResolveDialog claim={resolving} onClose={() => setResolving(null)} />}
    </>
  )
}

function ClaimCard({ claim, onResolve }: { claim: Claim; onResolve: () => void }) {
  const toast = useToast()
  const refresh = useClaimsRefresh()
  const review = useMutation({
    mutationFn: () => api.reviewClaim(claim.id),
    onSuccess: () => {
      toast.success(`Review started for ${claim.orderNumber}`)
      refresh()
    },
    onError: (err) => toast.error(err),
  })

  return (
    <article className="card">
      <div className="topbar" style={{ marginBottom: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>
          <Link to={`/orders/${claim.orderId}`}>{claim.orderNumber}</Link>
        </h2>
        <Badge tone="warn">{ISSUE_LABEL[claim.issueType] ?? claim.issueType}</Badge>
        <ClaimBadge status={claim.status} />
        {claim.createdAt && <span className="muted small">{dateTime(claim.createdAt)}</span>}
        <span className="spacer" />
        {claim.status === 'SUBMITTED' && (
          <button type="button" className="btn btn-primary" disabled={review.isPending} onClick={() => review.mutate()}>
            Start review<span className="sr-only"> for {claim.orderNumber}</span>
          </button>
        )}
        {claim.status === 'UNDER_REVIEW' && (
          <button type="button" className="btn btn-primary" onClick={onResolve}>
            Resolve<span className="sr-only"> {claim.orderNumber}</span>
          </button>
        )}
      </div>
      <dl className="kv">
        <dt>Phone</dt>
        <dd>{claim.customerPhone ?? '—'}</dd>
        <dt>Order total</dt>
        <dd>{rupees(claim.orderTotal)}</dd>
        <dt>Affected items</dt>
        <dd>{claim.affectedItems.length ? claim.affectedItems.join(', ') : '—'}</dd>
        {claim.photoUrl && (
          <>
            <dt>Photo</dt>
            <dd>
              <a href={claim.photoUrl} target="_blank" rel="noopener noreferrer">
                Open photo<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </dd>
          </>
        )}
        {claim.status === 'RESOLVED' && claim.resolution && (
          <>
            <dt>Resolution</dt>
            <dd>{RESOLUTION_LABEL[claim.resolution] ?? claim.resolution}</dd>
          </>
        )}
      </dl>
      <p style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{claim.description}</p>
    </article>
  )
}

function ResolveDialog({ claim, onClose }: { claim: Claim; onClose: () => void }) {
  const { me } = useSession()
  const toast = useToast()
  const refresh = useClaimsRefresh()
  const canRefund = can(me?.role, 'resolveClaimRefund')
  const [resolution, setResolution] = useState<ClaimResolution>(canRefund ? 'REFUND_APPROVED' : 'REPLACEMENT_APPROVED')
  const [amount, setAmount] = useState(paiseToInput(claim.orderTotal))

  const paise = rupeesToPaise(amount)
  const amountInvalid = resolution === 'REFUND_APPROVED' && (paise === null || paise > claim.orderTotal)

  const resolve = useMutation({
    mutationFn: () =>
      api.resolveClaim(
        claim.id,
        resolution,
        // Omit the amount for a full refund.
        resolution === 'REFUND_APPROVED' && paise !== claim.orderTotal ? (paise as number) : undefined,
      ),
    onSuccess: () => {
      toast.success(`Claim on ${claim.orderNumber} resolved: ${RESOLUTION_LABEL[resolution]}`)
      refresh()
      onClose()
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!amountInvalid) resolve.mutate()
  }

  const confirmText =
    resolution === 'REFUND_APPROVED'
      ? amountInvalid
        ? 'Refund'
        : `Refund ${rupees(paise)}`
      : resolution === 'REPLACEMENT_APPROVED'
        ? 'Approve replacement'
        : 'Reject claim'

  return (
    <Dialog
      title={`Resolve claim on ${claim.orderNumber}`}
      onClose={onClose}
      tone={resolution === 'REFUND_APPROVED' ? 'danger' : undefined}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="resolve-form"
            className={`btn ${resolution === 'REFUND_APPROVED' ? 'btn-danger' : 'btn-primary'}`}
            disabled={amountInvalid || resolve.isPending}
          >
            {resolve.isPending ? 'Saving…' : confirmText}
          </button>
        </>
      }
    >
      <form id="resolve-form" onSubmit={onSubmit} noValidate>
        <fieldset>
          <legend>Resolution</legend>
          <div className="radio-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <label title={canRefund ? undefined : MANAGER_ONLY_HINT}>
              <input
                type="radio"
                name="resolution"
                checked={resolution === 'REFUND_APPROVED'}
                disabled={!canRefund}
                onChange={() => setResolution('REFUND_APPROVED')}
              />
              Refund{!canRefund && <span className="muted small"> ({MANAGER_ONLY_HINT})</span>}
            </label>
            <label>
              <input
                type="radio"
                name="resolution"
                checked={resolution === 'REPLACEMENT_APPROVED'}
                onChange={() => setResolution('REPLACEMENT_APPROVED')}
              />
              Replacement
            </label>
            <label>
              <input type="radio" name="resolution" checked={resolution === 'REJECTED'} onChange={() => setResolution('REJECTED')} />
              Reject
            </label>
          </div>
        </fieldset>
        {resolution === 'REFUND_APPROVED' && (
          <div className="field">
            <label htmlFor="claim-amount">Refund amount (₹)</label>
            <input id="claim-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <p className="hint">Up to the full payment of {rupees(claim.orderTotal)}.</p>
            {amountInvalid && (
              <p className="form-error" role="alert">
                Enter an amount above ₹0 and no more than {rupees(claim.orderTotal)}.
              </p>
            )}
          </div>
        )}
        <p className="muted small">This closes the claim. It cannot be reopened from here.</p>
        <FormError error={resolve.error} />
      </form>
    </Dialog>
  )
}
