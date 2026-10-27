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
    stuckRefunds: [
      { type: 'order', id: 'o2', number: 'ORD-1043', requestedAt: '2026-10-15T03:00:00Z', paymentId: null, state: 'held', dispute: { id: 'disp_9', status: 'open' } },
    ],
    lateArrivals: [{ id: 'b1', variety: 'Alphonso', farm: 'Ratnagiri', etaDate: '2026-10-13', promised: 4, sellingPaused: true }],
    preorderCapacityDrift: [{ sku: 'ALP-3', weekStart: '2027-03-01', reserved: 0, booked: 2 }],
  }
  await page.goto('/')
  const refunds = card(page).locator('.attention-group', { hasText: 'Refunds not sent' })
  await expect(refunds).toContainText('Refund held')
  await expect(refunds).toContainText('opened chargeback disp_9')
  await expect(refunds).toContainText('Answer it in the Razorpay dashboard')
  // While the bank has not decided there is nothing to settle (the API refuses it too).
  await expect(refunds.getByRole('button', { name: 'Paid back another way for ORD-1043' })).toHaveCount(0)

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

test('Needs attention: a refund held by a lost chargeback is settled with the dispute id', async ({ page }) => {
  const state = await mockApi(page, { signedIn: true })
  state.attention = {
    ...state.attention,
    stuckRefunds: [
      { type: 'order', id: 'o2', number: 'ORD-1043', requestedAt: '2026-10-15T03:00:00Z', paymentId: null, state: 'held', dispute: { id: 'disp_9', status: 'lost' } },
    ],
  }
  await page.goto('/')
  const refunds = card(page).locator('.attention-group', { hasText: 'Refunds not sent' })
  await expect(refunds).toContainText('chargeback disp_9 was lost')
  await expect(refunds).toContainText('with the dispute id as the reference')
  await refunds.getByRole('button', { name: 'Paid back another way for ORD-1043' }).click()
  const dialog = page.getByRole('dialog', { name: 'Paid back by the bank: ORD-1043' })
  await expect(dialog.getByLabel('Dispute id')).toHaveValue('disp_9')
  await expect(dialog).not.toContainText('UTR')
  await dialog.getByLabel('What you checked').fill('Razorpay shows the chargeback lost on 14 Oct')
  await dialog.getByRole('button', { name: 'Record as paid back' }).click()
  await expect
    .poll(() => state.calls.filter((c) => c.path === '/refunds/o2/paid-another-way').map((c) => c.body))
    .toEqual([{ type: 'order', reference: 'disp_9', reason: 'Razorpay shows the chargeback lost on 14 Oct' }])
  await expect(dialog).toBeHidden()
})

test('Order page: an operator sees a free replacement\'s cancel as manager-only when the API says so', async ({ page }) => {
  const state = await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  // A free replacement: no payment of its own (as the API sends it), its cancel kept for a manager.
  Object.assign(state.order, { status: 'CONFIRMED', payment: { status: null, method: 'REPLACEMENT', amount: null }, cancelNeedsManager: true })
  await page.goto('/orders/o1')
  const cancel = page.getByRole('button', { name: /^Cancel order/ })
  await expect(cancel).toBeDisabled()
  await expect(page.getByText('Cancelling a replacement: requires manager role.')).toBeVisible()
  // Without the API's word (the rule switched off) it stays an ordinary cancel.
  Object.assign(state.order, { cancelNeedsManager: false })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Cancel order' })).toBeEnabled()
})

test('Needs attention: a manager recounts a drifted preorder week from its bookings', async ({ page }) => {
  const state = await mockApi(page, { signedIn: true })
  state.attention = { ...state.attention, preorderCapacityDrift: [{ sku: 'ALP-3', weekStart: '2027-03-01', reserved: 4, booked: 2 }] }
  await page.goto('/')
  const stock = card(page).locator('.attention-group', { hasText: 'Stock counts to check' })
  await stock.getByRole('button', { name: /^Recount from the bookings for ALP-3/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Recount preorder capacity for ALP-3?' })
  await expect(dialog).toContainText('taken 4, the bookings hold 2. After the recount, taken is 2.')
  await dialog.getByLabel('What you checked').fill('the four bookings on the Preorders page')
  await dialog.getByRole('button', { name: 'Recount' }).click()
  await expect
    .poll(() => state.calls.find((c) => c.path === '/preorder-capacity/2027-03-01/ALP-3/recount')?.body)
    .toEqual({ reserved: 4, booked: 2, reason: 'the four bookings on the Preorders page' })
  await expect(page.getByText('Preorder capacity for ALP-3 recounted')).toBeVisible()
})

test('Needs attention: an operator sees preorder drift but no recount button', async ({ page }) => {
  const state = await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  state.attention = { ...state.attention, preorderCapacityDrift: [{ sku: 'ALP-3', weekStart: '2027-03-01', reserved: 4, booked: 2 }] }
  await page.goto('/')
  await expect(card(page)).toContainText('Preorder capacity disagrees with the bookings')
  await expect(card(page).getByRole('button', { name: /Recount/ })).toHaveCount(0)
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
