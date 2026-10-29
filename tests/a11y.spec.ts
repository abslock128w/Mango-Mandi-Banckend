import AxeBuilder from '@axe-core/playwright'
import { expect, openAccount, test } from './fixtures'
import { mockApi } from './mock-api'

const WCAG = ['wcag2a', 'wcag2aa']

async function scan(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

test('login page has no WCAG A/AA violations', async ({ page }) => {
  await mockApi(page)
  await page.goto('/login')
  await expect(page.getByLabel('Work email')).toBeVisible()
  await scan(page)
})

test('login with session banner has no WCAG A/AA violations', async ({ page }) => {
  await mockApi(page)
  await page.goto('/login?reason=expired')
  await expect(page.getByText('Your session has ended')).toBeVisible()
  await scan(page)
})

test('keyboard reaches email, password, then sign in', async ({ page }) => {
  await mockApi(page)
  await page.goto('/login')
  await expect(page.getByLabel('Work email')).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Work email')).toBeFocused()
  await page.getByLabel('Work email').fill('a@b.c')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Password')).toBeFocused()
  await page.getByLabel('Password').fill('x')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeFocused()
})

// Every signed-in panel page. Each spec runs in the phone and the desktop project.
const PAGES = [
  '/today',
  '/batches',
  '/batches/b1',
  '/orders',
  '/orders/o1',
  '/pack-list',
  '/deliveries',
  '/claims',
  '/pincodes',
  '/planning',
  '/preorders',
  '/analytics',
  '/staff',
  '/reviews',
  '/products',
  '/promos',
  '/two-step',
  '/no-such-page',
]

for (const path of PAGES) {
  test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
    await mockApi(page, { signedIn: true })
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0)
    await scan(page)
  })
}

test('the set-up-two-step gate has no WCAG A/AA violations', async ({ page }) => {
  await mockApi(page, { signedIn: true, twoStep: 'required' })
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Set up two-step sign-in' })).toBeVisible()
  await scan(page)
})

// ---------- Menus ----------

test('the phone menu, open, has no WCAG A/AA violations', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await mockApi(page, { signedIn: true })
  await page.goto('/today')
  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Staff' })).toBeVisible()
  await scan(page)
})

test('the desktop sidebar and the account menu, open, have no WCAG A/AA violations', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockApi(page, { signedIn: true })
  await page.goto('/today')
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pack list' })).toBeVisible()
  await scan(page)
  const account = await openAccount(page)
  await expect(account.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await scan(page)
})

test('the command palette, open, has no WCAG A/AA violations', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Search' }).click()
  const palette = page.getByRole('dialog', { name: 'Search and jump to' })
  await expect(palette.getByRole('option').first()).toBeVisible()
  await scan(page)
})

// ---------- Dialogs ----------

test('Receive batch and the write-off reason dialog have no WCAG A/AA violations', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/batches')
  await page.getByRole('button', { name: 'Receive batch' }).click()
  await expect(page.getByRole('dialog', { name: 'Receive batch' }).getByLabel(/Alphonso 3kg Box/)).toBeVisible()
  await scan(page)

  await page.goto('/batches/b1')
  await page.getByRole('button', { name: 'Move to Exhausted' }).click()
  await expect(page.getByRole('dialog', { name: 'Write off the rest of this batch?' })).toBeVisible()
  await scan(page)
})

test('the condemn confirm dialog has no WCAG A/AA violations', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/batches/b1')
  await page.getByRole('button', { name: 'Condemn batch' }).click()
  await expect(page.getByRole('button', { name: 'Condemn and move orders' })).toBeVisible()
  await scan(page)
})

