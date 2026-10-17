// Every call to mango-api's customer routes (/v1) goes through request() here.
// Tokens live in localStorage: the access token is short-lived and refreshed
// once on a 401; a failed refresh signs the customer out.

export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

export type Stage = 'RAW' | 'SEMI_RIPE' | 'RIPE'
export type OrderStatus =
  | 'PAYMENT_PENDING'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'PACKED'
  | 'SHIPPED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'RTO'
  | 'CANCELLED'

export interface Slot {
  id: string
  label: string
  startsAt: string
  endsAt: string
}
export interface SlotOnDate extends Slot {
  remainingBoxes: number | null
  available: boolean
}
export interface DeliveryCheck {
  serviceable: boolean
  earliestDeliveryDate: string | null
  deliveryDates: string[]
  cutoffTime: string
}
export interface CatalogueItem {
  sku: string
  name: string
  variety: string
  boxSize: string
  price: number
  stage: Stage
  qty: number
  eatBy: string
}
export interface Catalogue {
  serviceable: boolean
  deliveryDate?: string
  deliveryDates?: string[]
  cutoffTime?: string
  items: CatalogueItem[]
}
export interface QuoteLine {
  sku: string
  name: string
  stage: Stage
  qty: number
  unitPrice: number
  linePrice: number
  eatBy: string
}
export interface Quote {
  quoteId: string
  pincode: string
  deliveryDate: string
  slot: Slot | null
  lines: QuoteLine[]
  subtotal: number
  total: number
  expiresAt: string
}
export interface Confirmed {
  orderId: string
  number: string
  status: OrderStatus
  total: number
  deliveryDate: string
  razorpayOrderId: string | null
  razorpayKeyId: string | null
  holdExpiresAt: string | null
}
export interface OrderSummary {
  id: string
  number: string
  status: OrderStatus
  deliveryDate: string
  total: number
  itemCount: number
  placedAt: string
}
export interface Order {
  id: string
  number: string
  status: OrderStatus
  deliveryDate: string
  placedAt: string
  pincode: string
  deliveryAddress: string | null
  total: number
  paymentStatus: 'INITIATED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | null
  refundStatus: 'PENDING' | 'REFUNDED' | null
  razorpayOrderId: string | null
  holdExpiresAt: string | null
  slot: Slot | null
  items: { sku: string; name: string; stage: Stage | null; quantity: number; unitPrice: number; linePrice: number; eatBy: string | null }[]
  timeline: { status: OrderStatus; at: string }[]
  /** Give this to the rider; set while the order is out for delivery. */
  deliveryCode?: string | null
  /** How the order was handed over, once delivered. */
  delivery?: { at: string; method: 'code' | 'photo' | 'staff' | null; receivedBy: string | null; hasPhoto: boolean } | null
}
export type IssueType = 'DAMAGED' | 'WRONG_ITEM' | 'NOT_DELIVERED'
export interface Claim {
  id: string
  orderId: string
  orderNumber: string
  issueType: IssueType
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'RESOLVED'
  resolution: string | null
  replacementOrder: { id: string; number: string } | null
  createdAt: string
}

export interface PreorderWeek {
  sku: string
  name: string
  variety: string
  boxSize: string
  price: number
  /** The Monday the delivery week starts. */
  weekStart: string
  capacity: number
  remaining: number
}
export type PreorderStatus = 'PAYMENT_PENDING' | 'BOOKED' | 'WAITLISTED' | 'CONVERTED' | 'CANCELLED'
export interface Preorder {
  id: string
  number: string
  status: PreorderStatus
  sku: string
  productName: string
  stage: Stage
  qty: number
  unitPrice: number
  total: number
  weekStart: string
  pincode: string
  address: string | null
  paymentStatus: 'INITIATED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'REFUNDED' | null
  /** Razorpay payment link; set while waiting for payment. */
  paymentUrl: string | null
  holdExpiresAt: string | null
  /** The normal order the preorder became, once its delivery day was set. */
  orderId: string | null
  createdAt: string
  refund: { requestedAt: string; refundedAt: string | null } | null
}
export interface PreorderInput {
  sku: string
  stage: Stage
  qty: number
  weekStart: string
  pincode: string
  address: string
  name?: string
  waitlist?: boolean
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public detail: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

interface Session {
  accessToken: string
  refreshToken: string
  phone: string
}

const SESSION_KEY = 'mm.session'
export const SIGNOUT_EVENT = 'mm:signout'

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function save(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode: the session lasts as long as the tab.
  }
}

let session: Session | null = load<Session>(SESSION_KEY)

export const signedInPhone = () => session?.phone ?? null

function setSession(s: Session | null) {
  session = s
  save(SESSION_KEY, s)
}

