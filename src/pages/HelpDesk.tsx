// The Help desk (docs/care.md, HELP_CENTRE): customers' help requests, for
// managers and operators. The inbox puts the requests waiting on us first,
// oldest on top; a request opens its thread with a reply box, and resolve or
// reopen. The API audits every reply, resolve and reopen. Phones show only
// their last 4 digits here. Damaged or missing mangoes are claims (the Claims
// page), never handled as a help request.
import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { dateTime } from '../format'
import { useSession } from '../session'
import type { HelpRequest, HelpRequestDetail, HelpStatus, HelpTopic } from '../types'
import { BackLink, Badge, EmptyState, FormError, LinkRow, QueryError, RowLink, Spinner, StatusFilter, scrollRegion, usePageTitle, useToast } from '../ui'

export const HELP_STATUS_LABEL: Record<HelpStatus, string> = { OPEN: 'Open', WAITING_CUSTOMER: 'Waiting for customer', RESOLVED: 'Resolved' }
const STATUSES: HelpStatus[] = ['OPEN', 'WAITING_CUSTOMER', 'RESOLVED']
const TOPICS: HelpTopic[] = ['DELIVERY', 'PAYMENT', 'CHANGE_ORDER', 'SUBSCRIPTION', 'ACCOUNT', 'OTHER']
/** Mirrors MESSAGE_MAX in mango-api src/help.js; the API refuses longer. */
const MESSAGE_MAX = 2000

function StatusBadge({ status }: { status: HelpStatus }) {
  return <Badge tone={status === 'OPEN' ? 'warn' : status === 'RESOLVED' ? 'good' : 'neutral'}>{HELP_STATUS_LABEL[status]}</Badge>
}

export default function HelpDesk() {
  const { me } = useSession()
  const { id } = useParams()
  usePageTitle(id ? 'Help request' : 'Help desk')
  if (!me?.features?.helpDesk) {
    return (
      <>
        <h1>Help desk</h1>
        <EmptyState>The help centre is switched off (HELP_CENTRE on the API).</EmptyState>
      </>
    )
  }
  return id ? <RequestPage id={id} /> : <Inbox />
}

