// An in-memory warehouse for the panel's specs: registered after mockApi(), so
// it answers /auth/me (with the warehouse switched on) and every
// /admin/v1/warehouse/* call. Shapes follow mango-api src/admin/warehouse.js.
//
// Scans follow a small script by what is typed:
//   BAD…            rejected UNKNOWN_CODE
//   OTHER…          in a pick session: NON_FEFO, rejected until a reason comes
//   LOC-B           in a move session: the Shelf B location label (WRONG_LABEL_TYPE)
//   anything else   accepted (staged in pack/dispatch); the same input again is a duplicate
// A scanId seen before gets its stored answer back with replayed: true.

import type { Page, Route } from '@playwright/test'
import type { MockState, Role } from './mock-api'

const PERMS: Record<Role, string[]> = {
  MANAGER: [
    'warehouse.view', 'warehouse.receive', 'labels.print', 'labels.reissue', 'warehouse.move', 'warehouse.qc', 'qc.override',
    'warehouse.pick', 'warehouse.pack', 'warehouse.dispatch', 'warehouse.returns', 'warehouse.stocktake', 'warehouse.repack',
    'warehouse.adjust', 'adjust.approve', 'recall.manage', 'recall.view_customers', 'reports.export', 'locations.manage',
  ],
  OPERATOR: [
    'warehouse.view', 'warehouse.receive', 'labels.print', 'labels.reissue', 'warehouse.move', 'warehouse.qc', 'warehouse.pick',
    'warehouse.pack', 'warehouse.dispatch', 'warehouse.returns', 'warehouse.stocktake', 'warehouse.adjust', 'reports.export',
  ],
  QC: ['warehouse.view', 'warehouse.receive', 'labels.print', 'warehouse.move', 'warehouse.qc'],
  PACKER: ['warehouse.view', 'warehouse.move', 'warehouse.pick', 'warehouse.pack', 'warehouse.dispatch', 'warehouse.returns'],
  RIDER: [],
}

type Json = Record<string, unknown>

export interface WhScan {
  scanId: string
  seq: number
  result: string
  code: string
  message: string
  detail: Json | null
  boxId: string | null
  receivedAt: string
  input: string
  reason?: string
}

export interface WhOp {
  id: string
  type: string
  class: 'applied' | 'staged'
  status: string
  context: Json
  locationId: string | null
  orderId: string | null
  lotId: string | null
  ownerId: string
  startedAt: string
  lastActivityAt: string
  finishedAt: string | null
  accepted: number
  rejected: number
  duplicates: number
  result: Json | null
  scans: WhScan[]
  /** Pack and dispatch: the boxes the order needs. */
  needed?: string[]
}

const NOW = '2026-10-25T05:30:00.000Z'
const TODAY = '2026-10-25'

function lotView(l: Json) {
  return { ...l }
}