test('order dialogs (confirm, reason, couldn\'t deliver) have no WCAG A/AA violations', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  api.order = { ...api.order, status: 'DELIVERY_FAILED' }
  await page.goto('/orders/o1')
  await page.getByRole('button', { name: 'Mark as returned' }).click()
  await expect(page.getByRole('dialog', { name: 'Mark ORD-1042 as returned?' })).toBeVisible()
  await scan(page)

  api.order = { ...api.order, status: 'OUT_FOR_DELIVERY' }
  await page.reload()
  await page.getByRole('button', { name: 'Mark delivered', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Mark ORD-1042 delivered without proof?' })).toBeVisible()
  await scan(page)

  await page.reload()
  await page.getByRole('button', { name: 'Delivery failed' }).click()
  const missed = page.getByRole('dialog', { name: "Couldn't deliver ORD-1042" })
  await missed.getByRole('button', { name: 'Save' }).click()
  await expect(missed.getByRole('alert')).toHaveText('Pick what happened.')
  await scan(page)
})

test('the rider flow on a phone has no WCAG A/AA violations', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const api = await mockApi(page, { signedIn: true, role: 'RIDER' })
  api.manifest.runs[0].stops[0].orders[0].status = 'OUT_FOR_DELIVERY'
  await page.goto('/deliveries?date=2026-10-16')
  const stop = page.getByRole('list', { name: 'Morning · 07:00–11:00, 400001' })
  await expect(stop).toBeVisible()
  await scan(page)

  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Deliveries' })).toBeVisible()
  await scan(page)
  await page.keyboard.press('Escape')

  await stop.getByRole('button', { name: 'Delivered ORD-1042' }).click()
  const deliver = page.getByRole('dialog', { name: 'Deliver ORD-1042' })
  await deliver.getByRole('button', { name: 'Mark delivered' }).click()
  await expect(deliver.getByRole('alert')).toBeVisible()
  await scan(page)
  await deliver.getByRole('button', { name: 'No code? Leave it with someone and take a photo' }).click()
  await expect(deliver.getByLabel('Photo of the handover')).toBeAttached()
  await scan(page)
  await page.keyboard.press('Escape')
  await expect(deliver).toHaveCount(0)

  await stop.getByRole('button', { name: "Couldn't deliver ORD-1042" }).click()
  await expect(page.getByRole('dialog', { name: "Couldn't deliver ORD-1042" })).toBeVisible()
  await scan(page)
})

test('Products, Promos and Staff dialogs have no WCAG A/AA violations', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/products')
  await page.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByRole('dialog', { name: 'Add product' })).toBeVisible()
  await scan(page)

  await page.goto('/products')
  await page.getByRole('button', { name: /^Remove Alphonso 5kg Box/ }).click()
  await expect(page.getByRole('dialog', { name: 'Remove Alphonso 5kg Box?' })).toBeVisible()
  await scan(page)

  await page.goto('/promos')
  await page.getByRole('button', { name: 'New promo code' }).click()
  await expect(page.getByRole('dialog', { name: 'New promo code' })).toBeVisible()
  await scan(page)

  await page.goto('/staff')
  await page.getByRole('button', { name: 'Add person' }).click()
  await expect(page.getByRole('dialog', { name: 'Add person' })).toBeVisible()
  await scan(page)
})

test('Reviews: the reject-with-a-reason dialog has no WCAG A/AA violations', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/reviews')
  await page.getByLabel('Select all shown reviews').check()
  await page.getByRole('button', { name: 'Reject 2' }).click()
  await expect(page.getByRole('dialog', { name: 'Reject 2 reviews' })).toBeVisible()
  await scan(page)
})

// ---------- Keyboard ----------

test('Tab 1 is "Skip to content", and it moves focus to the page', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/orders')
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible()
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  await page.keyboard.press('Enter')
  await expect(page.locator('main#main')).toBeFocused()
  // The next Tab goes into the page, not back to the menu.
  await page.keyboard.press('Tab')
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('main'))).toBe(true)
})

