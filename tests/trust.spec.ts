import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { mockApi, type MockState } from './mock-api'
import type { CustomerProfile, Role } from '../src/types'

// The panel's side of bills, customer profiles and CSV exports (docs/trust.md),
// against the mock API: who sees what, the masked phone and its reveal, the
// export range check, and the pages at phone width. The real-API journey is
// customer-app/tests/trust.spec.ts.

const EMAIL: Record<Role, string> = { MANAGER: 'manager@mandimangoes.test', OPERATOR: 'ops@mandimangoes.test', PACKER: 'packer@mandimangoes.test', QC: 'qc@mandimangoes.test', RIDER: 'rider@mandimangoes.test' }

const PROFILE: CustomerProfile = {
  id: 'cus_asha',
  name: 'Asha Rao',
  phoneMasked: '******3210',
  emailMasked: 'a*****@example.com',
  hasPhone: true,
  hasEmail: true,
  signIn: { phone: true, google: false },
  createdAt: '2026-09-02T05:00:00Z',
  deletedAt: null,
  consent: { privacyAcceptedAt: '2026-09-02T05:00:00Z', remindersOptIn: true, openStockAlerts: 1 },
  stats: { paidOrders: 2, allOrders: 3, replacements: 1, lifetimeSpend: 449800, refunds: 0, firstOrderAt: '2026-09-02T05:10:00Z', lastOrderAt: '2026-10-14T06:00:00Z', claims: 1, reviews: 1, averageRating: 4.5, openPreorders: 0 },
  orders: [
    { id: 'o1', number: 'ORD-1042', status: 'PROCESSING', placedAt: '2026-10-14T06:00:00Z', deliveryDate: '2026-10-16', total: 249900, discount: 0, boxes: 2, paymentStatus: 'SUCCEEDED', channel: 'whatsapp', replacement: false, refund: null, business: { name: 'Rao Fruit Mart', gstin: '29ABCDE1234F1ZW' }, bill: { number: 'MM/26-27/000042', cancelled: false } },
    { id: 'o2', number: 'ORD-1043', status: 'DELIVERED', placedAt: '2026-09-02T05:10:00Z', deliveryDate: '2026-09-04', total: 199900, discount: 0, boxes: 1, paymentStatus: 'SUCCEEDED', channel: 'app', replacement: false, refund: null, business: null, bill: { number: 'MM/26-27/000007', cancelled: false } },
    { id: 'o9', number: 'ORD-1050', status: 'CONFIRMED', placedAt: '2026-09-06T05:10:00Z', deliveryDate: '2026-09-07', total: 0, discount: 0, boxes: 1, paymentStatus: null, channel: 'app', replacement: true, refund: null, business: null, bill: null },
  ],
  ordersShown: 3,
  claims: [{ id: 'c1', orderId: 'o2', orderNumber: 'ORD-1043', issueType: 'DAMAGED', status: 'RESOLVED', resolution: 'REPLACEMENT_APPROVED', createdAt: '2026-09-04T09:00:00Z', resolvedAt: '2026-09-05T09:00:00Z', replacementOrder: { id: 'o9', number: 'ORD-1050' } }],
  reviews: [{ id: 'r1', orderId: 'o2', orderNumber: 'ORD-1043', sku: 'ALP-3', productName: 'Alphonso 3kg Box', rating: 5, status: 'APPROVED', comment: 'Sweet and ripe on day two.', createdAt: '2026-09-06T08:00:00Z' }],
  ratings: [{ orderId: 'o2', orderNumber: 'ORD-1043', stars: 4, comment: null, at: '2026-09-05T08:00:00Z' }],
  addresses: [{ id: 'adr1', name: 'Home', address: '12 Marine Drive, Koramangala, Bengaluru', pincode: '560034', lastUsedAt: '2026-10-14T06:00:00Z' }],
}

/** The mock API, signed in as `role`, with the trust features switched on (or not) in /auth/me. */
async function staff(page: Page, role: Role, on = true): Promise<MockState> {
  const api = await mockApi(page, { signedIn: true, role })
  const features = { bills: on, customerProfiles: on, exports: on }
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
  // Routes added after mockApi's catch-all take precedence over it.
  await page.route('**/admin/v1/auth/me', (route) => route.fulfill(json({ email: EMAIL[role], role, twoStep: api.twoStep, features })))
  await page.route('**/admin/v1/customers/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace(/^.*\/admin\/v1/, '')
    api.calls.push({ method: req.method(), path, body: req.postDataJSON?.() ?? null })
    if (!on) return route.fulfill(json({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'req_n' } }, 404))
    if (role !== 'MANAGER' && role !== 'OPERATOR') return route.fulfill(json({ error: { code: 'FORBIDDEN', message: 'Not available to your role', requestId: 'req_f' } }, 403))
    if (path === '/customers/search') return route.fulfill(json({ items: [{ id: PROFILE.id, name: PROFILE.name, phoneMasked: PROFILE.phoneMasked, createdAt: PROFILE.createdAt, orders: 3, lastOrderAt: PROFILE.stats.lastOrderAt }] }))
    if (path === `/customers/${PROFILE.id}/reveal`) return route.fulfill(json({ phone: '9876543210', email: 'asha@example.com' }))
    if (path === `/customers/${PROFILE.id}`) return route.fulfill(json(PROFILE))
    return route.fulfill(json({ error: { code: 'NOT_FOUND', message: 'Customer not found', requestId: 'req_n' } }, 404))
  })
  return api
}

