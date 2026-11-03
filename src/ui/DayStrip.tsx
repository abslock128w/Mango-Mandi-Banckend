// The Day strip (docs/design/ops-dashboard-v2.md §2.3): the operating day as one timeline, IST,
// with a now-marker and one lane per delivery slot: order cutoff → pack by → dispatch by → the
// window. Each lane shows where its orders are (a stacked bar) and the next deadline as a
// "due in" or "late by" pill. A lane is a link to that slot on Deliveries.
import { Link } from 'react-router-dom'
import type { DayPlan, DaySlot } from '../ops/types'
import { clock, dueOf, fraction, slotPhase } from '../ops/time'

const SEGMENTS: [keyof DaySlot['counts'], string, string][] = [
  ['waiting', 'not packed', 'confirmed'],
  ['packed', 'packed', 'packed'],
  ['out', 'out', 'out'],
  ['delivered', 'delivered', 'shipped'],
  ['failed', 'failed', 'failed'],
]

/** The strip runs from the earliest deadline to the latest window end, padded to whole hours. */
function range(slots: DaySlot[]): [number, number] {
  const times = slots.flatMap((s) => [s.orderCutoffAt, s.packByAt, s.windowEndAt].filter((x): x is string => Boolean(x)).map((t) => new Date(t).getTime()))
  const hour = 3_600_000
  const from = Math.floor(Math.min(...times) / hour) * hour
  const to = Math.ceil(Math.max(...times) / hour) * hour
  // A cutoff the evening before would squeeze the lanes: the strip starts at most 3 hours before the first pack-by.
  const firstPack = Math.min(...slots.map((s) => new Date(s.packByAt).getTime()))
  return [Math.max(from, Math.floor((firstPack - 3 * hour) / hour) * hour), to]
}

export function DayStrip({ plan, nowMs, linkTo }: { plan: DayPlan; nowMs: number; linkTo: (slot: DaySlot) => string }) {
  if (plan.slots.length === 0) return <p className="muted">No delivery slots are set up for this day.</p>
  const [from, to] = range(plan.slots)
  const pos = (iso: string | null) => (iso ? `${(fraction(from, to, new Date(iso).getTime()) * 100).toFixed(2)}%` : null)
  const nowPos = nowMs >= from && nowMs <= to ? `${(fraction(from, to, nowMs) * 100).toFixed(2)}%` : null
  const hours: number[] = []
  for (let t = from; t <= to; t += 3_600_000) hours.push(t)
  const step = hours.length > 10 ? 2 : 1
  return (
    <div className="day-strip">
      <div className="day-axis" aria-hidden="true">
        {hours.map((t, i) =>
          i % step === 0 ? (
            <span key={t} className="day-tick" style={{ left: `${(fraction(from, to, t) * 100).toFixed(2)}%` }}>
              {clock(t)}
            </span>
          ) : null,
        )}
      </div>
      <ol className="day-lanes">
        {plan.slots.map((s) => {
          const { next, nextLabel, phase } = slotPhase(nowMs, s)
          const due = dueOf(nowMs, next)
          const total = SEGMENTS.reduce((n, [k]) => n + s.counts[k], 0)
          const behind = phase !== 'over' && phase !== 'ordering' && phase !== 'packing' && s.counts.waiting > 0
          const pill = phase === 'over' ? 'Window over' : due ? `${nextLabel} ${clock(next!)} · ${due.text}` : null
          const spoken = `${s.label}, ${s.startsAt} to ${s.endsAt}: ${total} ${total === 1 ? 'order' : 'orders'}, ${SEGMENTS.map(([k, word]) => `${s.counts[k]} ${word}`).join(', ')}. ${pill ?? ''}`
          return (
            <li key={s.id} className="day-lane">
              <Link to={linkTo(s)} className="day-lane-link" aria-label={spoken}>
                <span className="day-lane-head" aria-hidden="true">
                  <span className="day-lane-name">{s.label}</span>
                  <span className="day-lane-window tnum">
                    {s.startsAt}–{s.endsAt}
                  </span>
                  {pill && <span className={`due-pill${due?.late || behind ? ' is-late' : ''}`}>{pill}</span>}
                </span>
                <span className="day-track" aria-hidden="true">
                  {s.orderCutoffAt && pos(s.orderCutoffAt) && <span className="day-mark day-mark-cutoff" style={{ left: pos(s.orderCutoffAt)! }} title={`Order cutoff ${clock(s.orderCutoffAt)}`} />}
                  <span className="day-span day-span-prep" style={{ left: pos(s.packByAt)!, width: `calc(${pos(s.windowStartAt)} - ${pos(s.packByAt)})` }} />
                  <span className="day-mark day-mark-pack" style={{ left: pos(s.packByAt)! }} title={`Pack by ${clock(s.packByAt)}`} />
                  <span className="day-mark day-mark-dispatch" style={{ left: pos(s.dispatchByAt)! }} title={`Dispatch by ${clock(s.dispatchByAt)}`} />
                  <span className="day-span day-span-window" style={{ left: pos(s.windowStartAt)!, width: `calc(${pos(s.windowEndAt)} - ${pos(s.windowStartAt)})` }}>
                    <span className="day-progress">
                      {total === 0 ? (
                        <span className="day-progress-empty" />
                      ) : (
                        SEGMENTS.filter(([k]) => s.counts[k] > 0).map(([k, , tone]) => <span key={k} className={`pipeline-seg pipe-${tone}`} style={{ flexGrow: s.counts[k] }} />)
                      )}
                    </span>
                  </span>
                  {nowPos && <span className="day-now" style={{ left: nowPos }} />}
                </span>
                <span className="day-lane-counts small" aria-hidden="true">
                  {SEGMENTS.filter(([k]) => s.counts[k] > 0).map(([k, word]) => (
                    <span key={k} className="day-count">
                      <span className={`pipeline-dot pipe-${SEGMENTS.find((x) => x[0] === k)![2]}`} />
                      <span className="tnum">{s.counts[k]}</span> {word}
                    </span>
                  ))}
                  {total === 0 && <span className="muted">No orders</span>}
                  {s.unassigned > 0 && <span className="day-count text-warn">{s.unassigned} without a rider</span>}
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
      <p className="day-legend small muted" aria-hidden="true">
        <span className="day-key day-key-pack" /> Pack by <span className="day-key day-key-dispatch" /> Dispatch by <span className="day-key day-key-window" /> Delivery window
        {nowPos && (
          <>
            {' '}
            <span className="day-key day-key-now" /> Now {clock(nowMs)}
          </>
        )}
      </p>
    </div>
  )
}
