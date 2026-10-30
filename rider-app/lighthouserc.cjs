/* eslint-disable @typescript-eslint/no-require-imports */
// Lighthouse CI: mobile emulation with simulated 4G (Lighthouse defaults), on the
// production build. The first screen a rider sees is sign-in (or the PIN), so
// that is the page measured. Chrome comes from Playwright unless CHROME_PATH is set.
const { chromium } = require("@playwright/test");

module.exports = {
  ci: {
    collect: {
      startServerCommand: "npx next start -p 3410",
      startServerReadyPattern: "Ready",
      url: ["http://localhost:3410/"],
      numberOfRuns: 3,
      chromePath: process.env.CHROME_PATH || chromium.executablePath(),
      settings: { chromeFlags: "--headless=new --no-sandbox" },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.9, aggregationMethod: "median" }],
        "categories:accessibility": ["error", { minScore: 0.95, aggregationMethod: "median" }],
        // The brief's budgets are the two scores above. LCP sits near 2.5 s on simulated 4G (the sign-in
        // text after the app's first render), so it warns rather than fails.
        "largest-contentful-paint": ["warn", { maxNumericValue: 2500, aggregationMethod: "median" }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1, aggregationMethod: "median" }],
      },
    },
    upload: { target: "filesystem", outputDir: ".lighthouseci/reports" },
  },
};
