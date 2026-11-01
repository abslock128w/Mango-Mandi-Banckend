/* eslint-disable @typescript-eslint/no-require-imports */
// Lighthouse CI: mobile emulation with simulated 4G (Lighthouse defaults).
// Chrome comes from Playwright's download unless CHROME_PATH is set.
const { chromium } = require("@playwright/test");

module.exports = {
  ci: {
    collect: {
      startServerCommand: "npx next start -p 3400",
      startServerReadyPattern: "Ready",
      url: ["http://localhost:3400/", "http://localhost:3400/c/all", "http://localhost:3400/p/alphonso"],
      // 5 runs: the first hit on each page warms the image optimiser (a CDN would cache it).
      numberOfRuns: 5,
      chromePath: process.env.CHROME_PATH || chromium.executablePath(),
      settings: { chromeFlags: "--headless=new --no-sandbox" },
    },
    assert: {
      assertions: {
        // Median of the runs, not LHCI's default best run.
        "categories:performance": ["error", { minScore: 0.9, aggregationMethod: "median" }],
        "categories:accessibility": ["error", { minScore: 0.95, aggregationMethod: "median" }],
        "largest-contentful-paint": ["error", { maxNumericValue: 2500, aggregationMethod: "median" }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1, aggregationMethod: "median" }],
      },
    },
    upload: { target: "filesystem", outputDir: ".lighthouseci/reports" },
  },
};
