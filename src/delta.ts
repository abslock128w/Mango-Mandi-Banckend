// Week-on-week changes for the KPI cards (Today, Analytics): the display-only change between two returned figures,
// and which weeks may be compared. Plain TypeScript (no React), so tests/unit/delta.unit.ts runs it as it is.

export interface Delta {
  /** "+12%", "−0.4 pts", "New" */
  text: string
  dir: 'up' | 'down' | 'flat'
  /** What the change means, not which way it went: fewer claims is good. */
  tone: 'good' | 'bad' | 'neutral'
  /** Read after the value: "up 12% on the week before". */
  spoken: string
}

/**
 * The change between two returned figures, as a display-only percentage (or percentage points for
 * rates): (curr − prev) / prev, so more than before is up. Null when there is nothing to compare with.
 * Nothing before and something now is "New", not a percentage (there is none from zero).
 */
export function deltaOf(curr: number | null | undefined, prev: number | null | undefined, opts: { higherIsBetter?: boolean; rate?: boolean; against?: string } = {}): Delta | null {
  const { higherIsBetter = true, rate = false, against = 'the week before' } = opts
  if (curr == null || prev == null) return null
  // pg answers bigint sums as strings: compare numbers, never "0" against 0.
  const [c, p] = [Number(curr), Number(prev)]
  if (!Number.isFinite(c) || !Number.isFinite(p)) return null
  let change: number
  let text: string
  if (rate) {
    change = (c - p) * 100
    const r = Math.round(change * 10) / 10
    text = `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toFixed(1)} pts`
  } else {
    if (p === 0) {
      if (c === 0) return { text: '±0%', dir: 'flat', tone: 'neutral', spoken: `no change on ${against}` }
      return { text: 'New', dir: 'up', tone: higherIsBetter ? 'good' : 'bad', spoken: `new: none in ${against}` }
    }
    change = ((c - p) / Math.abs(p)) * 100
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

/** The day after `day` by `n` days, as YYYY-MM-DD (calendar days, no time zone). */
const plusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/**
 * Weeks that have ended by `today` (YYYY-MM-DD, IST): Monday to Sunday, so a week starting on `w` is over once today is
 * `w` + 7 or later. The current week is still filling up (on a Wednesday it has three days of sales at most, and the
 * range runs to its Sunday), so it is left out of a week-on-week comparison: comparing it read "−100%" beside a
 * range total of ₹1,55,266.
 */
export function fullWeeks<W extends { weekStart: string }>(weeks: W[], today: string): W[] {
  return weeks.filter((w) => plusDays(w.weekStart, 7) <= today)
}

/** The last full week and the one before it, to compare; null when the range has fewer than two full weeks. */
export function lastTwoFullWeeks<W extends { weekStart: string }>(weeks: W[], today: string): { last: W; prev: W } | null {
  const full = fullWeeks(weeks, today)
  return full.length >= 2 ? { last: full[full.length - 1], prev: full[full.length - 2] } : null
}
