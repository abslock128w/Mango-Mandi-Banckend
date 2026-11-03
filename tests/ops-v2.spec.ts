import AxeBuilder from '@axe-core/playwright'
import { expect, openAccount, test } from './fixtures'
import { mockApi, mockLive, type MockState } from './mock-api'
import type { DayPlan } from '../src/ops/types'

// Mango Ops v2 (docs/design/ops-dashboard-v2.md) against the mock API: the control tower on Today,
// the Attention bell, shortcuts and density, the Dispatch board (its list; the map is drawn
// without tiles), the Orders workbench, the palette's actions and the Operations analytics.
// Every new screen and drawer is scanned with axe at the phone and desktop sizes (both projects).

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
async function scan(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString()

/** Today's plan with one slot whose pack-by is 10 minutes away and two orders still to pack. */
function busyDay(): DayPlan {
  return {
    date: todayIST(),
    now: new Date().toISOString(),
    rules: { packLeadMinutes: 60, dispatchLeadMinutes: 15, orderCutoff: null },
    slots: [
      {
        id: 'slt1', label: 'Morning', startsAt: '07:00', endsAt: '11:00', capacityBoxes: 40,
        orderCutoffAt: null, packByAt: inMin(10), dispatchByAt: inMin(55), windowStartAt: inMin(70), windowEndAt: inMin(310),
        counts: { waiting: 2, packed: 3, out: 1, delivered: 4, failed: 0 }, orders: 10, boxes: 14, unassigned: 0,
      },
    ],
    unslotted: null,
  }
}

/** A rider out with stops left whose phone went quiet 41 minutes ago. */
function silentRider(api: MockState) {
  const board = mockLive(api, todayIST())
  board.riders = [{ id: 'adm9', name: 'Ravi Kumar', email: 'ravi@mandimangoes.test', phone: null, lastAt: inMin(-41), lat: 18.97, lng: 72.83, accuracy: 10, stopsLeft: 3, stopsDone: 1 }]
  api.liveBoard = board
}

test('Today: the Attention queue ranks problems with an owner and one action, and a snooze hides one until tomorrow', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  api.dayPlan = busyDay()
  silentRider(api)
  api.attention = { ...api.attention, stuckRefunds: [{ type: 'order', id: 'o2', number: 'ORD-1040', requestedAt: '2026-10-15T02:00:00Z', state: 'needs_manager', attempts: 4 }] }
  await page.goto('/today')
  const queue = page.getByRole('region', { name: 'Attention' }).first()
  await expect(queue.getByRole('heading', { name: 'Attention', exact: true })).toBeVisible()
  const now = queue.getByRole('list', { name: /^Now: / })
  await expect(now.getByRole('listitem').first()).toContainText('Refund not sent · ORD-1040')
  await expect(now.getByRole('listitem').first()).toContainText('Manager')
  const soon = queue.getByRole('list', { name: /^Soon: / })
  await expect(soon).toContainText('Morning: 2 orders not packed')
  await expect(soon).toContainText('Rider silent · Ravi Kumar')
  await expect(soon.getByRole('link', { name: /^Open pack list/ })).toHaveAttribute('href', `/pack-list?date=${todayIST()}`)
  // The playbook for the refund is under the queue, and its Fix link lands there.
  await expect(now.getByRole('link', { name: /^Fix\W+Refund not sent/ })).toHaveAttribute('href', '/today#attention-refunds')

  await soon.getByRole('button', { name: 'More for Rider silent · Ravi Kumar' }).click()
  await page.getByRole('button', { name: 'Snooze until tomorrow' }).click()
  await expect(page.getByText('Snoozed until tomorrow on this browser').first()).toBeVisible()
  await expect(soon).not.toContainText('Rider silent')
  await expect(queue).toContainText('1 snoozed until tomorrow on this browser.')
  await page.reload()
  await expect(page.getByRole('list', { name: /^Soon: / })).not.toContainText('Rider silent')
  await scan(page)
})

