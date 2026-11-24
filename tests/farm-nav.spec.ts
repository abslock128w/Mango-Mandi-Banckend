import { expect, mainNav, openNavTo, screenLoaded, test } from './fixtures'
import { mockApi } from './mock-api'

// Farm Experience (docs/farm-experience.md): the Bulk Orders menu group exists only while /auth/me
// says farmExperience is on (src/nav.ts). The farm pages' own behaviour is tested by the API suite.

const FARM_LINKS = ['Farm Experience Bookings', 'Farm check-in', 'Farm calendar', 'Harvest stock', 'Farmhouse rooms', 'Farm settings']

test('off: no farm links, and a farm address is not a page', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/today')
  await screenLoaded(page)
  await openNavTo(page, 'Bulk Deals')
  for (const name of [...FARM_LINKS, 'Farm reports']) await expect(mainNav(page).getByRole('link', { name, exact: true })).toHaveCount(0)
  await page.goto('/farm/bookings')
  await screenLoaded(page)
  await expect(page.getByRole('heading', { name: 'Farm Experience Bookings' })).toHaveCount(0)
})

test('on, manager: Bulk Orders holds Bulk Deals once and every farm page', async ({ page }) => {
  await mockApi(page, { signedIn: true, features: { farmExperience: true } })
  await page.goto('/today')
  await screenLoaded(page)
  for (const name of [...FARM_LINKS, 'Farm reports']) await expect(await openNavTo(page, name)).toBeVisible()
  await expect(mainNav(page).getByRole('link', { name: 'Bulk Deals', exact: true })).toHaveCount(1)
  await (await openNavTo(page, 'Farm Experience Bookings')).click()
  await expect(page).toHaveURL(/\/farm\/bookings$/)
})

test('on, operator: the farm pages without Farm reports or Bulk Deals', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'OPERATOR', features: { farmExperience: true } })
  await page.goto('/today')
  await screenLoaded(page)
  for (const name of FARM_LINKS) await expect(await openNavTo(page, name)).toBeVisible()
  for (const name of ['Farm reports', 'Bulk Deals']) await expect(mainNav(page).getByRole('link', { name, exact: true })).toHaveCount(0)
})
