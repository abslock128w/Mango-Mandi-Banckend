import AxeBuilder from '@axe-core/playwright'
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { mockApi } from './mock-api'

// Customer care (docs/care.md): the Help desk (HELP_CENTRE) and the Subscriptions list
// (SUBSCRIPTIONS), for managers and operators, each only while /auth/me says it is on.

type Role = 'MANAGER' | 'OPERATOR' | 'PACKER' | 'QC' | 'RIDER'
const EMAIL: Record<Role, string> = {
  MANAGER: 'manager@mandimangoes.test', OPERATOR: 'ops@mandimangoes.test', PACKER: 'packer@mandimangoes.test', QC: 'qc@mandimangoes.test', RIDER: 'rider@mandimangoes.test',
}

async function features(page: Page, role: Role, on: { helpDesk?: boolean; subscriptions?: boolean }) {
  await page.route('**/admin/v1/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: EMAIL[role], role, twoStep: { enabled: false, required: false }, features: on }) }),
  )
}

/** Shows the Customers links: the Menu on a phone; on a wide screen they are in the sidebar already. */
async function openCustomers(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 900) await page.getByRole('button', { name: 'Menu' }).click()
}

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

const TOPICS = { DELIVERY: 'Delivery or my slot', PAYMENT: 'Payment', CHANGE_ORDER: 'Changing my order', SUBSCRIPTION: 'My subscription', ACCOUNT: 'My account or signing in', OTHER: 'Something else' }

function helpState() {
  const base = {
    customer: { id: 'cus_1', name: 'Asha Rao', phoneMasked: '******3210' },
    createdAt: '2026-10-15T05:00:00Z', lastCustomerAt: '2026-10-15T05:00:00Z', lastStaffAt: null as string | null, resolvedAt: null as string | null, resolvedBy: null as string | null,
  }
  return {
    requests: [
      {
        ...base, id: 'hlp_1', number: 'HLP-1', topic: 'DELIVERY', topicLabel: TOPICS.DELIVERY, status: 'OPEN', updatedAt: '2026-10-15T05:00:00Z',
        order: { id: 'o1', number: 'ORD-1042', status: 'CONFIRMED', deliveryDate: '2026-10-16' },
        messages: [{ id: 'hms_1', from: 'CUSTOMER', staffEmail: null as string | null, body: 'Can the box come after 6 pm?', at: '2026-10-15T05:00:00Z' }],
      },
      {
        ...base, id: 'hlp_2', number: 'HLP-2', topic: 'PAYMENT', topicLabel: TOPICS.PAYMENT, status: 'RESOLVED', updatedAt: '2026-10-14T05:00:00Z', order: null,
        resolvedAt: '2026-10-14T06:00:00Z', resolvedBy: 'ops@mandimangoes.test',
        messages: [{ id: 'hms_2', from: 'CUSTOMER', staffEmail: null as string | null, body: 'Paid twice?', at: '2026-10-14T05:00:00Z' }],
      },
    ],
  }
}

async function helpMock(page: Page) {
  const state = helpState()
  const calls: { method: string; path: string; body: unknown }[] = []
  const view = (r: (typeof state.requests)[number]) => ({ ...r, messageCount: r.messages.length })
  await page.route('**/admin/v1/help/requests**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace(/^.*\/admin\/v1/, '')
    const body = req.postData() ? req.postDataJSON() : undefined
    calls.push({ method: req.method(), path: `${path}${url.search}`, body })
    if (path === '/help/requests') {
      const status = url.searchParams.get('status')
      const topic = url.searchParams.get('topic')
      const items = state.requests.filter((r) => (!status || r.status === status) && (!topic || r.topic === topic)).map(({ messages: _m, ...r }) => ({ ...r, messageCount: _m.length }))
      const counts = { OPEN: 0, WAITING_CUSTOMER: 0, RESOLVED: 0 } as Record<string, number>
      for (const r of state.requests) counts[r.status]++
      return json(route, 200, { items, counts, topics: TOPICS })
    }
    const m = /^\/help\/requests\/([^/]+)(?:\/(reply|resolve|reopen))?$/.exec(path)
    const r = m && state.requests.find((x) => x.id === m[1])
    if (!r) return json(route, 404, { error: { code: 'NOT_FOUND', message: 'Help request not found', requestId: 'req_h' } })
    if (m[2] === 'reply') {
      r.messages.push({ id: `hms_${r.messages.length + 10}`, from: 'STAFF', staffEmail: 'ops@mandimangoes.test', body: (body as { message: string }).message, at: '2026-10-15T06:00:00Z' })
      r.status = 'WAITING_CUSTOMER'
      return json(route, 201, view(r))
    }
    if (m[2] === 'resolve') {
      r.status = 'RESOLVED'
      r.resolvedAt = '2026-10-15T06:30:00Z'
      r.resolvedBy = 'ops@mandimangoes.test'
      return json(route, 200, view(r))
    }
    if (m[2] === 'reopen') {
      r.status = 'OPEN'
      r.resolvedAt = null
      return json(route, 200, view(r))
    }
    return json(route, 200, view(r))
  })
  return { state, calls }
}

