// Every HTTP call to mango-api goes through request<T>() here.
//
// The access token lives only in this module's closure: never in storage,
// never logged. The refresh token is the httpOnly `mango_admin_rt` cookie,
// invisible to JS, so auth calls send credentials and let the browser carry it.

import { ApiError, errorFrom, parseAnswer } from './apiAnswer'
import type {
  BulkEvent,
  BulkListing,
  BulkListingInput,
  BulkListingSummary,
  BulkStatus,
  BatchDetail,
  Analytics,
  Attention,
  LedgerRepairPlan,
  LineCounters,
  AuditPage,
  BulkMoveResult,
  ShortArrivalResult,
  Manifest,
  Rider,
  BatchListItem,
  BatchStatus,
  Claim,
  CustomerMatch,
  CustomerProfile,
  ExportKind,
  ClaimResolution,
  ClaimStatus,
  Condition,
  LedgerEntry,
  AdjustReason,
  Me,
  SignInResult,
  Promo,
  NewPromo,
  HelpInbox,
  WaConversationDetail,
  WaFailures,
  WaInbox,
  WaInboxView,
  WaOverview,
  WaConnectionCheck,
  WaTemplateReport,
  HelpRequestDetail,
  HelpStatus,
  HelpTopic,
  SubscriptionList,
  OrderDetail,
  OrderListItem,
  GiftOrderListItem,
  OrderStatus,
  PackListOrder,
  Paged,
  Pincode,
  Product,
  ProductInput,
  Ripeness,
  Rules,
  RulesVersion,
  CalendarDay,
  CoverageDay,
  FailReason,
  DeliverySlot,
  Preorder,
  PreorderCapacity,
  PreorderStatus,
  Review,
  ReviewDetail,
  ReviewFilters,
  ReviewInsights,
  ReviewQueue,
  Role,
  StaffMember,
  Summary,
  DailySummaryPreview,
  DailySummarySetting,
  Funnel,
  ReferralList,
  ReferralStatus,
  BatchPurchases,
  Farm,
  FarmInput,
  FeatureSwitch,
  Margins,
  Purchase,
  PurchaseInput,
  StockForecast,
} from './types'

export const API_URL: string = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '')
const BASE = `${API_URL}/admin/v1`

export const SIGNOUT_EVENT = 'admin:signout'

export { ApiError }

let accessToken: string | null = null
let refreshPromise: Promise<'ok' | 'refused' | 'unavailable'> | null = null

async function toApiError(res: Response): Promise<ApiError> {
  return errorFrom(res.status, res.statusText, await res.text().catch(() => ''))
}

/**
 * One shared refresh: a burst of parallel 401s issues a single refresh call.
 * 'refused' only when the API says the refresh cookie is no good (401); a busy
 * API (503), a proxy error or being offline is 'unavailable', which must not
 * sign anyone out.
 */
type Refresh = 'ok' | 'refused' | 'unavailable'
function refreshOnce(): Promise<Refresh> {
  if (!refreshPromise) {
    refreshPromise = (async (): Promise<Refresh> => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
        if (res.status === 401) return 'refused'
        if (!res.ok) return 'unavailable'
        const data = (await res.json()) as { accessToken?: string }
        if (!data.accessToken) return 'refused'
        accessToken = data.accessToken
        return 'ok'
      } catch {
        return 'unavailable'
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

/** A Blob body is sent as-is (photos); anything else as JSON. */
async function send(method: string, path: string, body?: unknown, retried = false, extra?: Record<string, string>): Promise<Response> {
  const headers: Record<string, string> = { ...extra }
  const blob = body instanceof Blob
  if (body !== undefined) headers['Content-Type'] = blob ? body.type : 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : blob ? body : JSON.stringify(body),
  })

  if (res.status === 401 && !retried) {
    const refreshed = await refreshOnce()
    if (refreshed === 'ok') return send(method, path, body, true, extra)
    if (refreshed === 'unavailable') throw new ApiError(503, 'UNAVAILABLE', 'The server is busy or unreachable. Please try again in a minute.')
    signOutLocally()
    throw new ApiError(401, 'SESSION_ENDED', 'Your session has ended. Please sign in again.')
  }
  if (!res.ok) throw await toApiError(res)
  return res
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await send(method, path, body)
  if (res.status === 204) return undefined as T
  return parseAnswer<T>(res.status, await res.text())
}

/** For the warehouse module (src/warehouse/api.ts): a request with extra headers, e.g. Idempotency-Key. */
export async function apiRequest<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await send(method, path, body, false, headers)
  if (res.status === 204) return undefined as T
  return parseAnswer<T>(res.status, await res.text())
}

