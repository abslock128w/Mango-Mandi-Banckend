import { expect, test } from './fixtures'

// The §10 acceptance script against a real, seeded mango-api.
// Skips unless E2E_EMAIL / E2E_PASSWORD are set. Not run in CI.

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

test.skip(!email || !password, 'Set E2E_EMAIL and E2E_PASSWORD and run mango-api to enable')

test('a day in the life of the warehouse', async ({ page }) => {
  // 1. Sign in; a reload keeps the session.
  await page.goto('/login')
  await page.getByLabel('Work email').fill(email!)
  await page.getByLabel('Password').fill(password!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()

  // 2. Receive an Alphonso batch; it shows "No QC" until QC is logged.
  await page.getByRole('link', { name: 'Batches' }).click()
  await page.getByRole('button', { name: 'Receive batch' }).click()
  const dialog = page.getByRole('dialog', { name: 'Receive batch' })
  await dialog.getByLabel('Variety').selectOption('Alphonso')
  await dialog.getByRole('spinbutton').first().fill('10')
  await dialog.getByRole('button', { name: 'Receive batch' }).click()
  await expect(page).toHaveURL(/\/batches\/[^/?]+\?focusQC=1/)
  const batchUrl = page.url().split('?')[0]
  await page.getByRole('link', { name: 'Batches' }).click()
  await expect(page.getByText('No QC: not sellable yet').first()).toBeVisible()

  // 3. Advance the batch to Selling and log QC Ripe/Good.
  await page.goto(batchUrl)
  await page.getByRole('button', { name: 'Skip to Selling' }).click()
  await expect(page.getByText('Batch moved to Selling')).toBeVisible()
  await page.getByLabel('Ripe', { exact: true }).check()
  await page.getByLabel('Good').check()
  await page.getByRole('button', { name: 'Log QC' }).click()
  await expect(page.getByText('QC logged')).toBeVisible()

  // Steps 4–12 (customer checkout → payment → allocate → pack → ship →
  // deliver → claim) need a customer-side seeding helper; see the PRD §10.
  test.info().annotations.push({ type: 'todo', description: 'Steps 4–12 need a customer seeding helper' })
})