function subscriptionState() {
  type Cycle = {
    id: string; scheduledFor: string; deliveryDate: string; slotId: string | null; status: string; note: string | null
    order: { id: string; number: string; status: string; paymentStatus: string; holdExpiresAt: string | null } | null
    canPay: boolean; paid: boolean; awaitingPayment: boolean
  }
  const cycle = (over: Partial<Cycle>): Cycle => ({
    id: 'cyc_1', scheduledFor: '2026-10-17', deliveryDate: '2026-10-17', slotId: null, status: 'DUE', note: null, order: null, canPay: true, paid: false, awaitingPayment: false, ...over,
  })
  return {
    items: [
      {
        id: 'sub_1', number: 'SUB-1', status: 'ACTIVE', sku: 'ALP-3', productName: 'Alphonso 3kg Box', unitPrice: 189900, stage: 'RIPE', qty: 2, frequency: 'WEEKLY', weekday: 6,
        firstDate: '2026-10-17', endDate: '2026-11-30', slotId: null, pincode: '560034', createdAt: '2026-10-15T05:00:00Z', pausedAt: null as string | null, cancelledAt: null as string | null,
        cycles: [cycle({})], upcoming: ['2026-10-24', '2026-10-31'],
        customer: { id: 'cus_1', name: 'Asha Rao', phoneMasked: '******3210' },
      },
      {
        id: 'sub_2', number: 'SUB-2', status: 'PAUSED', sku: 'BAD-3', productName: 'Badami 3kg Box', unitPrice: 129900, stage: 'SEMI_RIPE', qty: 1, frequency: 'FORTNIGHTLY', weekday: 7,
        firstDate: '2026-10-18', endDate: '2026-12-13', slotId: null, pincode: '560008', createdAt: '2026-10-15T05:00:00Z', pausedAt: '2026-10-15T07:00:00Z' as string | null, cancelledAt: null as string | null,
        cycles: [cycle({ id: 'cyc_2', scheduledFor: '2026-10-18', deliveryDate: '2026-10-18', status: 'ORDERED', canPay: false, paid: true, order: { id: 'o9', number: 'ORD-1050', status: 'CONFIRMED', paymentStatus: 'SUCCEEDED', holdExpiresAt: null } })],
        upcoming: [], customer: { id: 'cus_2', name: 'Ravi K', phoneMasked: '******1111' },
      },
    ],
  }
}