export function whSeed() {
  return {
    products: [
      { sku: 'ALP-3KG', name: 'Alphonso 3kg Box', variety: 'Alphonso', active: true, boxTrackingEnabled: true, nominalWeightG: 3000, weightTolerancePct: 5, requiresQc: true, restockableReturns: true, shelfLifeDays: 7, qcChecklist: null },
      { sku: 'KES-1KG', name: 'Kesar 1kg', variety: 'Kesar', active: true, boxTrackingEnabled: false, nominalWeightG: null, weightTolerancePct: 5, requiresQc: true, restockableReturns: true, shelfLifeDays: 7, qcChecklist: null },
    ],
    lots: [
      {
        id: 'lot_seed', code: 'L2610-ALP3-7K', sku: 'ALP-3KG', productName: 'Alphonso 3kg Box', batchId: 'bat_1', lineId: 'bl_1', supplier: 'Ratnagiri Farms',
        expectedCount: 4, targetCount: 4, generatedCount: 4, verifiedCount: 1, voidedCount: 0, nominalWeightG: 3000, harvestedOn: '2026-10-22',
        receivedOn: '2026-10-24', bestBefore: '2026-10-29', qcNotes: null, status: 'receiving', isLegacy: false, createdBy: 'adm_1', createdAt: NOW, closedAt: null,
      },
    ] as Json[],
    locations: [
      { id: 'loc_r', warehouseId: 'wh_1', zone: null, name: 'Receiving', type: 'receiving', active: true, pickable: false, createdAt: NOW, boxes: 1 },
      { id: 'loc_a', warehouseId: 'wh_1', zone: 'A', name: 'Shelf A', type: 'storage', active: true, pickable: true, createdAt: NOW, boxes: 0 },
      { id: 'loc_b', warehouseId: 'wh_1', zone: 'B', name: 'Shelf B', type: 'storage', active: true, pickable: true, createdAt: NOW, boxes: 0 },
      { id: 'loc_p', warehouseId: 'wh_1', zone: null, name: 'Packing bench', type: 'packing', active: true, pickable: false, createdAt: NOW, boxes: 0 },
    ] as Json[],
    ops: [] as WhOp[],
    pickQueue: [{ orderId: 'ord_1', number: 'ORD-1042', status: 'CONFIRMED', deliveryDate: '2026-10-26', atRisk: false, toPick: 2, picked: 0 }],
    /** Box codes order ord_1 needs at pack time. */
    packNeeds: ['7K2M-QX4P-3', '7K2M-QX4R-8', '7K2M-QX4T-1'],
    writeOffs: [
      { id: 'wo_1', boxes: 2, boxIds: ['b1', 'b2'], reasonCode: 'damaged', reason: 'Crushed in the van', status: 'pending', requestedBy: 'operator@mandimangoes.test', requestedAt: NOW, decidedBy: null, decidedAt: null, mine: false },
    ],
    recalls: [
      { id: 'rc_1', lotIds: ['lot_seed'], reason: 'Supplier reported pesticide residue', status: 'running', held: 3, createdAt: NOW, finishedAt: null, releasedAt: null, releaseReason: null },
    ] as Json[],
    /** Answer the next n scan requests with a 500 (the queue must retry with the same scanIds). */
    failScans: 0,
    /** Turning labels on is refused with RECONCILIATION_NEEDED. */
    trackingMismatch: false,
    writeOffRequests: [] as Json[],
    /** Put-away moves no more than this many boxes, then keeps answering more: true with moved 0. */
    putAwayStuckAfter: null as number | null,
    /** Every scans request body, in order. */
    scanRequests: [] as { scanId: string; input: string; reason?: string }[][],
    lotKeys: [] as (string | undefined)[],
    nextLot: 1,
    nextOp: 1,
  }
}

export type WhState = ReturnType<typeof whSeed>

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}
const fail = (route: Route, status: number, code: string, message: string, extra: Json = {}) =>
  json(route, status, { error: { code, message, requestId: 'req_wh', ...extra } })

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')

function opView(op: WhOp, withScans = false) {
  const { scans, needed, ...rest } = op
  const out: Json = { ...rest }
  if (withScans) out.scans = [...scans].reverse().map(({ input, reason, ...s }) => s)
  if (op.class === 'staged' && op.status === 'open') out.progress = { staged: scans.filter((s) => s.result === 'accepted').length, needed: needed?.length ?? 0 }
  return out
}

/**
 * Switches the warehouse on for this page. `role` must match the one given to mockApi.
 * Pass enabled: false to answer /auth/me with the flag off explicitly.
 */
