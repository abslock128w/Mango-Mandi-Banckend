import type { OrderStatus, Stage } from './api'

const rupeeFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
/** Paise to "₹1,899"; paise show only when there are any. */
export function rupees(paise: number): string {
  if (paise % 100 === 0) return rupeeFmt.format(paise / 100)
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100)
}

const dayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
/** "2026-10-18" to "Sun, 18 Oct". */
export const day = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`))

const whenFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
export const when = (iso: string) => whenFmt.format(new Date(iso))

/** "07:00" to "7 AM", "16:30" to "4:30 PM". */
export function clock(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`
}
export const slotText = (s: { label: string; startsAt: string; endsAt: string }) => `${s.label}, ${clock(s.startsAt)} to ${clock(s.endsAt)}`

export const STAGE_LABEL: Record<Stage, string> = { RAW: 'Raw', SEMI_RIPE: 'Semi-ripe', RIPE: 'Ripe' }
export const STAGE_HINT: Record<Stage, string> = {
  RAW: 'Firm. Ripens at home over 3 to 4 days.',
  SEMI_RIPE: 'Softening. Ready in 1 to 2 days.',
  RIPE: 'Ready to eat on delivery.',
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PAYMENT_PENDING: 'Waiting for payment',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Being packed',
  PACKED: 'Packed',
  SHIPPED: 'On its way',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  DELIVERY_FAILED: 'Delivery missed',
  RTO: 'Returned',
  CANCELLED: 'Cancelled',
}

/** Statuses a customer can still cancel from; mirrors CUSTOMER_CANCELLABLE in the API. */
export const CANCELLABLE: OrderStatus[] = ['PAYMENT_PENDING', 'CONFIRMED', 'PROCESSING']
