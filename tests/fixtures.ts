import { test as base, expect } from '@playwright/test'

// Every test fails if the page logs a console error or throws. The one
// exception is the browser's own "Failed to load resource" line for 4xx
// responses a test deliberately mocks (e.g. a 401 from /auth/refresh).
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return
        const text = msg.text()
        if (/Failed to load resource: the server responded with a status of 4\d\d/.test(text)) return
        errors.push(text)
      })
      page.on('pageerror', (err) => errors.push(err.message))
      await use(errors)
      expect(errors, 'console errors').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
