// CSV exports for managers (docs/trust.md): a date range of at most 92 days,
// downloaded with the staff sign-in. The API checks the range and the role
// again, makes formula-like cells inert, and records every export in the
// activity log; this only collects the range and saves the file.
import { useId, useState } from 'react'
import { api } from './api'
import { istDate } from './format'
import { trustAllowed } from './permissions'
import { useSession } from './session'
import type { ExportKind } from './types'
import { DisabledReason, DownloadButton } from './ui'
import { EXPORT_MAX_DAYS, rangeProblem } from './exportRange'

export const EXPORT_LABEL: Record<ExportKind, string> = {
  orders: 'Orders',
  'order-lines': 'Order lines',
  claims: 'Claims',
  reviews: 'Reviews',
  'bulk-orders': 'Bulk Deals orders',
  payments: 'Payments',
  refunds: 'Refunds',
}

/** Exports that can pick orders by the day they were placed or by their delivery day. */
const BY_DATE: ReadonlySet<ExportKind> = new Set<ExportKind>(['orders', 'order-lines', 'bulk-orders'])

/**
 * The export card for a page: one or more kinds, a date range and, for order
 * exports, whether the range is the placed or the delivery date. Shown only to
 * managers while exports are switched on.
 */
export function ExportPanel({ kinds }: { kinds: ExportKind[] }) {
  const { me } = useSession()
  const uid = useId()
  const [kind, setKind] = useState<ExportKind>(kinds[0])
  const [from, setFrom] = useState(() => istDate(-29))
  const [to, setTo] = useState(() => istDate(0))
  const [by, setBy] = useState<'placed' | 'delivery'>('placed')
  if (!trustAllowed(me, 'exports')) return null
  const problem = rangeProblem(from, to)
  const byDate = BY_DATE.has(kind)
  const params = { from, to, ...(byDate ? { by } : {}) }
  return (
    <section className="card export-panel" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`}>Download as CSV</h2>
      <p className="muted small">
        Up to {EXPORT_MAX_DAYS} days at a time. Customer ids only: no phone numbers or addresses. Every export is recorded in the activity log.
      </p>
      <div className="field-inline">
        {kinds.length > 1 && (
          <div className="field">
            <label htmlFor={`${uid}-kind`}>What</label>
            <select id={`${uid}-kind`} value={kind} onChange={(e) => setKind(e.target.value as ExportKind)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {EXPORT_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor={`${uid}-from`}>From</label>
          <input id={`${uid}-from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-to`}>To</label>
          <input id={`${uid}-to`} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {byDate && (
          <div className="field">
            <label htmlFor={`${uid}-by`}>Dates are</label>
            <select id={`${uid}-by`} value={by} onChange={(e) => setBy(e.target.value as 'placed' | 'delivery')}>
              <option value="placed">When the order was placed</option>
              <option value="delivery">The delivery day</option>
            </select>
          </div>
        )}
      </div>
      <div className="btn-row mt-2">
        {problem ? (
          <>
            <button type="button" className="btn" disabled aria-describedby={`${uid}-why`}>
              Download {EXPORT_LABEL[kind]} CSV
            </button>
            <div id={`${uid}-why`}>
              <DisabledReason>{problem}</DisabledReason>
            </div>
          </>
        ) : (
          <DownloadButton getUrl={() => api.exportUrl(kind, params)} filename={`mandimangoes-${kind}-${from}-to-${to}.csv`}>
            Download {EXPORT_LABEL[kind]} CSV
          </DownloadButton>
        )}
      </div>
    </section>
  )
}
