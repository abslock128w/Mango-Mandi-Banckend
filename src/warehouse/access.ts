// Who sees what in the warehouse: /auth/me carries `warehouse.enabled` and the
// permissions this role holds there (mango-api src/warehouse/permissions.js).
// The API checks the same permissions on every route; the panel only hides
// what a role can't use.

import { useSession } from '../session'
import type { Me } from '../types'
import type { OpType, WhPermission } from './types'

export const OP_PERMISSION: Record<OpType, WhPermission> = {
  receive: 'warehouse.receive',
  move: 'warehouse.move',
  qc: 'warehouse.qc',
  pick: 'warehouse.pick',
  unpick: 'warehouse.pick',
  pack: 'warehouse.pack',
  dispatch: 'warehouse.dispatch',
  return: 'warehouse.returns',
  stocktake: 'warehouse.stocktake',
  repack: 'warehouse.repack',
}

export function whCan(me: Me | null | undefined, perm: WhPermission): boolean {
  return !!me?.warehouse?.enabled && me.warehouse.permissions.includes(perm)
}

export function useWh() {
  const { me } = useSession()
  return { enabled: !!me?.warehouse?.enabled, can: (perm: WhPermission) => whCan(me, perm) }
}

/** The Warehouse nav group: [path, label, permission]. Left out entirely when the warehouse is off. */
export const WH_LINKS: [to: string, label: string, perm: WhPermission | 'scan'][] = [
  ['/warehouse', 'Overview', 'warehouse.view'],
  ['/warehouse/receive', 'Receive', 'warehouse.receive'],
  ['/warehouse/scan', 'Scan', 'scan'],
  ['/warehouse/picking', 'Picking', 'warehouse.pick'],
  ['/warehouse/stocktake', 'Stocktake', 'warehouse.stocktake'],
  ['/warehouse/repack', 'Repack', 'warehouse.repack'],
  ['/warehouse/lots', 'Box batches', 'warehouse.view'],
  ['/warehouse/boxes', 'Boxes', 'warehouse.view'],
  ['/warehouse/locations', 'Locations', 'warehouse.view'],
  ['/warehouse/exceptions', 'Exceptions', 'warehouse.view'],
  ['/warehouse/reports', 'Warehouse reports', 'warehouse.view'],
  ['/warehouse/products', 'Box settings', 'locations.manage'],
]

/** Scan sessions this role may start. */
export function opTypesFor(me: Me | null | undefined): OpType[] {
  return (Object.keys(OP_PERMISSION) as OpType[]).filter((t) => whCan(me, OP_PERMISSION[t]))
}

export function whLinkAllowed(me: Me | null | undefined, perm: WhPermission | 'scan'): boolean {
  return perm === 'scan' ? opTypesFor(me).length > 0 : whCan(me, perm)
}
