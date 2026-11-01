import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CircleCheck, Sunrise } from 'lucide-react'
import { api } from '../api'
import { ORDER_STATUS_LABEL, count, date, istDate, istTime, rupeesCompact } from '../format'
import type { Analytics, AnalyticsWeek, OrderStatus } from '../types'
import NeedsAttention, { attentionQuery } from './NeedsAttention'
import { SummaryPreviewButton } from './DailySummary'
import { useSession } from '../session'
import { EmptyState, LinkRow, QueryError, RowLink, scrollRegion, usePageTitle } from '../ui'
import { FreshnessStrip, KpiCard, PipelineBar, deltaOf, type Delta } from '../viz'

const TILE_STATUSES: OrderStatus[] = [
  'CONFIRMED',
  'PROCESSING',
  'PACKED',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERY_FAILED',
  'PAYMENT_PENDING',
]

/** The stages an open order moves through, for the pipeline bar (payment pending isn't an order yet). */
const PIPELINE: [OrderStatus, string][] = [
  ['CONFIRMED', 'confirmed'],
  ['PROCESSING', 'processing'],
  ['PACKED', 'packed'],
  ['SHIPPED', 'shipped'],
  ['OUT_FOR_DELIVERY', 'out'],
  ['DELIVERY_FAILED', 'failed'],
]

/** Tiles someone must act on when they are above zero, with the status tone they take. */
const URGENT: Partial<Record<OrderStatus | 'claims', 'bad' | 'warn'>> = {
  DELIVERY_FAILED: 'bad',
  claims: 'warn',
}

interface Tile {
  to: string
  label: string
  count: number
  urgent?: 'bad' | 'warn'
  /** The pipeline colour it matches, so the tiles double as the bar's legend. */
  tone: string
}

/** Used only when the summary does not say; the API sends the live rule. */
const DEFAULT_MAX_SELLABLE_AGE = 7

const longDate = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' })

