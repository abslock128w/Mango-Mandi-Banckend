import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './fixtures'
import { mockApi } from './mock-api'

// 24 Oct 2026 audit: Needs attention lists messages dropped unsent (INT-06, OPS_ALERTS)
// and missed deliveries whose retry has no day (PLT-08, PLT-09, DELIVERY_CHECKS).

test('a message dropped after a day is "never sent", says why, and can be sent again', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  api.attention = {
    ...api.attention,
    failedMessages: [
      { id: 'ntf9', kind: 'ORDER_CONFIRMED', status: 'SKIPPED', phone: '9876••••10', error: 'older than a day', attempts: 0, createdAt: '2026-10-14T03:00:00Z', order: { id: 'o1', number: 'ORD-1042' }, preorderNumber: null },
      { id: 'ntf8', kind: 'OUT_FOR_DELIVERY', status: 'FAILED', phone: '9876••••11', error: 'WhatsApp 400: template paused', attempts: 6, createdAt: '2026-10-15T03:00:00Z', order: { id: 'o2', number: 'ORD-1043' }, preorderNumber: null },
    ],
  }
  await page.goto('/today')
  const card = page.getByRole('region', { name: 'Needs attention' })
  const dropped = card.getByRole('listitem').filter({ hasText: 'ORD-1042' })
  await expect(dropped).toContainText('WhatsApp message never sent')
  await expect(dropped).toContainText('it waited over a day, so the background run was not sending')
  await expect(dropped).not.toContainText('after 0 tries')
  const failed = card.getByRole('listitem').filter({ hasText: 'ORD-1043' })
  await expect(failed).toContainText('WhatsApp message not delivered')
  await expect(failed).toContainText('after 6 tries')
  await dropped.getByRole('button', { name: 'Send again for ORD-1042' }).click()
  await expect(page.getByText('Message queued to send again')).toBeVisible()
  expect(api.calls.some((c) => c.method === 'POST' && c.path === '/notifications/ntf9/retry')).toBe(true)
})

test('a retry with no delivery day says so, apart from one that cannot go out as packed', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const api = await mockApi(page, { signedIn: true })
  api.attention = {
    ...api.attention,
    retryDecisions: [
      { id: 'o1', number: 'ORD-1042', deliveryDate: '2026-10-17', kind: 'day', reason: 'retry needs a day: no day in the next two weeks has room, so it is on 2026-10-17 over capacity: move it to a day with room' },
      { id: 'o2', number: 'ORD-1043', deliveryDate: '2026-10-17', kind: 'stock', reason: '1× ALP-3 RIPE is too old for 2026-10-17' },
    ],
  }
  await page.goto('/today')
  const card = page.getByRole('region', { name: 'Needs attention' })
  const noDay = card.getByRole('listitem').filter({ hasText: 'ORD-1042' })
  await expect(noDay).toContainText('Retry has no delivery day')
  await expect(noDay).toContainText('Move it to a day with room')
  await expect(noDay.getByRole('link', { name: 'ORD-1042' })).toHaveAttribute('href', '/orders/o1')
  await expect(card.getByRole('listitem').filter({ hasText: 'ORD-1043' })).toContainText("Retry can't go out as packed")
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
})

// SEC-06, PLT-07 (DELIVERY_CHECKS): the API refuses "out for delivery" before the order's day with
// 409 NOT_DUE_YET; a manager can still send it early from the order page, saying why.
test('a manager sends an order out before its day with a reason; the refusal opens the override', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const api = await mockApi(page, { signedIn: true })
  api.order = { ...api.order, status: 'SHIPPED', deliveryDate: '2026-10-17' }
  await page.route('**/admin/v1/orders/o1/status', async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as { override?: boolean }
    if (body.override) return route.fallback()
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_DUE_YET', message: 'Order ORD-1042 is for 2026-10-17. It goes out on that day; a manager can send it early from the order page, saying why.', requestId: 'req_1' } }),
    })
  })
  await page.goto('/orders/o1')
  await page.getByRole('button', { name: 'Out for delivery' }).click()
  const dialog = page.getByRole('dialog', { name: 'Send ORD-1042 out anyway?' })
  await expect(dialog).toContainText('It goes out on that day')
  await dialog.getByLabel('Reason').fill('Customer asked for it tonight')
  await dialog.getByRole('button', { name: 'Send it anyway' }).click()
  await expect(dialog).toHaveCount(0)
  expect(api.calls.find((c) => c.path === '/orders/o1/status')?.body).toEqual({ status: 'OUT_FOR_DELIVERY', override: true, reason: 'Customer asked for it tonight' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
})

// PLT-08, PLT-09 (DELIVERY_CHECKS): a missed delivery's retry can be moved to a day with room.
test('a missed delivery offers Move retry date where the API allows it, and sends the new day', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const api = await mockApi(page, { signedIn: true })
  api.order = { ...api.order, status: 'DELIVERY_FAILED', deliveryDate: '2026-10-16', retryDateMovable: true }
  await page.goto('/orders/o1')
  await page.getByRole('button', { name: 'Move retry date' }).click()
  const dialog = page.getByRole('dialog', { name: 'Move the retry for ORD-1042' })
  await expect(dialog).toContainText('The packed boxes stay with the order')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.map((v) => v.id)).toEqual([])
  await dialog.getByLabel('Retry on').fill('2099-01-05')
  await dialog.getByRole('button', { name: 'Move order' }).click()
  await expect(dialog).toHaveCount(0)
  expect(api.calls.find((c) => c.path === '/orders/o1/reschedule')?.body).toEqual({ deliveryDate: '2099-01-05', slotId: 'slt1' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
})

test('without the API flag a missed delivery offers no move', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  api.order = { ...api.order, status: 'DELIVERY_FAILED', retryDateMovable: false }
  await page.goto('/orders/o1')
  await expect(page.getByRole('button', { name: 'Retry delivery' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Move (retry|delivery) date$/ })).toHaveCount(0)
})
