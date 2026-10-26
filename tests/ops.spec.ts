import AxeBuilder from '@axe-core/playwright'
import type { Page, Route } from '@playwright/test'
import { expect, navLinkAnyState, openNavTo, test } from './fixtures'
import { mockApi, type MockState } from './mock-api'
import type { BatchPurchases, Farm, FeatureSwitch, ForecastDay, Margins, Purchase, Role, StockForecast } from '../src/types'

// The panel's side of staff operations (docs/ops.md) against the mock API: the stock forecast on
// Planning (managers), Farms and a batch's purchase (costs for managers only), and the Settings
// page's feature switches with the password check. The API's own rules are in mango-api/test/ops.test.js.

const EMAIL: Record<Role, string> = { MANAGER: 'manager@mandimangoes.test', OPERATOR: 'ops@mandimangoes.test', PACKER: 'packer@mandimangoes.test', QC: 'qc@mandimangoes.test', RIDER: 'rider@mandimangoes.test' }
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
const err = (status: number, code: string, message: string, extra: object = {}) => json({ error: { code, message, requestId: 'req_t', ...extra } }, status)

const DATES = Array.from({ length: 14 }, (_, i) => `2026-10-${String(16 + i).padStart(2, '0')}`)
const day = (date: string, p: Partial<ForecastDay> = {}): ForecastDay => ({
  date,
  history: { samples: [{ date: '2026-10-09', sold: 6, counted: true, reason: null }, { date: '2026-10-02', sold: 4, counted: true, reason: null }, { date: '2026-09-25', sold: 0, counted: true, reason: null }, { date: '2026-09-18', sold: 0, counted: false, reason: 'closed' }], average: 3.3 },
  booked: 0, bookAhead: 0, expected: 3.3, toSell: 3.3, fromStock: 0, short: 4, ...p,
})
const noHistory = (date: string): ForecastDay => ({
  date, history: { samples: [{ date: '2026-10-09', sold: 0, counted: false, reason: 'no stock' }], average: null }, booked: 0, bookAhead: 0, expected: null, toSell: 0, fromStock: 0, short: 0,
})

const FORECAST: StockForecast = {
  today: '2026-10-15',
  dates: DATES,
  rules: { horizonDays: 14, historyWeeks: 4, minHistoryDays: 2, wasteWindowDays: 28, maxWasteRate: 0.5, maxSellableAge: 7, transitDays: 2, forecastConfidence: 0.85 },
  varieties: [
    {
      variety: 'Alphonso', enoughHistory: true, suggestedBoxes: 8, note: null, shortForBookings: 0, buyBy: '2026-10-10',
      products: [{
        sku: 'ALP-3', name: 'Alphonso 3kg Box', boxSize: '3kg', enoughHistory: true, note: null, suggestedBoxes: 8, shortForBookings: 0, shortBoxes: 6, buyBy: '2026-10-10',
        waste: { days: 28, damagedBoxes: 2, claimBoxes: 0, soldBoxes: 11, rate: 0.154, capped: false },
        shortDays: [{ date: '2026-10-16', stage: 'RIPE', boxes: 2, pluckBy: '2026-10-10', fromHistory: true }],
        batches: [{ batchId: 'b1', pluckedOn: '2026-10-12', ageToday: 3, status: 'SELLING', onHand: 10, waitingQc: false, freeBoxes: 10, sellableUntil: '2026-10-19', usedByForecast: 3, unsoldPastCap: 5, stages: DATES.map((date) => ({ date, stage: null })) }],
        stages: [
          { stage: 'RAW', enoughHistory: false, short: 0, days: DATES.map(noHistory) },
          { stage: 'SEMI_RIPE', enoughHistory: false, short: 0, days: DATES.map(noHistory) },
          { stage: 'RIPE', enoughHistory: true, short: 6, days: DATES.map((d) => day(d, { short: d === '2026-10-16' ? 2 : d === '2026-10-23' ? 4 : 0, booked: d === '2026-10-16' ? 2 : 0 })) },
        ],
      }],
    },
    {
      variety: 'Badami', enoughHistory: false, suggestedBoxes: null, note: 'not enough history', shortForBookings: 0, buyBy: null,
      products: [{
        sku: 'BAD-3', name: 'Badami 3kg Box', boxSize: '3kg', enoughHistory: false, note: 'not enough history', suggestedBoxes: null, shortForBookings: 0, shortBoxes: 0, buyBy: null,
        waste: { days: 28, damagedBoxes: 0, claimBoxes: 0, soldBoxes: 0, rate: 0, capped: false }, shortDays: [], batches: [],
        stages: (['RAW', 'SEMI_RIPE', 'RIPE'] as const).map((stage) => ({ stage, enoughHistory: false, short: 0, days: DATES.map(noHistory) })),
      }],
    },
  ],
  hidden: [],
}

