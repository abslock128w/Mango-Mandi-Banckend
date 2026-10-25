// Warehouse DTOs, mirroring mango-api /admin/v1/warehouse (docs/warehouse/API.md).
// Box codes arrive printed (XXXX-XXXX-C); dates are "YYYY-MM-DD", times ISO.

export type WhPermission =
  | 'warehouse.view'
  | 'warehouse.receive'
  | 'labels.print'
  | 'labels.reissue'
  | 'warehouse.move'
  | 'warehouse.qc'
  | 'qc.override'
  | 'warehouse.pick'
  | 'warehouse.pack'
  | 'warehouse.dispatch'
  | 'warehouse.returns'
  | 'warehouse.stocktake'
  | 'warehouse.repack'
  | 'warehouse.adjust'
  | 'adjust.approve'
  | 'recall.manage'
  | 'recall.view_customers'
  | 'reports.export'
  | 'locations.manage'

export type LotStatus = 'generating' | 'receiving' | 'received' | 'closed' | 'voided'
export type Lifecycle =
  | 'generated'
  | 'in_stock'
  | 'picked'
  | 'packed'
  | 'dispatched'
  | 'returned'
  | 'missing'
  | 'voided'
  | 'disposed'
  | 'repacked'
export type Quality = 'pending' | 'passed' | 'failed' | 'needs_review'
export type HoldKind = 'qc_hold' | 'recall_hold' | 'damage_hold' | 'investigation_hold' | 'return_hold'
export type LocationType =
  | 'receiving'
  | 'storage'
  | 'cold_storage'
  | 'ripening'
  | 'qc_hold'
  | 'pick_staging'
  | 'packing'
  | 'dispatch_bay'
  | 'returns'
  | 'disposal'
export type OpType = 'receive' | 'move' | 'qc' | 'pick' | 'unpick' | 'pack' | 'dispatch' | 'return'
export type OpStatus = 'open' | 'completed' | 'cancelled' | 'expired' | 'failed'
export type ScanResult = 'accepted' | 'warning' | 'rejected' | 'duplicate' | 'undone'

export interface WhOverview {
  today: string
  boxes: {
    awaitingReceipt: number
    inStock: number
    sellable: number
    awaitingQc: number
    failedOrReview: number
    picked: number
    packed: number
    returned: number
    expiringIn2Days: number
  }
  lots: Partial<Record<LotStatus, number>>
  openSessions: Partial<Record<OpType, number>>
  ordersToPick: number
}

export interface WhProduct {
  sku: string
  name: string
  variety?: string
  active: boolean
  boxTrackingEnabled: boolean
  nominalWeightG: number | null
  weightTolerancePct: number
  requiresQc: boolean
  restockableReturns: boolean
  shelfLifeDays: number | null
  qcChecklist: string[] | null
}

export type ProductPatch = Partial<Pick<WhProduct, 'boxTrackingEnabled' | 'nominalWeightG' | 'weightTolerancePct' | 'requiresQc' | 'restockableReturns' | 'shelfLifeDays'>> & {
  qcChecklist?: string[]
}

/** RECONCILIATION_NEEDED: stock lines whose count does not match their labelled boxes. */
export interface MismatchedLine {
  lineId: string
  batchId: string
  onHand: number
  sellableBoxes: number
}

export interface TraceOrder {
  id: string
  number: string
  status: string
  deliveryDate: string | null
  customerName?: string | null
  phone?: string | null
}

export interface BoxTrace {
  box: Box
  lot: { id: string; code: string; supplier: string | null; harvestedOn: string; receivedOn: string; bestBefore: string; isLegacy: boolean } | null
  batch: { id: string; variety: string; pluckedOn: string; farm: string | null; status: string } | null
  parents: { id: string; code: string; lotId: string; depth: number }[]
  orders: TraceOrder[]
  events: {
    type: string
    at: string
    actor: string | null
    fromLifecycle: string | null
    toLifecycle: string | null
    fromLocation: string | null
    toLocation: string | null
    quality: string | null
    holdAdded: string | null
    holdReleased: string | null
    orderId: string | null
    reasonCode: string | null
    reason: string | null
  }[]
}

export interface LotTrace {
  lot: { id: string; code: string; sku: string; supplier: string | null; harvestedOn: string; receivedOn: string; bestBefore: string; status: LotStatus }
  byState: Partial<Record<Lifecycle, number>>
  boxes: { id: string; code: string; lifecycle: Lifecycle; quality: Quality; holds: HoldKind[]; location: string | null; orderId: string | null; descendant: boolean }[]
  orders: TraceOrder[]
}

export type WriteOffReason = 'spoiled' | 'damaged' | 'expired' | 'recall' | 'sample' | 'other'
export interface WriteOffResult {
  id: string
  status: 'pending' | 'applied'
  boxes: number
  grams: number
  shortfall?: unknown
}

export interface IntakeInput {
  sku: string
  expectedCount: number
  nominalWeightG?: number
  harvestedOn: string
  receivedOn?: string
  supplier?: string
  qcNotes?: string
}

export interface IntakePreview {
  sku: string
  productName: string
  boxes: number
  nominalWeightG: number
  totalKg: number
  harvestedOn: string
  receivedOn: string
  bestBefore: string
  requiresQc: boolean
  chunked: boolean
  labelMm: { w: number; h: number }
}

