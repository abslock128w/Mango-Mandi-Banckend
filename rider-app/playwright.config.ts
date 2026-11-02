import { defineConfig, devices } from "@playwright/test";

// Its own port and build folder (NEXT_DIST_DIR), never the dev server on 5175: that one has
// other settings (the ops phone, for one), so reusing it made the results depend on what was running.
const PORT = Number(process.env.RIDER_PORT ?? 5185);

// The API is mocked with page.route (e2e/mock-api.ts), so these run without mango-api.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // A service worker would answer some requests itself, out of page.route's reach.
    serviceWorkers: "block",
    geolocation: { latitude: 12.9716, longitude: 77.5946, accuracy: 12 },
    permissions: ["geolocation"],
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "phone-390",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { NEXT_PUBLIC_API_URL: "http://localhost:3000", NEXT_PUBLIC_OPS_PHONE: "+919800000001", NEXT_DIST_DIR: ".next-e2e" },
  },
});
