import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { mockApi } from './mock-api'
import { REPO, buildWithDsn, eventsIn, fakeSentry, firstLoadFiles, removeBuild, sdkStarted, serve, throwInPage } from './error-reports'

// Error reports from the staff panel to Sentry (shared/error-reports). With a DSN
// (a production build made here, with a made-up one): an error is sent once, tagged
// with the app, and without the customer's phone number, address or name, the search
// words in the address bar, or the e-mail in the message. Without a DSN: no Sentry
// code is fetched and nothing is sent. These tests throw on purpose, so they use
// Playwright's own test, not the fixture that fails on page errors.

/** What is on screen or in the address bar in these tests, and must never be in a report. */
const PRIVATE = ['9876543210', '98765 43210', 'Asha Rao', 'Marine Drive', 'asha.rao@example.com', 'q=', '#notes']

function expectNothingPrivate(envelope: string) {
  for (const s of PRIVATE) expect(envelope, `"${s}" was sent`).not.toContain(s)
}

/** Waits for the first envelope, then a moment more to be sure no second one follows. */
async function exactlyOneEnvelope(envelopes: string[]) {
  await expect.poll(() => envelopes.length, { timeout: 20_000 }).toBeGreaterThan(0)
  await new Promise((r) => setTimeout(r, 1500))
  expect(envelopes).toHaveLength(1)
  const events = eventsIn(envelopes[0])
  expect(events).toHaveLength(1)
  return events[0]
}

