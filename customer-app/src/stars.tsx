import { useId, useRef, type KeyboardEvent } from 'react'
import type { RatingSummary } from './api'
import { useT } from './i18n'
import { t } from './i18n-core.ts'

const STAR_PATH = 'M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z'

/** One star mark: filled when on, otherwise an outline at 3:1 so an empty star is still seen (WCAG 1.4.11). */
function StarMark({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" className={on ? 'star-mark on' : 'star-mark'}>
      <path d={STAR_PATH} fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}

/** "Poor" to "Loved them" for 1 to 5 stars, in the shop's language ('' for none). */
export const STAR_WORDS: readonly string[] = new Proxy(['', '', '', '', '', ''], {
  get: (target, prop) => (typeof prop === 'string' && /^[1-5]$/.test(prop) ? t(`stars.word${prop as '1'}`) : Reflect.get(target, prop)),
})

/**
 * A 1 to 5 star picker that works like a radio group: Tab reaches it once,
 * arrow keys move the choice, and a screen reader hears "3 stars, Okay,
 * selected". `optional` adds no extra stop; an unset value is announced as such.
 */
export function StarInput({
  label,
  value,
  onChange,
  size = 'big',
  describedBy,
}: {
  label: string
  value: number | null
  onChange: (n: number) => void
  size?: 'big' | 'small'
  describedBy?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const t = useT()
  // useId, not the label: a Hindi or Kannada label has no Latin letters to make a unique id from.
  const labelId = `stars-${useId().replace(/:/g, '')}`
  const pick = (n: number) => {
    onChange(n)
    refs.current[n - 1]?.focus()
  }
  const onKey = (e: KeyboardEvent) => {
    // Move from the chosen star, or from the focused one when none is chosen
    // (like native radios: focus on star 1, then ArrowRight picks 2).
    const focused = refs.current.findIndex((el) => el === document.activeElement)
    const cur = value ?? (focused >= 0 ? focused + 1 : 0)
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') pick(Math.min(5, cur + 1))
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') pick(Math.max(1, cur - 1))
    else if (e.key === 'Home') pick(1)
    else if (e.key === 'End') pick(5)
    else return
    e.preventDefault()
  }
  return (
    <div className={`star-input ${size}`}>
      <span id={labelId} className={size === 'big' ? 'label' : 'label small-label'}>
        {label}
      </span>
      <div className="stars" role="radiogroup" aria-labelledby={labelId} aria-describedby={describedBy} onKeyDown={onKey}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            ref={(el) => (refs.current[n - 1] = el)}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={t('stars.option', { count: n, word: STAR_WORDS[n] })}
            // One tab stop: the chosen star, or the first one when none is chosen.
            tabIndex={(value ?? 1) === n ? 0 : -1}
            className={value != null && n <= value ? 'star on' : 'star'}
            onClick={() => pick(n)}
          >
            <StarMark on={value != null && n <= value} />
          </button>
        ))}
        {value != null && (
          <span className="muted small" aria-hidden="true">
            {STAR_WORDS[value]}
          </span>
        )}
      </div>
    </div>
  )
}

/** Stars shown read-only, e.g. "4 out of 5 stars". Half stars round to the nearest whole. */
export function Stars({ value, small = false }: { value: number; small?: boolean }) {
  const full = Math.round(value)
  const t = useT()
  return (
    <span className={small ? 'stars-shown small' : 'stars-shown'} role="img" aria-label={t('stars.outOf5', { value })}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarMark key={n} on={n <= full} />
      ))}
    </span>
  )
}

/** Average, count and one bar per star level; a bar can filter the list. */
export function RatingBars({ summary, active, onPick }: { summary: RatingSummary; active?: number | null; onPick?: (n: number | null) => void }) {
  const max = Math.max(1, ...Object.values(summary.distribution))
  const t = useT()
  return (
    <div className="rating-summary">
      <div className="rating-avg">
        <strong>{summary.average != null ? summary.average.toFixed(1) : '–'}</strong>
        {summary.average != null && <Stars value={summary.average} />}
        <span className="muted small">
          {t('stars.reviewCount', { count: summary.count })}
        </span>
      </div>
      <ul className="rating-bars" aria-label={t('stars.byStars')}>
        {[5, 4, 3, 2, 1].map((n) => {
          const count = summary.distribution[String(n) as '1']
          const body = (
            <>
              <span className="bar-label">{n} ★</span>
              <span className="bar" aria-hidden="true">
                <span style={{ width: `${(count / max) * 100}%` }} />
              </span>
              <span className="bar-count">{count}</span>
            </>
          )
          return (
            <li key={n}>
              {onPick ? (
                <button
                  type="button"
                  className={active === n ? 'bar-row on' : 'bar-row'}
                  aria-pressed={active === n}
                  aria-label={t(active === n ? 'stars.barShowing' : 'stars.barShow', { stars: n, count })}
                  onClick={() => onPick(active === n ? null : n)}
                >
                  {body}
                </button>
              ) : (
                <span className="bar-row">{body}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
