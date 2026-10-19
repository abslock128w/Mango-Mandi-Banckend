import { expect, test } from './fixtures'
import { mockApi } from './mock-api'

// Quick wins: each box carries a QR label that opens the batch's page in the shop.

test('a batch prints box labels with a QR code for the shop page', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/batches/b1')
  await page.getByRole('link', { name: 'Box labels' }).click()
  await expect(page).toHaveURL(/\/batches\/b1\/labels$/)
  await expect(page.getByRole('heading', { name: /Box labels · Alphonso/ })).toBeVisible()
  const labels = page.getByRole('list', { name: 'Labels to print' }).getByRole('listitem')
  await expect(labels).toHaveCount(30) // one per box on hand
  await expect(labels.first()).toContainText('3f9a1c7e20')
  await expect(labels.first()).toContainText('Picked')
  await expect(page.getByRole('img', { name: 'QR code for http://localhost:5174/t/3f9a1c7e20' })).toBeVisible()
  await page.getByLabel('How many').fill('4')
  await expect(labels).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'Print' })).toBeEnabled()
})