test('Today: the Day strip shows each slot with its deadline, and the Live row who is out', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  api.dayPlan = busyDay()
  silentRider(api)
  await page.goto('/today')
  const strip = page.getByRole('region', { name: 'The day' }).or(page.locator('section', { has: page.getByRole('heading', { name: 'The day' }) }))
  const lane = strip.getByRole('link', { name: /^Morning, 07:00 to 11:00: 10 orders/ })
  await expect(lane).toHaveAttribute('href', `/deliveries?date=${todayIST()}&tab=slot&slot=slt1`)
  await expect(lane).toHaveAccessibleName(/Pack by \d\d:\d\d · due in (9|10) min/)
  const live = page.locator('section', { has: page.getByRole('heading', { name: 'On the road' }) })
  await expect(live.getByRole('link', { name: /Riders out 1 of 1/ })).toBeVisible()
  await expect(live.getByRole('region', { name: 'Riders and stops left today' })).toBeVisible()
  await scan(page)
})

test('the Attention bell counts the queue and opens it in a drawer from any page', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  api.dayPlan = busyDay()
  await page.goto('/orders')
  const bell = page.getByRole('button', { name: /^Attention: 1 item/ })
  await expect(bell).toBeVisible()
  await bell.click()
  const drawer = page.getByRole('dialog', { name: 'Attention' })
  await expect(drawer.getByRole('list', { name: 'Attention queue' }).getByRole('listitem')).toHaveCount(1)
  await expect(drawer).toContainText('Morning: 2 orders not packed')
  await scan(page)
  await drawer.getByRole('link', { name: /^Open pack list/ }).click()
  await expect(page).toHaveURL(/\/pack-list\?date=/)
  await expect(drawer).toHaveCount(0)
})

test('packers and QC get no bell and no live dot', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'PACKER' })
  await page.goto('/pack-list')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Attention/ })).toHaveCount(0)
})

test('? opens the shortcut sheet; g then o goes to Orders; density is a choice in the account menu', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  await page.keyboard.press('Shift+?')
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(sheet).toContainText('Go to Orders')
  await scan(page)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await page.keyboard.press('g')
  await page.keyboard.press('o')
  await expect(page).toHaveURL(/\/orders$/)
  // Not while typing in a field.
  await page.getByLabel('Search by order number, phone, name or address').fill('gd')
  await expect(page).toHaveURL(/\/orders/)

  const menu = await openAccount(page)
  await menu.getByRole('button', { name: 'Compact' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact')
  await menu.getByRole('button', { name: 'By pointer' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-density', /.+/)
})

test('a new paid order on the event stream raises a toast', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  api.eventStream = `event: hello\ndata: {"at":"x"}\n\nevent: order.changed\ndata: {"id":"o9","number":"ORD-2001","status":"CONFIRMED","date":"2026-10-16"}\n\n`
  await page.goto('/today')
  await expect.poll(() => api.calls.filter((c) => c.path === '/events').length).toBeGreaterThan(0)
  await expect(page.getByText('New paid order ORD-2001').first()).toBeVisible()
})

test('Dispatch board: unassigned stops on top, choose some and give them to the nearest riders', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  api.riders = [{ id: 'adm9', email: 'ravi@mandimangoes.test', name: 'Ravi Kumar' }]
  await page.goto('/deliveries?date=2026-10-16&tab=unassigned')
  const tabs = page.getByRole('tablist', { name: 'Stops' })
  await expect(tabs.getByRole('tab', { name: 'Unassigned (2)' })).toHaveAttribute('aria-selected', 'true')
  const list = page.getByRole('list', { name: 'Stops without a rider' })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await list.getByRole('checkbox', { name: 'Select ORD-1042' }).check()
  const bar = page.getByRole('region', { name: 'Selected stops' })
  await expect(bar.getByRole('status')).toHaveText('1 selected')
  await scan(page)
  await bar.getByRole('button', { name: 'Assign nearest' }).click()
  await expect(page.getByText('2 stops given to the nearest riders')).toBeVisible()
  expect(api.calls.find((c) => c.path === '/manifest/auto-assign')?.body).toEqual({ date: '2026-10-16', orderIds: ['o1'] })
  await expect(page.getByRole('status', { name: 'Nearest riders' })).toContainText('ORD-1042: Ravi Kumar, 1.2 km away, pick up at Electronic City hub')
})

test('Dispatch board: assign the chosen stops to a rider, keyboard x selects, and a stop opens in the peek', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  api.riders = [{ id: 'adm9', email: 'ravi@mandimangoes.test', name: 'Ravi Kumar' }]
  await page.goto('/deliveries?date=2026-10-16&tab=unassigned')
  const list = page.getByRole('list', { name: 'Stops without a rider' })
  await list.getByRole('listitem', { name: 'ORD-1044' }).focus()
  await page.keyboard.press('x')
  await expect(list.getByRole('checkbox', { name: 'Select ORD-1044' })).toBeChecked()
  await page.getByLabel('Assign the selected stops to').selectOption('adm9')
  await expect(page.getByText('1 stop given to Ravi Kumar')).toBeVisible()
  expect(api.calls.find((c) => c.path === '/manifest/assign')?.body).toEqual({ date: '2026-10-16', riderId: 'adm9', orderIds: ['o3'] })

  await list.getByRole('button', { name: 'ORD-1042' }).click()
  await expect(page).toHaveURL(/stop=o1/)
  const peek = page.getByRole('dialog', { name: 'Stop ORD-1042' })
  await expect(peek).toContainText('12 Marine Drive, 400001')
  await expect(peek.getByRole('link', { name: 'Open full page' })).toHaveAttribute('href', '/orders/o1')
  await scan(page)
  await page.keyboard.press('Escape')
  await expect(peek).toHaveCount(0)
})