export async function mockWarehouse(page: Page, api: MockState, opts: { role?: Role; enabled?: boolean } = {}): Promise<WhState> {
  const role = opts.role ?? api.role
  const enabled = opts.enabled ?? true
  const s = whSeed()

  await page.route('**/admin/v1/auth/me', (route) =>
    json(route, 200, {
      email: `${role.toLowerCase()}@mandimangoes.test`,
      role,
      twoStep: api.twoStep,
      warehouse: enabled ? { enabled: true, permissions: PERMS[role] } : { enabled: false, permissions: [] },
    }),
  )

  await page.route('**/admin/v1/warehouse/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace(/^.*\/admin\/v1\/warehouse/, '')
    const method = req.method()
    let body: Json = {}
    try {
      body = (req.postDataJSON() as Json) ?? {}
    } catch {
      body = {}
    }
    api.calls.push({ method, path: `/warehouse${path}`, body })
    if (!enabled) return fail(route, 404, 'NOT_FOUND', 'Not found')
    const seg = path.split('/').filter(Boolean)

    if (method === 'GET' && path === '/overview') {
      return json(route, 200, {
        today: TODAY,
        boxes: { awaitingReceipt: 3, inStock: 41, sellable: 37, awaitingQc: 4, failedOrReview: 1, picked: 2, packed: 0, returned: 0, expiringIn2Days: 6 },
        lots: { receiving: 1, received: 2, closed: 5 },
        openSessions: Object.fromEntries(Object.entries(s.ops.filter((o) => o.status === 'open').reduce<Record<string, number>>((m, o) => ({ ...m, [o.type]: (m[o.type] ?? 0) + 1 }), {}))),
        ordersToPick: s.pickQueue.length,
      })
    }
    if (method === 'GET' && path === '/products') return json(route, 200, s.products)
    if (method === 'PATCH' && seg[0] === 'products') {
      const p = s.products.find((x) => x.sku === seg[1])
      if (!p) return fail(route, 404, 'NOT_FOUND', 'Product not found')
      if (body.boxTrackingEnabled === true && !p.boxTrackingEnabled && s.trackingMismatch) {
        return fail(route, 409, 'RECONCILIATION_NEEDED', '1 batch does not match its labelled boxes. Label the stock (legacy intake), QC and put it away first.', {
          lines: [{ lineId: 'bl_9', batchId: 'bat_9', onHand: 12, sellableBoxes: 0 }],
        })
      }
      Object.assign(p, body)
      return json(route, 200, p)
    }

    // ---- lots
    if (seg[0] === 'lots') {
      if (method === 'POST' && path === '/lots/preview') {
        const n = Number(body.expectedCount)
        const g = Number(body.nominalWeightG ?? 3000)
        return json(route, 200, {
          sku: body.sku, productName: 'Alphonso 3kg Box', boxes: n, nominalWeightG: g, totalKg: (n * g) / 1000, harvestedOn: body.harvestedOn,
          receivedOn: body.receivedOn ?? TODAY, bestBefore: '2026-10-30', requiresQc: true, chunked: n > 2000, labelMm: { w: 50, h: 25 },
        })
      }
      if (method === 'POST' && path === '/lots') {
        const key = req.headers()['idempotency-key']
        s.lotKeys.push(key)
        const n = Number(body.expectedCount)
        const lot: Json = {
          id: `lot_${s.nextLot}`, code: `L2610-ALP3-${s.nextLot}X`, sku: body.sku, productName: 'Alphonso 3kg Box', batchId: 'bat_2', lineId: 'bl_2',
          supplier: body.supplier ?? null, expectedCount: n, targetCount: n, generatedCount: Math.min(n, 2000), verifiedCount: 0, voidedCount: 0,
          nominalWeightG: body.nominalWeightG ?? 3000, harvestedOn: body.harvestedOn, receivedOn: body.receivedOn ?? TODAY, bestBefore: '2026-10-30',
          qcNotes: null, status: n > 2000 ? 'generating' : 'receiving', isLegacy: false, createdBy: 'adm_1', createdAt: NOW, closedAt: null,
        }
        s.nextLot++
        s.lots.unshift(lot)
        return json(route, 201, lotView(lot))
      }
      if (method === 'GET' && seg.length === 1) {
        const status = url.searchParams.get('status')
        return json(route, 200, s.lots.filter((l) => !status || l.status === status))
      }
      const lot = s.lots.find((l) => l.id === seg[1])
      if (!lot) return fail(route, 404, 'NOT_FOUND', 'Lot not found')
      if (method === 'GET' && seg.length === 2) {
        const v = lot.verifiedCount as number
        const g = lot.generatedCount as number
        return json(route, 200, {
          ...lot,
          states: [
            ...(v ? [{ lifecycle: 'in_stock', quality: 'pending', n: v, sellable: 0 }] : []),
            ...(g - v ? [{ lifecycle: 'generated', quality: 'pending', n: g - v, sellable: 0 }] : []),
          ],
          sellable: 0,
        })
      }
      if (method === 'POST' && seg[2] === 'continue') {
        lot.generatedCount = Math.min(lot.targetCount as number, (lot.generatedCount as number) + 1000)
        if (lot.generatedCount === lot.targetCount) lot.status = 'receiving'
        return json(route, 200, lotView(lot))
      }
      if (method === 'GET' && seg[2] === 'labels.pdf') return route.fulfill({ status: 200, contentType: 'application/pdf', body: PDF })
      if (method === 'POST' && seg[2] === 'close') {
        if ((lot.verifiedCount as number) + (lot.voidedCount as number) < (lot.targetCount as number)) {
          return fail(route, 409, 'INCOMPLETE_SET', 'Some boxes are not received yet. Receive or void them first.')
        }
        lot.status = 'closed'
        return json(route, 200, lotView(lot))
      }
      if (method === 'POST' && seg[2] === 'void') {
        lot.status = 'voided'
        return json(route, 200, lotView(lot))
      }
      if (method === 'PATCH' && seg.length === 2) {
        if (body.supplier !== undefined) lot.supplier = body.supplier
        return json(route, 200, { ...lotView(lot), changes: ['supplier'] })
      }
      if (method === 'POST' && seg[2] === 'confirm-count') {
        lot.verifiedCount = Math.min(lot.targetCount as number, (lot.verifiedCount as number) + Number(body.count))
        return json(route, 200, lotView(lot))
      }
      // At most 400 boxes a call, with more: true while some are left (as the API does).
      if (method === 'POST' && seg[2] === 'qc') {
        const left = (lot.verifiedCount as number) - ((lot.qcDone as number) ?? 0)
        const passed = Math.min(400, left)
        lot.qcDone = ((lot.qcDone as number) ?? 0) + passed
        return json(route, 200, { passed, stillPending: 0, more: left - passed > 0 })
      }
      if (method === 'POST' && seg[2] === 'put-away') {
        const cap = Math.min(lot.verifiedCount as number, s.putAwayStuckAfter ?? Infinity)
        const done = (lot.putAwayDone as number) ?? 0
        const moved = Math.min(400, cap - done)
        lot.putAwayDone = done + moved
        const stuck = s.putAwayStuckAfter !== null && lot.putAwayDone === cap && cap < (lot.verifiedCount as number)
        return json(route, 200, { moved, skipped: stuck ? [{ code: '7K2M-QX4Z-9', reason: 'On hold' }] : [], shortfall: 0, more: stuck || (lot.putAwayDone as number) < (lot.verifiedCount as number) })
      }
      return fail(route, 404, 'NOT_FOUND', 'Not found')
    }

    // ---- boxes
    if (method === 'POST' && path === '/resolve') {
      const input = String(body.input ?? '').toUpperCase()
      if (input.startsWith('7K2M')) return json(route, 200, { kind: 'box', box: boxFixture(), labelRevoked: false })
      return json(route, 200, { kind: 'error', code: 'UNKNOWN_CODE' })
    }
    if (method === 'GET' && path === '/boxes') {
      const lifecycle = url.searchParams.get('lifecycle')
      const all = [boxFixture(), { ...boxFixture(), id: '1c7e3b5f-2d3e-4f60-9b0c-1d2e3f4a5b6c', code: '7K2M-QX4R-8', rawCode: '7K2MQX4R8', seq: 2, holds: [] }]
      return json(route, 200, { boxes: all.filter((b) => !lifecycle || b.lifecycle === lifecycle), next: null })
    }
    if (method === 'POST' && path === '/write-offs') {
      const ids = (body.boxIds as string[]) ?? []
      s.writeOffRequests.push(body)
      const big = ids.length > 1
      return json(route, big ? 202 : 200, { id: 'wo_new', status: big ? 'pending' : 'applied', boxes: ids.length, grams: ids.length * 3000 })
    }
    if (seg[0] === 'trace' && seg[1] === 'boxes') {
      return json(route, 200, {
        box: boxFixture(),
        lot: { id: 'lot_seed', code: 'L2610-ALP3-7K', supplier: 'Ratnagiri Farms', harvestedOn: '2026-10-22', receivedOn: '2026-10-24', bestBefore: '2026-10-29', isLegacy: false },
        batch: { id: 'bat_1', variety: 'Alphonso', pluckedOn: '2026-10-22', farm: 'Ratnagiri Farms', status: 'SELLING' },
        parents: [],
        orders: [{ id: 'ord_1', number: 'ORD-1042', status: 'SHIPPED', deliveryDate: '2026-10-26', customerName: 'Asha Rao', phone: '+919800000001' }],
        events: [
          { type: 'GENERATED', at: '2026-10-24T04:00:00.000Z', actor: 'manager@mandimangoes.test', fromLifecycle: null, toLifecycle: 'generated', fromLocation: null, toLocation: null, quality: null, holdAdded: null, holdReleased: null, orderId: null, reasonCode: null, reason: null },
          { type: 'RECEIVED', at: '2026-10-24T05:00:00.000Z', actor: 'qc@mandimangoes.test', fromLifecycle: 'generated', toLifecycle: 'in_stock', fromLocation: null, toLocation: 'loc_r', quality: null, holdAdded: 'qc_hold', holdReleased: null, orderId: null, reasonCode: null, reason: null },
          { type: 'QC_PASSED', at: '2026-10-24T06:00:00.000Z', actor: 'qc@mandimangoes.test', fromLifecycle: 'in_stock', toLifecycle: 'in_stock', fromLocation: null, toLocation: null, quality: 'passed', holdAdded: null, holdReleased: 'qc_hold', orderId: null, reasonCode: null, reason: null },
        ],
      })
    }
    if (seg[0] === 'trace' && seg[1] === 'lots') {
      return json(route, 200, {
        lot: { id: seg[2], code: 'L2610-ALP3-7K', sku: 'ALP-3KG', supplier: 'Ratnagiri Farms', harvestedOn: '2026-10-22', receivedOn: '2026-10-24', bestBefore: '2026-10-29', status: 'receiving' },
        byState: { in_stock: 1, generated: 3 },
        boxes: [{ id: boxFixture().id, code: '7K2M-QX4P-3', lifecycle: 'in_stock', quality: 'pending', holds: ['qc_hold'], location: 'Receiving', orderId: null, descendant: false }],
        orders: [],
      })
    }
    if (seg[0] === 'boxes' && seg[1]) {
      if (method === 'GET' && seg.length === 2) return json(route, 200, { ...boxFixture(), lotCode: 'L2610-ALP3-7K', orderNumber: null, orderStatus: null, sellable: false })
      if (method === 'GET' && seg[2] === 'events') {
        return json(route, 200, [
          { id: 'ev2', type: 'RECEIVED', at: NOW, actorId: 'adm_1', actor: 'qc@mandimangoes.test', operationId: 'wop_x', scanId: null, fromLifecycle: 'generated', toLifecycle: 'in_stock', fromLocation: null, toLocation: 'loc_r', fromQuality: null, toQuality: null, holdAdded: null, holdReleased: null, orderId: null, reasonCode: null, reason: null, meta: null },
          { id: 'ev1', type: 'GENERATED', at: NOW, actorId: 'adm_1', actor: 'manager@mandimangoes.test', operationId: null, scanId: null, fromLifecycle: null, toLifecycle: 'generated', fromLocation: null, toLocation: null, fromQuality: null, toQuality: null, holdAdded: null, holdReleased: null, orderId: null, reasonCode: null, reason: null, meta: null },
        ])
      }
      if (method === 'GET' && seg[2] === 'label.pdf') return route.fulfill({ status: 200, contentType: 'application/pdf', body: PDF })
      if (method === 'POST' && seg[2] === 'measure') return json(route, 200, { box: boxFixture(), outOfTolerance: Number(body.weightG) < 2850, shortfall: null })
      if (method === 'POST') return json(route, 200, boxFixture())
    }

    // ---- locations
    if (seg[0] === 'locations') {
      if (method === 'GET' && seg.length === 1) return json(route, 200, s.locations)
      if (method === 'GET' && seg[2] === 'label.pdf') return route.fulfill({ status: 200, contentType: 'application/pdf', body: PDF })
      if (method === 'POST') {
        const loc = { id: `loc_${s.locations.length + 1}`, warehouseId: 'wh_1', zone: body.zone ?? null, name: body.name, type: body.type, active: true, pickable: body.type === 'storage', createdAt: NOW, boxes: 0 }
        s.locations.push(loc)
        return json(route, 201, loc)
      }
      if (method === 'PATCH') {
        const loc = s.locations.find((l) => l.id === seg[1])
        if (!loc) return fail(route, 404, 'NOT_FOUND', 'Location not found')
        Object.assign(loc, body)
        return json(route, 200, loc)
      }
    }

    // ---- scan sessions
    if (seg[0] === 'operations') {
      if (method === 'GET' && seg.length === 1) return json(route, 200, s.ops.filter((o) => o.status === 'open').map((o) => opView(o)))
      if (method === 'POST' && seg.length === 1) {
        const type = String(body.type)
        const ctx = (body.context ?? {}) as Json
        const op: WhOp = {
          id: `wop_${s.nextOp++}`, type, class: type === 'pack' || type === 'dispatch' ? 'staged' : 'applied', status: 'open', context: {},
          locationId: null, orderId: null, lotId: null, ownerId: 'adm_1', startedAt: NOW, lastActivityAt: NOW, finishedAt: null,
          accepted: 0, rejected: 0, duplicates: 0, result: null, scans: [],
        }
        if (type === 'receive') {
          const lot = s.lots.find((l) => l.id === ctx.lotId)
          if (!lot) return fail(route, 404, 'NOT_FOUND', 'Lot not found')
          op.lotId = lot.id as string
          op.context = { lotId: lot.id, lotCode: lot.code, locationId: 'loc_r', locationName: 'Receiving' }
        } else if (type === 'move') {
          const loc = s.locations.find((l) => l.id === ctx.locationId)
          if (!loc) return fail(route, 400, 'VALIDATION_ERROR', 'Choose where the boxes are going (scan the location label)')
          op.locationId = loc.id as string
          op.context = { locationId: loc.id, locationName: loc.name, locationType: loc.type }
        } else if (type === 'qc') {
          op.context = { result: ctx.result, reasonCodes: ctx.reasonCodes ?? [] }
        } else {
          op.orderId = String(ctx.orderId)
          op.context = { orderId: ctx.orderId, orderNumber: 'ORD-1042' }
          if (op.class === 'staged') op.needed = s.packNeeds
        }
        s.ops.push(op)
        return json(route, 201, opView(op))
      }
      const op = s.ops.find((o) => o.id === seg[1])
      if (!op) return fail(route, 404, 'NOT_FOUND', 'Operation not found')
      if (method === 'GET' && seg.length === 2) return json(route, 200, opView(op, true))
      if (method === 'POST' && seg[2] === 'scans') {
        const scans = (body.scans ?? []) as { scanId: string; input: string; reason?: string }[]
        s.scanRequests.push(scans)
        if (s.failScans > 0) {
          s.failScans--
          return fail(route, 500, 'INTERNAL', 'Something went wrong')
        }
        return json(route, 200, { results: scans.map((x) => scanOne(op, x)) })
      }
      if (method === 'POST' && seg[2] === 'undo') {
        const last = [...op.scans].reverse().find((x) => x.result === 'accepted' || x.result === 'warning')
        if (!last) return fail(route, 409, 'NOTHING_TO_UNDO', 'Nothing to undo in this session.')
        last.result = 'undone'
        op.accepted--
        const { input, reason, ...v } = last
        return json(route, 200, { undone: v })
      }
      if (method === 'POST' && seg[2] === 'cancel') {
        op.status = 'cancelled'
        return json(route, 200, opView(op))
      }
      if (method === 'POST' && seg[2] === 'finalize') {
        const staged = op.scans.filter((x) => x.result === 'accepted').map((x) => x.input)
        const missing = (op.needed ?? []).filter((c) => !staged.includes(c))
        if (missing.length) {
          return fail(route, 409, 'INCOMPLETE_SET', `${missing.length} ${missing.length === 1 ? 'box is' : 'boxes are'} not scanned yet: ${missing.join(', ')}.`, { missing })
        }
        op.status = 'completed'
        op.result = { orderId: op.orderId, orderNumber: 'ORD-1042', boxes: staged, status: op.type === 'pack' ? 'PACKED' : 'SHIPPED' }
        return json(route, 200, opView(op))
      }
    }

    // ---- picking
    if (method === 'GET' && path === '/pick-queue') return json(route, 200, s.pickQueue)
    if (method === 'GET' && seg[0] === 'orders' && seg[2] === 'pick-list') {
      return json(route, 200, {
        orderId: seg[1], number: 'ORD-1042', status: 'CONFIRMED', deliveryDate: '2026-10-26', atRisk: false, atRiskReason: null,
        items: [
          {
            itemId: 'oi_1', sku: 'ALP-3KG', stage: 'RIPE', quantity: 2, toPick: 2, picked: [],
            suggestions: [{ lot: 'L2610-ALP3-7K', quantity: 2, boxes: [
              { id: 'b1', code: '7K2M-QX4P-3', location: 'Shelf A', bestBefore: '2026-10-29' },
              { id: 'b2', code: '7K2M-QX4R-8', location: 'Shelf A', bestBefore: '2026-10-29' },
            ] }],
          },
        ],
      })
    }

    // ---- reports
    if (method === 'GET' && path === '/exceptions') {
      return json(route, 200, {
        shortfallOrders: [{ orderId: 'ord_2', number: 'ORD-1050', status: 'CONFIRMED', deliveryDate: '2026-10-26', reason: 'Not enough sellable boxes' }],
        heldBoxesOnOrders: [], unreceivedLots: [{ lotId: 'lot_seed', code: 'L2610-ALP3-7K', createdAt: NOW, waiting: 3 }], staleSessions: [],
        expiringSoon: [{ lotId: 'lot_seed', code: 'L2610-ALP3-7K', boxes: 6, bestBefore: '2026-10-27' }], failedMessages: [],
        pendingWriteOffs: [{ id: 'wo_1', boxes: 2, reason: 'Crushed in the van', requestedAt: NOW }], boxesToPutAway: [], investigations: [],
      })
    }
    if (method === 'GET' && path === '/reconciliation') {
      return json(route, 200, { clean: true, trackedLines: 3, stockMismatches: [], orderUnitMismatches: [], impossibleStates: [], lotCountMismatches: [], ledgerDrift: [] })
    }
    if (method === 'GET' && path === '/recalls') return json(route, 200, s.recalls)
    if (seg[0] === 'recalls' && seg[1]) {
      const r = s.recalls.find((x) => x.id === seg[1])
      if (!r) return fail(route, 404, 'NOT_FOUND', 'Recall not found')
      if (method === 'POST' && seg[2] === 'continue') r.status = 'done'
      if (method === 'POST' && seg[2] === 'release') Object.assign(r, { status: 'released', releasedAt: NOW, releaseReason: body.reason })
      return json(route, 200, { ...r, byState: { in_stock: 3, dispatched: 1 }, dispatchedOrders: [{ id: 'ord_1', number: 'ORD-1042', status: 'SHIPPED', deliveryDate: '2026-10-26' }] })
    }
    if (method === 'GET' && path === '/write-offs') return json(route, 200, s.writeOffs.filter((w) => w.status === 'pending'))
    if (method === 'POST' && seg[0] === 'write-offs' && seg[2]) {
      const w = s.writeOffs.find((x) => x.id === seg[1])
      if (!w) return fail(route, 404, 'NOT_FOUND', 'Write-off not found')
      w.status = seg[2] === 'approve' ? 'applied' : 'rejected'
      return json(route, 200, w)
    }
    if (method === 'GET' && seg[0] === 'export') return route.fulfill({ status: 200, contentType: 'text/csv', body: '"code"\r\n"7K2M-QX4P-3"\r\n' })

    return fail(route, 404, 'NOT_FOUND', `No mock for ${method} /warehouse${path}`)
  })

  return s
}

