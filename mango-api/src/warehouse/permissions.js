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
  'warehouse.pack', 'warehouse.dispatch', 'warehouse.returns', 'warehouse.stocktake', 'warehouse.adjust', 'reports.export',
]

export const ROLE_PERMISSIONS = Object.freeze({
  MANAGER: PERMISSIONS,
  OPERATOR: SUPERVISOR,
  QC: ['warehouse.view', 'warehouse.receive', 'labels.print', 'warehouse.move', 'warehouse.qc'],
  PACKER: ['warehouse.view', 'warehouse.move', 'warehouse.pick', 'warehouse.pack', 'warehouse.dispatch', 'warehouse.returns'],
  RIDER: [],
})

export const can = (role, perm) => (ROLE_PERMISSIONS[role] ?? []).includes(perm)

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
]

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
})
