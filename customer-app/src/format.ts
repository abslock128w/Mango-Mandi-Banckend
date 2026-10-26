import type { OrderStatus, PreorderStatus, Stage } from './api'
import { currentLang, locale, t, type Key } from './i18n-core.ts'
import { supportDigits } from './support'

// Dates and money follow the shop's language (docs/languages.md): Indian formats, Latin digits, the ₹ sign.
const formats = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>()
function cached<F extends Intl.NumberFormat | Intl.DateTimeFormat>(name: string, make: (loc: string) => F): F {
  const loc = locale()
  const key = `${name}|${loc}`
  let f = formats.get(key)
  if (!f) {
    f = make(loc)
    formats.set(key, f)
  }
  return f as F
}

/** Paise to "₹1,899"; paise show only when there are any. */
export function rupees(paise: number): string {
  if (paise % 100 === 0) return cached('rupee', (l) => new Intl.NumberFormat(l, { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })).format(paise / 100)
  return cached('rupee-paise', (l) => new Intl.NumberFormat(l, { style: 'currency', currency: 'INR' })).format(paise / 100)
}

/** "2026-10-18" to "Sun, 18 Oct". */
export const day = (d: string) =>
  cached('day', (l) => new Intl.DateTimeFormat(l, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })).format(new Date(`${d}T00:00:00Z`))

export const when = (iso: string) =>
  cached('when', (l) => new Intl.DateTimeFormat(l, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })).format(new Date(iso))

/** "2026-10-18T…" to "18 Oct 2026" (India time). */
export const longDate = (iso: string) =>
  cached('long', (l) => new Intl.DateTimeFormat(l, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })).format(new Date(iso))

/** "07:00" to "7 AM", "16:30" to "4:30 PM" (in Hindi and Kannada, the language's own way of saying the time). */
export function clock(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  if (currentLang() !== 'en') {
    const opts: Intl.DateTimeFormatOptions = m ? { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' } : { hour: 'numeric', timeZone: 'UTC' }
    return cached(m ? 'clock-m' : 'clock', (l) => new Intl.DateTimeFormat(l, opts)).format(new Date(Date.UTC(2026, 0, 1, h, m)))
  }
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`
}
export const slotText = (s: { label: string; startsAt: string; endsAt: string }) => t('format.slot', { label: s.label, from: clock(s.startsAt), to: clock(s.endsAt) })

/** A fixed set of names (statuses, ripeness) read in the current language: `MAP[value]` as before. */
function labels<K extends string>(keys: Record<K, Key>): Record<K, string> {
  const out = {} as Record<K, string>
  for (const k of Object.keys(keys) as K[]) Object.defineProperty(out, k, { enumerable: true, get: () => t(keys[k]) })
  return out
}

export const STAGE_LABEL: Record<Stage, string> = labels({ RAW: 'stage.raw', SEMI_RIPE: 'stage.semiRipe', RIPE: 'stage.ripe' })
export const STAGE_HINT: Record<Stage, string> = labels({ RAW: 'stage.rawHint', SEMI_RIPE: 'stage.semiRipeHint', RIPE: 'stage.ripeHint' })

export const STATUS_LABEL: Record<OrderStatus, string> = labels({
  PAYMENT_PENDING: 'status.paymentPending',
  CONFIRMED: 'status.confirmed',
  PROCESSING: 'status.processing',
  PACKED: 'status.packed',
  SHIPPED: 'status.shipped',
  OUT_FOR_DELIVERY: 'status.outForDelivery',
  DELIVERED: 'status.delivered',
  DELIVERY_FAILED: 'status.deliveryFailed',
  RTO: 'status.rto',
  CANCELLED: 'status.cancelled',
})

/** Statuses a customer can still cancel from; mirrors CUSTOMER_CANCELLABLE in the API. */
export const CANCELLABLE: OrderStatus[] = ['PAYMENT_PENDING', 'CONFIRMED', 'PROCESSING']

/** "2026-11-02" (a Monday) to "2 to 8 Nov". */
export function week(monday: string) {
  const start = new Date(`${monday}T00:00:00Z`)
  const end = new Date(start.getTime() + 6 * 86_400_000)
  const d = (x: Date) => x.getUTCDate()
  const m = (x: Date) => x.toLocaleString(locale(), { month: 'short', timeZone: 'UTC' })
  return start.getUTCMonth() === end.getUTCMonth()
    ? t('format.weekSameMonth', { from: d(start), to: d(end), month: m(end) })
    : t('format.weekTwoMonths', { from: `${d(start)} ${m(start)}`, to: `${d(end)} ${m(end)}` })
}

export const PREORDER_LABEL: Record<PreorderStatus, string> = labels({
  PAYMENT_PENDING: 'preorderStatus.paymentPending',
  BOOKED: 'preorderStatus.booked',
  WAITLISTED: 'preorderStatus.waitlisted',
  CONVERTED: 'preorderStatus.converted',
  CANCELLED: 'preorderStatus.cancelled',
})

/**
 * The help chat link (wa.me) when the shop's WhatsApp number is set, else null. Production builds
 * always have it (support.ts); dev and test builds may not, and link to /help instead.
 */
export function helpLink(text?: string): string | null {
  const n = supportDigits(import.meta.env.VITE_SUPPORT_WHATSAPP)
  if (!n) return null
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

/** The help number for reading out, "+91 98765 43210", or null when it is not set. */
export function helpNumber(): string | null {
  const n = supportDigits(import.meta.env.VITE_SUPPORT_WHATSAPP)
  if (!n) return null
  return n.startsWith('91') && n.length === 12 ? `+91 ${n.slice(2, 7)} ${n.slice(7)}` : `+${n}`
}

/** What is in the box, when the shop team has filled it in: "About 12 mangoes, around 250 g each". */
export function boxContents(p: { fruitsPerBox?: number | null; fruitWeightG?: number | null }): string | null {
  const count = p.fruitsPerBox ? t('format.aboutMangoes', { count: p.fruitsPerBox }) : null
  const weight = p.fruitWeightG ? t('format.aroundGrams', { grams: p.fruitWeightG }) : null
  if (count && weight) return t('format.countAndWeight', { count, weight })
  if (count) return count
  if (weight) return t('format.mangoesOf', { weight })
  return null
}
