import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from '../api'
import { STAGE_LABEL, day, when } from '../format'
import { CARE, MangoArt } from '../mango'
import { ErrorNote, Spinner } from '../ui'

/** What the QR code on a box opens: where and when the mangoes were picked, and when they'll be ripe. */
export default function Trace() {
  const { code = '' } = useParams()
  const q = useQuery({ queryKey: ['trace', code], queryFn: () => api.trace(code), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 })
  if (q.isPending) return <Spinner label="Looking up your box" />
  if (q.isError) {
    const missing = q.error instanceof ApiError && q.error.status === 404
    return (
      <section className="card narrow">
        <h1>About your box</h1>
        <ErrorNote error={missing ? "We couldn't find this box. Check the code on the label, or message us on WhatsApp." : q.error} onRetry={missing ? undefined : () => q.refetch()} />
        <Link to="/">Shop mangoes</Link>
      </section>
    )
  }
  const t = q.data
  return (
    <section className="card narrow" aria-labelledby="trace-title">
      <MangoArt stage="RIPE" size={56} />
      <h1 id="trace-title">Your {t.variety} mangoes</h1>
      <dl className="trace-facts">
        {t.farm && (
          <>
            <dt>Grown in</dt>
            <dd>{t.farm}</dd>
          </>
        )}
        <dt>Picked on</dt>
        <dd>{day(t.pluckedOn)}</dd>
        <dt>Ripe to eat</dt>
        <dd>{t.ripeUntil ? `${day(t.ripeFrom)} to ${day(t.ripeUntil)}` : `from about ${day(t.ripeFrom)}`}</dd>
        {t.checked && (
          <>
            <dt>Last checked</dt>
            <dd>
              {STAGE_LABEL[t.checked.ripeness]}, {when(t.checked.at)}
            </dd>
          </>
        )}
      </dl>
      {t.products.length > 0 && <p className="small muted">Packed as: {t.products.join(', ')}.</p>}
      <h2 className="sub-title">Looking after them</h2>
      <ul>
        <li>
          <strong>Still firm?</strong> {CARE.RAW.tips.slice(0, 2).join(' ')}
        </li>
        <li>
          <strong>Ready</strong> {CARE.SEMI_RIPE.tips[1].replace(/^They are ready/, '')}
        </li>
        <li>
          <strong>Ripe?</strong> {CARE.RIPE.tips.slice(1).join(' ')}
        </li>
      </ul>
      <p>
        <Link to="/" className="btn btn-primary">
          Order more mangoes
        </Link>
      </p>
    </section>
  )
}
