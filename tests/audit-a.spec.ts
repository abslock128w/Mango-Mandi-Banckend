import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './fixtures'
import { mockApi } from './mock-api'

// 24 Oct 2026 audit leftovers A (docs/audit-2026-10-24-status-A.md): what the
// panel shows for a held refund (PAY-06), a late truck (INV-08) and preorder
// capacity drift (INV-06), and the Receive dialog's Idempotency-Key (INV-02).

const card = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Needs attention' })

test('Needs attention: a held refund, a late truck and preorder drift each say what to do', async ({ page }) => {
  const state = await mockApi(page, { signedIn: true })
  state.attention = {
    ...state.attention,
    stuckRefunds: [{ type: 'order', id: 'o2', number: 'ORD-1043', requestedAt: '2026-10-15T03:00:00Z', paymentId: null, state: 'held' }],
    lateArrivals: [{ id: 'b1', variety: 'Alphonso', farm: 'Ratnagiri', etaDate: '2026-10-13', promised: 4, sellingPaused: true }],
    preorderCapacityDrift: [{ sku: 'ALP-3', weekStart: '2027-03-01', reserved: 0, booked: 2 }],
  }
  await page.goto('/')
  const refunds = card(page).locator('.attention-group', { hasText: 'Refunds not sent' })
  await expect(refunds).toContainText('Refund held')
  await expect(refunds).toContainText('the payment has a chargeback')
  // A manager can still settle it once the bank has paid the customer.
  await expect(refunds.getByRole('button', { name: 'Paid back another way for ORD-1043' })).toBeVisible()

  const stock = card(page).locator('.attention-group', { hasText: 'Stock counts to check' })
  await expect(stock).toContainText('Batch still in transit')
  await expect(stock).toContainText('4 boxes already promised to orders')
  await expect(stock).toContainText('Until then it does not sell to new orders.')
  await expect(stock.getByRole('link', { name: 'Alphonso from Ratnagiri' })).toHaveAttribute('href', '/batches/b1')
  await expect(stock).toContainText('Preorder capacity disagrees with the bookings')
  await expect(stock).toContainText('(taken 0, booked 2)')

  const axe = await new AxeBuilder({ page }).include('section.attention').withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
})

test('Receive batch: a retry of the same intake sends the same Idempotency-Key; a changed intake a new one', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  const keys: string[] = []
  await page.route('**/admin/v1/batches', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    // The first two answers are refusals the staff member retries after; the third goes through.
    if (keys.length <= 2) {
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'BUSY', message: 'Busy, try again', requestId: 'req_a' } }),
      })
    }
    return route.fallback()
  })
  await page.goto('/batches')
  await page.getByRole('button', { name: 'Receive batch' }).click()
  const dialog = page.getByRole('dialog', { name: 'Receive batch' })
  const qty = dialog.getByLabel(/Alphonso 3kg Box/)
  const submit = dialog.getByRole('button', { name: 'Receive batch' })
  await qty.fill('20')
  await submit.click()
  await expect(dialog).toContainText('Busy, try again')
  await expect.poll(() => keys.length).toBe(1)
  await submit.click() // the same intake again
  await expect.poll(() => keys.length).toBe(2)
  await qty.fill('21') // a different intake
  await submit.click()
  await expect(page).toHaveURL(/\/batches\/b-new\?focusQC=1/)
  expect(keys).toHaveLength(3)
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/)
  expect(keys[1]).toBe(keys[0])
  expect(keys[2]).not.toBe(keys[0])
})
