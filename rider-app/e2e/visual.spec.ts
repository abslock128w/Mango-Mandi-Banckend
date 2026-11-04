import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { mockApi, signIn } from "./mock-api";

// Visual snapshots of each rider screen at 360, 390, 768, 1280 and 1440 px (the app is built for
// phones; wider screens centre it). Run with PW_VISUAL=1; baselines are per platform (macOS here).
const SEALED = path.join(__dirname, "fixtures", "sealed-box.jpg");
const OPEN = path.join(__dirname, "fixtures", "open-box.jpg");
const shot = (page: Page, name: string) =>
  expect(page).toHaveScreenshot(`${name}-${page.viewportSize()!.width}.png`, {
    fullPage: true,
    animations: "disabled",
    maxDiffPixelRatio: 0.002,
    // Today's date and times shown from the clock change from run to run.
    mask: [page.getByText(/^Today ·|\b\d{1,2}:\d{2}\b(?! ?[–-])|ago\b/)],
  });

for (const width of [360, 390, 768, 1280, 1440]) {
  test(`every rider screen at ${width} px`, async ({ page }) => {
    test.skip(!process.env.PW_VISUAL, "visual snapshots: PW_VISUAL=1");
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const m = await mockApi(page);
    await page.goto("/");
    await expect(page.getByLabel("Mobile number")).toBeVisible();
    await shot(page, "sign-in");
    await signIn(page);
    await expect(page.getByTestId("current-stop")).toBeVisible();
    await shot(page, "today");
    await page.getByTestId("current-stop").getByRole("link", { name: "Pick up at warehouse" }).click();
    await expect(page.getByTestId("pickup-photo")).toBeAttached();
    await shot(page, "pickup");
    await page.getByTestId("pickup-photo").setInputFiles(SEALED);
    await page.getByRole("button", { name: "Mark picked up" }).click();
    await expect(page.getByText("WhatsApp sent")).toBeVisible();
    await shot(page, "picked-up");
    expect(m.pickups).toBeGreaterThan(0);
    await page.getByRole("link", { name: "Back to the run" }).click();
    await page.getByTestId("current-stop").getByRole("link", { name: "At the door" }).click();
    await expect(page.getByTestId("step-1")).toHaveAttribute("data-state", "active");
    await shot(page, "stop-start");
    await page.getByTestId("door-photo").setInputFiles(SEALED);
    await page.getByTestId("open-photo").setInputFiles(OPEN);
    await expect(page.getByTestId("step-4")).toHaveAttribute("data-state", "active");
    await shot(page, "stop-code");
    for (const c of ["1111", "2222", "3333"]) {
      await page.getByTestId("delivery-code").fill(c);
      await page.waitForTimeout(300);
    }
    await expect(page.getByTestId("code-locked")).toBeVisible();
    await shot(page, "stop-locked");
  });
}
