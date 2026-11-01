import { defineConfig, devices } from "@playwright/test";

// The journey runs against a real mango-api (start-local, or CI's e2e job). The API accepts
// the shop from CUSTOMER_ORIGIN (http://localhost:5174) and has test payments on /v1/dev,
// which only `next dev` uses.
const PORT = Number(process.env.E2E_PORT ?? 5174);
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "../playwright-report-shop" }]],
  outputDir: "../test-results-shop",
  // Each spec signs in its own customer; one at a time keeps the one-unpaid-order rule simple.
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Optional: point at any Chromium build (e.g. CHROME_PATH=/Applications/Brave Browser.app/...).
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  },
  projects: [
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 360, height: 780 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } },
    // NFR-15: Safari on an iPhone, run on its own in CI (PW_WEBKIT=1 --project=iphone).
    ...(process.env.PW_WEBKIT ? [{ name: "iphone", use: { ...devices["iPhone 13"] } }] : []),
  ],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    env: { NEXT_PUBLIC_API_URL: API },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