const FARMS: Farm[] = [
  { id: 'frm1', name: 'Ratnagiri Orchards', place: 'Ratnagiri', contactName: 'Suresh', phoneMasked: '******3210', hasPhone: true, active: true, createdAt: '2026-10-01T05:00:00Z', updatedAt: '2026-10-01T05:00:00Z', purchases: 1, lastPurchaseOn: '2026-10-14' },
  { id: 'frm2', name: 'Devgad Growers', place: null, contactName: null, phoneMasked: null, hasPhone: false, active: false, createdAt: '2026-10-01T05:00:00Z', updatedAt: '2026-10-01T05:00:00Z', purchases: 0, lastPurchaseOn: null },
]

const PURCHASE: Purchase = {
  id: 'pur1', batchId: 'b1', farmId: 'frm1', farmName: 'Ratnagiri Orchards', purchasedOn: '2026-10-14', crates: 4, boxes: 20, note: null, createdAt: '2026-10-14T05:00:00Z', updatedAt: null,
  costPerCrate: 500_000, transportCost: 100_000, otherCost: 0, totalCost: 2_100_000, costPerBox: 105_000,
}

const MARGINS: Margins = {
  from: '2026-07-18', to: '2026-10-15',
  varieties: [{ variety: 'Alphonso', batches: 1, boughtBoxes: 20, totalCost: 2_100_000, costPerBox: 105_000, soldBoxes: 3, revenue: 341_820, costOfSold: 315_000, margin: 26_820, marginPerBox: 8_940, unsoldBoxes: 17, costOfUnsold: 1_785_000 }],
  batches: [{ batchId: 'b1', variety: 'Alphonso', pluckedOn: '2026-10-08', status: 'SELLING', boughtBoxes: 20, totalCost: 2_100_000, costPerBox: 105_000, soldBoxes: 3, revenue: 341_820, costOfSold: 315_000, margin: 26_820, marginPerBox: 8_940, unsoldBoxes: 17, costOfUnsold: 1_785_000 }],
}

const SWITCHES: FeatureSwitch[] = [
  { key: 'FAVOURITES', label: 'Favourites', description: 'Hearts on the shop’s boxes and a Favourites list on the Account page.', envValue: false, killedByEnv: false, override: null, updatedBy: null, updatedAt: null, effective: false },
  { key: 'SHOP_SORT_FILTER', label: 'Sort and filter', description: 'Sort and filter controls on the shop’s home page.', envValue: false, killedByEnv: true, override: null, updatedBy: null, updatedAt: null, effective: false },
  { key: 'LIVE_TRACKING', label: 'Live tracking', description: 'Your rider is N stops away.', envValue: true, killedByEnv: false, override: null, updatedBy: null, updatedAt: null, effective: true },
]

type Ops = MockState & { switches: FeatureSwitch[] }

