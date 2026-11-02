import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { mockApi, signIn, type Mock } from "./mock-api";

// The rest of the rider's day: the screen kept on and the position sent while out for
// delivery, a wrong PIN, a manager's override after a lock, and a reinstalled app.
const SEALED = path.join(__dirname, "fixtures", "sealed-box.jpg");
const OPEN = path.join(__dirname, "fixtures", "open-box.jpg");

async function pickUp(page: Page, m: Mock) {
  const card = page.getByTestId("current-stop");
  await card.getByRole("link", { name: "Pick up at warehouse" }).click();
  await page.getByTestId("pickup-photo").setInputFiles(SEALED);
  await page.getByRole("button", { name: "Mark picked up" }).click();
  await expect(page.getByText("WhatsApp sent")).toBeVisible();
  expect(m.pickups).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Back to the run" }).click();
}

test("out for delivery: the screen is kept on, asked again after the app returns, and the position goes to ops", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { wakeRequests: number; wakeReleases: number };
    w.wakeRequests = 0;
    w.wakeReleases = 0;
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: async () => (w.wakeRequests++, { release: async () => void w.wakeReleases++, addEventListener() {} }) },
    });
  });
  const m = await mockApi(page);
  const located: { lat: number; lng: number }[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/rider/location") && r.method() === "POST") located.push(r.postDataJSON());
  });
  await signIn(page);
  await pickUp(page, m);
  await expect.poll(() => page.evaluate(() => (window as unknown as { wakeRequests: number }).wakeRequests)).toBeGreaterThan(0);
  await expect.poll(() => located.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(located[0]).toMatchObject({ lat: 12.9716, lng: 77.5946 });
  const before = await page.evaluate(() => (window as unknown as { wakeRequests: number }).wakeRequests);
  // The browser drops the lock when the app is hidden; coming back asks again.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { wakeRequests: number }).wakeRequests)).toBeGreaterThan(before);
});

test("a wrong PIN says so and keeps the rider on the PIN screen", async ({ page }) => {
  await mockApi(page);
  await signIn(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hi Suresh" })).toBeVisible();
  await page.getByTestId("pin").fill("9999");
  await expect(page.getByText("That PIN is not right. 4 tries left.")).toBeVisible();
  await expect(page).not.toHaveURL(/\/today/);
  await page.getByTestId("pin").fill("1234");
  await page.waitForURL("**/today");
});

test("after three wrong codes, a manager's override on the panel shows the stop as delivered", async ({ page }) => {
  const m = await mockApi(page);
  await signIn(page);
  await pickUp(page, m);
  await page.getByTestId("current-stop").getByRole("link", { name: "At the door" }).click();
  await page.getByTestId("door-photo").setInputFiles(SEALED);
  await page.getByTestId("open-photo").setInputFiles(OPEN);
  for (const c of ["1111", "2222", "3333"]) {
    await expect(page.getByTestId("step-4")).toHaveAttribute("data-state", "active");
    await page.getByTestId("delivery-code").fill(c);
    await page.waitForTimeout(300);
  }
  await expect(page.getByTestId("code-locked")).toBeVisible();
  await page.getByRole("link", { name: "Back to today's run" }).click();
  // The rider calls ops (the dialer hides the app) and ops delivers it with a reason on the panel.
  m.orders[0].status = "DELIVERED";
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // Back in the app, the stop is done at once, not at the next 30 s refresh.
  await expect(page.getByTestId("current-stop")).not.toContainText("ORD-1093", { timeout: 5_000 });
  await expect(page.getByText(/1 of 2 stops done|Delivered/).first()).toBeVisible();
});

test("a reinstalled app (its storage gone) asks for the phone and a code again, not the PIN", async ({ browser }) => {
  const first = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await first.newPage();
  await mockApi(page);
  await signIn(page);
  await first.close();
  // A new install: no IndexedDB, no device id, no refresh cookie.
  const again = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const fresh = await again.newPage();
  await mockApi(fresh);
  await fresh.goto("/");
  await expect(fresh.getByLabel("Mobile number")).toBeVisible();
  await expect(fresh.getByTestId("pin")).toHaveCount(0);
  await again.close();
});
