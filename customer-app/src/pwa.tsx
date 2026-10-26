// The installable shop (SHOP_INSTALL) and the service worker it shares with browser
// notifications (WEB_PUSH). docs/app-feel.md.
//
// public/sw.js keeps only the static app shell (never an API answer). With the switch on, the
// shop links its manifest, registers the worker and, where the browser offers it, shows a quiet
// "Install app" card on the home page that stays away for a month once dismissed. With it off,
// the worker is removed again (rollback), unless notifications are on in this browser: then it
// stays as /sw.js?shell=off, which keeps no cache.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { policyQuery } from './queries'

/** The worker's address: with the shell, or for notifications only. */
export const workerUrl = (installApp: boolean) => (installApp ? '/sw.js' : '/sw.js?shell=off')

export const swSupported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator

/** The shop's own worker registration, if any. */
export async function shopRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!swSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration('/')
  const url = reg?.active?.scriptURL ?? reg?.waiting?.scriptURL ?? reg?.installing?.scriptURL
  return reg && url && new URL(url).pathname === '/sw.js' ? reg : null
}

function linkManifest(on: boolean) {
  const existing = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  if (on && !existing) {
    const link = document.createElement('link')
    link.rel = 'manifest'
    link.href = '/manifest.webmanifest'
    document.head.appendChild(link)
  } else if (!on && existing) existing.remove()
}

/**
 * Keeps the worker in line with the switches, once /v1/policy has answered (never on a guess).
 * A failure is reported once in the console: the shop works the same without a worker.
 */
export function useShellWorker() {
  const q = useQuery(policyQuery())
  const known = q.isSuccess
  const installApp = Boolean(q.data?.features?.installApp)
  const push = Boolean(q.data?.features?.push)
  useEffect(() => {
    if (!known || !swSupported()) return
    linkManifest(installApp)
    void (async () => {
      const reg = await shopRegistration()
      if (installApp) {
        await navigator.serviceWorker.register(workerUrl(true), { scope: '/' })
        return
      }
      if (!reg) return
      const subscribed = push && (await reg.pushManager?.getSubscription()) != null
      if (subscribed) await navigator.serviceWorker.register(workerUrl(false), { scope: '/' })
      else {
        await reg.unregister()
        for (const key of await caches.keys()) if (key.startsWith('mm-shell-')) await caches.delete(key)
      }
    })().catch((err: unknown) => console.warn('MandiMangoes: the service worker could not be updated', err))
  }, [known, installApp, push])
}

// ---------------------------------------------------------------- "Install app"

/** What Chrome, Edge and Samsung Internet hand over before they offer to install a site. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// The browser may offer it before React has drawn anything, so it is caught here, at load.
let offer: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((fn) => fn())
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // The browser's own mini-bar would show at once; the shop offers it quietly instead.
    e.preventDefault()
    offer = e as InstallPromptEvent
    changed()
  })
  window.addEventListener('appinstalled', () => {
    offer = null
    changed()
  })
}
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const DISMISSED_KEY = 'mm.install-dismissed'
/** How long "Not now" keeps the card away. */
export const QUIET_DAYS = 30

function dismissedRecently() {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY) ?? 0)
    return Date.now() - at < QUIET_DAYS * 86_400_000
  } catch {
    return false
  }
}
function rememberDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()))
  } catch {
    // Storage blocked: the card stays away for this visit (state below).
  }
}

/** The home page's "Install app" card: only when the switch is on and the browser offers it. */
export function InstallCard() {
  const q = useQuery(policyQuery())
  const event = useSyncExternalStore(subscribe, () => offer)
  const [hidden, setHidden] = useState(dismissedRecently)
  const [busy, setBusy] = useState(false)
  if (!q.data?.features?.installApp || !event || hidden) return null
  const notNow = () => {
    rememberDismissed()
    setHidden(true)
  }
  async function install() {
    if (!event) return
    setBusy(true)
    let outcome: 'accepted' | 'dismissed' | 'gone' = 'gone'
    try {
      await event.prompt()
      outcome = (await event.userChoice).outcome
    } catch (err) {
      // The browser withdrew its offer (it can be shown only once): there is nothing to tap any more.
      console.warn('MandiMangoes: the install prompt could not open', err)
    } finally {
      // A prompt can be shown once; the browser offers a new one later if it still can.
      offer = null
      changed()
      setBusy(false)
    }
    if (outcome === 'dismissed') notNow()
  }
  return (
    <section className="card install-card" aria-labelledby="install-title">
      <img src="/icon-192.png" width="48" height="48" alt="" />
      <div>
        <h2 id="install-title" className="install-title">
          Add MandiMangoes to your home screen
        </h2>
        <p className="small muted">Open the shop in one tap, like an app. Nothing to download from a store.</p>
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void install()}>
            Install app
          </button>
          <button type="button" className="btn btn-quiet" onClick={notNow}>
            Not now
          </button>
        </div>
      </div>
    </section>
  )
}
