import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './fixtures'
import { mockApi, type MockState } from './mock-api'

// The rider's route, one stop at a time (LIVE_TRACKING, docs/app-feel.md): stops in route order,
// Start route, Next stop and Delivered with the usual proof, on a phone held in one hand.

type Stop = MockState['manifest']['runs'][number]['stops'][number]
type ManifestOrder = Stop['orders'][number]

/** /auth/me with the switch on (the shared mock leaves features out, as an older API does). */
async function routeSwitch(page: import('@playwright/test').Page, on: boolean) {
  await page.route('**/admin/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: 'rider@mandimangoes.test', role: 'RIDER', twoStep: { enabled: false, required: false }, features: { riderRoute: on } }),
    }),
  )
}

/** A second packed stop, in another pincode after the first. */
function secondStop(api: MockState) {
  const first = api.manifest.runs[0].stops[0].orders[0]
  const order = {
    ...first, id: 'o4', number: 'ORD-1045', customerName: 'Neha Kulkarni', phone: '9876511111', deliveryAddress: '7 Hill Road', status: 'PACKED',
  } as ManifestOrder
  api.manifest.runs[0].stops.push({ pincode: '400050', city: 'Mumbai', zone: 'Bandra', orders: [order] })
  api.manifest.orders = 3
}

const scan = async (page: import('@playwright/test').Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

test('a rider starts the route, moves on, and delivers each stop with the usual proof', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 })
  const api = await mockApi(page, { signedIn: true, role: 'RIDER' })
  await routeSwitch(page, true)
  secondStop(api)
  await page.goto('/deliveries?date=2026-10-16')

  await expect(page.getByRole('button', { name: 'One at a time' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('status', { name: 'Route summary' })).toHaveText('0 of 2 stops done · 1 not packed yet')
  const list = page.getByRole('list').filter({ has: page.getByText('Neha Kulkarni') })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(list.getByRole('listitem').first()).toContainText('Asha Rao')
  await expect(list.getByRole('listitem').nth(1)).toContainText('Neha Kulkarni')
  // Nothing is out yet: no current stop, only Start route.
  await expect(page.getByRole('button', { name: 'Delivered', exact: false })).toHaveCount(0)
  await scan(page)

  await page.getByRole('button', { name: 'Start route' }).click()
  expect(api.calls.find((c) => c.path === '/manifest/dispatch')?.body).toEqual({ date: '2026-10-16' })
  const current = page.getByRole('article')
  await expect(current).toContainText('Stop 1 of 2')
  await expect(current.getByRole('heading', { name: 'Asha Rao (order ORD-1042)' })).toBeVisible()
  await expect(current.getByRole('link', { name: 'Call Asha Rao' })).toHaveAttribute('href', 'tel:+919876543210')
  await expect(list.getByRole('listitem').first()).toHaveAttribute('aria-current', 'step')

  // One-handed: the two main buttons are big and sit at the bottom of the phone's screen.
  const delivered = current.getByRole('button', { name: 'Delivered ORD-1042' })
  const next = current.getByRole('button', { name: 'Next stop' })
  for (const b of [delivered, next]) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(56)
  await scan(page)

  // Nobody answers yet: on to the next stop; this one comes round again.
  await next.click()
  await expect(current).toContainText('Stop 2 of 2')
  await expect(list.getByRole('listitem').first()).toContainText('put off for now')
  await current.getByRole('button', { name: 'Delivered ORD-1045' }).click()
  const dialog = page.getByRole('dialog', { name: 'Deliver ORD-1045' })
  // The proof rules still apply: a wrong code is refused by the API.
  await dialog.getByLabel("Customer's delivery code").fill('1111')
  await dialog.getByRole('button', { name: 'Mark delivered' }).click()
  await expect(dialog.getByRole('alert')).toContainText('That code is not right')
  await dialog.getByLabel("Customer's delivery code").fill('4821')
  await dialog.getByRole('button', { name: 'Mark delivered' }).click()
  await expect(dialog).toHaveCount(0)
  expect(api.calls.filter((c) => c.path === '/orders/o4/delivery').at(-1)?.body).toMatchObject({ outcome: 'DELIVERED', code: '4821', attempt: 1 })

  // Back round to the stop that was put off; it is the last one out, so there is no Next stop to take.
  await expect(current).toContainText('Stop 1 of 2')
  await expect(page.getByRole('status', { name: 'Route summary' })).toHaveText('1 of 2 stops done · 1 not packed yet')
  await expect(current.getByRole('button', { name: 'Next stop' })).toBeDisabled()
  await current.getByRole('button', { name: 'Delivered ORD-1042' }).click()
  await page.getByRole('dialog', { name: 'Deliver ORD-1042' }).getByLabel("Customer's delivery code").fill('4821')
  await page.getByRole('dialog', { name: 'Deliver ORD-1042' }).getByRole('button', { name: 'Mark delivered' }).click()
  await expect(page.getByText('All 2 stops done. Thank you!')).toBeVisible()

  // No sideways scrolling on a 375px phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

  // The full list is a tap away, and keeps the existing view.
  await page.getByRole('button', { name: 'Full list' }).click()
  await expect(page.getByRole('status', { name: 'Run summary' })).toBeVisible()
})

test('with the switch off, or for staff, the Deliveries page is the list as before', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'RIDER' })
  await routeSwitch(page, false)
  await page.goto('/deliveries?date=2026-10-16')
  await expect(page.getByRole('status', { name: 'Run summary' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'One at a time' })).toHaveCount(0)
})

test('managers never get the rider route, even with the switch on', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'MANAGER' })
  await page.route('**/admin/v1/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'manager@mandimangoes.test', role: 'MANAGER', features: { riderRoute: true } }) }),
  )
  await page.goto('/deliveries?date=2026-10-16')
  await expect(page.getByRole('status', { name: 'Run summary' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'One at a time' })).toHaveCount(0)
})
