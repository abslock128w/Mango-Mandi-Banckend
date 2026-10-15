// Which role may do what. The backend enforces the same split independently;
// the UI only renders manager-only buttons disabled for operators.
//
// PRD Q1: confirm this split against real duties before launch.

import type { Role } from './types'

export type Action = 'condemnBatch' | 'refundOrder' | 'resolveClaimRefund' | 'deletePincode'

const MANAGER_ONLY: ReadonlySet<Action> = new Set<Action>([
  'condemnBatch',
  'refundOrder',
  'resolveClaimRefund',
  'deletePincode',
])

export const MANAGER_ONLY_HINT = 'Requires manager role'

export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false
  return !MANAGER_ONLY.has(action) || role === 'MANAGER'
}
