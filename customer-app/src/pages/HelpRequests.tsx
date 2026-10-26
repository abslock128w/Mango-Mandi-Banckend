// The help centre (docs/care.md, HELP_CENTRE): a signed-in customer asks a
// question about an order (from its page) or in general (from /help), picks a
// topic and writes a message, then follows the status and the replies in one
// thread. The API checks everything: whose request it is, the topic, the
// lengths and how many a day. Damaged or missing mangoes are not a topic here:
// they are reported from the order, where the claim flow puts them right with
// a replacement.
import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type HelpRequest, type HelpStatus } from '../api'
import { useCare } from '../features'
import { when } from '../format'
import { Field } from '../forms'
import { DocTitle, ErrorNote, PageHeader, Spinner } from '../ui'

export const HELP_STATUS_LABEL: Record<HelpStatus, string> = { OPEN: 'Open', WAITING_CUSTOMER: 'Waiting for you', RESOLVED: 'Resolved' }
const STATUS_TONE: Record<HelpStatus, string> = { OPEN: 'pill-info', WAITING_CUSTOMER: 'pill-warn', RESOLVED: 'pill-good' }

export function HelpStatusPill({ status }: { status: HelpStatus }) {
  return <span className={`pill ${STATUS_TONE[status]}`}>{HELP_STATUS_LABEL[status]}</span>
}

function Off() {
  return (
    <section className="card narrow">
      <h1>Help requests</h1>
      <p>
        Asking us from the shop isn't open yet. See <Link to="/help">Help</Link> for how to reach us.
      </p>
    </section>
  )
}

/** /help/requests: the customer's requests and the form for a new one (?order=<id> ties it to an order). */
export default function HelpRequests() {
  const care = useCare()
  const [params] = useSearchParams()
  const orderId = params.get('order')
  if (!care.helpCentre) return <Off />
  return (
    <>
      <NewRequest orderId={orderId} />
      <MyRequests />
    </>
  )
}

