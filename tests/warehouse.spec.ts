import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, mainNav, navLinkAnyState, openNavTo, test } from './fixtures'
import { mockApi, type Role } from './mock-api'
import { mockWarehouse } from './warehouse-mock'

// Stage 7: the staff panel's Warehouse area, against tests/warehouse-mock.ts.

async function signIn(page: Page, role: Role = 'MANAGER', enabled = true) {
  const api = await mockApi(page, { signedIn: true, role })
  const whs = await mockWarehouse(page, api, { role, enabled })
  return { api, whs }
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

const scanInput = (page: Page) => page.getByLabel('Scan or type a box code')
const results = (page: Page) => page.getByRole('list', { name: 'Scans, newest first' }).getByRole('listitem')

async function scan(page: Page, code: string) {
  await scanInput(page).fill(code)
  await scanInput(page).press('Enter')
}

/** Opens a scan session the way staff do: from the setup form. */
async function startSession(page: Page, type: string, fill?: () => Promise<unknown>) {
  await page.goto('/warehouse/scan')
  await page.getByLabel('What are you doing?').selectOption({ label: type })
  if (fill) await fill()
  await page.getByRole('button', { name: 'Start scanning' }).click()
  await expect(scanInput(page)).toBeFocused()
}

test('with the warehouse off, its nav group and pages are hidden', async ({ page }) => {
  await signIn(page, 'MANAGER', false)
  await page.goto('/today')
  await expect(await openNavTo(page, 'Orders')).toBeVisible()
  for (const name of ['Overview', 'Receive', 'Scan', 'Box batches', 'Locations']) await expect(navLinkAnyState(page, name)).toHaveCount(0)
  await expect(mainNav(page).getByRole('button', { name: 'Warehouse' })).toHaveCount(0)
  await page.goto('/warehouse/receive')
  await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible()
})

test('a packer sees picking and scanning but not Receive', async ({ page }) => {
  await signIn(page, 'PACKER')
  await page.goto('/pack-list')
  await expect(await openNavTo(page, 'Picking')).toBeVisible()
  await expect(navLinkAnyState(page, 'Scan')).toHaveCount(1)
  await expect(navLinkAnyState(page, 'Receive')).toHaveCount(0)
  await page.goto('/warehouse/receive')
  await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible()
  // Scan offers only the packer's own session types.
  await page.goto('/warehouse/scan')
  await expect(page.getByLabel('What are you doing?').locator('option')).toHaveText(['Move', 'Pick', 'Take off order', 'Pack', 'Dispatch', 'Return'])
})

test('overview opens from the nav and links to the other pages', async ({ page }) => {
  await signIn(page)
  await page.goto('/today')
  await (await openNavTo(page, 'Overview')).click()
  await expect(page.getByRole('heading', { name: 'Warehouse', level: 1 })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Boxes' }).getByText('In stock')).toBeVisible()
  const pages = page.getByRole('navigation', { name: 'Warehouse pages' })
  await expect(pages.getByRole('link', { name: 'Receive' })).toBeVisible()
  await pages.getByRole('link', { name: 'Exceptions' }).click()
  await expect(page.getByRole('region', { name: 'Orders short of boxes' })).toContainText('ORD-1050')
  await axe(page)
})

test('intake: check shows weight and best-before, create makes one lot and links its labels', async ({ page }) => {
  const { whs } = await signIn(page)
  await page.goto('/warehouse/receive')
  await expect(page.getByLabel('Product', { exact: true })).toHaveValue('ALP-3KG')
  // Kesar has no box labels, so it is not offered.
  await expect(page.getByLabel('Product', { exact: true }).locator('option')).toHaveText(['Alphonso 3kg Box'])
  await page.getByLabel('Number of boxes').fill('12')
  await page.getByLabel('Supplier (optional)').fill('Ratnagiri Farms')
  await page.getByRole('button', { name: 'Check' }).click()
  const preview = page.getByRole('region', { name: 'Before you make labels' })
  await expect(preview).toContainText('36 kg')
  await expect(preview).toContainText('30 Oct')
  await axe(page)

  await preview.getByRole('button', { name: 'Create batch and labels' }).click()
  await expect(page).toHaveURL(/\/warehouse\/lots\/lot_1$/)
  expect(whs.lotKeys).toHaveLength(1)
  expect(whs.lotKeys[0]).toMatch(/^[A-Za-z0-9_-]{8,80}$/)

  const labels = page.getByRole('region', { name: 'Labels' })
  const link = labels.getByRole('button', { name: 'Labels 1–12' })
  await expect(link).toBeVisible()
  await labels.getByLabel('Printer').selectOption('a4')
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()])
  expect(download.suggestedFilename()).toBe('labels-L2610-ALP3-1X-1-12.pdf')
  await expect(page.getByRole('button', { name: 'Start receive scanning' })).toBeVisible()
})

