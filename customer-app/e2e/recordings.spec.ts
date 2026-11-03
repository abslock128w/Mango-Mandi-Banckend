import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { choosePincode } from "./helpers";

// Three short screen recordings of the shop's motion at 390 px (docs/design/shop-motion.md), saved
// to docs/screenshots/shop/. Off by default:
//
//   PW_SHOTS=1 npx playwright test e2e/recordings.spec.ts --project=mobile
// Playwright runs from customer-app/.
const OUT = path.resolve("../docs/screenshots/shop") + path.sep;
const SIZE = { width: 390, height: 844 };

test.use({ viewport: SIZE, video: { mode: "on", size: SIZE } });

async function save(page: Page, name: string) {
  const video = page.video();
  await page.close();
  mkdirSync(OUT, { recursive: true });
  await video?.saveAs(`${OUT}${name}.webm`);
}

async function homeAtFirstRail(page: Page) {
  await choosePincode(page);
  await page.waitForLoadState("networkidle");
  const card = page.getByTestId("product-card").first();
  await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(800);
  return card;
}

test.describe("recordings", () => {
  test.skip(() => !process.env.PW_SHOTS, "recordings: PW_SHOTS=1");

  test("add to cart", async ({ page }) => {
    const card = await homeAtFirstRail(page);
    await card.getByRole("button", { name: /^Add .* to cart$/ }).click();
    await page.waitForTimeout(900);
    await card.getByRole("button", { name: /^Add one more/ }).click();
    await page.waitForTimeout(900);
    await page.getByTestId("product-card").nth(1).getByRole("button", { name: /^Add .* to cart$/ }).click();
    await page.waitForTimeout(1200);
    await expect(page.getByTestId("cart-bar")).toBeVisible();
    await save(page, "add-to-cart");
  });

  test("open a product", async ({ page }) => {
    const card = await homeAtFirstRail(page);
    await card.getByRole("link").first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(1200);
    await sheet.getByRole("radio", { name: /5 kg/ }).first().click().catch(() => {});
    await page.waitForTimeout(900);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1100);
    await save(page, "open-product");
  });

  test("open the cart", async ({ page }) => {
    const card = await homeAtFirstRail(page);
    await card.getByRole("button", { name: /^Add .* to cart$/ }).click();
    await page.waitForTimeout(1000);
    await page.getByTestId("cart-bar").click();
    const sheet = page.getByRole("dialog", { name: "My Cart" });
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(1400);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1100);
    await save(page, "open-cart");
  });
});