test('Dispatch board: By rider lists each rider with when they were last seen; By slot is the run sheet', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  api.riders = [{ id: 'adm9', email: 'ravi@mandimangoes.test', name: 'Ravi Kumar' }]
  await page.goto('/deliveries?date=2026-10-16')
  // By slot by default: the run sheet as before.
  await expect(page.getByRole('heading', { name: 'Morning · 07:00–11:00' })).toBeVisible()
  await page.getByRole('tab', { name: 'By rider' }).click()
  const lane = page.getByRole('region', { name: 'Ravi Kumar' })
  await expect(lane).toContainText(/Seen \d+ min ago/)
  await expect(lane).toContainText('No stops on this day.')
  await page.getByRole('tab', { name: 'Done (0)' }).click()
  await expect(page.getByText('Nothing delivered yet on this day.')).toBeVisible()
  await scan(page)
})

test('Dispatch board below 1024px: List and Map switch, and the map lists its places', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page, { signedIn: true })
  await page.goto('/deliveries?date=2026-10-16&tab=unassigned')
  const show = page.getByRole('group', { name: 'Show the board as' })
  await expect(show.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
  await show.getByRole('button', { name: 'Map' }).click()
  const map = page.getByRole('region', { name: "Map of the day's stops, riders and warehouses" })
  await expect(map).toBeVisible()
  await expect(page.getByRole('list', { name: 'Stops without a rider' })).toBeHidden()
  // The pin for 400001 carries both stops; the warehouse and the rider are on it too.
  await expect(map.locator('[title^="400001 · South: ORD-1042, ORD-1044"]')).toHaveCount(1)
  await expect(map.locator('[title="Byculla mandi (warehouse)"]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Fit to stops' })).toBeVisible()
  await scan(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('riders keep their own route view: no board, no map', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'RIDER' })
  await page.goto('/deliveries?date=2026-10-16')
  await expect(page.getByRole('heading', { name: 'Deliveries', level: 1 })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Stops' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: /^Map of/ })).toHaveCount(0)
})