function boxFixture() {
  return {
    id: '0b6f2a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b', code: '7K2M-QX4P-3', rawCode: '7K2MQX4P3', lotId: 'lot_seed', batchId: 'bat_1', lineId: 'bl_1', sku: 'ALP-3KG',
    skuName: 'Alphonso 3kg Box', seq: 1, warehouseId: 'wh_1', locationId: 'loc_r', locationName: 'Receiving', locationType: 'receiving', lifecycle: 'in_stock',
    quality: 'pending', holds: ['qc_hold'], verification: 'scanned', nominalWeightG: 3000, measuredWeightG: null, bestBefore: '2026-10-29', orderId: null,
    orderItemId: null, parentBoxIds: [], reprintCount: 0, version: 2, createdAt: NOW, updatedAt: NOW,
  }
}

function scanOne(op: WhOp, x: { scanId: string; input: string; reason?: string }) {
  const prior = op.scans.find((p) => p.scanId === x.scanId)
  if (prior) {
    const { input, reason, ...v } = prior
    return { ...v, replayed: true }
  }
  const input = x.input.trim().toUpperCase()
  const store = (result: string, code: string, message: string, detail: Json | null = null) => {
    const sc: WhScan = { scanId: x.scanId, seq: op.scans.length + 1, result, code, message, detail, boxId: null, receivedAt: NOW, input, ...(x.reason ? { reason: x.reason } : {}) }
    op.scans.push(sc)
    if (result === 'rejected') op.rejected++
    else if (result === 'duplicate') op.duplicates++
    else op.accepted++
    const { input: _i, reason: _r, ...v } = sc
    return v
  }
  if (op.status !== 'open') return store('rejected', 'OPERATION_CLOSED', 'This session is closed.')
  if (input.startsWith('BAD')) return store('rejected', 'UNKNOWN_CODE', 'Unknown label: not a box in this warehouse.')
  if (input === 'LOC-B' && op.type === 'move') {
    return store('rejected', 'WRONG_LABEL_TYPE', 'That is the Shelf B location label, not a box.', { location: { id: 'loc_b', name: 'Shelf B', type: 'storage', active: true } })
  }
  if (input.startsWith('OTHER') && op.type === 'pick') {
    if (!x.reason) return store('rejected', 'NON_FEFO', `${input} is not from the reserved batch (L2610-ALP3-7K). Pick from that batch, or give a reason.`, { needsReason: true, expectedLot: 'L2610-ALP3-7K' })
    return store('warning', 'NON_FEFO', `${input} picked from another batch (${x.reason}). 1 left.`, { orderId: op.orderId })
  }
  if (op.scans.some((p) => p.input === input && (p.result === 'accepted' || p.result === 'warning'))) return store('duplicate', 'ALREADY_SCANNED', `${input} is already scanned in this session.`)
  const verb = op.type === 'receive' ? 'received' : op.type === 'move' ? `moved to ${String(op.context.locationName)}` : op.class === 'staged' ? 'staged' : op.type === 'pick' ? 'picked for ORD-1042' : 'done'
  return store('accepted', 'OK', `${input} ${verb}.`)
}
