import { expect, test } from './fixtures'
import { mockApi } from './mock-api'

// Visual snapshots of the main screens, light and dark, at the phone and desktop sizes, against the
// mock API (fixed data). Run with PW_VISUAL=1; baselines are per platform (these are macOS's):
//   PW_VISUAL=1 npx playwright test tests/visual.spec.ts --update-snapshots
const SCREENS: [string, string][] = [
  ['today', '/today'],
  ['orders', '/orders'],
  ['order', '/orders/o1'],
  ['pack-list', '/pack-list'],
  ['deliveries', '/deliveries?date=2026-10-16'],
  ['batches', '/batches'],
  ['planning', '/planning'],
  ['staff', '/staff'],
]

for (const theme of ['light', 'dark'] as const) {
  for (const [name, path] of SCREENS) {
    test(`${name} (${theme})`, async ({ page }) => {
      test.skip(!process.env.PW_VISUAL, 'visual snapshots: PW_VISUAL=1')
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await mockApi(page, { signedIn: true })
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveScreenshot(`${name}-${theme}.png`, {
        fullPage: true,
        animations: 'disabled',
        // Times relative to now ("Last updated 2 min ago", today's date) change from run to run.
        mask: [page.locator('time'), page.getByText(/Last updated|ago\b/)],
        maxDiffPixelRatio: 0.002,
      })
    })
  }
}
