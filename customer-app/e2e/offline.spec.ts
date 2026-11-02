import { expect, test } from "@playwright/test";
import { choosePincode, offlineAndBack } from "./helpers";

// Losing the connection and getting it back.

test.describe("offline", () => {
  test("home says it is offline and recovers when the connection comes back", async ({ page }) => {
    await choosePincode(page);
    await expect(page.getByTestId("product-card").first()).toBeVisible();
    await offlineAndBack(page);
    await expect(page.getByTestId("product-card").first()).toBeVisible();
  });
});
