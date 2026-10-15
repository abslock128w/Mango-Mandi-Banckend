import { expect, test } from './fixtures'
import { mockApi } from './mock-api'

// Backend-free walk through every screen against the mocked API.

test('Today shows tiles, aging batches and low stock', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/today')
  await expect(page.getByRole('link', { name: /3\s*Confirmed/ })).toHaveAttribute('href', '/orders?status=CONFIRMED')
  await expect(page.getByRole('link', { name: /2\s*Open claims/ })).toBeVisible()
  await expect(page.getByText(/Last updated \d\d:\d\d IST/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Alphonso batch, 7 days old/ })).toBeVisible()
  await expect(page.getByText('Alphonso 5kg Box')).toBeVisible()
})

test('Batches lists batches, flags missing QC, and filters by status in the URL', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/batches')
  await expect(page.getByText('No QC: not sellable yet')).toBeVisible()
  await page.getByRole('button', { name: 'Selling', exact: true }).click()
  await expect(page).toHaveURL(/status=SELLING/)
})

test('Receive batch posts the SKU quantities and opens the new batch', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/batches')
  await page.getByRole('button', { name: 'Receive batch' }).click()
  const dialog = page.getByRole('dialog', { name: 'Receive batch' })
  await dialog.getByLabel(/Alphonso 3kg Box/).fill('20')
  await dialog.getByRole('button', { name: 'Receive batch' }).click()
  await expect(page).toHaveURL(/\/batches\/b-new\?focusQC=1/)
  const post = api.calls.find((c) => c.method === 'POST' && c.path === '/batches')
  expect(post?.body).toMatchObject({ variety: 'Alphonso', lines: [{ sku: 'ALP-3', onHand: 20 }] })
})

test('Batch detail: stock, QC warning, ledger and manager condemn', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/batches/b1')
  await expect(page.getByRole('heading', { name: 'Stock' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Move to Exhausted' })).toBeVisible()

  await page.getByLabel('Ripe', { exact: true }).check()
  await page.getByLabel('Good').check()
  await page.getByRole('button', { name: 'Log QC' }).click()
  await expect(page.getByText(/QC already logged today/)).toBeVisible()
  expect(api.calls.find((c) => c.path === '/batches/b1/qc')?.body).toMatchObject({ ripenessRating: 'RIPE', condition: 'GOOD' })

  await page.getByRole('tab', { name: 'Ledger' }).click()
  await expect(page.getByText('+20')).toBeVisible()

  await page.getByRole('button', { name: 'Condemn batch' }).click()
  await page.getByRole('button', { name: 'Condemn and cancel orders' }).click()
  await expect(page.getByRole('dialog', { name: 'Batch condemned' })).toContainText('ORD-1042')
})

test('Operators see condemn disabled with the manager hint', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await page.goto('/batches/b1')
  const condemn = page.getByRole('button', { name: /Condemn batch/ })
  await expect(condemn).toBeDisabled()
  await expect(condemn).toHaveAttribute('title', 'Requires manager role')
})

test('Adjust stock requires a reason', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/batches/b1')
  await page.getByRole('button', { name: 'Adjust ALP-3' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('On hand').fill('18')
  await dialog.getByRole('button', { name: 'Save adjustment' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('A reason is required.')
  await dialog.getByLabel('Reason').fill('2 crushed')
  await dialog.getByRole('button', { name: 'Save adjustment' }).click()
  await expect(dialog).toHaveCount(0)
  expect(api.calls.find((c) => c.method === 'PATCH' && c.path === '/batches/b1/lines/l1')?.body).toEqual({ onHand: 18, reason: '2 crushed' })
})

test('Orders list filters and opens a detail page', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/orders')
  await expect(page.getByText('2 orders · page 1 of 1')).toBeVisible()
  await page.getByLabel('Search order number or phone').fill('ORD-1042')
  await expect(page).toHaveURL(/q=ORD-1042/)
  await page.getByRole('button', { name: 'Open order ORD-1042' }).click()
  await expect(page).toHaveURL(/\/orders\/o1$/)
})

test('Order detail: mark packed waits for allocation; cancel needs a reason', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/orders/o1')
  await expect(page.getByRole('button', { name: 'Mark packed (allocate first)' })).toBeDisabled()
  await page.getByRole('button', { name: 'Allocate and pack' }).click()
  await expect.poll(() => api.calls.some((c) => c.path === '/orders/o1/allocate')).toBe(true)

  await page.getByRole('button', { name: 'Cancel order' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Stock held for this order will be released.')
  await expect(dialog).not.toContainText(/refund/i)
  const confirm = dialog.getByRole('button', { name: 'Cancel order' })
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel('Reason').fill('Customer asked')
  await confirm.click()
  await expect.poll(() => api.calls.find((c) => c.path === '/orders/o1/cancel')?.body).toEqual({ reason: 'Customer asked' })
})

test('Orders never offer a refund', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/orders/o2')
  await expect(page.getByRole('heading', { name: 'Order ORD-1043' })).toBeVisible()
  await expect(page.getByRole('button', { name: /refund/i })).toHaveCount(0)
})

test('Pack list: by order with allocate shortcut, by batch with unallocated section', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/pack-list?date=2026-10-16')
  await expect(page.getByRole('link', { name: 'ORD-1042' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Allocate and pack ORD-1042' })).toBeVisible()
  await page.getByRole('button', { name: 'By batch' }).click()
  await expect(page).toHaveURL(/view=batch/)
  await expect(page.getByRole('heading', { name: 'Not allocated yet' })).toBeVisible()
})

test('Claims: start review and resolve as replacement', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/claims')
  await page.getByRole('button', { name: 'Start review for ORD-1043' }).click()
  await expect.poll(() => api.calls.some((c) => c.path === '/claims/c1/review')).toBe(true)
  await page.getByRole('button', { name: 'Resolve ORD-1043' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/refund/i)).toHaveCount(0)
  await dialog.getByLabel(/Replacement/).check()
  await dialog.getByRole('button', { name: 'Approve replacement' }).click()
  await expect.poll(() => api.calls.find((c) => c.path === '/claims/c2/resolve')?.body).toEqual({ resolution: 'REPLACEMENT_APPROVED' })
})

test('Pincodes: add validates six digits; operators cannot delete', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await page.goto('/pincodes')
  await expect(page.getByRole('button', { name: 'Delete 400001' })).toBeDisabled()
  await page.getByRole('button', { name: 'Add pincode' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Pincode').fill('4000')
  await dialog.getByLabel('City').fill('Mumbai')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Pincode must be exactly 6 digits.')
  await dialog.getByLabel('Pincode').fill('400050')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => api.calls.find((c) => c.method === 'POST' && c.path === '/pincodes')?.body).toEqual({ pincode: '400050', city: 'Mumbai' })
})

test('Dialogs close on Escape and return focus', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/pincodes')
  const open = page.getByRole('button', { name: 'Add pincode' })
  await open.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(open).toBeFocused()
})

for (const path of ['/today', '/batches', '/batches/b1', '/orders', '/orders/o1', '/pack-list', '/claims', '/pincodes']) {
  test(`${path} has no horizontal page scroll`, async ({ page }) => {
    await mockApi(page, { signedIn: true })
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
}
