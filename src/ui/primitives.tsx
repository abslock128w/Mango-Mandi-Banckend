// Mango Ops v2 primitives (docs/design/ops-dashboard-v2.md §1): keycaps, the in-page header,
// the Day switcher, compact stats, attention queue rows and the peek drawer.
import { useId, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BellOff, ExternalLink, MoreHorizontal } from 'lucide-react'
import { istDate } from '../format'
import { OWNER_LABEL, SEVERITY_LABEL, type QueueEntry } from '../ops/queue'
import { ago } from '../ops/time'
import { Dialog } from './core'

// ---------- Kbd ----------

/** One key, or a chord as keycaps in a row ("g" "o"). Read out by the text around it, never alone. */
export function Kbd({ keys, label }: { keys: string | string[]; label?: string }) {
  const list = Array.isArray(keys) ? keys : [keys]
  return (
    <span className="kbd-chord" aria-label={label} role={label ? 'img' : undefined}>
      {list.map((k, i) => (
        <kbd key={i} className="kbd" aria-hidden={label ? true : undefined}>
          {k}
        </kbd>
      ))}
    </span>
  )
}

// ---------- PageHeader ----------

/** The page's title with its primary actions on the right; sticks under the top bar while scrolling. */
export function PageHeader({ title, meta, actions, sticky = true }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode; sticky?: boolean }) {
  return (
    <div className={`page-head${sticky ? ' page-head-sticky' : ''}`}>
      <div className="page-head-title">
        <h1>{title}</h1>
        {meta && <div className="page-head-meta">{meta}</div>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </div>
  )
}

// ---------- Day switcher ----------

/**
 * Today / Tomorrow / a date, kept in the URL as ?date= so a link, a reload and Back keep the day.
 * The date input and the "Pick a day" group keep the names the Deliveries page always had.
 */
export function useDay(defaultDay: 'today' | 'tomorrow' = 'tomorrow'): [string, (d: string) => void] {
  const [params, setParams] = useSearchParams()
  const fallback = defaultDay === 'today' ? istDate(0) : istDate(1)
  const day = params.get('date') || fallback
  const set = (value: string) => {
    const p = new URLSearchParams(params)
    if (value) p.set('date', value)
    else p.delete('date')
    setParams(p, { replace: true })
  }
  return [day, set]
}

export function DaySwitcher({ day, onChange, id = 'day-date', label = 'Delivery date' }: { day: string; onChange: (d: string) => void; id?: string; label?: string }) {
  const today = istDate(0)
  const tomorrow = istDate(1)
  return (
    <div className="day-switcher">
      <div className="field m-0">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <input id={id} type="date" value={day} onChange={(e) => onChange(e.target.value)} />
      </div>
      <div className="segmented" role="group" aria-label="Pick a day">
        <button type="button" className="btn" aria-pressed={day === today} onClick={() => onChange(today)}>
          Today
        </button>
        <button type="button" className="btn" aria-pressed={day === tomorrow} onClick={() => onChange(tomorrow)}>
          Tomorrow
        </button>
      </div>
    </div>
  )
}

// ---------- Stat ----------

/** A compact number with a label and one line of detail; a link when `to` is given. */
export function Stat({ label, value, hint, to, tone }: { label: string; value: ReactNode; hint?: ReactNode; to?: string; tone?: 'warn' | 'bad' | 'good' }) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className={`stat-value tnum${tone ? ` text-${tone === 'bad' ? 'danger' : tone === 'warn' ? 'warn' : 'success'}` : ''}`}>{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </>
  )
  return to ? (
    <Link to={to} className="stat stat-link">
      {body}
    </Link>
  ) : (
    <div className="stat">{body}</div>
  )
}

// ---------- Severity and owner chips ----------

export function SeverityChip({ severity }: { severity: QueueEntry['severity'] }) {
  return <span className={`sev sev-${severity}`}>{SEVERITY_LABEL[severity]}</span>
}

// ---------- QueueItem ----------

/**
 * One problem in the Attention queue: severity, what, why, age, owner, one primary action, and an
 * overflow with Snooze until tomorrow and Open. The overflow is a disclosure (Escape closes it).
 */
export function QueueItem({ entry, nowMs, onSnooze, onNavigate }: { entry: QueueEntry; nowMs: number; onSnooze: (id: string) => void; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const age = entry.since ? ago(nowMs, entry.since) : null
  return (
    <li className={`queue-item sev-row-${entry.severity}`}>
      <SeverityChip severity={entry.severity} />
      <div className="queue-what">
        <p className="queue-title">{entry.title}</p>
        <p className="queue-why">{entry.why}</p>
      </div>
      <div className="queue-meta">
        {age && <span className="queue-age">{age.replace(' ago', '')}</span>}
        <span className="owner-chip">{OWNER_LABEL[entry.owner]}</span>
      </div>
      <div className="queue-actions">
        <Link to={entry.action.to} className="btn btn-small" onClick={onNavigate}>
          {entry.action.label}
          <span className="sr-only">: {entry.title}</span>
        </Link>
        <div
          className="queue-more"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open) {
              e.stopPropagation()
              setOpen(false)
              ;(e.currentTarget.querySelector('button') as HTMLButtonElement | null)?.focus()
            }
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
          }}
        >
          <button type="button" className="btn btn-small btn-icon" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(!open)}>
            <MoreHorizontal aria-hidden="true" strokeWidth={2} />
            <span className="sr-only">More for {entry.title}</span>
          </button>
          <div id={menuId} className="queue-menu" hidden={!open}>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setOpen(false)
                onSnooze(entry.id)
              }}
            >
              <BellOff aria-hidden="true" className="menu-item-icon" strokeWidth={1.75} />
              Snooze until tomorrow
            </button>
            {entry.open && (
              <Link to={entry.open.to} className="menu-item" onClick={onNavigate}>
                <ExternalLink aria-hidden="true" className="menu-item-icon" strokeWidth={1.75} />
                {entry.open.label}
              </Link>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

// ---------- PeekDrawer ----------

/** ?peek=<id> in the URL: a drawer that survives reload, and Back closes it. */
export function usePeek(param = 'peek'): [string | null, (id: string) => void, () => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(param)
  const open = (id: string) => {
    const p = new URLSearchParams(params)
    p.set(param, id)
    setParams(p)
  }
  const close = () => {
    const p = new URLSearchParams(params)
    p.delete(param)
    setParams(p)
  }
  return [value, open, close]
}

/**
 * A right-hand drawer (480px, full height; the whole screen on a phone) for a quick look at one
 * thing without leaving the list: focus is trapped, Escape and the overlay close it, focus goes back.
 * `openTo` is the full page; `o` opens it too.
 */
export function PeekDrawer({ title, onClose, openTo, children, footer }: { title: string; onClose: () => void; openTo?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      variant="drawer"
      footer={
        <>
          {footer}
          {openTo && (
            <Link to={openTo} className="btn" aria-keyshortcuts="o">
              Open full page
            </Link>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div
        className="peek"
        data-peek-open={openTo}
      >
        {children}
      </div>
    </Dialog>
  )
}
