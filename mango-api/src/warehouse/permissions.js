// Warehouse permissions and the roles that hold them (docs/warehouse/DECISIONS.md S1).
//
// Each warehouse route names one permission (WAREHOUSE_ROUTES). access.js adds
// a route to a role's allowlist when the role holds that permission, so the
// role-policy snapshot test covers every warehouse route; routes whose
// permission only managers hold also carry requireManager. Handlers check the
// finer permissions (qc.override, adjust.approve, recall.view_customers) with can().

export const PERMISSIONS = [
  'warehouse.view', 'warehouse.receive', 'labels.print', 'labels.reissue', 'warehouse.move', 'warehouse.qc', 'qc.override',
  'warehouse.pick', 'warehouse.pack', 'warehouse.dispatch', 'warehouse.returns', 'warehouse.stocktake', 'warehouse.repack',
  'warehouse.adjust', 'adjust.approve', 'recall.manage', 'recall.view_customers', 'reports.export', 'locations.manage',
]

const SUPERVISOR = [
  'warehouse.view', 'warehouse.receive', 'labels.print', 'labels.reissue', 'warehouse.move', 'warehouse.qc', 'warehouse.pick',
  'warehouse.pack', 'warehouse.dispatch', 'warehouse.returns', 'warehouse.stocktake', 'warehouse.repack', 'warehouse.adjust', 'reports.export',
]

export const ROLE_PERMISSIONS = Object.freeze({
  MANAGER: PERMISSIONS,
  OPERATOR: SUPERVISOR,
  QC: ['warehouse.view', 'warehouse.receive', 'labels.print', 'warehouse.move', 'warehouse.qc'],
  PACKER: ['warehouse.view', 'warehouse.move', 'warehouse.pick', 'warehouse.pack', 'warehouse.dispatch', 'warehouse.returns'],
  RIDER: [],
})

export const can = (role, perm) => (ROLE_PERMISSIONS[role] ?? []).includes(perm)

/**
 * Permissions whose feature has its own flag (on top of WAREHOUSE_V2). While
 * the flag is off the feature's routes answer 404 and /auth/me leaves the
 * permission out, so the panel hides it.
 */
export const FEATURE_FLAG = Object.freeze({ 'warehouse.stocktake': 'WAREHOUSE_STOCKTAKE', 'warehouse.repack': 'WAREHOUSE_REPACK' })

/** True unless `perm` belongs to a feature switched off in `flags` (the env). */
export const featureOn = (perm, flags) => !FEATURE_FLAG[perm] || Boolean(flags[FEATURE_FLAG[perm]])

/** What a role may do here today: its bundle less the features switched off. */
export const effectivePermissions = (role, flags) => (ROLE_PERMISSIONS[role] ?? []).filter((p) => featureOn(p, flags))

/** Permissions no role but MANAGER holds: their routes carry requireManager. */
export const managerOnly = (perm) => Object.entries(ROLE_PERMISSIONS).every(([role, perms]) => role === 'MANAGER' || !perms.includes(perm))

/**
 * Every warehouse route (paths under the admin router) and the permission it needs.
 * Scans and finalize check the operation type's own permission as well (OP_PERMISSION).
 */
