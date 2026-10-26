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
