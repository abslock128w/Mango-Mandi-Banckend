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
  await page.getByRole('button', { name: 'Condemn and move orders' }).click()
  const result = page.getByRole('dialog', { name: 'Batch condemned' })
  await expect(result).toContainText('moved to other batches')
  await expect(result).toContainText('ORD-1042')
  await expect(result).toContainText('ORD-1043')
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
  await expect(page.locator('.pack-order').first()).toContainText('Morning')
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

test('Order detail: move delivery date posts the new date and slot', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/orders/o1')
  await expect(page.getByText('Morning 07:00–11:00')).toBeVisible()
  await page.getByRole('button', { name: 'Move delivery date' }).click()
  const dialog = page.getByRole('dialog', { name: 'Move order ORD-1042' })
  await dialog.getByLabel('New delivery date').fill('2026-12-01')
  await expect(dialog.getByLabel('Delivery slot')).toHaveValue('slt1')
  await dialog.getByLabel('Delivery slot').selectOption({ label: 'Evening (16:00–20:00)' })
  await dialog.getByRole('button', { name: 'Move order' }).click()
  await expect(dialog).toHaveCount(0)
  expect(api.calls.find((c) => c.path === '/orders/o1/reschedule')?.body).toEqual({ deliveryDate: '2026-12-01', slotId: 'slt2' })
})

test('Order detail lists the WhatsApp updates sent to the customer', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/orders/o1')
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'WhatsApp updates' }) })
  await expect(card).toContainText('Order confirmed')
  await expect(card).toContainText('Sent')
  await expect(page.getByText('WhatsApp chat')).toBeVisible()
})

test('Planning: managers add and switch off delivery slots', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/planning')
  await expect(page.getByText('Booked: Morning 12 of 40 boxes · Evening 3 boxes')).toBeVisible()
  const table = page.getByRole('region', { name: 'Delivery slots' })
  await expect(table.getByRole('row', { name: /Morning/ })).toContainText('07:00–11:00')

  await page.getByRole('button', { name: 'Add slot' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a delivery slot' })
  await dialog.getByLabel('Name').fill('Late')
  await dialog.getByLabel('Starts').fill('20:00')
  await dialog.getByLabel('Ends').fill('19:00')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('The slot must end after it starts.')
  await dialog.getByLabel('Ends').fill('22:00')
  await dialog.getByLabel('Boxes per day (optional)').fill('10')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toHaveCount(0)
  expect(api.calls.find((c) => c.method === 'POST' && c.path === '/slots')?.body).toEqual({ label: 'Late', startsAt: '20:00', endsAt: '22:00', maxBoxes: 10 })
  await expect(table.getByRole('row', { name: /Late/ })).toBeVisible()

  await page.getByRole('button', { name: 'Switch off Evening' }).click()
  await expect.poll(() => api.calls.find((c) => c.method === 'PATCH' && c.path === '/slots/slt2')?.body).toEqual({ active: false })
})

test('Planning: coverage gaps, closing a day, and manager-only rules', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/planning')
  const grid = page.getByRole('region', { name: /^Stock for/ })
  await expect(grid.getByRole('row', { name: /Alphonso 3kg Box/ })).toContainText('12')
  await expect(grid.getByText('none')).toHaveCount(1)
  await expect(page.getByRole('region', { name: 'Delivery calendar' })).toContainText('Diwali')

  await page.getByRole('button', { name: 'Change a day' }).click()
  const day = page.getByRole('dialog', { name: 'Change a delivery day' })
  await day.getByLabel('Date').fill('2026-11-01')
  await day.getByLabel('Note (optional)').fill('Bandh')
  await day.getByRole('button', { name: 'Save' }).click()
  await expect(day).toHaveCount(0)
  expect(api.calls.find((c) => c.method === 'PUT' && c.path === '/calendar/2026-11-01')?.body).toEqual({ isOpen: false, maxBoxes: null, note: 'Bandh' })

  await page.getByRole('button', { name: 'Edit rules' }).click()
  const rules = page.getByRole('dialog', { name: 'Edit selling rules' })
  await rules.getByLabel('Order cutoff (hour, IST)').fill('17')
  await rules.getByRole('button', { name: 'Save as new version' }).click()
  await expect(rules).toHaveCount(0)
  await expect(page.getByText('Version 4', { exact: true })).toBeVisible()
  expect((api.calls.find((c) => c.method === 'PUT' && c.path === '/config')?.body as { rules: { cutoffHourIST: number } }).rules.cutoffHourIST).toBe(17)
})

