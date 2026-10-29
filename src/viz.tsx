// Small hand-drawn data visuals: sparklines, KPI cards, the ripeness timeline, the freshness strip,
// a pipeline bar and bar lists. Plain SVG and CSS, so Today and the stock screens load no chart
// library. They only draw figures the API returns (and display-only ratios between them).

import { useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { RIPENESS_LABEL } from './format'
import type { Ripeness, StageWindow } from './types'

// ---------- Sparkline ----------

/** A tiny trend line with a soft area under it and a dot on the latest value. Decorative: the value is beside it. */
export function Sparkline({ values, width = 96, height = 28, tone = 'teal' }: { values: (number | null)[]; width?: number; height?: number; tone?: 'teal' | 'warn' | 'bad' | 'muted' }) {
  const gid = useId().replace(/:/g, '')
  const pts = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v != null && Number.isFinite(p.v))
  if (pts.length < 2) return <svg className="spark" width={width} height={height} aria-hidden="true" />
  const min = Math.min(...pts.map((p) => p.v))
  const max = Math.max(...pts.map((p) => p.v))
  const span = max - min || 1
  const n = values.length - 1 || 1
  const x = (i: number) => 2 + (i / n) * (width - 4)
  const y = (v: number) => 3 + (1 - (v - min) / span) * (height - 6)
  const line = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const area = `${line} L${x(pts[pts.length - 1].i).toFixed(1)},${height} L${x(pts[0].i).toFixed(1)},${height} Z`
  const last = pts[pts.length - 1]
  return (
    <svg className={`spark spark-${tone}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`sg${gid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg${gid})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r="2.4" fill="currentColor" />
    </svg>
  )
}

// ---------- KPI card ----------

export interface Delta {
  /** "+12%", "−0.4 pts" */
  text: string
  dir: 'up' | 'down' | 'flat'
  /** What the change means, not which way it went: fewer claims is good. */
  tone: 'good' | 'bad' | 'neutral'
  /** Read after the value: "up 12% on the week before". */
  spoken: string
}

/**
 * The change between two returned figures, as a display-only percentage (or percentage points for
 * rates). Null when there is nothing to compare with.
 */
export function deltaOf(curr: number | null | undefined, prev: number | null | undefined, opts: { higherIsBetter?: boolean; rate?: boolean; against?: string } = {}): Delta | null {
  const { higherIsBetter = true, rate = false, against = 'the week before' } = opts
  if (curr == null || prev == null) return null
  let change: number
  let text: string
  if (rate) {
    change = (curr - prev) * 100
    const r = Math.round(change * 10) / 10
    text = `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toFixed(1)} pts`
  } else {
    if (prev === 0) {
      if (curr === 0) return { text: '±0%', dir: 'flat', tone: 'neutral', spoken: `no change on ${against}` }
      return null
    }
    change = ((curr - prev) / Math.abs(prev)) * 100
    const r = Math.round(change)
    text = `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r)}%`
  }
  const flat = Math.abs(change) < 0.5
  const dir = flat ? 'flat' : change > 0 ? 'up' : 'down'
  const better = dir === 'flat' ? null : (dir === 'up') === higherIsBetter
  return {
    text,
    dir,
    tone: better === null ? 'neutral' : better ? 'good' : 'bad',
    spoken: dir === 'flat' ? `about the same as ${against}` : `${dir} ${text.replace(/^[+−]/, '')} on ${against}`,
  }
}

export function DeltaChip({ delta }: { delta: Delta }) {
  const Icon = delta.dir === 'up' ? ArrowUpRight : delta.dir === 'down' ? ArrowDownRight : Minus
  return (
    <span className={`delta delta-${delta.tone}`}>
      <Icon aria-hidden="true" strokeWidth={2.25} />
      <span aria-hidden="true">{delta.text}</span>
      <span className="sr-only">{delta.spoken}</span>
    </span>
  )
}

/** A KPI: label, big value, change against the period before and a sparkline of the series. */
export function KpiCard({
  label,
  value,
  delta,
  spark,
  sparkTone,
  hint,
  className = '',
  to,
}: {
  label: string
  value: ReactNode
  delta?: Delta | null
  spark?: (number | null)[]
  sparkTone?: 'teal' | 'warn' | 'bad' | 'muted'
  hint?: ReactNode
  className?: string
  to?: string
}) {
  const body = (
    <>
      <div className="kpi-head">
        <span className="kpi-label">{label}</span>
        {delta && <DeltaChip delta={delta} />}
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">
        <span className="kpi-hint">{hint}</span>
        {spark && <Sparkline values={spark} width={72} height={24} tone={sparkTone ?? (delta?.tone === 'bad' ? 'bad' : 'teal')} />}
      </div>
    </>
  )
  return to ? (
    <Link to={to} className={`kpi kpi-link ${className}`}>
      {body}
    </Link>
  ) : (
    <div className={`kpi ${className}`}>{body}</div>
  )
}

// ---------- Freshness strip ----------

/**
 * One cell per day from picking to the sell limit: filled up to the batch's age, leaf to saffron to
 * blush as it ripens, red once it is past the limit. Decorative beside the age it shows.
 */
export function FreshnessStrip({ ageDays, maxAge }: { ageDays: number; maxAge: number }) {
  const days = Array.from({ length: Math.max(1, maxAge) + 1 }, (_, d) => d)
  const over = ageDays > maxAge
  return (
    <span className={`fresh${over ? ' fresh-over' : ''}`} aria-hidden="true" title={`Day ${ageDays} of ${maxAge}`}>
      {days.map((d) => {
        const t = maxAge ? d / maxAge : 1
        const stage = t < 0.4 ? 'raw' : t < 0.75 ? 'semi' : 'ripe'
        return <span key={d} className={`fresh-cell fresh-${stage}${d <= ageDays ? ' on' : ''}${d === ageDays ? ' now' : ''}`} />
      })}
      {over && <span className="fresh-cell fresh-past on now" />}
    </span>
  )
}

// ---------- Ripeness timeline ----------

const STAGE_CLASS: Record<Ripeness, string> = { RAW: 'raw', SEMI_RIPE: 'semi', RIPE: 'ripe' }

/**
 * A batch's life on one track: its ripeness windows by age (the selling rules), the sell-by limit,
 * and a marker for today. The windows come from the rules; without them the track shows age against
 * the sell limit only. The server still decides each box's stage (age on the delivery day, shifted by QC).
 */
export function RipenessTimeline({
  ageDays,
  maxSellableAge,
  retireAge,
  windows,
  latest,
}: {
  ageDays: number
  maxSellableAge: number
  retireAge?: number | null
  windows?: StageWindow[] | null
  latest?: Ripeness | null
}) {
  const titleId = useId()
  const lastWindow = Math.max(0, ...(windows ?? []).map((w) => w.maxAge))
  const end = Math.max(maxSellableAge + 2, (retireAge ?? 0) + 1, ageDays + 2, lastWindow + 2)
  const pos = (day: number) => `${(day / end) * 100}%`
  const width = (from: number, to: number) => `${((to - from) / end) * 100}%`
  const left = maxSellableAge - ageDays
  const status = ageDays > maxSellableAge ? 'Past the sell-by limit' : left === 0 ? 'Last day it can be sold' : `${left} ${left === 1 ? 'day' : 'days'} left to sell`
  const current = windows?.find((w) => ageDays >= w.minAge && ageDays <= w.maxAge)?.stage ?? null
  const ticks = Array.from({ length: end + 1 }, (_, d) => d)
  const tickEvery = end > 14 ? 2 : 1

  return (
    <figure className="ripeline" aria-labelledby={titleId}>
      <figcaption id={titleId} className="ripeline-caption">
        <span className="ripeline-title">Ripeness timeline</span>
        <span className="ripeline-facts">
          Day {ageDays}
          {current && <> · usually {RIPENESS_LABEL[current].toLowerCase()} by age</>}
          {latest && <> · last QC {RIPENESS_LABEL[latest].toLowerCase()}</>} · <strong className={ageDays > maxSellableAge ? 'text-danger' : left <= 1 ? 'text-warn' : undefined}>{status}</strong>
        </span>
      </figcaption>
      <div className="ripeline-track" aria-hidden="true">
        {windows && windows.length > 0 ? (
          windows.map((w) => (
            <span key={w.stage} className={`ripeline-seg ripe-${STAGE_CLASS[w.stage]}`} style={{ left: pos(w.minAge), width: width(w.minAge, Math.min(w.maxAge, maxSellableAge) + 1) }}>
              <span className="ripeline-seg-label">{RIPENESS_LABEL[w.stage]}</span>
            </span>
          ))
        ) : (
          <span className="ripeline-seg ripeline-seg-plain" style={{ left: 0, width: width(0, maxSellableAge + 1) }}>
            <span className="ripeline-seg-label">Sellable</span>
          </span>
        )}
        <span className="ripeline-past" style={{ left: pos(maxSellableAge + 1), width: width(maxSellableAge + 1, end) }}>
          <span className="ripeline-seg-label">Past sell-by</span>
        </span>
        <span className="ripeline-limit" style={{ left: pos(maxSellableAge + 1) }} />
        <span className="ripeline-now" style={{ left: `calc(${pos(ageDays)} + ${(0.5 / end) * 100}%)` }}>
          <span className="ripeline-now-label">Today</span>
        </span>
      </div>
      <div className="ripeline-axis" aria-hidden="true">
        {ticks.map((d) =>
          d % tickEvery === 0 && d < end ? (
            <span key={d} style={{ left: `calc(${pos(d)} + ${(0.5 / end) * 100}%)` }} className={d === ageDays ? 'is-now' : undefined}>
              {d === 0 ? 'Picked' : `d${d}`}
            </span>
          ) : null,
        )}
      </div>
      <p className="sr-only">
        Picked {ageDays} {ageDays === 1 ? 'day' : 'days'} ago. Sold up to day {maxSellableAge}.
        {windows?.map((w) => ` ${RIPENESS_LABEL[w.stage]}: days ${w.minAge} to ${w.maxAge}.`)}
      </p>
    </figure>
  )
}

// ---------- Pipeline bar ----------

export interface PipelineSegment {
  key: string
  label: string
  count: number
  tone: string
}

/** Open orders by stage on one bar, with a legend. The tiles under it carry the same numbers as links. */
export function PipelineBar({ segments, label, legend = true }: { segments: PipelineSegment[]; label: string; legend?: boolean }) {
  const total = segments.reduce((a, s) => a + s.count, 0)
  return (
    <div className="pipeline" role="img" aria-label={`${label}: ${segments.map((s) => `${s.count} ${s.label.toLowerCase()}`).join(', ')}`}>
      <div className="pipeline-bar">
        {total === 0 ? (
          <span className="pipeline-empty" />
        ) : (
          segments
            .filter((s) => s.count > 0)
            .map((s) => <span key={s.key} className={`pipeline-seg pipe-${s.tone}`} style={{ flexGrow: s.count }} />)
        )}
      </div>
      {legend && (
      <ul className="pipeline-legend">
        {segments.map((s) => (
          <li key={s.key}>
            <span className={`pipeline-dot pipe-${s.tone}`} />
            {s.label} <span className="tnum">{s.count}</span>
          </li>
        ))}
      </ul>
      )}
    </div>
  )
}

// ---------- Bar list ----------

export interface BarItem {
  key: string
  label: ReactNode
  sub?: ReactNode
  value: number
  display: ReactNode
  /** A second, smaller figure on the right ("8% wasted"). */
  aside?: ReactNode
  tone?: 'teal' | 'warn' | 'bad'
}

/** Ranked horizontal bars (by product, at-risk): label, bar to scale, the figure. */
export function BarList({ items, label }: { items: BarItem[]; label: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <ul className="barlist" aria-label={label}>
      {items.map((i) => (
        <li key={i.key} className="barlist-row">
          <div className="barlist-text">
            <span className="barlist-label">{i.label}</span>
            {i.sub && <span className="barlist-sub">{i.sub}</span>}
          </div>
          <div className="barlist-track" aria-hidden="true">
            <span className={`barlist-fill barlist-${i.tone ?? 'teal'}`} style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} />
          </div>
          <div className="barlist-value">
            {i.display}
            {i.aside && <span className="barlist-aside">{i.aside}</span>}
          </div>
        </li>
      ))}
    </ul>
  )
}
