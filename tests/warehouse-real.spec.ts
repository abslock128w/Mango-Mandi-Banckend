import { execFileSync } from 'node:child_process'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

// The Warehouse area against the real mango-api (not the mock): turn labels
// on, take a delivery in, receive it by scanning the real label tokens, QC,
// put away, then pick, pack and dispatch a paid order, and see the books
// match. Skips unless WH_REAL_API (the API's URL) and WH_REAL_DB (its
// disposable *_test database, read for the label tokens) are set; the panel
// must be built against the same API (VITE_API_URL). Desktop only: it changes
// the database, so it runs once per fresh database.
//
//   WH_REAL_API=http://localhost:3100 WH_REAL_DB=postgres://…/mango_wh_ui_test \
//   E2E_BASE_URL=http://localhost:5190 npx playwright test warehouse-real --project=desktop

const API = process.env.WH_REAL_API?.replace(/\/+$/, '')
const DB = process.env.WH_REAL_DB
test.skip(!API || !DB, 'Set WH_REAL_API and WH_REAL_DB to run against a real API')
test.skip(!!DB && !/_test(\?|$)/.test(DB), 'WH_REAL_DB must be a *_test database')

const sql = (q: string) => execFileSync('psql', [DB!, '-Atc', q]).toString().trim()
const scanInput = (page: Page) => page.getByLabel('Scan or type a box code')
const results = (page: Page) => page.getByRole('list', { name: 'Scans, newest first' }).getByRole('listitem')
async function scan(page: Page, input: string) {
  await scanInput(page).fill(input)
  await scanInput(page).press('Enter')
}

