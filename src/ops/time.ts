// The operating day's clock (pure, unit-tested in tests/unit/ops-time.unit.ts): how long until a
// deadline or how late it is, how old a position is, and where a slot stands. Times are shown in IST.

const MIN = 60_000

const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** "06:45" in IST. */
export const clock = (iso: string | number | Date) => timeFmt.format(new Date(iso))

/** "38 min", "2 h 5 min", "3 days". */
export function span(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  if (m < 48 * 60) {
    const h = Math.floor(m / 60)
    const r = m % 60
    return r ? `${h} h ${r} min` : `${h} h`
  }
  return `${Math.round(m / 1440)} days`
}

export interface Due {
  /** "due in 38 min", "late by 12 min", "due now". */
  text: string
  late: boolean
  /** Minutes until the deadline (negative once it has passed). */
  minutes: number
}

/** How far a deadline is from now. Under a minute either way is "due now". */
export function dueOf(nowMs: number, at: string | null | undefined): Due | null {
  if (!at) return null
  const minutes = (new Date(at).getTime() - nowMs) / MIN
  if (Number.isNaN(minutes)) return null
  if (Math.abs(minutes) < 1) return { text: 'due now', late: false, minutes: 0 }
  return minutes > 0 ? { text: `due in ${span(minutes)}`, late: false, minutes } : { text: `late by ${span(-minutes)}`, late: true, minutes }
}

/** "4 min ago", "just now", or null when never. */
export function ago(nowMs: number, at: string | null | undefined): string | null {
  if (!at) return null
  const minutes = (nowMs - new Date(at).getTime()) / MIN
  if (Number.isNaN(minutes)) return null
  if (minutes < 1) return 'just now'
  return `${span(minutes)} ago`
}

/** Minutes since a time (Infinity when never). */
export const minutesSince = (nowMs: number, at: string | null | undefined) => (at ? (nowMs - new Date(at).getTime()) / MIN : Number.POSITIVE_INFINITY)

/** A rider's position: fresh under 5 minutes, stale under 30 (the "rider silent" line), else old; none when never. */
export type Freshness = 'fresh' | 'stale' | 'old' | 'none'
export const SILENT_AFTER_MIN = 30
export function freshness(nowMs: number, at: string | null | undefined): Freshness {
  if (!at) return 'none'
  const m = minutesSince(nowMs, at)
  return m < 5 ? 'fresh' : m < SILENT_AFTER_MIN ? 'stale' : 'old'
}

export interface SlotTimes {
  orderCutoffAt: string | null
  packByAt: string
  dispatchByAt: string
  windowStartAt: string
  windowEndAt: string
}

/** Where a slot is on the clock: the next deadline it faces and what that deadline is called. */
export type SlotPhase = 'ordering' | 'packing' | 'dispatch' | 'window' | 'over'
export function slotPhase(nowMs: number, s: SlotTimes): { phase: SlotPhase; next: string | null; nextLabel: string | null } {
  const t = (iso: string | null) => (iso ? new Date(iso).getTime() : null)
  const cutoff = t(s.orderCutoffAt)
  if (cutoff !== null && nowMs < cutoff) return { phase: 'ordering', next: s.orderCutoffAt, nextLabel: 'Order cutoff' }
  if (nowMs < t(s.packByAt)!) return { phase: 'packing', next: s.packByAt, nextLabel: 'Pack by' }
  if (nowMs < t(s.dispatchByAt)!) return { phase: 'dispatch', next: s.dispatchByAt, nextLabel: 'Dispatch by' }
  if (nowMs < t(s.windowEndAt)!) return { phase: 'window', next: s.windowEndAt, nextLabel: 'Window ends' }
  return { phase: 'over', next: null, nextLabel: null }
}

/** Where a time falls between two others, 0 to 1 (for the Day strip's now-marker and lanes). */
export function fraction(from: number, to: number, at: number): number {
  if (to <= from) return 0
  return Math.min(1, Math.max(0, (at - from) / (to - from)))
}

/** Midnight to midnight in IST for YYYY-MM-DD, as epoch ms. */
export function istDayBounds(day: string): [number, number] {
  const start = new Date(`${day}T00:00:00+05:30`).getTime()
  return [start, start + 24 * 60 * MIN]
}

/** The start of tomorrow in IST: when a "snooze until tomorrow" ends. */
export function tomorrowStartIST(nowMs: number): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(nowMs))
  return istDayBounds(day)[1]
}
