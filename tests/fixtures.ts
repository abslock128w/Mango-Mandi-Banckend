import { test as base, expect } from '@playwright/test'

// Every test fails if the page logs a console error or throws. The exceptions
// are the browser's own "Failed to load resource" line for 4xx responses a test
// deliberately mocks (e.g. a 401 from /auth/refresh), and, in WebKit only, its
// "Fetch API cannot load <url> due to access control checks" line: WebKit logs
// that for a request it cancels when the page changes, which a test does often.
// The requests here are all answered by the mock API, and Chromium (the same
// tests) still fails on any real fetch error.
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = []
      const webkit = testInfo.project.use.browserName === 'webkit' || testInfo.project.name === 'iphone'
      const cancelledInWebkit = (text: string) => webkit && text.includes('due to access control checks')
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return
        const text = msg.text()
        if (/Failed to load resource: the server responded with a status of 4\d\d/.test(text)) return
        if (cancelledInWebkit(text)) return
        errors.push(text)
      })
      // WebKit can also raise it as an unhandled page error from the cancelled fetch.
      page.on('pageerror', (err) => {
        if (cancelledInWebkit(err.message)) return
        errors.push(err.message)
      })
      await use(errors)
      expect(errors, 'console errors').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

type Page = import('@playwright/test').Page

/** The main navigation: the sidebar from 900px; the tab bar and the Menu sheet below that. */
export const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' })

/** The main navigation even while it is hidden (behind the closed Menu on a phone). */
const mainNavAnyState = (page: Page) => page.getByRole('navigation', { name: 'Main', includeHidden: true })

/**
 * Opens whatever holds the nav link `name` and returns it. From 900px every link is in the sidebar,
 * so nothing needs opening. Below 900px the role's main screens are in the bottom tab bar and the
 * rest are behind Menu.
 */
export async function openNavTo(page: Page, name: string) {
  const link = mainNav(page).getByRole('link', { name, exact: true })
  const menu = page.getByRole('button', { name: 'Menu' })
  // A page that is still loading can take focus as it appears (e.g. the QC form on a new batch),
  // which closes a menu opened a moment before. So open it again until the link shows.
  await expect(async () => {
    if (await link.isVisible()) return
    if ((await menu.isVisible()) && (await menu.getAttribute('aria-expanded')) !== 'true') await menu.click()
    await expect(link).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
  return link
}

/**
 * Waits until the screen has loaded: signed in (the main nav is there), the screen's code is in
 * and nothing on it says Loading. Use it before a check that something is absent, which would
 * otherwise pass on a page that has not drawn yet, and before going to another address: Safari
 * (WebKit) fails the requests and code still loading on the page being left while that page's
 * script still runs, which logs errors (and can flash the sign-in page as it goes).
 */
export async function screenLoaded(page: Page) {
  await expect(mainNavAnyState(page)).toBeAttached()
  await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0)
}

/**
 * A nav link whether or not its menu is open: use for checks that a role never gets a screen. Counted
 * in the grouped list, which has every screen once (the phone tab bar repeats the main ones).
 */
export const navLinkAnyState = (page: Page, name: string) =>
  mainNavAnyState(page).locator('.nav-groups').getByRole('link', { name, exact: true, includeHidden: true })

/** The account button in the top bar (named "<email> · <role>"); opens its menu. */
export async function openAccount(page: Page) {
  const button = page.locator('.account-btn')
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  return page.locator('#account-menu')
}