test('phone: the tab bar has the main screens, Menu opens the rest with focus inside, Escape closes it', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await mockApi(page, { signedIn: true })
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  const header = await page.locator('.app-header').boundingBox()
  expect(header!.height).toBeLessThanOrEqual(64)

  const menu = page.getByRole('button', { name: 'Menu' })
  const nav = page.getByRole('navigation', { name: 'Main' })
  // The tab bar: the manager's four main screens, always in view at the bottom.
  for (const name of ['Today', 'Orders', 'Pack list', 'Deliveries']) await expect(nav.getByRole('link', { name, exact: true })).toBeInViewport()
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(nav.getByRole('link', { name: 'Batches', exact: true })).toBeHidden()
  await menu.focus()
  await page.keyboard.press('Enter')
  await expect(menu).toHaveAttribute('aria-expanded', 'true')
  // The sheet starts with what the tab bar doesn't have.
  await expect(nav.getByRole('link', { name: 'Batches', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(nav.getByRole('link', { name: 'Planning', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(menu).toBeFocused()
  await expect(nav.getByRole('link', { name: 'Batches', exact: true })).toBeHidden()

  // Choosing a link closes the menu and puts focus on the new page.
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/batches$/)
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('main#main')).toBeFocused()
})

test('desktop: the sidebar shows every group, and collapses to icons that keep their names', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockApi(page, { signedIn: true })
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden()
  for (const name of ['Today', 'Orders', 'Batches', 'Claims', 'Staff']) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible()
  const batches = nav.getByRole('link', { name: 'Batches', exact: true })
  const wide = (await batches.boundingBox())!.width

  await nav.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(batches).toBeVisible()
  expect((await batches.boundingBox())!.width).toBeLessThan(wide / 2)
  await expect(batches).toHaveAttribute('title', 'Batches')
  // The choice is remembered.
  await page.reload()
  await expect(nav.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  await nav.getByRole('button', { name: 'Expand sidebar' }).click()
  await expect(nav.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
})

test('Ctrl+K opens the command palette: arrow to a screen, or search orders for what was typed', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Search and jump to' })
  const box = palette.getByRole('combobox', { name: 'Search screens, orders, batches and pincodes' })
  await expect(box).toBeFocused()
  await box.fill('pack')
  await expect(palette.getByRole('option', { name: /Pack list/ })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/pack-list/)
  await expect(palette).toHaveCount(0)

  await page.keyboard.press('Control+k')
  await box.fill('1042')
  const search = palette.getByRole('option', { name: 'Search orders for “1042”' })
  await expect(search).toBeVisible()
  await search.click()
  await expect(page).toHaveURL(/\/orders\?q=1042/)

  // Escape closes it.
  await page.keyboard.press('Control+k')
  await page.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)
})

test('batch detail: QC and Ledger are real tabs with arrow keys', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/batches/b1')
  const qc = page.getByRole('tab', { name: 'QC' })
  const ledger = page.getByRole('tab', { name: 'Ledger' })
  await expect(qc).toHaveAttribute('aria-selected', 'true')
  await expect(ledger).toHaveAttribute('tabindex', '-1')
  await qc.focus()
  await page.keyboard.press('ArrowRight')
  await expect(ledger).toBeFocused()
  await expect(ledger).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel', { name: 'Ledger' })).toContainText('+20')
  await page.keyboard.press('ArrowRight')
  await expect(qc).toBeFocused()
  await expect(page.getByRole('tabpanel', { name: 'QC' })).toBeVisible()
  await page.keyboard.press('End')
  await expect(ledger).toBeFocused()
  await scan(page)
})

// ---------- Titles ----------

test('every panel page has its own title', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  const titles: string[] = []
  for (const path of PAGES) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0)
    await expect(page).toHaveTitle(/ · Mango Ops$/)
    titles.push(await page.title())
  }
  // Signed out, for the sign-in page.
  await mockApi(page)
  await page.goto('/login')
  await expect(page.getByLabel('Work email')).toBeVisible()
  await expect(page).toHaveTitle(/ · Mango Ops$/)
  titles.push(await page.title())
  expect(titles.filter((t, i) => titles.indexOf(t) !== i)).toEqual([])
})
