import { expect, test } from './fixtures'
import { mockApi } from './mock-api'

// Light and dark: the computer's setting by default, the switch overrides it, and the choice
// survives a reload without a flash of the other theme.
const bg = (page: import('@playwright/test').Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)

test('dark by the computer setting, light by the switch, kept across a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await mockApi(page, { signedIn: true })
  await page.goto('/today')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(await bg(page)).toBe('rgb(18, 17, 16)') // --color-bg dark #121110
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await bg(page)).toBe('rgb(251, 248, 243)') // --color-bg light #fbf8f3
  // The saved choice is applied before the app draws: no dark flash on reload.
  await page.reload({ waitUntil: 'commit' })
  await page.waitForSelector('body')
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light')
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible()
})
