import { expect, test } from './fixtures'
import AxeBuilder from '@axe-core/playwright'
import { mockApi } from './mock-api'

// Restoring a session on load when the API is busy (429, 503) or unreachable: that says nothing
// about the session, so the panel must not show the sign-in form (api.ts: "must not sign anyone out").
for (const status of [429, 503]) {
  test(`a ${status} while restoring the session offers Try again, not the sign-in form`, async ({ page, consoleErrors }) => {
    await mockApi(page, { signedIn: true })
    let busy = true
    await page.route('**/admin/v1/auth/refresh', (route) =>
      busy ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { code: 'BUSY', message: 'busy', requestId: 'r' } }) }) : route.fallback(),
    )
    await page.goto('/orders')
    const alert = page.getByRole('alert').filter({ hasText: "Can't reach Mango Ops" })
    await expect(alert).toBeVisible()
    await expect(page.getByLabel('Work email')).toHaveCount(0)
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => v.id)).toEqual([])
    await expect(page).toHaveURL(/\/orders$/)
    busy = false
    await alert.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible()
    // The browser logs the mocked 503 itself; that line is this test's doing.
    for (let i = consoleErrors.length - 1; i >= 0; i--) if (consoleErrors[i].includes(`status of ${status}`)) consoleErrors.splice(i, 1)
  })
}

test('a refused refresh on load still shows the sign-in form', async ({ page }) => {
  await mockApi(page)
  await page.goto('/orders')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByLabel('Work email')).toBeVisible()
})
