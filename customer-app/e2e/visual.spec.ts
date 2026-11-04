import { expect, test } from "@playwright/test";
import { payDemoOrder } from "./helpers";

// Visual snapshots of the shop screens whose content does not depend on live stock or dates.
// Run with PW_VISUAL=1 (and PW_MATRIX=1 for every width); baselines are per platform (macOS here).
// The catalogue screens are covered by the screenshot baselines in docs/qa/ and by the
// layout checks in tap-targets.spec.ts and glitches.spec.ts.
for (const [name, path] of [
  ["help", "/help"],
  ["quality", "/quality"],
  ["terms", "/terms"],
  ["privacy", "/privacy"],
  ["sign-in", "/login"],
  ["not-found", "/no-such-page"],
]) {
  test(`${name}`, async ({ page }) => {
    test.skip(!process.env.PW_VISUAL, "visual snapshots: PW_VISUAL=1");
    await page.emulateMedia({ reducedMotion: "reduce" });
    // A saved pincode, so the "Where should we deliver?" sheet (it opens on a timer) never covers the page.
    await page.addInitScript(() => {
      const address = { id: "qa", label: "Home", line1: "12, 4th Cross, Koramangala", pincode: "560034", city: "Bengaluru", lat: 12.9352, lng: 77.6245 };
      localStorage.setItem("mm.where", JSON.stringify({ state: { address, saved: [address], deliveryDate: null }, version: 2 }));
    });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      animations: "disabled",
      maxDiffPixelRatio: 0.002,
      // The header's delivery day comes from the clock.
      mask: [page.locator("header").getByText(/\b(Today|Tomorrow|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/)],
    });
  });
}

// The mango splash at rest (docs/design/shop-motion.md, "Mango splash"): the frame after the burst,
// with every animation finished. The order number and the delivery day come from the run.
test("order-success", async ({ page }) => {
  test.skip(!process.env.PW_VISUAL, "visual snapshots: PW_VISUAL=1");
  await payDemoOrder(page);
  const splash = page.locator("svg[data-splash]");
  await expect(splash).toBeVisible();
  await page.waitForTimeout(1600);
  // Finish the burst; the pool's endless breathing is cancelled back to rest.
  await page.evaluate(() => document.getAnimations().forEach((a) => (Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity) ? a.finish() : a.cancel())));
  await expect(page).toHaveScreenshot("order-success.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.002,
    mask: [page.getByText(/^Order ORD-/), page.getByRole("status")],
  });
});
