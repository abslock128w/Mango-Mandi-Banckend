// DTO shapes and status enums mirroring mango-api /admin/v1.
// Money is always integer paise. Dates are "YYYY-MM-DD" (date-only columns)
// or ISO timestamps.

export type Role = 'OPERATOR' | 'MANAGER'

export interface Me {
  email: string
  role: Role
}

export type BatchStatus =
  | 'ARRIVING'
  | 'IN_TRANSIT'
  | 'ARRIVED'
  | 'RIPENING'
  | 'SELLING'
  | 'EXHAUSTED'
  | 'CONDEMNED'

/** Forward-only order of the batch lifecycle. CONDEMNED sits outside it. */
export const BATCH_FLOW: BatchStatus[] = [
  'ARRIVING',
  'IN_TRANSIT',
  'ARRIVED',
  'RIPENING',
  'SELLING',
  'EXHAUSTED',
]

export const ALL_BATCH_STATUSES: BatchStatus[] = [...BATCH_FLOW, 'CONDEMNED']

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

export const ALL_ORDER_STATUSES: OrderStatus[] = [
  'PAYMENT_PENDING',
  'CONFIRMED',
  'PROCESSING',
  'PACKED',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RTO',
  'CANCELLED',
]

export type PaymentStatus = 'INITIATED' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'CANCELLED'

export type Ripeness = 'RAW' | 'SEMI_RIPE' | 'RIPE'
export type Condition = 'GOOD' | 'FAIR' | 'REJECT'

export type ClaimStatus = 'SUBMITTED' | 'UNDER_REVIEW' | 'RESOLVED'
export type ClaimResolution = 'REFUND_APPROVED' | 'REPLACEMENT_APPROVED' | 'REJECTED'
export type IssueType = 'DAMAGED' | 'WRONG_ITEM' | 'NOT_DELIVERED'

export interface Product {
  sku: string
  name: string
  variety: string
  boxSize: string
}

export interface Summary {
  orders: Partial<Record<OrderStatus, number>>
  openClaims: number
  batchesNearLimit: { id: string; variety: string; ageDays: number; available: number }[]
  lowStock: { sku: string; productName: string; available: number }[]
  /** Open orders the stock engine could not keep whole. Ops must act on these. */
  atRiskOrders?: { id: string; number: string; deliveryDate: string; reason: string | null }[]
}

export interface BatchListItem {
  id: string
  variety: string
  pluckedOn: string
  ageDays: number
  farm: string | null
  status: BatchStatus
  latestRating: Ripeness | null
  latestCondition: Condition | null
  onHand: number
  held: number
  committed: number
  available: number
}

export interface BatchLine {
  id: string
  sku: string
  productName?: string
  onHand: number
  held: number
  committed: number
  reserveBuffer: number
  available: number
}

export interface QcEntry {
  id: string
  ripenessRating: Ripeness
  condition: Condition
  notes: string | null
  loggedBy: string
  loggedAt: string
}

export interface BatchDetail {
  id: string
  variety: string
  pluckedOn: string
  ageDays: number
  farm: string | null
  status: BatchStatus
  createdAt?: string
  lines: BatchLine[]
  qc: QcEntry[]
}

export interface LedgerEntry {
  id?: string
  eventType: 'INTAKE' | 'ADJUST' | 'HOLD' | 'COMMIT' | 'PACK' | 'RELEASE' | string
  sku: string | null
  delta: number
  actorType: string
  actorId: string
  reason: string | null
  createdAt: string
}

export interface OrderListItem {
  id: string
  number: string
  customerName: string | null
  phone: string | null
  itemCount: number
  total: number
  status: OrderStatus
  deliveryDate: string
  placedAt: string
  atRisk?: boolean
  /** Where the customer placed it: the app or the WhatsApp chat. */
  channel?: 'app' | 'whatsapp'
}

export interface Paged<T> {
  page: number
  pageSize: number
  total: number
  items: T[]
}

export interface OrderItem {
  id?: string
  productName: string
  sku: string
  quantity: number
  stage: string | null
  linePrice: number
}

export type StockState = 'held' | 'committed' | 'packed' | 'released'

export interface OrderStock {
  id?: string
  batchId: string
  sku?: string
  stage?: string
  variety: string
  pluckedOn: string
  quantity: number
  state: StockState
}

export interface OrderEvent {
  status: OrderStatus
  actor: string | null
  reason: string | null
  createdAt: string
}

