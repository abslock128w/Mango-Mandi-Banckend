// Browser error reports to Sentry, for the shop and the staff panel. Off unless the
// build sets VITE_SENTRY_DSN: then nothing below runs and the SDK is not in the
// build at all. With a DSN, this small part is in the first download; it holds on
// to errors from the start, and the SDK (sentry-client.ts, its own chunk) loads once
// the page has finished loading and the browser is idle, then sends what was held.
// What a report may carry is in scrub.ts. Setup: deploy/VERCEL.md, "Error reports".

export type App = 'shop' | 'panel'

/** An error caught before the SDK loaded, or by a React error boundary. */
export interface Caught {
  error: unknown
  how: 'onerror' | 'onunhandledrejection' | 'react'
  componentStack?: string
}

/** Enough for a page that crashes in a loop; the rest are not kept. */
const MAX_HELD = 10
const held: Caught[] = []
let send: ((c: Caught) => void) | null = null

function report(c: Caught) {
  if (send) send(c)
  else if (held.length < MAX_HELD) held.push(c)
}

/** For error boundaries: reports what they caught (held until the SDK loads). Does nothing without a DSN. */
export function reportError(error: unknown, componentStack?: string | null) {
  if (import.meta.env.VITE_SENTRY_DSN) report({ error, how: 'react', componentStack: componentStack ?? undefined })
}

/** Called once, first thing in main.tsx. */
export function startErrorReports(app: App) {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (dsn) {
    // A cross-origin script's error has no error object ("Script error."): nothing to report.
    const onError = (e: ErrorEvent) => {
      if (e.error != null) report({ error: e.error, how: 'onerror' })
    }
    const onRejection = (e: PromiseRejectionEvent) => report({ error: e.reason, how: 'onunhandledrejection' })
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    const load = () =>
      import('./sentry-client.ts').then(
        (m) => {
          send = m.start({
            app,
            dsn,
            environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
            release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
          })
          // The SDK's own handlers take over from here.
          window.removeEventListener('error', onError)
          window.removeEventListener('unhandledrejection', onRejection)
          for (const c of held.splice(0)) send(c)
        },
        // Offline, or a new release replaced the chunk: this page sends no reports.
        () => undefined,
      )
    const whenIdle = () => {
      if ('requestIdleCallback' in window) window.requestIdleCallback(() => void load(), { timeout: 5000 })
      else setTimeout(() => void load(), 1000)
    }
    if (document.readyState === 'complete') whenIdle()
    else window.addEventListener('load', whenIdle, { once: true })
  }
}
