// Display-only formatting. The UI never computes stock or money; it only
// formats figures the API returns.

import type {
  BatchStatus,
  ClaimResolution,
  ClaimStatus,
  Condition,
  OrderStatus,
  Ripeness,
} from './types'

const rupee = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
})

/** Paise → "₹1,234.50" */
export function rupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—'
  return rupee.format(paise / 100)
}


const IST = 'Asia/Kolkata'

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const timeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

/** Formats a date-only "YYYY-MM-DD" or a timestamp as an IST date. */
export function date(value: string | null | undefined): string {
  if (!value) return '—'
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00+05:30`) : new Date(value)
  return Number.isNaN(d.getTime()) ? value : dateFmt.format(d)
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : dateTimeFmt.format(d)
}

/** "14:05 IST" for a Date. */
export function istTime(d: Date): string {
  return `${timeFmt.format(d)} IST`
}

/** Today's date in IST as YYYY-MM-DD, offset by `days`. */
export function istDate(days = 0): string {
  const now = new Date(Date.now() + days * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(now)
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PAYMENT_PENDING: 'Payment pending',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  DELIVERY_FAILED: 'Delivery failed',
  RTO: 'Returned',
  CANCELLED: 'Cancelled',
}

export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  ARRIVING: 'Arriving',
  IN_TRANSIT: 'In transit',
  ARRIVED: 'Arrived',
  RIPENING: 'Ripening',
  SELLING: 'Selling',
  EXHAUSTED: 'Exhausted',
  CONDEMNED: 'Condemned',
}

export const RIPENESS_LABEL: Record<Ripeness, string> = {
  RAW: 'Raw',
  SEMI_RIPE: 'Semi-ripe',
  RIPE: 'Ripe',
}

export const CONDITION_LABEL: Record<Condition, string> = {
  GOOD: 'Good',
  FAIR: 'Fair (minor blemish)',
  REJECT: 'Reject',
}

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  RESOLVED: 'Resolved',
}

export const RESOLUTION_LABEL: Record<ClaimResolution, string> = {
  REFUND_APPROVED: 'Refund',
  REPLACEMENT_APPROVED: 'Replacement',
  REJECTED: 'Rejected',
}

export const ISSUE_LABEL: Record<string, string> = {
  DAMAGED: 'Damaged',
  WRONG_ITEM: 'Wrong item',
  NOT_DELIVERED: 'Not delivered',
}

export const PAYMENT_LABEL: Record<string, string> = {
  INITIATED: 'Initiated',
  SUCCEEDED: 'Paid',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
  CANCELLED: 'Cancelled',
}

export type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'bad'

export function orderTone(s: OrderStatus): Tone {
  switch (s) {
    case 'DELIVERED':
      return 'good'
    case 'CANCELLED':
    case 'RTO':
      return 'neutral'
    case 'DELIVERY_FAILED':
      return 'bad'
    case 'PAYMENT_PENDING':
      return 'warn'
    default:
      return 'info'
  }
}

export function batchTone(s: BatchStatus): Tone {
  if (s === 'SELLING') return 'good'
  if (s === 'CONDEMNED') return 'bad'
  if (s === 'EXHAUSTED') return 'neutral'
  return 'info'
}
