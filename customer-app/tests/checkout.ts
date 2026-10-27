import { expect, type Page } from '@playwright/test'

/**
 * Presses Review order on a filled-in checkout and waits for "Review and pay". Specs run side by
 * side on one test API, so the delivery time picked when the form loaded can fill up before the
 * press; the shop then says so (that answer is checked here) and the customer picks another time,
 * or the next day when that day is full.
 */
export async function reviewOrder(page: Page, timeout = 15_000): Promise<void> {
  const heading = page.getByRole('heading', { name: 'Review and pay' })
  const full = page.getByRole('alert').filter({ hasText: 'That delivery time just filled up. Choose another one.' })
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.getByRole('button', { name: 'Review order' }).click()
    await expect(heading.or(full)).toBeVisible({ timeout })
    if (await heading.isVisible()) return
    const free = page.getByRole('group', { name: 'Delivery time' }).getByRole('radio', { disabled: false })
    if (!(await free.count())) {
      const days = page.getByRole('radiogroup', { name: 'When should it arrive?' }).getByRole('radio', { checked: false })
      await days.first().click()
      await expect(free.first()).toBeVisible()
    }
    await free.first().check()
  }
  await expect(heading).toBeVisible()
}
