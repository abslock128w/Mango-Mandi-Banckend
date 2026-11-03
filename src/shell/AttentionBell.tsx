// The Attention bell (docs/design/ops-dashboard-v2.md §1): the queue's count from any page, and a
// right-hand drawer with the same ranked items as Today, so a problem is one click away.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, CircleCheck } from 'lucide-react'
import { snoozeUntil } from '../ops/prefs'
import { tomorrowStartIST } from '../ops/time'
import { useAttentionQueue } from '../ops/useQueue'
import { Dialog, QueueItem, useToast } from '../ui'
import { LiveDot } from './live'

export function AttentionBell() {
  const q = useAttentionQueue()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  if (!q.on) return null
  const n = q.shown.length
  const urgent = q.shown.some((e) => e.severity === 'now')
  return (
    <>
      <button
        type="button"
        className={`bell-btn${urgent ? ' is-urgent' : ''}`}
        aria-haspopup="dialog"
        aria-label={n ? `Attention: ${n} ${n === 1 ? 'item' : 'items'}${urgent ? ', some need someone now' : ''}` : 'Attention: all clear'}
        title="Attention"
        onClick={() => setOpen(true)}
      >
        <Bell aria-hidden="true" strokeWidth={2} />
        {n > 0 && (
          <span className="bell-badge tnum" aria-hidden="true">
            {n > 99 ? '99+' : n}
          </span>
        )}
      </button>
      {open && (
        <Dialog title="Attention" variant="drawer" onClose={() => setOpen(false)} footer={<button type="button" className="btn" onClick={() => setOpen(false)}>Close</button>}>
          <p className="drawer-live">
            <LiveDot />
          </p>
          {n === 0 ? (
            <p className="all-clear">
              <CircleCheck aria-hidden="true" strokeWidth={2} />
              All clear: nothing needs a person right now.
            </p>
          ) : (
            <ul className="queue queue-drawer" aria-label="Attention queue">
              {q.shown.map((e) => (
                <QueueItem
                  key={e.id}
                  entry={e}
                  nowMs={q.nowMs}
                  onNavigate={() => setOpen(false)}
                  onSnooze={(id) => {
                    snoozeUntil(id, tomorrowStartIST(q.nowMs), q.nowMs)
                    toast.info('Snoozed until tomorrow on this browser')
                  }}
                />
              ))}
            </ul>
          )}
          {q.snoozed > 0 && <p className="muted small">{q.snoozed} snoozed until tomorrow on this browser.</p>}
          <p className="small">
            <Link to="/today" onClick={() => setOpen(false)}>
              Open Today<span aria-hidden="true"> →</span>
            </Link>
          </p>
        </Dialog>
      )}
    </>
  )
}
