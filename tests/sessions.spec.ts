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
