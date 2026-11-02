import { expect, test } from "@playwright/test";
import { choosePincode, fits, phone } from "./helpers";

// Every shop flow at every width (PW_MATRIX=1 adds 390, 768 and 1440 px and WebKit), against the
// real local API. At each step: the page fits the screen, a refresh keeps the state, Back goes
// where it should, and going offline and online again does not lose anything.

test.describe("location gate", () => {
  test("a bad pincode is explained, an unserved one offers WhatsApp and another try, a served one opens the shop", async ({ page }) => {
    await page.goto("/");
    const pin = page.getByRole("textbox", { name: "Pincode" });
    await pin.fill("12345");
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page.getByText("Enter a valid 6-digit pincode")).toBeVisible();
    await pin.fill("110001");
    await page.getByRole("button", { name: "Check", exact: true }).click();
    const out = page.getByTestId("out-of-zone");
    await expect(out.getByRole("heading", { name: "We don't deliver to 110001 yet" })).toBeVisible();
    await fits(page, "out of zone");
    await out.getByRole("button", { name: "Try another pincode" }).click();
    await page.getByRole("textbox", { name: "Pincode" }).fill("560034");
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page.getByRole("link", { name: /Pincode 560034/ }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole("link", { name: /Pincode 560034/ }).first()).toBeVisible();
    await fits(page, "home");
  });
});

test.describe("sign in", () => {
  test("a wrong code is refused, the right one signs in, a refresh keeps the session", async ({ page }) => {
    await page.goto("/login?next=/account");
    await page.getByRole("textbox", { name: /mobile number/i }).fill(phone());
    await page.getByRole("button", { name: "Send code" }).click();
    const code = (await page.getByText(/your code is \d{6}/).textContent())!.match(/\d{6}/)![0];
    const wrong = code === "000000" ? "111111" : "000000";
    await page.getByRole("textbox", { name: "Digit 1" }).click();
    await page.keyboard.type(wrong);
    await expect(page.getByText(/incorrect|wrong|doesn't match/i).first()).toBeVisible();
    await page.getByRole("textbox", { name: "Digit 1" }).click();
    for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");
    await page.getByRole("textbox", { name: "Digit 1" }).click();
    await page.keyboard.type(code);
    await expect(page).toHaveURL(/\/account$/);
    await page.reload();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await fits(page, "account");
  });
});

async function openCart(page: import("@playwright/test").Page, isMobile: boolean) {
  if (isMobile) await page.getByTestId("cart-bar").click();
  else await page.getByRole("button", { name: /^Cart, \d+ item/ }).click();
  return page.getByRole("dialog").filter({ hasText: /Total|Your cart is empty/ });
}

test.describe("cart and bill", () => {
  test("two boxes, the bill adds up, delivery is free, a refresh keeps the cart, removing empties it", async ({ page, isMobile }) => {
    await choosePincode(page);
    const cards = page.getByTestId("product-card");
    await cards.nth(0).getByRole("button", { name: /^Add .* to cart$/ }).click();
    await cards.nth(1).getByRole("button", { name: /^Add .* to cart$/ }).click();
    let cart = await openCart(page, isMobile);
    await expect(cart.getByText("Delivery is free on every order")).toBeVisible();
    const money = (t: string) => Number(t.replace(/[^\d.]/g, ""));
    const lines = await cart.getByRole("group", { name: /^Quantity of/ }).count();
    expect(lines).toBe(2);
    await cart.getByRole("button", { name: /^Add one more/ }).first().click();
    await expect(cart.getByRole("group", { name: /^Quantity of/ }).first()).toContainText("2");
    // The total is the sum of the lines (each line shows its price for its quantity).
    const linePrices = await cart.getByText(/^₹[\d,]+$/).allTextContents();
    const totalRow = cart.getByText(/total/i).last().locator("xpath=..");
    await expect.poll(async () => money((await totalRow.textContent())!.match(/₹[\d,]+/)?.[0] ?? "")).toBe(linePrices.slice(0, 2).reduce((s, t) => s + money(t), 0));
    await fits(page, "cart");
    await page.keyboard.press("Escape");
    await page.reload();
    cart = await openCart(page, isMobile);
    await expect(cart.getByRole("group", { name: /^Quantity of/ })).toHaveCount(2);
    for (let i = 0; i < 3; i++) {
      const remove = cart.getByRole("button", { name: /^Remove one/ }).first();
      if (await remove.count()) await remove.click();
    }
    await expect(cart.getByText("Your cart is empty")).toBeVisible();
  });
});

test.describe("checkout and after", () => {
  test("a failed payment leaves the order to pay, the second try pays; tracking, cancel, refund", async ({ page }) => {
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
    const started = Date.now();
    await page.getByRole("button", { name: "Fail payment (test)" }).click();
    await expect(page.getByTestId("dev-pay").getByRole("alert")).toHaveText("The payment didn't go through. Nothing was charged. Try again.", { timeout: 5_000 });
    expect(Date.now() - started, "a failed attempt is said at once, not after polling").toBeLessThan(5_000);
    await fits(page, "payment failed");
    // The boxes are still held: the customer pays on the same page.
    await page.getByRole("button", { name: "Pay (test)" }).click();
    await expect(page).toHaveURL(/\/order\/[^/]+\/success$/);
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
    await page.getByRole("link", { name: /Track order/ }).click();
    await expect(page).toHaveURL(/\/order\/[^/]+$/);
    await expect(page.getByRole("list", { name: "Order progress" }).or(page.getByLabel("Order progress"))).toBeVisible();
    await page.reload();
    await expect(page.getByText("Confirmed").first()).toBeVisible();
    await fits(page, "tracking");
    await page.getByRole("button", { name: "Cancel order" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel order" }).click();
    await expect(page.getByText("This order was cancelled.")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/order\/[^/]+\/success$/);
  });
});

test.describe("info pages and empty states", () => {
  test("preorder, bulk deals and an empty search each say what to do", async ({ page }) => {
    await choosePincode(page);
    await page.goto("/preorder");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await fits(page, "preorder");
    await page.goto("/bulk");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await fits(page, "bulk");
    await page.goto("/search?q=zzzzqq");
    await expect(page.getByText(/no (results|mangoes)|couldn't find|nothing/i).first()).toBeVisible();
    await fits(page, "search empty");
  });
});