test('Orders workbench: saved views, sorting, the bulk bar and the peek', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'column headers are for wide screens; the phone test below covers the cards')
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/orders')
  const views = page.getByRole('navigation', { name: 'Saved views' })
  await expect(views.getByRole('link', { name: 'All orders' })).toHaveAttribute('aria-current', 'true')
  await views.getByRole('link', { name: 'Failed deliveries' }).click()
  await expect(page).toHaveURL(/status=DELIVERY_FAILED/)
  await expect.poll(() => api.calls.some((c) => c.path === '/orders' && c.method === 'GET')).toBe(true)
  await views.getByRole('link', { name: 'All orders' }).click()

  const table = page.getByRole('region', { name: 'Orders' })
  await table.getByRole('button', { name: 'Total' }).click()
  await expect(table.locator('tbody tr').first()).toContainText('ORD-1043')
  await expect(table.getByRole('columnheader', { name: 'Total' })).toHaveAttribute('aria-sort', 'ascending')

  await table.getByRole('checkbox', { name: 'Select all 2 on this page' }).check()
  const bulk = page.getByRole('region', { name: 'Selected rows' })
  await expect(bulk.getByRole('status')).toHaveText('2 selected')
  await expect(bulk.getByRole('button', { name: 'Export CSV' })).toBeVisible()
  await scan(page)
  // Only the order being packed is sent; the API (and the mock) still wants its boxes allocated first.
  await bulk.getByRole('button', { name: 'Mark packed' }).click()
  await expect(page.getByText('Allocate the stock before marking the order packed')).toBeVisible()
  expect(api.calls.filter((c) => c.method === 'PATCH' && c.path === '/orders/o1/status').map((c) => c.body)).toEqual([{ status: 'PACKED' }])

  await table.getByRole('button', { name: 'Peek at ORD-1042' }).click()
  const peek = page.getByRole('dialog', { name: 'Order ORD-1042' })
  await expect(peek).toBeVisible()
  await expect(page).toHaveURL(/peek=o1/)
  await scan(page)
  await page.keyboard.press('o')
  await expect(page).toHaveURL(/\/orders\/o1$/)
})

test('Orders workbench: j and k move between rows, Enter peeks, and columns can be hidden', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'keyboard rows and the column chooser on a wide screen')
  await mockApi(page, { signedIn: true })
  await page.goto('/orders')
  const table = page.getByRole('region', { name: 'Orders' })
  await table.locator('tbody tr').first().focus()
  await page.keyboard.press('j')
  await expect(table.locator('tbody tr').nth(1)).toBeFocused()
  await page.keyboard.press('k')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Order ORD-1042' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Columns' }).click()
  await page.getByRole('checkbox', { name: 'Placed' }).uncheck()
  await expect(table.getByRole('columnheader', { name: 'Placed' })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Orders' }).getByRole('columnheader', { name: 'Placed' })).toHaveCount(0)
})

test('Orders workbench on a phone: cards with a checkbox and a peek button each', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page, { signedIn: true })
  await page.goto('/orders')
  const table = page.getByRole('region', { name: 'Orders' })
  await table.getByRole('checkbox', { name: 'Select ORD-1042' }).check()
  await expect(page.getByRole('region', { name: 'Selected rows' }).getByRole('status')).toHaveText('1 selected')
  await scan(page)
  await table.getByRole('button', { name: 'Peek at ORD-1042' }).click()
  await expect(page.getByRole('dialog', { name: 'Order ORD-1042' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('the palette lists actions with >, jumps to an order with #1042, and remembers what was opened', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Search and jump to' })
  const box = palette.getByRole('combobox')
  await box.fill('>receive')
  await expect(palette.getByRole('option')).toHaveCount(1)
  await expect(palette.getByRole('option', { name: 'Receive a batch' })).toBeVisible()
  await box.fill('#1042')
  await expect(palette.getByRole('option', { name: /^ORD-1042/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/orders\/o1$/)
  await page.keyboard.press('Control+k')
  await expect(palette.getByRole('option', { name: /^ORD-1042/ })).toBeVisible()
  await scan(page)
})

test('Analytics: Operations compares the period with the one before, every chart with its figures', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/analytics')
  const ops = page.locator('section', { has: page.getByRole('heading', { name: 'Operations' }) })
  await expect(ops).toContainText('On time')
  await expect(ops).toContainText('90%')
  await expect(ops.getByRole('table').first()).toContainText('Ravi Kumar')
  await expect(ops.getByRole('list', { name: 'Slot fill' })).toContainText('65%')
  await expect(ops.getByRole('region', { name: 'Map of orders by pincode' })).toBeVisible()
  await expect.poll(() => api.calls.filter((c) => c.path === '/analytics/ops').length).toBeGreaterThanOrEqual(2)
  await ops.getByRole('button', { name: 'Last 30 days' }).click()
  await expect(page).toHaveURL(/ofrom=/)
  await scan(page)
})
