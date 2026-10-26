import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { ORDER_STATUS_LABEL, RIPENESS_LABEL, date, dateTime, rupees, type Tone } from '../format'
import { ALL_ORDER_STATUSES, type GiftOrderListItem, type OrderStatus, type Ripeness } from '../types'
import { ExportPanel } from '../ExportPanel'
import { useSession } from '../session'
import { Badge, EmptyState, LinkRow, OrderBadge, QueryError, RowLink, Spinner, StatusFilter, scrollRegion, usePageTitle } from '../ui'

export default function Orders() {
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as OrderStatus | null) || null
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const q = params.get('q') ?? ''
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)
  // Gift orders to many recipients (MULTI_GIFT, docs/gifting.md): each with its deliveries, shown while the switch is on.
  const { me } = useSession()
  const giftsOn = Boolean(me?.features?.multiGift)
  const gifts = giftsOn && params.get('view') === 'gifts'

  usePageTitle(gifts ? 'Gift orders' : 'Orders')
  const [search, setSearch] = useState(q)
  useEffect(() => setSearch(q), [q])

  function update(changes: Record<string, string | null>, resetPage = true) {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    if (resetPage) p.delete('page')
    setParams(p)
  }

  // Debounce typing into the URL; Enter applies immediately.
  useEffect(() => {
    if (search === q) return
    const t = window.setTimeout(() => update({ q: search.trim() || null }), 400)
    return () => window.clearTimeout(t)
    // Only typing restarts the wait: `update` is a new function every render and `q` follows
    // the URL this effect writes, so listing them would restart it on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const list = useQuery({
    queryKey: ['orders', { status, from, to, q, page }],
    queryFn: () => api.orders({ status, from, to, q, page }),
    placeholderData: keepPreviousData,
    enabled: !gifts,
  })

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1

  return (
    <>
      <div className="topbar">
        <h1>Orders</h1>
      </div>

      {giftsOn && (
        <div className="segmented mb-3" role="group" aria-label="Show">
          <button type="button" className="btn" aria-pressed={!gifts} onClick={() => update({ view: null, status: null, from: null, to: null })}>
            All orders
          </button>
          <button type="button" className="btn" aria-pressed={gifts} onClick={() => update({ view: 'gifts', status: null, from: null, to: null })}>
            Gift orders
          </button>
        </div>
      )}

      {gifts ? (
        <>
          <div className="field mb-4">
            <label htmlFor="o-q">Search by gift order or delivery number, buyer or recipient name</label>
            <input
              id="o-q"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') update({ q: search.trim() || null })
              }}
            />
          </div>
          <GiftOrders q={q} page={page} onPage={(n) => update({ page: String(n) }, false)} />
        </>
      ) : (
      <>
      <StatusFilter
        className="mb-3"
        value={status}
        options={ALL_ORDER_STATUSES}
        labels={ORDER_STATUS_LABEL}
        onChange={(s) => update({ status: s })}
      />

      <div className="field-inline mb-4">
        <div className="field">
          <label htmlFor="o-from">Placed from</label>
          <input id="o-from" type="date" value={from} onChange={(e) => update({ from: e.target.value || null })} />
        </div>
        <div className="field">
          <label htmlFor="o-to">Placed to</label>
          <input id="o-to" type="date" value={to} onChange={(e) => update({ to: e.target.value || null })} />
        </div>
        <div className="field field-grow">
          <label htmlFor="o-q">Search by order number, phone, name or address</label>
          <input
            id="o-q"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') update({ q: search.trim() || null })
            }}
          />
        </div>
      </div>

      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <QueryError error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState>No orders match these filters.</EmptyState>
      ) : (
        <>
          <div {...scrollRegion('Orders', { cards: true })}>
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th className="num">Items</th>
                  <th className="num">Total</th>
                  <th>Status</th>
                  <th>Delivery</th>
                  <th>Placed</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((o) => (
                  <LinkRow key={o.id}>
                    <td className="card-title">
                      <RowLink to={`/orders/${o.id}`}>{o.number}</RowLink>
                      {o.channel === 'whatsapp' && <div className="muted small">via WhatsApp</div>}
                      {o.giftOrderId && <div className="muted small">Gift delivery</div>}
                    </td>
                    <td data-label="Customer">
                      {o.customerName ?? '—'}
                      {o.phone && <div className="muted small">{o.phone}</div>}
                    </td>
                    <td className="num" data-label="Items">
                      {o.itemCount}
                    </td>
                    <td className="num" data-label="Total">
                      {rupees(o.total)}
                    </td>
                    <td className="card-status">
                      <OrderBadge status={o.status} />
                    </td>
                    <td data-label="Delivery">{date(o.deliveryDate)}</td>
                    <td data-label="Placed">{dateTime(o.placedAt)}</td>
                  </LinkRow>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="muted small">
              {list.data.total} orders · page {list.data.page} of {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-small"
              disabled={page <= 1}
              onClick={() => update({ page: String(page - 1) }, false)}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={page >= totalPages}
              onClick={() => update({ page: String(page + 1) }, false)}
            >
              Next
            </button>
          </div>
        </>
      )}
      <ExportPanel kinds={['orders', 'order-lines']} />
      </>
      )}
    </>
  )
}

