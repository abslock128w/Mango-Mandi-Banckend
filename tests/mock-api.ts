import type { Page, Route } from '@playwright/test'

// A small in-memory stand-in for mango-api's /admin/v1, so the UI can be
// exercised in CI without a database. Shapes follow the API reference (§6).

export type Role = 'MANAGER' | 'OPERATOR'

export interface MockOptions {
  /** Signed in already (refresh succeeds) or not (refresh returns 401). */
  signedIn?: boolean
  role?: Role
}

const json = (route: Route, status: number, body?: unknown) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: body === undefined ? '' : JSON.stringify(body),
  })

export function seed() {
  return {
    summary: {
      orders: { CONFIRMED: 3, PROCESSING: 1, PACKED: 2, SHIPPED: 0, OUT_FOR_DELIVERY: 1, DELIVERY_FAILED: 0, PAYMENT_PENDING: 5 },
      openClaims: 2,
      batchesNearLimit: [{ id: 'b1', variety: 'Alphonso', ageDays: 7, available: 12 }],
      lowStock: [{ sku: 'ALP-5', productName: 'Alphonso 5kg Box', available: 3 }],
    },
    products: [
      { sku: 'ALP-3', name: 'Alphonso 3kg Box', variety: 'Alphonso', boxSize: '3kg' },
      { sku: 'ALP-5', name: 'Alphonso 5kg Box', variety: 'Alphonso', boxSize: '5kg' },
      { sku: 'KES-3', name: 'Kesar 3kg Box', variety: 'Kesar', boxSize: '3kg' },
    ],
    batch: {
      id: 'b1',
      variety: 'Alphonso',
      pluckedOn: '2026-10-08',
      ageDays: 7,
      farm: 'Ratnagiri',
      status: 'SELLING',
      lines: [
        { id: 'l1', sku: 'ALP-3', onHand: 20, held: 2, committed: 3, reserveBuffer: 1, available: 14 },
        { id: 'l2', sku: 'ALP-5', onHand: 10, held: 0, committed: 6, reserveBuffer: 1, available: 3 },
      ],
      qc: [
        { id: 'q1', ripenessRating: 'RIPE', condition: 'GOOD', notes: null, loggedBy: 'ops@vmr.test', loggedAt: '2026-10-14T04:30:00Z' },
      ],
    },
    batches: [
      { id: 'b1', variety: 'Alphonso', pluckedOn: '2026-10-08', ageDays: 7, farm: 'Ratnagiri', status: 'SELLING', latestRating: 'RIPE', latestCondition: 'GOOD', onHand: 30, held: 2, committed: 9, available: 17 },
      { id: 'b2', variety: 'Kesar', pluckedOn: '2026-10-14', ageDays: 1, farm: null, status: 'ARRIVED', latestRating: null, latestCondition: null, onHand: 40, held: 0, committed: 0, available: 0 },
    ],
    ledger: [
      { eventType: 'INTAKE', sku: 'ALP-3', delta: 20, actorType: 'admin', actorId: 'ops@vmr.test', reason: null, createdAt: '2026-10-08T05:00:00Z' },
      { eventType: 'PACK', sku: 'ALP-3', delta: -2, actorType: 'admin', actorId: 'ops@vmr.test', reason: null, createdAt: '2026-10-10T05:00:00Z' },
    ],
    orders: {
      page: 1,
      pageSize: 50,
      total: 2,
      items: [
        { id: 'o1', number: 'ORD-1042', customerName: 'Asha Rao', phone: '9876543210', itemCount: 2, total: 249900, status: 'PROCESSING', deliveryDate: '2026-10-16', placedAt: '2026-10-14T06:00:00Z' },
        { id: 'o2', number: 'ORD-1043', customerName: 'Vikram S', phone: '9123456780', itemCount: 1, total: 129900, status: 'DELIVERED', deliveryDate: '2026-10-13', placedAt: '2026-10-11T06:00:00Z' },
      ],
    },
    order: {
      id: 'o1',
      number: 'ORD-1042',
      status: 'PROCESSING',
      customerName: 'Asha Rao',
      phone: '9876543210',
      pincode: '400001',
      deliveryAddress: '12 Marine Drive, Mumbai',
      deliveryDate: '2026-10-16',
      placedAt: '2026-10-14T06:00:00Z',
      total: 249900,
      items: [
        { productName: 'Alphonso 3kg Box', sku: 'ALP-3', quantity: 1, stage: 'RIPE', linePrice: 129900 },
        { productName: 'Alphonso 5kg Box', sku: 'ALP-5', quantity: 1, stage: 'RIPE', linePrice: 120000 },
      ],
      stock: [
        { batchId: 'b1', sku: 'ALP-3', variety: 'Alphonso', pluckedOn: '2026-10-08', quantity: 1, state: 'committed' },
        { batchId: 'b1', sku: 'ALP-5', variety: 'Alphonso', pluckedOn: '2026-10-08', quantity: 1, state: 'committed' },
      ],
      events: [
        { status: 'PAYMENT_PENDING', actor: 'system', reason: null, createdAt: '2026-10-14T06:00:00Z' },
        { status: 'CONFIRMED', actor: 'webhook:razorpay', reason: null, createdAt: '2026-10-14T06:01:00Z' },
        { status: 'PROCESSING', actor: 'ops@vmr.test', reason: null, createdAt: '2026-10-14T08:00:00Z' },
      ],
      payment: { status: 'SUCCEEDED', method: 'upi', amount: 249900 },
      slot: { id: 'slt1', label: 'Morning', startsAt: '07:00', endsAt: '11:00' },
      notifications: [
        { kind: 'ORDER_CONFIRMED', channel: 'whatsapp', status: 'SENT', attempts: 1, createdAt: '2026-10-14T06:01:00Z', sentAt: '2026-10-14T06:01:05Z', error: null },
      ],
    },
    deliveredOrder: {
      id: 'o2',
      number: 'ORD-1043',
      status: 'DELIVERED',
      customerName: 'Vikram S',
      phone: '9123456780',
      pincode: '400002',
      deliveryAddress: '4 Hill Road, Mumbai',
      deliveryDate: '2026-10-13',
      placedAt: '2026-10-11T06:00:00Z',
      total: 129900,
      items: [{ productName: 'Alphonso 3kg Box', sku: 'ALP-3', quantity: 1, stage: 'RIPE', linePrice: 129900 }],
      stock: [{ batchId: 'b1', sku: 'ALP-3', variety: 'Alphonso', pluckedOn: '2026-10-08', quantity: 1, state: 'packed' }],
      events: [{ status: 'DELIVERED', actor: 'ops@vmr.test', reason: null, createdAt: '2026-10-13T10:00:00Z' }],
      payment: { status: 'SUCCEEDED', method: 'card', amount: 129900 },
    },
    packList: [
      {
        id: 'o1',
        number: 'ORD-1042',
        customerName: 'Asha Rao',
        pincode: '400001',
        status: 'PROCESSING',
        slot: { id: 'slt1', label: 'Morning' },
        items: [
          { sku: 'ALP-3', productName: 'Alphonso 3kg Box', quantity: 1, picks: [{ batchId: 'b1', variety: 'Alphonso', pluckedOn: '2026-10-08', quantity: 1, packed: false }] },
          { sku: 'ALP-5', productName: 'Alphonso 5kg Box', quantity: 1, picks: [] },
        ],
      },
    ],
    claims: [
      { id: 'c1', orderId: 'o2', orderNumber: 'ORD-1043', orderTotal: 129900, customerPhone: '9123456780', issueType: 'DAMAGED', description: 'Two mangoes were crushed.', affectedItems: ['ALP-3'], photoUrl: 'https://example.com/p.jpg', status: 'SUBMITTED', resolution: null, createdAt: '2026-10-14T07:00:00Z' },
      { id: 'c2', orderId: 'o2', orderNumber: 'ORD-1043', orderTotal: 129900, customerPhone: '9123456780', issueType: 'WRONG_ITEM', description: 'Got Kesar instead of Alphonso.', affectedItems: ['ALP-3'], photoUrl: null, status: 'UNDER_REVIEW', resolution: null, createdAt: '2026-10-14T07:30:00Z' },
    ],
    pincodes: [
      { pincode: '400001', city: 'Mumbai', zone: 'South', active: true },
      { pincode: '411001', city: 'Pune', zone: null, active: false },
    ],
    coverage: [
      {
        date: '2026-10-16',
        slots: [
          { id: 'slt1', label: 'Morning', booked: 12, maxBoxes: 40 },
          { id: 'slt2', label: 'Evening', booked: 3, maxBoxes: null },
        ],
        stock: [
          { sku: 'ALP-3', stage: 'RAW', qty: 0 },
          { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 12 },
          { sku: 'ALP-3', stage: 'RIPE', qty: 4 },
        ],
      },
    ],
    slots: [
      { id: 'slt1', label: 'Morning', startsAt: '07:00', endsAt: '11:00', maxBoxes: 40, active: true, sort: 0 },
      { id: 'slt2', label: 'Evening', startsAt: '16:00', endsAt: '20:00', maxBoxes: null, active: true, sort: 1 },
    ],
    calendar: [{ date: '2026-10-20', isOpen: false, maxBoxes: null, note: 'Diwali' }],
    config: {
      version: 3,
      rules: {
        maxSellableAge: 7,
        retireAge: 8,
        cutoffHourIST: 18,
        maxDaysAhead: 5,
        holdMinutes: 10,
        quoteMinutes: 5,
        forecastConfidence: 0.85,
        maxQcShift: 1,
        transitDays: 2,
        nearLimitAge: 5,
        lowStockThreshold: 5,
        claimWindowHours: 24,
        stageProfiles: {
          default: [
            { stage: 'RAW', minAge: 3, maxAge: 3 },
            { stage: 'SEMI_RIPE', minAge: 4, maxAge: 5 },
            { stage: 'RIPE', minAge: 6, maxAge: 7 },
          ],
        },
      },
    },
  }
}

