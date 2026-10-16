// Which role may do what. There are no refunds: claims end in a replacement
// or a rejection.
// The backend enforces the same split independently;
// the UI only renders manager-only buttons disabled for operators.
//
// PRD Q1: confirm this split against real duties before launch.

import type { Role } from './types'

export type Action = 'condemnBatch' | 'deletePincode' | 'editRules' | 'moveDay'

const MANAGER_ONLY: ReadonlySet<Action> = new Set<Action>([
  'condemnBatch',
  'deletePincode',
  'editRules',
  'moveDay',
])

export const MANAGER_ONLY_HINT = 'Requires manager role'

export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false
  return !MANAGER_ONLY.has(action) || role === 'MANAGER'
}
