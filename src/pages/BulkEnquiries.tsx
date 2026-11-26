// Bulk orders and enquiries (mango-api README, Bulk orders; BULK_ENQUIRIES), for managers and operators.
// Bulk orders (100 kg or more) are placed and paid at once in the shop at bulk prices: the list puts the
// paid ones still to deliver first, with what was paid, the payment and any refund; one opens with its
// lines at the bulk prices paid, the steps ("Called customer", Dispatched, Delivered) and a manager's
// Cancel and refund (step-up). Enquiries (250 kg or more) wait for a quote. The list has a filter per
// status and a search; an enquiry opens with the customer, what they asked for, and the quote
// builder: one line per requested box (its catalogue price to start from), extra costs such as
// special packaging, a note and a valid-until date. Totals here are a preview; the API works
// them out again. Sending queues the WhatsApp quote (mandi_bulk_quote) and shows it on the
// customer's Account page; the WhatsApp status shows below, with an Open in WhatsApp link that
// carries the quote written out, for when the template is not approved yet or the send failed.
// Money is in paise in the API and in rupees in the inputs.
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Plus, Trash2 } from 'lucide-react'
import { api } from '../api'
import { ApiError } from '../apiAnswer'
import { date, dateTime, rupees, ripenessLabel } from '../format'
import { useSession } from '../session'
import { MONEY_CHANGE_WHY, useStepUp } from '../StepUp'
import type { BulkEnquiryDetail, BulkEnquiryRow, BulkEnquiryStatus, BulkKind, BulkQuoteInput, Ripeness } from '../types'
import {
  BackLink, Badge, Dialog, EmptyState, FormError, LinkRow, PhoneLink, QueryError, ReasonDialog, RowLink, Spinner, StatusFilter, Tabs, scrollRegion, tabPanelProps,
  usePageTitle, useToast,
} from '../ui'

export const BULK_STATUS_LABEL: Record<BulkEnquiryStatus, string> = {
  NEW: 'New', QUOTED: 'Quoted', ACCEPTED: 'Accepted', DECLINED: 'Declined', CLOSED: 'Closed',
  PAYMENT_PENDING: 'Awaiting payment', PAID: 'Paid · call the customer', CONFIRMED: 'Called · arranged', DISPATCHED: 'Dispatched', DELIVERED: 'Delivered', CANCELLED: 'Cancelled',
  CONTACTED: 'Called', VISIT_PLANNED: 'Visit planned', VISITED: 'Visited',
}
/** A farm visit enquiry's own words for its statuses. */
const FARM_STATUS_LABEL: Partial<Record<BulkEnquiryStatus, string>> = { NEW: 'New · call them', CONTACTED: 'Called', VISIT_PLANNED: 'Visit planned', VISITED: 'Visited', CLOSED: 'Closed' }
/** The page's lists: everything, paid orders, enquiries, farm visit enquiries (?kind=). */
type ListTab = 'ALL' | BulkKind
const STATUSES_FOR: Record<ListTab, BulkEnquiryStatus[]> = {
  ALL: [],
  ORDER: ['PAID', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'PAYMENT_PENDING', 'CANCELLED', 'NEW', 'CLOSED'],
  ENQUIRY: ['NEW', 'QUOTED', 'ACCEPTED', 'DECLINED', 'CLOSED'],
  FARM_VISIT: ['NEW', 'CONTACTED', 'VISIT_PLANNED', 'VISITED', 'CLOSED'],
}
const STATUSES: BulkEnquiryStatus[] = ['PAID', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'PAYMENT_PENDING', 'CANCELLED', 'NEW', 'QUOTED', 'ACCEPTED', 'DECLINED', 'CLOSED']
const TONE: Record<BulkEnquiryStatus, 'warn' | 'info' | 'good' | 'bad' | 'neutral'> = {
  NEW: 'warn', QUOTED: 'info', ACCEPTED: 'good', DECLINED: 'bad', CLOSED: 'neutral',
  PAYMENT_PENDING: 'neutral', PAID: 'warn', CONFIRMED: 'info', DISPATCHED: 'info', DELIVERED: 'good', CANCELLED: 'neutral',
  CONTACTED: 'info', VISIT_PLANNED: 'good', VISITED: 'good',
}
const EVENT_LABEL: Record<string, string> = {
  RECEIVED: 'Received', QUOTED: 'Quote sent', SEEN: 'Customer opened the quote', ACCEPTED: 'Customer accepted', DECLINED: 'Customer declined', NOTE: 'Note', CLOSED: 'Closed',
  PAID: 'Paid in full', CONFIRMED: 'Called the customer', DISPATCHED: 'Dispatched', DELIVERED: 'Delivered', CANCELLED: 'Cancelled', REFUNDED: 'Refund sent',
  VISIT_PLANNED: 'Visit planned', VISITED: 'Visited', CONTACTED: 'Called the customer',
  EXPIRED: 'Not paid in time', LINK_REPLACED: 'Customer opened it to pay again', DUPLICATE_PAYMENT: 'A second payment came in (refunded)', REFUND_GAVE_UP: 'Refund needs a manager',
}
const REFUND_LABEL: Record<string, string> = { REFUND_DUE: 'Refund due', REFUND_SENT: 'Refund sent', REFUNDED: 'Refunded', NEEDS_MANAGER: 'Refund needs a manager' }
/** The next step a paid order can take, with its button. */
const NEXT_STEP: Partial<Record<BulkEnquiryStatus, { to: 'CONFIRMED' | 'DISPATCHED' | 'DELIVERED'; label: string }>> = {
  PAID: { to: 'CONFIRMED', label: 'Called customer' },
  CONFIRMED: { to: 'DISPATCHED', label: 'Mark dispatched' },
  DISPATCHED: { to: 'DELIVERED', label: 'Mark delivered' },
}
const isPaidOrder = (e: BulkEnquiryRow) => e.kind === 'ORDER' && Boolean(e.paid)

/** Delivery on a bulk quote, as a share of the mangoes' value (the API's BULK_DELIVERY_PCT works out the real figure). */
const BULK_DELIVERY_PCT = 10

function StatusBadge({ status, kind }: { status: BulkEnquiryStatus; kind?: BulkKind }) {
  return <Badge tone={TONE[status]}>{(kind === 'FARM_VISIT' && FARM_STATUS_LABEL[status]) || BULK_STATUS_LABEL[status]}</Badge>
}

const isOff = (err: unknown) => err instanceof ApiError && err.status === 404
const boxesWords = (n: number) => `${n} ${n === 1 ? 'box' : 'boxes'}`