test('Preorders: weekly capacity, bookings by state, and setting capacity', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/preorders')
  const cap = page.getByRole('region', { name: 'Weekly capacity' })
  await expect(cap.getByRole('row', { name: /Alphonso 3kg Box/ })).toContainText('100')
  const list = page.getByRole('region', { name: 'Preorders' })
  await expect(list.getByRole('row', { name: /PRE-1001/ })).toContainText('Moved once: no stock')
  await expect(list.getByRole('link', { name: 'ORD-1042' })).toBeVisible()
  await page.getByRole('button', { name: 'Waitlist', exact: true }).click()
  await expect(page).toHaveURL(/status=WAITLISTED/)
  await expect(page.getByText('No preorders here.')).toBeVisible()

  await page.getByRole('button', { name: 'Set capacity' }).click()
  const dialog = page.getByRole('dialog', { name: 'Set preorder capacity' })
  await dialog.getByLabel('Week starting (Monday)').fill('2027-03-02')
  await dialog.getByLabel('Boxes').fill('80')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Pick the Monday the week starts on.')
  await dialog.getByLabel('Week starting (Monday)').fill('2027-03-08')
  await dialog.getByLabel('Product').selectOption({ label: 'Kesar 3kg Box' })
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toHaveCount(0)
  expect(api.calls.find((c) => c.method === 'PUT' && c.path === '/preorder-capacity/2027-03-08/KES-3')?.body).toEqual({ capacity: 80 })
})

test('Operators cannot set preorder capacity', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await page.goto('/preorders')
  await expect(page.getByRole('button', { name: /Set capacity/ })).toBeDisabled()
})

test("Planning: moving a day's orders checks first, then lists what didn't move", async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/planning')
  await page.getByRole('button', { name: "Move a day's orders" }).click()
  const dialog = page.getByRole('dialog', { name: "Move a day's orders" })
  await dialog.getByLabel('Move orders from').fill('2026-10-17')
  await dialog.getByLabel('To', { exact: true }).selectOption('2026-10-16')
  await dialog.getByLabel('Only these pincodes (optional)').fill('400001, 4000')
  await dialog.getByLabel('Reason').fill('Heavy rain')
  await dialog.getByRole('button', { name: 'Check orders' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Pincodes must be 6 digits, separated by commas.')
  await dialog.getByLabel('Only these pincodes (optional)').fill('400001')
  await dialog.getByRole('button', { name: 'Check orders' }).click()
  await expect(dialog.getByRole('status')).toContainText('2 confirmed orders')
  await dialog.getByRole('button', { name: 'Move 2 orders' }).click()
  const done = page.getByRole('dialog', { name: 'Orders moved' })
  await expect(done).toContainText('1 of 2 orders moved')
  await expect(done.getByRole('link', { name: 'ORD-1044' })).toHaveAttribute('href', '/orders/o3')
  const moves = api.calls.filter((c) => c.path === '/orders/bulk-reschedule')
  expect(moves.map((c) => c.body)).toEqual([
    { fromDate: '2026-10-17', toDate: '2026-10-16', reason: 'Heavy rain', pincodes: ['400001'], dryRun: true },
    { fromDate: '2026-10-17', toDate: '2026-10-16', reason: 'Heavy rain', pincodes: ['400001'] },
  ])
})

test('Deliveries: the rider run by slot and pincode, flagging unpacked orders', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/deliveries?date=2026-10-16')
  await expect(page.getByText('2 orders, 3 boxes. Every order is paid: riders collect nothing.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Morning · 07:00–11:00' })).toBeVisible()
  const stop = page.getByRole('region', { name: 'Morning · 07:00–11:00, 400001' })
  await expect(stop.getByRole('row', { name: /ORD-1042/ })).toContainText('12 Marine Drive')
  await expect(stop.getByRole('row', { name: /ORD-1044/ })).toContainText('Not packed yet')
  await expect(stop.getByRole('link', { name: '9876543210' })).toHaveAttribute('href', 'tel:+919876543210')
  expect(api.calls.some((c) => c.path === '/manifest')).toBe(true)
})

test('Operators cannot edit selling rules', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await page.goto('/planning')
  await expect(page.getByRole('button', { name: /Edit rules/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Move a day's orders/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Add slot/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Switch off Morning/ })).toBeDisabled()
})

for (const path of ['/today', '/batches', '/batches/b1', '/orders', '/orders/o1', '/pack-list', '/deliveries', '/claims', '/pincodes', '/planning', '/preorders']) {
  test(`${path} has no horizontal page scroll`, async ({ page }) => {
    await mockApi(page, { signedIn: true })
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
}
