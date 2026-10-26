// Words for the warehouse's enums (design/COMPONENTS.md: never show a raw enum).

import type { Tone } from '../format'
import type {
  DamageReason,
  HoldKind,
  Lifecycle,
  LocationType,
  LotStatus,
  OpStatus,
  OpType,
  Quality,
  RepackKind,
  RepackReason,
  ScanResult,
  StocktakeLineKind,
  StocktakeLineStatus,
  StocktakeReviewStatus,
} from './types'

export const LOT_STATUS_LABEL: Record<LotStatus, string> = {
  generating: 'Making labels',
  receiving: 'Receiving',
  received: 'Received',
  closed: 'Closed',
  voided: 'Voided',
}
export const lotTone = (s: LotStatus): Tone => (s === 'voided' ? 'bad' : s === 'generating' || s === 'receiving' ? 'info' : s === 'received' ? 'good' : 'neutral')

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  generated: 'Label printed',
  in_stock: 'In stock',
  picked: 'Picked',
  packed: 'Packed',
  dispatched: 'Dispatched',
  returned: 'Returned',
  missing: 'Missing',
  voided: 'Voided',
  disposed: 'Written off',
  repacked: 'Repacked',
}

export const QUALITY_LABEL: Record<Quality, string> = {
  pending: 'QC pending',
  passed: 'QC passed',
  failed: 'QC failed',
  needs_review: 'Needs review',
}
export const qualityTone = (q: Quality): Tone => (q === 'passed' ? 'good' : q === 'failed' ? 'bad' : q === 'needs_review' ? 'warn' : 'neutral')

export const HOLD_LABEL: Record<HoldKind, string> = {
  qc_hold: 'QC hold',
  recall_hold: 'Recall hold',
  damage_hold: 'Damage hold',
  investigation_hold: 'Investigation',
  return_hold: 'Return hold',
}
/** Holds staff add by hand from the box page; the others come from QC, returns and recalls. */
export const MANUAL_HOLDS: HoldKind[] = ['damage_hold', 'investigation_hold', 'qc_hold']

export const LOCATION_TYPE_LABEL: Record<LocationType, string> = {
  receiving: 'Receiving',
  storage: 'Storage',
  cold_storage: 'Cold storage',
  ripening: 'Ripening',
  qc_hold: 'QC hold',
  pick_staging: 'Pick staging',
  packing: 'Packing',
  dispatch_bay: 'Dispatch bay',
  returns: 'Returns',
  disposal: 'Disposal',
}
export const LOCATION_TYPES = Object.keys(LOCATION_TYPE_LABEL) as LocationType[]

export const OP_LABEL: Record<OpType, string> = {
  receive: 'Receive',
  move: 'Move',
  qc: 'QC',
  pick: 'Pick',
  unpick: 'Take off order',
  pack: 'Pack',
  dispatch: 'Dispatch',
  return: 'Return',
  stocktake: 'Stocktake',
  repack: 'Repack',
}

export const SCAN_RESULT_LABEL: Record<ScanResult, string> = {
  accepted: 'Accepted',
  warning: 'Warning',
  rejected: 'Rejected',
  duplicate: 'Already scanned',
  undone: 'Undone',
}
export const scanTone = (r: ScanResult): Tone => (r === 'accepted' ? 'good' : r === 'warning' ? 'warn' : r === 'rejected' ? 'bad' : 'neutral')

export const QC_RESULT_LABEL = { passed: 'Passed', failed: 'Failed', needs_review: 'Needs review' } as const

export const WRITE_OFF_REASON_LABEL: Record<string, string> = {
  spoiled: 'Spoiled',
  damaged: 'Damaged',
  expired: 'Expired',
  recall: 'Recall',
  sample: 'Sample',
  other: 'Other',
}

/** Words for an event type such as LABEL_REISSUED. */
export const eventLabel = (type: string) => {
  const words = type.toLowerCase().split('_').map((w) => (w === 'qc' ? 'QC' : w))
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export const RECALL_LABEL: Record<'running' | 'done' | 'released', string> = { running: 'Holding boxes', done: 'All held', released: 'Released' }

/** What a count found for one box. */
export const STOCKTAKE_KIND_LABEL: Record<StocktakeLineKind, string> = {
  not_found: 'Not found',
  not_found_allocated: 'Not found (picked, packed or returned)',
  found_elsewhere: 'Found here, recorded elsewhere',
  found_missing: 'Found (was missing)',
  found_gone: 'Found, but recorded as gone',
  moved_after_snapshot: 'Moved during the count',
}
export const STOCKTAKE_LINE_LABEL: Record<StocktakeLineStatus, string> = {
  proposed: 'To review',
  pending_approval: 'Waiting for approval',
  missing: 'Marked missing',
  kept: 'Kept as recorded',
  rejected: 'Kept (not approved)',
  superseded: 'Changed since; left alone',
  applied: 'Corrected',
  ignored: 'Ignored',
}
export const STOCKTAKE_REVIEW_LABEL: Record<StocktakeReviewStatus, string> = {
  pending_approval: 'Waiting for a second person',
  applied: 'Applied',
  rejected: 'Not approved',
}

export const REPACK_REASON_LABEL: Record<RepackReason, string> = {
  spoiled_fruit: 'Spoiled fruit taken out',
  damaged_box: 'Damaged box',
  merge_partials: 'Merge part-full boxes',
  split: 'Split a box',
  other: 'Other',
}
export const REPACK_KIND_LABEL: Record<RepackKind, string> = { repack: 'Repack', split: 'Split', merge: 'Merge' }
export const DAMAGE_REASON_LABEL: Record<DamageReason, string> = { spoiled_fruit: 'Spoiled fruit', damaged_box: 'Damaged box', other: 'Other' }

export const OP_STATUS_LABEL: Record<OpStatus, string> = { open: 'In progress', completed: 'Done', cancelled: 'Cancelled', expired: 'Expired', failed: 'Failed' }
export const opStatusTone = (s: OpStatus): Tone => (s === 'open' ? 'info' : s === 'completed' ? 'good' : s === 'failed' ? 'bad' : 'neutral')
