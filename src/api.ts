// Every HTTP call to mango-api goes through request<T>() here.
//
// The access token lives only in this module's closure: never in storage,
// never logged. The refresh token is the httpOnly `mango_admin_rt` cookie,
// invisible to JS, so auth calls send credentials and let the browser carry it.

import type {
  ApiErrorBody,
  BatchDetail,
  BatchListItem,
  BatchStatus,
  Claim,
  ClaimResolution,
  ClaimStatus,
  Condition,
  LedgerEntry,
  Me,
  OrderDetail,
  OrderListItem,
  OrderStatus,
  PackListOrder,
  Paged,
  Pincode,
  Product,
  Ripeness,
  Rules,
  RulesVersion,
  CalendarDay,
  CoverageDay,
  DeliverySlot,
  Summary,
} from './types'

export const API_URL: string = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '')
const BASE = `${API_URL}/admin/v1`

export const SIGNOUT_EVENT = 'admin:signout'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let accessToken: string | null = null
let refreshPromise: Promise<boolean> | null = null

async function toApiError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null
  try {
    body = (await res.json()) as ApiErrorBody
  } catch {
    // Not JSON (proxy error page, empty body). Fall back to the status line.
  }
  return new ApiError(
    res.status,
    body?.error?.code ?? `HTTP_${res.status}`,
    body?.error?.message ?? (res.statusText || 'Request failed'),
    body?.error?.requestId,
  )
}

/** One shared refresh: a burst of parallel 401s issues a single refresh call. */
function refreshOnce(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
        if (!res.ok) return false
        const data = (await res.json()) as { accessToken?: string }
        if (!data.accessToken) return false
        accessToken = data.accessToken
        return true
      } catch {
        return false
      }
    })().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

function signOutLocally() {
  accessToken = null
  window.dispatchEvent(new CustomEvent(SIGNOUT_EVENT, { detail: { reason: 'expired' } }))
}

async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (res.status === 401 && !retried) {
    if (await refreshOnce()) return request<T>(method, path, body, true)
    signOutLocally()
    throw new ApiError(401, 'SESSION_ENDED', 'Your session has ended. Please sign in again.')
  }
  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

const id = encodeURIComponent