async function subscriptionMock(page: Page) {
  const state = subscriptionState()
  const calls: { method: string; path: string; body: unknown }[] = []
  await page.route('**/admin/v1/subscriptions**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace(/^.*\/admin\/v1/, '')
    const body = req.postData() ? req.postDataJSON() : undefined
    calls.push({ method: req.method(), path, body })
    if (path === '/subscriptions') {
      const status = url.searchParams.get('status')
      const counts = { ACTIVE: 0, PAUSED: 0, CANCELLED: 0 } as Record<string, number>
      for (const s of state.items) counts[s.status]++
      return json(route, 200, { items: state.items.filter((s) => !status || s.status === status), counts })
    }
    const m = /^\/subscriptions\/([^/]+)\/(pause|cancel)$/.exec(path)
    const s = m && state.items.find((x) => x.id === m[1])
    if (!s) return json(route, 404, { error: { code: 'NOT_FOUND', message: 'Subscription not found', requestId: 'req_s' } })
    if (((body as { reason?: string })?.reason ?? '').trim().length < 5) return json(route, 400, { error: { code: 'VALIDATION', message: 'Say why (5 characters or more). It is kept in the activity log.', requestId: 'req_v' } })
    if (m[2] === 'pause') {
      s.status = 'PAUSED'
      s.pausedAt = '2026-10-15T08:00:00Z'
    } else {
      s.status = 'CANCELLED'
      s.cancelledAt = '2026-10-15T08:00:00Z'
    }
    s.cycles = s.cycles.map((y) => (y.status === 'DUE' ? { ...y, status: 'CANCELLED', canPay: false, note: 'Paused before it was paid for' } : y))
    return route.fulfill({ status: 204 })
  })
  return { state, calls }
}

const scan = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

test('switched off: no Help desk or Subscriptions link, and the pages say they are off', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'MANAGER' })
  await features(page, 'MANAGER', {})
  await page.goto('/today')
  await openCustomers(page)
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: 'Claims', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Help desk' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Subscriptions' })).toHaveCount(0)
  await page.goto('/help-desk')
  await expect(page.getByText('The help centre is switched off')).toBeVisible()
  await page.goto('/subscriptions')
  await expect(page.getByText('Subscriptions are switched off')).toBeVisible()
})