/** The mock API signed in as `role`, with the ops switches on (or not) in /auth/me and the ops routes answering like the API. */
async function ops(page: Page, role: Role, on = true): Promise<Ops> {
  const api = (await mockApi(page, { signedIn: true, role })) as Ops
  api.switches = SWITCHES.map((s) => ({ ...s }))
  const manager = role === 'MANAGER'
  const features = { stockForecast: on, purchaseRecords: on, panelSwitches: on }
  await page.route('**/admin/v1/auth/me', (route) => route.fulfill(json({ email: EMAIL[role], role, twoStep: api.twoStep, features })))
  const log = (route: Route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace(/^.*\/admin\/v1/, '')
    let body: unknown = null
    try {
      body = req.postDataJSON()
    } catch {
      body = null
    }
    api.calls.push({ method: req.method(), path, body })
    return { req, path, body }
  }
  await page.route('**/admin/v1/planning/forecast', (route) => {
    log(route)
    if (!on) return route.fulfill(err(404, 'NOT_FOUND', 'Not found'))
    if (!manager) return route.fulfill(err(403, 'FORBIDDEN', 'Requires manager role'))
    return route.fulfill(json(FORECAST))
  })
  await page.route('**/admin/v1/farms**', (route) => {
    const { req, body } = log(route)
    if (req.method() === 'GET') return route.fulfill(json(FARMS))
    if (!manager) return route.fulfill(err(403, 'FORBIDDEN', 'Requires manager role'))
    const b = body as { name: string; place?: string | null }
    return route.fulfill(json({ ...FARMS[0], id: 'frm9', name: b.name, place: b.place ?? null, phoneMasked: '******4321', purchases: 0, lastPurchaseOn: null }, 201))
  })
  await page.route('**/admin/v1/batches/b1/purchases**', (route) => {
    const { req, body } = log(route)
    if (req.method() === 'GET') {
      const { costPerCrate: _a, transportCost: _b, otherCost: _c, totalCost: _d, costPerBox: _e, ...noCosts } = PURCHASE
      const answer: BatchPurchases = manager
        ? { batchId: 'b1', receivedBoxes: 30, purchasedBoxes: 20, costsShown: true, items: [PURCHASE], totalCost: 2_100_000 }
        : { batchId: 'b1', receivedBoxes: 30, purchasedBoxes: 20, costsShown: false, items: [noCosts] }
      return route.fulfill(json(answer))
    }
    if (!manager) return route.fulfill(err(403, 'FORBIDDEN', 'Requires manager role'))
    const b = body as { boxes: number }
    if (b.boxes > 10) return route.fulfill(err(409, 'PURCHASE_EXCEEDS_BATCH', 'This batch received 30 boxes and its other purchases already account for 20, so this purchase can claim at most 10.'))
    return route.fulfill(json({ ...PURCHASE, ...b, id: 'pur2' }, 201))
  })
  await page.route('**/admin/v1/analytics/margins**', (route) => {
    log(route)
    return route.fulfill(manager ? json(MARGINS) : err(403, 'FORBIDDEN', 'Requires manager role'))
  })
  await page.route('**/admin/v1/settings/switches**', (route) => {
    const { req, path, body } = log(route)
    if (!manager) return route.fulfill(err(403, 'FORBIDDEN', 'Requires manager role'))
    if (req.method() === 'GET') return route.fulfill(json({ cacheSeconds: 30, items: api.switches }))
    const key = path.split('/').pop() ?? ''
    const b = body as { enabled: boolean | null; confirmCode?: string }
    if (!b.confirmCode) return route.fulfill(err(403, 'REAUTH_REQUIRED', 'Enter your password to confirm.', { method: 'password' }))
    if (b.confirmCode !== 'manager123') return route.fulfill(err(403, 'REAUTH_FAILED', 'That password is not right.', { method: 'password' }))
    api.switches = api.switches.map((s) =>
      s.key === key ? { ...s, override: b.enabled, effective: b.enabled ?? s.envValue, updatedBy: b.enabled === null ? null : EMAIL.MANAGER, updatedAt: b.enabled === null ? null : '2026-10-15T05:00:00Z' } : s,
    )
    return route.fulfill(json(api.switches.find((s) => s.key === key)))
  })
  return api
}

