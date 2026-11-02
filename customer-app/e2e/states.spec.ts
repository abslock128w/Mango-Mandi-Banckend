import { expect, test } from "@playwright/test";
import { choosePincode, fits, signIn } from "./helpers";

// Loading, empty and error states: never a skeleton that does not end.

test.describe("states", () => {
  for (const path of ["/", "/c/all", "/p/alphonso", "/search?q=alphonso"]) {
    test(`${path}: a skeleton while the catalogue loads, then a retry if the API fails, never endless loading`, async ({ page }) => {
      await choosePincode(page);
      let fail = true;
      await page.route("**/v1/catalogue**", async (route) => {
        if (!fail) return route.continue();
        await new Promise((r) => setTimeout(r, 1500));
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "down", requestId: "r" } }) });
      });
      await page.goto(path);
      if (path !== "/search?q=alphonso") await expect(page.locator(".skeleton").first()).toBeVisible();
      const error = page.getByTestId("catalogue-error");
      await expect(error).toBeVisible({ timeout: 20_000 });
      await expect(error.getByRole("heading", { name: "We couldn't load the mangoes" })).toBeVisible();
      await fits(page, `${path} error`);
      fail = false;
      await error.getByRole("button", { name: "Try again" }).click();
      await expect(error).toHaveCount(0);
      await expect(page.getByTestId("product-card").or(page.getByRole("heading", { level: 1 })).first()).toBeVisible();
    });
  }

  test("orders: a new customer sees the empty state with a way to shop", async ({ page }) => {
    await choosePincode(page);
    await signIn(page, "/orders");
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByText("No orders yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Start shopping" })).toBeVisible();
    await fits(page, "orders empty");
  });
});
