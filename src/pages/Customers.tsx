// Customer profiles (docs/trust.md): find a customer by mobile number, and
// one page with their orders, claims, reviews, ratings, saved addresses and
// consent settings. Managers and operators only, while profiles are switched
// on. The API records every search, view and reveal in the activity log, and
// sends the phone number masked to its last 4 digits until someone reveals it.
import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ApiError, api } from '../api'
import { CLAIM_STATUS_LABEL, ISSUE_LABEL, RESOLUTION_LABEL, date, dateTime, rupees } from '../format'
import { trustAllowed } from '../permissions'
import { useSession } from '../session'
import type { CustomerMatch, CustomerProfile } from '../types'
import {
  BackLink,
  Badge,
  ClaimBadge,
  EmptyState,
  FormError,
  LinkRow,
  OrderBadge,
  PhoneLink,
  QueryError,
  RowLink,
  Spinner,
  scrollRegion,
  usePageTitle,
} from '../ui'
import NotFound from './NotFound'

const REVIEW_STATUS_LABEL: Record<string, string> = { PENDING: 'Waiting for review', APPROVED: 'Published', REJECTED: 'Rejected', HIDDEN: 'Hidden' }

/** /customers: find a customer by mobile number. */
export default function Customers() {
  const { me } = useSession()
  usePageTitle('Find a customer')
  const [phone, setPhone] = useState('')
  const search = useMutation({ mutationFn: (p: string) => api.findCustomers(p) })
  if (!trustAllowed(me, 'customerProfiles')) return <NotFound notAllowed />

  function submit(e: FormEvent) {
    e.preventDefault()
    if (phone.trim()) search.mutate(phone.trim())
  }

  return (
    <>
      <div className="topbar">
        <h1>Find a customer</h1>
      </div>
      <form className="card" onSubmit={submit} aria-labelledby="find-h">
        <h2 id="find-h" className="sr-only">
          Search by mobile number
        </h2>
        <div className="field-inline">
          <div className="field field-grow">
            <label htmlFor="find-phone">Mobile number</label>
            <input
              id="find-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-describedby="find-hint"
              required
            />
          </div>
          <div className="field">
            <button type="submit" className="btn btn-primary" disabled={search.isPending}>
              {search.isPending ? 'Searching…' : 'Find'}
            </button>
          </div>
        </div>
        <p id="find-hint" className="muted small">
          The full 10-digit number. Each search is recorded in the activity log.
        </p>
        <FormError error={search.error} />
      </form>
      {search.data && <Matches items={search.data.items} />}
    </>
  )
}