async function scan(page: Page, where: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(r.violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([])
}

test('managers see boxes to buy on Planning, with the working; "not enough history" is never shown as 0', async ({ page }) => {
  await ops(page, 'MANAGER')
  await page.goto('/planning')
  const card = page.getByRole('region', { name: 'Boxes to buy' })
  await expect(card.getByText('Buy about 8 boxes')).toBeVisible()
  await expect(card.getByText('picked by 10 Oct 2026').first()).toBeVisible()
  await expect(card.getByText('Not enough history', { exact: true }).first()).toBeVisible()
  await expect(card.getByText('Buy about 0 boxes')).toHaveCount(0)
  await card.getByText('How this was worked out for Alphonso 3kg Box').click()
  await expect(card.getByText('2 boxes damaged or condemned and 0 replaced after a damage claim, against 11 sold in the last 28 days: 15.4%')).toBeVisible()
  const ripe = card.getByRole('region', { name: 'Alphonso 3kg Box, Ripe, day by day' })
  await expect(ripe.getByRole('row').nth(1)).toContainText(/9 Oct 2026: 6 · 2 Oct 2026: 4 · 25 Sept? 2026: 0 · 18 Sept? 2026: closed/)
  await scan(page, 'planning with forecast')
})

test('operators get no forecast on Planning, and never ask for it', async ({ page }) => {
  const api = await ops(page, 'OPERATOR')
  await page.goto('/planning')
  await expect(page.getByRole('heading', { name: 'Stock by delivery date' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Boxes to buy' })).toHaveCount(0)
  expect(api.calls.some((c) => c.path === '/planning/forecast')).toBe(false)
})

test('Farms: managers add a farm and see margins; phones are masked', async ({ page }) => {
  const api = await ops(page, 'MANAGER')
  await page.goto('/today')
  await (await openNavTo(page, 'Farms')).click()
  await expect(page.getByRole('heading', { name: 'Farms', level: 1 })).toBeVisible()
  await expect(page.getByRole('cell', { name: '******3210' })).toBeVisible()
  const margins = page.getByRole('region', { name: 'Margins by variety' })
  await expect(margins.getByRole('row', { name: /Alphonso/ })).toContainText('₹268.20')
  await expect(margins.getByRole('row', { name: /Alphonso/ })).toContainText('₹89.40')

  await page.getByRole('button', { name: 'Add farm' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add farm' })
  await dialog.getByLabel('Name', { exact: true }).fill('Kesar Bagh')
  await dialog.getByLabel('Phone number (optional)').fill('12345')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Enter a 10-digit mobile number, or leave it empty.')
  await dialog.getByLabel('Phone number (optional)').fill('98765 04321')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Kesar Bagh added')).toBeVisible()
  expect(api.calls.find((c) => c.method === 'POST' && c.path === '/farms')?.body).toEqual({ name: 'Kesar Bagh', place: null, contactName: null, phone: '9876504321' })
  await scan(page, 'farms')
})

test('Farms: operators see the list only, with no margins and no way to edit', async ({ page }) => {
  const api = await ops(page, 'OPERATOR')
  await page.goto('/farms')
  await expect(page.getByRole('cell', { name: 'Ratnagiri Orchards' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Add farm/ })).toBeDisabled()
  await expect(page.getByText('Adding and editing farms: requires manager role.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Margins' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0)
  expect(api.calls.some((c) => c.path.startsWith('/analytics/margins'))).toBe(false)
})

test('a batch’s purchase: managers see costs and record one in rupees (sent as paise); the box limit is explained', async ({ page }) => {
  const api = await ops(page, 'MANAGER')
  await page.goto('/batches/b1')
  const card = page.getByRole('region', { name: 'Purchase' })
  await expect(card.getByText('Received 30 boxes; purchases account for 20. Total cost ₹21,000.00.')).toBeVisible()
  await expect(card.getByRole('columnheader', { name: 'Per crate' })).toBeVisible()
  await expect(card.getByRole('cell', { name: '₹1,050.00' })).toBeVisible()

  await card.getByRole('button', { name: 'Add purchase' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add purchase' })
  await dialog.getByLabel('Farm').selectOption('frm1')
  // A switched-off farm is not offered for a new purchase.
  await expect(dialog.getByRole('option', { name: /Devgad/ })).toHaveCount(0)
  await dialog.getByLabel('Bought on').fill('2026-10-14')
  await dialog.getByLabel('Crates').fill('2')
  await dialog.getByLabel('Boxes they made').fill('12')
  await dialog.getByLabel('Cost per crate, in rupees').fill('0')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Enter what one crate cost, in rupees, above 0.')
  await dialog.getByLabel('Cost per crate, in rupees').fill('4,500.50')
  await dialog.getByLabel('Transport, in rupees').fill('750')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByRole('alert')).toContainText('can claim at most 10')
  await dialog.getByLabel('Boxes they made').fill('10')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Purchase recorded')).toBeVisible()
  expect(api.calls.filter((c) => c.method === 'POST' && c.path === '/batches/b1/purchases').map((c) => c.body)).toEqual([
    { farmId: 'frm1', purchasedOn: '2026-10-14', crates: 2, boxes: 12, costPerCrate: 450_050, transportCost: 75_000, otherCost: 0, note: null },
    { farmId: 'frm1', purchasedOn: '2026-10-14', crates: 2, boxes: 10, costPerCrate: 450_050, transportCost: 75_000, otherCost: 0, note: null },
  ])
})

test('a batch’s purchase for operators: where it came from, no money', async ({ page }) => {
  await ops(page, 'OPERATOR')
  await page.goto('/batches/b1')
  const card = page.getByRole('region', { name: 'Purchase' })
  await expect(card.getByRole('cell', { name: 'Ratnagiri Orchards' })).toBeVisible()
  await expect(card.getByRole('columnheader', { name: 'Per crate' })).toHaveCount(0)
  await expect(card.getByText(/₹/)).toHaveCount(0)
  await expect(card.getByRole('button', { name: /Add purchase/ })).toBeDisabled()
})

test('Settings: a manager turns a feature on after confirming the password; the server’s off can’t be overruled', async ({ page }) => {
  const api = await ops(page, 'MANAGER')
  await page.goto('/today')
  await (await openNavTo(page, 'Settings')).click()
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await expect(page.getByText('Turned off on the server. That always wins, so it can’t be turned on here.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Turn on Sort and filter' })).toBeDisabled()

  await page.getByRole('button', { name: 'Turn on Favourites' }).click()
  const confirm = page.getByRole('dialog', { name: "Confirm it's you" })
  await expect(confirm.getByText('Turning a feature on or off changes the shop for every customer')).toBeVisible()
  await confirm.getByLabel('Your password').fill('wrong')
  await confirm.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByRole('dialog', { name: "Confirm it's you" }).getByRole('alert')).toHaveText('That password is not right.')
  await page.getByRole('dialog', { name: "Confirm it's you" }).getByLabel('Your password').fill('manager123')
  await page.getByRole('dialog', { name: "Confirm it's you" }).getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByText('Favourites is on')).toBeVisible()
  await expect(page.getByText('Turned on here by manager@mandimangoes.test')).toBeVisible()
  expect(api.calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([
    { enabled: true },
    { enabled: true, confirmCode: 'wrong' },
    { enabled: true, confirmCode: 'manager123' },
  ])
  await scan(page, 'settings')
})

test('Settings and Farms are for their roles and switches only', async ({ page }) => {
  await ops(page, 'OPERATOR')
  await page.goto('/today')
  await expect(await openNavTo(page, 'Farms')).toBeVisible()
  await expect(navLinkAnyState(page, 'Settings')).toHaveCount(0)
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toHaveCount(0)
})

test('with the switches off, managers get no Farms, Settings or forecast', async ({ page }) => {
  const api = await ops(page, 'MANAGER', false)
  await page.goto('/planning')
  await expect(page.getByRole('heading', { name: 'Stock by delivery date' })).toBeVisible()
  await expect(navLinkAnyState(page, 'Farms')).toHaveCount(0)
  await expect(navLinkAnyState(page, 'Settings')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Boxes to buy' })).toHaveCount(0)
  await page.goto('/batches/b1')
  await expect(page.getByRole('heading', { name: 'Stock' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Purchase' })).toHaveCount(0)
  expect(api.calls.some((c) => ['/planning/forecast', '/farms', '/settings/switches', '/batches/b1/purchases'].includes(c.path))).toBe(false)
})