test('real API: labels on, intake, receive by scanning, QC, put away, pick, pack, dispatch, books match', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'Runs once, on desktop')
  test.setTimeout(180_000)
  const call = async (method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => {
    const res = await page.request.fetch(`${API}${path}`, { method, data: body, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } })
    expect(res.ok(), `${method} ${path} → ${res.status()} ${await res.text()}`).toBeTruthy()
    return res.status() === 204 ? null : res.json()
  }

  // Sign in.
  await page.goto('/login')
  await page.getByLabel('Work email').fill('manager@mandimangoes.test')
  await page.getByLabel('Password').fill('manager123')
  await page.getByRole('button', { name: /Sign in/ }).click()
  await expect(page.getByRole('button', { name: 'Warehouse' })).toBeVisible()

  // 1. Box labels on for ALP-3, 3 kg.
  const name = sql(`SELECT name FROM products WHERE sku = 'ALP-3'`)
  await page.goto('/warehouse/products')
  await page.getByRole('button', { name: `Edit ${name}` }).click()
  await page.getByLabel('Box weight in grams').fill('3000')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText(`Saved ${name}.`)).toBeVisible()
  await page.getByRole('button', { name: `Turn labels on for ${name}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Turn labels on' }).click()
  await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('Labels on')

  // 2. Intake: 4 boxes harvested 5 days ago.
  const harvested = sql(`SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date - 5, 'YYYY-MM-DD')`)
  await page.goto('/warehouse/receive')
  await page.getByLabel('Product', { exact: true }).selectOption('ALP-3')
  await page.getByLabel('Number of boxes').fill('4')
  await page.getByLabel('Harvested on').fill(harvested)
  await page.getByLabel('Supplier (optional)').fill('Ratnagiri Farms')
  await page.getByRole('button', { name: 'Check' }).click()
  await expect(page.getByRole('region', { name: 'Before you make labels' })).toContainText('12 kg')
  await page.getByRole('button', { name: 'Create batch and labels' }).click()
  await expect(page).toHaveURL(/\/warehouse\/lots\/[^/]+$/)
  const lotId = decodeURIComponent(page.url().split('/').pop()!)
  await expect(page.getByRole('button', { name: 'Labels 1–4' })).toBeVisible()
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Labels 1–4' }).click()])
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/)

  // The batch's ripeness reading makes it sellable by date (the Batches screen; straight to the API here).
  const login = await call('POST', '/admin/v1/auth/login', { email: 'manager@mandimangoes.test', password: 'manager123' })
  const batchId = sql(`SELECT batch_id FROM box_lots WHERE id = '${lotId}'`)
  await call('POST', `/admin/v1/batches/${batchId}/qc`, { ripenessRating: 'SEMI_RIPE', condition: 'GOOD' }, login.accessToken)

  // 3. Receive by scanning each real label.
  const tokens = sql(`SELECT label_token FROM boxes WHERE lot_id = '${lotId}' ORDER BY seq`).split('\n')
  expect(tokens).toHaveLength(4)
  await page.getByRole('button', { name: 'Start receive scanning' }).click()
  await expect(scanInput(page)).toBeFocused()
  for (const t of tokens) await scan(page, `MMB1:${t}`)
  await expect(page.locator('.wh-scan-accepted')).toHaveCount(4)
  await scan(page, `MMB1:${tokens[0]}`)
  await expect(results(page).first()).toContainText('Already scanned')
  await scan(page, 'MMB1:NOTAREALTOKEN0000000000000')
  await expect(page.getByRole('alert').filter({ hasText: 'Scanning paused' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue scanning' }).click()

  // 4. QC passes the batch; put away in Storage A.
  await page.goto(`/warehouse/lots/${lotId}`)
  await expect(page.getByText('4 of 4')).toBeVisible()
  await page.getByRole('button', { name: 'Pass QC for the batch' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Pass QC' }).click()
  await expect(page.getByText('4 passed QC.')).toBeVisible()
  await page.getByRole('button', { name: 'Put away' }).click()
  await page.getByRole('dialog').getByLabel('Put away to').selectOption({ label: 'Storage A (Storage)' })
  await page.getByRole('dialog').getByRole('button', { name: 'Put away' }).click()
  await expect(page.getByText('4 boxes put away.')).toBeVisible()

  // 5. A customer orders one box and pays (dev pay route).
  const phone = `97${String(Date.now()).slice(-8)}`
  const { devCode } = await call('POST', '/v1/auth/otp/request', { phone })
  const { accessToken: cust } = await call('POST', '/v1/auth/otp/verify', { phone, code: devCode })
  await call('POST', '/v1/cart/items', { sku: 'ALP-3', stage: 'RIPE', qty: 1 }, cust)
  const quote = await call('POST', '/v1/checkout/quote', { pincode: '560034' }, cust)
  const placed = await call('POST', '/v1/checkout/confirm', { quoteId: quote.quoteId, address: '12, 4th Cross, Koramangala, Bengaluru' }, cust, { 'Idempotency-Key': `wh-${phone}` })
  await call('POST', '/v1/dev/pay', { orderId: placed.orderId, outcome: 'captured' })
  const number = sql(`SELECT number FROM orders WHERE id = '${placed.orderId}'`)

  // 6. Pick from the pick list.
  await page.goto('/warehouse/picking')
  await page.getByRole('link', { name: new RegExp(number) }).click()
  await expect(page.getByRole('heading', { name: `Pick ${number}` })).toBeVisible()
  const suggested = (await page.locator('main code').first().textContent())!.replace(/-/g, '')
  const pickToken = sql(`SELECT label_token FROM boxes WHERE code = '${suggested}'`)
  await page.getByRole('button', { name: 'Start picking' }).click()
  await scan(page, `MMB1:${pickToken}`)
  await expect(results(page).first()).toContainText('Accepted')

  // 7. Pack: a missing box first, then the whole order.
  await page.goto(`/warehouse/picking/${placed.orderId}`)
  await page.getByRole('button', { name: 'Start packing' }).click()
  const finish = page.getByRole('button', { name: /Finish packing/ })
  await finish.click()
  await expect(page.getByRole('list', { name: 'Boxes still to scan' })).toBeVisible()
  await scan(page, `MMB1:${pickToken}`)
  await expect(finish).toHaveText('Finish packing (1 of 1)')
  await finish.click()
  await expect(page.getByRole('status').filter({ hasText: `${number} is packed` })).toBeVisible()

  // 8. Dispatch, starting from the order number.
  await page.goto('/warehouse/scan')
  await page.getByLabel('What are you doing?').selectOption({ label: 'Dispatch' })
  await page.getByLabel('Order number').fill(number)
  await page.getByRole('button', { name: 'Start scanning' }).click()
  await scan(page, `MMB1:${pickToken}`)
  await page.getByRole('button', { name: /Finish dispatch/ }).click()
  await expect(page.getByRole('status').filter({ hasText: `${number} is shipped` })).toBeVisible()
  expect(sql(`SELECT status FROM orders WHERE id = '${placed.orderId}'`)).toBe('SHIPPED')

  // 9. The books match; the box's trace shows the whole story.
  await page.goto('/warehouse/reports')
  await expect(page.getByText('Everything matches')).toBeVisible()
  const boxId = sql(`SELECT id FROM boxes WHERE code = '${suggested}'`)
  await page.goto(`/warehouse/boxes/${boxId}/trace`)
  await expect(page.getByRole('region', { name: 'Orders this box was on' })).toContainText(number)
  for (const e of ['Received', 'Dispatched']) await expect(page.locator('.timeline strong', { hasText: e }).first()).toBeVisible()
  if (process.env.WH_SCREENSHOTS) await page.screenshot({ path: `${process.env.WH_SCREENSHOTS}/real-box-trace-desktop.png`, fullPage: true })
  await page.goto('/warehouse')
  await expect(page.getByRole('list', { name: 'Boxes' })).toContainText('In stock')
})

// Runs after the test above on the same database (three boxes left in Storage
// A). Needs WAREHOUSE_STOCKTAKE and WAREHOUSE_REPACK on in the API.
test('real API: count a shelf, review the box not found, find it again, merge two boxes, books match', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'Runs once, on desktop')
  test.setTimeout(180_000)
  await page.goto('/login')
  await page.getByLabel('Work email').fill('manager@mandimangoes.test')
  await page.getByLabel('Password').fill('manager123')
  await page.getByRole('button', { name: /Sign in/ }).click()
  await expect(page.getByRole('button', { name: 'Warehouse' })).toBeVisible()

  const onShelf = sql(
    `SELECT b.id || ' ' || b.label_token FROM boxes b JOIN wh_locations l ON l.id = b.location_id WHERE l.name = 'Storage A' AND b.lifecycle = 'in_stock' ORDER BY b.seq`,
  )
    .split('\n')
    .map((r) => r.split(' '))
  expect(onShelf).toHaveLength(3)
  const [[keptA, tokenA], [keptB, tokenB], [lostId, lostToken]] = onShelf

  // 1. Count Storage A, scanning two of its three boxes.
  await page.goto('/warehouse/stocktake')
  await page.getByRole('link', { name: 'Start a count' }).click()
  await page.getByLabel('Place to count').selectOption({ label: 'Storage A (Storage)' })
  await page.getByRole('button', { name: 'Start scanning' }).click()
  await expect(scanInput(page)).toBeFocused()
  await scan(page, `MMB1:${tokenA}`)
  await scan(page, `MMB1:${tokenB}`)
  await expect(page.locator('.wh-scan-accepted')).toHaveCount(2)
  await page.getByRole('button', { name: 'Finish count' }).click()
  await page.getByRole('dialog', { name: 'Finish this count?' }).getByRole('button', { name: 'Finish count' }).click()
  await expect(page.getByText('1 box was not found.')).toBeVisible()
  expect(sql(`SELECT lifecycle FROM boxes WHERE id = '${lostId}'`)).toBe('in_stock')

  // 2. The review marks it missing; stock follows.
  await page.getByRole('link', { name: 'Open the count' }).click()
  const review = page.getByRole('region', { name: /Review boxes not found/ })
  await review.getByLabel('Mark missing').check()
  await review.getByRole('button', { name: 'Save review' }).click()
  await expect(page.getByText('Review saved: 1 marked missing.')).toBeVisible()
  expect(sql(`SELECT lifecycle || ' ' || coalesce(location_id, '-') FROM boxes WHERE id = '${lostId}'`)).toBe('missing -')

  // 3. It turns up in the cold room: a count there brings it back.
  await page.goto('/warehouse/scan?type=stocktake')
  await page.getByLabel('Place to count').selectOption({ label: 'Cold room (Cold storage)' })
  await page.getByRole('button', { name: 'Start scanning' }).click()
  await scan(page, `MMB1:${lostToken}`)
  await expect(results(page).first()).toContainText('was recorded missing')
  await page.getByRole('button', { name: 'Finish count' }).click()
  await page.getByRole('dialog', { name: 'Finish this count?' }).getByRole('button', { name: 'Finish count' }).click()
  await expect(page.getByRole('heading', { name: 'Count finished' })).toBeVisible()
  expect(sql(`SELECT b.lifecycle || ' ' || l.name FROM boxes b JOIN wh_locations l ON l.id = b.location_id WHERE b.id = '${lostId}'`)).toBe('in_stock Cold room')

  // 4. Merge the two counted boxes at Packing into one new box.
  await page.goto('/warehouse/repack')
  await page.getByRole('link', { name: 'Start a repack' }).click()
  await page.getByLabel('Where you repack').selectOption({ label: 'Packing (Packing)' })
  await page.getByLabel('Why repack?').selectOption({ label: 'Merge part-full boxes' })
  await page.getByLabel('What is being done').fill('Two boxes with soft fruit into one')
  await page.getByRole('button', { name: 'Start scanning' }).click()
  await scan(page, `MMB1:${tokenA}`)
  await scan(page, `MMB1:${tokenB}`)
  await expect(page.locator('.wh-scan-accepted')).toHaveCount(2)
  await page.getByRole('button', { name: 'Finish repack' }).click()
  const dialog = page.getByRole('dialog', { name: 'Finish repack' })
  await expect(dialog).toContainText('Going in: 2 boxes, 6 kg')
  await dialog.getByLabel('Weight in grams').fill('5600')
  await dialog.getByLabel('Fruit taken out').fill('2')
  await dialog.getByLabel('Weight taken out (g)').fill('400')
  await dialog.getByRole('button', { name: 'Make 1 new box' }).click()
  const done = page.getByRole('region', { name: 'Repack done' })
  await expect(done).toContainText('2 boxes in, 1 new box out')
  const [labels] = await Promise.all([page.waitForEvent('download'), done.getByRole('button', { name: 'Download new labels' }).click()])
  expect(labels.suggestedFilename()).toMatch(/^repack-labels-.+\.pdf$/)
  expect(sql(`SELECT string_agg(lifecycle, ',') FROM boxes WHERE id IN ('${keptA}', '${keptB}')`)).toBe('repacked,repacked')
  const made = sql(`SELECT id FROM boxes WHERE parent_box_ids @> ARRAY['${keptA}', '${keptB}']::uuid[]`)
  expect(made).not.toBe('')
  expect(Number(sql(`SELECT count(*) FROM box_origins WHERE box_id = '${made}'`))).toBeGreaterThanOrEqual(1)

  // 5. The new box's trace names both parents; the books still match.
  await page.goto(`/warehouse/boxes/${made}/trace`)
  await expect(page.getByRole('heading', { name: 'Repacked from' })).toBeVisible()
  await page.goto('/warehouse/reports')
  await expect(page.getByText('Everything matches')).toBeVisible()
})