export const WAREHOUSE_ROUTES = [
  ['GET', '/warehouse/overview', 'warehouse.view'],
  ['GET', '/warehouse/settings', 'warehouse.view'],
  ['GET', '/warehouse/products', 'warehouse.view'],
  ['PATCH', '/warehouse/products/:sku', 'locations.manage'],
  ['GET', '/warehouse/lots', 'warehouse.view'],
  ['POST', '/warehouse/lots/preview', 'warehouse.receive'],
  ['POST', '/warehouse/lots', 'warehouse.receive'],
  ['GET', '/warehouse/lots/:id', 'warehouse.view'],
  ['POST', '/warehouse/lots/:id/continue', 'warehouse.receive'],
  ['GET', '/warehouse/lots/:id/labels.pdf', 'labels.print'],
  ['POST', '/warehouse/lots/:id/confirm-count', 'warehouse.receive'],
  ['POST', '/warehouse/lots/:id/add-boxes', 'warehouse.receive'],
  ['POST', '/warehouse/lots/:id/void-boxes', 'warehouse.receive'],
  ['PATCH', '/warehouse/lots/:id', 'warehouse.adjust'],
  ['POST', '/warehouse/lots/:id/close', 'warehouse.receive'],
  ['POST', '/warehouse/lots/:id/void', 'warehouse.adjust'],
  ['POST', '/warehouse/lots/:id/qc', 'warehouse.qc'],
  ['POST', '/warehouse/lots/:id/put-away', 'warehouse.move'],
  ['GET', '/warehouse/boxes', 'warehouse.view'],
  ['POST', '/warehouse/resolve', 'warehouse.view'],
  ['GET', '/warehouse/boxes/:id', 'warehouse.view'],
  ['GET', '/warehouse/boxes/:id/events', 'warehouse.view'],
  ['POST', '/warehouse/boxes/:id/reprint', 'labels.print'],
  ['POST', '/warehouse/boxes/:id/reissue', 'labels.reissue'],
  ['GET', '/warehouse/boxes/:id/label.pdf', 'labels.print'],
  ['POST', '/warehouse/boxes/:id/holds', 'warehouse.qc'],
  ['POST', '/warehouse/boxes/:id/holds/:kind/release', 'warehouse.qc'],
  ['POST', '/warehouse/boxes/:id/measure', 'warehouse.qc'],
  ['POST', '/warehouse/boxes/:id/restock', 'warehouse.returns'],
  ['POST', '/warehouse/boxes/:id/damage', 'warehouse.repack'],
  ['POST', '/warehouse/write-offs', 'warehouse.adjust'],
  ['GET', '/warehouse/write-offs', 'warehouse.view'],
  ['POST', '/warehouse/write-offs/:id/approve', 'adjust.approve'],
  ['POST', '/warehouse/write-offs/:id/reject', 'adjust.approve'],
  ['GET', '/warehouse/locations', 'warehouse.view'],
  ['POST', '/warehouse/locations', 'locations.manage'],
  ['PATCH', '/warehouse/locations/:id', 'locations.manage'],
  ['GET', '/warehouse/locations/:id/label.pdf', 'labels.print'],
  ['GET', '/warehouse/operations', 'warehouse.view'],
  ['POST', '/warehouse/operations', 'warehouse.view'],
  ['GET', '/warehouse/operations/:id', 'warehouse.view'],
  ['POST', '/warehouse/operations/:id/scans', 'warehouse.view'],
  ['POST', '/warehouse/operations/:id/undo', 'warehouse.view'],
  ['POST', '/warehouse/operations/:id/finalize', 'warehouse.view'],
  ['POST', '/warehouse/operations/:id/cancel', 'warehouse.view'],
  ['GET', '/warehouse/orders/:id/pick-list', 'warehouse.pick'],
  ['GET', '/warehouse/pick-queue', 'warehouse.pick'],
  ['GET', '/warehouse/exceptions', 'warehouse.view'],
  ['GET', '/warehouse/reconciliation', 'warehouse.view'],
  ['GET', '/warehouse/trace/boxes/:id', 'warehouse.view'],
  ['GET', '/warehouse/trace/lots/:id', 'warehouse.view'],
  ['GET', '/warehouse/recalls', 'warehouse.view'],
  ['POST', '/warehouse/recalls', 'recall.manage'],
  ['POST', '/warehouse/recalls/:id/continue', 'recall.manage'],
  ['POST', '/warehouse/recalls/:id/release', 'recall.manage'],
  ['GET', '/warehouse/recalls/:id', 'warehouse.view'],
  ['GET', '/warehouse/export/:report', 'reports.export'],
  ['GET', '/warehouse/stocktakes', 'warehouse.stocktake'],
  ['GET', '/warehouse/stocktakes/:id', 'warehouse.stocktake'],
  ['POST', '/warehouse/stocktakes/:id/review', 'warehouse.stocktake'],
  ['POST', '/warehouse/stocktakes/:id/approve', 'adjust.approve'],
  ['POST', '/warehouse/stocktakes/:id/reject', 'adjust.approve'],
  ['GET', '/warehouse/repacks', 'warehouse.repack'],
  ['GET', '/warehouse/repacks/:id', 'warehouse.repack'],
  ['GET', '/warehouse/repacks/:id/labels.pdf', 'labels.print'],
]

/** The feature permission a route belongs to (its flag gates it), by path prefix. */
export function routeFeature(path) {
  if (path === '/warehouse/stocktakes' || path.startsWith('/warehouse/stocktakes/')) return 'warehouse.stocktake'
  if (path === '/warehouse/repacks' || path.startsWith('/warehouse/repacks/') || /^\/warehouse\/boxes\/[^/]+\/damage$/.test(path)) return 'warehouse.repack'
  return null
}

/** The permission each operation type needs, for start, scans, undo and finalize. */
export const OP_PERMISSION = Object.freeze({
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
})
