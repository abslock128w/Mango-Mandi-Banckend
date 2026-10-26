import { expect, test } from './fixtures'
import { mockApi } from './mock-api'

// Growth (docs/growth.md), managers only: the Referrals view on Promos, the shop funnel on
// Analytics, and the evening WhatsApp summary (Staff page setting, Today preview).

const ALL_ON = { referrals: true, funnelAnalytics: true, managerDailySummary: true }

test('a manager sees referrals on the Promos page and filters them', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, features: ALL_ON })
  await page.goto('/promos')
  const section = page.getByRole('region', { name: 'Refer a friend' })
  await expect(section.getByTestId('referral-rules')).toContainText('₹499.00 or more')
  await expect(section.getByTestId('referral-rules')).toContainText('at most 10 a month')
  await expect(section.getByLabel('Referral counts')).toContainText('1 waiting · 1 rewarded · 1 without a reward')

  const rewarded = section.getByRole('row', { name: /Kavya Rao/ })
  await expect(rewarded).toContainText('Rewarded')
  await expect(rewarded).toContainText('Friend: TYAB12CD34 ₹100.00 · not used')
  await expect(rewarded).toContainText('Referrer: TYEF56GH78 ₹100.00 · used')
  await expect(rewarded.getByRole('link', { name: 'ORD-1044' })).toHaveAttribute('href', '/orders/o1')
  // Masked phones only.
  await expect(rewarded).toContainText('+919000••••01')
  await expect(section.getByRole('row', { name: /Arjun Shah/ })).toContainText('The first order was cancelled')

  await section.getByLabel('Show').selectOption('PENDING')
  await expect(section.getByRole('row', { name: /Kavya Rao/ })).toHaveCount(0)
  await expect(section.getByRole('row', { name: /Ravi Kumar/ })).toContainText('Waiting for delivery')
  expect(api.calls.some((c) => c.path === '/referrals' && c.method === 'GET')).toBe(true)
})

test('with the switches off nothing growth-related shows', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, features: { referrals: false, funnelAnalytics: false, managerDailySummary: false } })
  await page.goto('/promos')
  await expect(page.getByRole('heading', { name: 'Promo codes' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Refer a friend' })).toHaveCount(0)
  await page.goto('/analytics')
  await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Shop funnel' })).toHaveCount(0)
  await page.goto('/staff')
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'My evening summary' })).toHaveCount(0)
  await page.goto('/today')
  await expect(page.getByText(/Last updated/)).toBeVisible()
  await expect(page.getByRole('button', { name: "Preview today's summary" })).toHaveCount(0)
  expect(api.calls.filter((c) => ['/referrals', '/analytics/funnel', '/me/daily-summary', '/daily-summary/preview'].includes(c.path))).toEqual([])
})

test('an operator sees Analytics without the funnel and Today without the preview', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, role: 'OPERATOR', features: ALL_ON })
  await page.goto('/analytics')
  await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Shop funnel' })).toHaveCount(0)
  await page.goto('/today')
  await expect(page.getByText(/Last updated/)).toBeVisible()
  await expect(page.getByRole('button', { name: "Preview today's summary" })).toHaveCount(0)
  expect(api.calls.some((c) => c.path === '/analytics/funnel' || c.path === '/daily-summary/preview')).toBe(false)
})

test('a manager reads the shop funnel by day and changes the range', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, features: ALL_ON })
  await page.goto('/analytics')
  const section = page.getByRole('region', { name: 'Shop funnel' })
  const bars = section.getByRole('list', { name: 'Funnel for the whole range' })
  await expect(bars.getByRole('listitem').first()).toContainText('150 browsers')
  await expect(bars.getByRole('listitem').last()).toContainText('7 4.7% of visits')
  await expect(bars.getByRole('listitem').last()).toContainText('50% of the step before')
  const day = section.getByRole('row', { name: /15 Oct/ })
  await expect(day).toContainText('100')
  await expect(day).toContainText('5 (5%)')

  await section.getByLabel('From').fill('2026-10-16')
  await expect(section.getByRole('row', { name: /15 Oct/ })).toHaveCount(0)
  await expect(section.getByRole('row', { name: /16 Oct/ })).toBeVisible()
  expect(api.calls.some((c) => c.path === '/analytics/funnel')).toBe(true)
  await expect(page).toHaveURL(/funnelFrom=2026-10-16/)
})

test('a manager turns on the evening summary and previews it on Today', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, features: ALL_ON })
  await page.goto('/staff')
  const card = page.getByRole('region', { name: 'My evening summary' })
  await expect(card.getByTestId('summary-state')).toHaveText('Off')
  // Opting in without a number: the server's refusal is shown.
  await card.getByRole('button', { name: 'Send me the summary' }).click()
  await expect(card.getByRole('alert')).toContainText('Enter the WhatsApp number')
  await card.getByLabel('WhatsApp number').fill('98765 43210')
  await card.getByRole('button', { name: 'Send me the summary' }).click()
  await expect(card.getByTestId('summary-state')).toHaveText('On, to +919876••••10')
  const put = api.calls.filter((c) => c.method === 'PUT' && c.path === '/me/daily-summary').at(-1)
  expect(put?.body).toEqual({ optedIn: true, phone: '98765 43210' })
  await expect(page.getByRole('row', { name: /manager@/ })).toContainText('On')

  await page.goto('/today')
  await page.getByRole('button', { name: "Preview today's summary" }).click()
  const dialog = page.getByRole('dialog', { name: "Today's summary" })
  await expect(dialog.getByTestId('summary-text')).toContainText('Orders: 12 (₹10,800)')
  await expect(dialog.getByTestId('summary-text')).toContainText('Needs attention: 3')
  await expect(dialog).toContainText('to 1 manager who turned it on')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)

  await page.goto('/staff')
  await page.getByRole('region', { name: 'My evening summary' }).getByRole('button', { name: 'Stop sending' }).click()
  await expect(page.getByTestId('summary-state')).toContainText('Off')
  expect(api.calls.filter((c) => c.method === 'PUT' && c.path === '/me/daily-summary').at(-1)?.body).toEqual({ optedIn: false })
})
