import { expect, test } from "@playwright/test";
import { choosePincode, fits } from "./helpers";

// The listing: every filter and sort, kept in the address so refresh and Back behave.

test.describe("listing", () => {
  test("filters and sort apply, survive a refresh, and Back undoes them", async ({ page }) => {
    await choosePincode(page);
    await page.goto("/c/all");
    await page.getByRole("button", { name: /^Ripeness/ }).click();
    let sheet = page.getByRole("dialog", { name: "Filters" });
    await sheet.getByRole("radio", { name: "Raw", exact: true }).click();
    await sheet.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("button", { name: /^Raw/ }).first()).toBeVisible();

    await page.getByRole("button", { name: /^Sort By/ }).click();
    sheet = page.getByRole("dialog", { name: "Filters" });
    await sheet.getByRole("radio", { name: "Price (low to high)" }).click();
    await sheet.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("button", { name: /^Price \(low to high\)/ })).toBeVisible();
    await expect(page).toHaveURL(/[?&]sort=price-asc/);
    await expect(page).toHaveURL(/[?&]ripeness=RAW/);
    // The first section's cards, by the price each shows (₹1,899).
    const prices = await page.locator("section").first().getByTestId("product-card").evaluateAll((cards) =>
      cards.map((c) => Number((c.textContent ?? "").match(/₹([\d,]+)/)?.[1].replace(/,/g, "") ?? "NaN")),
    );
    expect(prices.length).toBeGreaterThan(1);
    expect(prices, "cards are sorted by price").toEqual([...prices].sort((a, b) => a - b));
    await fits(page, "filtered listing");

    await page.reload();
    await expect(page.getByRole("button", { name: /^Raw/ }).first(), "the ripeness filter survives a refresh").toBeVisible();
    await expect(page.getByRole("button", { name: /^Price \(low to high\)/ }), "the sort survives a refresh").toBeVisible();

    await expect(page).toHaveURL(/[?&]sort=price-asc/);
    await page.goBack();
    await expect(page.getByRole("button", { name: /^Sort By/ }), "Back undoes the sort").toBeVisible();
    await expect(page).not.toHaveURL(/sort=/);
    await expect(page, "and keeps the ripeness filter").toHaveURL(/[?&]ripeness=RAW/);
  });

  test("box size filter shows only that size", async ({ page }) => {
    await choosePincode(page);
    await page.goto("/c/all");
    await page.getByRole("button", { name: /^Box size/ }).click();
    const sheet = page.getByRole("dialog", { name: "Filters" });
    await sheet.getByRole("radio", { name: /^5 kg/ }).click();
    await sheet.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("button", { name: /^5 kg/ }).first()).toBeVisible();
    await expect(page.getByTestId("product-card").first()).toContainText(/5 kg/);
  });
});
