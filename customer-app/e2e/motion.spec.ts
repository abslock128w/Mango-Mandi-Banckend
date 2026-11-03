import { expect, test, type Page } from "@playwright/test";
import { choosePincode, payDemoOrder } from "./helpers";

// The motion guard rails of docs/design/shop-motion.md (section 6), against the real local API.

const isPhone = (page: Page) => page.viewportSize()!.width < 1024;

async function firstCard(page: Page) {
  await choosePincode(page);
  const card = page.getByTestId("product-card").first();
  // Mid-screen, clear of the cart bar that arrives at the bottom, with its photo in (what flies).
  await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect.poll(() => card.locator("[data-fly-image] img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  return card;
}

/** The element's box once it has stopped moving (a sheet springing open). */
async function settledBox(locator: ReturnType<Page["locator"]>) {
  let last = await locator.boundingBox();
  for (let i = 0; i < 40; i++) {
    await locator.page().waitForTimeout(50);
    const next = await locator.boundingBox();
    if (next && last && Math.abs(next.y - last.y) < 0.5) return next;
    last = next;
  }
  return last!;
}

test("(a) a phone sheet follows the finger and a downward drag dismisses it", async ({ page }) => {
  test.skip(!isPhone(page), "bottom sheets are a phone thing");
  const card = await firstCard(page);
  await card.getByRole("button", { name: /^Add .* to cart$/ }).click();
  await page.getByTestId("cart-bar").click();
  const sheet = page.getByRole("dialog", { name: "My Cart" });
  await expect(sheet).toBeVisible();
  // The page behind is pushed back while the sheet is open.
  await expect(page.locator(".app-root")).toHaveAttribute("data-active", "");

  // Let it finish opening (its spring is under 400 ms), then drag the grab handle down; half-way
  // through, the sheet has moved with the pointer.
  await page.waitForTimeout(600);
  const box = await settledBox(sheet);
  const x = box.x + box.width / 2;
  const y = box.y + 10;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x, y + i * 30, { steps: 2 });
  const moved = (await sheet.boundingBox())!.y - box.y;
  expect(moved, "the sheet tracks the drag").toBeGreaterThan(120);
  // The page comes forward with the drag (progress mirrored from the sheet).
  expect(Number(await page.locator(".app-root").evaluate((el) => el.style.getPropertyValue("--drawer-swipe-progress")))).toBeGreaterThan(0);
  for (let i = 9; i <= 14; i++) await page.mouse.move(x, y + i * 40, { steps: 1 });
  await page.mouse.up();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator(".app-root")).not.toHaveAttribute("data-active", "");
});

test("(b) two taps on ADD within 100 ms end at quantity 2 with no copy left flying", async ({ page }) => {
  const card = await firstCard(page);
  await page.evaluate(() => {
    const w = window as unknown as { flies: number };
    w.flies = 0;
    new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach((n) => (n as Element).hasAttribute?.("data-fly") && w.flies++))).observe(document.body, { childList: true });
  });
  await card.getByRole("button", { name: /^Add .* to cart$/ }).waitFor();
  // Two taps 50 ms apart, in the page (a test runner's clicks are slower than a thumb): ADD, then
  // the + of the stepper it has just become.
  const gap = await card.evaluate(async (el) => {
    const t0 = performance.now();
    [...el.querySelectorAll("button")].find((b) => /^Add .* to cart$/.test(b.getAttribute("aria-label") ?? ""))!.click();
    await new Promise((r) => setTimeout(r, 50));
    el.querySelector<HTMLButtonElement>('button[aria-label^="Add one more"]')!.click();
    return performance.now() - t0;
  });
  expect(gap).toBeLessThan(100);
  await expect(card.getByRole("group", { name: /^Quantity of/ })).toContainText("2");
  await page.waitForTimeout(700);
  await expect(page.locator("[data-fly]")).toHaveCount(0);
  if (isPhone(page)) expect(await page.evaluate(() => (window as unknown as { flies: number }).flies)).toBe(2);
});