let refreshing: Promise<boolean> | null = null
function refreshOnce(): Promise<boolean> {
  if (!session) return Promise.resolve(false)
  refreshing ??= (async () => {
    try {
      const r = await raw<{ accessToken: string; refreshToken: string }>('POST', '/auth/token/refresh', { refreshToken: session!.refreshToken })
      setSession({ ...session!, accessToken: r.accessToken, refreshToken: r.refreshToken })
      return true
    } catch {
      setSession(null)
      window.dispatchEvent(new CustomEvent(SIGNOUT_EVENT))
      return false
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

async function raw<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API_URL}/v1${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  if (!res.ok) {
    const e = json?.error
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? `Request failed (${res.status})`, e ?? {})
  }
  return json as T
}

async function request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  try {
    return await raw<T>(method, path, body, headers)
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && session && (await refreshOnce())) {
      return raw<T>(method, path, body, headers)
    }
    throw err
  }
}

const qs = (params: Record<string, string | null | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}
const id = encodeURIComponent

export const api = {
  requestCode: (phone: string, channel?: 'sms' | 'whatsapp') =>
    raw<{ sent: boolean; channel: 'sms' | 'whatsapp'; devCode?: string }>('POST', '/auth/otp/request', channel ? { phone, channel } : { phone }),
  async verifyCode(phone: string, code: string) {
    const r = await raw<{ accessToken: string; refreshToken: string }>('POST', '/auth/otp/verify', { phone, code })
    setSession({ accessToken: r.accessToken, refreshToken: r.refreshToken, phone })
  },
  async signOut() {
    const token = session?.refreshToken
    setSession(null)
    if (token) await raw('POST', '/auth/logout', { refreshToken: token }).catch(() => undefined)
    window.dispatchEvent(new CustomEvent(SIGNOUT_EVENT))
  },

  checkPincode: (pincode: string) => request<DeliveryCheck>('GET', `/delivery/check${qs({ pincode })}`),
  catalogue: (pincode: string, date: string | null) => request<Catalogue>('GET', `/catalogue${qs({ pincode, delivery_date: date })}`),
  slots: (pincode: string, date: string) =>
    request<{ deliveryDate: string; slots: SlotOnDate[] }>('GET', `/delivery/slots${qs({ pincode, delivery_date: date })}`),

  serverCart: () => request<{ lines: { sku: string; stage: Stage; qty: number }[] }>('GET', '/cart'),
  setCartLine: (sku: string, stage: Stage, qty: number) => request<void>('POST', '/cart/items', { sku, stage, qty }),
  quote: (input: { pincode: string; deliveryDate: string; slotId: string | null }) => request<Quote>('POST', '/checkout/quote', input),
  confirm: (input: { quoteId: string; address: string; name?: string }, idempotencyKey: string) =>
    request<Confirmed>('POST', '/checkout/confirm', input, { 'Idempotency-Key': idempotencyKey }),

  orders: () => request<OrderSummary[]>('GET', '/orders'),
  order: (orderId: string) => request<Order>('GET', `/orders/${id(orderId)}`),
  cancel: (orderId: string) => request<void>('POST', `/orders/${id(orderId)}/cancel`),
  claims: () => request<Claim[]>('GET', '/claims'),
  raiseClaim: (input: { orderId: string; issueType: IssueType; description: string; itemSkus: string[]; photoUrl?: string }) =>
    request<{ id: string; status: string }>('POST', '/claims', input),

  preorderWeeks: () => request<{ weeks: PreorderWeek[]; cancelPolicy: string }>('GET', '/preorders/weeks'),
  bookPreorder: (input: PreorderInput, idempotencyKey: string) =>
    request<Preorder>('POST', '/preorders', input, { 'Idempotency-Key': idempotencyKey }),
  preorders: () => request<Preorder[]>('GET', '/preorders'),
  preorder: (preorderId: string) => request<Preorder>('GET', `/preorders/${id(preorderId)}`),
  cancelPreorder: (preorderId: string) => request<void>('POST', `/preorders/${id(preorderId)}/cancel`),

  /** The rider's photo of the handover, as an object URL (it needs the sign-in, so it is fetched). */
  async deliveryPhotoUrl(orderId: string): Promise<string> {
    const get = () => fetch(`${API_URL}/v1/orders/${id(orderId)}/delivery-photo`, { headers: session ? { Authorization: `Bearer ${session.accessToken}` } : {} })
    let res = await get()
    if (res.status === 401 && session && (await refreshOnce())) res = await get()
    if (!res.ok) throw new ApiError(res.status, 'PHOTO_UNAVAILABLE', 'The photo could not be loaded.')
    return URL.createObjectURL(await res.blob())
  },

  /** Development only: the API's stand-in for Razorpay. */
  devPay: (orderId: string, outcome: 'captured' | 'failed') => raw<{ result: string }>('POST', '/dev/pay', { orderId, outcome }),
  devPayPreorder: (preorderId: string, outcome: 'captured' | 'failed') =>
    raw<{ result: string }>('POST', '/dev/pay-preorder', { preorderId, outcome }),
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof TypeError) return 'Could not reach MandiMangoes. Check your connection and try again.'
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}
