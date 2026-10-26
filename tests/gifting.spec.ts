import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { mockApi } from './mock-api'
import type { GiftOrderListItem, Role } from '../src/types'

// Gift orders to many recipients on the panel's Orders page (MULTI_GIFT,
// docs/gifting.md), against the mock API: the Gift orders view only while the
// switch is on, each gift order with its deliveries, search, and the way back
// from a delivery to its gift order. The API's own checks (who may read gift
// orders, 404 while off) are in mango-api/test/gifting.test.js.

const EMAIL: Record<Role, string> = { MANAGER: 'manager@mandimangoes.test', OPERATOR: 'ops@mandimangoes.test', PACKER: 'packer@mandimangoes.test', QC: 'qc@mandimangoes.test', RIDER: 'rider@mandimangoes.test' }

const GIFT: GiftOrderListItem = {
  id: 'gft1',
  number: 'GFT-1001',
  status: 'PAID',
  paymentStatus: 'SUCCEEDED',
  customerName: 'Asha Rao',
  deliveryDate: '2026-10-16',
  placedAt: '2026-10-14T06:00:00Z',
  paidAt: '2026-10-14T06:02:00Z',
  recipientCount: 2,
  boxes: 3,
  subtotal: 389700,
  discount: 20000,
  promoCode: 'DIWALI',
  total: 369700,
  business: { name: 'Rao Fruit Mart', gstin: '29ABCDE1234F1ZW' },
  children: [
    {
      id: 'o1', number: 'ORD-1042', position: 1, status: 'PROCESSING', deliveryDate: '2026-10-16', pincode: '560038', recipientName: 'Ravi Kumar', total: 246467,
      box: { sku: 'ALP-3', name: 'Alphonso 3kg Box', stage: 'RIPE', qty: 2 }, refund: null,
    },
    {
      id: 'o7', number: 'ORD-1047', position: 2, status: 'CANCELLED', deliveryDate: '2026-10-16', pincode: '560001', recipientName: 'Meera Iyer', total: 123233,
      box: { sku: 'ALP-3', name: 'Alphonso 3kg Box', stage: 'SEMI_RIPE', qty: 1 }, refund: { requestedAt: '2026-10-14T07:00:00Z', refundedAt: null },
    },
  ],
}

/** /auth/me with the switch on or off (the shared mock leaves features out, as an older API does). */
async function giftSwitch(page: Page, role: Role, on: boolean) {
  await page.route('**/admin/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: EMAIL[role], role, twoStep: { enabled: false, required: false }, features: { bills: true, multiGift: on } }),
    }),
  )
}

/** GET /gift-orders, recording each search it was asked for. */
async function giftList(page: Page) {
  const asked: string[] = []
  await page.route(/\/admin\/v1\/gift-orders(\?|$)/, (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? ''
    asked.push(q)
    const items = q && !/^(GFT-1001|ORD-1047|meera)/i.test(q) ? [] : [GIFT]
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ page: 1, pageSize: 25, total: items.length, items }) })
  })
  return asked
}

const scan = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

test('while MULTI_GIFT is off there is no Gift orders view, even by its link', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await giftSwitch(page, 'OPERATOR', false)
  const asked = await giftList(page)
  await page.goto('/orders?view=gifts')
  await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: /ORD-1042/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Gift orders' })).toHaveCount(0)
  expect(asked).toEqual([])
})

test('an operator sees each gift order with its deliveries, searches, and goes to one delivery and back', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await giftSwitch(page, 'OPERATOR', true)
  const asked = await giftList(page)
  // A delivery of the gift order is also in the plain order list, marked as one.
  Object.assign(api.orders.items[0], { giftOrderId: 'gft1' })
  await page.goto('/orders')

  await expect(page.getByRole('button', { name: 'All orders' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('row', { name: /ORD-1042/ })).toContainText('Gift delivery')
  await page.getByRole('button', { name: 'Gift orders' }).click()
  await expect(page).toHaveURL(/view=gifts/)
  await expect(page.getByRole('button', { name: 'Gift orders' })).toHaveAttribute('aria-pressed', 'true')

  const gift = page.getByRole('region', { name: 'GFT-1001', exact: true })
  await expect(gift).toContainText('Paid')
  await expect(gift).toContainText('Asha Rao · 2 recipients, 3 boxes · ₹3,697.00 in one payment (promo DIWALI, −₹200.00)')
  await expect(gift).toContainText('One bill to Rao Fruit Mart, GSTIN 29ABCDE1234F1ZW')
  const rows = gift.getByRole('row')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(1)).toContainText('Ravi Kumar')
  await expect(rows.nth(1)).toContainText('2 × Alphonso 3kg Box, Ripe')
  await expect(rows.nth(1)).toContainText('Processing')
  await expect(rows.nth(2)).toContainText('Meera Iyer')
  await expect(rows.nth(2)).toContainText('Cancelled')
  await expect(rows.nth(2)).toContainText('Refund on its way')
  // The order filters do not apply to gift orders, so they are not shown.
  await expect(page.getByLabel('Placed from')).toHaveCount(0)

  await page.getByLabel('Search by gift order or delivery number, buyer or recipient name').fill('nobody')
  await expect(page.getByText('No gift orders match this search.')).toBeVisible()
  expect(asked).toContain('nobody')
  await page.getByLabel('Search by gift order or delivery number, buyer or recipient name').fill('meera')
  await expect(gift).toBeVisible()

  // A delivery opens as an ordinary order, which says which gift order it belongs to.
  Object.assign(api.order, { giftOrder: { id: 'gft1', number: 'GFT-1001', position: 1, recipients: 2 } })
  await gift.getByRole('link', { name: /ORD-1042/ }).click()
  await expect(page).toHaveURL(/\/orders\/o1$/)
  const notice = page.getByRole('status').filter({ hasText: 'Recipient 1 of 2 in gift order GFT-1001' })
  await expect(notice).toContainText('one payment and one bill for the whole gift order')
  await notice.getByRole('link', { name: 'GFT-1001' }).click()
  await expect(page).toHaveURL(/view=gifts&q=GFT-1001/)
  await expect(page.getByRole('region', { name: 'GFT-1001', exact: true })).toBeVisible()
  expect(asked.at(-1)).toBe('GFT-1001')
})

test('the Gift orders view at phone width passes the accessibility scan', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 })
  await mockApi(page, { signedIn: true, role: 'MANAGER' })
  await giftSwitch(page, 'MANAGER', true)
  await giftList(page)
  await page.goto('/orders?view=gifts')
  await expect(page.getByRole('region', { name: 'GFT-1001', exact: true })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await scan(page)
})
