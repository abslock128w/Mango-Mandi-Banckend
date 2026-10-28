// What a browser error report may carry, for the shop and the staff panel alike
// (shared/error-reports). A customer's phone number, address or e-mail never
// leaves the browser in a report. This follows the API's rules in
// mango-api/src/sentry.js and adds the browser's own: page and request URLs lose
// their query string and fragment (search words, tokens), console breadcrumbs keep
// only warnings and errors, and clicks are recorded as an element path with no text.
//
// Plain functions with no SDK code, so the unit tests (tests/unit/error-scrub.unit.ts)
// run them as they are.
import type { Breadcrumb, ErrorEvent } from '@sentry/browser'

export const FILTERED = '[Filtered]'

/** Object keys whose values are never sent, at any depth (the API's list, plus the shop's own fields). */
const SENSITIVE_KEY = /phone|mobile|address|pincode|password|passwd|secret|token|cookie|authorization|^code$|devcode|setupcode|recoverycode|otp|^lat$|^lng$|receivedby|email|signature|customername|^name$/i

const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g
/** Razorpay key ids and secrets, webhook secrets and Blob tokens (as the API masks them). */
const KEYS = /\b(?:rzp_(?:live|test)_\w+|whsec_\w+|vercel_blob_rw_\w+)/g
/** Razorpay ids: a payment, order, refund, payment link, customer, invoice, subscription or dispute. */
const RAZORPAY_ID = /\b(?:pay|order|rfnd|plink|cust|inv|sub|disp)_[A-Za-z0-9]{14}\b/g
const BEARER = /(Bearer\s+)\S+/gi
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
/** Indian mobile numbers, with or without +91 or a leading 0, written whole or as 5 + 5 digits. */
const PHONE = /(?<!\d)(?:(?:\+|00)?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g
/** A code after a word that names one: "code 4821", "OTP: 123456". */
const NAMED_CODE = /\b(code|otp|pin|passcode)(\W{1,3})\d{4,8}\b/gi
/** Login codes and authenticator codes (6 digits; pincodes go too), but not a line or column in a stack ("a.js:12:345678"). */
const SIX_DIGITS = /(?<![\d.])(?<!:\d{1,7}:)\d{6}(?![\d.]|:\d)/g
/** Staff recovery codes, like "k7qd-2mxp" (mango-api/src/totp.js); not a piece of a longer id. */
const RECOVERY_CODE = /(?<![\w-])[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}(?![\w-])/gi
/** A full URL's query string and fragment, inside free text. */
const URL_TAIL = /(\bhttps?:\/\/[^\s?#"'<>()]+)[?#][^\s"'<>()]*/g

/** Masks phone numbers, e-mail addresses, codes, tokens and keys in free text, and cuts query strings off URLs. */
export function scrubText(s: string): string
export function scrubText<T>(s: T): T
export function scrubText(s: unknown): unknown {
  if (typeof s !== 'string') return s
  return s
    .replace(URL_TAIL, '$1')
    .replace(JWT, FILTERED)
    .replace(KEYS, FILTERED)
    .replace(RAZORPAY_ID, FILTERED)
    .replace(BEARER, `$1${FILTERED}`)
    .replace(EMAIL, FILTERED)
    .replace(PHONE, FILTERED)
    .replace(NAMED_CODE, `$1$2${FILTERED}`)
    .replace(RECOVERY_CODE, FILTERED)
    .replace(SIX_DIGITS, FILTERED)
}

/** A URL (full or a path) without its query string and fragment, then scrubbed as text (a phone number in a path). */
export function scrubUrl(url: string): string
export function scrubUrl<T>(url: T): T
export function scrubUrl(url: unknown): unknown {
  if (typeof url !== 'string') return url
  return scrubText(url.split(/[?#]/)[0])
}

const URL_KEY = /^(?:url|from|to|href|filename|abs_path|code_file)$/

/** Any value: sensitive keys filtered, strings scrubbed, URLs cut short. */
export function scrubValue(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return scrubText(v)
  if (!v || typeof v !== 'object' || depth > 6) return v
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) {
    out[k] = SENSITIVE_KEY.test(k) ? FILTERED : URL_KEY.test(k) && typeof x === 'string' ? scrubUrl(x) : scrubValue(x, depth + 1)
  }
  return out
}

/** The parts of an element that a selector may show: never its text or a text attribute. */
export interface ElementLike {
  tagName?: string
  id?: string
  className?: unknown
  getAttribute?: (name: string) => string | null
  parentElement?: ElementLike | null
}

/**
 * The clicked element as a path of tag, id, classes and the `type` and `name` attributes
 * (which come from our code), at most five levels up. No text, and none of the
 * aria-label, title or alt the SDK's own path adds (they can hold a name or an address).
 */
export function selectorOf(el: ElementLike | null | undefined): string {
  const parts: string[] = []
  for (let e = el, n = 0; e && n < 5; e = e.parentElement, n++) {
    const tag = e.tagName?.toLowerCase()
    if (!tag || tag === 'html') break
    let s = tag
    if (e.id) s += `#${e.id}`
    if (typeof e.className === 'string') for (const c of e.className.split(/\s+/).filter(Boolean)) s += `.${c}`
    for (const a of ['type', 'name']) {
      const value = e.getAttribute?.(a)
      if (value) s += `[${a}="${value}"]`
    }
    parts.unshift(s)
  }
  return scrubText(parts.join(' > '))
}

/** Takes the text attributes out of a selector the SDK built (`button.x[aria-label="Call Asha"]`). */
export function stripSelectorText(selector: string): string {
  return selector.replace(/\[(?:aria-label|title|alt)="[\s\S]*?"\](?=\[(?:aria-label|type|name|title|alt)="|\s>\s|$)/g, '')
}

const elementOf = (hint: unknown): ElementLike | null => {
  const event = (hint as { event?: { target?: unknown } } | undefined)?.event
  const target = event && typeof event === 'object' && 'target' in event ? event.target : event
  return target && typeof target === 'object' && 'tagName' in target ? (target as ElementLike) : null
}

/**
 * beforeBreadcrumb, and again for each breadcrumb in beforeSend. Console lines below a
 * warning are dropped, and the rest lose their raw arguments; clicks and key presses
 * keep only an element path; requests keep method, URL (no query string) and status.
 */
export function scrubBreadcrumb(b: Breadcrumb, hint?: unknown): Breadcrumb | null {
  const category = b.category ?? ''
  if (category === 'console') {
    if (b.level !== 'error' && b.level !== 'warning') return null
    return { ...b, message: scrubText(b.message), data: { logger: 'console' } }
  }
  if (category.startsWith('ui.')) {
    const el = elementOf(hint)
    return { ...b, message: el ? selectorOf(el) : scrubText(stripSelectorText(b.message ?? '')), data: undefined }
  }
  if (category === 'fetch' || category === 'xhr') {
    const d = b.data ?? {}
    return { ...b, message: scrubText(b.message), data: { method: d.method, url: scrubUrl(d.url), status_code: d.status_code } }
  }
  return { ...b, message: scrubText(b.message), data: b.data && (scrubValue(b.data) as Breadcrumb['data']) }
}

/**
 * beforeSend: no request body, cookies, query string, user or IP address; headers cut to
 * the browser's name; free text, extra data, contexts, tags and breadcrumbs scrubbed.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    const r = event.request
    delete r.data
    delete r.cookies
    delete r.query_string
    delete r.env
    r.url = scrubUrl(r.url)
    if (r.headers) r.headers = Object.fromEntries(Object.entries(r.headers).filter(([k]) => k.toLowerCase() === 'user-agent'))
  }
  delete event.user
  event.message = scrubText(event.message)
  if (event.logentry) event.logentry = { message: scrubText(event.logentry.message), params: event.logentry.params && (scrubValue(event.logentry.params) as unknown[]) }
  for (const ex of event.exception?.values ?? []) {
    ex.value = scrubText(ex.value)
    for (const f of ex.stacktrace?.frames ?? []) {
      f.filename = scrubUrl(f.filename)
      f.abs_path = scrubUrl(f.abs_path)
      delete f.vars
    }
  }
  for (const image of event.debug_meta?.images ?? []) if ('code_file' in image) image.code_file = scrubUrl(image.code_file)
  if (event.extra) event.extra = scrubValue(event.extra) as ErrorEvent['extra']
  if (event.contexts) event.contexts = scrubValue(event.contexts) as ErrorEvent['contexts']
  if (event.tags) event.tags = scrubValue(event.tags) as ErrorEvent['tags']
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map((b) => scrubBreadcrumb(b)).filter((b): b is Breadcrumb => b !== null)
  return event
}
