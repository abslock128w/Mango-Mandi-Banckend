import { Suspense, lazy } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { count, date, rupees, rupeesCompact, rupeesWhole } from '../format'
import type { AnalyticsWeek } from '../types'
import { ExportPanel } from '../ExportPanel'
import { EmptyState, QueryError, Spinner, scrollRegion, usePageTitle } from '../ui'
import { useSession } from '../session'
import { FunnelSection } from './Funnel'
import { BarList, KpiCard, deltaOf } from '../viz'

// Recharts is only fetched for this page, after its numbers are on screen.
const AnalyticsCharts = lazy(() => import('./AnalyticsCharts'))

const pct = (r: number | null) => (r == null ? '—' : `${Math.round(r * 1000) / 10}%`)
const weekLabel = (w: string) => date(w).replace(/,? \d{4}$/, '')

/** Season numbers for the owners: what sold, what was wasted, what went wrong, week by week. */
export default function Analytics() {
  usePageTitle('Analytics')
  const [params, setParams] = useSearchParams()
  const from = params.get('from') || null
  const to = params.get('to') || null
  const q = useQuery({ queryKey: ['analytics', from, to], queryFn: () => api.analytics({ from, to }) })
  // The shop funnel (FUNNEL_ANALYTICS): managers only, while the switch is on.
  const { me } = useSession()
  const showFunnel = me?.role === 'MANAGER' && Boolean(me.features?.funnelAnalytics)

  function set(key: string, value: string) {
    const p = new URLSearchParams(params)
    if (value) p.set(key, value)
    else p.delete(key)
    setParams(p, { replace: true })
  }

  return (
    <>
      <div className="topbar">
        <h1>Analytics</h1>
        <div className="field m-0">
          <label htmlFor="an-from" className="sr-only">
            From
          </label>
          <input id="an-from" type="date" value={from ?? q.data?.from ?? ''} onChange={(e) => set('from', e.target.value)} />
        </div>
        <div className="field m-0">
          <label htmlFor="an-to" className="sr-only">
            To
          </label>
          <input id="an-to" type="date" value={to ?? q.data?.to ?? ''} onChange={(e) => set('to', e.target.value)} />
        </div>
      </div>

      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <Kpis weeks={q.data.weeks} totals={q.data.totals} />

          {(q.data.lowRatings ?? []).length > 0 && (
            <section className="card">
              <h2>Unhappy customers</h2>
              <p className="muted small">Orders rated 1 or 2 stars, newest first. Worth a call.</p>
              <ul className="plain-list">
                {q.data.lowRatings!.map((r) => (
                  <li key={r.orderId}>
                    <Link to={`/orders/${r.orderId}`}>{r.number}</Link> <span aria-label={`${r.stars} out of 5 stars`}>{'★'.repeat(r.stars)}</span>{' '}
                    <span className="muted small">delivered {date(r.deliveryDate)}</span>
                    {r.comment && <div className="small">{r.comment}</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {q.data.totals.orders === 0 && q.data.totals.received === 0 ? (
            <EmptyState>Nothing sold or received between {date(q.data.from)} and {date(q.data.to)}.</EmptyState>
          ) : (
            <Suspense
              fallback={
                <div className="chart-grid" aria-hidden="true">
                  <div className="card">
                    <div className="chart-skeleton" />
                  </div>
                  <div className="card">
                    <div className="chart-skeleton" />
                  </div>
                </div>
              }
            >
              <AnalyticsCharts weeks={q.data.weeks} />
            </Suspense>
          )}

          {q.data.bySku.length > 0 && (
            <section className="card">
              <div className="chart-head">
                <div>
                  <h2>Sales by product</h2>
                  <p className="muted small">Boxes sold in the range, with the share of each product's received boxes that were wasted.</p>
                </div>
              </div>
              <BarList
                label="Boxes sold by product"
                items={[...q.data.bySku]
                  .sort((x, y) => y.boxes - x.boxes)
                  .map((s) => ({
                    key: s.sku,
                    label: s.productName,
                    sub: `${s.sku} · ${rupeesCompact(s.revenue)}`,
                    value: s.boxes,
                    display: `${count(s.boxes)} boxes`,
                    aside: `${pct(s.wastageRate)} wasted`,
                    tone: (s.wastageRate ?? 0) >= 0.15 ? 'bad' : 'teal',
                  }))}
              />
            </section>
          )}

          <section className="card">
            <h2>Week by week</h2>
            <div {...scrollRegion('Week by week')}>
              <table>
                <thead>
                  <tr>
                    <th>Week of</th>
                    <th className="num">Orders</th>
                    <th className="num">Boxes</th>
                    <th className="num">Sales</th>
                    <th className="num">Delivered</th>
                    <th className="num">Missed</th>
                    <th className="num">At risk</th>
                    <th className="num">Received</th>
                    <th className="num">Wasted</th>
                    <th className="num">Cancelled</th>
                    <th className="num">Refunded</th>
                    <th className="num">Claims</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.weeks.map((w) => (
                    <tr key={w.weekStart}>
                      <td>{weekLabel(w.weekStart)}</td>
                      <td className="num">{w.orders}</td>
                      <td className="num">{w.boxes}</td>
                      <td className="num">{rupees(w.revenue)}</td>
                      <td className="num">{w.delivered}</td>
                      <td className="num">{w.deliveryFailed}</td>
                      <td className="num">{w.atRisk}</td>
                      <td className="num">{w.received}</td>
                      <td className="num">{w.wasted}</td>
                      <td className="num">{w.customerCancels}</td>
                      <td className="num">{rupees(w.refunded)}</td>
                      <td className="num">{w.claims}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2>By product</h2>
            {q.data.bySku.length === 0 ? (
              <EmptyState>No products sold or received in this range.</EmptyState>
            ) : (
              <div {...scrollRegion('By product')}>
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="num">Boxes sold</th>
                      <th className="num">Sales</th>
                      <th className="num">Received</th>
                      <th className="num">Wasted</th>
                      <th className="num">Wasted %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.bySku.map((s) => (
                      <tr key={s.sku}>
                        <td>
                          {s.productName} <span className="muted small">{s.sku}</span>
                        </td>
                        <td className="num">{s.boxes}</td>
                        <td className="num">{rupees(s.revenue)}</td>
                        <td className="num">{s.received}</td>
                        <td className="num">{s.wasted}</td>
                        <td className="num">{pct(s.wastageRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {showFunnel && <FunnelSection />}
      <ExportPanel kinds={['payments', 'refunds']} />
    </>
  )
}

/** Range totals, each with its trend across the weeks and the last full week against the one before. */
function Kpis({ weeks, totals }: { weeks: AnalyticsWeek[]; totals: Omit<AnalyticsWeek, 'weekStart'> }) {
  const [prev, last] = weeks.length >= 2 ? weeks.slice(-2) : [null, null]
  const vs = 'the week before'
  const d = (k: keyof AnalyticsWeek, o: { higherIsBetter?: boolean; rate?: boolean } = {}) =>
    last && prev ? deltaOf(last[k] as number | null, prev[k] as number | null, { ...o, against: vs }) : null
  const s = (f: (w: AnalyticsWeek) => number | null | undefined) => weeks.map((w) => f(w) ?? null)
  return (
    <div className="kpis">
      <KpiCard className="tile" label="Sales" value={rupeesCompact(totals.revenue)} hint={rupeesWhole(totals.revenue)} delta={d('revenue')} spark={s((w) => w.revenue)} />
      <KpiCard className="tile" label="Boxes sold" value={count(totals.boxes)} hint={`${count(totals.orders)} orders`} delta={d('boxes')} spark={s((w) => w.boxes)} />
      <KpiCard
        className="tile"
        label="Boxes wasted"
        value={pct(totals.wastageRate)}
        hint={`${totals.wasted} of ${totals.received} received`}
        delta={d('wastageRate', { higherIsBetter: false, rate: true })}
        spark={s((w) => w.wastageRate)}
        sparkTone="warn"
      />
      <KpiCard
        className="tile"
        label="Orders at risk"
        value={pct(totals.atRiskRate)}
        hint={`${totals.atRisk} of ${totals.orders}`}
        delta={d('atRiskRate', { higherIsBetter: false, rate: true })}
        spark={s((w) => w.atRiskRate)}
        sparkTone="warn"
      />
      <KpiCard className="tile" label="Claims" value={count(totals.claims)} hint={`${totals.claimsReplaced} replaced`} delta={d('claims', { higherIsBetter: false })} spark={s((w) => w.claims)} sparkTone="muted" />
      <KpiCard
        className="tile"
        label="Customer rating"
        value={totals.averageRating != null ? `${totals.averageRating.toFixed(1)} ★` : '—'}
        hint={`${totals.ratings ?? 0} ${totals.ratings === 1 ? 'rating' : 'ratings'}`}
        spark={s((w) => w.averageRating)}
      />
    </div>
  )
}