test('a large lot keeps making labels part by part and shows how far it got', async ({ page }) => {
  const { api } = await signIn(page)
  await page.goto('/warehouse/receive')
  await page.getByLabel('Number of boxes').fill('3500')
  await page.getByRole('button', { name: 'Check' }).click()
  await page.getByRole('button', { name: 'Create batch and labels' }).click()
  await expect(page.getByRole('region', { name: 'Labels' }).getByRole('button', { name: 'Labels 3001–3500' })).toBeVisible()
  await expect(page.getByText(/Making labels/)).toHaveCount(0)
  expect(api.calls.filter((c) => c.path.endsWith('/continue'))).toHaveLength(2)
  // Parts of at most 1000.
  await expect(page.getByRole('region', { name: 'Labels' }).getByRole('button', { name: /^Labels / })).toHaveCount(4)
})

test('scan session: accepted, duplicate, a rejected scan stops the queue until acknowledged, undo', async ({ page }) => {
  const { whs } = await signIn(page)
  await page.goto('/warehouse/lots/lot_seed')
  await page.getByRole('button', { name: 'Start receive scanning' }).click()
  await expect(page.getByRole('heading', { name: /Receive/, level: 1 })).toContainText('L2610-ALP3-7K')
  await expect(scanInput(page)).toBeFocused()

  await scan(page, '7K2M-QX4P-3')
  await expect(results(page).first()).toContainText('Accepted')
  await expect(page.getByRole('status').filter({ hasText: 'Accepted: 7K2M-QX4P-3 received.' })).toBeAttached()
  await expect(scanInput(page)).toHaveValue('')
  await expect(scanInput(page)).toBeFocused()

  await scan(page, '7K2M-QX4P-3')
  await expect(results(page).first()).toContainText('Already scanned')

  await scan(page, 'BAD-LABEL')
  const stop = page.getByRole('alert').filter({ hasText: 'Scanning paused' })
  await expect(stop).toContainText('Unknown label')
  await expect(results(page).first()).toContainText('Rejected')

  // Scans made while stopped wait on the device.
  const sent = whs.scanRequests.length
  await scan(page, '7K2M-QX4R-8')
  await expect(stop).toContainText('1 more scan waits behind it')
  expect(whs.scanRequests.length).toBe(sent)

  await stop.getByRole('button', { name: 'Continue scanning' }).click()
  await expect(stop).toHaveCount(0)
  await expect(results(page).first()).toContainText('7K2M-QX4R-8 received.')
  await expect(scanInput(page)).toBeFocused()
  await expect(page.getByRole('list', { name: 'Scans, newest first' }).locator('.wh-scan-accepted')).toHaveCount(2)
  await expect(page.locator('.wh-scan-duplicate')).toHaveCount(1)
  await expect(page.locator('.wh-scan-rejected')).toHaveCount(1)
  await axe(page)

  await page.getByRole('button', { name: 'Undo last scan' }).click()
  await expect(results(page).first()).toContainText('Undone')
  await expect(page.locator('.wh-scan-accepted')).toHaveCount(1)

  // Every scan went with its own UUID.
  const ids = whs.scanRequests.flat().map((s) => s.scanId)
  expect(new Set(ids).size).toBe(ids.length)
  for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('a scan that fails to send is sent again with the same scanId and booked once', async ({ page, consoleErrors }) => {
  const { whs } = await signIn(page)
  await startSession(page, 'Receive', () => page.getByLabel('Batch').selectOption({ index: 1 }))
  whs.failScans = 1
  await scan(page, '7K2M-QX4P-3')
  await expect(page.getByText(/No connection: 1 scan waiting/)).toBeVisible()
  await expect(results(page).first()).toContainText('7K2M-QX4P-3 received.')
  expect(whs.scanRequests).toHaveLength(2)
  expect(whs.scanRequests[1][0].scanId).toBe(whs.scanRequests[0][0].scanId)
  await expect(results(page)).toHaveCount(1)
  await expect(page.locator('.wh-session-counts')).toContainText('Accepted1')
  const expected = (e: string) => /Failed to load resource: the server responded with a status of 500/.test(e)
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !expected(e)))
})

