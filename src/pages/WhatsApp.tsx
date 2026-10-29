// WhatsApp (docs/whatsapp/OPERATIONS.md). The inbox, for managers and operators:
// conversations waiting for a person first, a conversation's messages with a reply
// box, take over, hand back to the bot, assign, close, and recording an opt-out a
// customer asked for. Replies are only possible within 24 hours of the customer's
// last message (WhatsApp's rule); the page says when that window closes.
// Set-up and health, for managers: what is configured (never the values), a live
// connection check, the template list from Meta, a switch per automated message,
// and what failed with Send again or Process again.
// Phones show only their last 4 digits. Photos are fetched through the API.
import { Fragment, useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { dateTime, ORDER_STATUS_LABEL, rupees } from '../format'
import { useSession } from '../session'
import { useStepUp } from '../StepUp'
import type { StaffMember, WaAutomation, WaAutomationState, WaConversation, WaConversationDetail, WaInboxView, WaMessage, WaOverview } from '../types'
import {
  AuthedPhoto, BackLink, Badge, ConfirmDialog, EmptyState, FormError, LinkRow, QueryError, RowLink, Spinner, StatusFilter, Tabs, scrollRegion, tabPanelProps, usePageTitle, useToast,
} from '../ui'

/** Mirrors STAFF_REPLY_MAX in mango-api src/wa/conversations.js. */
const REPLY_MAX = 2000
const VIEWS: Exclude<WaInboxView, 'all'>[] = ['waiting', 'mine', 'staff']
const VIEW_LABEL: Record<Exclude<WaInboxView, 'all'>, string> = { waiting: 'Waiting for us', mine: 'Mine', staff: 'Held by staff' }
const STEP_UP_WHY = 'Turning an automated WhatsApp message on or off changes what every customer is sent, so it needs you to confirm who you are.'

export const STATE_LABEL: Record<WaAutomationState, string> = {
  OFF: 'Turned off here',
  FLAG_OFF: 'Its feature is off',
  NOT_CHECKED: 'Templates not read from Meta yet',
  AWAITING_TEMPLATE: 'Template not created at Meta',
  AWAITING_APPROVAL: 'Waiting for Meta approval',
  VARIABLES_MISMATCH: 'Template variables do not match',
  READY: 'Ready',
}
const STATE_TONE: Record<WaAutomationState, 'good' | 'warn' | 'bad' | 'neutral'> = {
  OFF: 'neutral', FLAG_OFF: 'neutral', NOT_CHECKED: 'neutral', AWAITING_TEMPLATE: 'warn', AWAITING_APPROVAL: 'warn', VARIABLES_MISMATCH: 'bad', READY: 'good',
}
const PROBLEM_LABEL: Record<string, string> = {
  missing_credentials: 'The token or phone number id is not set',
  invalid_token: 'Meta refused the token: it is wrong, expired or revoked',
  insufficient_permissions: 'The token lacks a permission (whatsapp_business_messaging and whatsapp_business_management)',
  invalid_configuration: 'Meta does not know that id: check the phone number id and business account id',
  rate_limited: 'Meta is limiting calls right now: try again in a few minutes',
  unavailable: 'Meta could not be reached',
  error: 'Meta returned an error',
}

function ConversationBadge({ c }: { c: WaConversation }) {
  if (c.status === 'WAITING') return <Badge tone="warn">Waiting for us</Badge>
  if (c.status === 'CLOSED') return <Badge>Closed</Badge>
  return c.mode === 'STAFF' ? <Badge tone="info">With staff</Badge> : <Badge tone="good">Bot answering</Badge>
}

function windowWords(c: WaConversation): string {
  if (c.windowOpen && c.windowOpenUntil) return `Replies allowed until ${dateTime(c.windowOpenUntil)}`
  return 'Reply window closed: the customer has to write first'
}

export default function WhatsApp() {
  const { me } = useSession()
  const { id } = useParams()
  const navigate = useNavigate()
  const isManager = me?.role === 'MANAGER'
  const tabsId = useId()
  usePageTitle(id && id !== 'setup' ? 'WhatsApp conversation' : 'WhatsApp')
  if (id && id !== 'setup') return <ConversationPage id={id} />
  const tab = id === 'setup' && isManager ? 'setup' : 'inbox'
  return (
    <>
      <div className="topbar">
        <h1>WhatsApp</h1>
      </div>
      {isManager && (
        <Tabs
          id={tabsId}
          label="WhatsApp"
          tabs={[['inbox', 'Inbox'], ['setup', 'Set-up and health']] as const}
          value={tab}
          onChange={(t) => navigate(t === 'setup' ? '/whatsapp/setup' : '/whatsapp')}
        />
      )}
      <div {...(isManager ? tabPanelProps(tabsId, tab) : {})}>{tab === 'setup' ? <Setup /> : <Inbox />}</div>
    </>
  )
}

// ---------------------------------------------------------------- inbox

function Inbox() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('view')
  const view: WaInboxView = raw === 'all' || raw === 'mine' || raw === 'staff' ? raw : 'waiting'
  const inbox = useQuery({ queryKey: ['wa-inbox', view], queryFn: () => api.waInbox(view), refetchInterval: 20_000 })
  return (
    <>
      <p className="muted">
        Customers who asked for a person, or sent a photo, wait here. While a person holds a conversation the bot stays quiet; hand it back when you are done.
      </p>
      {inbox.data && (
        <p className="small" data-testid="wa-counts">
          {inbox.data.counts.waiting} waiting for us · {inbox.data.counts.staff} held by staff · {inbox.data.counts.mine} assigned to you
        </p>
      )}
      <StatusFilter
        value={view === 'all' ? null : view}
        options={VIEWS}
        labels={VIEW_LABEL}
        onChange={(v) => setParams(v ? (v === 'waiting' ? {} : { view: v }) : { view: 'all' })}
        className="mb-4"
      />
      {inbox.isPending ? (
        <Spinner />
      ) : inbox.isError ? (
        <QueryError error={inbox.error} onRetry={() => inbox.refetch()} />
      ) : inbox.data.conversations.length === 0 ? (
        <EmptyState>{view === 'waiting' ? 'Nobody is waiting for a person.' : 'No conversations here.'}</EmptyState>
      ) : (
        <div {...scrollRegion('WhatsApp conversations', { cards: true })}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Status</th>
                <th scope="col">Last message</th>
                <th scope="col">Reply window</th>
                <th scope="col">Assigned to</th>
                <th scope="col">Last change</th>
              </tr>
            </thead>
            <tbody>
              {inbox.data.conversations.map((c) => (
                <LinkRow key={c.id}>
                  <td data-label="Customer">
                    <RowLink to={`/whatsapp/${encodeURIComponent(c.id)}`} more={c.unread ? `, ${c.unread} new` : undefined}>
                      {c.customer?.name ?? 'Customer'}
                    </RowLink>{' '}
                    <span className="muted">{c.phone}</span> {c.unread > 0 && <Badge tone="warn">{c.unread} new</Badge>}
                  </td>
                  <td data-label="Status">
                    <ConversationBadge c={c} />
                    {c.handoffReason && <span className="small muted"> {c.handoffReason}</span>}
                  </td>
                  <td data-label="Last message" className="wa-preview">{c.preview ?? '—'}</td>
                  <td data-label="Reply window">{c.windowOpen ? `Until ${dateTime(c.windowOpenUntil)}` : 'Closed'}</td>
                  <td data-label="Assigned to">{c.assignedTo?.email ?? 'Nobody'}</td>
                  <td data-label="Last change">{dateTime(c.updatedAt)}</td>
                </LinkRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- one conversation

function ConversationPage({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['wa-conversation', id], queryFn: () => api.waConversation(id), refetchInterval: 15_000 })
  return (
    <>
      <BackLink to="/whatsapp">WhatsApp</BackLink>
      {q.isPending ? <Spinner /> : q.isError ? <QueryError error={q.error} onRetry={() => q.refetch()} /> : <Conversation d={q.data} />}
    </>
  )
}

function Conversation({ d }: { d: WaConversationDetail }) {
  const { me } = useSession()
  const c = d.conversation
  const toast = useToast()
  const queryClient = useQueryClient()
  const replyId = useId()
  const assignId = useId()
  const [reply, setReply] = useState('')
  const [optOut, setOptOut] = useState<null | 'all' | 'marketing'>(null)
  const who = c.customer?.name ?? 'the customer'
  usePageTitle(`WhatsApp: ${c.customer?.name ?? c.phone ?? 'conversation'}`)
  const staff = useQuery({ queryKey: ['staff'], queryFn: api.staff, enabled: me?.role === 'MANAGER' })

  function saved(next: WaConversationDetail) {
    queryClient.setQueryData(['wa-conversation', c.id], next)
    void queryClient.invalidateQueries({ queryKey: ['wa-inbox'] })
  }
  const act = (fn: () => Promise<WaConversationDetail>, done: string) => ({
    mutationFn: fn,
    onSuccess: (next: WaConversationDetail) => {
      saved(next)
      toast.success(done)
    },
    onError: (err: unknown) => toast.error(err),
  })
  const send = useMutation({
    mutationFn: () => api.waReply(c.id, reply.trim()),
    onSuccess: (next) => {
      saved(next)
      setReply('')
      toast.success(`Reply sent to ${who}. The bot stays quiet until you hand the chat back.`)
    },
  })
  const takeOver = useMutation(act(() => api.waTakeOver(c.id), 'You have this conversation. The bot stays quiet.'))
  const handBack = useMutation(act(() => api.waHandBack(c.id), 'Handed back: the bot answers again.'))
  const close = useMutation(act(() => api.waClose(c.id), 'Conversation closed.'))
  const assign = useMutation({
    mutationFn: (adminId: string | null) => api.waAssign(c.id, adminId),
    onSuccess: (next) => {
      saved(next)
      toast.success(next.conversation.assignedTo ? `Assigned to ${next.conversation.assignedTo.email ?? 'them'}.` : 'Nobody is assigned now.')
    },
    onError: (err) => toast.error(err),
  })
  const recordOptOut = useMutation({
    mutationFn: (scope: 'all' | 'marketing') => api.waOptOut(c.id, scope),
    onSuccess: (next) => {
      saved(next)
      setOptOut(null)
      toast.success('Recorded. It is in the activity log with your name.')
    },
  })
  const retry = useMutation({
    mutationFn: (messageId: string) => api.waRetryMessage(messageId),
    onSuccess: () => {
      toast.success('Sending it again.')
      void queryClient.invalidateQueries({ queryKey: ['wa-conversation', c.id] })
    },
    onError: (err) => toast.error(err),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (reply.trim()) send.mutate()
  }
  const answerers = (staff.data ?? []).filter((s: StaffMember) => s.role === 'MANAGER' || s.role === 'OPERATOR')

  return (
    <>
      <div className="topbar">
        <h1>{c.customer?.name ?? 'Customer'}</h1>
        <ConversationBadge c={c} />
        <span className="spacer" />
        {(c.mode === 'BOT' || !c.assignedTo) && (
          <button type="button" className="btn" disabled={takeOver.isPending} onClick={() => takeOver.mutate()}>
            Take over
          </button>
        )}
        {c.mode === 'STAFF' && (
          <button type="button" className="btn" disabled={handBack.isPending} onClick={() => handBack.mutate()}>
            Hand back to the bot
          </button>
        )}
        {c.status !== 'CLOSED' && (
          <button type="button" className="btn" disabled={close.isPending} onClick={() => close.mutate()}>
            Close
          </button>
        )}
      </div>
      <dl className="kv card">
        <dt>Phone</dt>
        <dd>
          {c.phone}{' '}
          {c.customer && trustLink(c.customer.id)}
        </dd>
        <dt>Reply window</dt>
        <dd>{windowWords(c)}</dd>
        <dt>Assigned to</dt>
        <dd>
          {me?.role === 'MANAGER' ? (
            <span className="field-inline">
              <label htmlFor={assignId} className="sr-only">
                Assigned to
              </label>
              <select id={assignId} value={c.assignedTo?.id ?? ''} disabled={assign.isPending} onChange={(e) => assign.mutate(e.target.value || null)}>
                <option value="">Nobody</option>
                {answerers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.email}
                  </option>
                ))}
                {c.assignedTo && !answerers.some((s) => s.id === c.assignedTo?.id) && <option value={c.assignedTo.id}>{c.assignedTo.email ?? 'Staff'}</option>}
              </select>
            </span>
          ) : (
            (c.assignedTo?.email ?? 'Nobody')
          )}
        </dd>
        {c.handoffReason && (
          <>
            <dt>Why a person</dt>
            <dd>{c.handoffReason}</dd>
          </>
        )}
        <dt>Messages from us</dt>
        <dd>
          Order updates: {d.consent.updates === 'STOPPED' ? <Badge tone="warn">Stopped (customer sent STOP)</Badge> : 'allowed'} · Offers and reminders:{' '}
          {d.consent.marketing === 'OPTED_IN' ? 'opted in' : d.consent.marketing === 'OPTED_OUT' ? 'opted out' : 'not opted in'}
          <span className="block-actions">
            {d.consent.marketing !== 'OPTED_OUT' && (
              <button type="button" className="btn btn-small" onClick={() => setOptOut('marketing')}>
                Stop offers for this customer
              </button>
            )}
            {d.consent.updates !== 'STOPPED' && (
              <button type="button" className="btn btn-small" onClick={() => setOptOut('all')}>
                Stop all messages
              </button>
            )}
          </span>
        </dd>
        {d.recentOrders.length > 0 && (
          <>
            <dt>Recent orders</dt>
            <dd>
              <ul className="plain-list">
                {d.recentOrders.map((o) => (
                  <li key={o.id}>
                    <Link to={`/orders/${encodeURIComponent(o.id)}`}>{o.number}</Link> · {ORDER_STATUS_LABEL[o.status] ?? o.status} · for {o.deliveryDate} · {rupees(o.total)}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>

      <h2>Messages</h2>
      {d.messages.length === 0 ? (
        <EmptyState>No messages yet.</EmptyState>
      ) : (
        <ol className="wa-thread" aria-label="Messages">
          {d.messages.map((m) => (
            <MessageItem key={m.id} m={m} who={c.customer?.name ?? 'Customer'} onRetry={() => retry.mutate(m.id)} retrying={retry.isPending} canRetry={c.windowOpen} />
          ))}
        </ol>
      )}

      <form className="card" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor={replyId}>Reply on WhatsApp</label>
          <textarea
            id={replyId}
            rows={4}
            maxLength={REPLY_MAX}
            value={reply}
            disabled={!c.windowOpen}
            onChange={(e) => setReply(e.target.value)}
            aria-describedby={`${replyId}-hint`}
          />
          <p id={`${replyId}-hint`} className="hint">
            {c.windowOpen
              ? `${who} gets this on WhatsApp from MandiMangoes. ${reply.length}/${REPLY_MAX}. Replying takes the conversation over, so the bot stays quiet.`
              : 'More than 24 hours have passed since the customer last wrote, so WhatsApp only allows approved templates. Ask them to message us first (on a call, or through an order update).'}
          </p>
        </div>
        <FormError error={send.error} />
        <button type="submit" className="btn btn-primary" disabled={!c.windowOpen || !reply.trim() || send.isPending}>
          {send.isPending ? 'Sending…' : 'Send reply'}
        </button>
      </form>

      {optOut && (
        <ConfirmDialog
          title={optOut === 'all' ? 'Stop all WhatsApp messages?' : 'Stop offers and reminders?'}
          confirmLabel={optOut === 'all' ? 'Stop all messages' : 'Stop offers'}
          busy={recordOptOut.isPending}
          error={recordOptOut.error}
          onConfirm={() => recordOptOut.mutate(optOut)}
          onClose={() => setOptOut(null)}
        >
          <p>
            Only do this when {who} asked for it. {optOut === 'all' ? 'They will get no order updates on WhatsApp (the shop still shows them).' : 'They will still get updates about their own orders.'} Only the customer can turn
            messages back on, by sending START{optOut === 'marketing' ? ' OFFERS' : ''}.
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}

function trustLink(customerId: string) {
  return (
    <Link className="small" to={`/customers/${encodeURIComponent(customerId)}`}>
      Customer profile
    </Link>
  )
}

const STATUS_WORDS: Record<string, string> = {
  RECEIVED: '', QUEUED: 'Sending…', SENT: 'Sent', DELIVERED: 'Delivered', READ: 'Read', FAILED: 'Not delivered', UNKNOWN: 'No answer from WhatsApp',
}

function MessageItem({ m, who, onRetry, retrying, canRetry }: { m: WaMessage; who: string; onRetry: () => void; retrying: boolean; canRetry: boolean }) {
  const from = m.direction === 'IN' ? who : m.author.kind === 'staff' ? `MandiMangoes (${m.author.email ?? 'staff'})` : m.author.kind === 'system' ? 'Order update' : 'MandiMangoes bot'
  const failed = m.status === 'FAILED' || m.status === 'UNKNOWN'
  return (
    <li className={`card wa-message ${m.direction === 'IN' ? 'wa-in' : 'wa-out'}`}>
      <p className="small muted mb-0">
        {from} · {dateTime(m.createdAt)}
        {m.direction === 'OUT' && STATUS_WORDS[m.status] ? ` · ${STATUS_WORDS[m.status]}` : ''}
      </p>
      {m.media && <MediaPart m={m} />}
      {m.body ? <p className="pre-wrap mb-0">{m.body}</p> : !m.media && <p className="muted mb-0">({m.type === 'template' ? 'order update' : m.type})</p>}
      {failed && (
        <p className="small mb-0">
          <span className="text-bad">{m.status === 'UNKNOWN' ? 'WhatsApp did not answer in time, so it may have arrived. It was not sent again automatically.' : m.error}</span>{' '}
          {m.type !== 'template' && canRetry && (
            <button type="button" className="btn btn-small" disabled={retrying} onClick={onRetry}>
              Send again
            </button>
          )}
        </p>
      )}
    </li>
  )
}

function MediaPart({ m }: { m: WaMessage }) {
  const media = m.media!
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => () => {
    if (fileUrl) URL.revokeObjectURL(fileUrl)
  }, [fileUrl])
  if (media.location) return <p className="mb-0">Location: {[media.location.name, media.location.address].filter(Boolean).join(', ') || 'shared on the map'}</p>
  if (!media.canOpen) return <p className="muted mb-0">({media.kind})</p>
  if (media.kind === 'image' || media.kind === 'sticker') {
    return <AuthedPhoto load={() => api.waMediaUrl(m.id)} photoKey={m.id} alt={media.caption ?? 'Photo from the customer'} className="wa-photo" openInTab />
  }
  return (
    <p className="mb-0">
      {fileUrl ? (
        <a href={fileUrl} download={media.filename ?? undefined}>
          Save {media.filename ?? media.kind}
        </a>
      ) : (
        <button type="button" className="btn btn-small" onClick={() => api.waMediaUrl(m.id).then(setFileUrl, setError)}>
          Open {media.kind === 'audio' ? 'voice note' : (media.filename ?? media.kind)}
        </button>
      )}
      <FormError error={error} />
    </p>
  )
}

// ---------------------------------------------------------------- set-up and health (managers)

function Setup() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const overview = useQuery({ queryKey: ['wa-overview'], queryFn: api.waOverview })
  const failures = useQuery({ queryKey: ['wa-failures'], queryFn: api.waFailures })
  const { run, dialog } = useStepUp(STEP_UP_WHY)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['wa-overview'] })
    void queryClient.invalidateQueries({ queryKey: ['wa-failures'] })
  }
  const check = useMutation({ mutationFn: api.waCheck, onSuccess: (r) => (refresh(), r.ok ? toast.success('WhatsApp is connected.') : toast.error(new Error('The connection check found a problem: see below.'))), onError: (e) => toast.error(e) })
  const sync = useMutation({ mutationFn: api.waSyncTemplates, onSuccess: () => (refresh(), toast.success('Templates read from Meta.')), onError: (e) => toast.error(e) })
  const [busyKind, setBusyKind] = useState<string | null>(null)
  const toggle = useMutation({
    mutationFn: (a: WaAutomation) => run((code) => api.waSetAutomation(a.kind, !a.enabled, code)),
    onMutate: (a) => setBusyKind(a.kind),
    onSettled: () => setBusyKind(null),
    onSuccess: (_r, a) => (refresh(), toast.success(`${a.kind.toLowerCase().replace(/_/g, ' ')} is ${a.enabled ? 'off' : 'on'}`)),
    onError: (e) => toast.error(e),
  })
  const resend = useMutation({ mutationFn: api.retryMessage, onSuccess: () => (refresh(), toast.success('Queued to send again.')), onError: (e) => toast.error(e) })
  const resendChat = useMutation({ mutationFn: api.waRetryMessage, onSuccess: () => (refresh(), toast.success('Sending it again.')), onError: (e) => toast.error(e) })
  const replay = useMutation({
    mutationFn: api.waReplayEvent,
    onSuccess: (r) => (refresh(), r.ok ? toast.success('Processed.') : toast.error(new Error(r.error ?? 'Processing failed again'))),
    onError: (e) => toast.error(e),
  })

  if (overview.isPending) return <Spinner />
  if (overview.isError) return <QueryError error={overview.error} onRetry={() => overview.refetch()} />
  const o = overview.data
  return (
    <>
      <section className="card">
        <h2>Configuration</h2>
        <p className={o.readiness.complete ? 'muted' : ''}>
          {o.readiness.complete
            ? 'Everything WhatsApp needs is set. Run the connection check to see that it works.'
            : `Not ready: ${o.readiness.missing.length} required setting${o.readiness.missing.length === 1 ? ' is' : 's are'} missing. Until then messages are only written to the server log.`}
        </p>
        <ul className="plain-list">
          {o.readiness.items.map((i) => (
            <li key={i.key}>
              <Badge tone={i.ok ? 'good' : i.required ? 'bad' : 'neutral'}>{i.ok ? 'OK' : i.required ? 'Missing' : 'Optional'}</Badge> {i.label}: <span className="muted">{i.detail}</span>
            </li>
          ))}
        </ul>
        {o.webhookUrl && (
          <p className="small">
            Webhook address to give Meta: <code>{o.webhookUrl}</code>
          </p>
        )}
        <button type="button" className="btn btn-primary" disabled={check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? 'Checking…' : 'Check connection'}
        </button>
        {o.lastCheck && <ConnectionResult c={o.lastCheck} />}
      </section>

      <section className="card">
        <h2>Last 24 hours</h2>
        <Metrics m={o.metrics} />
      </section>

      <section className="card">
        <div className="topbar">
          <h2 className="mt-0">Automated messages</h2>
          <span className="spacer" />
          <button type="button" className="btn" disabled={sync.isPending} onClick={() => sync.mutate()}>
            {sync.isPending ? 'Reading…' : 'Read templates from Meta'}
          </button>
        </div>
        <p className="muted small">
          Each message is sent as one approved template in {o.templates.language}.{' '}
          {o.templates.lastSyncedAt ? `Templates last read ${dateTime(o.templates.lastSyncedAt)}.` : 'Templates have not been read from Meta yet.'} Turning one off asks for your password again
          and goes into the activity log.
        </p>
        <div {...scrollRegion('Automated WhatsApp messages', { cards: true })}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Message</th>
                <th scope="col">Template</th>
                <th scope="col">Sent when</th>
                <th scope="col">State</th>
                <th scope="col">Switch</th>
              </tr>
            </thead>
            <tbody>
              {o.templates.automations.map((a) => (
                <tr key={a.kind}>
                  <td data-label="Message">
                    {a.kind.toLowerCase().replace(/_/g, ' ')}
                    <span className="small muted"> · {a.category.toLowerCase()}{a.consent === 'marketing' ? ', needs opt-in' : ''}</span>
                  </td>
                  <td data-label="Template">
                    <code>{a.template}</code>
                    <span className="small muted"> ({a.params.length} variables)</span>
                  </td>
                  <td data-label="Sent when" className="small">
                    {a.trigger}
                  </td>
                  <td data-label="State">
                    <Badge tone={STATE_TONE[a.state]}>{STATE_LABEL[a.state]}</Badge>
                    {a.meta?.reason && <span className="small muted"> {a.meta.reason}</span>}
                    {a.state === 'VARIABLES_MISMATCH' && a.meta && <span className="small muted"> Meta has {a.meta.bodyParams}, we send {a.params.length}.</span>}
                  </td>
                  <td data-label="Switch">
                    <button type="button" className="btn btn-small" disabled={busyKind === a.kind} onClick={() => toggle.mutate(a)}>
                      {a.enabled ? 'Turn off' : 'Turn on'}
                      <span className="sr-only"> {a.kind.toLowerCase().replace(/_/g, ' ')}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>What failed (7 days)</h2>
        {failures.isPending ? (
          <Spinner />
        ) : failures.isError ? (
          <QueryError error={failures.error} onRetry={() => failures.refetch()} />
        ) : failures.data.updates.length + failures.data.messages.length + failures.data.events.length === 0 ? (
          <EmptyState>Nothing failed.</EmptyState>
        ) : (
          <>
            {failures.data.updates.length > 0 && (
              <>
                <h3>Order updates</h3>
                <ul className="plain-list">
                  {failures.data.updates.map((u) => (
                    <li key={u.id}>
                      {u.kind.toLowerCase().replace(/_/g, ' ')} {u.number ? `for ${u.number}` : ''} to {u.phone} · {dateTime(u.createdAt)}
                      <br />
                      <span className="small text-bad">{u.unknown ? 'WhatsApp did not answer in time, so it may have arrived. Check with the customer before sending again.' : u.error}</span>{' '}
                      <button type="button" className="btn btn-small" disabled={resend.isPending} onClick={() => resend.mutate(u.id)}>
                        Send again
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {failures.data.messages.length > 0 && (
              <>
                <h3>Chat and staff replies</h3>
                <ul className="plain-list">
                  {failures.data.messages.map((x) => (
                    <li key={x.id}>
                      <Link to={`/whatsapp/${encodeURIComponent(x.conversationId)}`}>Conversation with {x.phone}</Link> · {dateTime(x.createdAt)}
                      <br />
                      <span className="small text-bad">{x.error}</span>{' '}
                      <button type="button" className="btn btn-small" disabled={resendChat.isPending} onClick={() => resendChat.mutate(x.id)}>
                        Send again
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {failures.data.events.length > 0 && (
              <>
                <h3>Webhook events not processed</h3>
                <ul className="plain-list">
                  {failures.data.events.map((e) => (
                    <li key={e.id}>
                      Received {dateTime(e.receivedAt)} · {e.attempts} tries{e.gaveUp ? ' · given up' : ''}
                      {e.error && <span className="small text-bad"> {e.error}</span>}{' '}
                      <button type="button" className="btn btn-small" disabled={replay.isPending} onClick={() => replay.mutate(e.id)}>
                        Process again
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>Account and template events from Meta</h2>
        {o.health.length === 0 ? (
          <EmptyState>No events from Meta yet.</EmptyState>
        ) : (
          <ul className="plain-list">
            {o.health.map((h, i) => (
              <li key={`${h.at}-${i}`}>
                {dateTime(h.at)} · {h.field.replace(/_/g, ' ')}: <strong>{h.event ?? '—'}</strong>
                {typeof h.detail.message_template_name === 'string' && <span className="muted"> ({h.detail.message_template_name})</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {dialog}
    </>
  )
}

function ConnectionResult({ c }: { c: NonNullable<WaOverview['lastCheck']> }) {
  return (
    <div className="mt-4" data-testid="wa-check">
      <p className="mb-0">
        Last check {dateTime(c.at)}: {c.ok ? <Badge tone="good">Connected</Badge> : <Badge tone="bad">Problem</Badge>}
      </p>
      {c.phone && (
        <p className="small mb-0">
          Phone number:{' '}
          {c.phone.ok
            ? `${c.phone.number ?? ''} ${c.phone.name ? `(${c.phone.name})` : ''} · quality ${c.phone.quality ?? 'unknown'} · limit ${c.phone.limit ?? 'unknown'}${c.phone.nameStatus ? ` · name ${c.phone.nameStatus.toLowerCase()}` : ''}`
            : (PROBLEM_LABEL[c.phone.problem ?? 'error'] ?? c.phone.problem)}
        </p>
      )}
      {c.subscription && (
        <p className="small mb-0">
          Webhook subscription: {c.subscription.ok ? 'this app is subscribed' : c.subscription.problem ? (PROBLEM_LABEL[c.subscription.problem] ?? c.subscription.problem) : 'no app is subscribed to the account: Meta will not send messages here'}
        </p>
      )}
    </div>
  )
}

function Metrics({ m }: { m: WaOverview['metrics'] }) {
  const rows: [string, string | number][] = [
    ['Messages from customers', m.inbound],
    ['Bot and staff replies sent', m.replies],
    ['Order updates sent', m.updates_sent],
    ['Delivered / read', `${m.updates_delivered} / ${m.updates_read}`],
    ['Order updates failed', m.updates_failed],
    ['Order updates skipped (switch, consent, template)', m.updates_skipped],
    ['Chat replies failed', m.messages_failed],
    ['Chat replies waiting to send', m.messages_queued],
    ['Customers waiting for a person', m.waiting ? `${m.waiting} (oldest since ${dateTime(m.oldest_waiting)})` : 0],
    ['Numbers that sent STOP', m.stopped],
    ['Last webhook from Meta', m.last_webhook_at ? dateTime(m.last_webhook_at) : 'none yet'],
    ['Webhook events not processed', `${m.webhooks_unprocessed}${m.webhooks_given_up ? ` (${m.webhooks_given_up} given up)` : ''}`],
  ]
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </Fragment>
      ))}
    </dl>
  )
}
