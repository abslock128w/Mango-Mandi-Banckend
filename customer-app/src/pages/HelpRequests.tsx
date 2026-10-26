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
import { useT, type T } from '../i18n'
import type { Key } from '../i18n-core.ts'

const HELP_STATUS_LABEL: Record<HelpStatus, Key> = { OPEN: 'helpReq.status.open', WAITING_CUSTOMER: 'helpReq.status.waiting', RESOLVED: 'helpReq.status.resolved' }
const STATUS_TONE: Record<HelpStatus, string> = { OPEN: 'pill-info', WAITING_CUSTOMER: 'pill-warn', RESOLVED: 'pill-good' }

/** The API's topics (mango-api src/help.js), in the shop's language; a topic added later shows the API's own label. */
const TOPIC_LABEL: Record<string, Key> = {
  DELIVERY: 'helpReq.topic.delivery',
  PAYMENT: 'helpReq.topic.payment',
  CHANGE_ORDER: 'helpReq.topic.changeOrder',
  SUBSCRIPTION: 'helpReq.topic.subscription',
  ACCOUNT: 'helpReq.topic.account',
  OTHER: 'helpReq.topic.other',
}
const topicLabel = (t: T, id: string, label: string) => (Object.prototype.hasOwnProperty.call(TOPIC_LABEL, id) ? t(TOPIC_LABEL[id]) : label)

export function HelpStatusPill({ status }: { status: HelpStatus }) {
  const t = useT()
  return <span className={`pill ${STATUS_TONE[status]}`}>{t(HELP_STATUS_LABEL[status])}</span>
}

function Off() {
  const t = useT()
  return (
    <section className="card narrow">
      <h1>{t('helpReq.title')}</h1>
      <p>{t.rich('helpReq.off', { link: <Link to="/help">{t('nav.help')}</Link> })}</p>
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
  const t = useT()
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
  const topicError = tried && !topic ? t('helpReq.chooseTopic') : null
  const messageError = tried && message.trim().length < min ? t('helpReq.more', { min }) : null

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setTried(true)
    if (!topic || message.trim().length < min) return
    open.mutate()
  }

  return (
    <section className="card narrow" aria-labelledby={`${formId}-title`}>
      <h1 id={`${formId}-title`}>{orderId && order.data ? t('helpReq.askAbout', { number: order.data.number }) : t('title.helpRequests')}</h1>
      <p className="note">
        {orderId
          ? t.rich('helpReq.claimFirstOrder', { link: <Link to={`/orders/${encodeURIComponent(orderId)}/claim`}>{t('order.reportProblem')}</Link> })
          : t.rich('helpReq.claimFirst', { link: <Link to="/orders">{t('title.orders')}</Link> })}
      </p>
      {setup.isPending ? (
        <Spinner />
      ) : setup.isError ? (
        <ErrorNote error={setup.error} onRetry={() => setup.refetch()} />
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <Field id={`${formId}-topic`} label={t('helpReq.topicLabel')} error={topicError}>
            <select value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option value="">{t('helpReq.chooseOne')}</option>
              {setup.data.topics.map((tp) => (
                <option key={tp.id} value={tp.id}>
                  {topicLabel(t, tp.id, tp.label)}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${formId}-message`} label={t('helpReq.message')} hint={t('helpReq.messageHint', { length: message.length, max })} error={messageError}>
            <textarea rows={5} maxLength={max} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <ErrorNote error={open.error} />
          <button type="submit" className="btn btn-primary btn-block" disabled={open.isPending}>
            {open.isPending ? t('auth.sending') : t('helpReq.send')}
          </button>
        </form>
      )}
    </section>
  )
}

function MyRequests() {
  const q = useQuery({ queryKey: ['help-requests'], queryFn: api.helpRequests })
  const t = useT()
  return (
    <section className="card narrow" aria-labelledby="my-help-requests">
      <h2 id="my-help-requests">{t('helpReq.yours')}</h2>
      {q.isPending ? (
        <Spinner label={t('helpReq.loadingYours')} />
      ) : q.isError ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <p className="muted">{t('helpReq.empty')}</p>
      ) : (
        <ul className="plain-list help-list">
          {q.data.items.map((r) => (
            <li key={r.id}>
              <Link to={`/help/requests/${encodeURIComponent(r.id)}`}>
                <strong>{r.number}</strong> · {topicLabel(t, r.topic, r.topicLabel)}
                {r.order?.number ? ` · ${r.order.number}` : ''}
              </Link>{' '}
              <HelpStatusPill status={r.status} />
              {r.lastMessage && (
                <span className="muted small help-preview">
                  {r.lastMessage.from === 'You' ? t('helpReq.you') : r.lastMessage.from}: {r.lastMessage.preview}
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
  const t = useT()
  if (!care.helpCentre) return <Off />
  if (q.isPending) return <Spinner label={t('helpReq.loadingOne')} />
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  return <Thread r={q.data} />
}

function Thread({ r }: { r: HelpRequest }) {
  const queryClient = useQueryClient()
  const formId = useId()
  const [message, setMessage] = useState('')
  const t = useT()
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
      <DocTitle title={t('helpReq.question', { number: r.number })} />
      <Link to="/help/requests" className="back-link">
        ← {t('helpReq.yours')}
      </Link>
      <PageHeader title={<span id={`${formId}-title`}>{r.number}</span>}>
        <HelpStatusPill status={r.status} />
      </PageHeader>
      <p className="muted">
        {topicLabel(t, r.topic, r.topicLabel)}
        {r.order && (
          <>
            {' · '}
            <Link to={`/orders/${encodeURIComponent(r.order.id)}`}>{t('pay.description', { number: r.order.number ?? '' })}</Link>
          </>
        )}
      </p>
      {r.status === 'WAITING_CUSTOMER' && <p className="note">{t('helpReq.replied')}</p>}
      {r.status === 'RESOLVED' && <p className="note">{t('helpReq.resolved')}</p>}
      <ol className="help-thread" aria-label={t('helpReq.messages')}>
        {r.messages.map((m) => (
          <li key={m.id} className={m.from === 'MANDIMANGOES' ? 'help-msg help-msg-shop' : 'help-msg help-msg-you'}>
            <span className="small muted">
              {m.from === 'MANDIMANGOES' ? 'MandiMangoes' : t('helpReq.you')} · {when(m.at)}
            </span>
            <p className="pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
      <form onSubmit={onSubmit}>
        <Field id={`${formId}-reply`} label={t('helpReq.writeReply')}>
          <textarea rows={3} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <ErrorNote error={reply.error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={!message.trim() || reply.isPending}>
          {reply.isPending ? t('auth.sending') : t('helpReq.sendReply')}
        </button>
      </form>
    </section>
  )
}
