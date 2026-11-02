import { expect, test } from './fixtures'
import { mockApi } from './mock-api'

// A rider may open only today's and tomorrow's run (the API answers 403 for other days, SEC-02).
// On an empty day the panel must not ask for later days, nor say they are empty.
test('a rider with an empty day is pointed at tomorrow only, with no refused requests', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'RIDER' })
  const ist = (n: number) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10)
  const asked: string[] = []
  await page.route('**/admin/v1/manifest?*', (route) => {
    const d = new URL(route.request().url()).searchParams.get('date')!
    asked.push(d)
    if (d > ist(1)) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Riders can only open the run for today or tomorrow', requestId: 'r' } }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ date: d, orders: 0, boxes: 0, unassigned: 0, runs: [] }) })
  })
  await page.goto('/deliveries')
  await expect(page.getByText(/^No deliveries on /)).toBeVisible()
  await expect(page.getByText(/^Nothing on .* either\.$/)).toBeVisible()
  await expect(page.getByText(/Nothing in the next \d days/)).toHaveCount(0)
  expect(asked.filter((d) => d > ist(1)), 'no request for a day riders cannot open').toEqual([])
})
