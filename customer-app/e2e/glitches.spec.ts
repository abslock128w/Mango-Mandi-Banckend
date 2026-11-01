import { expect, test, type Locator, type Page } from "@playwright/test";

// Regressions for UI glitches found in QA, against the real local API.

async function choosePincode(page: Page) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Pincode" }).fill("560034");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByRole("link", { name: /Pincode 560034/ }).first()).toBeVisible();
}

/** Opacity as painted: the element's own times every ancestor's (Motion hides a layoutId follower with opacity 0). */
const paintedOpacity = (l: Locator) =>
  l.evaluate((el) => {
    let o = 1;
    for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  });

test("the stepper stays visible after Add to cart on the product page", async ({ page }) => {
  await choosePincode(page);
  await page.goto("/p/alphonso?src=rail-ripe");
  await page.getByRole("button", { name: "Add to cart" }).filter({ visible: true }).first().click();
  const stepper = page.getByRole("group", { name: /Quantity of Alphonso/ }).filter({ visible: true });
  await expect(stepper).toHaveCount(1);
  await expect.poll(() => paintedOpacity(stepper)).toBeGreaterThan(0.9);
  await stepper.getByRole("button", { name: /Add one more/ }).click();
  await expect(stepper).toContainText("2");
});

test("a cart suggestion stays put and becomes a stepper when added", async ({ page, isMobile }) => {
  await choosePincode(page);
  await page.getByTestId("product-card").first().getByRole("button", { name: /^Add .* to cart$/ }).click();
  if (isMobile) await page.getByTestId("cart-bar").click();
  else await page.getByRole("button", { name: /^Cart, 1 item/ }).click();
  const cards = page.getByRole("dialog").getByTestId("product-card");
  await expect(cards.first()).toBeVisible();
  const first = await cards.first().getAttribute("data-product");
  await cards.first().getByRole("button", { name: /^Add .* to cart$/ }).click();
  await expect(cards.first()).toHaveAttribute("data-product", first!);
  await expect(cards.first().getByRole("group", { name: /Quantity of/ })).toBeVisible();
});

test("the Ripeness filter opens and filters the listing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await choosePincode(page);
  await page.goto("/c/all");
  await page.getByRole("button", { name: /^Ripeness/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await sheet.getByRole("radio", { name: "Raw", exact: true }).click();
  await sheet.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("button", { name: /^Raw/ }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Ripe, ready to eat/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("an unknown product says so instead of a blank page", async ({ page }) => {
  await choosePincode(page);
  await page.goto("/p/not-a-mango");
  await expect(page.getByRole("heading", { name: "We couldn't find that mango" })).toBeVisible();
});

test("product and listing pages don't jump while the catalogue loads", async ({ page }) => {
  await choosePincode(page);
  await page.addInitScript(() => {
    (window as unknown as { cls: number }).cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) (window as unknown as { cls: number }).cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  for (const path of ["/", "/c/all", "/p/alphonso"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { cls: number }).cls), path).toBeLessThan(0.05);
  }
});
