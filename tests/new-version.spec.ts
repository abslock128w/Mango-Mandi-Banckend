import { expect, test } from './fixtures'
import { mockApi } from './mock-api'

// After a deploy an open tab asks for screen files that no longer exist. That is not a crash:
// the panel says a newer version is ready and offers Reload.
test('a screen whose code cannot load asks to reload for the new version', async ({ page, consoleErrors }) => {
  await mockApi(page, { signedIn: true })
  await page.route(/\/src\/pages\/Analytics\.tsx/, (route) => route.abort())
  await page.goto('/today')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.goto('/analytics')
  const alert = page.getByRole('alert').filter({ hasText: 'A newer version of Mango Ops is ready' })
  await expect(alert).toBeVisible()
  await expect(alert.getByRole('button', { name: 'Reload' })).toBeVisible()
  await expect(page.getByText('This screen hit a problem')).toHaveCount(0)
  // The aborted request is this test's doing.
  for (let i = consoleErrors.length - 1; i >= 0; i--) if (/Analytics|import|module|Failed to load/i.test(consoleErrors[i])) consoleErrors.splice(i, 1)
})