export default function Today() {
  usePageTitle('Today')
  const { me } = useSession()
  const q = useQuery({ queryKey: ['summary'], queryFn: api.summary, refetchInterval: 60_000 })
  // Started here, beside the summary, rather than when NeedsAttention mounts after it.
  const attention = useQuery(attentionQuery)
  const manager = me?.role === 'MANAGER'
  // Managers get last week's numbers beside today's: the same weekly series as Analytics.
  const insights = useQuery({ queryKey: ['analytics', null, null], queryFn: () => api.analytics({}), enabled: manager, staleTime: 5 * 60_000 })

  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />
  // While loading, the heading and tiles hold their final size and nothing sits
  // below them; the rest appears once the summary and Needs attention are both
  // in, so nothing on screen moves.
  if (q.isPending) return <TodayLoading />
  const s = q.data
  // Batches this old are past the sell limit: the API no longer sells them.
  const maxAge = s.maxSellableAge ?? DEFAULT_MAX_SELLABLE_AGE
  // Only the first answer is waited for: a query that failed is pending again while it is
  // asked again, and hiding Needs attention then would remount it and ask again, forever.
  const waiting = attention.isPending && attention.errorUpdateCount === 0
  const atRisk = s.atRiskOrders ?? []
  const overdue = s.overdueOrders ?? []
  const healthy = s.batchesNearLimit.length === 0 && s.lowStock.length === 0
  // Every tile opens the page it counts, filtered.
  const tiles: Tile[] = [
    ...TILE_STATUSES.map((status) => ({
      to: `/orders?status=${status}`,
      label: ORDER_STATUS_LABEL[status],
      count: s.orders[status] ?? 0,
      urgent: URGENT[status],
      tone: PIPELINE.find(([st]) => st === status)?.[1] ?? 'pending',
    })),
    { to: '/claims', label: 'Open claims', count: s.openClaims, urgent: URGENT.claims, tone: 'claims' },
  ]

  return (
    <>
      <TodayTop updated={istTime(new Date(q.dataUpdatedAt))} />

      {waiting ? (
        <span className="sr-only" role="status" aria-label="Loading" />
      ) : (
        <NeedsAttention
          whenClear={
            <div className="all-clear">
              <CircleCheck aria-hidden="true" strokeWidth={2} />
              All clear: nothing needs a person right now.
            </div>
          }
        />
      )}

      <section className="block" aria-labelledby="today-orders">
        <div className="block-head">
          <h2 id="today-orders">Orders in progress</h2>
          <Link to="/orders" className="block-link">
            All orders<span aria-hidden="true"> →</span>
          </Link>
        </div>
        <PipelineBar
          legend={false}
          label="Open orders by stage"
          segments={PIPELINE.map(([status, tone]) => ({ key: status, label: ORDER_STATUS_LABEL[status], count: s.orders[status] ?? 0, tone }))}
        />
        <div className="tiles tiles-today">
          {tiles.map((t) => {
            const urgent = t.urgent && t.count > 0
            return (
              <Link key={t.to} className={`tile tone-${t.tone}${urgent ? ` tile-${t.urgent}` : ''}`} data-zero={t.count === 0 || undefined} to={t.to}>
                <div className="count">{t.count}</div>
                <div className="label">{t.label}</div>
                {/* The flag line is always there, empty when calm, so a tile keeps its height. */}
                <div className="tile-flag" aria-hidden={urgent ? undefined : true}>
                  {urgent ? 'Needs action' : null}
                </div>
              </Link>
            )
          })}
        </div>
      </section>

      {manager && insights.data && <WeekInsights a={insights.data} />}

      {!waiting && overdue.length > 0 && (
        <section className="card">
          <h2>Overdue orders</h2>
          <p className="muted">Paid and not delivered by their date, or out for delivery too long. Find out where each one is.</p>
          <div {...scrollRegion('Overdue orders')}>
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Problem</th>
                </tr>
              </thead>
              <tbody>
                {overdue.map((o) => (
                  <LinkRow key={o.id}>
                    <td>
                      <RowLink to={`/orders/${o.id}`}>{o.number}</RowLink>
                    </td>
                    <td>{date(o.deliveryDate)}</td>
                    <td>{ORDER_STATUS_LABEL[o.status] ?? o.status}</td>
                    <td className="text-danger">{o.reason}</td>
                  </LinkRow>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!waiting && atRisk.length > 0 && (
        <section className="card">
          <h2>Orders at risk</h2>
          <p className="muted">The stock for these orders went bad or ran out. Each needs a new date or new stock.</p>
          <div {...scrollRegion('Orders at risk')}>
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Delivery</th>
                  <th>Problem</th>
                </tr>
              </thead>
              <tbody>
                {atRisk.map((o) => (
                  <LinkRow key={o.id}>
                    <td>
                      <RowLink to={`/orders/${o.id}`}>{o.number}</RowLink>
                    </td>
                    <td>{date(o.deliveryDate)}</td>
                    <td>{o.reason ?? '—'}</td>
                  </LinkRow>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {waiting ? null : healthy ? (
        <div className="card">
          <EmptyState>All batches and stock look healthy.</EmptyState>
        </div>
      ) : (
        <div className="grid-2 grid-even">
          <section className="card">
            <div className="section-head topbar">
              <h2>Batches nearing sell limit</h2>
              <span className="spacer" />
              <Link to="/batches" className="block-link">
                Batches<span aria-hidden="true"> →</span>
              </Link>
            </div>
            {s.batchesNearLimit.length === 0 ? (
              <EmptyState>No batches are 5 or more days old.</EmptyState>
            ) : (
              <div {...scrollRegion('Batches nearing sell limit')}>
                <table>
                  <thead>
                    <tr>
                      <th>Variety</th>
                      <th className="num">Age</th>
                      <th className="num">Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.batchesNearLimit.map((b) => (
                      <LinkRow key={b.id}>
                        <td>
                          <RowLink to={`/batches/${b.id}`} more="batch">
                            {b.variety}
                          </RowLink>
                        </td>
                        <td className={`num ${b.ageDays >= maxAge ? 'text-danger' : 'text-warn'}`}>
                          <span className="age-cell">
                            <FreshnessStrip ageDays={b.ageDays} maxAge={maxAge} />
                            <span>
                              {b.ageDays >= maxAge && <span aria-hidden="true">⚠ </span>}
                              {b.ageDays} days
                              {b.ageDays >= maxAge && <span className="sr-only"> (past sell limit)</span>}
                            </span>
                          </span>
                        </td>
                        <td className="num">{b.available}</td>
                      </LinkRow>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="card">
            <div className="section-head topbar">
              <h2>Low stock</h2>
            </div>
            {s.lowStock.length === 0 ? (
              <EmptyState>No SKUs are running low.</EmptyState>
            ) : (
              <div {...scrollRegion('Low stock')}>
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="num">Available</th>
                      <th>
                        <span className="sr-only">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.lowStock.map((p) => (
                      <tr key={p.sku}>
                        <td>
                          {p.productName} <span className="muted small">{p.sku}</span>
                        </td>
                        <td className="num text-warn">
                          <strong>{p.available}</strong>
                        </td>
                        <td className="num">
                          <Link to="/batches?receive=1">Receive batch</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  )
}

/** The heading row; "Last updated" keeps its line while loading. */
function TodayTop({ updated }: { updated?: string }) {
  const { me } = useSession()
  // The managers' evening WhatsApp summary (MANAGER_DAILY_SUMMARY): what it would say right now.
  const brief = me?.role === 'MANAGER' && Boolean(me.features?.managerDailySummary)
  const preview = Boolean(updated) && brief
  return (
    <>
      <div className="topbar today-head">
        <h1>Today</h1>
        <span className="today-date">{longDate.format(new Date())}</span>
        <span className="spacer" />
        <span className="updated">
          {updated && <span className="live-dot" aria-hidden="true" />}
          {updated ? `Last updated ${updated}` : ' '}
        </span>
        {preview && <SummaryPreviewButton />}
      </div>
      {preview && <MorningBrief />}
    </>
  )
}

/** Today's numbers so far, from the evening summary's preview (managers with the summary on). */
function MorningBrief() {
  const q = useQuery({ queryKey: ['daily-summary-preview'], queryFn: api.dailySummaryPreview, refetchInterval: 5 * 60_000 })
  if (!q.data) return null
  const n = q.data.numbers
  return (
    <div className="morning-brief">
      <span className="morning-brief-icon" aria-hidden="true">
        <Sunrise strokeWidth={2} />
      </span>
      <div>
        <p className="morning-brief-title">So far today</p>
        <p className="morning-brief-nums">
          {count(n.orders)} {n.orders === 1 ? 'order' : 'orders'} ({rupeesCompact(n.revenue)}) · {count(n.boxesDelivered)} boxes delivered
          {n.boxesFailed ? `, ${n.boxesFailed} missed` : ''} · {n.newClaims} new {n.newClaims === 1 ? 'claim' : 'claims'} · {n.unhappyRatings} unhappy{' '}
          {n.unhappyRatings === 1 ? 'rating' : 'ratings'}
        </p>
      </div>
      <span className="muted small">Sent at {q.data.sendsAt}</span>
    </div>
  )
}

/** Weeks that have ended (the current week is still filling up, so it is left out of the comparison). */
function fullWeeks(weeks: AnalyticsWeek[]): AnalyticsWeek[] {
  const today = istDate()
  return weeks.filter((w) => {
    const end = new Date(`${w.weekStart}T00:00:00+05:30`)
    end.setDate(end.getDate() + 7)
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(end) <= today
  })
}

/** Managers: last full week against the week before, with the trend across the range. */
function WeekInsights({ a }: { a: Analytics }) {
  const weeks = fullWeeks(a.weeks)
  if (weeks.length === 0) return null
  const last = weeks[weeks.length - 1]
  const prev = weeks.length > 1 ? weeks[weeks.length - 2] : null
  const vs = prev ? `the week of ${date(prev.weekStart).replace(/,? \d{4}$/, '')}` : ''
  const series = (f: (w: AnalyticsWeek) => number | null | undefined) => weeks.map((w) => f(w) ?? null)
  const d = (curr: number | null | undefined, before: number | null | undefined, o: { higherIsBetter?: boolean; rate?: boolean } = {}) =>
    prev ? deltaOf(curr, before, { ...o, against: vs }) : null
  const ratingDelta: Delta | null =
    prev && last.averageRating != null && prev.averageRating != null
      ? (() => {
          const diff = Math.round((last.averageRating - prev.averageRating) * 10) / 10
          return {
            text: `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff).toFixed(1)}`,
            dir: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
            tone: diff > 0 ? 'good' : diff < 0 ? 'bad' : 'neutral',
            spoken: diff === 0 ? `the same as ${vs}` : `${diff > 0 ? 'up' : 'down'} ${Math.abs(diff).toFixed(1)} stars on ${vs}`,
          }
        })()
      : null
  const pct = (r: number | null) => (r == null ? '—' : `${Math.round(r * 1000) / 10}%`)
  return (
    <section className="block" aria-labelledby="today-week">
      <div className="block-head">
        <h2 id="today-week">Week of {date(last.weekStart).replace(/,? \d{4}$/, '')}</h2>
        <Link to="/analytics" className="block-link">
          Analytics<span aria-hidden="true"> →</span>
        </Link>
      </div>
      <div className="kpis kpis-compact">
        <KpiCard label="Sales" value={rupeesCompact(last.revenue)} delta={d(last.revenue, prev?.revenue)} spark={series((w) => w.revenue)} hint={`${count(last.orders)} orders`} />
        <KpiCard label="Boxes sold" value={count(last.boxes)} delta={d(last.boxes, prev?.boxes)} spark={series((w) => w.boxes)} hint={`${count(last.delivered)} delivered`} />
        <KpiCard
          label="Wasted"
          value={pct(last.wastageRate)}
          delta={d(last.wastageRate, prev?.wastageRate, { higherIsBetter: false, rate: true })}
          spark={series((w) => w.wastageRate)}
          sparkTone="warn"
          hint={`${last.wasted} of ${last.received} boxes`}
        />
        <KpiCard
          label="Missed deliveries"
          value={count(last.deliveryFailed)}
          delta={d(last.deliveryFailed, prev?.deliveryFailed, { higherIsBetter: false })}
          spark={series((w) => w.deliveryFailed)}
          sparkTone="muted"
          hint={`${count(last.delivered)} delivered`}
        />
        <KpiCard
          label="Claims"
          value={count(last.claims)}
          delta={d(last.claims, prev?.claims, { higherIsBetter: false })}
          spark={series((w) => w.claims)}
          sparkTone="muted"
          hint={`${last.claimsReplaced} replaced`}
        />
        <KpiCard
          label="Rating"
          value={last.averageRating != null ? `${last.averageRating.toFixed(1)} ★` : '—'}
          delta={ratingDelta}
          spark={series((w) => w.averageRating)}
          hint={`${last.ratings ?? 0} ${last.ratings === 1 ? 'rating' : 'ratings'}`}
        />
      </div>
    </section>
  )
}

/** Today before the summary arrives: the heading and eight empty tiles of the final size. */
function TodayLoading() {
  return (
    <>
      <TodayTop />
      <span className="sr-only" role="status" aria-label="Loading" />
      <div className="block">
        <div className="block-head">
          <h2>Orders in progress</h2>
        </div>
        <div className="pipeline" aria-hidden="true">
          <div className="pipeline-bar" />
        </div>
        <div className="tiles-placeholder tiles-today" aria-hidden="true">
          {/* One for each order status and one for open claims. */}
          {Array.from({ length: TILE_STATUSES.length + 1 }, (_, i) => (
            <div key={i} className="tile tile-placeholder">
              <div className="count">&nbsp;</div>
              <div className="label">&nbsp;</div>
              <div className="tile-flag" />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
