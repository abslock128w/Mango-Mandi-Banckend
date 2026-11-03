import { expect, type Page } from "@playwright/test";

// Shared steps for the shop e2e specs, against the real local API.

export const phone = () => `98${String(Date.now()).slice(-8)}`;

export async function fits(page: Page, label: string) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth), `${label}: no sideways scroll`).toBeLessThanOrEqual(width);
}

export async function choosePincode(page: Page, pin = "560034") {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Pincode" }).fill(pin);
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByRole("link", { name: new RegExp(`Pincode ${pin}`) }).first()).toBeVisible();
}

export async function signIn(page: Page, next = "/account") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByRole("textbox", { name: /mobile number/i }).fill(phone());
  await page.getByRole("button", { name: "Send code" }).click();
  const code = (await page.getByText(/your code is \d{6}/).textContent())!.match(/\d{6}/)![0];
  await page.getByRole("textbox", { name: "Digit 1" }).click();
  await page.keyboard.type(code);
}

/** Offline then online again: the page says so, and recovers without a reload. */
export async function offlineAndBack(page: Page) {
  await page.context().setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "You're offline" })).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: "You're offline" })).toHaveCount(0);
}

/** A paid demo order: pincode, one box, sign in at checkout, address and time, the test payment. Lands on the success page. */
export async function payDemoOrder(page: Page) {
  await choosePincode(page);
  await page.getByTestId("product-card").first().getByRole("button", { name: /^Add .* to cart$/ }).click();
  await page.goto("/checkout");
  await page.getByRole("textbox", { name: /mobile number/i }).fill(phone());
  await page.getByRole("button", { name: "Send code" }).click();
  const code = (await page.getByText(/your code is \d{6}/).textContent())!.match(/\d{6}/)![0];
  await page.getByRole("textbox", { name: "Digit 1" }).click();
  await page.keyboard.type(code);
  await expect(page).toHaveURL(/\/checkout$/);
  await page.getByRole("textbox", { name: "Address" }).fill("12 Test Lane, Koramangala 4th Block, Bengaluru 560034");
  await page.getByRole("radiogroup", { name: "Delivery time" }).getByRole("radio", { disabled: false }).first().click();
  await page.getByText("Pay now").click();
  await page.getByRole("button", { name: "Pay (test)" }).click();
  await expect(page).toHaveURL(/\/order\/[^/]+\/success$/);
}