test("(c) with reduced motion nothing flies to the cart", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const card = await firstCard(page);
  await page.evaluate(() => {
    const w = window as unknown as { flies: number };
    w.flies = 0;
    new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach((n) => (n as Element).hasAttribute?.("data-fly") && w.flies++))).observe(document.body, { childList: true });
  });
  await card.getByRole("button", { name: /^Add .* to cart$/ }).click();
  await expect(card.getByRole("group", { name: /^Quantity of/ })).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { flies: number }).flies)).toBe(0);
  await expect(page.locator("[data-fly]")).toHaveCount(0);
});

test("(d) the header never changes the page's height while scrolling", async ({ page }) => {
  await choosePincode(page);
  // Mount everything that loads on the way down first (rails replace their placeholders), then measure.
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 600);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  // Web fonts swap in late and re-wrap text: measure once they are in.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const height = () => page.evaluate(() => document.documentElement.scrollHeight);
  const header = () => page.evaluate(() => (document.querySelector("header") as HTMLElement).offsetHeight);
  const before = { doc: await height(), header: await header() };
  const seen = new Set<number>();
  for (const y of [20, 60, 140, 400, 900, 300, 30, 0]) {
    await page.mouse.wheel(0, y - (await page.evaluate(() => window.scrollY)));
    await page.waitForTimeout(250);
    seen.add(await header());
    expect(await height(), `document height at ${y}`).toBe(before.doc);
  }
  expect([...seen], "the header keeps its height (it collapses by scrolling, not by resizing)").toEqual([before.header]);
});

// The plan's budget is 100 ms, on a production build (E2E_PROD=1 against `next start`). The e2e
// matrix runs on the dev server, where React's development build is several times slower; there the
// check is a looser ceiling that still catches a tap that blocks.
const TAP_BUDGET = process.env.E2E_PROD ? 100 : 250;

test(`(e) ADD paints its stepper within ${TAP_BUDGET} ms of the tap`, async ({ page }) => {
  const card = await firstCard(page);
  await card.getByRole("button", { name: /^Add .* to cart$/ }).waitFor();
  const ms = await card.evaluate(
    (el) =>
      new Promise<number>((done) => {
        const add = [...el.querySelectorAll("button")].find((b) => /^Add .* to cart$/.test(b.getAttribute("aria-label") ?? ""))!;
        const t0 = performance.now();
        add.click();
        // The first frame painted after the stepper is in the page.
        const check = () => (el.querySelector('[role="group"][aria-label^="Quantity of"]') ? requestAnimationFrame(() => done(performance.now() - t0)) : requestAnimationFrame(check));
        check();
      }),
  );
  expect(ms).toBeLessThan(TAP_BUDGET);
});

// The mango splash on the order success view (docs/design/shop-motion.md, "Mango splash").
test("(f) order success shows the mango splash and the headline lands after the burst", async ({ page }) => {
  await payDemoOrder(page);
  const splash = page.locator("svg[data-splash]");
  await expect(splash).toBeVisible();
  // Something is moving: the tendrils, droplets and the mango run as CSS animations, transform and opacity only.
  expect(await splash.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBeGreaterThan(20);
  const animated = await splash.evaluate((el) =>
    el.getAnimations({ subtree: true }).flatMap((a) => (a.effect as KeyframeEffect).getKeyframes().flatMap((k) => Object.keys(k).filter((p) => !["offset", "easing", "composite", "computedOffset"].includes(p)))),
  );
  expect([...new Set(animated)].sort()).toEqual(["opacity", "transform"]);
  await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible({ timeout: 2_000 });
  // The tick Lottie and the confetti are gone.
  await expect(page.locator("canvas, [data-confetti]")).toHaveCount(0);
});

test("(g) with reduced motion the splash is its resting frame, nothing runs", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await payDemoOrder(page);
  const splash = page.locator("svg[data-splash]");
  await expect(splash).toBeVisible();
  await expect(splash).toHaveAttribute("data-still", "");
  await page.waitForTimeout(400);
  expect(await splash.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  // The tendrils are out at their full length, not at zero.
  const scale = await splash.locator(".splash-tendril").first().evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a ** 2 + new DOMMatrix(getComputedStyle(el).transform).b ** 2);
  expect(scale).toBeGreaterThan(0.5);
  await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
});