function Matches({ items }: { items: CustomerMatch[] }) {
  if (!items.length) return <EmptyState>No customer has that number.</EmptyState>
  return (
    <section className="card" aria-labelledby="found-h">
      <h2 id="found-h">Found</h2>
      <ul className="bare-list">
        {items.map((c) => (
          <li key={c.id} className="match">
            <Link to={`/customers/${encodeURIComponent(c.id)}`} className="match-link">
              <strong>{c.name ?? 'No name given'}</strong> <span className="mono">{c.phoneMasked}</span>
            </Link>
            <div className="muted small">
              {c.orders} {c.orders === 1 ? 'order' : 'orders'}
              {c.lastOrderAt ? `, last on ${date(c.lastOrderAt)}` : ''} · customer since {date(c.createdAt)}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** /customers/:id: the profile. Opening it is recorded in the activity log by the API. */
export function CustomerProfilePage() {
  const { me } = useSession()
  const { id = '' } = useParams()
  const allowed = trustAllowed(me, 'customerProfiles')
  // Every opening of a profile is a view the API must record, so the profile is never shown from a
  // cache: fetched on each mount, dropped on leaving, and not refetched just because the tab regained focus.
  const q = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.customer(id),
    enabled: allowed,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  })
  usePageTitle(q.data ? (q.data.name ?? 'Customer') : q.isError ? 'Customer not found' : 'Customer')
  if (!allowed) return <NotFound notAllowed />
  if (q.isPending) return <Spinner />
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) {
      return (
        <div className="card">
          <h1>Customer not found</h1>
          <Link to="/customers">Find a customer</Link>
        </div>
      )
    }
    return <QueryError error={q.error} onRetry={() => q.refetch()} />
  }
  return <ProfileView c={q.data} />
}

function ProfileView({ c }: { c: CustomerProfile }) {
  const s = c.stats
  return (
    <>
      <BackLink to="/customers">Find a customer</BackLink>
      <div className="topbar">
        <h1>{c.name ?? 'No name given'}</h1>
        {c.deletedAt && <Badge tone="warn">Account deleted {date(c.deletedAt)}</Badge>}
        <span className="muted">Customer since {date(c.createdAt)}</span>
      </div>

      <ul className="tiles" aria-label="Summary">
        <Tile count={rupees(s.lifetimeSpend)} label="Lifetime spend (paid, not refunded)" />
        <Tile count={String(s.paidOrders)} label={`Paid ${s.paidOrders === 1 ? 'order' : 'orders'}`} />
        <Tile count={s.firstOrderAt ? date(s.firstOrderAt) : '—'} label="First order" />
        <Tile count={s.lastOrderAt ? date(s.lastOrderAt) : '—'} label="Last order" />
        <Tile count={s.averageRating == null ? '—' : `${s.averageRating} / 5`} label="Average order rating" />
        <Tile count={String(s.claims)} label={s.claims === 1 ? 'Claim' : 'Claims'} />
      </ul>

      <div className="grid-2">
        <div>
          <Contact c={c} />
          <section className="card" aria-labelledby="consent-h">
            <h2 id="consent-h">Consent and settings</h2>
            <dl className="kv">
              <dt>Privacy notice</dt>
              <dd>{c.consent.privacyAcceptedAt ? `Accepted ${dateTime(c.consent.privacyAcceptedAt)}` : 'Not recorded'}</dd>
              <dt>WhatsApp reminders</dt>
              <dd>{c.consent.remindersOptIn ? 'On (opted in)' : 'Off'}</dd>
              <dt>Back-in-stock alerts</dt>
              <dd>{c.consent.openStockAlerts ? `${c.consent.openStockAlerts} waiting` : 'None'}</dd>
              <dt>Signs in with</dt>
              <dd>{[c.signIn.phone && 'Phone code', c.signIn.google && 'Google'].filter(Boolean).join(', ') || '—'}</dd>
              <dt>Open preorders</dt>
              <dd>{s.openPreorders}</dd>
              {s.refunds > 0 && (
                <>
                  <dt>Refunded</dt>
                  <dd>{rupees(s.refunds)} (cancelled before packing, or undeliverable)</dd>
                </>
              )}
            </dl>
          </section>
          <section className="card" aria-labelledby="addr-h">
            <h2 id="addr-h">Saved addresses</h2>
            {c.addresses.length === 0 ? (
              <p className="muted">None saved.</p>
            ) : (
              <ul className="bare-list">
                {c.addresses.map((a) => (
                  <li key={a.id}>
                    {a.name && <strong>{a.name}: </strong>}
                    {a.address}, {a.pincode} <span className="muted small">last used {date(a.lastUsedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div>
          <section className="card" aria-labelledby="claims-h">
            <h2 id="claims-h">Claims</h2>
            {c.claims.length === 0 ? (
              <p className="muted">No claims.</p>
            ) : (
              <ul className="bare-list">
                {c.claims.map((x) => (
                  <li key={x.id}>
                    <Link to={`/orders/${encodeURIComponent(x.orderId)}`}>{x.orderNumber}</Link> · {ISSUE_LABEL[x.issueType] ?? x.issueType}{' '}
                    <ClaimBadge status={x.status} /> {x.resolution && <span>{RESOLUTION_LABEL[x.resolution]}</span>}{' '}
                    <span className="muted small">{date(x.createdAt)}</span>
                    {x.replacementOrder && (
                      <div className="small">
                        Replacement <Link to={`/orders/${encodeURIComponent(x.replacementOrder.id)}`}>{x.replacementOrder.number}</Link>
                      </div>
                    )}
                    <span className="sr-only">{CLAIM_STATUS_LABEL[x.status]}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card" aria-labelledby="reviews-h">
            <h2 id="reviews-h">Reviews and ratings</h2>
            {c.reviews.length === 0 && c.ratings.length === 0 ? (
              <p className="muted">No reviews or ratings.</p>
            ) : (
              <ul className="bare-list">
                {c.reviews.map((r) => (
                  <li key={r.id}>
                    <Stars n={r.rating} /> {r.productName} · <Link to={`/orders/${encodeURIComponent(r.orderId)}`}>{r.orderNumber}</Link>{' '}
                    <Badge>{REVIEW_STATUS_LABEL[r.status] ?? r.status}</Badge> <span className="muted small">{date(r.createdAt)}</span>
                    {r.comment && <div className="small">{r.comment}</div>}
                  </li>
                ))}
                {c.ratings.map((r) => (
                  <li key={`rating-${r.orderId}`}>
                    <Stars n={r.stars} /> Order rating · <Link to={`/orders/${encodeURIComponent(r.orderId)}`}>{r.orderNumber}</Link>{' '}
                    <span className="muted small">{date(r.at)}</span>
                    {r.comment && <div className="small">{r.comment}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="card" aria-labelledby="orders-h">
        <h2 id="orders-h">
          Orders <span className="muted small">({s.allOrders}, {s.replacements} free replacements)</span>
        </h2>
        {c.orders.length === 0 ? (
          <p className="muted">No orders.</p>
        ) : (
          <div {...scrollRegion('Customer orders', { cards: true })}>
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Placed</th>
                  <th>Delivery</th>
                  <th className="num">Boxes</th>
                  <th className="num">Total</th>
                  <th>Bill</th>
                </tr>
              </thead>
              <tbody>
                {c.orders.map((o) => (
                  <LinkRow key={o.id}>
                    <td className="card-title">
                      <RowLink to={`/orders/${encodeURIComponent(o.id)}`}>{o.number}</RowLink>
                      {o.replacement && <div className="small muted">Free replacement</div>}
                      {o.refund && <div className="small muted">{o.refund === 'REFUNDED' ? 'Refunded' : 'Refund pending'}</div>}
                    </td>
                    <td className="card-status">
                      <OrderBadge status={o.status} />
                    </td>
                    <td data-label="Placed">{date(o.placedAt)}</td>
                    <td data-label="Delivery">{date(o.deliveryDate)}</td>
                    <td className="num" data-label="Boxes">
                      {o.boxes}
                    </td>
                    <td className="num" data-label="Total">
                      {rupees(o.total)}
                    </td>
                    <td data-label="Bill">{o.bill ? `${o.bill.number}${o.bill.cancelled ? ' (cancelled)' : ''}` : '—'}</td>
                  </LinkRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {c.ordersShown < s.allOrders && <p className="muted small">Showing the latest {c.ordersShown}.</p>}
      </section>
    </>
  )
}

function Tile({ count, label }: { count: string; label: string }) {
  return (
    <li className="tile">
      <div className="count">{count}</div>
      <div className="label">{label}</div>
    </li>
  )
}

function Stars({ n }: { n: number }) {
  return (
    <span role="img" aria-label={`${n} out of 5 stars`}>
      {'★'.repeat(n)}
      <span className="muted">{'☆'.repeat(5 - n)}</span>
    </span>
  )
}

/** Phone and email, masked until someone reveals them (the API records the reveal). */
function Contact({ c }: { c: CustomerProfile }) {
  const reveal = useMutation({ mutationFn: () => api.revealCustomer(c.id) })
  const shown = reveal.data
  return (
    <section className="card" aria-labelledby="contact-h">
      <h2 id="contact-h">Contact</h2>
      <dl className="kv">
        <dt>Phone</dt>
        <dd>{shown ? <PhoneLink phone={shown.phone} who={c.name ?? 'the customer'} /> : <span className="mono">{c.phoneMasked ?? '—'}</span>}</dd>
        <dt>Email</dt>
        <dd>{shown ? (shown.email ?? '—') : <span className="mono">{c.emailMasked ?? '—'}</span>}</dd>
      </dl>
      {!shown && (c.hasPhone || c.hasEmail) && (
        <div className="btn-row mt-2">
          <button type="button" className="btn" disabled={reveal.isPending} onClick={() => reveal.mutate()} aria-describedby="reveal-hint">
            {reveal.isPending ? 'Showing…' : 'Show full number and email'}
          </button>
          <p id="reveal-hint" className="muted small">
            Shown only when you need to call or write. This is recorded in the activity log with your name.
          </p>
        </div>
      )}
      <FormError error={reveal.error} />
    </section>
  )
}
