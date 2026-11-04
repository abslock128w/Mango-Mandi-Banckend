/* eslint-disable @typescript-eslint/no-require-imports */
// Same budgets as lighthouserc.cjs, measured through a local HTTP/2 proxy
// (scripts/h2-proxy.mjs) to match how a CDN serves the app. Needs a self-signed
// cert in .lighthouseci/certs (see README).
const base = require("./lighthouserc.cjs");

module.exports = {
  ci: {
    ...base.ci,
    collect: {
      ...base.ci.collect,
      startServerCommand: "sh -c 'npx next start -p 3400 & node scripts/h2-proxy.mjs 3443 3400'",
      startServerReadyPattern: "h2 proxy ready",
      url: ["https://localhost:3443/", "https://localhost:3443/c/all", "https://localhost:3443/p/alphonso"],
      settings: { chromeFlags: "--headless=new --no-sandbox --ignore-certificate-errors" },
    },
    upload: { target: "filesystem", outputDir: ".lighthouseci/reports-h2" },
  },
};