function Inbox() {
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as HelpStatus | null) || null
  const topic = (params.get('topic') as HelpTopic | null) || null
  const q = params.get('q') ?? ''
  const [search, setSearch] = useState(q)
  const searchId = useId()
  const topicId = useId()
  const inbox = useQuery({ queryKey: ['help-requests', status, topic, q], queryFn: () => api.helpRequests({ status, topic, q }) })

  function set(next: { status?: HelpStatus | null; topic?: HelpTopic | null; q?: string }) {
    const merged = { status, topic, q, ...next }
    const out: Record<string, string> = {}
    if (merged.status) out.status = merged.status
    if (merged.topic) out.topic = merged.topic
    if (merged.q) out.q = merged.q
    setParams(out)
  }

  function onSearch(e: FormEvent) {
    e.preventDefault()
    set({ q: search.trim() })
  }

  return (
    <>
      <div className="topbar">
        <h1>Help desk</h1>
      </div>
      <p className="muted">
        Requests from the shop's help centre. Damaged or missing mangoes come in as <Link to="/claims">claims</Link>, not here.
      </p>
      {inbox.data && (
        <p className="small" data-testid="help-counts">
          {inbox.data.counts.OPEN} open · {inbox.data.counts.WAITING_CUSTOMER} waiting for the customer · {inbox.data.counts.RESOLVED} resolved
        </p>
      )}
      <StatusFilter value={status} options={STATUSES} labels={HELP_STATUS_LABEL} onChange={(s) => set({ status: s })} className="mb-4" />
      <div className="field-row mb-4">
        <div className="field">
          <label htmlFor={topicId}>Topic</label>
          <select id={topicId} value={topic ?? ''} onChange={(e) => set({ topic: (e.target.value as HelpTopic) || null })}>
            <option value="">All topics</option>
            {TOPICS.map((t) => (
              <option key={t} value={t}>
                {inbox.data?.topics[t] ?? t}
              </option>
            ))}
          </select>
        </div>
        <form className="field" onSubmit={onSearch} role="search">
          <label htmlFor={searchId}>Request or order number</label>
          <div className="help-search">
            <input id={searchId} value={search} maxLength={40} placeholder="HLP-12 or MM-1042" onChange={(e) => setSearch(e.target.value)} />
            <button type="submit" className="btn">
              Find
            </button>
          </div>
        </form>
      </div>

      {inbox.isPending ? (
        <Spinner />
      ) : inbox.isError ? (
        <QueryError error={inbox.error} onRetry={() => inbox.refetch()} />
      ) : inbox.data.items.length === 0 ? (
        <EmptyState>No help requests here.</EmptyState>
      ) : (
        <div {...scrollRegion('Help requests', { cards: true })}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Request</th>
                <th scope="col">Status</th>
                <th scope="col">Topic</th>
                <th scope="col">Customer</th>
                <th scope="col">Order</th>
                <th scope="col">Last change</th>
              </tr>
            </thead>
            <tbody>
              {inbox.data.items.map((r) => (
                <InboxRow key={r.id} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function InboxRow({ r }: { r: HelpRequest }) {
  return (
    <LinkRow>
      <td data-label="Request">
        <RowLink to={`/help-desk/${encodeURIComponent(r.id)}`} more={`, ${r.topicLabel}`}>
          {r.number}
        </RowLink>
      </td>
      <td data-label="Status">
        <StatusBadge status={r.status} />
      </td>
      <td data-label="Topic">{r.topicLabel}</td>
      <td data-label="Customer">
        {r.customer.name ?? 'Customer'} {r.customer.phoneMasked && <span className="muted">{r.customer.phoneMasked}</span>}
      </td>
      <td data-label="Order">{r.order?.number ?? '—'}</td>
      <td data-label="Last change">{dateTime(r.updatedAt)}</td>
    </LinkRow>
  )
}

function RequestPage({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['help-request', id], queryFn: () => api.helpRequest(id) })
  return (
    <>
      <BackLink to="/help-desk">Help desk</BackLink>
      {q.isPending ? <Spinner /> : q.isError ? <QueryError error={q.error} onRetry={() => q.refetch()} /> : <Thread r={q.data} />}
    </>
  )
}

function Thread({ r }: { r: HelpRequestDetail }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const replyId = useId()
  const [reply, setReply] = useState('')
  usePageTitle(`Help request ${r.number}`)

  function saved(next: HelpRequestDetail) {
    queryClient.setQueryData(['help-request', r.id], next)
    queryClient.invalidateQueries({ queryKey: ['help-requests'] })
  }
  const send = useMutation({
    mutationFn: () => api.replyHelpRequest(r.id, reply.trim()),
    onSuccess: (next) => {
      saved(next)
      setReply('')
      toast.success(`Reply sent on ${r.number}. The customer is told on the shop.`)
    },
  })
  const resolve = useMutation({
    mutationFn: () => api.resolveHelpRequest(r.id),
    onSuccess: (next) => {
      saved(next)
      toast.success(`${r.number} resolved`)
      navigate('/help-desk')
    },
    onError: (err) => toast.error(err),
  })
  const reopen = useMutation({
    mutationFn: () => api.reopenHelpRequest(r.id),
    onSuccess: (next) => {
      saved(next)
      toast.success(`${r.number} reopened`)
    },
    onError: (err) => toast.error(err),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (reply.trim()) send.mutate()
  }

  return (
    <>
      <div className="topbar">
        <h1>{r.number}</h1>
        <StatusBadge status={r.status} />
        <span className="spacer" />
        {r.status === 'RESOLVED' ? (
          <button type="button" className="btn" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
            Reopen
          </button>
        ) : (
          <button type="button" className="btn" disabled={resolve.isPending} onClick={() => resolve.mutate()}>
            Mark resolved
          </button>
        )}
      </div>
      <dl className="kv card">
        <dt>Topic</dt>
        <dd>{r.topicLabel}</dd>
        <dt>Customer</dt>
        <dd>
          {r.customer.name ?? 'Customer'} {r.customer.phoneMasked && <span className="muted">{r.customer.phoneMasked}</span>}
        </dd>
        <dt>Order</dt>
        <dd>
          {r.order ? (
            <Link to={`/orders/${encodeURIComponent(r.order.id)}`}>
              {r.order.number}
              {r.order.deliveryDate ? `, for ${r.order.deliveryDate}` : ''}
            </Link>
          ) : (
            'General question'
          )}
        </dd>
        <dt>Opened</dt>
        <dd>{dateTime(r.createdAt)}</dd>
        {r.resolvedAt && (
          <>
            <dt>Resolved</dt>
            <dd>
              {dateTime(r.resolvedAt)}
              {r.resolvedBy ? ` by ${r.resolvedBy}` : ''}
            </dd>
          </>
        )}
      </dl>

      <h2>Messages</h2>
      <ol className="help-thread" aria-label="Messages">
        {r.messages.map((m) => (
          <li key={m.id} className={`card help-message ${m.from === 'STAFF' ? 'help-message-staff' : ''}`}>
            <p className="small muted mb-0">
              {m.from === 'STAFF' ? `MandiMangoes (${m.staffEmail ?? 'staff'})` : (r.customer.name ?? 'Customer')} · {dateTime(m.at)}
            </p>
            <p className="pre-wrap mb-0">{m.body}</p>
          </li>
        ))}
      </ol>

      <form className="card" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor={replyId}>Reply to the customer</label>
          <textarea id={replyId} rows={4} maxLength={MESSAGE_MAX} value={reply} onChange={(e) => setReply(e.target.value)} aria-describedby={`${replyId}-hint`} />
          <p id={`${replyId}-hint`} className="hint">
            The customer reads this in the shop and is told there is a reply. {reply.length}/{MESSAGE_MAX}. Sending it marks the request as waiting for the customer.
          </p>
        </div>
        <FormError error={send.error} />
        <button type="submit" className="btn btn-primary" disabled={!reply.trim() || send.isPending}>
          {send.isPending ? 'Sending…' : 'Send reply'}
        </button>
      </form>
    </>
  )
}
