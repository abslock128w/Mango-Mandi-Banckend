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
export type OpType = 'receive' | 'move' | 'qc' | 'pick' | 'unpick' | 'pack' | 'dispatch' | 'return' | 'stocktake' | 'repack'
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
  /** Every delivery batch in the box (more than one after a merge). */
  origins?: { lotId: string; lotCode: string; supplier: string | null; receivedOn: string; batchId: string | null; variety: string | null; pluckedOn: string | null; farm: string | null }[]
  /** Boxes this one was repacked into, at any depth. */
  descendants?: { id: string; code: string; lifecycle: Lifecycle; orderId: string | null; depth: number }[]
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
  /** Finished counts with boxes to review, or a big review waiting for a second person. */
  stocktakeReviews?: { operationId: string; locationName: string; finishedAt: string; toReview: number; toApprove: number }[]
  missingBoxes?: { boxId: string; code: string; skuName: string; since: string }[]
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

/** GET /warehouse/settings: what this warehouse has switched on, and the lists the forms offer. */
export interface WhSettings {
  enabled: boolean
  permissions: WhPermission[]
  operationTypes: OpType[]
  features: { stocktake: boolean; repack: boolean; cameraScan: boolean }
  repackReasons: RepackReason[]
  repackPlaces: LocationType[]
  damageReasons: DamageReason[]
  writeOffLimit: { boxes: number; grams: number }
}

// ---------------------------------------------------------------- stocktake

export type StocktakeLineKind = 'not_found' | 'not_found_allocated' | 'found_elsewhere' | 'found_missing' | 'found_gone' | 'moved_after_snapshot'
export type StocktakeLineStatus = 'proposed' | 'pending_approval' | 'missing' | 'kept' | 'rejected' | 'superseded' | 'applied' | 'ignored'
export type StocktakeReviewStatus = 'pending_approval' | 'applied' | 'rejected'

/** The summary stored on a finished count. */
export interface StocktakeResult {
  locationName: string
  snapshotAt: string
  counted: number
  matched: number
  foundElsewhere: number
  foundMissing: number
  foundGone: number
  notFound: number
  notFoundAllocated: number
  movedAfterSnapshot: number
  toReview: number
}

export interface StocktakeRow {
  id: string
  status: OpStatus
  locationId: string
  locationName: string
  snapshotAt: string
  owner: string | null
  mine: boolean
  startedAt: string
  finishedAt: string | null
  result: StocktakeResult | null
  reviewStatus: StocktakeReviewStatus | null
  toReview: number
  toApprove: number
}

export interface StocktakeLine {
  boxId: string
  code: string
  skuName: string
  kind: StocktakeLineKind
  status: StocktakeLineStatus
  recordedLifecycle: Lifecycle
  recordedLocation: string | null
  lifecycle: Lifecycle
  location: string | null
  holds: HoldKind[]
  orderNumber: string | null
  decidedAt: string | null
}

export interface Stocktake extends Omit<StocktakeRow, 'reviewStatus' | 'toReview' | 'toApprove'> {
  review: {
    id: string
    status: StocktakeReviewStatus
    missing: number
    grams: number
    kept: number
    note: string | null
    reviewedBy: string | null
    reviewedAt: string
    decidedBy: string | null
    decidedAt: string | null
    mine: boolean
  } | null
  lines: StocktakeLine[]
}

export interface StocktakeDecision {
  reviewId: string
  status: StocktakeReviewStatus
  missing: number
  kept?: number
  superseded?: number
  grams?: number
}

// ---------------------------------------------------------------- repack

export type RepackKind = 'repack' | 'split' | 'merge'
export type RepackReason = 'spoiled_fruit' | 'damaged_box' | 'merge_partials' | 'split' | 'other'
export type DamageReason = 'spoiled_fruit' | 'damaged_box' | 'other'

export interface RepackOutputInput {
  weightG: number
  fruitCount?: number
}

/** What a repack's finish sends: the new boxes and what was taken out. */
export interface RepackFinish {
  outputs: RepackOutputInput[]
  fruitRemoved: number
  weightLostG: number
  note?: string
}

/** The summary stored on a finished repack. */
export interface RepackResult {
  kind: RepackKind
  locationName: string
  sources: string[]
  outputs: { id: string; code: string; quality: Quality; weightG: number }[]
  fruitRemoved: number
  weightLostG: number
  needsQc: boolean
  carriedHolds: HoldKind[]
}

export interface RepackRow {
  id: string
  status: OpStatus
  kind: RepackKind | null
  locationName: string
  reasonCode: RepackReason
  reason: string
  owner: string | null
  mine: boolean
  startedAt: string
  finishedAt: string | null
  sources: number
  outputs: number
  fruitRemoved: number | null
  weightLostG: number | null
}

export interface RepackBox {
  id: string
  code: string
  lifecycle: Lifecycle
  quality: Quality
  bestBefore: string | null
  weightG: number | null
  locationName: string | null
  holds: HoldKind[]
}

export interface Repack {
  id: string
  status: OpStatus
  mine: boolean
  kind: RepackKind | null
  locationName: string
  reasonCode: RepackReason
  reason: string
  startedAt: string
  finishedAt: string | null
  fruitRemoved: number | null
  weightLostG: number | null
  sources: RepackBox[]
  outputs: RepackBox[]
  lots: { id: string; code: string; batchId: string | null }[]
}

export interface DamageResult {
  box: Box
  belowTolerance: boolean
  needsReview: boolean
}
