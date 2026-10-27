// Browser notifications for order updates (WEB_PUSH, docs/app-feel.md), in the shop.
//
// Only ever started by the customer pressing "Turn on" on the Account page: the shop never asks
// for permission on its own. The browser's subscription goes to the API, which sends each order
// step (with nothing personal in it) to that browser through its push service; public/sw.js shows it.
import { SIGNOUT_EVENT, api, onBeforeSignOut, type PushSubscriptionInput } from './api'
import { shopRegistration, swSupported, workerUrl } from './pwa'
import { t } from './i18n-core.ts'

/** This browser can show web notifications at all (an iPhone only from the Home Screen app). */
export const pushSupported = () => swSupported() && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window

/** The browser's permission: 'default' until asked, then 'granted' or 'denied'. */
export const permission = (): NotificationPermission => (pushSupported() ? Notification.permission : 'denied')

/** This browser's subscription, if notifications are on in it. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const reg = await shopRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

/** The base64url application server key as the bytes PushManager.subscribe takes. */
export function keyBytes(publicKey: string): Uint8Array<ArrayBuffer> {
  const b64 = publicKey.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(publicKey.length / 4) * 4, '=')
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const sameKey = (a: ArrayBuffer | null, b: Uint8Array) => {
  if (!a || a.byteLength !== b.byteLength) return false
  const x = new Uint8Array(a)
  return x.every((v, i) => v === b[i])
}

export class PushRefused extends Error {}

/**
 * Turns notifications on in this browser: the browser's own question first, then the
 * subscription, then the API. `installApp` decides whether the worker also keeps the app shell.
 */
export async function turnOn(publicKey: string, installApp: boolean) {
  if (!pushSupported()) throw new PushRefused(t('push.unsupported'))
  const answer = await Notification.requestPermission()
  if (answer === 'denied') throw new PushRefused(t('push.blocked'))
  if (answer !== 'granted') throw new PushRefused(t('push.notTurnedOn'))
  await navigator.serviceWorker.register(workerUrl(installApp), { scope: '/' })
  const reg = await navigator.serviceWorker.ready
  const key = keyBytes(publicKey)
  let sub = await reg.pushManager.getSubscription()
  // Made with an older key (the shop's keys changed): it can't be used, so it is replaced.
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe()
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  try {
    await api.savePushSubscription(sub.toJSON() as PushSubscriptionInput)
  } catch (err) {
    // The API did not take it: nothing would arrive, so the browser forgets it too.
    await sub.unsubscribe()
    throw err
  }
}

/** Turns notifications off in this browser: the API forgets it, then the browser does. */
export async function turnOff() {
  const sub = await currentSubscription()
  if (!sub) return
  await api.removePushSubscription(sub.endpoint)
  await sub.unsubscribe()
}

// Signing out on this browser ends its notifications: the API is told while the session still
// works, and the browser's subscription goes whatever the API answered (a push to it then fails
// with 410 and the API deletes it). An expired session or the account deleted ends them too.
onBeforeSignOut(async () => {
  const sub = await currentSubscription()
  if (sub) await api.removePushSubscription(sub.endpoint)
})
if (typeof window !== 'undefined') {
  window.addEventListener(SIGNOUT_EVENT, () => {
    void currentSubscription()
      .then((sub) => sub?.unsubscribe())
      .catch((err: unknown) => console.warn('MandiMangoes: could not turn notifications off in this browser', err))
  })
}
