import { expect, test } from './fixtures'
import { mockApi } from './mock-api'

// Products (manager only): add, rename, remove and put back on sale.

test('a manager adds, renames, removes and restores products', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/products')
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()
  await expect(page.getByRole('row', { name: /Alphonso 3kg Box/ })).toContainText('On sale')
  await expect(page.getByRole('row', { name: /Totapuri 3kg Box/ })).toContainText('Removed')

  await page.getByRole('button', { name: 'Add product' }).click()
  const add = page.getByRole('dialog', { name: 'Add product' })
  await add.getByLabel('SKU').fill('ban-5')
  await add.getByLabel('Name').fill('Banganapalli 5kg Box')
  await add.getByLabel('Variety').fill('Banganapalli')
  await add.getByLabel('Box size').fill('5kg')
  await add.getByRole('button', { name: 'Add product' }).click()
  await expect(add.getByRole('alert')).toContainText('price')
  await add.getByLabel('Price in rupees').fill('1499')
  await add.getByRole('button', { name: 'Add product' }).click()
  await expect(add).toHaveCount(0)
  await expect(page.getByRole('row', { name: /Banganapalli 5kg Box/ })).toContainText('₹1,499.00')
  const post = api.calls.find((c) => c.method === 'POST' && c.path === '/products')
  expect(post?.body).toMatchObject({ sku: 'BAN-5', name: 'Banganapalli 5kg Box', variety: 'Banganapalli', price: 149900, gstRate: 0, hsnCode: '08045020' })

  await page.getByRole('button', { name: 'Edit Alphonso 3kg Box' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit Alphonso 3kg Box' })
  await expect(edit.getByLabel('SKU')).toHaveCount(0)
  await edit.getByLabel('Name').fill('Alphonso Premium 3kg')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('row', { name: /Alphonso Premium 3kg/ })).toBeVisible()
  const patch = api.calls.find((c) => c.method === 'PATCH' && c.path === '/products/ALP-3')?.body
  expect(patch).toMatchObject({ name: 'Alphonso Premium 3kg', price: 189900 })
  expect(patch).not.toHaveProperty('sku')

  await page.getByRole('button', { name: 'Remove Alphonso 5kg Box' }).click()
  await page.getByRole('dialog', { name: 'Remove Alphonso 5kg Box?' }).getByRole('button', { name: 'Remove product' }).click()
  await expect(page.getByRole('row', { name: /Alphonso 5kg Box/ })).toContainText('Removed')

  await page.getByRole('button', { name: 'Remove Kesar 3kg Box' }).click()
  await page.getByRole('dialog', { name: 'Remove Kesar 3kg Box?' }).getByRole('button', { name: 'Remove product' }).click()
  await expect(page.getByRole('row', { name: /Kesar 3kg Box/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Put back on sale Totapuri 3kg Box' }).click()
  await expect(page.getByRole('row', { name: /Totapuri 3kg Box/ })).toContainText('On sale')
  expect(api.calls.find((c) => c.method === 'PATCH' && c.path === '/products/TOT-3')?.body).toEqual({ active: true })
})

test('products are a manager-only screen, and removed products are not offered for new batches', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await page.goto('/today')
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Products' })).toHaveCount(0)
  await page.goto('/products')
  await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible()

  await page.goto('/batches')
  await page.getByRole('button', { name: 'Receive batch' }).click()
  const variety = page.getByLabel('Variety')
  await expect(variety.locator('option', { hasText: 'Kesar' })).toHaveCount(1)
  await expect(variety.locator('option', { hasText: 'Totapuri' })).toHaveCount(0)
})
