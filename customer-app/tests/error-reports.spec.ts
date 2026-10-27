import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { REPO, buildWithDsn, eventsIn, fakeSentry, firstLoadFiles, removeBuild, sdkStarted, serve, throwInPage } from '../../tests/error-reports'

// Error reports from the shop to Sentry (shared/error-reports). With a DSN (a
// production build made here, with a made-up one): an error is sent once, tagged
// with the app, and without the customer's phone number, name, e-mail or saved
// address, or anything from the address bar after the path. A crash shows a way out
// instead of a blank page, and is reported. Without a DSN: no Sentry code is fetched
// and nothing is sent. The API is answered by the test (no seeded API needed), and
// these tests throw on purpose, so they use Playwright's own test, not the fixture
// that fails on page errors.

test.use({ serviceWorkers: 'block' })

const CUSTOMER = { id: 'cus1', phone: '+919876543210', name: 'Asha Rao', email: 'asha.rao@example.com' }
const ADDRESS = { id: 'a1', name: 'Home', address: '12 Marine Drive, Mumbai', pincode: '400001', lastUsedAt: '2026-10-01T06:00:00Z' }
/** On screen or in the address bar in these tests, and never in a report. */
const PRIVATE = ['9876543210', '98765 43210', 'Asha Rao', 'Marine Drive', '400001', 'asha.rao@example.com', 'ref=', '#addresses']

function expectNothingPrivate(envelope: string) {
  for (const s of PRIVATE) expect(envelope, `"${s}" was sent`).not.toContain(s)
}

async function exactlyOneEnvelope(envelopes: string[]) {
  await expect.poll(() => envelopes.length, { timeout: 20_000 }).toBeGreaterThan(0)
  await new Promise((r) => setTimeout(r, 1500))
  expect(envelopes).toHaveLength(1)
  const events = eventsIn(envelopes[0])
  expect(events).toHaveLength(1)
  return events[0]
}

/**
 * A signed-in customer with one saved address, answered here: the session refresh,
 * the saved addresses (or `addresses` instead), and "not found" for everything else.
 */
async function signedInShop(page: Page, api: string, addresses: unknown = [ADDRESS]) {
  await page.addInitScript((c) => localStorage.setItem('mm.profile', JSON.stringify(c)), CUSTOMER)
  await page.route(`${api}/**`, (route) => {
    const { pathname } = new URL(route.request().url())
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (pathname === '/v1/auth/token/refresh') return json(200, { accessToken: 'tok', customer: CUSTOMER })
    if (pathname === '/v1/me/addresses') return json(200, addresses)
    if (pathname.startsWith('/v1/me/addresses/') && route.request().method() === 'DELETE') return route.fulfill({ status: 204 })
    return json(404, { error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'req_e2e' } })
  })
}

test.describe('with a DSN', () => {
  const API = 'http://localhost:3999'
  let dir: string | undefined
  let site: Awaited<ReturnType<typeof serve>> | undefined

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    dir = await buildWithDsn(path.join(REPO, 'customer-app/vite.config.ts'), {
      VITE_API_URL: API,
      VITE_SUPPORT_WHATSAPP: '910000000000',
      VITE_SENTRY_ENVIRONMENT: 'e2e',
      VERCEL_GIT_COMMIT_SHA: 'e2e1release',
    })
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

  test('an error on the account page is sent once, with none of the customer’s details', async ({ page }) => {
    const envelopes = await fakeSentry(page)
    await signedInShop(page, API)
    await page.goto(`${site!.url}/account?ref=9876543210#addresses`)
    await expect(page.getByText('12 Marine Drive, Mumbai')).toBeVisible()
    await expect(page.getByText('asha.rao@example.com')).toBeVisible()
    // Its label names the address: the report must not.
    await page.getByRole('button', { name: /Remove 12 Marine Drive/ }).click()
    await sdkStarted(page)
    await throwInPage(page, 'Could not save +91 98765 43210 for asha.rao@example.com')

    const event = await exactlyOneEnvelope(envelopes)
    expectNothingPrivate(envelopes[0])
    expect(event.tags).toMatchObject({ app: 'shop' })
    expect(event.environment).toBe('e2e')
    expect(event.release).toBe('e2e1release')
    expect(event.exception?.values?.[0]?.value).toBe('Could not save [Filtered] for [Filtered]')
    expect(event.request?.url).toBe(`${site!.url}/account`)
    const crumbs = event.breadcrumbs ?? []
    expect(crumbs.some((b) => b.category === 'ui.click' && /button\.link-btn\[type="button"\]$/.test(b.message ?? ''))).toBe(true)
    expect(crumbs.some((b) => b.category === 'fetch' && b.data?.method === 'DELETE' && String(b.data?.url).endsWith('/v1/me/addresses/a1'))).toBe(true)
  })

  test('a crash shows "Something went wrong" with Try again, and is reported once', async ({ page }) => {
    const envelopes = await fakeSentry(page)
    // An answer the account page cannot draw.
    await signedInShop(page, API, { address: ADDRESS.address })
    await page.goto(`${site!.url}/account?ref=9876543210`)
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()

    const event = await exactlyOneEnvelope(envelopes)
    expectNothingPrivate(envelopes[0])
    expect(event.tags).toMatchObject({ app: 'shop' })
    expect(event.exception?.values?.[0]?.mechanism).toMatchObject({ type: 'react.error_boundary', handled: false })
    expect(String(event.contexts?.react?.componentStack)).toMatch(/assets\/Account-[\w-]+\.js:\d+:\d+/)
  })
})

test('without a DSN no Sentry code is fetched and nothing is sent', async ({ page }) => {
  // The dev server the other specs use, started without VITE_SENTRY_DSN.
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  const envelopes = await fakeSentry(page)
  await signedInShop(page, (process.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, ''))
  await page.goto('/account')
  await expect(page.getByText('12 Marine Drive, Mumbai')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await throwInPage(page, 'Nobody hears this')
  await page.waitForTimeout(2000)
  expect(requests.filter((u) => /sentry/i.test(u))).toEqual([])
  expect(envelopes).toEqual([])
  expect(await page.evaluate(() => window.onerror)).toBeNull()
})
