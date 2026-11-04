import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePincode, signIn } from "./helpers";

// axe, WCAG 2.1 A and AA, on every shop page (signed in where the page needs it).
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const violations = async (page: import("@playwright/test").Page) =>
  (await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);

const OPEN = ["/", "/location", "/c/all", "/p/alphonso", "/search?q=mango", "/search?q=zzzzqq", "/bulk", "/preorder", "/help", "/quality", "/terms", "/privacy", "/login", "/offline", "/no-such-page"];
const SIGNED_IN = ["/account", "/account/addresses", "/account/alerts", "/orders", "/preorders", "/checkout"];

test("every open page has no WCAG 2.1 A/AA violations", async ({ page }) => {
  test.setTimeout(240_000);
  await choosePincode(page);
  const found: string[] = [];
  for (const path of OPEN) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    for (const v of await violations(page)) found.push(`${path} ${v}`);
  }
  expect(found).toEqual([]);
});

test("every signed-in page has no WCAG 2.1 A/AA violations", async ({ page }) => {
  test.setTimeout(240_000);
  await choosePincode(page);
  await page.getByTestId("product-card").first().getByRole("button", { name: /^Add .* to cart$/ }).click();
  await signIn(page, "/orders");
  await expect(page).toHaveURL(/\/orders$/);
  const found: string[] = [];
  for (const path of SIGNED_IN) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    for (const v of await violations(page)) found.push(`${path} ${v}`);
  }
  // The cart and the location sheet, open.
  await page.goto("/");
  if (page.viewportSize()!.width < 1024) await page.getByTestId("cart-bar").click();
  else await page.getByRole("button", { name: /^Cart, \d+ item/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // Let the sheet and its backdrop finish fading in: mid-fade colours are not the real ones.
  await page.waitForTimeout(600);
  for (const v of await violations(page)) found.push(`cart ${v}`);
  expect(found).toEqual([]);
});
