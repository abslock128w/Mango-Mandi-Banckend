import { expect, test } from './fixtures'
import { mockApi } from './mock-api'

// CR2-07: the delivery address's Landmark is its own field (optional, up to 100 characters), saved with the order and
// shown to the delivery team: on the order page, on the Deliveries run (the current stop and every stop, also when the
// run is printed) and in the Map link's search. Against the mock API (order o1 and its manifest stop carry one).

test('the order page shows the landmark under the address', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/orders/o1')
  const facts = page.locator('dl').filter({ hasText: 'Address' }).first()
  await expect(facts.getByText('Landmark', { exact: true })).toBeVisible()
  await expect(facts.getByText('near Sai Baba temple')).toBeVisible()
})

test('an order without a landmark shows no Landmark row', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  Object.assign(api.order, { deliveryLandmark: null })
  await page.goto('/orders/o1')
  await expect(page.getByText('12 Marine Drive, Mumbai')).toBeVisible()
  await expect(page.getByText('Landmark', { exact: true })).toHaveCount(0)
})

test('the Deliveries run shows the landmark on the stop and puts it in the map search', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/deliveries?date=2026-10-16')
  const stop = page.getByRole('listitem', { name: 'ORD-1042' })
  await expect(stop.getByText('Landmark: opposite the bus stop')).toBeVisible()
  const map = stop.getByRole('link', { name: /Map/ })
  await expect(map).toHaveAttribute('href', /opposite%20the%20bus%20stop/)
  // The printed run keeps it (only the buttons are no-print).
  await page.emulateMedia({ media: 'print' })
  await expect(stop.getByText('Landmark: opposite the bus stop')).toBeVisible()
})