const GIFT_STATUS: Record<GiftOrderListItem['status'], { label: string; tone: Tone }> = {
  PAYMENT_PENDING: { label: 'Waiting for payment', tone: 'warn' },
  PAID: { label: 'Paid', tone: 'good' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
}

/**
 * Gift orders with their deliveries: one payment and one bill for the parent, and
 * each recipient's delivery an ordinary order, packed, sent and cancelled from its own page.
 */
function GiftOrders({ q, page, onPage }: { q: string; page: number; onPage: (n: number) => void }) {
  const list = useQuery({
    queryKey: ['gift-orders', { q, page }],
    queryFn: () => api.giftOrders({ q, page }),
    placeholderData: keepPreviousData,
  })
  if (list.isPending) return <Spinner />
  if (list.isError) return <QueryError error={list.error} onRetry={() => list.refetch()} />
  if (list.data.items.length === 0) return <EmptyState>{q ? 'No gift orders match this search.' : 'No gift orders yet.'}</EmptyState>
  const totalPages = Math.max(1, Math.ceil(list.data.total / list.data.pageSize))
  return (
    <>
      {list.data.items.map((g) => (
        <section key={g.id} className="card" aria-labelledby={`gift-${g.id}`}>
          <div className="bill-line gift-head">
            <h2 id={`gift-${g.id}`} className="mono">
              {g.number}
            </h2>
            <Badge tone={GIFT_STATUS[g.status].tone}>{GIFT_STATUS[g.status].label}</Badge>
          </div>
          <p className="muted small">
            {g.customerName ?? 'A customer'} · {g.recipientCount} {g.recipientCount === 1 ? 'recipient' : 'recipients'}, {g.boxes} {g.boxes === 1 ? 'box' : 'boxes'} ·{' '}
            {rupees(g.total)} in one payment{g.promoCode ? ` (promo ${g.promoCode}, −${rupees(g.discount)})` : ''} · delivery {date(g.deliveryDate)} · placed{' '}
            {dateTime(g.placedAt)}
          </p>
          {g.business && (
            <p className="muted small">
              One bill to {g.business.name}, GSTIN <span className="mono">{g.business.gstin}</span>
            </p>
          )}
          <div {...scrollRegion(`Deliveries of ${g.number}`, { cards: true })}>
            <table>
              <thead>
                <tr>
                  <th>Delivery</th>
                  <th>Recipient</th>
                  <th>Box</th>
                  <th className="num">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {g.children.map((k) => (
                  <LinkRow key={k.id}>
                    <td className="card-title">
                      <RowLink to={`/orders/${k.id}`} more={`for ${k.recipientName ?? `recipient ${k.position}`}`}>
                        {k.number}
                      </RowLink>
                    </td>
                    <td data-label="Recipient">
                      {k.recipientName ?? '—'}
                      {k.pincode && <div className="muted small">{k.pincode}</div>}
                    </td>
                    <td data-label="Box">
                      {k.box ? `${k.box.qty} × ${k.box.name}, ${RIPENESS_LABEL[k.box.stage as Ripeness] ?? k.box.stage}` : '—'}
                    </td>
                    <td className="num" data-label="Total">
                      {rupees(k.total)}
                      {k.refund && <div className="muted small">{k.refund.refundedAt ? 'Refunded' : 'Refund on its way'}</div>}
                    </td>
                    <td className="card-status">
                      <OrderBadge status={k.status} />
                    </td>
                  </LinkRow>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <div className="pager">
        <span className="muted small">
          {list.data.total} gift orders · page {list.data.page} of {totalPages}
        </span>
        <button type="button" className="btn btn-small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button type="button" className="btn btn-small" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </>
  )
}
