import { expect, test } from "@playwright/test";
import { choosePincode } from "./helpers";

// No warnings from React or Next.js in the browser console: they flag real problems (an image
// drawn at a size its file does not match, a missing key, the main image loaded late).
test("the main pages log no React or Next.js warnings", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "warning" || m.type() === "error") {
      const t = m.text();
      if (/React DevTools|\[HMR\]|\[Fast Refresh\]/.test(t)) return;
      warnings.push(`${page.url().replace(/^https?:\/\/[^/]+/, "")}: ${t.slice(0, 160)}`);
    }
  });
  await choosePincode(page);
  for (const path of ["/", "/c/all", "/p/alphonso", "/search?q=mango", "/help", "/login", "/bulk", "/preorder"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  expect([...new Set(warnings)]).toEqual([]);
});
