import { expect, test } from './fixtures'
import { mockApi } from './mock-api'

// "Assign nearest riders" on Deliveries (docs/qa/nearest-rider.md): what the panel shows
// after the API has given each stop to its nearest rider, and when it could not.

test('the stop shows who got it and where to collect it; the toast says how far the rider was', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  api.riders = [{ id: 'adm9', email: 'ravi@mandimangoes.test', name: 'Ravi Kumar' }]
  await page.goto('/deliveries?date=2026-10-16')
  await page.getByRole('button', { name: 'Assign nearest riders' }).click()
  await expect(page.getByText('2 stops given to the nearest riders')).toBeVisible()
  expect(api.calls.find((c) => c.path === '/manifest/auto-assign')?.body).toEqual({ date: '2026-10-16' })
  // After the refresh each stop's picker shows the rider by name, not by email.
  const stop = page.getByRole('list', { name: 'Morning · 07:00–11:00, 400001' })
  await expect(stop.getByLabel('Rider for ORD-1042')).toHaveValue('adm9')
  await expect(stop.getByLabel('Rider for ORD-1042').locator('option[value="adm9"]')).toHaveText('Ravi Kumar')
  // A second press has nothing left to give.
  await page.getByRole('button', { name: 'Assign nearest riders' }).click()
  await expect(page.getByText('Every stop already has a rider')).toBeVisible()
})

test('one stop: the toast names the rider, the distance and the pickup', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  api.riders = [{ id: 'adm9', email: 'ravi@mandimangoes.test', name: 'Ravi Kumar' }]
  const [run] = api.manifest.runs
  run.stops[0].orders.splice(1)
  await page.goto('/deliveries?date=2026-10-16')
  await page.getByRole('button', { name: 'Assign nearest riders' }).click()
  await expect(page.getByText('ORD-1042 given to Ravi Kumar (1.2 km away), pick up at Electronic City hub')).toBeVisible()
})

test('with no riders on Staff the panel says so instead of "every stop already has a rider"', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  api.riders = []
  await page.goto('/deliveries?date=2026-10-16')
  await page.getByRole('button', { name: 'Assign nearest riders' }).click()
  await expect(page.getByText('There are no riders yet: add one on Staff, with the role Rider')).toBeVisible()
  await expect(page.getByText('Every stop already has a rider')).toHaveCount(0)
})