async function scan(page: Page, where: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(r.violations.map((v) => `${where}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
}

test('an operator finds a customer by phone, sees the masked number, reveals it on purpose; no exports', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  const api = await staff(page, 'OPERATOR')
  await page.goto('/customers')
  await expect(page.getByRole('heading', { name: 'Find a customer' })).toBeVisible()
  await page.getByLabel('Mobile number', { exact: true }).fill('98765 43210')
  await page.getByRole('button', { name: 'Find' }).click()
  await expect(page.getByRole('region', { name: 'Found' })).toContainText('******3210')
  expect(api.calls.find((c) => c.path === '/customers/search')?.body).toEqual({ phone: '98765 43210' }) // the API tidies spaces and +91 itself
  await scan(page, 'search')
  await page.getByRole('region', { name: 'Found' }).getByRole('link', { name: /Asha Rao/ }).click()

  await expect(page.getByRole('heading', { name: 'Asha Rao', level: 1 })).toBeVisible()
  const contact = page.getByRole('region', { name: 'Contact' })
  await expect(contact).toContainText('******3210')
  await expect(contact).not.toContainText('9876543210')
  await expect(page.getByRole('list', { name: 'Summary' })).toContainText('₹4,498.00')
  const orders = page.getByRole('region', { name: /^Orders/ })
  await expect(orders).toContainText('MM/26-27/000042')
  await expect(orders).toContainText('ORD-1050')
  await expect(page.getByRole('region', { name: 'Claims' })).toContainText('ORD-1043')
  await expect(page.getByRole('region', { name: 'Reviews and ratings' })).toContainText('Sweet and ripe on day two.')
  await scan(page, 'profile')
  await noSideScroll(page)
  expect(api.calls.filter((c) => c.path === `/customers/${PROFILE.id}/reveal`)).toHaveLength(0)

  await contact.getByRole('button', { name: 'Show full number and email' }).click()
  await expect(contact).toContainText('asha@example.com')
  await expect(contact.getByRole('link', { name: /9876543210|98765 43210/ })).toBeVisible()
  expect(api.calls.filter((c) => c.method === 'POST' && c.path === `/customers/${PROFILE.id}/reveal`)).toHaveLength(1)

  // Exports are for managers only: no export card for an operator.
  await page.goto('/orders')
  await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Download as CSV' })).toHaveCount(0)
})

test('a manager’s export card checks the range before anything is sent', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await staff(page, 'MANAGER')
  await page.goto('/orders')
  const card = page.getByRole('region', { name: 'Download as CSV' })
  await expect(card).toBeVisible()
  await card.getByLabel('What').selectOption({ label: 'Order lines' })
  await card.getByLabel('From').fill('2026-01-01')
  await card.getByLabel('To').fill('2026-10-01')
  await expect(card.getByRole('button', { name: 'Download Order lines CSV' })).toBeDisabled()
  await expect(card).toContainText('One export covers at most 92 days.')
  await card.getByLabel('From').fill('2026-10-02')
  await expect(card).toContainText('The start date is after the end date.')
  await card.getByLabel('From').fill('2026-09-01')
  await expect(card.getByRole('button', { name: 'Download Order lines CSV' })).toBeEnabled()
  await expect(card.getByLabel('Dates are')).toBeVisible()
  await scan(page, 'export card')
  await noSideScroll(page)
  for (const [path, button] of [['/claims', 'Download Claims CSV'], ['/reviews', 'Download Reviews CSV'], ['/bulk-deals', 'Download Bulk Deals orders CSV'], ['/analytics', 'Download Payments CSV']]) {
    await page.goto(path)
    await expect(page.getByRole('region', { name: 'Download as CSV' }).getByRole('button', { name: button })).toBeVisible()
  }
})

test('a packer has no customer search and no profile link; with the features off nobody does', async ({ page }, info) => {
  await staff(page, 'PACKER')
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Find a customer' })).toHaveCount(0)
  await page.goto('/customers')
  await expect(page.getByRole('heading', { name: 'Find a customer' })).toHaveCount(0)

  const off = await page.context().newPage()
  await staff(off, 'MANAGER', false)
  await off.goto('/orders/o1')
  await expect(off.getByRole('heading', { name: /ORD-1042/ })).toBeVisible()
  await expect(off.getByRole('link', { name: 'Customer profile' })).toHaveCount(0)
  await expect(off.getByRole('region', { name: 'Bill' })).toHaveCount(0)
  await off.goto('/orders')
  await expect(off.getByRole('region', { name: 'Download as CSV' })).toHaveCount(0)
  const nav = off.getByRole('navigation', { name: 'Main' })
  // The Customers group on desktop; the Menu on a phone.
  await (info.project.name === 'phone' ? off.getByRole('button', { name: 'Menu' }) : nav.getByRole('button', { name: 'Customers' })).click()
  await expect(nav.getByRole('link', { name: 'Reviews', exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Find a customer' })).toHaveCount(0)
  await off.close()
})
