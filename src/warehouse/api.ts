// Every warehouse call (mango-api /admin/v1/warehouse/*). Goes through the same
// signed-in request() as the rest of the panel; see src/api.ts.

import { apiBlobUrl, apiRequest } from '../api'
import type { ReviewBody } from './stocktakeReview'
import type {
  Box,
  BoxEvent,
  DamageReason,
  DamageResult,
  Repack,
  RepackFinish,
  RepackRow,
  Stocktake,
  StocktakeDecision,
  StocktakeRow,
  WhSettings,
  HoldKind,
  BoxTrace,
  IntakeInput,
  LotTrace,
  ProductPatch,
  WriteOffReason,
  WriteOffResult,
  IntakePreview,
  Lot,
  LotStatus,
  LocationType,
  Operation,
  OpType,
  PickList,
  PickQueueRow,
  Recall,
  Reconciliation,
  Resolved,
  Scan,
  WhExceptions,
  WhLocation,
  WhOverview,
  WhProduct,
  WriteOff,
} from './types'

const W = '/warehouse'
const id = encodeURIComponent

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export interface ScanInput {
  scanId: string
  input: string
  clientScannedAt?: string
  reason?: string
}

export const LABELS_PER_PDF = 1000

export const wh = {
  overview: () => apiRequest<WhOverview>('GET', `${W}/overview`),
  settings: () => apiRequest<WhSettings>('GET', `${W}/settings`),
  products: () => apiRequest<WhProduct[]>('GET', `${W}/products`),
  updateProduct: (sku: string, b: ProductPatch) => apiRequest<WhProduct>('PATCH', `${W}/products/${id(sku)}`, b),

  // Lots
  previewLot: (b: IntakeInput) => apiRequest<IntakePreview>('POST', `${W}/lots/preview`, b),
  /** The key is made once per form, so a retried submit can't make a second lot. */
  createLot: (b: IntakeInput, key: string) => apiRequest<Lot>('POST', `${W}/lots`, b, { 'Idempotency-Key': key }),
  lots: (status?: LotStatus | null) => apiRequest<Lot[]>('GET', `${W}/lots${qs({ status })}`),
  lot: (lotId: string) => apiRequest<Lot>('GET', `${W}/lots/${id(lotId)}`),
  continueLot: (lotId: string) => apiRequest<Lot>('POST', `${W}/lots/${id(lotId)}/continue`),
  confirmCount: (lotId: string, b: { count: number; reason: string; locationId?: string }) =>
    apiRequest<Lot>('POST', `${W}/lots/${id(lotId)}/confirm-count`, b),
  addBoxes: (lotId: string, b: { count: number; reason: string }) => apiRequest<Lot>('POST', `${W}/lots/${id(lotId)}/add-boxes`, b),
  voidBoxes: (lotId: string, b: { count: number; reason: string }) => apiRequest<Lot>('POST', `${W}/lots/${id(lotId)}/void-boxes`, b),
  voidLot: (lotId: string, reason: string) => apiRequest<Lot>('POST', `${W}/lots/${id(lotId)}/void`, { reason }),
  correctLot: (lotId: string, b: { supplier?: string; sku?: string; reason: string }) => apiRequest<Lot>('PATCH', `${W}/lots/${id(lotId)}`, b),
  closeLot: (lotId: string) => apiRequest<Lot>('POST', `${W}/lots/${id(lotId)}/close`),
  qcLot: (lotId: string, b: { exceptBoxIds?: string[]; note?: string }) =>
    apiRequest<{ passed: number; stillPending: number; more?: boolean }>('POST', `${W}/lots/${id(lotId)}/qc`, { result: 'passed', ...b }),
  putAway: (lotId: string, locationId: string) =>
    apiRequest<{ moved: number; skipped: { code: string; reason: string }[]; shortfall?: number; more?: boolean }>('POST', `${W}/lots/${id(lotId)}/put-away`, { locationId }),
  lotLabelsUrl: (lotId: string, from: number, to: number, layout: 'roll' | 'a4') =>
    apiBlobUrl(`${W}/lots/${id(lotId)}/labels.pdf${qs({ from, to, layout })}`),

  // Boxes
  resolve: (input: string) => apiRequest<Resolved>('POST', `${W}/resolve`, { input }),
  boxes: (p: { lotId?: string; locationId?: string; lifecycle?: string; held?: 'true' | 'false'; limit?: number; after?: string }) => apiRequest<{ boxes: Box[]; next: string | null }>('GET', `${W}/boxes${qs(p)}`),
  box: (boxId: string) => apiRequest<Box>('GET', `${W}/boxes/${id(boxId)}`),
  boxEvents: (boxId: string) => apiRequest<BoxEvent[]>('GET', `${W}/boxes/${id(boxId)}/events`),
  reprint: (boxId: string, reason: string) => apiRequest<Box>('POST', `${W}/boxes/${id(boxId)}/reprint`, { reason }),
  reissue: (boxId: string, reason: string) => apiRequest<Box>('POST', `${W}/boxes/${id(boxId)}/reissue`, { reason }),
  addHold: (boxId: string, kind: HoldKind, reason: string) => apiRequest<Box>('POST', `${W}/boxes/${id(boxId)}/holds`, { kind, reason }),
  releaseHold: (boxId: string, kind: HoldKind, reason: string) =>
    apiRequest<Box>('POST', `${W}/boxes/${id(boxId)}/holds/${id(kind)}/release`, { reason }),
  measure: (boxId: string, b: { weightG: number; fruitCount?: number }) =>
    apiRequest<{ box: Box; outOfTolerance: boolean; shortfall?: unknown }>('POST', `${W}/boxes/${id(boxId)}/measure`, b),
  restock: (boxId: string, reason: string) => apiRequest<Box>('POST', `${W}/boxes/${id(boxId)}/restock`, { reason }),
  requestWriteOff: (b: { boxIds: string[]; reasonCode: WriteOffReason; reason: string }) => apiRequest<WriteOffResult>('POST', `${W}/write-offs`, b),
  /** Fruit taken out of a box without repacking it. */
  damage: (boxId: string, b: { fruitRemoved?: number; weightLostG?: number; reasonCode: DamageReason; reason: string }) =>
    apiRequest<DamageResult>('POST', `${W}/boxes/${id(boxId)}/damage`, b),
  boxLabelUrl: (boxId: string) => apiBlobUrl(`${W}/boxes/${id(boxId)}/label.pdf`),

  // Locations
  locations: () => apiRequest<WhLocation[]>('GET', `${W}/locations`),
  addLocation: (b: { zone?: string; name: string; type: LocationType }) => apiRequest<WhLocation>('POST', `${W}/locations`, b),
  updateLocation: (locId: string, b: { zone?: string; name?: string; type?: LocationType; active?: boolean }) =>
    apiRequest<WhLocation>('PATCH', `${W}/locations/${id(locId)}`, b),
  locationLabelUrl: (locId: string) => apiBlobUrl(`${W}/locations/${id(locId)}/label.pdf`),

  // Scan sessions
  operations: () => apiRequest<Operation[]>('GET', `${W}/operations${qs({ status: 'open' })}`),
  startOperation: (type: OpType, context: Record<string, unknown>) => apiRequest<Operation>('POST', `${W}/operations`, { type, context }),
  operation: (opId: string) => apiRequest<Operation>('GET', `${W}/operations/${id(opId)}`),
  scans: (opId: string, scans: ScanInput[]) => apiRequest<{ results: Scan[] }>('POST', `${W}/operations/${id(opId)}/scans`, { scans }),
  undo: (opId: string) => apiRequest<{ undone: Scan }>('POST', `${W}/operations/${id(opId)}/undo`),
  /** Pack, dispatch and stocktake send no body; a repack says what came out. */
  finalize: (opId: string, body?: RepackFinish) => apiRequest<Operation>('POST', `${W}/operations/${id(opId)}/finalize`, body),
  cancel: (opId: string) => apiRequest<Operation>('POST', `${W}/operations/${id(opId)}/cancel`),

  // Stocktake
  stocktakes: () => apiRequest<StocktakeRow[]>('GET', `${W}/stocktakes`),
  stocktake: (opId: string) => apiRequest<Stocktake>('GET', `${W}/stocktakes/${id(opId)}`),
  reviewStocktake: (opId: string, b: ReviewBody) =>
    apiRequest<StocktakeDecision>('POST', `${W}/stocktakes/${id(opId)}/review`, b),
  approveStocktake: (opId: string) => apiRequest<StocktakeDecision>('POST', `${W}/stocktakes/${id(opId)}/approve`),
  rejectStocktake: (opId: string) => apiRequest<StocktakeDecision>('POST', `${W}/stocktakes/${id(opId)}/reject`),

  // Repack
  repacks: () => apiRequest<RepackRow[]>('GET', `${W}/repacks`),
  repack: (opId: string) => apiRequest<Repack>('GET', `${W}/repacks/${id(opId)}`),
  repackLabelsUrl: (opId: string, layout: 'roll' | 'a4' = 'roll') => apiBlobUrl(`${W}/repacks/${id(opId)}/labels.pdf${qs({ layout })}`),

  // Picking
  pickQueue: () => apiRequest<PickQueueRow[]>('GET', `${W}/pick-queue`),
  pickList: (orderId: string) => apiRequest<PickList>('GET', `${W}/orders/${id(orderId)}/pick-list`),

  // Reports
  exceptions: () => apiRequest<WhExceptions>('GET', `${W}/exceptions`),
  reconciliation: () => apiRequest<Reconciliation>('GET', `${W}/reconciliation`),
  exportUrl: (report: 'boxes' | 'events' | 'lots' | 'reconciliation', p: { from?: string; to?: string } = {}) =>
    apiBlobUrl(`${W}/export/${report}${qs(p)}`),
  traceBox: (boxId: string) => apiRequest<BoxTrace>('GET', `${W}/trace/boxes/${id(boxId)}`),
  traceLot: (lotId: string) => apiRequest<LotTrace>('GET', `${W}/trace/lots/${id(lotId)}`),
  recall: (recallId: string) => apiRequest<Recall>('GET', `${W}/recalls/${id(recallId)}`),
  recalls: () => apiRequest<Recall[]>('GET', `${W}/recalls`),
  startRecall: (lotIds: string[], reason: string) => apiRequest<Recall>('POST', `${W}/recalls`, { lotIds, reason }),
  continueRecall: (recallId: string) => apiRequest<Recall>('POST', `${W}/recalls/${id(recallId)}/continue`),
  releaseRecall: (recallId: string, reason: string) => apiRequest<Recall>('POST', `${W}/recalls/${id(recallId)}/release`, { reason }),
  writeOffs: (status?: 'pending' | 'applied' | 'rejected') => apiRequest<WriteOff[]>('GET', `${W}/write-offs${qs({ status })}`),
  approveWriteOff: (woId: string) => apiRequest<WriteOff>('POST', `${W}/write-offs/${id(woId)}/approve`),
  rejectWriteOff: (woId: string) => apiRequest<WriteOff>('POST', `${W}/write-offs/${id(woId)}/reject`),
}
