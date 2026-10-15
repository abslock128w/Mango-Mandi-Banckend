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
  payment: { status: PaymentStatus | null; method: string | null; amount: number | null } | null
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
}

export interface Pincode {
  pincode: string
  city: string
  zone: string | null
  active: boolean
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string; requestId?: string }
}
