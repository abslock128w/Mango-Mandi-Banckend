// The Analytics charts, drawn with Recharts. A chunk of its own, loaded only by the Analytics page,
// so no other screen pays for the chart library. Every number here is also in the week-by-week table
// under the charts, so the drawings are hidden from screen readers and each chart says in words what
// it shows.

import { useEffect, useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { count, date, rupeesCompact, rupeesWhole } from '../format'
import type { AnalyticsWeek } from '../types'

const weekLabel = (w: string) => date(w).replace(/,? \d{4}$/, '')
const pct = (r: number | null | undefined) => (r == null ? '—' : `${Math.round(r * 1000) / 10}%`)

/** The chart colours from the tokens (SVG attributes can't read CSS variables), redone when the theme flips. */
function usePalette() {
  const read = () => {
    const css = getComputedStyle(document.documentElement)
    const v = (name: string) => css.getPropertyValue(name).trim()
    return { c1: v('--chart-1'), c2: v('--chart-2'), c3: v('--chart-3'), c4: v('--chart-4'), grid: v('--chart-grid'), muted: v('--color-muted') }
  }
  const [p, setP] = useState(read)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setP(read())
    mq.addEventListener('change', on)
    // The panel's own theme switch (src/theme.ts).
    window.addEventListener('mm:theme', on)
    return () => {
      mq.removeEventListener('change', on)
      window.removeEventListener('mm:theme', on)
    }
  }, [])
  return p
}

interface Row {
  week: string
  label: string
  revenue: number
  orders: number
  boxes: number
  replacements: number
  wasted: number
  received: number
  wastage: number | null
  atRisk: number | null
  raw: AnalyticsWeek
}

function rows(weeks: AnalyticsWeek[]): Row[] {
  return weeks.map((w) => ({
    week: w.weekStart,
    label: weekLabel(w.weekStart),
    revenue: w.revenue / 100,
    orders: w.orders,
    boxes: w.boxes,
    replacements: w.replacements,
    wasted: w.wasted,
    received: w.received,
    wastage: w.wastageRate == null ? null : w.wastageRate * 100,
    atRisk: w.atRiskRate == null ? null : w.atRiskRate * 100,
    raw: w,
  }))
}

