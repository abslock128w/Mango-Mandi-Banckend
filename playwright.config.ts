import { defineConfig, devices } from '@playwright/test'

// The dev server is started automatically for the run. The day-in-the-life
// spec additionally needs a seeded backend reachable at VITE_API_URL and admin
// credentials in E2E_EMAIL / E2E_PASSWORD; without them it skips (see the spec).

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    // Optional: point at a preinstalled Chromium instead of Playwright's download.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  // §10: drive the script at phone (390px) and desktop (1280px) widths.
  projects: [
    {
      name: 'phone',
      use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // The backend-free specs intercept every /admin/v1 call, so any API URL works.
    env: { VITE_API_URL: process.env.VITE_API_URL ?? 'http://localhost:3000' },
  },
})
