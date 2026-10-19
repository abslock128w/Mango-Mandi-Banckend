// A sheet of box labels for one batch: each carries a QR code that opens the
// shop's page for this batch (where and when it was picked, when it will be
// ripe, how to keep it), plus the code in letters in case the QR won't scan.
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { api } from '../api'
import { date } from '../format'
import { QueryError, Spinner } from '../ui'

const MAX_LABELS = 60

export default function BoxLabels() {
  const { id = '' } = useParams()
  const q = useQuery({ queryKey: ['batch', id], queryFn: () => api.batch(id) })
  const onHand = q.data?.lines.reduce((n, l) => n + l.onHand, 0) ?? 0
  const [count, setCount] = useState<number | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const url = q.data?.traceUrl ?? null

  useEffect(() => {
    if (!url) return
    let live = true
    QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' }).then((u) => live && setQr(u), () => live && setQr(null))
    return () => {
      live = false
    }
  }, [url])

  if (q.isPending) return <Spinner />
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />
  const b = q.data
  const n = Math.max(1, Math.min(MAX_LABELS, count ?? (onHand || 1)))

  return (
    <>
      <div className="topbar no-print">
        <h1>
          Box labels · {b.variety} <span className="muted small">plucked {date(b.pluckedOn)}</span>
        </h1>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="label-count">How many</label>
          <input
            id="label-count"
            type="number"
            min={1}
            max={MAX_LABELS}
            value={n}
            onChange={(e) => setCount(Number(e.target.value) || 1)}
            style={{ width: '6rem' }}
          />
        </div>
        <span className="spacer" />
        <Link to={`/batches/${b.id}`} className="btn">
          Back to batch
        </Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()} disabled={!qr}>
          Print
        </button>
      </div>
      {!url ? (
        <p className="card">This batch has no trace code yet.</p>
      ) : (
        <>
          <p className="muted no-print">
            Stick one on each box. The QR opens <a href={url}>{url}</a>, where the customer sees where and when the mangoes were picked, when
            they'll be ripe and how to keep them.
          </p>
          <ul className="box-labels" aria-label="Labels to print">
            {Array.from({ length: n }, (_, i) => (
              <li key={i} className="box-label">
                {qr && <img src={qr} alt={i === 0 ? `QR code for ${url}` : ''} width={120} height={120} />}
                <div>
                  <strong>MandiMangoes</strong>
                  <span>{b.variety}</span>
                  <span>
                    Picked {date(b.pluckedOn)}
                    {b.farm ? `, ${b.farm}` : ''}
                  </span>
                  <span className="small">Scan for ripeness and care tips</span>
                  <code>{b.traceCode}</code>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
