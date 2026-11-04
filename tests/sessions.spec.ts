import { expect, openAccount, test } from './fixtures'
import { mockApi } from './mock-api'

// Two tabs of the panel in one browser (a shared warehouse computer): signing out in one must
// sign out the other, or its access token keeps working for up to 15 minutes.

async function signOut(page: import('@playwright/test').Page) {
  await (await openAccount(page)).getByRole('button', { name: 'Sign out' }).click()
}

test('signing out in one tab signs out the other tabs too', async ({ page, context }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/orders')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const other = await context.newPage()
  await mockApi(other, { signedIn: true })
  await other.goto('/batches')
  await expect(other.getByRole('heading', { level: 1 })).toBeVisible()

  await signOut(page)
  await expect(page).toHaveURL(/\/login$/)
  await expect(other).toHaveURL(/\/login\?reason=elsewhere$/)
  await expect(other.getByRole('status')).toHaveText('You signed out in another tab. Sign in again to carry on.')
  await other.close()
})

test('a tab that is already signed out stays on the sign-in page when another signs out', async ({ page, context }) => {
  await mockApi(page)
  await page.goto('/login')
  const other = await context.newPage()
  await mockApi(other, { signedIn: true })
  await other.goto('/orders')
  await signOut(other)
  await expect(other).toHaveURL(/\/login$/)
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText('You signed out in another tab.')).toHaveCount(0)
  await other.close()
})

test('a lapsed access token is renewed silently and the screen still loads', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  let lapsed = true
  let refreshes = 0
  page.on('request', (r) => {
    if (r.url().endsWith('/admin/v1/auth/refresh')) refreshes++
  })
  await page.route('**/admin/v1/batches**', (route) => {
    if (!lapsed) return route.fallback()
    lapsed = false
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TOKEN_EXPIRED', message: 'expired', requestId: 'r' } }) })
  })
  await page.goto('/today')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const before = refreshes
  await page.goto('/batches')
  await expect(page.getByRole('heading', { name: 'Batches', level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/\/batches$/)
  expect(refreshes - before, 'one refresh, then the request is sent again').toBeGreaterThanOrEqual(1)
})

test('when the session cannot be renewed, the panel says it ended and asks to sign in', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/today')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const refused = { status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INVALID_TOKEN', message: 'no', requestId: 'r' } }) }
  await page.route('**/admin/v1/auth/refresh', (route) => route.fulfill(refused))
  await page.route('**/admin/v1/orders**', (route) => route.fulfill(refused))
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Orders', exact: true }).or(page.getByRole('link', { name: 'Orders', exact: true })).first().click()
  await expect(page).toHaveURL(/\/login\?reason=expired$/)
  await expect(page.getByRole('status')).toHaveText('Your session has ended. Please sign in again.')
})
