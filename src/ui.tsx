// Shared UI primitives: badges, dialog, toasts, spinner, empty/error states.

import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ErrorInfo as ReactErrorInfo,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { errorMessage } from './api'
import {
  BATCH_STATUS_LABEL,
  CLAIM_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  batchTone,
  orderTone,
  type Tone,
} from './format'
import { MANAGER_ONLY_HINT } from './permissions'
import type { BatchStatus, ClaimStatus, OrderStatus } from './types'

// ---------- Badges ----------

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function OrderBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={orderTone(status)}>{ORDER_STATUS_LABEL[status] ?? status}</Badge>
}

export function BatchBadge({ status }: { status: BatchStatus }) {
  return <Badge tone={batchTone(status)}>{BATCH_STATUS_LABEL[status] ?? status}</Badge>
}

export function ClaimBadge({ status }: { status: ClaimStatus }) {
  const tone: Tone = status === 'RESOLVED' ? 'neutral' : status === 'UNDER_REVIEW' ? 'info' : 'warn'
  return <Badge tone={tone}>{CLAIM_STATUS_LABEL[status] ?? status}</Badge>
}

// ---------- Spinner / empty / error ----------

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="spinner-wrap">
      <span className="spinner" role="status" aria-label={label} />
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function QueryError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { message, detail } = errorMessage(error)
  return (
    <div className="card error-card" role="alert">
      <p>
        <strong>{message}</strong>
      </p>
      {detail && <p className="muted small">{detail}</p>}
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

/** Inline error text inside a dialog or form. */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null
  const { message, detail } = typeof error === 'string' ? { message: error, detail: undefined } : errorMessage(error)
  return (
    <p className="form-error" role="alert">
      {message}
      {detail && <span className="muted small"> ({detail})</span>}
    </p>
  )
}

// ---------- Buttons ----------

/** A manager-only button: rendered disabled with a hint for operators. */
export function GatedButton({
  allowed,
  className = 'btn',
  onClick,
  children,
  disabled,
}: {
  allowed: boolean
  className?: string
  onClick: () => void
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={!allowed || disabled}
      title={allowed ? undefined : MANAGER_ONLY_HINT}
      aria-describedby={undefined}
    >
      {children}
      {!allowed && <span className="sr-only"> ({MANAGER_ONLY_HINT})</span>}
    </button>
  )
}

// ---------- Tables ----------

/**
 * Props for a horizontally scrollable table wrapper. Focusable and labelled so
 * keyboard users can scroll wide tables on a phone.
 */
export function scrollRegion(label: string) {
  return { className: 'table-wrap', tabIndex: 0, role: 'region', 'aria-label': label } as const
}

// ---------- Clickable table row ----------

export function ClickableRow({
  onActivate,
  label,
  children,
}: {
  onActivate: () => void
  label: string
  children: ReactNode
}) {
  function onKeyDown(e: KeyboardEvent<HTMLTableRowElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onActivate()
    }
  }
  return (
    <tr className="clickable" tabIndex={0} role="button" aria-label={label} onClick={onActivate} onKeyDown={onKeyDown}>
      {children}
    </tr>
  )
}

// ---------- Dialog ----------

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Dialog({
  title,
  onClose,
  children,
  footer,
  tone,
  variant,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  tone?: 'danger'
  /** "drawer": slides in from the right, full height (detail panels). */
  variant?: 'drawer'
}) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = ref.current
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()

    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !el) return
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault()
        lastItem.focus()
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [])

  return (
    <div
      className={variant === 'drawer' ? 'backdrop backdrop-drawer' : 'backdrop'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        className={`dialog${tone === 'danger' ? ' dialog-danger' : ''}${variant === 'drawer' ? ' dialog-drawer' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId}>{title}</h2>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  )
}

/**
 * A yes/no check before a step that is hard to take back. Says what happens;
 * the safe choice (Cancel) gets the focus.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onClose,
  busy,
  error,
  tone,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onClose: () => void
  busy?: boolean
  error?: unknown
  tone?: 'danger'
}) {
  return (
    <Dialog
      title={title}
      tone={tone}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} data-autofocus>
            {cancelLabel}
          </button>
          <button type="button" className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={onConfirm}>
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </>
      }
    >
      {children}
      <FormError error={error} />
    </Dialog>
  )
}

// ---------- Toasts ----------

type ToastKind = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

const ToastContext = createContext<(kind: ToastKind, text: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const push = useCallback((kind: ToastKind, text: string) => {
    const toastId = nextId.current++
    setToasts((t) => [...t, { id: toastId, kind, text }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== toastId)), 4000)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const push = useContext(ToastContext)
  return {
    success: (text: string) => push('success', text),
    error: (err: unknown) => push('error', typeof err === 'string' ? err : errorMessage(err).message),
    info: (text: string) => push('info', text),
  }
}

// ---------- Error boundary ----------

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ReactErrorInfo) {
    // Surface for developers; no customer data is in component stacks.
    console.warn('Screen crashed', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card error-card" role="alert">
          <h2>This screen hit a problem</h2>
          <p className="muted">The rest of the app still works. Reload to try again.</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ---------- Banners ----------

export function OfflineBanner() {
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine)
  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  if (!offline) return null
  return (
    <div className="banner banner-warn" role="status">
      You are offline. Actions will fail until the connection returns.
    </div>
  )
}

export function ApiBaseBanner({ apiUrl }: { apiUrl: string }) {
  if (apiUrl) return null
  return (
    <div className="banner banner-bad" role="alert">
      VITE_API_URL is not set, so the app cannot reach the API. Add it to .env and restart.
    </div>
  )
}
