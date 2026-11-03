// Analytics v2 (docs/design/ops-dashboard-v2.md §7): how the operation ran, for a period against
// the one before it. On-time delivery, slot fill, minutes per stop, the rider leaderboard, a
// pincode heat map, the variety mix and repeat customers (GET /analytics/ops). Every chart has its
// numbers in a table beside or under it (saffron fills are under 3:1, so the bars never stand alone).
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { count, date, istDate } from '../format'
import type { OpsAnalytics } from '../ops/types'
import { MapView, QueryError, Spinner, scrollRegion, type MapHeat } from '../ui'
import { BarList, KpiCard, deltaOf } from '../viz'

const pct = (r: number | null | undefined) => (r == null ? '—' : `${Math.round(r * 1000) / 10}%`)

function shift(day: string, n: number) {
  const t = new Date(`${day}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
const days = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1

export function OpsSection() {
  const [params, setParams] = useSearchParams()
  const to = params.get('oto') || istDate(0)
  const from = params.get('ofrom') || shift(to, -6)
  const compare = params.get('compare') !== 'none'
  const len = days(from, to)
  const prevTo = shift(from, -1)
  const prevFrom = shift(prevTo, -(len - 1))
  const cur = useQuery({ queryKey: ['analytics-ops', from, to], queryFn: () => api.opsAnalytics({ from, to }) })
  const prev = useQuery({ queryKey: ['analytics-ops', prevFrom, prevTo], queryFn: () => api.opsAnalytics({ from: prevFrom, to: prevTo }), enabled: compare })

  function set(changes: Record<string, string | null>) {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    setParams(p, { replace: true })
  }
  const presets: [string, string, string][] = [
    ['Last 7 days', shift(istDate(0), -6), istDate(0)],
    ['Last 14 days', shift(istDate(0), -13), istDate(0)],
    ['Last 30 days', shift(istDate(0), -29), istDate(0)],
  ]
  const vs = compare ? `${date(prevFrom)} to ${date(prevTo)}` : ''

  return (
    <section className="block" aria-labelledby="ops-title">
      <div className="block-head">
        <h2 id="ops-title">Operations</h2>
        <span className="muted small">
          {date(from)} to {date(to)}
          {compare ? `, against ${vs}` : ''}
        </span>
      </div>
      <div className="compare no-print">
        <div className="segmented" role="group" aria-label="Period">
          {presets.map(([label, f, t]) => (
            <button key={label} type="button" className="btn" aria-pressed={from === f && to === t} onClick={() => set({ ofrom: f === shift(istDate(0), -6) ? null : f, oto: null })}>
              {label}
            </button>
          ))}
        </div>
        <div className="field m-0">
          <label htmlFor="ops-from">From</label>
          <input id="ops-from" type="date" value={from} max={to} onChange={(e) => set({ ofrom: e.target.value || null })} />
        </div>
        <div className="field m-0">
          <label htmlFor="ops-to">To</label>
          <input id="ops-to" type="date" value={to} min={from} onChange={(e) => set({ oto: e.target.value || null })} />
        </div>
        <label className="check-inline">
          <input type="checkbox" checked={compare} onChange={(e) => set({ compare: e.target.checked ? null : 'none' })} />
          Compare with the period before
        </label>
      </div>
      {cur.isPending ? <Spinner /> : cur.isError ? <QueryError error={cur.error} onRetry={() => cur.refetch()} /> : <OpsCards a={cur.data} b={compare ? prev.data ?? null : null} vs={vs} />}
    </section>
  )
}

function OpsCards({ a, b, vs }: { a: OpsAnalytics; b: OpsAnalytics | null; vs: string }) {
  const d = (x: number | null | undefined, y: number | null | undefined, o: { higherIsBetter?: boolean; rate?: boolean } = {}) => (b ? deltaOf(x, y, { ...o, against: vs }) : null)
  const maxOrders = Math.max(1, ...a.pincodes.map((p) => p.orders))
  const heat: MapHeat[] = a.pincodes
    .filter((p) => p.lat !== null && p.lng !== null)
    .map((p) => ({ id: p.pincode, lat: p.lat!, lng: p.lng!, weight: p.orders / maxOrders, label: `${p.pincode}${p.area ? ` · ${p.area}` : ''}: ${count(p.orders)} orders` }))
  return (
    <>
      <div className="kpis kpis-compact">
        <KpiCard label="On time" value={pct(a.onTime.rate)} delta={d(a.onTime.rate, b?.onTime.rate, { rate: true })} hint={`${count(a.onTime.onTime)} of ${count(a.onTime.delivered)} inside their window`} />
        <KpiCard label="Minutes per stop" value={a.minutesPerStop.median == null ? '—' : `${a.minutesPerStop.median} min`} delta={d(a.minutesPerStop.median, b?.minutesPerStop.median, { higherIsBetter: false })} hint={`median of ${count(a.minutesPerStop.stops)} stops`} />
        <KpiCard label="Repeat customers" value={pct(a.repeat.rate)} delta={d(a.repeat.rate, b?.repeat.rate, { rate: true })} hint={`${count(a.repeat.repeatCustomers)} of ${count(a.repeat.customers)} customers`} />
        <KpiCard label="Delivered" value={count(a.onTime.delivered)} delta={d(a.onTime.delivered, b?.onTime.delivered)} hint={`${count(a.daily.reduce((n, x) => n + x.failed, 0))} missed`} />
      </div>
      <div className="ops-cards">
        <section className="card" aria-labelledby="ops-fill">
          <h3 id="ops-fill">Slot fill</h3>
          <p className="muted small">Boxes booked against each slot's capacity on the days it ran.</p>
          <BarList
            label="Slot fill"
            items={a.slotFill.map((s) => ({
              key: s.slotId,
              label: s.label,
              sub: `${s.startsAt}–${s.endsAt}`,
              value: s.fill == null ? 0 : Math.round(s.fill * 100),
              display: s.fill == null ? 'No limit' : pct(s.fill),
              aside: `${count(s.boxes)} boxes${s.capacityBoxes ? ` of ${count(s.capacityBoxes)}` : ''}`,
              tone: (s.fill ?? 0) >= 0.9 ? 'warn' : 'teal',
            }))}
          />
        </section>
        <section className="card" aria-labelledby="ops-variety">
          <h3 id="ops-variety">Variety mix</h3>
          <BarList
            label="Boxes by variety"
            items={a.varieties.map((v) => ({ key: v.variety, label: v.variety, value: v.boxes, display: `${count(v.boxes)} boxes`, aside: `${count(v.orders)} orders` }))}
          />
        </section>
        <section className="card" aria-labelledby="ops-riders">
          <h3 id="ops-riders">Riders</h3>
          {a.riders.length === 0 ? (
            <p className="muted">No deliveries by riders in this period.</p>
          ) : (
            <div {...scrollRegion('Rider leaderboard', { cards: true })}>
              <table>
                <thead>
                  <tr>
                    <th>Rider</th>
                    <th className="num">Delivered</th>
                    <th className="num">Missed</th>
                    <th className="num">Median min per stop</th>
                    <th className="num">Photo checks</th>
                  </tr>
                </thead>
                <tbody>
                  {a.riders.map((r) => (
                    <tr key={r.id}>
                      <td className="card-title">{r.name}</td>
                      <td className="num" data-label="Delivered">
                        {count(r.delivered)}
                      </td>
                      <td className="num" data-label="Missed">
                        {count(r.failed)}
                      </td>
                      <td className="num" data-label="Median min per stop">
                        {r.medianMinutes ?? '—'}
                      </td>
                      <td className="num" data-label="Photo checks">
                        {r.flagged}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="card heat-map" aria-labelledby="ops-heat">
          <h3 id="ops-heat">Orders by pincode</h3>
          <MapView label="Map of orders by pincode" markers={[]} heat={heat} fitKey={`${a.from}-${a.to}`} empty={heat.length === 0 ? 'No pincode has a place on the map yet.' : null} />
          <div {...scrollRegion('Orders by pincode')}>
            <table>
              <thead>
                <tr>
                  <th>Pincode</th>
                  <th>Area</th>
                  <th className="num">Orders</th>
                  <th className="num">Boxes</th>
                </tr>
              </thead>
              <tbody>
                {a.pincodes.map((p) => (
                  <tr key={p.pincode}>
                    <td className="mono">{p.pincode}</td>
                    <td>{p.area ?? '—'}</td>
                    <td className="num">{count(p.orders)}</td>
                    <td className="num">{count(p.boxes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  )
}