test('packers, QC and riders never see the Help desk or Subscriptions, even when on', async ({ page }) => {
  for (const role of ['PACKER', 'QC', 'RIDER'] as const) {
    await mockApi(page, { signedIn: true, role })
    await features(page, role, { helpDesk: true, subscriptions: true })
    await page.goto('/help-desk')
    await expect(page.getByRole('heading', { name: 'Help desk' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible()
    await page.goto('/subscriptions')
    await expect(page.getByRole('heading', { name: 'Subscriptions', level: 1 })).toHaveCount(0)
  }
})

test('an operator answers a help request: inbox, filters, the thread, a reply, resolve and reopen', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await features(page, 'OPERATOR', { helpDesk: true })
  const help = await helpMock(page)
  await page.goto('/today')
  await openCustomers(page)
  await page.getByRole('link', { name: 'Help desk' }).click()
  await expect(page).toHaveURL(/\/help-desk$/)
  await expect(page.getByTestId('help-counts')).toHaveText('1 open · 0 waiting for the customer · 1 resolved')
  await expect(page.getByRole('link', { name: /HLP-1/ })).toBeVisible()
  await expect(page.getByText('******3210').first()).toBeVisible()
  // No full phone number anywhere on the page.
  await expect(page.locator('body')).not.toContainText('9876543210')
  await expect(page.getByRole('main').getByRole('link', { name: 'claims' })).toHaveAttribute('href', '/claims')

  // Filters go to the API.
  // Status: chips on a wide screen, a select on a phone.
  const phone = (page.viewportSize()?.width ?? 1280) < 640
  const pickStatus = async (label: string, value: string) =>
    phone ? page.getByLabel('Status', { exact: true }).selectOption(value) : page.getByRole('button', { name: label, exact: true }).click()
  await pickStatus('Resolved', 'RESOLVED')
  await expect(page.getByRole('link', { name: /HLP-2/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /HLP-1/ })).toHaveCount(0)
  await pickStatus('All', '')
  await expect(page.getByRole('link', { name: /HLP-1/ })).toBeVisible()
  await page.getByLabel('Topic').selectOption('DELIVERY')
  await expect.poll(() => help.calls.some((c) => c.path.includes('topic=DELIVERY'))).toBe(true)
  await expect(page.getByRole('link', { name: /HLP-2/ })).toHaveCount(0)
  await scan(page)

  await page.getByRole('link', { name: /HLP-1/ }).click()
  await expect(page.getByRole('heading', { name: 'HLP-1' })).toBeVisible()
  await expect(page.getByText('Can the box come after 6 pm?')).toBeVisible()
  await expect(page.getByRole('link', { name: /ORD-1042/ })).toHaveAttribute('href', '/orders/o1')
  const send = page.getByRole('button', { name: 'Send reply' })
  await expect(send).toBeDisabled()
  await page.getByLabel('Reply to the customer').fill('Yes, we can bring it between 6 and 8 pm.')
  await send.click()
  await expect(page.getByRole('list', { name: 'Messages' }).getByText('Yes, we can bring it between 6 and 8 pm.')).toBeVisible()
  await expect(page.getByText('Waiting for customer')).toBeVisible()
  expect(help.calls.find((c) => c.method === 'POST' && c.path.endsWith('/reply'))?.body).toEqual({ message: 'Yes, we can bring it between 6 and 8 pm.' })
  await scan(page)

  await page.getByRole('button', { name: 'Mark resolved' }).click()
  await expect(page).toHaveURL(/\/help-desk$/)
  // Let the inbox finish loading: leaving mid-request is logged as an error in WebKit.
  await expect(page.getByTestId('help-counts')).toBeVisible()
  await page.goto('/help-desk/hlp_1')
  await expect(page.getByText('Resolved', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Reopen' }).click()
  await expect(page.getByRole('button', { name: 'Mark resolved' })).toBeVisible()
  expect(help.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/help/requests/hlp_1/reply', '/help/requests/hlp_1/resolve', '/help/requests/hlp_1/reopen'])
})

test('a manager sees subscriptions with their coming boxes, and pauses and cancels with a reason', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'MANAGER' })
  await features(page, 'MANAGER', { subscriptions: true })
  const subs = await subscriptionMock(page)
  await page.goto('/subscriptions')
  await expect(page.getByTestId('subscription-counts')).toHaveText('1 active · 1 paused · 0 cancelled')
  const first = page.getByRole('article', { name: 'SUB-1' })
  await expect(first).toContainText('2 × Alphonso 3kg Box (Ripe)')
  await expect(first).toContainText('Every Saturday')
  await expect(first).toContainText('waiting for payment')
  await expect(first).toContainText('not set up yet')
  await expect(first).toContainText('******3210')
  const second = page.getByRole('article', { name: 'SUB-2' })
  await expect(second).toContainText('Every other Sunday')
  await expect(second.getByRole('link', { name: 'ORD-1050' })).toHaveAttribute('href', '/orders/o9')
  await expect(second.getByRole('button', { name: /Pause/ })).toHaveCount(0)
  await scan(page)

  await first.getByRole('button', { name: 'Pause SUB-1' }).click()
  const dialog = page.getByRole('dialog')
  const confirm = dialog.getByRole('button', { name: 'Pause subscription' })
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel('Reason').fill('ok')
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel('Reason').fill('Customer asked on the phone, travelling')
  await confirm.click()
  await expect(dialog).toHaveCount(0)
  await expect(first.locator('.badge')).toHaveText('Paused')

  await first.getByRole('button', { name: 'Cancel SUB-1' }).click()
  await page.getByRole('dialog').getByLabel('Reason').fill('Moved out of Bengaluru')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel subscription' }).click()
  await expect(first.locator('.badge')).toHaveText('Cancelled')
  expect(subs.calls.filter((c) => c.method === 'POST')).toEqual([
    { method: 'POST', path: '/subscriptions/sub_1/pause', body: { reason: 'Customer asked on the phone, travelling' } },
    { method: 'POST', path: '/subscriptions/sub_1/cancel', body: { reason: 'Moved out of Bengaluru' } },
  ])
})

test('on a phone the Help desk list and a thread fit the screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 })
  await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await features(page, 'OPERATOR', { helpDesk: true })
  await helpMock(page)
  await page.goto('/help-desk')
  await expect(page.getByRole('link', { name: /HLP-1/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.goto('/help-desk/hlp_1')
  await expect(page.getByLabel('Reply to the customer')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