test.describe('with a DSN', () => {
  let dir: string | undefined
  let site: Awaited<ReturnType<typeof serve>> | undefined

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    dir = await buildWithDsn(path.join(REPO, 'vite.config.ts'), { VITE_API_URL: 'http://localhost:3000', VITE_SENTRY_ENVIRONMENT: 'e2e', VERCEL_GIT_COMMIT_SHA: 'e2e1release' })
    site = await serve(dir)
  })
  test.afterAll(async () => {
    await site?.close()
    removeBuild(dir)
  })

  test('the SDK is its own chunk, not part of the first download', () => {
    const first = firstLoadFiles(dir!)
    expect(first.length).toBeGreaterThan(0)
    for (const f of first) {
      expect(f).not.toMatch(/sentry/i)
      expect(readFileSync(path.join(dir!, f), 'utf8')).not.toContain('__SENTRY__')
    }
  })

  test('an error before the SDK loads is held, then sent once and scrubbed', async ({ page }) => {
    const envelopes = await fakeSentry(page)
    await mockApi(page, { signedIn: true })
    // The failing code is in the page itself, like a bug in the app's own script. Not an init
    // script: WebKit runs those as a script of its own, and an error thrown from one reached no
    // report there (as with another origin's script, which has no error object to report).
    await page.route((url) => url.origin === site!.url && url.pathname === '/orders', async (route) => {
      const res = await route.fetch()
      const early = `<script>window.addEventListener('DOMContentLoaded', () => setTimeout(() => {
        throw new Error('Early failure for +91 98765 43210 (asha.rao@example.com), OTP 482913')
      }))</script>`
      await route.fulfill({ response: res, body: (await res.text()).replace('<head>', `<head>${early}`) })
    })
    await page.goto(`${site!.url}/orders?q=9876543210#notes`)
    const event = await exactlyOneEnvelope(envelopes)
    expectNothingPrivate(envelopes[0])
    expect(event.tags).toMatchObject({ app: 'panel' })
    expect(event.environment).toBe('e2e')
    expect(event.release).toBe('e2e1release')
    expect(event.exception?.values?.[0]).toMatchObject({ value: 'Early failure for [Filtered] ([Filtered]), OTP [Filtered]', mechanism: { type: 'auto.browser.held.onerror', handled: false } })
    expect(event.request?.url).toBe(`${site!.url}/orders`)
    expect(event.user).toBeUndefined()
    expect(envelopes[0]).not.toContain('482913')
  })

  test('an error after a staff member searched by phone and opened the order is sent once, with no customer data', async ({ page }) => {
    const envelopes = await fakeSentry(page)
    await mockApi(page, { signedIn: true })
    await page.goto(`${site!.url}/orders`)
    // The SDK loads once the page is idle (a second after load where requestIdleCallback is
    // missing, as in Safari); what happens before that leaves no breadcrumbs, and the checks
    // below need them.
    await sdkStarted(page)
    await page.getByLabel('Search by order number, phone, name or address').fill('9876543210')
    await expect(page).toHaveURL(/q=9876543210/)
    await page.getByRole('link', { name: 'ORD-1042' }).first().click()
    await expect(page.getByText('12 Marine Drive, Mumbai')).toBeVisible()
    await page.getByText('12 Marine Drive, Mumbai').click()
    await page.evaluate(() => {
      console.info('Opened the order for 12 Marine Drive')
      console.warn('Slow answer for 9876543210')
    })
    await throwInPage(page, 'Could not reach +91 98765 43210 or asha.rao@example.com')

    const event = await exactlyOneEnvelope(envelopes)
    expectNothingPrivate(envelopes[0])
    expect(event.tags).toMatchObject({ app: 'panel' })
    expect(event.exception?.values?.[0]?.value).toBe('Could not reach [Filtered] or [Filtered]')
    const crumbs = event.breadcrumbs ?? []
    // Requests and page changes are there, without their query strings.
    expect(crumbs.some((b) => b.category === 'fetch' && String(b.data?.url).endsWith('/admin/v1/orders'))).toBe(true)
    expect(crumbs.some((b) => b.category === 'navigation' && b.data?.to === '/orders/o1')).toBe(true)
    // The click on the address is an element path; console lines below a warning are left out.
    expect(crumbs.some((b) => b.category === 'ui.click' && /^[\w#.\-[\]="> ]+$/.test(b.message ?? ''))).toBe(true)
    expect(crumbs.filter((b) => b.category === 'console').map((b) => [b.level, b.message])).toEqual([['warning', 'Slow answer for [Filtered]']])
  })

  test('a screen that crashes shows its fallback and is reported once from the error boundary', async ({ page }) => {
    const envelopes = await fakeSentry(page)
    await mockApi(page, { signedIn: true })
    await page.goto(`${site!.url}/orders`)
    await sdkStarted(page)
    // An answer the order page cannot draw.
    await page.route('**/admin/v1/orders/o1', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"o1","phone":"9876543210"}' }))
    await page.getByRole('link', { name: 'ORD-1042' }).first().click()
    await expect(page.getByRole('heading', { name: 'This screen hit a problem' })).toBeVisible()

    const event = await exactlyOneEnvelope(envelopes)
    expectNothingPrivate(envelopes[0])
    expect(event.tags).toMatchObject({ app: 'panel' })
    expect(event.exception?.values?.[0]?.mechanism).toMatchObject({ type: 'react.error_boundary', handled: false })
    // Minified names, but the order page's chunk is named.
    expect(String(event.contexts?.react?.componentStack)).toMatch(/assets\/OrderDetail-[\w-]+\.js:\d+:\d+/)
  })
})

test('without a DSN no Sentry code is fetched and nothing is sent', async ({ page }) => {
  // The dev server the other specs use, started without VITE_SENTRY_DSN.
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  const envelopes = await fakeSentry(page)
  await mockApi(page, { signedIn: true })
  await page.goto('/orders')
  await expect(page.getByRole('link', { name: 'ORD-1042' }).first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  await throwInPage(page, 'Nobody hears this')
  await page.waitForTimeout(2000)
  expect(requests.filter((u) => /sentry/i.test(u))).toEqual([])
  expect(envelopes).toEqual([])
  expect(await page.evaluate(() => window.onerror)).toBeNull()
})