/** A signed-in download (a PDF or CSV) as an object URL; the caller revokes it. */
export async function apiBlobUrl(path: string): Promise<string> {
  const res = await send('GET', path)
  return URL.createObjectURL(await res.blob())
}

/** The body of a staff change confirmed with the manager's code or password; none when not asked. */
const confirmBody = (confirmCode?: string) => (confirmCode ? { confirmCode } : undefined)

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

const id = encodeURIComponent

/** Password, Google or the second step: either a session or a ticket for the code. */
async function firstStep(path: string, body: unknown): Promise<SignInResult> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await toApiError(res)
  const data = (await res.json()) as { accessToken?: string; twoStep?: boolean; ticket?: string }
  if (data.twoStep && data.ticket) return { ticket: data.ticket }
  accessToken = data.accessToken ?? null
  return { me: await request<Me>('GET', '/auth/me') }
}

export const api = {
  /** Restores a session from the refresh cookie. Returns null if there is none. */
  async bootstrap(): Promise<Me | null> {
    if (!API_URL) return null
    if ((await refreshOnce()) !== 'ok') return null
    try {
      return await request<Me>('GET', '/auth/me')
    } catch {
      accessToken = null
      return null
    }
  },

  async login(email: string, password: string): Promise<SignInResult> {
    return firstStep('/auth/login', { email, password })
  },

  /** The code from the authenticator app (or a recovery code) after the password or Google. */
  async twoStep(ticket: string, code: string): Promise<Me> {
    const r = await firstStep('/auth/two-step', { ticket, code })
    if (!('me' in r)) throw new ApiError(401, 'TICKET_EXPIRED', 'Sign in again.')
    return r.me
  },

  /** Whether "Sign in with Google" is set up. */
  async authConfig(): Promise<{ googleClientId: string | null }> {
    if (!API_URL) return { googleClientId: null }
    const res = await fetch(`${BASE}/auth/config`)
    if (!res.ok) return { googleClientId: null }
    return (await res.json()) as { googleClientId: string | null }
  },

  async loginWithGoogle(credential: string): Promise<SignInResult> {
    return firstStep('/auth/google', { credential })
  },

  /** Starts setting up two-step sign-in: the secret for the authenticator app. */
  twoStepSetup: (setupCode?: string, confirmCode?: string) =>
    request<{ secret: string; otpauthUrl: string }>('POST', '/me/two-step/setup', { ...(setupCode ? { setupCode } : {}), ...confirmBody(confirmCode) }),
  /** Confirms a code from the app. Returns the recovery codes, shown this once. */
  async twoStepEnable(code: string): Promise<string[]> {
    const r = await request<{ recoveryCodes: string[]; accessToken: string }>('POST', '/me/two-step/enable', { code })
    accessToken = r.accessToken
    return r.recoveryCodes
  },
  twoStepDisable: (code: string) => request<void>('POST', '/me/two-step/disable', { code }),
  /** Changes your own password. Your other sessions end; this one carries on with a new token. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const r = await request<{ accessToken: string }>('POST', '/me/password', { currentPassword, newPassword })
    accessToken = r.accessToken
  },
  me: () => request<Me>('GET', '/auth/me'),
  /** Clears someone's two-step sign-in. Returns the setup code they need to set it up again (shown once). */
  resetTwoStep: (staffId: string, confirmCode?: string) =>
    request<{ setupCode: string }>('POST', `/staff/${id(staffId)}/two-step/reset`, confirmBody(confirmCode)),
  /** A new setup code for someone who hasn't set up two-step sign-in yet (shown once). */
  newSetupCode: (staffId: string, confirmCode?: string) =>
    request<{ setupCode: string }>('POST', `/staff/${id(staffId)}/two-step/setup-code`, confirmBody(confirmCode)),

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
  attention: () => request<Attention>('GET', '/attention'),
  retryMessage: (notificationId: string) => request<void>('POST', `/notifications/${id(notificationId)}/retry`),
  // Manager ways out of Needs attention items. Each needs a reason and is written to the staff activity.
  ledgerRepairPlan: (batchId: string, lineId: string) => request<LedgerRepairPlan>('GET', `/batches/${id(batchId)}/lines/${id(lineId)}/repair`),
  repairLedger: (batchId: string, lineId: string, reason: string, expected: LineCounters) =>
    request<LedgerRepairPlan>('POST', `/batches/${id(batchId)}/lines/${id(lineId)}/repair`, { reason, expected }),
  resolveWebhookFailure: (failureId: string, note: string) => request<unknown>('POST', `/webhook-failures/${id(failureId)}/resolve`, { note }),
  // Money and pricing changes always ask the manager to confirm it is them (`confirmCode`, the server's STEP_UP_ROUTES).
  refundUnmatchedPayment: (failureId: string, reason: string, confirmCode?: string) =>
    request<{ paymentId: string; queued: boolean }>('POST', `/webhook-failures/${id(failureId)}/refund`, { reason, ...confirmBody(confirmCode) }),
  keepPreorder: (preorderId: string, reason: string) => request<unknown>('POST', `/preorders/${id(preorderId)}/keep`, { reason }),
  /** INV-06: sets a week's taken preorder capacity from its bookings; reserved and booked are the numbers shown. */
  recountPreorderCapacity: (weekStart: string, sku: string, seen: { reserved: number; booked: number }, reason: string) =>
    request<{ recounted: boolean; reserved: number; booked: number }>('POST', `/preorder-capacity/${id(weekStart)}/${id(sku)}/recount`, { ...seen, reason }),
  refundPaidAnotherWay: (type: 'order' | 'preorder' | 'payment', refundId: string, reference: string, reason: string, confirmCode?: string) =>
    request<{ id: string; refundId: string }>('POST', `/refunds/${id(refundId)}/paid-another-way`, { type, reference, reason, ...confirmBody(confirmCode) }),
  signOutAllStaff: (reason: string, keepMe = true, confirmCode?: string) =>
    request<{ signedOut: number; keptMe: boolean }>('POST', '/staff/sign-out-all', { reason, keepMe, ...confirmBody(confirmCode) }),
  /** Signs off a photo delivery, or flags it as doubtful (with a note) for a call to the customer. */
  reviewDelivery: (attemptId: string, ok: boolean, note?: string) => request<void>('POST', `/delivery-reviews/${id(attemptId)}`, { ok, note }),
  products: () => request<Product[]>('GET', '/products'),
  addProduct: (p: ProductInput & { sku: string }, confirmCode?: string) => request<Product>('POST', '/products', { ...p, ...confirmBody(confirmCode) }),
  /** `reason`: why (optional), kept in the staff activity with the values before the change (ADM-2). */
  updateProduct: (sku: string, patch: Partial<ProductInput> & { active?: boolean; reason?: string }, confirmCode?: string) =>
    request<Product>('PATCH', `/products/${id(sku)}`, { ...patch, ...confirmBody(confirmCode) }),
  /** Deletes a product never stocked or sold; otherwise takes it off sale and keeps it. */
  removeProduct: (sku: string, confirmCode?: string) => request<{ sku: string; outcome: 'deleted' | 'hidden' }>('DELETE', `/products/${id(sku)}`, confirmBody(confirmCode)),
  /** Sets the product's shop photo (replacing any earlier one). */
  setProductPhoto: (sku: string, photo: Blob) => request<Product>('PUT', `/products/${id(sku)}/photo`, photo),

  bulkListings: (status?: BulkStatus | null, page = 1) =>
    request<{ items: BulkListingSummary[]; page: number; pageSize: number; total: number }>('GET', `/bulk-listings${qs({ status, page })}`),
  bulkListing: (listingId: string) => request<BulkListing>('GET', `/bulk-listings/${id(listingId)}`),
  addBulkListing: (input: BulkListingInput, confirmCode?: string) => request<BulkListing>('POST', '/bulk-listings', { ...input, ...confirmBody(confirmCode) }),
  updateBulkListing: (listingId: string, patch: Partial<BulkListingInput>, confirmCode?: string) =>
    request<BulkListing>('PATCH', `/bulk-listings/${id(listingId)}`, { ...patch, ...confirmBody(confirmCode) }),
  /** Publish, unpublish or archive (archived is final). */
  moveBulkListing: (listingId: string, to: 'publish' | 'unpublish' | 'archive') => request<BulkListing>('POST', `/bulk-listings/${id(listingId)}/${to}`, {}),
  bulkHistory: (listingId: string) => request<BulkEvent[]>('GET', `/bulk-listings/${id(listingId)}/history`),
  addBulkPhoto: (listingId: string, photo: Blob) => request<BulkListing>('POST', `/bulk-listings/${id(listingId)}/photos`, photo),
  orderBulkPhotos: (listingId: string, ids: string[]) => request<BulkListing>('PUT', `/bulk-listings/${id(listingId)}/photos/order`, { ids }),
  removeBulkPhoto: (listingId: string, photoId: string) => request<BulkListing>('DELETE', `/bulk-listings/${id(listingId)}/photos/${id(photoId)}`),
  /** An object URL for a listing photo (fetched with the staff sign-in: a draft's photos are not public). */
  async bulkPhotoUrl(listingId: string, photoId: string): Promise<string> {
    const res = await send('GET', `/bulk-listings/${id(listingId)}/photos/${id(photoId)}?w=320`)
    return URL.createObjectURL(await res.blob())
  },
  removeProductPhoto: (sku: string) => request<Product>('DELETE', `/products/${id(sku)}/photo`),

  batches: (status?: BatchStatus | null) =>
    request<BatchListItem[]>('GET', `/batches${qs({ status })}`),
  batch: (batchId: string) => request<BatchDetail>('GET', `/batches/${id(batchId)}`),
  ledger: (batchId: string) => request<LedgerEntry[]>('GET', `/batches/${id(batchId)}/ledger`),
  /** key: one per filled-in intake form, so a double submit or a retry records one batch (INV-02). */
  createBatch: (
    input: {
      variety: string
      pluckedOn: string
      farm?: string
      lines: { sku: string; onHand: number }[]
    },
    key: string,
  ) => apiRequest<BatchDetail>('POST', '/batches', input, { 'Idempotency-Key': key }),
  /**
   * 204 for normal moves. CONDEMNED returns the orders moved to other batches
   * and the ones left at-risk; no order is cancelled.
   */
  setBatchStatus: (batchId: string, status: BatchStatus, reason?: string) =>
    request<{ rebalancedOrders?: string[]; atRiskOrders?: string[] } | undefined>(
      'PATCH',
      `/batches/${id(batchId)}/status`,
      reason ? { status, reason } : { status },
    ),
  logQc: (batchId: string, input: { ripenessRating: Ripeness; condition: Condition; notes?: string }) =>
    request<{ id: string; warning?: string }>('POST', `/batches/${id(batchId)}/qc`, input),
  adjustLine: (
    batchId: string,
    lineId: string,
    input: { onHand?: number; reserveBuffer?: number; reason: string; reasonCode?: AdjustReason },
  ) => request<void>('PATCH', `/batches/${id(batchId)}/lines/${id(lineId)}`, input),
  /**
   * Fewer boxes arrived than were already promised: lowers on hand, takes boxes
   * back from the youngest orders and re-fills them or moves them to the next date with stock.
   */
  shortArrival: (batchId: string, lineId: string, input: { onHand: number; reason: string; reasonCode?: AdjustReason }) =>
    request<ShortArrivalResult>('POST', `/batches/${id(batchId)}/lines/${id(lineId)}/short-arrival`, input),

  orders: (f: { status?: string | null; from?: string | null; to?: string | null; q?: string | null; page?: number }) =>
    request<Paged<OrderListItem>>('GET', `/orders${qs(f)}`),
  order: (orderId: string) => request<OrderDetail>('GET', `/orders/${id(orderId)}`),
  /** Gift orders to many recipients with their deliveries (MULTI_GIFT; managers and operators). */
  giftOrders: (f: { q?: string | null; page?: number }) => request<Paged<GiftOrderListItem>>('GET', `/gift-orders${qs(f)}`),
  /** The order's bill as a PDF (managers and operators; each download is in the activity log). */
  billUrl: (orderId: string) => apiBlobUrl(`/orders/${id(orderId)}/bill`),

  // Customer profiles (managers and operators). Every search, view and reveal is in the activity log.
  /** Finds a customer by mobile number; the POST keeps the number out of URLs and logs. */
  findCustomers: (phone: string) => request<{ items: CustomerMatch[] }>('POST', '/customers/search', { phone }),
  customer: (customerId: string) => request<CustomerProfile>('GET', `/customers/${id(customerId)}`),
  /** The full phone number and email, recorded as a reveal. */
  revealCustomer: (customerId: string) => request<{ phone: string | null; email: string | null }>('POST', `/customers/${id(customerId)}/reveal`, {}),
  /** A CSV export (managers): from/to are IST dates, at most 92 days; orders-type exports can go by delivery date. */
  exportUrl: (kind: ExportKind, p: { from: string; to: string; by?: 'placed' | 'delivery' }) => apiBlobUrl(`/exports/${kind}${qs(p)}`),
  /**
   * A status move. DELIVERED without the customer's code or a photo, sending out
   * at-risk stock, or a retry after the last attempt need a manager's override with a reason.
   */
  setOrderStatus: (orderId: string, status: OrderStatus, override?: { reason: string }) =>
    request<void>('PATCH', `/orders/${id(orderId)}/status`, override ? { status, override: true, reason: override.reason } : { status }),
  allocate: (orderId: string) => request<void>('POST', `/orders/${id(orderId)}/allocate`),
  /** A paid order can only be cancelled by a manager, with a full refund (refund: true). */
  cancelOrder: (orderId: string, reason: string, refund = false, confirmCode?: string) =>
    request<void>('POST', `/orders/${id(orderId)}/cancel`, { reason, refund, ...confirmBody(confirmCode) }),
  /** Boxes back from an order cancelled or returned after dispatch: back on the shelf, or written off with a reason. */
  bookReturnedStock: (orderId: string, input: { action: 'RESTOCK' | 'WRITE_OFF'; reasonCode?: 'DAMAGED' | 'THEFT_LOSS' | 'OTHER'; reason: string }) =>
    request<{ boxes: number }>('POST', `/orders/${id(orderId)}/returned-stock`, input),
  /** Moves a confirmed order to another bookable date that has stock (409 if it doesn't), optionally into a slot. */
  rescheduleOrder: (orderId: string, deliveryDate: string, slotId?: string | null) =>
    request<void>('POST', `/orders/${id(orderId)}/reschedule`, slotId ? { deliveryDate, slotId } : { deliveryDate }),
  /** Moves every confirmed order on one date (optionally some pincodes) to another; managers only. */
  bulkReschedule: (input: { fromDate: string; toDate: string; pincodes?: string[]; reason: string; dryRun?: boolean }) =>
    request<BulkMoveResult>('POST', '/orders/bulk-reschedule', input),

  async packList(date: string): Promise<PackListOrder[]> {
    const res = await request<PackListOrder[] | { orders: PackListOrder[] }>(
      'GET',
      `/pack-list${qs({ date })}`,
    )
    return Array.isArray(res) ? res : (res?.orders ?? [])
  },

  analytics: (f: { from?: string | null; to?: string | null } = {}) => request<Analytics>('GET', `/analytics${qs(f)}`),
  manifest: (date: string) => request<Manifest>('GET', `/manifest${qs({ date })}`),
  /** Puts every packed order of a run (one slot, null for orders without one) out for delivery. */
  dispatchRun: (date: string, slotId: string | null) =>
    request<{ dispatched: string[]; skipped: { number: string; reason: string }[] }>('POST', '/manifest/dispatch', { date, slotId }),
  dispatch: (orderId: string) => request<void>('POST', `/orders/${id(orderId)}/dispatch`),
  /** A rider takes every packed stop on the date that nobody has yet, and sends them out with their own. */
  takeRun: (date: string) =>
    request<{ dispatched: string[]; skipped: { number: string; reason: string }[] }>('POST', '/manifest/dispatch', { date }),
  riders: () => request<Rider[]>('GET', '/riders'),
  /** Gives stops to a rider (null: to nobody): the listed orders, or every order still to deliver in a slot. */
  assignRiders: (input: { date: string; riderId: string | null; orderIds?: string[]; slotId?: string | null }) =>
    request<{ assigned: string[] }>('POST', '/manifest/assign', input),
  uploadDeliveryPhoto: (orderId: string, photo: Blob) => request<{ id: string }>('POST', `/orders/${id(orderId)}/delivery-photos`, photo),
  /** An object URL for a delivery photo (the image needs the staff sign-in, so it is fetched, not linked). */
  async deliveryPhotoUrl(orderId: string, photoId: string): Promise<string> {
    const res = await send('GET', `/orders/${id(orderId)}/delivery-photos/${id(photoId)}`)
    return URL.createObjectURL(await res.blob())
  },
  recordDelivery: (
    orderId: string,
    body:
      | { outcome: 'DELIVERED'; code?: string; photoId?: string; receivedBy?: string; lat?: number; lng?: number; attempt?: number }
      | { outcome: 'FAILED'; reason: FailReason; note?: string; photoId?: string; lat?: number; lng?: number; attempt?: number },
  ) => request<{ outcome: 'DELIVERED' | 'FAILED'; method?: string }>('POST', `/orders/${id(orderId)}/delivery`, body),

  claims: (status?: ClaimStatus | null) => request<Claim[]>('GET', `/claims${qs({ status })}`),
  /** An object URL for a claim photo (fetched with the staff sign-in). */
  async claimPhotoUrl(claimId: string, photoId: string): Promise<string> {
    const res = await send('GET', `/claims/${id(claimId)}/photos/${id(photoId)}`)
    return URL.createObjectURL(await res.blob())
  },
  reviews: (f: ReviewFilters) =>
    request<ReviewQueue>(
      'GET',
      `/reviews${qs({
        status: f.status,
        stars: f.stars,
        hasPhotos: f.hasPhotos == null ? null : String(f.hasPhotos),
        flagged: f.flagged == null ? null : String(f.flagged),
        variety: f.variety,
        cursor: f.cursor,
      })}`,
    ),
  review: (reviewId: string) => request<ReviewDetail>('GET', `/reviews/${id(reviewId)}`),
  approveReview: (reviewId: string, photoIds: string[], reason?: string | null) =>
    request<Review>('POST', `/reviews/${id(reviewId)}/approve`, { photoIds, reason: reason || null }),
  rejectReview: (reviewId: string, reason: string) => request<Review>('POST', `/reviews/${id(reviewId)}/reject`, { reason }),
  hideReview: (reviewId: string, reason: string) => request<Review>('POST', `/reviews/${id(reviewId)}/hide`, { reason }),
  bulkReviews: (action: 'approve' | 'reject', ids: string[], reason?: string | null) =>
    request<{ done: string[]; failed: { id: string; code: string; message: string }[] }>('POST', '/reviews/bulk', { action, ids, reason: reason || null }),
  replyToReview: (reviewId: string, body: string) => request<Review>('PUT', `/reviews/${id(reviewId)}/reply`, { body }),
  deleteReviewReply: (reviewId: string) => request<void>('DELETE', `/reviews/${id(reviewId)}/reply`),
  /** An object URL for a review photo (fetched with the staff sign-in; private until approved). */
  async reviewPhotoUrl(reviewId: string, photoId: string): Promise<string> {
    const res = await send('GET', `/reviews/${id(reviewId)}/photos/${id(photoId)}`)
    return URL.createObjectURL(await res.blob())
  },
  reviewInsights: (days = 90) => request<ReviewInsights>('GET', `/reviews/insights${qs({ days })}`),
  reviewClaim: (claimId: string) => request<void>('POST', `/claims/${id(claimId)}/review`),
  /** MandiMangoes doesn't refund: a claim is resolved by a replacement or rejected. */
  /** A rejection needs `reason` (5+ characters), which the customer sees. */
  resolveClaim: (claimId: string, resolution: Exclude<ClaimResolution, 'REFUND_APPROVED'>, reason?: string) =>
    request<void>('POST', `/claims/${id(claimId)}/resolve`, reason ? { resolution, reason } : { resolution }),

  // Growth (docs/growth.md), managers only; each answers 404 while its switch is off.
  referrals: (status?: ReferralStatus | null) => request<ReferralList>('GET', `/referrals${qs({ status })}`),
  funnel: (f: { from?: string | null; to?: string | null } = {}) => request<Funnel>('GET', `/analytics/funnel${qs(f)}`),
  dailySummarySetting: () => request<DailySummarySetting>('GET', '/me/daily-summary'),
  saveDailySummarySetting: (body: { optedIn: boolean; phone?: string }) => request<DailySummarySetting>('PUT', '/me/daily-summary', body),
  dailySummaryPreview: () => request<DailySummaryPreview>('GET', '/daily-summary/preview'),
  // Customer care (docs/care.md): the Help desk and the Subscriptions list, managers and operators.
  helpRequests: (f: { status?: HelpStatus | null; topic?: HelpTopic | null; q?: string | null } = {}) =>
    request<HelpInbox>('GET', `/help/requests${qs({ status: f.status ?? undefined, topic: f.topic ?? undefined, q: f.q || undefined })}`),
  helpRequest: (requestId: string) => request<HelpRequestDetail>('GET', `/help/requests/${id(requestId)}`),
  replyHelpRequest: (requestId: string, message: string) => request<HelpRequestDetail>('POST', `/help/requests/${id(requestId)}/reply`, { message }),
  resolveHelpRequest: (requestId: string) => request<HelpRequestDetail>('POST', `/help/requests/${id(requestId)}/resolve`),
  reopenHelpRequest: (requestId: string) => request<HelpRequestDetail>('POST', `/help/requests/${id(requestId)}/reopen`),
  // WhatsApp (docs/whatsapp/OPERATIONS.md): the inbox for managers and operators; set-up and health for managers.
  waInbox: (view: WaInboxView = 'waiting', page = 1) => request<WaInbox>('GET', `/whatsapp/conversations${qs({ view, page: page > 1 ? page : undefined })}`),
  waConversation: (conversationId: string) => request<WaConversationDetail>('GET', `/whatsapp/conversations/${id(conversationId)}`),
  waReply: (conversationId: string, text: string) => request<WaConversationDetail>('POST', `/whatsapp/conversations/${id(conversationId)}/reply`, { text }),
  waTakeOver: (conversationId: string) => request<WaConversationDetail>('POST', `/whatsapp/conversations/${id(conversationId)}/take-over`),
  waHandBack: (conversationId: string) => request<WaConversationDetail>('POST', `/whatsapp/conversations/${id(conversationId)}/hand-back`),
  waClose: (conversationId: string) => request<WaConversationDetail>('POST', `/whatsapp/conversations/${id(conversationId)}/close`),
  waAssign: (conversationId: string, adminId: string | null) => request<WaConversationDetail>('POST', `/whatsapp/conversations/${id(conversationId)}/assign`, { adminId }),
  /** Staff only record an opt-out the customer asked for; opting in is the customer's own act. */
  waOptOut: (conversationId: string, scope: 'all' | 'marketing') => request<WaConversationDetail>('POST', `/whatsapp/conversations/${id(conversationId)}/opt-out`, { scope }),
  waRetryMessage: (messageId: string) => request<{ queued: string }>('POST', `/whatsapp/messages/${id(messageId)}/retry`),
  /** A customer's photo or file as an object URL: the API fetches it from Meta, so no Meta address reaches the browser. */
  async waMediaUrl(messageId: string): Promise<string> {
    const res = await send('GET', `/whatsapp/media/${id(messageId)}`)
    return URL.createObjectURL(await res.blob())
  },
  waOverview: () => request<WaOverview>('GET', '/whatsapp/overview'),
  waCheck: () => request<WaConnectionCheck>('POST', '/whatsapp/check'),
  waSyncTemplates: () => request<WaTemplateReport>('POST', '/whatsapp/templates/sync'),
  waSetAutomation: (kind: string, enabled: boolean, confirmCode?: string) =>
    request<WaTemplateReport>('PUT', `/whatsapp/automations/${id(kind)}`, { enabled, ...confirmBody(confirmCode) }),
  waFailures: () => request<WaFailures>('GET', '/whatsapp/failures'),
  waReplayEvent: (eventId: string) => request<{ ok: boolean; error: string | null }>('POST', `/whatsapp/events/${id(eventId)}/replay`),
  subscriptions: (status: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | null = null) => request<SubscriptionList>('GET', `/subscriptions${qs({ status: status ?? undefined })}`),
  /** Pause or cancel needs a reason (5+ characters); it is kept in the activity log. */
  pauseSubscription: (subscriptionId: string, reason: string) => request<void>('POST', `/subscriptions/${id(subscriptionId)}/pause`, { reason }),
  cancelSubscription: (subscriptionId: string, reason: string) => request<void>('POST', `/subscriptions/${id(subscriptionId)}/cancel`, { reason }),

  promos: () => request<Promo[]>('GET', '/promos'),
  addPromo: (p: NewPromo, confirmCode?: string) => request<Promo>('POST', '/promos', { ...p, ...confirmBody(confirmCode) }),
  updatePromo: (code: string, patch: { active?: boolean; endsOn?: string | null; maxUses?: number | null; description?: string | null }, confirmCode?: string) =>
    request<Promo>('PATCH', `/promos/${id(code)}`, { ...patch, ...confirmBody(confirmCode) }),
  staff: () => request<StaffMember[]>('GET', '/staff'),
  // Staff changes carry `confirmCode` when the server asks the manager to confirm it is them (SEC-07, STAFF_STEP_UP).
  addStaff: (input: { email: string; role: Role; password: string }, confirmCode?: string) =>
    request<StaffMember>('POST', '/staff', { ...input, ...confirmBody(confirmCode) }),
  updateStaff: (staffId: string, patch: { role?: Role; password?: string }, confirmCode?: string) =>
    request<StaffMember>('PATCH', `/staff/${id(staffId)}`, { ...patch, ...confirmBody(confirmCode) }),
  removeStaff: (staffId: string, confirmCode?: string) => request<void>('DELETE', `/staff/${id(staffId)}`, confirmBody(confirmCode)),
  /** `reads`: also list views of customer details (recorded with STAFF_AUDIT_TRAIL on the server). */
  audit: (f: { staff?: string | null; from?: string | null; to?: string | null; page?: number; reads?: boolean } = {}) =>
    request<AuditPage>('GET', `/audit${qs({ ...f, reads: f.reads ? 'true' : undefined })}`),

  pincodes: () => request<Pincode[]>('GET', '/pincodes'),
  addPincode: (input: { pincode: string; city: string; zone?: string }) =>
    request<Pincode>('POST', '/pincodes', input),
  updatePincode: (pincode: string, patch: Partial<Pick<Pincode, 'city' | 'zone' | 'active'>>) =>
    request<Pincode | undefined>('PATCH', `/pincodes/${id(pincode)}`, patch),
  deletePincode: (pincode: string) => request<void>('DELETE', `/pincodes/${id(pincode)}`),

  coverage: () => request<CoverageDay[]>('GET', '/coverage'),
  // Staff operations (docs/ops.md).
  stockForecast: () => request<StockForecast>('GET', '/planning/forecast'),
  farms: () => request<Farm[]>('GET', '/farms'),
  addFarm: (input: FarmInput) => request<Farm>('POST', '/farms', input),
  updateFarm: (farmId: string, patch: Partial<FarmInput>) => request<Farm>('PATCH', `/farms/${id(farmId)}`, patch),
  batchPurchases: (batchId: string) => request<BatchPurchases>('GET', `/batches/${id(batchId)}/purchases`),
  addPurchase: (batchId: string, input: PurchaseInput, confirmCode?: string) =>
    request<Purchase>('POST', `/batches/${id(batchId)}/purchases`, { ...input, ...confirmBody(confirmCode) }),
  updatePurchase: (batchId: string, purchaseId: string, patch: Partial<PurchaseInput>, confirmCode?: string) =>
    request<Purchase>('PATCH', `/batches/${id(batchId)}/purchases/${id(purchaseId)}`, { ...patch, ...confirmBody(confirmCode) }),
  margins: (p: { from: string; to: string }) => request<Margins>('GET', `/analytics/margins${qs(p)}`),
  featureSwitches: () => request<{ cacheSeconds: number; items: FeatureSwitch[] }>('GET', '/settings/switches'),
  /** A change always asks the manager to confirm it is them (confirmCode). enabled null: back to the server's setting. */
  setFeatureSwitch: (key: string, enabled: boolean | null, confirmCode?: string) =>
    request<FeatureSwitch>('PUT', `/settings/switches/${id(key)}`, { enabled, ...confirmBody(confirmCode) }),
  calendar: () => request<CalendarDay[]>('GET', '/calendar'),
  setCalendarDay: (day: CalendarDay) =>
    request<void>('PUT', `/calendar/${id(day.date)}`, { isOpen: day.isOpen, maxBoxes: day.maxBoxes, note: day.note }),
  clearCalendarDay: (date: string) => request<void>('DELETE', `/calendar/${id(date)}`),
  preorders: (status?: PreorderStatus | null) => request<Preorder[]>('GET', `/preorders${qs({ status })}`),
  preorderCapacity: () => request<PreorderCapacity[]>('GET', '/preorder-capacity'),
  /** Manager only: cancels a booking we can't fill; a paid one is refunded in full. */
  cancelPreorder: (preorderId: string, reason: string, confirmCode?: string) =>
    request<{ refunded: boolean }>('POST', `/preorders/${id(preorderId)}/cancel`, { reason, ...confirmBody(confirmCode) }),
  setPreorderCapacity: (weekStart: string, sku: string, capacity: number) =>
    request<unknown>('PUT', `/preorder-capacity/${id(weekStart)}/${id(sku)}`, { capacity }),
  slots: () => request<DeliverySlot[]>('GET', '/slots'),
  addSlot: (input: Omit<DeliverySlot, 'id' | 'active' | 'sort'> & { sort?: number }) =>
    request<DeliverySlot>('POST', '/slots', input),
  updateSlot: (slotId: string, patch: Partial<Omit<DeliverySlot, 'id'>>) =>
    request<DeliverySlot>('PATCH', `/slots/${id(slotId)}`, patch),
  rules: () => request<RulesVersion>('GET', '/config'),
  saveRules: (rules: Rules, confirmCode?: string) => request<RulesVersion>('PUT', '/config', { rules, ...confirmBody(confirmCode) }),
}

export interface ErrorInfo {
  message: string
  detail?: string
  /** What went wrong inside the server: only from a local run (SHOW_ERROR_DETAILS). */
  cause?: string
}

/** Turns any thrown value into display text, with the requestId for support. */
export function errorMessage(err: unknown): ErrorInfo {
  if (err instanceof ApiError) {
    // A local run (SHOW_ERROR_DETAILS) adds the cause of an unexpected error.
    const cause = typeof err.extra.detail === 'string' ? err.extra.detail : null
    const ref = err.requestId ? `Reference: ${err.requestId}` : null
    return {
      message: err.message,
      detail: [cause, ref].filter(Boolean).join(' · ') || undefined,
      ...(cause ? { cause } : {}),
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

/** Someone else moved the record first (a plain 409), as opposed to a 409 that explains a business rule. */
export function isStale(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && err.code === 'CONFLICT'
}