export interface OrderDetail {
  id: string
  number: string
  status: OrderStatus
  customerName: string | null
  phone: string | null
  pincode: string | null
  deliveryAddress: string | null
  deliveryDate: string
  placedAt: string
  total: number
  items: OrderItem[]
  stock: OrderStock[]
  events: OrderEvent[]
  payment: {
    status: PaymentStatus | null
    method: string | null
    amount: number | null
    /** Set when the customer cancelled a paid order: the one case VMR refunds. */
    refund?: { requestedAt: string; refundedAt: string | null; id: string | null } | null
  } | null
  atRisk?: boolean
  atRiskReason?: string | null
  replacementFor?: { id: string; number: string } | null
  slot?: { id: string; label: string; startsAt: string; endsAt: string } | null
  channel?: 'app' | 'whatsapp'
  notifications?: OrderNotification[]
}

export type NotificationKind =
  | 'ORDER_CONFIRMED'
  | 'REPLACEMENT_CONFIRMED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'CANCELLED'
  | 'REFUNDED'

/** A WhatsApp update to the customer, sent from an outbox with retries. */
export interface OrderNotification {
  kind: NotificationKind
  channel: string
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED'
  attempts: number
  createdAt: string
  sentAt: string | null
  error: string | null
}

/** A delivery time window. maxBoxes caps boxes per day in this window (null = no cap). */
export interface DeliverySlot {
  id: string
  label: string
  startsAt: string
  endsAt: string
  maxBoxes: number | null
  active: boolean
  sort: number
}

export interface PackPick {
  batchId: string
  variety: string
  pluckedOn: string
  quantity: number
  packed: boolean
}

export interface PackListOrder {
  id: string
  number: string
  customerName: string | null
  pincode: string | null
  status: OrderStatus
  slot?: { id: string; label: string } | null
  items: { sku: string; productName: string; quantity: number; picks: PackPick[] }[]
}

export interface Claim {
  id: string
  orderId: string
  orderNumber: string
  orderTotal: number
  customerPhone: string | null
  issueType: IssueType | string
  description: string
  affectedItems: string[]
  photoUrl?: string | null
  status: ClaimStatus
  resolution?: ClaimResolution | null
  createdAt?: string
  replacementOrder?: { id: string; number: string } | null
}

export interface Pincode {
  pincode: string
  city: string
  zone: string | null
  active: boolean
}

export interface StageWindow {
  stage: Ripeness
  minAge: number
  maxAge: number
}

/** Versioned business rules (mango-api app_config). */
export interface Rules {
  maxSellableAge: number
  retireAge: number
  cutoffHourIST: number
  maxDaysAhead: number
  holdMinutes: number
  quoteMinutes: number
  forecastConfidence: number
  maxQcShift: number
  transitDays: number
  nearLimitAge: number
  lowStockThreshold: number
  claimWindowHours: number
  stageProfiles: Record<string, StageWindow[]>
}

export interface RulesVersion {
  version: number
  rules: Rules
}

export interface CalendarDay {
  date: string
  isOpen: boolean
  maxBoxes: number | null
  note: string | null
}

/** Sellable boxes per SKU and stage for one bookable delivery date. */
export interface CoverageDay {
  date: string
  /** Boxes booked per delivery slot; empty when slots aren't in use. */
  slots?: { id: string; label: string; booked: number; maxBoxes: number | null }[]
  stock: { sku: string; stage: Ripeness; qty: number }[]
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string; requestId?: string }
}

export type PreorderStatus = 'PAYMENT_PENDING' | 'BOOKED' | 'WAITLISTED' | 'CONVERTED' | 'CANCELLED'

/** A customer's booking for a delivery week, before the fruit exists. */
export interface Preorder {
  id: string
  number: string
  status: PreorderStatus
  sku: string
  productName: string
  stage: Ripeness
  qty: number
  unitPrice: number
  total: number
  weekStart: string
  pincode: string
  customerName: string | null
  phone: string
  channel: 'app' | 'whatsapp'
  paymentStatus: string | null
  movedCount: number
  createdAt: string
  refund: { requestedAt: string; refundedAt: string | null; id: string | null } | null
  order: { id: string; number: string; status: OrderStatus; deliveryDate: string } | null
}

export interface PreorderCapacity {
  sku: string
  productName: string
  weekStart: string
  capacity: number
  reserved: number
  waitlisted: number
}
