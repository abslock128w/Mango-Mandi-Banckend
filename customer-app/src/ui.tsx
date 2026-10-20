import { useEffect, useRef, type ReactNode } from 'react'
import { errorMessage } from './api'

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  )
}

/** Grey placeholder cards shaped like what is loading, so nothing jumps when it arrives. */
export function Skeleton({ label, cards = 3, tall = false }: { label: string; cards?: number; tall?: boolean }) {
  return (
    <div className="skeletons" role="status" aria-busy="true">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className={tall ? 'card skeleton skeleton-tall' : 'card skeleton'} aria-hidden="true">
          <span className="sk sk-round" />
          <span className="sk-lines">
            <span className="sk sk-line" />
            <span className="sk sk-line sk-short" />
            <span className="sk sk-line sk-shorter" />
          </span>
        </div>
      ))}
    </div>
  )
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null
  return (
    <div className="note note-error" role="alert">
      <span>{typeof error === 'string' ? error : errorMessage(error)}</span>
      {onRetry && (
        <button type="button" className="link-btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

/** A modal dialog: focus moves in, Escape closes, focus returns on close. */
export function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    box.current?.querySelector<HTMLElement>('[data-autofocus], button, input, textarea, select')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      before?.focus()
    }
  }, [onClose])
  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" ref={box}>
        <h2 id="dialog-title">{title}</h2>
        {children}
        <div className="dialog-actions">{footer}</div>
      </div>
    </div>
  )
}