function NewRequest({ orderId }: { orderId: string | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const formId = useId()
  const setup = useQuery({ queryKey: ['help-setup'], queryFn: api.helpSetup, staleTime: 5 * 60_000 })
  const order = useQuery({ queryKey: ['order', orderId], queryFn: () => api.order(orderId!), enabled: !!orderId })
  const [topic, setTopic] = useState('')
  const [message, setMessage] = useState('')
  const [tried, setTried] = useState(false)
  const open = useMutation({
    mutationFn: () => api.openHelpRequest({ topic, orderId: orderId && order.data ? orderId : null, message: message.trim() }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['help-requests'] })
      queryClient.setQueryData(['help-request', r.id], r)
      navigate(`/help/requests/${encodeURIComponent(r.id)}`)
    },
  })
  const min = setup.data?.firstMessageMin ?? 5
  const max = setup.data?.messageMax ?? 2000
  const topicError = tried && !topic ? 'Choose what it is about' : null
  const messageError = tried && message.trim().length < min ? `Tell us a little more (${min} characters or more)` : null

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setTried(true)
    if (!topic || message.trim().length < min) return
    open.mutate()
  }

  return (
    <section className="card narrow" aria-labelledby={`${formId}-title`}>
      <h1 id={`${formId}-title`}>{orderId && order.data ? `Ask about order ${order.data.number}` : 'Ask us a question'}</h1>
      <p className="note">
        Mangoes damaged, spoilt, wrong or missing?{' '}
        {orderId ? (
          <Link to={`/orders/${encodeURIComponent(orderId)}/claim`}>Report a problem with this order</Link>
        ) : (
          <>
            Report it from the order in <Link to="/orders">My orders</Link>
          </>
        )}{' '}
        and we'll send a replacement if we can. That is quicker than a question here.
      </p>
      {setup.isPending ? (
        <Spinner label="Loading" />
      ) : setup.isError ? (
        <ErrorNote error={setup.error} onRetry={() => setup.refetch()} />
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <Field id={`${formId}-topic`} label="What is it about?" error={topicError}>
            <select value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option value="">Choose one</option>
              {setup.data.topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${formId}-message`} label="Your message" hint={`${message.length}/${max}. We reply here; you can add to it any time.`} error={messageError}>
            <textarea rows={5} maxLength={max} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <ErrorNote error={open.error} />
          <button type="submit" className="btn btn-primary btn-block" disabled={open.isPending}>
            {open.isPending ? 'Sending…' : 'Send'}
          </button>
        </form>
      )}
    </section>
  )
}

function MyRequests() {
  const q = useQuery({ queryKey: ['help-requests'], queryFn: api.helpRequests })
  return (
    <section className="card narrow" aria-labelledby="my-help-requests">
      <h2 id="my-help-requests">Your questions</h2>
      {q.isPending ? (
        <Spinner label="Loading your questions" />
      ) : q.isError ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <p className="muted">Questions you send us are kept here with our replies.</p>
      ) : (
        <ul className="plain-list help-list">
          {q.data.items.map((r) => (
            <li key={r.id}>
              <Link to={`/help/requests/${encodeURIComponent(r.id)}`}>
                <strong>{r.number}</strong> · {r.topicLabel}
                {r.order?.number ? ` · ${r.order.number}` : ''}
              </Link>{' '}
              <HelpStatusPill status={r.status} />
              {r.lastMessage && (
                <span className="muted small help-preview">
                  {r.lastMessage.from}: {r.lastMessage.preview}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** /help/requests/:id: the thread, its status and a reply box. */
export function HelpRequestPage() {
  const { id = '' } = useParams()
  const care = useCare()
  const q = useQuery({ queryKey: ['help-request', id], queryFn: () => api.helpRequest(id), enabled: care.helpCentre })
  if (!care.helpCentre) return <Off />
  if (q.isPending) return <Spinner label="Loading your question" />
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  return <Thread r={q.data} />
}

function Thread({ r }: { r: HelpRequest }) {
  const queryClient = useQueryClient()
  const formId = useId()
  const [message, setMessage] = useState('')
  const reply = useMutation({
    mutationFn: () => api.replyHelpRequest(r.id, message.trim()),
    onSuccess: (next) => {
      queryClient.setQueryData(['help-request', r.id], next)
      queryClient.invalidateQueries({ queryKey: ['help-requests'] })
      setMessage('')
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (message.trim()) reply.mutate()
  }

  return (
    <section className="card narrow" aria-labelledby={`${formId}-title`}>
      <DocTitle title={`Question ${r.number}`} />
      <Link to="/help/requests" className="back-link">
        ← Your questions
      </Link>
      <PageHeader title={<span id={`${formId}-title`}>{r.number}</span>}>
        <HelpStatusPill status={r.status} />
      </PageHeader>
      <p className="muted">
        {r.topicLabel}
        {r.order && (
          <>
            {' · '}
            <Link to={`/orders/${encodeURIComponent(r.order.id)}`}>Order {r.order.number}</Link>
          </>
        )}
      </p>
      {r.status === 'WAITING_CUSTOMER' && <p className="note">We replied. Tell us if that sorted it, or if you need anything else.</p>}
      {r.status === 'RESOLVED' && <p className="note">We have marked this resolved. Write again below if you still need help, and it opens again.</p>}
      <ol className="help-thread" aria-label="Messages">
        {r.messages.map((m) => (
          <li key={m.id} className={m.from === 'MANDIMANGOES' ? 'help-msg help-msg-shop' : 'help-msg help-msg-you'}>
            <span className="small muted">
              {m.from === 'MANDIMANGOES' ? 'MandiMangoes' : 'You'} · {when(m.at)}
            </span>
            <p className="pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
      <form onSubmit={onSubmit}>
        <Field id={`${formId}-reply`} label="Write a reply">
          <textarea rows={3} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <ErrorNote error={reply.error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={!message.trim() || reply.isPending}>
          {reply.isPending ? 'Sending…' : 'Send reply'}
        </button>
      </form>
    </section>
  )
}