export interface Lot {
  id: string
  code: string
  sku: string
  productName: string
  batchId: string | null
  lineId: string | null
  supplier: string | null
  expectedCount: number
  targetCount: number
  generatedCount: number
  verifiedCount: number
  voidedCount: number
  nominalWeightG: number
  harvestedOn: string
  receivedOn: string
  bestBefore: string
  qcNotes: string | null
  status: LotStatus
  isLegacy: boolean
  createdAt: string
  closedAt: string | null
  replayed?: boolean
  /** On GET /lots/:id: how many boxes are in each lifecycle and QC state. */
  states?: { lifecycle: Lifecycle; quality: Quality; n: number; sellable: number }[]
  sellable?: number
}

export interface Box {
  id: string
  code: string
  lotId: string
  batchId: string | null
  sku: string
  skuName: string
  seq: number
  locationId: string | null
  locationName: string | null
  locationType: LocationType | null
  lifecycle: Lifecycle
  quality: Quality
  holds: HoldKind[]
  nominalWeightG: number | null
  measuredWeightG: number | null
  bestBefore: string | null
  orderId: string | null
  reprintCount: number
  lotCode?: string
  orderNumber?: string | null
  orderStatus?: string | null
  sellable?: boolean
}

export interface BoxEvent {
  id: string
  type: string
  at: string
  actor: string | null
  fromLifecycle: string | null
  toLifecycle: string | null
  fromLocation: string | null
  toLocation: string | null
  fromQuality: string | null
  toQuality: string | null
  holdAdded: string | null
  holdReleased: string | null
  reasonCode: string | null
  reason: string | null
}

export interface WhLocation {
  id: string
  zone: string | null
  name: string
  type: LocationType
  active: boolean
  pickable: boolean
  boxes?: number
}

export type Resolved =
  | { kind: 'box'; box: Box; labelRevoked?: boolean }
  | { kind: 'location'; location: WhLocation }
  | { kind: 'error'; code: string; message?: string }

export interface Scan {
  scanId: string
  seq?: number
  result: ScanResult
  code: string
  message: string
  detail?: Record<string, unknown> | null
  boxId?: string | null
  receivedAt?: string
  replayed?: boolean
  /** false: nothing was stored (CONFLICT_RETRY_EXHAUSTED); send the same scanId again. */
  stored?: boolean
}

export interface Operation {
  id: string
  type: OpType
  class: 'applied' | 'staged'
  status: OpStatus
  context: Record<string, unknown>
  locationId: string | null
  orderId: string | null
  lotId: string | null
  startedAt: string
  lastActivityAt: string
  finishedAt: string | null
  accepted: number
  rejected: number
  duplicates: number
  result: Record<string, unknown> | null
  resumed?: boolean
  scans?: Scan[]
  progress?: { staged: number; needed: number }
}

export interface PickQueueRow {
  orderId: string
  number: string
  status: string
  deliveryDate: string | null
  atRisk: boolean
  toPick: number
  picked: number
}

export interface PickList {
  orderId: string
  number: string
  status: string
  deliveryDate: string | null
  atRisk: boolean
  items: {
    itemId: string
    sku: string
    stage?: string
    quantity: number
    toPick: number
    picked: { id: string; code: string; lifecycle: Lifecycle }[]
    suggestions: { lot: string; quantity: number; boxes: { id: string; code: string; location: string | null; bestBefore: string | null }[] }[]
  }[]
}

export interface WhExceptions {
  shortfallOrders: { orderId: string; number: string; status: string; deliveryDate: string | null; reason: string | null }[]
  heldBoxesOnOrders: { boxId: string; code: string; orderId: string; number: string; holds: string[] }[]
  unreceivedLots: { lotId: string; code: string; createdAt: string; waiting: number }[]
  staleSessions: { operationId: string; type: OpType; owner: string | null; lastActivityAt: string }[]
  expiringSoon: { lotId: string; code: string; boxes: number; bestBefore: string }[]
  failedMessages: { id: string; kind: string; number: string | null; error: string | null }[]
  pendingWriteOffs: { id: string; boxes: number; reason: string; requestedAt: string }[]
  boxesToPutAway: { boxId: string; code: string; skuName: string; since: string }[]
  investigations: { boxId: string; code: string; reason: string | null; since: string }[]
}

export interface Reconciliation {
  clean: boolean
  trackedLines: number
  stockMismatches: { lineId: string; batchId: string; sku: string; onHand: number; sellableBoxes: number }[]
  orderUnitMismatches: unknown[]
  impossibleStates: unknown[]
  lotCountMismatches: unknown[]
  ledgerDrift: unknown[]
}

export interface Recall {
  id: string
  lotIds: string[]
  reason: string
  status: 'running' | 'done' | 'released'
  held: number
  createdAt: string
  finishedAt?: string | null
  releasedAt?: string | null
  byState?: Record<string, number>
  releaseReason?: string | null
  dispatchedOrders?: TraceOrder[]
}

export interface WriteOff {
  id: string
  boxes: number
  boxIds: string[]
  reasonCode: string
  reason: string
  status: 'pending' | 'applied' | 'rejected'
  requestedBy: string | null
  requestedAt: string
  decidedBy: string | null
  decidedAt: string | null
  mine: boolean
}