test('the queue survives a reload: waiting scans are sent with their scanIds', async ({ page, consoleErrors }) => {
  const { whs } = await signIn(page)
  await startSession(page, 'Receive', () => page.getByLabel('Batch').selectOption({ index: 1 }))
  whs.failScans = 100
  await scan(page, '7K2M-QX4P-3')
  await expect(page.getByText(/No connection: 1 scan waiting/)).toBeVisible()
  const first = whs.scanRequests[0][0].scanId
  whs.failScans = 0
  await page.reload()
  await expect(results(page).first()).toContainText('7K2M-QX4P-3 received.')
  expect(whs.scanRequests.at(-1)?.[0].scanId).toBe(first)
  const expected = (e: string) => /Failed to load resource: the server responded with a status of 500/.test(e)
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !expected(e)))
})

test('NON_FEFO asks for a reason and resends with a new scanId and the reason', async ({ page }) => {
  const { whs } = await signIn(page)
  await page.goto('/warehouse/picking')
  await page.getByRole('link', { name: /ORD-1042/ }).click()
  await expect(page.getByRole('heading', { name: 'Pick ORD-1042' })).toBeVisible()
  await expect(page.getByText('7K2M-QX4P-3')).toBeVisible()
  await page.getByRole('button', { name: 'Start picking' }).click()
  await expect(scanInput(page)).toBeFocused()

  await scan(page, 'OTHER-1')
  const dialog = page.getByRole('dialog', { name: 'Picked from another batch' })
  await expect(dialog).toContainText('The reserved batch is L2610-ALP3-7K.')
  await dialog.getByLabel('Why this box?').fill('Reserved batch is behind the cold room door')
  await dialog.getByRole('button', { name: 'Use this box' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(results(page).first()).toContainText('Warning')
  await expect(results(page).first()).toContainText('picked from another batch')

  const [firstTry, resend] = whs.scanRequests.flat()
  expect(firstTry.input).toBe('OTHER-1')
  expect(firstTry.reason).toBeUndefined()
  expect(resend.input).toBe('OTHER-1')
  expect(resend.reason).toBe('Reserved batch is behind the cold room door')
  expect(resend.scanId).not.toBe(firstTry.scanId)
  await expect(page.getByRole('alert').filter({ hasText: 'Scanning paused' })).toHaveCount(0)
})

test('pack finalize with boxes missing lists their codes; with all staged the order is packed', async ({ page }) => {
  await signIn(page)
  await startSession(page, 'Pack', () => page.getByLabel('Order number').fill('ORD-1042'))
  await expect(page.getByLabel('Boxes staged')).toBeVisible()
  await scan(page, '7K2M-QX4P-3')
  await expect(results(page).first()).toContainText('staged')
  const finish = page.getByRole('button', { name: /Finish packing/ })
  await expect(finish).toHaveText('Finish packing (1 of 3)')
  await finish.click()
  const missing = page.getByRole('list', { name: 'Boxes still to scan' })
  await expect(missing.getByRole('listitem')).toHaveText(['7K2M-QX4R-8', '7K2M-QX4T-1'])
  await expect(page.getByRole('alert').filter({ hasText: '2 boxes are not scanned yet' })).toBeVisible()

  await scan(page, '7K2M-QX4R-8')
  await scan(page, '7K2M-QX4T-1')
  await expect(finish).toHaveText('Finish packing (3 of 3)')
  await finish.click()
  await expect(page.getByRole('status').filter({ hasText: 'ORD-1042 is packed' })).toBeVisible()
})

test('a location label in a move session offers to switch destination', async ({ page }) => {
  await signIn(page)
  await startSession(page, 'Move', () => page.getByLabel('Moving to').selectOption({ label: 'A · Shelf A (Storage)' }))
  await expect(page.getByRole('heading', { level: 1 })).toContainText('to Shelf A')
  await scan(page, 'LOC-B')
  await page.getByRole('button', { name: 'Switch destination to Shelf B' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('to Shelf B')
  await expect(scanInput(page)).toBeFocused()
  await scan(page, '7K2M-QX4P-3')
  await expect(results(page).first()).toContainText('moved to Shelf B')
})

test('batch QC and put-away keep asking while the API says there is more', async ({ page }) => {
  const { api, whs } = await signIn(page)
  const lot = whs.lots[0]
  lot.verifiedCount = 900
  lot.generatedCount = 900
  lot.targetCount = 900
  lot.expectedCount = 900
  whs.putAwayStuckAfter = 500
  await page.goto('/warehouse/lots/lot_seed')
  await page.getByRole('button', { name: 'Pass QC for the batch' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Pass QC' }).click()
  await expect(page.getByText('900 passed QC.')).toBeVisible()
  expect(api.calls.filter((c) => c.path.endsWith('/qc'))).toHaveLength(3)

  await page.getByRole('button', { name: 'Put away' }).click()
  const dialog = page.getByRole('dialog', { name: 'Put away' })
  await dialog.getByLabel('Put away to').selectOption({ label: 'A · Shelf A (Storage)' })
  await dialog.getByRole('button', { name: 'Put away' }).click()
  // 400, then 100, then nothing moved: it stops and says what was left.
  await expect(page.getByText(/500 boxes put away; 1 left where they are \(7K2M-QX4Z-9\)/)).toBeVisible()
  expect(api.calls.filter((c) => c.path.endsWith('/put-away'))).toHaveLength(3)
})

test('box page: holds, label and history; locations and reports for a manager', async ({ page }) => {
  await signIn(page)
  await page.goto('/warehouse/boxes')
  await page.getByLabel('Scan or type a box code').fill('7k2m-qx4p-3')
  await page.getByRole('button', { name: 'Open box' }).click()
  await expect(page.getByRole('heading', { name: /Box 7K2M-QX4P-3/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Release QC hold' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible()
  await expect(page.getByText('Received', { exact: true })).toBeVisible()
  await axe(page)

  await page.goto('/warehouse/locations')
  await expect(page.getByRole('button', { name: 'Add location' })).toBeVisible()
  await page.getByRole('button', { name: 'Switch off Shelf B' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Switch off' }).click()
  await expect(page.getByRole('row', { name: /Shelf B/ })).toContainText('Switched off')

  await page.goto('/warehouse/reports')
  await expect(page.getByText('Everything matches')).toBeVisible()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('No write-offs waiting.')).toBeVisible()
  await axe(page)
})

test('an operator sees locations but cannot add or switch them off', async ({ page }) => {
  await signIn(page, 'OPERATOR')
  await page.goto('/warehouse/locations')
  await expect(page.getByRole('row', { name: /Shelf B/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add location' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Switch off/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Label for Shelf B' })).toBeVisible()
})

test('box settings: edit a product, and turning labels on lists the batches that do not match', async ({ page }) => {
  const { api, whs } = await signIn(page)
  whs.trackingMismatch = true
  await page.goto('/today')
  await (await openNavTo(page, 'Box settings')).click()
  await expect(page.getByRole('heading', { name: 'Box settings', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Edit Alphonso 3kg Box' }).click()
  const edit = page.getByRole('dialog', { name: /Box settings: Alphonso/ })
  await edit.getByLabel('Weight tolerance (%)').fill('7.5')
  await edit.getByLabel('Shelf life in days').fill('8')
  await edit.getByLabel('Returned boxes can be resold').uncheck()
  await edit.getByLabel('QC reasons').fill('bruised\nunder weight')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(edit).toHaveCount(0)
  const patch = api.calls.find((c) => c.method === 'PATCH' && c.path === '/warehouse/products/ALP-3KG')?.body
  expect(patch).toEqual({ nominalWeightG: 3000, weightTolerancePct: 7.5, shelfLifeDays: 8, requiresQc: true, restockableReturns: false, qcChecklist: ['BRUISED', 'UNDER_WEIGHT'] })
  await expect(page.getByRole('row', { name: /Alphonso 3kg Box/ })).toContainText('Written off')
  await axe(page)

  await page.getByRole('button', { name: 'Turn labels on for Kesar 1kg' }).click()
  const dialog = page.getByRole('dialog', { name: /Turn box labels on for Kesar/ })
  await dialog.getByRole('button', { name: 'Turn labels on' }).click()
  await expect(dialog.getByRole('alert')).toContainText('does not match its labelled boxes')
  const lines = dialog.getByRole('region', { name: 'Batches that do not match' })
  await expect(lines.getByRole('row', { name: /bat_9/ })).toContainText('12')
  await axe(page)
})

test('box page: weigh, write off, and its trace', async ({ page }) => {
  const { whs } = await signIn(page)
  await page.goto('/warehouse/boxes/0b6f2a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b')
  await page.getByRole('button', { name: 'Weigh' }).click()
  const weigh = page.getByRole('dialog', { name: /Weigh/ })
  await weigh.getByLabel('Weight in grams').fill('2700')
  await weigh.getByRole('button', { name: 'Save weight' }).click()
  await expect(page.getByText(/outside the allowed range/)).toBeVisible()

  await page.getByRole('button', { name: 'Write off' }).click()
  const wo = page.getByRole('dialog', { name: /Write off box/ })
  await wo.getByLabel('Reason').selectOption('spoiled')
  await wo.getByLabel('What happened').fill('Mould inside')
  await wo.getByRole('button', { name: 'Write off' }).click()
  await expect(page.getByText('1 box written off.')).toBeVisible()
  expect(whs.writeOffRequests[0]).toEqual({ boxIds: ['0b6f2a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'], reasonCode: 'spoiled', reason: 'Mould inside' })

  await page.getByRole('link', { name: 'Trace this box' }).click()
  await expect(page.getByRole('heading', { name: /Trace 7K2M-QX4P-3/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Orders this box was on' })).toContainText('Asha Rao')
  await expect(page.locator('.timeline strong', { hasText: 'QC passed' })).toBeVisible()
  await axe(page)
  await page.getByRole('link', { name: 'L2610-ALP3-7K' }).click()
  await expect(page.getByRole('heading', { name: 'Trace batch L2610-ALP3-7K' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Boxes by state' })).toContainText('Label printed')
})

test('boxes list: choose several and the write-off waits for approval', async ({ page }) => {
  const { whs } = await signIn(page)
  await page.goto('/warehouse/boxes')
  await page.getByLabel('Choose 7K2M-QX4P-3').check()
  await page.getByLabel('Choose 7K2M-QX4R-8').check()
  await page.getByRole('button', { name: 'Write off 2 boxes' }).click()
  const wo = page.getByRole('dialog', { name: 'Write off 2 boxes' })
  await wo.getByLabel('What happened').fill('Crushed under a pallet')
  await wo.getByRole('button', { name: 'Write off' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Waiting for approval: 2 boxes' })).toBeVisible()
  expect((whs.writeOffRequests[0].boxIds as string[]).length).toBe(2)
  await axe(page)
})

test('lot: correct the supplier and void the batch; recall detail continues and releases', async ({ page }) => {
  const { api } = await signIn(page)
  await page.goto('/warehouse/lots/lot_seed')
  await page.getByRole('button', { name: 'Correct supplier or product' }).click()
  const fix = page.getByRole('dialog', { name: 'Correct supplier or product' })
  await fix.getByLabel('Supplier').fill('Devgad Orchards')
  await fix.getByLabel('Reason').fill('Wrong supplier on the delivery note')
  await fix.getByRole('button', { name: 'Save correction' }).click()
  await expect(page.getByText('Supplier corrected.')).toBeVisible()
  expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ supplier: 'Devgad Orchards', reason: 'Wrong supplier on the delivery note' })

  await page.getByRole('button', { name: 'Void batch' }).click()
  await page.getByRole('dialog').getByLabel('Why void it?').fill('Delivery refused at the gate')
  await page.getByRole('dialog').getByRole('button', { name: 'Void batch' }).click()
  await expect(page.getByRole('heading', { name: /Batch L2610/ }).locator('..')).toContainText('Voided')

  await page.goto('/warehouse/reports')
  await page.getByRole('link', { name: 'Supplier reported pesticide residue' }).click()
  await expect(page.getByRole('heading', { name: 'Recall', level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Orders already dispatched' })).toContainText('ORD-1042')
  await page.getByRole('button', { name: 'Continue holding' }).click()
  await expect(page.getByText('All held')).toBeVisible()
  await page.getByRole('button', { name: 'Release' }).click()
  await page.getByRole('dialog').getByLabel('Why release it?').fill('Lab results came back clean')
  await page.getByRole('dialog').getByRole('button', { name: 'Release recall' }).click()
  await expect(page.getByText('Released', { exact: true })).toBeVisible()
  await axe(page)
})

test('scan setup looks an order number up in the orders search', async ({ page }) => {
  const { api } = await signIn(page)
  await page.route('**/admin/v1/orders?*', (route) =>
    route.fulfill({ json: { page: 1, pageSize: 20, total: 1, items: [{ id: 'ord_7', number: 'ORD-2001', customerName: null, phone: null, itemCount: 1 }] } }),
  )
  await startSession(page, 'Dispatch', () => page.getByLabel('Order number').fill('ord-2001'))
  const start = api.calls.find((c) => c.method === 'POST' && c.path === '/warehouse/operations')
  expect(start?.body).toEqual({ type: 'dispatch', context: { orderId: 'ord_7' } })
})

// Screenshots for review: WH_SCREENSHOTS=/mnt/project-files/warehouse npx playwright test warehouse
test('screenshots of the scan workspace and receive page', async ({ page }, info) => {
  const dir = process.env.WH_SCREENSHOTS
  test.skip(!dir, 'Set WH_SCREENSHOTS to a folder to save them')
  const name = info.project.name
  await signIn(page)
  await page.goto('/warehouse/receive')
  await page.getByLabel('Number of boxes').fill('120')
  await page.getByLabel('Supplier (optional)').fill('Ratnagiri Farms')
  await page.getByRole('button', { name: 'Check' }).click()
  await expect(page.getByText('360 kg')).toBeVisible()
  await page.screenshot({ path: `${dir}/receive-${name}.png`, fullPage: true })
  await page.goto('/warehouse/lots/lot_seed')
  await page.getByRole('button', { name: 'Start receive scanning' }).click()
  await scan(page, '7K2M-QX4P-3')
  await expect(results(page).first()).toContainText('Accepted')
  await scan(page, '7K2M-QX4P-3')
  await scan(page, 'BAD-LABEL')
  await expect(page.getByRole('alert').filter({ hasText: 'Scanning paused' })).toBeVisible()
  await page.screenshot({ path: `${dir}/scan-${name}.png`, fullPage: true })
  await page.goto('/warehouse/products')
  await expect(page.getByRole('row', { name: /Alphonso/ })).toBeVisible()
  await page.screenshot({ path: `${dir}/products-${name}.png`, fullPage: true })
  await page.goto('/warehouse/boxes/0b6f2a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b/trace')
  await expect(page.locator('.timeline strong', { hasText: 'QC passed' })).toBeVisible()
  await page.screenshot({ path: `${dir}/box-trace-${name}.png`, fullPage: true })
})