export const api = {
  /** Restores a session from the refresh cookie. Returns null if there is none. */
  async bootstrap(): Promise<Me | null> {
    if (!API_URL) return null
    if (!(await refreshOnce())) return null
    try {
      return await request<Me>('GET', '/auth/me')
    } catch {
      accessToken = null
      return null
    }
  },

  async login(email: string, password: string): Promise<Me> {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) throw await toApiError(res)
    const data = (await res.json()) as { accessToken: string }
    accessToken = data.accessToken
    return request<Me>('GET', '/auth/me')
  },

  /** Best-effort: a network failure still clears the local token. */
  async logout(): Promise<void> {
    try {
      await fetch(`${BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      })
    } catch {
      // ignore
    }
    accessToken = null
    window.dispatchEvent(new CustomEvent(SIGNOUT_EVENT, { detail: { reason: 'logout' } }))
  },

  summary: () => request<Summary>('GET', '/summary'),
  products: () => request<Product[]>('GET', '/products'),

  batches: (status?: BatchStatus | null) =>
    request<BatchListItem[]>('GET', `/batches${qs({ status })}`),
  batch: (batchId: string) => request<BatchDetail>('GET', `/batches/${id(batchId)}`),
  ledger: (batchId: string) => request<LedgerEntry[]>('GET', `/batches/${id(batchId)}/ledger`),
  createBatch: (input: {
    variety: string
    pluckedOn: string
    farm?: string
    lines: { sku: string; onHand: number }[]
  }) => request<BatchDetail>('POST', '/batches', input),
  /**
   * 204 for normal moves. CONDEMNED returns the orders moved to other batches
   * and the ones left at-risk; no order is cancelled.
   */
  setBatchStatus: (batchId: string, status: BatchStatus) =>
    request<{ rebalancedOrders?: string[]; atRiskOrders?: string[] } | undefined>(
      'PATCH',
      `/batches/${id(batchId)}/status`,
      { status },
    ),
  logQc: (batchId: string, input: { ripenessRating: Ripeness; condition: Condition; notes?: string }) =>
    request<{ id: string; warning?: string }>('POST', `/batches/${id(batchId)}/qc`, input),
  adjustLine: (
    batchId: string,
    lineId: string,
    input: { onHand?: number; reserveBuffer?: number; reason: string },
  ) => request<void>('PATCH', `/batches/${id(batchId)}/lines/${id(lineId)}`, input),

  orders: (f: { status?: string | null; from?: string | null; to?: string | null; q?: string | null; page?: number }) =>
    request<Paged<OrderListItem>>('GET', `/orders${qs(f)}`),
  order: (orderId: string) => request<OrderDetail>('GET', `/orders/${id(orderId)}`),
  setOrderStatus: (orderId: string, status: OrderStatus) =>
    request<void>('PATCH', `/orders/${id(orderId)}/status`, { status }),
  allocate: (orderId: string) => request<void>('POST', `/orders/${id(orderId)}/allocate`),
  cancelOrder: (orderId: string, reason: string) =>
    request<void>('POST', `/orders/${id(orderId)}/cancel`, { reason }),
  /** Moves a confirmed order to another bookable date that has stock (409 if it doesn't), optionally into a slot. */
  rescheduleOrder: (orderId: string, deliveryDate: string, slotId?: string | null) =>
    request<void>('POST', `/orders/${id(orderId)}/reschedule`, slotId ? { deliveryDate, slotId } : { deliveryDate }),

  async packList(date: string): Promise<PackListOrder[]> {
    const res = await request<PackListOrder[] | { orders: PackListOrder[] }>(
      'GET',
      `/pack-list${qs({ date })}`,
    )
    return Array.isArray(res) ? res : (res?.orders ?? [])
  },

  claims: (status?: ClaimStatus | null) => request<Claim[]>('GET', `/claims${qs({ status })}`),
  reviewClaim: (claimId: string) => request<void>('POST', `/claims/${id(claimId)}/review`),
  /** VMR doesn't refund: a claim is resolved by a replacement or rejected. */
  resolveClaim: (claimId: string, resolution: Exclude<ClaimResolution, 'REFUND_APPROVED'>) =>
    request<void>('POST', `/claims/${id(claimId)}/resolve`, { resolution }),

  pincodes: () => request<Pincode[]>('GET', '/pincodes'),
  addPincode: (input: { pincode: string; city: string; zone?: string }) =>
    request<Pincode>('POST', '/pincodes', input),
  updatePincode: (pincode: string, patch: Partial<Pick<Pincode, 'city' | 'zone' | 'active'>>) =>
    request<Pincode | undefined>('PATCH', `/pincodes/${id(pincode)}`, patch),
  deletePincode: (pincode: string) => request<void>('DELETE', `/pincodes/${id(pincode)}`),

  coverage: () => request<CoverageDay[]>('GET', '/coverage'),
  calendar: () => request<CalendarDay[]>('GET', '/calendar'),
  setCalendarDay: (day: CalendarDay) =>
    request<void>('PUT', `/calendar/${id(day.date)}`, { isOpen: day.isOpen, maxBoxes: day.maxBoxes, note: day.note }),
  clearCalendarDay: (date: string) => request<void>('DELETE', `/calendar/${id(date)}`),
  slots: () => request<DeliverySlot[]>('GET', '/slots'),
  addSlot: (input: Omit<DeliverySlot, 'id' | 'active' | 'sort'> & { sort?: number }) =>
    request<DeliverySlot>('POST', '/slots', input),
  updateSlot: (slotId: string, patch: Partial<Omit<DeliverySlot, 'id'>>) =>
    request<DeliverySlot>('PATCH', `/slots/${id(slotId)}`, patch),
  rules: () => request<RulesVersion>('GET', '/config'),
  saveRules: (rules: Rules) => request<RulesVersion>('PUT', '/config', { rules }),
}

export interface ErrorInfo {
  message: string
  detail?: string
}

/** Turns any thrown value into display text, with the requestId for support. */
export function errorMessage(err: unknown): ErrorInfo {
  if (err instanceof ApiError) {
    return {
      message: err.message,
      detail: err.requestId ? `Reference: ${err.requestId}` : undefined,
    }
  }
  if (err instanceof TypeError) {
    return { message: 'Could not reach the server. Check your connection and try again.' }
  }
  if (err instanceof Error) return { message: err.message }
  return { message: 'Something went wrong.' }
}

export function isConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409
}