export default function BulkEnquiries() {
  const { id } = useParams()
  usePageTitle(id ? 'Bulk order' : 'Bulk orders and enquiries')
  return id ? <EnquiryPage id={id} /> : <List />
}

// ---------------------------------------------------------------- the list

function List() {
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as BulkEnquiryStatus | null) || null
  const q = params.get('q') ?? ''
  const tab = ((['ORDER', 'ENQUIRY', 'FARM_VISIT'] as const).find((k) => k === params.get('kind')) ?? 'ALL') as ListTab
  const kind = tab === 'ALL' ? null : tab
  const [search, setSearch] = useState(q)
  const searchId = useId()
  const list = useQuery({ queryKey: ['bulk-enquiries', status, q, kind], queryFn: () => api.bulkEnquiries({ status, q, kind }) })
  const queryClient = useQueryClient()
  // The live stream refreshes this list (shell/live.tsx); coming back to the tab does too.
  useEffect(() => {
    const again = () => void queryClient.invalidateQueries({ queryKey: ['bulk-enquiries'] })
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [queryClient])

  function set(next: { status?: BulkEnquiryStatus | null; q?: string; kind?: ListTab }) {
    const merged = { status, q, kind: tab as ListTab, ...next }
    const out: Record<string, string> = {}
    if (merged.kind !== 'ALL') out.kind = merged.kind
    if (merged.status) out.status = merged.status
    if (merged.q) out.q = merged.q
    setParams(out)
  }
  const k = list.data?.kinds
  const tabs: [ListTab, string][] = [
    ['ALL', 'All'],
    ['ORDER', `Paid orders${k?.ORDER?.PAID ? ` (${k.ORDER.PAID} to call)` : ''}`],
    ['ENQUIRY', `Enquiries${k?.ENQUIRY?.NEW ? ` (${k.ENQUIRY.NEW} new)` : ''}`],
    ['FARM_VISIT', `Farm visits${k?.FARM_VISIT?.NEW ? ` (${k.FARM_VISIT.NEW} new)` : ''}`],
  ]
  const farm = tab === 'FARM_VISIT'
  function onSearch(e: FormEvent) {
    e.preventDefault()
    set({ q: search.trim() })
  }
  const c = list.data?.counts

  return (
    <>
      <div className="topbar">
        <h1>Bulk orders and enquiries</h1>
      </div>
      <p className="muted">
        Bulk orders (100 kg or more) are paid in full in the shop at bulk prices: call each customer on WhatsApp to arrange the delivery, then mark it dispatched and delivered. Enquiries (250 kg or more) wait for your quote: the customer gets it on WhatsApp and on their Account page.
      </p>
      <div className="bulk-list-tabs">
        <Tabs id="bulk-lists" label="Bulk orders, enquiries and farm visit enquiries" tabs={tabs} value={tab} onChange={(t) => set({ kind: t, status: null })} />
      </div>
      {tab === 'ALL' && c && (
        <p className="small" data-testid="bulk-counts">
          Orders: {c.PAID ?? 0} paid to call · {c.CONFIRMED ?? 0} arranged · {c.DISPATCHED ?? 0} dispatched · {c.DELIVERED ?? 0} delivered · {c.PAYMENT_PENDING ?? 0} awaiting payment · {c.CANCELLED ?? 0} cancelled.
          {' '}Enquiries: {c.NEW} new · {c.QUOTED} quoted · {c.ACCEPTED} accepted · {c.DECLINED} declined · {c.CLOSED} closed
        </p>
      )}
      <div {...tabPanelProps('bulk-lists', tab)}>
      {farm && (
        <p className="muted small"><strong>Farm visit enquiries</strong> from the shop’s Farm visit tab (250 kg or more). Call each one on WhatsApp, then mark it called, plan the visit date, and mark it visited or close it with a reason.</p>
      )}
      <StatusFilter
        value={status}
        options={tab === 'ALL' ? STATUSES : STATUSES_FOR[tab]}
        labels={farm ? ({ ...BULK_STATUS_LABEL, ...FARM_STATUS_LABEL } as Record<BulkEnquiryStatus, string>) : BULK_STATUS_LABEL}
        onChange={(s) => set({ status: s })}
        className="mb-4"
      />
      <form className="field mb-4" onSubmit={onSearch} role="search">
        <label htmlFor={searchId}>Number, name, business or phone</label>
        <div className="help-search">
          <input id={searchId} value={search} maxLength={60} placeholder="B-743 406 080, Rao Caterers or 98765" onChange={(e) => setSearch(e.target.value)} />
          <button type="submit" className="btn">
            Find
          </button>
        </div>
      </form>

      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        isOff(list.error) ? (
          <EmptyState>Bulk enquiries are switched off (BULK_ENQUIRIES on the API), or this API does not have them yet.</EmptyState>
        ) : (
          <QueryError error={list.error} onRetry={() => list.refetch()} />
        )
      ) : list.data.items.length === 0 ? (
        <EmptyState>{q || status ? 'Nothing matches.' : farm ? 'No farm visit enquiries yet. They arrive here from the Farm visit tab on the shop’s Bulk page.' : 'Nothing here yet. Bulk orders and enquiries arrive here from the shop’s Bulk page.'}</EmptyState>
      ) : farm ? (
        <div {...scrollRegion('Farm visit enquiries', { cards: true })}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Name and mobile</th>
                <th scope="col">Mango</th>
                <th scope="col" className="num">kg</th>
                <th scope="col">Visit dates</th>
                <th scope="col" className="num">People</th>
                <th scope="col">Sent</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((r) => (
                <FarmRow key={r.id} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div {...scrollRegion('Bulk orders and enquiries', { cards: true })}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Received</th>
                <th scope="col">Customer</th>
                <th scope="col" className="num">
                  Quantity
                </th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Paid or quoted
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((r) => (
                <Row key={r.id} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </>
  )
}

/** "Sat, 12 Dec" from YYYY-MM-DD. */
const dayWords = (d: string | null | undefined) => (d ? date(d) : '')
/** The visit dates they asked for: "Thu 26 – Fri 27 Nov, 2 days" (the API's words), one date on an older enquiry, else Flexible. */
const visitAsked = (f: BulkEnquiryRow['farmVisit']) => f?.visitWords ?? (f?.preferredDate ? dayWords(f.preferredDate) : 'Flexible')

function FarmRow({ r }: { r: BulkEnquiryRow }) {
  const f = r.farmVisit
  return (
    <LinkRow>
      <td data-label="Number">
        <RowLink to={`/bulk-enquiries/${encodeURIComponent(r.id)}`} more={`, ${r.name}`}>
          {r.number}
        </RowLink>
      </td>
      <td data-label="Name and mobile">
        {r.name} <span className="muted">· {r.city}</span>
        <div className="small">
          <PhoneLink phone={r.phone} who={r.name} /> ·{' '}
          <a href={`https://wa.me/${waNumber(r.phone)}`} target="_blank" rel="noopener noreferrer">
            WhatsApp<span className="sr-only"> {r.name}</span>
          </a>
        </div>
      </td>
      <td data-label="Mango">{f?.variety ?? <span className="muted">Not sure yet</span>}</td>
      <td data-label="kg" className="num">{f?.kg ?? r.quantityKg}</td>
      <td data-label="Visit dates">{f?.plannedDate ? <strong>Planned {dayWords(f.plannedDate)}</strong> : visitAsked(f)}</td>
      <td data-label="People" className="num">{f?.people ?? '—'}</td>
      <td data-label="Sent">{dateTime(r.createdAt)}</td>
      <td data-label="Status">
        <StatusBadge status={r.status} kind="FARM_VISIT" />
      </td>
    </LinkRow>
  )
}

function Row({ r }: { r: BulkEnquiryRow }) {
  return (
    <LinkRow>
      <td data-label="Number">
        <RowLink to={`/bulk-enquiries/${encodeURIComponent(r.id)}`} more={`, ${r.business ?? r.name}`}>
          {r.number}
        </RowLink>
      </td>
      <td data-label="Received">{dateTime(r.createdAt)}</td>
      <td data-label="Customer">
        {r.business ? (
          <>
            {r.business} <span className="muted">· {r.name}</span>
          </>
        ) : (
          r.name
        )}
        <span className="muted"> · {r.city}</span>
        {' '}
        {isPaidOrder(r) ? <Badge tone="info">Bulk order</Badge> : r.kind === 'ORDER' ? <Badge tone="neutral">Old unpaid order</Badge> : r.kind === 'FARM_VISIT' ? <Badge tone="good">Farm visit</Badge> : <Badge tone="neutral">Enquiry</Badge>}
      </td>
      <td data-label="Quantity" className="num">
        {r.quantityKg} kg{r.boxes ? <span className="muted"> · {boxesWords(r.boxes)}</span> : null}
      </td>
      <td data-label="Status">
        <StatusBadge status={r.status} kind={r.kind} />
        {r.status === 'QUOTED' && <span className="small muted"> {r.quoteSeenAt ? 'seen' : 'not opened yet'}</span>}
      </td>
      <td data-label="Paid or quoted" className="num">
        {isPaidOrder(r) ? (
          r.paymentStatus === 'SUCCEEDED' || r.paymentStatus === 'REFUNDED' ? (
            <>
              {rupees(r.paidAmount ?? r.total)} <span className="small muted">paid</span>
            </>
          ) : (
            <span className="muted">{rupees(r.total)} not paid</span>
          )
        ) : r.total != null ? (
          rupees(r.total)
        ) : (
          '—'
        )}
        {r.refundStatus && (
          <>
            {' '}
            <Badge tone={r.refundStatus === 'NEEDS_MANAGER' ? 'bad' : 'neutral'}>{REFUND_LABEL[r.refundStatus]}</Badge>
          </>
        )}
      </td>
    </LinkRow>
  )
}

// ---------------------------------------------------------------- one enquiry

function EnquiryPage({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['bulk-enquiry', id], queryFn: () => api.bulkEnquiry(id) })
  return (
    <>
      <BackLink to="/bulk-enquiries">Bulk orders and enquiries</BackLink>
      {q.isPending ? <Spinner /> : q.isError ? <QueryError error={q.error} onRetry={() => q.refetch()} /> : q.data.kind === 'FARM_VISIT' ? <FarmVisit e={q.data} /> : <Enquiry e={q.data} />}
    </>
  )
}

/** "+919876543210" → "919876543210" for wa.me. */
const waNumber = (phone: string) => phone.replace(/\D/g, '')

function Enquiry({ e }: { e: BulkEnquiryDetail }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [closing, setClosing] = useState(false)
  const paidOrder = isPaidOrder(e)
  usePageTitle(`${paidOrder ? 'Bulk order' : 'Bulk enquiry'} ${e.number}`)

  function saved(next: BulkEnquiryDetail) {
    queryClient.setQueryData(['bulk-enquiry', e.id], next)
    void queryClient.invalidateQueries({ queryKey: ['bulk-enquiries'] })
  }
  const close = useMutation({
    mutationFn: (reason: string) => api.closeBulkEnquiry(e.id, reason),
    onSuccess: (next) => {
      saved(next)
      setClosing(false)
      toast.success(`${e.number} closed`)
      navigate('/bulk-enquiries')
    },
    onError: (err) => toast.error(err),
  })

  const lastQuoteMessage = e.messages.find((m) => m.kind === 'BULK_QUOTE')
  const quoteHref = e.quoteText ? `https://wa.me/${waNumber(e.phone)}?text=${encodeURIComponent(e.quoteText)}` : `https://wa.me/${waNumber(e.phone)}`

  return (
    <>
      <div className="topbar">
        <h1>{e.number}</h1>
        <StatusBadge status={e.status} />
        {paidOrder ? <Badge tone="info">Bulk order · paid online</Badge> : e.kind === 'ORDER' ? <Badge tone="neutral">Old unpaid order</Badge> : <Badge tone="neutral">Enquiry</Badge>}
        <span className="spacer" />
        {!paidOrder && e.status !== 'CLOSED' && (
          <button type="button" className="btn" disabled={close.isPending} onClick={() => setClosing(true)}>
            Close enquiry
          </button>
        )}
      </div>

      {(e.status === 'ACCEPTED' || e.status === 'DECLINED') && (
        <div className={`notice ${e.status === 'ACCEPTED' ? 'notice-info' : 'notice-warn'} bq-answer`} role="status">
          <strong>
            {e.status === 'ACCEPTED' ? 'The customer accepted the quote' : 'The customer declined the quote'}
            {e.quote ? ` of ${rupees(e.quote.total)}` : ''}
          </strong>
          {e.respondedAt && <span> · {dateTime(e.respondedAt)}</span>}
          {e.customerMessage && <p className="pre-wrap mb-0">“{e.customerMessage}”</p>}
          {e.status === 'ACCEPTED' && <p className="mb-0">Call them to arrange the delivery day and payment.</p>}
        </div>
      )}

      {paidOrder && <OrderActions e={e} onSaved={saved} />}

      <div className="grid-2">
        <section>
          <div className="card">
            <h2>{paidOrder ? 'What they ordered' : 'What they asked for'}</h2>
            {e.lines.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Box</th>
                      <th scope="col">Ripeness</th>
                      <th scope="col" className="num">
                        Boxes
                      </th>
                      <th scope="col" className="num">
                        kg
                      </th>
                      <th scope="col" className="num">
                        {paidOrder ? 'Bulk price paid' : 'Bulk price today'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.lines.map((l) => (
                      <tr key={`${l.sku}|${l.stage}|${l.packKg ?? ''}`}>
                        <td>{l.name}</td>
                        <td>{ripenessLabel(l.stage)}</td>
                        <td className="num">{l.boxes}</td>
                        <td className="num">{l.kg}</td>
                        <td className="num">
                          {paidOrder && l.unitPrice != null ? rupees(l.unitPrice) : l.bulkPrice != null ? rupees(l.bulkPrice) : '—'}
                          {l.listPrice != null && <span className="small muted"> · shop {rupees(paidOrder && l.shopUnitPrice != null ? l.shopUnitPrice : l.listPrice)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={2}>
                        Total
                      </th>
                      <td className="num">{e.boxes}</td>
                      <td className="num">{e.quantityKg}</td>
                      <td className="num">{paidOrder && e.order ? rupees(e.order.mangoesPaise) : ''}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="mb-0">
                <strong>{e.quantityKg} kg</strong>
                {e.ripeness ? `, ${e.ripeness.toLowerCase()}` : ''} (typed in, no box list)
              </p>
            )}
            {e.notes && (
              <>
                <h3 className="small muted mb-0">Their note</h3>
                <p className="pre-wrap">{e.notes}</p>
              </>
            )}
          </div>

          {paidOrder ? null : e.status === 'CLOSED' ? (
            <div className="card">
              <h2>Quote</h2>
              <p className="mb-0 muted">This enquiry is closed{e.closedAt ? ` (${dateTime(e.closedAt)})` : ''}. {e.quote ? `The last quote was ${rupees(e.quote.total)}.` : ''}</p>
            </div>
          ) : (
            <QuoteBuilder key={e.quotedAt ?? 'new'} e={e} onSaved={saved} />
          )}
        </section>

        <section>
          <div className="card">
            <h2>Customer</h2>
            <dl className="kv">
              <dt>Name</dt>
              <dd>{e.name}</dd>
              {e.business && (
                <>
                  <dt>Business</dt>
                  <dd>{e.business}</dd>
                </>
              )}
              <dt>Phone</dt>
              <dd>
                <PhoneLink phone={e.phone} who={e.name} />
                {' · '}
                <a href={`https://wa.me/${waNumber(e.phone)}`} target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
              </dd>
              {e.email && (
                <>
                  <dt>Email</dt>
                  <dd>
                    <a href={`mailto:${e.email}`}>{e.email}</a>
                  </dd>
                </>
              )}
              <dt>Delivery city</dt>
              <dd>{e.city}</dd>
              {e.deliveryAddress && (
                <>
                  <dt>Delivery address</dt>
                  <dd className="pre-wrap">
                    {e.deliveryAddress}
                    {e.pincode ? ` · ${e.pincode}` : ''}
                  </dd>
                </>
              )}
              <dt>Received</dt>
              <dd>{dateTime(e.createdAt)}</dd>
              <dt>Account</dt>
              <dd>{e.customerId ? 'Sent signed in' : 'Sent without signing in (shows on their account once they sign in with this number)'}</dd>
            </dl>
          </div>

          {e.quote && (
            <div className="card" data-testid="bulk-whatsapp">
              <h2>WhatsApp</h2>
              {lastQuoteMessage ? (
                <MessageStatus m={lastQuoteMessage} />
              ) : (
                <p className="small">{e.whatsappOn ? 'No quote message queued.' : 'WhatsApp quotes are off (WHATSAPP_BULK_UPDATES): send it yourself with the link below.'}</p>
              )}
              <p className="small muted">The customer also sees the quote on their Account page in the shop{e.quoteSeenAt ? `, and opened it ${dateTime(e.quoteSeenAt)}` : ' (not opened yet)'}.</p>
              <a className="btn" href={quoteHref} target="_blank" rel="noopener noreferrer">
                Open in WhatsApp
              </a>
              <p className="hint">Opens WhatsApp on this device with the quote written out, for when the automatic message failed or isn’t approved yet.</p>
            </div>
          )}

          <Notes e={e} onSaved={saved} />

          <div className="card">
            <h2>History</h2>
            <ol className="bq-events">
              {e.events
                .slice()
                .reverse()
                .map((v) => (
                  <li key={v.id}>
                    <strong>{EVENT_LABEL[v.type] ?? v.type}</strong>
                    {v.type === 'QUOTED' && typeof v.detail?.total === 'number' ? ` · ${rupees(v.detail.total)}` : ''}
                    <span className="small muted">
                      {' '}
                      · {dateTime(v.at)} · {v.actor === 'customer' ? 'customer' : v.actor === 'system' ? 'shop' : v.actor}
                    </span>
                    {typeof v.detail?.text === 'string' && <p className="pre-wrap mb-0">{v.detail.text}</p>}
                    {typeof v.detail?.message === 'string' && <p className="pre-wrap mb-0">“{v.detail.message}”</p>}
                    {typeof v.detail?.reason === 'string' && <p className="pre-wrap mb-0">{v.detail.reason}</p>}
                    {typeof v.detail?.note === 'string' && <p className="pre-wrap mb-0">{v.detail.note}</p>}
                    {v.type === 'PAID' && typeof v.detail?.amount === 'number' ? <span className="small"> · {rupees(v.detail.amount)}</span> : null}
                  </li>
                ))}
            </ol>
          </div>
        </section>
      </div>

      {closing && (
        <ReasonDialog
          title={`Close ${e.number}?`}
          label="Why (kept in the history)"
          confirmLabel="Close enquiry"
          hint="Optional."
          minLength={0}
          maxLength={500}
          tone="primary"
          busy={close.isPending}
          error={close.error}
          onSubmit={(reason) => close.mutate(reason)}
          onClose={() => setClosing(false)}
        />
      )}
    </>
  )
}

function MessageStatus({ m }: { m: BulkEnquiryDetail['messages'][number] }) {
  const label =
    m.status === 'SENT'
      ? m.deliveryStatus === 'logged'
        ? 'Sent (logged only: no WhatsApp provider on this API)'
        : m.deliveryStatus
          ? `Sent · ${m.deliveryStatus}`
          : 'Sent'
      : m.status === 'PENDING'
        ? 'Queued'
        : m.status === 'SKIPPED'
          ? 'Not sent'
          : 'Failed'
  const tone = m.status === 'SENT' ? 'good' : m.status === 'PENDING' ? 'info' : 'bad'
  return (
    <p data-testid="bulk-wa-status">
      Quote {m.round ? `#${m.round} ` : ''}message: <Badge tone={tone}>{label}</Badge>
      {m.sentAt && <span className="small muted"> {dateTime(m.sentAt)}</span>}
      {m.error && <span className="small text-bad"> {m.error}</span>}
    </p>
  )
}

// ---------------------------------------------------------------- quote builder

interface Draft {
  key: string
  label: string
  sku?: string
  stage?: Ripeness
  qty: string
  /** Rupees, as typed. */
  price: string
}
interface Extra {
  key: string
  label: string
  amount: string
}

const toPaise = (rupeesText: string) => Math.round(Number(rupeesText || 0) * 100)
const fromPaise = (paise: number | null | undefined) => (paise == null ? '' : String(paise / 100))
let seq = 0
const nextKey = () => `k${++seq}`
/** 14 days from today, the default validity. */
const inTwoWeeks = () => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)

function startingLines(e: BulkEnquiryDetail): Draft[] {
  if (e.quote) return e.quote.lines.map((l) => ({ key: nextKey(), label: l.label, sku: l.sku, stage: l.stage, qty: String(l.qty), price: fromPaise(l.unitPrice) }))
  if (e.lines.length)
    return e.lines.map((l) => ({ key: nextKey(), label: `${l.name} · ${ripenessLabel(l.stage)}`, sku: l.sku, stage: l.stage, qty: String(l.boxes), price: fromPaise(l.bulkPrice ?? l.listPrice) }))
  return [{ key: nextKey(), label: `Mangoes${e.ripeness ? `, ${e.ripeness.toLowerCase()}` : ''} (per kg)`, qty: String(e.quantityKg), price: '' }]
}

function QuoteBuilder({ e, onSaved }: { e: BulkEnquiryDetail; onSaved: (next: BulkEnquiryDetail) => void }) {
  const toast = useToast()
  const uid = useId()
  const [lines, setLines] = useState<Draft[]>(() => startingLines(e))
  const [extras, setExtras] = useState<Extra[]>(() => (e.quote?.extras ?? []).map((x) => ({ key: nextKey(), label: x.label, amount: fromPaise(x.amount) })))
  const [note, setNote] = useState(e.quote?.note ?? '')
  const [validUntil, setValidUntil] = useState(e.quote?.validUntil ?? inTwoWeeks())

  const totals = useMemo(() => {
    const subtotal = lines.reduce((t, l) => t + (Number(l.qty) || 0) * toPaise(l.price), 0)
    const extrasTotal = extras.reduce((t, x) => t + toPaise(x.amount), 0)
    const deliveryFee = Math.round((subtotal * BULK_DELIVERY_PCT) / 100)
    return { subtotal, extrasTotal, deliveryFee, total: subtotal + extrasTotal + deliveryFee }
  }, [lines, extras])

  const problem = (() => {
    if (!lines.length) return 'Add at least one line.'
    if (lines.some((l) => !l.label.trim())) return 'Name every line.'
    if (lines.some((l) => !(Number(l.qty) >= 1) || !Number.isInteger(Number(l.qty)))) return 'Each line needs a whole-number quantity.'
    if (lines.some((l) => l.price === '' || !(Number(l.price) >= 0))) return 'Each line needs a unit price.'
    if (extras.some((x) => !x.label.trim() || x.amount === '' || !(Number(x.amount) >= 0))) return 'Each extra cost needs a name and an amount (or remove it).'
    return null
  })()

  const send = useMutation({
    mutationFn: () => {
      const body: BulkQuoteInput = {
        lines: lines.map((l) => ({ label: l.label.trim(), ...(l.sku ? { sku: l.sku } : {}), ...(l.stage ? { stage: l.stage } : {}), qty: Number(l.qty), unitPrice: toPaise(l.price) })),
        extras: extras.map((x) => ({ label: x.label.trim(), amount: toPaise(x.amount) })),
        note: note.trim() || null,
        validUntil: validUntil || null,
      }
      return api.quoteBulkEnquiry(e.id, body)
    },
    onSuccess: (next) => {
      onSaved(next)
      const m = next.messages.find((x) => x.kind === 'BULK_QUOTE')
      toast.success(`Quote of ${rupees(next.quote?.total)} sent for ${e.number}${m?.status === 'FAILED' ? ', but WhatsApp failed: use Open in WhatsApp' : ''}.`)
    },
  })

  const setLine = (key: string, patch: Partial<Draft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const setExtra = (key: string, patch: Partial<Extra>) => setExtras((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)))

  function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    if (!problem) send.mutate()
  }

  return (
    <form className="card bq" onSubmit={onSubmit} aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`}>{e.quote ? 'Quote (send again to replace it)' : 'Quote builder'}</h2>
      <p className="small muted">Prices start from today’s bulk price per box (what a bulk order costs in the shop). Your quote can be lower: change them for this customer. Totals are checked again when you send.</p>

      <h3 className="bq-sub">Lines</h3>
      <div className="bq-rows">
        {lines.map((l, i) => (
          <div className="bq-row" key={l.key}>
            <div className="field bq-label">
              <label htmlFor={`${uid}-l${i}`}>Item</label>
              <input id={`${uid}-l${i}`} value={l.label} maxLength={120} onChange={(ev) => setLine(l.key, { label: ev.target.value })} />
            </div>
            <div className="field bq-qty">
              <label htmlFor={`${uid}-q${i}`}>Qty</label>
              <input id={`${uid}-q${i}`} inputMode="numeric" type="number" min={1} step={1} value={l.qty} onChange={(ev) => setLine(l.key, { qty: ev.target.value })} />
            </div>
            <div className="field bq-money">
              <label htmlFor={`${uid}-p${i}`}>Unit price (₹)</label>
              <input id={`${uid}-p${i}`} inputMode="decimal" type="number" min={0} step="0.01" value={l.price} onChange={(ev) => setLine(l.key, { price: ev.target.value })} />
            </div>
            <p className="bq-line-total num" aria-label={`Line total for ${l.label || 'this line'}`}>
              {rupees((Number(l.qty) || 0) * toPaise(l.price))}
            </p>
            <button type="button" className="btn btn-icon" aria-label={`Remove ${l.label || 'this line'}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-small" onClick={() => setLines((ls) => [...ls, { key: nextKey(), label: '', qty: '1', price: '' }])}>
        <Plus size={16} aria-hidden="true" /> Add line
      </button>

      <h3 className="bq-sub">Extras</h3>
      {extras.length === 0 && <p className="small muted">Special packaging, branding: anything on top of the mangoes. Delivery is added by itself, at 10% of the mangoes.</p>}
      <div className="bq-rows">
        {extras.map((x, i) => (
          <div className="bq-row bq-extra" key={x.key}>
            <div className="field bq-label">
              <label htmlFor={`${uid}-x${i}`}>Extra cost</label>
              <input id={`${uid}-x${i}`} value={x.label} maxLength={80} placeholder="Special packaging" onChange={(ev) => setExtra(x.key, { label: ev.target.value })} />
            </div>
            <div className="field bq-money">
              <label htmlFor={`${uid}-a${i}`}>Amount (₹)</label>
              <input id={`${uid}-a${i}`} inputMode="decimal" type="number" min={0} step="0.01" value={x.amount} onChange={(ev) => setExtra(x.key, { amount: ev.target.value })} />
            </div>
            <button type="button" className="btn btn-icon" aria-label={`Remove ${x.label || 'this extra cost'}`} onClick={() => setExtras((xs) => xs.filter((y) => y.key !== x.key))}>
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-small" onClick={() => setExtras((xs) => [...xs, { key: nextKey(), label: '', amount: '' }])}>
        <Plus size={16} aria-hidden="true" /> Add extra cost
      </button>

      <div className="field-row bq-meta">
        <div className="field">
          <label htmlFor={`${uid}-v`}>Valid until</label>
          <input id={`${uid}-v`} type="date" value={validUntil} onChange={(ev) => setValidUntil(ev.target.value)} />
        </div>
        <div className="field bq-note">
          <label htmlFor={`${uid}-n`}>Note to the customer</label>
          <textarea id={`${uid}-n`} rows={2} maxLength={1000} value={note} placeholder="Delivery in two trips; price includes loading" onChange={(ev) => setNote(ev.target.value)} />
        </div>
      </div>

      <dl className="bq-totals" aria-live="polite">
        <dt>Subtotal</dt>
        <dd className="num">{rupees(totals.subtotal)}</dd>
        <dt>Extras</dt>
        <dd className="num">{rupees(totals.extrasTotal)}</dd>
        <dt>Delivery ({BULK_DELIVERY_PCT}% of the mangoes)</dt>
        <dd className="num">{rupees(totals.deliveryFee)}</dd>
        <dt className="bq-grand">Total</dt>
        <dd className="num bq-grand">{rupees(totals.total)}</dd>
      </dl>
      {problem && <p className="hint">{problem}</p>}
      <FormError error={send.error} />
      <button type="submit" className="btn btn-primary" disabled={!!problem || send.isPending}>
        {send.isPending ? 'Sending…' : e.quote ? 'Send new quote on WhatsApp' : 'Send quote on WhatsApp'}
      </button>
      {e.quote && (
        <p className="hint">
          Last sent {dateTime(e.quotedAt)}
          {e.quotedByEmail ? ` by ${e.quotedByEmail}` : ''}: {rupees(e.quote.total)}
          {e.quote.validUntil ? `, valid until ${date(e.quote.validUntil)}` : ''}. A new quote replaces it.
        </p>
      )}
    </form>
  )
}

function Notes({ e, onSaved }: { e: BulkEnquiryDetail; onSaved: (next: BulkEnquiryDetail) => void }) {
  const id = useId()
  const [text, setText] = useState('')
  const add = useMutation({
    mutationFn: () => api.noteBulkEnquiry(e.id, text.trim()),
    onSuccess: (next) => {
      onSaved(next)
      setText('')
    },
  })
  return (
    <form
      className="card"
      onSubmit={(ev) => {
        ev.preventDefault()
        if (text.trim()) add.mutate()
      }}
    >
      <div className="field">
        <label htmlFor={id}>Staff note</label>
        <textarea id={id} rows={2} maxLength={1000} value={text} onChange={(ev) => setText(ev.target.value)} />
        <p className="hint">Only staff see notes.</p>
      </div>
      <FormError error={add.error} />
      <button type="submit" className="btn" disabled={!text.trim() || add.isPending}>
        Add note
      </button>
    </form>
  )
}

// ---------------------------------------------------------------- a paid bulk order

/** What was paid and how, the next step, and a manager's cancel with a full refund. */
function OrderActions({ e, onSaved }: { e: BulkEnquiryDetail; onSaved: (next: BulkEnquiryDetail) => void }) {
  const toast = useToast()
  const { me } = useSession()
  const manager = me?.role === 'MANAGER'
  const stepUp = useStepUp(MONEY_CHANGE_WHY)
  const [cancelling, setCancelling] = useState(false)
  const o = e.order
  const next = NEXT_STEP[e.status]
  const move = useMutation({
    mutationFn: (to: 'CONFIRMED' | 'DISPATCHED' | 'DELIVERED') => api.moveBulkOrder(e.id, to),
    onSuccess: (d) => {
      onSaved(d)
      toast.success(`${e.number}: ${BULK_STATUS_LABEL[d.status]}`)
    },
    onError: (err) => toast.error(err),
  })
  const cancel = useMutation({
    mutationFn: (reason: string) => stepUp.run((code) => api.cancelBulkOrder(e.id, reason, code)),
    onSuccess: (d) => {
      onSaved(d)
      setCancelling(false)
      toast.success(d.paymentStatus === 'REFUNDED' || d.order?.refund ? `${e.number} cancelled; the full refund is on its way` : `${e.number} cancelled`)
    },
  })
  if (!o) return null
  const paid = o.paymentStatus === 'SUCCEEDED' || o.paymentStatus === 'REFUNDED'
  const cantCancelWhy = e.status === 'CANCELLED' ? 'Already cancelled.' : !manager ? 'Only a manager can cancel a paid bulk order (it refunds it in full).' : null
  return (
    <div className="card" data-testid="bulk-order-panel">
      <h2>Payment and delivery</h2>
      <dl className="kv">
        <dt>Mangoes at bulk prices</dt>
        <dd>
          {rupees(o.mangoesPaise)}
          {o.savingPaise ? <span className="small muted"> · saves {rupees(o.savingPaise)} on shop prices</span> : null}
        </dd>
        <dt>Delivery ({o.deliveryPct}% of the mangoes)</dt>
        <dd>{rupees(o.deliveryPaise)}</dd>
        <dt>Total</dt>
        <dd>
          <strong>{rupees(o.amountPaise)}</strong>
        </dd>
        <dt>Payment</dt>
        <dd>
          {paid ? (
            <>
              <Badge tone="good">Paid {rupees(o.paidPaise ?? o.amountPaise)}</Badge>
              {o.paidAt && <span className="small muted"> {dateTime(o.paidAt)}</span>}
              {e.paymentId && <span className="small muted"> · {e.paymentMethod ? `${e.paymentMethod}, ` : ''}{e.paymentId}</span>}
            </>
          ) : e.status === 'PAYMENT_PENDING' ? (
            <Badge tone="neutral">Waiting for payment{o.payBy ? ` until ${dateTime(o.payBy)}` : ''}</Badge>
          ) : (
            <Badge tone="neutral">Not paid</Badge>
          )}
        </dd>
        {o.refund && (
          <>
            <dt>Refund</dt>
            <dd>
              <Badge tone={o.refund.gaveUp ? 'bad' : 'neutral'}>
                {o.refund.gaveUp ? 'Failed after its retries: settle it from Needs attention or Razorpay' : o.refund.refundedAt ? `Sent ${dateTime(o.refund.refundedAt)}${o.refund.status === 'processed' ? ', processed' : ''}` : 'Due: going out with the next refund run'}
              </Badge>
              {e.refundId && <span className="small muted"> {e.refundId}</span>}
            </dd>
          </>
        )}
        {e.status === 'CANCELLED' && (
          <>
            <dt>Cancelled</dt>
            <dd>
              {o.cancelledBy === 'customer' ? 'By the customer' : o.cancelledBy === 'shop' ? 'By the shop' : 'Not paid in time'}
              {o.cancelledAt ? ` · ${dateTime(o.cancelledAt)}` : ''}
              {e.cancelReason && o.cancelledBy === 'shop' ? ` · ${e.cancelReason}` : ''}
            </dd>
          </>
        )}
        {paid && e.status !== 'CANCELLED' && (
          <>
            <dt>Customer may cancel</dt>
            <dd>{o.canCancel && o.cancelUntil ? `Until ${dateTime(o.cancelUntil)} (${o.cancelHours} hours after paying, before dispatch)` : 'No longer (the window closed or it is dispatched)'}</dd>
          </>
        )}
      </dl>
      <div className="farm-actions" style={{ marginTop: 14 }}>
        {next && (
          <button type="button" className="btn btn-primary" disabled={move.isPending} onClick={() => move.mutate(next.to)}>
            {move.isPending ? 'Saving…' : next.label}
          </button>
        )}
        {e.status !== 'CANCELLED' && e.status !== 'PAYMENT_PENDING' && !next && e.status === 'DELIVERED' && <p className="small muted mb-0">Delivered {o.deliveredAt ? dateTime(o.deliveredAt) : ''}.</p>}
        {e.status !== 'CANCELLED' && (
          <button type="button" className="btn" disabled={Boolean(cantCancelWhy) || cancel.isPending} aria-describedby={cantCancelWhy ? `cancel-why-${e.id}` : undefined} onClick={() => setCancelling(true)}>
            {cantCancelWhy && <Lock size={14} aria-hidden="true" />} {paid ? 'Cancel and refund' : 'Cancel order'}
          </button>
        )}
      </div>
      {e.status === 'PAID' && <p className="small mb-0">Call the customer on WhatsApp to arrange the delivery day (usually 3–5 days), then press Called customer.</p>}
      {cantCancelWhy && e.status !== 'CANCELLED' && (
        <p className="small muted mb-0" id={`cancel-why-${e.id}`}>
          <Lock size={12} aria-hidden="true" /> {cantCancelWhy}
        </p>
      )}
      {cancelling && (
        <ReasonDialog
          title={paid ? `Cancel ${e.number} and refund ${rupees(o.paidPaise ?? o.amountPaise)}?` : `Cancel ${e.number}?`}
          label="Why (kept in the history; not shown to the customer)"
          confirmLabel={paid ? 'Cancel and refund in full' : 'Cancel order'}
          hint={paid ? 'The full amount goes back to the customer through Razorpay. You will be asked to confirm it is you.' : 'Nothing was paid, so nothing is refunded.'}
          minLength={3}
          maxLength={500}
          tone="danger"
          busy={cancel.isPending}
          error={cancel.error}
          onSubmit={(reason) => cancel.mutate(reason)}
          onClose={() => setCancelling(false)}
        />
      )}
      {stepUp.dialog}
    </div>
  )
}

// ---------------------------------------------------------------- a farm visit enquiry

const todayISO = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)

/** Every field, the history, staff notes and the big plain steps: Called customer, Visit planned, Visited, Close. */
function FarmVisit({ e }: { e: BulkEnquiryDetail }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [asking, setAsking] = useState<null | 'plan' | 'close'>(null)
  const [day, setDay] = useState(e.farmVisit?.plannedDate ?? e.farmVisit?.preferredDate ?? '')
  const f = e.farmVisit
  usePageTitle(`Farm visit enquiry ${e.number}`)
  function saved(next: BulkEnquiryDetail) {
    queryClient.setQueryData(['bulk-enquiry', e.id], next)
    void queryClient.invalidateQueries({ queryKey: ['bulk-enquiries'] })
    void queryClient.invalidateQueries({ queryKey: ['attention'] })
  }
  const move = useMutation({
    mutationFn: (v: { to: 'CONTACTED' | 'VISIT_PLANNED' | 'VISITED'; date?: string }) => api.moveFarmVisit(e.id, v.to, v.date),
    onSuccess: (next) => {
      saved(next)
      setAsking(null)
      toast.success(`${e.number}: ${FARM_STATUS_LABEL[next.status] ?? next.status}`)
    },
  })
  const close = useMutation({
    mutationFn: (reason: string) => api.closeBulkEnquiry(e.id, reason),
    onSuccess: (next) => {
      saved(next)
      setAsking(null)
      toast.success(`${e.number} closed`)
    },
  })
  const open = e.status !== 'CLOSED' && e.status !== 'VISITED'
  return (
    <>
      <div className="topbar">
        <h1>{e.number}</h1>
        <StatusBadge status={e.status} kind="FARM_VISIT" />
        <Badge tone="good">Farm visit enquiry</Badge>
      </div>
      <div className="card" data-testid="farm-visit-actions">
        <h2>Next step</h2>
        <p className="mb-0">
          {e.status === 'NEW'
            ? 'Call the customer on WhatsApp to plan the visit, then press Called customer.'
            : e.status === 'CONTACTED'
              ? 'Agree a visit date with the customer, then press Visit planned.'
              : e.status === 'VISIT_PLANNED'
                ? `The visit is planned for ${dayWords(f?.plannedDate)}. After it, press Visited.`
                : e.status === 'VISITED'
                  ? `Visited${f?.visitedAt ? ` (marked ${dateTime(f.visitedAt)})` : ''}.`
                  : `Closed${f?.closeReason ? `: ${f.closeReason}` : ''}.`}
        </p>
        <div className="farm-actions" style={{ marginTop: 14 }}>
          {e.status === 'NEW' && (
            <button type="button" className="btn btn-primary btn-lg" disabled={move.isPending} onClick={() => move.mutate({ to: 'CONTACTED' })}>
              Called customer
            </button>
          )}
          {['NEW', 'CONTACTED', 'VISIT_PLANNED'].includes(e.status) && (
            <button type="button" className={`btn btn-lg${e.status === 'CONTACTED' ? ' btn-primary' : ''}`} onClick={() => setAsking('plan')}>
              {e.status === 'VISIT_PLANNED' ? 'Change visit date' : 'Visit planned'}
            </button>
          )}
          {e.status === 'VISIT_PLANNED' && (
            <button type="button" className="btn btn-primary btn-lg" disabled={move.isPending} onClick={() => move.mutate({ to: 'VISITED' })}>
              Visited
            </button>
          )}
          {open && (
            <button type="button" className="btn btn-lg" onClick={() => setAsking('close')}>
              Close
            </button>
          )}
        </div>
        <FormError error={move.error} />
      </div>
      <div className="grid-2">
        <section className="card">
          <h2>What they asked for</h2>
          <dl className="kv">
            <dt>Mango</dt>
            <dd>{f?.variety ?? 'Not sure yet'}</dd>
            <dt>About how many kg</dt>
            <dd>{f?.kg ?? e.quantityKg} kg</dd>
            <dt>Visit dates</dt>
            <dd>{visitAsked(f)}{f?.preferredDate && f.flexible ? ' (flexible)' : ''}</dd>
            <dt>People coming</dt>
            <dd>{f?.people ?? '—'}</dd>
            {f?.plannedDate && (
              <>
                <dt>Visit planned for</dt>
                <dd>
                  <strong>{dayWords(f.plannedDate)}</strong>
                </dd>
              </>
            )}
            {e.notes && (
              <>
                <dt>Their note</dt>
                <dd className="pre-wrap">{e.notes}</dd>
              </>
            )}
          </dl>
        </section>
        <section className="card">
          <h2>Customer</h2>
          <dl className="kv">
            <dt>Name</dt>
            <dd>{e.name}</dd>
            <dt>Mobile</dt>
            <dd>
              <PhoneLink phone={e.phone} who={e.name} />
              {' · '}
              <a href={`https://wa.me/${waNumber(e.phone)}`} target="_blank" rel="noopener noreferrer">
                WhatsApp
              </a>
            </dd>
            {f?.altPhone && (
              <>
                <dt>Another number</dt>
                <dd>
                  <PhoneLink phone={f.altPhone} who={e.name} />
                </dd>
              </>
            )}
            {f && (
              <>
                <dt>Language to speak</dt>
                <dd>{f.preferredLanguage ?? 'No preference given'}</dd>
              </>
            )}
            <dt>City</dt>
            <dd>{e.city}</dd>
            <dt>Sent</dt>
            <dd>{dateTime(e.createdAt)}</dd>
            <dt>Account</dt>
            <dd>{e.customerId ? 'Sent signed in' : 'Sent without signing in (shows on their account once they sign in with this number)'}</dd>
          </dl>
        </section>
      </div>
      <div className="grid-2">
        <Notes e={e} onSaved={saved} />
        <div className="card">
          <h2>History</h2>
          <ol className="bq-events">
            {e.events
              .slice()
              .reverse()
              .map((v) => (
                <li key={v.id}>
                  <strong>{v.type === 'RECEIVED' ? 'Enquiry received' : (EVENT_LABEL[v.type] ?? v.type)}</strong>
                  {v.type === 'VISIT_PLANNED' && typeof v.detail?.date === 'string' ? ` · for ${dayWords(v.detail.date)}` : ''}
                  <span className="small muted">
                    {' '}
                    · {dateTime(v.at)} · {v.actor === 'customer' ? 'customer' : v.actor === 'system' ? 'shop' : v.actor}
                  </span>
                  {typeof v.detail?.text === 'string' && <p className="pre-wrap mb-0">{v.detail.text}</p>}
                  {typeof v.detail?.reason === 'string' && <p className="pre-wrap mb-0">{v.detail.reason}</p>}
                </li>
              ))}
          </ol>
        </div>
      </div>
      {asking === 'plan' && (
        <Dialog
          title={`Visit planned: ${e.number}`}
          onClose={() => setAsking(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setAsking(null)}>
                Cancel
              </button>
              <button type="submit" form="farm-plan-form" className="btn btn-primary" disabled={!day || day < todayISO() || move.isPending}>
                {move.isPending ? 'Saving…' : 'Save visit date'}
              </button>
            </>
          }
        >
          <form
            id="farm-plan-form"
            onSubmit={(ev) => {
              ev.preventDefault()
              if (day && day >= todayISO()) move.mutate({ to: 'VISIT_PLANNED', date: day })
            }}
          >
            <div className="field">
              <label htmlFor="farm-plan-date">The visit date agreed with the customer</label>
              <input id="farm-plan-date" type="date" min={todayISO()} value={day} onChange={(ev) => setDay(ev.target.value)} />
              <p className="hint">{day && day < todayISO() ? 'That date has passed: choose today or later.' : 'Kept on the enquiry and shown to the customer on their account.'}</p>
            </div>
            <FormError error={move.error} />
          </form>
        </Dialog>
      )}
      {asking === 'close' && (
        <ReasonDialog
          title={`Close ${e.number}?`}
          label="Why (shown to the customer on their account)"
          confirmLabel="Close enquiry"
          hint="For example: chose another farm, could not reach them, visit not possible this season."
          minLength={3}
          maxLength={500}
          tone="primary"
          busy={close.isPending}
          error={close.error}
          onSubmit={(reason) => close.mutate(reason)}
          onClose={() => setAsking(null)}
        />
      )}
    </>
  )
}
