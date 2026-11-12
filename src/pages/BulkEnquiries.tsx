// Bulk enquiries (mango-api README, Bulk enquiries; BULK_ENQUIRIES): the shop's form for orders
// above 100 kg, for managers and operators. The list puts the newest first with a filter per
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
import { Plus, Trash2 } from 'lucide-react'
import { api } from '../api'
import { ApiError } from '../apiAnswer'
import { date, dateTime, rupees, ripenessLabel } from '../format'
import type { BulkEnquiryDetail, BulkEnquiryRow, BulkEnquiryStatus, BulkQuoteInput, Ripeness } from '../types'
import { BackLink, Badge, EmptyState, FormError, LinkRow, PhoneLink, QueryError, ReasonDialog, RowLink, Spinner, StatusFilter, scrollRegion, usePageTitle, useToast } from '../ui'

export const BULK_STATUS_LABEL: Record<BulkEnquiryStatus, string> = { NEW: 'New', QUOTED: 'Quoted', ACCEPTED: 'Accepted', DECLINED: 'Declined', CLOSED: 'Closed' }
const STATUSES: BulkEnquiryStatus[] = ['NEW', 'QUOTED', 'ACCEPTED', 'DECLINED', 'CLOSED']
const TONE: Record<BulkEnquiryStatus, 'warn' | 'info' | 'good' | 'bad' | 'neutral'> = { NEW: 'warn', QUOTED: 'info', ACCEPTED: 'good', DECLINED: 'bad', CLOSED: 'neutral' }
const EVENT_LABEL: Record<string, string> = { RECEIVED: 'Enquiry received', QUOTED: 'Quote sent', SEEN: 'Customer opened the quote', ACCEPTED: 'Customer accepted', DECLINED: 'Customer declined', NOTE: 'Note', CLOSED: 'Closed' }

/** Delivery on a bulk quote, as a share of the mangoes' value (the API's BULK_DELIVERY_PCT works out the real figure). */
const BULK_DELIVERY_PCT = 10

function StatusBadge({ status }: { status: BulkEnquiryStatus }) {
  return <Badge tone={TONE[status]}>{BULK_STATUS_LABEL[status]}</Badge>
}

const isOff = (err: unknown) => err instanceof ApiError && err.status === 404
const boxesWords = (n: number) => `${n} ${n === 1 ? 'box' : 'boxes'}`

export default function BulkEnquiries() {
  const { id } = useParams()
  usePageTitle(id ? 'Bulk enquiry' : 'Bulk enquiries')
  return id ? <EnquiryPage id={id} /> : <List />
}

// ---------------------------------------------------------------- the list

function List() {
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as BulkEnquiryStatus | null) || null
  const q = params.get('q') ?? ''
  const [search, setSearch] = useState(q)
  const searchId = useId()
  const list = useQuery({ queryKey: ['bulk-enquiries', status, q], queryFn: () => api.bulkEnquiries({ status, q }) })
  const queryClient = useQueryClient()
  // The live stream refreshes this list (shell/live.tsx); coming back to the tab does too.
  useEffect(() => {
    const again = () => void queryClient.invalidateQueries({ queryKey: ['bulk-enquiries'] })
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [queryClient])

  function set(next: { status?: BulkEnquiryStatus | null; q?: string }) {
    const merged = { status, q, ...next }
    const out: Record<string, string> = {}
    if (merged.status) out.status = merged.status
    if (merged.q) out.q = merged.q
    setParams(out)
  }
  function onSearch(e: FormEvent) {
    e.preventDefault()
    set({ q: search.trim() })
  }
  const c = list.data?.counts

  return (
    <>
      <div className="topbar">
        <h1>Bulk enquiries</h1>
      </div>
      <p className="muted">Enquiries over 100 kg from the shop’s Bulk page. Price one and send the quote: the customer gets it on WhatsApp and on their Account page.</p>
      {c && (
        <p className="small" data-testid="bulk-counts">
          {c.NEW} new · {c.QUOTED} quoted · {c.ACCEPTED} accepted · {c.DECLINED} declined · {c.CLOSED} closed
        </p>
      )}
      <StatusFilter value={status} options={STATUSES} labels={BULK_STATUS_LABEL} onChange={(s) => set({ status: s })} className="mb-4" />
      <form className="field mb-4" onSubmit={onSearch} role="search">
        <label htmlFor={searchId}>Number, name, business or phone</label>
        <div className="help-search">
          <input id={searchId} value={search} maxLength={60} placeholder="BLK-0012, Rao Caterers or 98765" onChange={(e) => setSearch(e.target.value)} />
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
        <EmptyState>{q || status ? 'No enquiries match.' : 'No bulk enquiries yet. They arrive here from the shop’s Bulk page.'}</EmptyState>
      ) : (
        <div {...scrollRegion('Bulk enquiries', { cards: true })}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Enquiry</th>
                <th scope="col">Received</th>
                <th scope="col">Customer</th>
                <th scope="col" className="num">
                  Quantity
                </th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Quote
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
    </>
  )
}

function Row({ r }: { r: BulkEnquiryRow }) {
  return (
    <LinkRow>
      <td data-label="Enquiry">
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
        {r.kind === 'ORDER' && (
          <>
            {' '}
            <Badge tone="info">Direct order</Badge>
          </>
        )}
      </td>
      <td data-label="Quantity" className="num">
        {r.quantityKg} kg{r.boxes ? <span className="muted"> · {boxesWords(r.boxes)}</span> : null}
      </td>
      <td data-label="Status">
        <StatusBadge status={r.status} />
        {r.status === 'QUOTED' && <span className="small muted"> {r.quoteSeenAt ? 'seen' : 'not opened yet'}</span>}
      </td>
      <td data-label="Quote" className="num">
        {r.total != null ? rupees(r.total) : '—'}
      </td>
    </LinkRow>
  )
}

// ---------------------------------------------------------------- one enquiry

function EnquiryPage({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['bulk-enquiry', id], queryFn: () => api.bulkEnquiry(id) })
  return (
    <>
      <BackLink to="/bulk-enquiries">Bulk enquiries</BackLink>
      {q.isPending ? <Spinner /> : q.isError ? <QueryError error={q.error} onRetry={() => q.refetch()} /> : <Enquiry e={q.data} />}
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
  usePageTitle(`Bulk enquiry ${e.number}`)

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
        {e.kind === 'ORDER' && <Badge tone="info">Direct order</Badge>}
        <span className="spacer" />
        {e.status !== 'CLOSED' && (
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

      <div className="grid-2">
        <section>
          <div className="card">
            <h2>What they asked for</h2>
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
                    </tr>
                  </thead>
                  <tbody>
                    {e.lines.map((l) => (
                      <tr key={`${l.sku}|${l.stage}|${l.packKg ?? ''}`}>
                        <td>{l.name}</td>
                        <td>{ripenessLabel(l.stage)}</td>
                        <td className="num">{l.boxes}</td>
                        <td className="num">{l.kg}</td>
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

          {e.status === 'CLOSED' ? (
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
    return e.lines.map((l) => ({ key: nextKey(), label: `${l.name} · ${ripenessLabel(l.stage)}`, sku: l.sku, stage: l.stage, qty: String(l.boxes), price: fromPaise(l.listPrice) }))
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
      <p className="small muted">Prices start from the shop’s price per box. Change them for this customer; totals are checked again when you send.</p>

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
