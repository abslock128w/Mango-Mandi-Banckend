// The shop funnel (FUNNEL_ANALYTICS, docs/growth.md) on the Analytics page, managers only:
// how many browsers each day visited, looked at a box, added to the cart, started checkout and
// paid, and the conversion from a visit to each step. Anonymous: a browser is a random id.
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { date } from '../format'
import type { FunnelRow, FunnelStep } from '../types'
import { EmptyState, QueryError, Spinner, scrollRegion } from '../ui'

export const STEP_LABEL: Record<FunnelStep, string> = {
  visit: 'Visited',
  product_view: 'Viewed a box',
  add_to_cart: 'Added to cart',
  checkout_start: 'Started checkout',
  paid: 'Paid',
}
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`)
const dayLabel = (d: string) => date(d).replace(/,? \d{4}$/, '')

export function FunnelSection() {
  const [params, setParams] = useSearchParams()
  const from = params.get('funnelFrom') || null
  const to = params.get('funnelTo') || null
  const q = useQuery({ queryKey: ['funnel', from, to], queryFn: () => api.funnel({ from, to }) })

  function set(key: string, value: string) {
    const p = new URLSearchParams(params)
    if (value) p.set(key, value)
    else p.delete(key)
    setParams(p, { replace: true })
  }

  return (
    <section className="card" aria-labelledby="funnel-title">
      <div className="funnel-head">
        <h2 id="funnel-title">Shop funnel</h2>
        <div className="funnel-range">
          <div className="field m-0">
            <label htmlFor="funnel-from">From</label>
            <input id="funnel-from" type="date" value={from ?? q.data?.from ?? ''} onChange={(e) => set('funnelFrom', e.target.value)} />
          </div>
          <div className="field m-0">
            <label htmlFor="funnel-to">To</label>
            <input id="funnel-to" type="date" value={to ?? q.data?.to ?? ''} onChange={(e) => set('funnelTo', e.target.value)} />
          </div>
        </div>
      </div>
      <p className="muted small">
        Browsers a day at each step, counted once each. Anonymous: no names, numbers or accounts are kept. "Paid" is counted by the API when a payment
        comes in, for the browser that started that checkout. Kept 90 days.
      </p>
      {q.isPending ? (
        <Spinner label="Loading the funnel" />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.totals.counts.visit === 0 && q.data.totals.counts.paid === 0 ? (
        <EmptyState>
          No shop visits recorded between {date(q.data.from)} and {date(q.data.to)}.
        </EmptyState>
      ) : (
        <>
          <FunnelBars row={q.data.totals} steps={q.data.steps} />
          <div {...scrollRegion('Shop funnel by day')}>
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  {q.data.steps.map((s) => (
                    <th key={s} className="num">
                      {STEP_LABEL[s]}
                    </th>
                  ))}
                  <th className="num">Visit to paid</th>
                </tr>
              </thead>
              <tbody>
                {q.data.days.map((d) => (
                  <tr key={d.day}>
                    <td>{dayLabel(d.day!)}</td>
                    {q.data.steps.map((s) => (
                      <td key={s} className="num">
                        {d.counts[s]}
                        {s !== 'visit' && d.counts.visit > 0 && <span className="muted small"> ({pct(d.conversion[s])})</span>}
                      </td>
                    ))}
                    <td className="num">{pct(d.conversion.paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

/** The range's totals as bars, each as wide as its share of visits, with the step-to-step rate. */
function FunnelBars({ row, steps }: { row: FunnelRow; steps: FunnelStep[] }) {
  const top = Math.max(1, row.counts.visit)
  return (
    <ol className="funnel-bars" aria-label="Funnel for the whole range">
      {steps.map((s) => (
        <li key={s}>
          <span className="funnel-label">{STEP_LABEL[s]}</span>
          <span className="funnel-track" aria-hidden="true">
            <span className="funnel-fill" style={{ width: `${Math.min(100, (row.counts[s] / top) * 100)}%` }} />
          </span>
          <span className="funnel-num">
            <strong>{row.counts[s]}</strong> <span className="muted small">{s === 'visit' ? 'browsers' : `${pct(row.conversion[s])} of visits`}</span>
            {s !== 'visit' && <span className="muted small"> · {pct(row.stepConversion[s])} of the step before</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}
