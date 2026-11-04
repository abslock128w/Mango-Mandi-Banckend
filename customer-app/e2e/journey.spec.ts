import { expect, test } from "@playwright/test";

// The core journey against a real mango-api (see playwright.config.ts): pick a pincode,
// add a box, sign in with the test-mode code, check out and pay with the test button.
// A fresh phone number per run keeps the "one unpaid order" rule out of the way.
const phone = () => `98${String(Date.now()).slice(-8)}`;

test("browse, sign in, check out and pay", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Pincode" }).fill("560034");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByRole("link", { name: /Pincode 560034/ }).first()).toBeVisible();

  await page.goto("/p/alphonso");
  await page.getByRole("button", { name: "Add to cart" }).last().click();

  await page.goto("/checkout");
  await expect(page).toHaveURL(/\/login\?next=\/checkout/);
  await page.getByRole("textbox", { name: /mobile number/i }).fill(phone());
  await page.getByRole("button", { name: "Send code" }).click();
  const code = (await page.getByText(/your code is \d{6}/).textContent())!.match(/\d{6}/)![0];
  await page.getByRole("textbox", { name: "Digit 1" }).click();
  await page.keyboard.type(code);

  await expect(page).toHaveURL(/\/checkout$/);
  await page.getByRole("textbox", { name: "Address" }).fill("12 Test Lane, Koramangala 4th Block, Bengaluru 560034");
  // The demo API has delivery times, and a quote needs one once any exist.
  await page.getByRole("radiogroup", { name: "Delivery time" }).getByRole("radio", { disabled: false }).first().click();
  await expect(page.getByText("₹1,899").first()).toBeVisible();
  await page.getByText("Pay now").click();

  await page.getByRole("button", { name: "Pay (test)" }).click();
  await expect(page).toHaveURL(/\/order\/[^/]+\/success$/);
  await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();

  await page.getByRole("link", { name: /Track order/ }).click();
  await expect(page.getByText("Confirmed").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("pages fit the screen and send a CSP", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Pincode" }).fill("560034");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByRole("link", { name: /Pincode 560034/ }).first()).toBeVisible();
  for (const path of ["/", "/c/all", "/p/badami", "/search?q=hapus", "/bulk", "/preorder", "/help", "/terms", "/login"]) {
    const res = await page.goto(path);
    expect(res!.headers()["content-security-policy"], path).toContain("'strict-dynamic'");
    await page.waitForLoadState("networkidle");
    // Against the viewport, not innerWidth: on a phone an overflowing page widens the layout
    // viewport (it zooms out), so scrollWidth <= innerWidth would still hold.
    const width = page.viewportSize()!.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(width);
  }
});
