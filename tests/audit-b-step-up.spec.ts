import AxeBuilder from '@axe-core/playwright'
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { mockApi } from './mock-api'

// SEC-07 (24 Oct 2026 audit): with STAFF_STEP_UP on, the API answers a staff change
// without the manager's confirmation with 403 REAUTH_REQUIRED. The Staff page asks
// for the authenticator code or password and sends the same change again with it.

/** Puts the API's step-up check in front of the mock's staff routes (method: what the server asks for). */
async function stepUp(page: Page, method: 'password' | 'code') {
  const good = method === 'code' ? '123456' : 'manager123'
  await page.route('**/admin/v1/staff**', async (route: Route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (req.method() === 'GET' || path.endsWith('/sign-out-all')) return route.fallback()
    const body = (req.postDataJSON() ?? {}) as { confirmCode?: string }
    const refuse = (code: string, message: string) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code, message, method, requestId: 'req_1' } }) })
    if (!body.confirmCode) return refuse('REAUTH_REQUIRED', method === 'code' ? 'Enter the 6-digit code from your authenticator app to confirm.' : 'Enter your password to confirm.')
    if (body.confirmCode !== good) return refuse('REAUTH_FAILED', method === 'code' ? 'That code is not right, or was already used. Wait for the next one.' : 'That password is not right.')
    return route.fallback()
  })
}

test('adding a person asks for the password, says when it is wrong, then adds them', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await stepUp(page, 'password')
  await page.goto('/staff')
  await page.getByRole('button', { name: 'Add person' }).click()
  const add = page.getByRole('dialog', { name: 'Add person' })
  await add.getByLabel('Work email').fill('ravi@mandimangoes.test')
  await add.getByLabel('First password').fill('long-enough-1')
  await add.getByRole('button', { name: 'Add' }).click()

  const confirm = page.getByRole('dialog', { name: "Confirm it's you" })
  const field = confirm.getByLabel('Your password')
  await expect(field).toBeFocused()
  await expect(field).toHaveAttribute('type', 'password')
  await field.fill('wrong-one')
  await field.press('Enter')
  await expect(page.getByRole('dialog', { name: "Confirm it's you" }).getByRole('alert')).toHaveText('That password is not right.')
  await page.getByRole('dialog', { name: "Confirm it's you" }).getByLabel('Your password').fill('manager123')
  await page.getByRole('dialog', { name: "Confirm it's you" }).getByRole('button', { name: 'Confirm' }).click()

  await expect(page.getByText('ravi@mandimangoes.test added as Packer')).toBeVisible()
  await expect(page.getByRole('dialog', { name: "Confirm it's you" })).toHaveCount(0)
  expect(api.calls.filter((c) => c.method === 'POST' && c.path === '/staff').map((c) => c.body)).toEqual([
    { email: 'ravi@mandimangoes.test', role: 'PACKER', password: 'long-enough-1', confirmCode: 'manager123' },
  ])
})

test('removing someone with two-step on asks for the code; Escape and Cancel change nothing', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await stepUp(page, 'code')
  await page.goto('/staff')
  await page.getByRole('button', { name: 'Remove ops@mandimangoes.test' }).click()
  const removeDialog = page.getByRole('dialog', { name: 'Remove ops@mandimangoes.test?' })
  await removeDialog.getByRole('button', { name: 'Remove' }).click()

  const confirm = page.getByRole('dialog', { name: "Confirm it's you" })
  await expect(confirm.getByLabel('Code from your authenticator app')).toBeFocused()
  // Escape closes only the confirmation; the Remove dialog stays, saying why nothing happened.
  await page.keyboard.press('Escape')
  await expect(confirm).toHaveCount(0)
  await expect(removeDialog).toBeVisible()
  await expect(removeDialog.getByRole('alert')).toContainText('Enter the 6-digit code from your authenticator app to confirm.')
  expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false)

  await removeDialog.getByRole('button', { name: 'Remove' }).click()
  await confirm.getByLabel('Code from your authenticator app').fill('12')
  await confirm.getByRole('button', { name: 'Confirm' }).click()
  await expect(confirm.getByRole('alert')).toHaveText('Enter the 6 digits from your authenticator app.')
  await confirm.getByLabel('Code from your authenticator app').fill('123 456')
  await confirm.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByText('ops@mandimangoes.test removed')).toBeVisible()
  expect(api.calls.find((c) => c.method === 'DELETE')?.body).toEqual({ confirmCode: '123456' })
})

test("the confirmation has no WCAG A/AA violations and fits a 375px phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await mockApi(page, { signedIn: true })
  await stepUp(page, 'code')
  await page.goto('/staff')
  await page.getByRole('button', { name: 'Setup code for packer@mandimangoes.test' }).click()
  const confirm = page.getByRole('dialog', { name: "Confirm it's you" })
  await expect(confirm).toBeVisible()
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.map((v) => v.id)).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  for (const name of ['Cancel', 'Confirm']) {
    const box = (await confirm.getByRole('button', { name }).boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
  await confirm.getByLabel('Code from your authenticator app').fill('123456')
  await confirm.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByRole('dialog', { name: 'Setup code for packer@mandimangoes.test' })).toBeVisible()
})

test('turning two-step on from a signed-in session asks for the password first', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const api = await mockApi(page, { signedIn: true })
  // The API's step-up check on POST /me/two-step/setup (an ordinary session, two-step off).
  await page.route('**/admin/v1/me/two-step/setup', async (route: Route) => {
    const body = (route.request().postDataJSON() ?? {}) as { confirmCode?: string }
    if (body.confirmCode === 'manager123') return route.fallback()
    const [code, message] = body.confirmCode ? ['REAUTH_FAILED', 'That password is not right.'] : ['REAUTH_REQUIRED', 'Enter your password to confirm.']
    return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code, message, method: 'password', requestId: 'req_1' } }) })
  })
  await page.goto('/two-step')
  await page.getByRole('button', { name: 'Set up two-step sign-in' }).click()
  const confirm = page.getByRole('dialog', { name: "Confirm it's you" })
  await expect(confirm).toContainText('Turning on two-step sign-in needs your password')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.map((v) => v.id)).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  // Cancel: no secret is shown, and the page says why.
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('alert')).toContainText('Enter your password to confirm.')
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Set up two-step sign-in' }).click()
  await confirm.getByLabel('Your password').fill('manager123')
  await confirm.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible()
  expect(api.calls.filter((c) => c.path === '/me/two-step/setup').map((c) => c.body)).toEqual([{ confirmCode: 'manager123' }])
})

// SEC-08: views of customer details are in the activity log only when asked for.
test('Activity can include views of customer details', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/staff')
  const box = page.getByRole('checkbox', { name: 'Include views of customer details' })
  await expect(box).not.toBeChecked()
  const asked = page.waitForRequest((r) => r.url().includes('/admin/v1/audit') && r.url().includes('reads=true'))
  await box.check()
  await asked
  await expect(page).toHaveURL(/reads=1/)
  const label = (await page.locator('label.check-row').boundingBox())!
  expect(label.height).toBeGreaterThanOrEqual(44)
})
