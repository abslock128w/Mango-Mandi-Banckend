// Growth in the shop (docs/growth.md).
//
// Funnel steps (FUNNEL_ANALYTICS): visit, box viewed, added to cart, checkout started. Each
// browser has a random id kept on this device; nothing else is sent (no account, phone, cart
// or page address) and the request carries no cookie or token. "Paid" is counted by the API
// when the payment comes in. While the API's switch is off, or before it has said, nothing
// is sent: steps wait in memory until /v1/policy answers, then go or are dropped.
//
// Invite links (REFERRALS): /invite/CODE keeps the code on this device so checkout or the
// Account page can offer it once the person is signed in.
import { useEffect } from 'react'
import { API_URL } from './api'
import { useFeatures } from './features'
import { policyQuery } from './queries'
import { useQuery } from '@tanstack/react-query'

export type FunnelStep = 'visit' | 'product_view' | 'add_to_cart' | 'checkout_start'

const ID_KEY = 'mm.fid'
const INVITE_KEY = 'mm.invite'

let funnelOn: boolean | null = null
let waiting: FunnelStep[] = []
/** Steps already sent from this tab today: the API keeps one per browser, step and day anyway. */
const sent = new Set<string>()

function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** This browser's random id, made on first use. Storage blocked: a new one for this tab. */
let tabId: string | null = null
function browserId(): string {
  try {
    const kept = localStorage.getItem(ID_KEY)
    if (kept && UUID.test(kept)) return kept
    const made = randomId()
    localStorage.setItem(ID_KEY, made)
    return made
  } catch {
    tabId ??= randomId()
    return tabId
  }
}

function send(step: FunnelStep) {
  const key = `${new Date().toDateString()}:${step}`
  if (sent.has(key)) return
  sent.add(key)
  fetch(`${API_URL}/v1/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ browserId: browserId(), step }),
    credentials: 'omit',
    keepalive: true,
  }).catch((err: unknown) => {
    // A lost count is not worth bothering the shopper; it may go again on the next page.
    sent.delete(key)
    console.warn('funnel step not sent', err)
  })
}

/** Counts a step, once the API has said the funnel is on. */
export function trackStep(step: FunnelStep) {
  if (funnelOn === null) waiting.push(step)
  else if (funnelOn) send(step)
}

/** The id sent with checkout so the API can count "paid" for this browser; null while the funnel is off. */
export function funnelId(): string | null {
  return funnelOn ? browserId() : null
}

/** In the app shell: follows the API's switch, sends the steps that waited for it, and counts the visit. */
export function useFunnel() {
  const policy = useQuery(policyQuery())
  const features = useFeatures()
  const known = policy.isSuccess || policy.isError
  const on = known && Boolean(features.funnel)
  useEffect(() => {
    if (!known) return
    funnelOn = on
    const steps = waiting
    waiting = []
    if (on) steps.forEach(send)
  }, [known, on])
  useEffect(() => {
    trackStep('visit')
  }, [])
}

// ---------------------------------------------------------------- invite links

const CODE = /^[A-Z0-9]{6,12}$/

export function rememberInvite(raw: string): string | null {
  const code = raw.trim().toUpperCase()
  if (!CODE.test(code)) return null
  try {
    localStorage.setItem(INVITE_KEY, code)
  } catch {
    // Storage blocked: the code can still be typed in at checkout.
  }
  return code
}

export function invitedCode(): string | null {
  try {
    const c = localStorage.getItem(INVITE_KEY)
    return c && CODE.test(c) ? c : null
  } catch {
    return null
  }
}

export function forgetInvite() {
  try {
    localStorage.removeItem(INVITE_KEY)
  } catch {
    // Nothing kept.
  }
}