function Tip({ active, payload, lines }: { active?: boolean; payload?: readonly { payload?: unknown }[]; lines: (w: AnalyticsWeek) => [string, string, string][] }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload as Row
  return (
    <div className="chart-tip tip">
      <p className="tip-title">Week of {r.label}</p>
      <ul className="tip-rows">
        {lines(r.raw).map(([swatch, label, value]) => (
          <li key={label}>
            {swatch && <span className="legend-swatch" style={{ background: swatch }} />}
            {label}
            <span className="tip-val">{value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChartCard({ title, sub, label, legend, wide, children }: { title: string; sub: string; label: string; legend?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`card chart-card${wide ? ' chart-wide' : ''}`}>
      <div className="chart-head">
        <div>
          <h2>{title}</h2>
          <p className="muted small">{sub}</p>
        </div>
        {legend}
      </div>
      <div role="group" aria-label={label} className="chart-figure">
        <div className="chart-box" aria-hidden="true">
          {children}
        </div>
      </div>
    </section>
  )
}

const axis = { tickLine: false, axisLine: false, fontSize: 11 } as const

export default function AnalyticsCharts({ weeks }: { weeks: AnalyticsWeek[] }) {
  const p = usePalette()
  const data = rows(weeks)
  const n = weeks.length
  const peak = <K extends keyof AnalyticsWeek>(k: K) => weeks.reduce((best, w) => ((w[k] as number) > (best[k] as number) ? w : best), weeks[0])
  const topRevenue = peak('revenue')
  const topBoxes = peak('boxes')
  const grid = <CartesianGrid vertical={false} stroke={p.grid} />
  const x = <XAxis dataKey="label" {...axis} tick={{ fill: p.muted }} interval="preserveStartEnd" minTickGap={12} />
  const cursor = { fill: p.grid, opacity: 0.6 }

  return (
    <div className="chart-grid">
      <ChartCard
        title="Sales per week"
        sub="By delivery date, in rupees."
        label={`Weekly sales, ${n} weeks, highest ${rupeesWhole(topRevenue.revenue)} in the week of ${weekLabel(topRevenue.weekStart)}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} accessibilityLayer={false}>
            {grid}
            {x}
            <YAxis {...axis} tick={{ fill: p.muted }} width={56} tickFormatter={(v: number) => rupeesCompact(v * 100)} />
            <Tooltip
              cursor={cursor}
              content={(t) => (
                <Tip
                  active={t.active}
                  payload={t.payload}
                  lines={(w) => [
                    [p.c1, 'Sales', rupeesWhole(w.revenue)],
                    ['', 'Orders', count(w.orders)],
                    ['', 'Boxes sold', count(w.boxes)],
                  ]}
                />
              )}
            />
            <Bar dataKey="revenue" name="Sales" fill={p.c1} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Boxes per week"
        sub="Sold, sent again as replacements, and wasted."
        label={`Weekly boxes, ${n} weeks, highest ${topBoxes.boxes} sold in the week of ${weekLabel(topBoxes.weekStart)}`}
        legend={
          <ul className="chart-legend">
            <li>
              <span className="legend-swatch sw-1" />
              Sold
            </li>
            <li>
              <span className="legend-swatch sw-3" />
              Replaced
            </li>
            <li>
              <span className="legend-swatch sw-4" />
              Wasted
            </li>
          </ul>
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} accessibilityLayer={false}>
            {grid}
            {x}
            <YAxis {...axis} tick={{ fill: p.muted }} width={40} allowDecimals={false} />
            <Tooltip
              cursor={cursor}
              content={(t) => (
                <Tip
                  active={t.active}
                  payload={t.payload}
                  lines={(w) => [
                    [p.c1, 'Sold', `${count(w.boxes)} boxes`],
                    [p.c3, 'Replaced', `${count(w.replacements)} boxes`],
                    [p.c4, 'Wasted', `${count(w.wasted)} boxes`],
                    ['', 'Received', `${count(w.received)} boxes`],
                  ]}
                />
              )}
            />
            <Bar dataKey="boxes" name="Sold" stackId="b" fill={p.c1} maxBarSize={44} isAnimationActive={false} />
            <Bar dataKey="replacements" name="Replaced" stackId="b" fill={p.c3} maxBarSize={44} isAnimationActive={false} />
            <Bar dataKey="wasted" name="Wasted" stackId="b" fill={p.c4} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        wide
        title="Wastage and orders at risk"
        sub="Boxes wasted as a share of boxes received, and orders whose stock fell through as a share of orders."
        label={`Weekly rates, ${n} weeks: wastage and orders at risk, in percent`}
        legend={
          <ul className="chart-legend">
            <li>
              <span className="legend-line sw-4" />
              Wasted
            </li>
            <li>
              <span className="legend-line dashed sw-3" />
              Orders at risk
            </li>
          </ul>
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} accessibilityLayer={false}>
            {grid}
            {x}
            <YAxis {...axis} tick={{ fill: p.muted }} width={44} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip
              cursor={{ stroke: p.muted, strokeDasharray: '3 3' }}
              content={(t) => (
                <Tip
                  active={t.active}
                  payload={t.payload}
                  lines={(w) => [
                    [p.c4, 'Wasted', `${pct(w.wastageRate)} of ${count(w.received)}`],
                    [p.c3, 'At risk', `${pct(w.atRiskRate)} of ${count(w.orders)}`],
                  ]}
                />
              )}
            />
            <Line type="monotone" dataKey="wastage" name="Wasted" stroke={p.c4} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: p.c4 }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="atRisk" name="Orders at risk" stroke={p.c3} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, strokeWidth: 0, fill: p.c3 }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  )
}