export type MockState = ReturnType<typeof seed> & { signedIn: boolean; role: Role; calls: { method: string; path: string; body: unknown }[] }

/** Routes every /admin/v1 call to the mock. Returns the mutable state and call log. */
export async function mockApi(page: Page, opts: MockOptions = {}): Promise<MockState> {
  const state: MockState = { ...seed(), signedIn: opts.signedIn ?? false, role: opts.role ?? 'MANAGER', calls: [] }

  await page.route('**/admin/v1/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace(/^.*\/admin\/v1/, '')
    const method = req.method()
    let body: unknown = undefined
    try {
      body = req.postDataJSON()
    } catch {
      body = req.postData()
    }
    state.calls.push({ method, path, body })

    if (path === '/auth/refresh') return state.signedIn ? json(route, 200, { accessToken: 'tok' }) : json(route, 401, { error: { code: 'INVALID_TOKEN', message: 'No session', requestId: 'req_x' } })
    if (path === '/auth/login') {
      const b = body as { email?: string; password?: string }
      if (b?.password === 'correct') {
        state.signedIn = true
        return json(route, 200, { accessToken: 'tok' })
      }
      return json(route, 401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials', requestId: 'req_y' } })
    }
    if (path === '/auth/logout') {
      state.signedIn = false
      return route.fulfill({ status: 204 })
    }
    if (!state.signedIn) return json(route, 401, { error: { code: 'UNAUTHORIZED', message: 'Unauthorized', requestId: 'req_z' } })
    if (path === '/auth/me') return json(route, 200, { email: state.role === 'MANAGER' ? 'manager@vmr.test' : 'ops@vmr.test', role: state.role })

    if (path === '/summary') return json(route, 200, state.summary)
    if (path === '/products') return json(route, 200, state.products)
    if (path === '/batches' && method === 'GET') return json(route, 200, state.batches)
    if (path === '/batches' && method === 'POST') return json(route, 201, { ...state.batch, id: 'b-new', status: 'ARRIVING', qc: [] })
    if (/^\/batches\/[^/]+$/.test(path)) return json(route, 200, state.batch)
    if (/\/ledger$/.test(path)) return json(route, 200, state.ledger)
    if (/^\/batches\/[^/]+\/status$/.test(path)) {
      const s = (body as { status: string }).status
      if (s === 'CONDEMNED') return json(route, 200, { rebalancedOrders: ['ORD-1042'], atRiskOrders: ['ORD-1043'] })
      state.batch = { ...state.batch, status: s }
      return route.fulfill({ status: 204 })
    }
    if (/\/qc$/.test(path)) return json(route, 201, { id: 'q2', warning: 'QC already logged today by this user' })
    if (/\/lines\//.test(path)) return route.fulfill({ status: 204 })

    if (path === '/orders') return json(route, 200, state.orders)
    if (path === '/orders/o1') return json(route, 200, state.order)
    if (path === '/orders/o2') return json(route, 200, state.deliveredOrder)
    if (/^\/orders\/[^/]+\/(status|allocate|cancel|reschedule)$/.test(path)) return route.fulfill({ status: 204 })

    if (path === '/pack-list') return json(route, 200, state.packList)
    if (path === '/claims') return json(route, 200, state.claims)
    if (/^\/claims\/[^/]+\/(review|resolve)$/.test(path)) return route.fulfill({ status: 204 })

    if (path === '/pincodes' && method === 'GET') return json(route, 200, state.pincodes)
    if (path === '/pincodes' && method === 'POST') return json(route, 201, { ...(body as object), active: true })
    if (/^\/pincodes\//.test(path)) return route.fulfill({ status: 204 })

    if (path === '/coverage') return json(route, 200, state.coverage)
    if (path === '/slots' && method === 'GET') return json(route, 200, state.slots)
    if (path === '/slots' || path.startsWith('/slots/')) {
      if (state.role !== 'MANAGER') return json(route, 403, { error: { code: 'FORBIDDEN', message: 'Requires manager role', requestId: 'req_f' } })
      if (method === 'POST') {
        const slot = { id: `slt${state.slots.length + 1}`, active: true, sort: state.slots.length, ...(body as object) } as (typeof state.slots)[number]
        state.slots = [...state.slots, slot]
        return json(route, 201, slot)
      }
      const slotId = path.split('/')[2]
      state.slots = state.slots.map((x) => (x.id === slotId ? { ...x, ...(body as object) } : x))
      return json(route, 200, state.slots.find((x) => x.id === slotId))
    }
    if (path === '/calendar') return json(route, 200, state.calendar)
    if (/^\/calendar\//.test(path)) return route.fulfill({ status: 204 })
    if (path === '/config' && method === 'GET') return json(route, 200, state.config)
    if (path === '/config' && method === 'PUT') {
      if (state.role !== 'MANAGER') return json(route, 403, { error: { code: 'FORBIDDEN', message: 'Requires manager role', requestId: 'req_f' } })
      state.config = { version: state.config.version + 1, rules: (body as { rules: typeof state.config.rules }).rules }
      return json(route, 200, state.config)
    }

    return json(route, 404, { error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'req_404' } })
  })

  return state
}
