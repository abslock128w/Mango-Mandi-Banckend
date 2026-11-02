import { expect, test } from "@playwright/test";
import { choosePincode } from "./helpers";

// Every control is at least 44 x 44 px (design/COMPONENTS.md, "Shape": --tap-min). A control may
// look smaller and reach 44 px with an invisible ::after hit area (after:-inset-y-...). Exempt:
// links inside running text (WCAG 2.5.8's inline exception) and visually hidden skip links. The
// carousel's slide dots are 24 x 44 px: 44 px wide dots would spread the pager over a third of a
// phone; slides also swipe, and 24 px meets WCAG 2.5.8 AA.
const small = () => {
  const out: string[] = [];
  const sel = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=radio], [role=checkbox], [role=switch], summary';
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
    const box = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (box.width <= 1 || box.height <= 1 || s.visibility === "hidden" || s.display === "none") continue;
    if (el.closest("[aria-hidden=true], [inert]")) continue;
    const af = getComputedStyle(el, "::after");
    const px = (v: string) => (v.endsWith("px") ? parseFloat(v) : 0);
    let w = box.width;
    let h = box.height;
    if (af.content !== "none" && af.position === "absolute") {
      w = Math.max(w, box.width - px(af.left) - px(af.right));
      h = Math.max(h, box.height - px(af.top) - px(af.bottom));
    }
    const inline = el.tagName === "A" && s.display === "inline" && /\S/.test((el.parentElement?.textContent ?? "").replace(el.textContent ?? "", ""));
    const dot = (el.getAttribute("aria-label") ?? "").startsWith("Go to slide") && w >= 24 && h >= 44;
    if (!inline && !dot && (Math.round(w) < 44 || Math.round(h) < 44)) {
      const name = (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
      out.push(`${el.tagName.toLowerCase()} "${name}" ${Math.round(w)}x${Math.round(h)}`);
    }
  }
  return [...new Set(out)];
};

for (const path of ["/", "/c/all", "/p/alphonso", "/search?q=mango", "/location", "/help", "/bulk", "/preorder", "/login"]) {
  test(`${path}: every control is at least 44 px`, async ({ page }) => {
    await choosePincode(page);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    // Rails below the fold draw when scrolled to.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(300);
    expect(await page.evaluate(small)).toEqual([]);
  });
}

test("product cards keep the price and box size on one line each beside ADD at 360 px", async ({ page }) => {
  test.skip(page.viewportSize()!.width > 400, "phones only");
  await choosePincode(page);
  await page.goto("/c/all");
  const card = page.getByTestId("product-card").first();
  await expect(card).toBeVisible();
  const lines = await card.evaluate((c) => {
    const col = c.querySelector(".mt-auto > div") as HTMLElement;
    return Array.from(col.children).map((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
  });
  expect(lines).toEqual([1, 1]);
});

test("home rail headings keep 12 px clear of 'see all', which stays on one line", async ({ page }) => {
  await choosePincode(page);
  await page.waitForLoadState("networkidle");
  const gaps = await page.evaluate(() =>
    Array.from(document.querySelectorAll("section[aria-labelledby] > div:first-child")).flatMap((row) => {
      const h = row.querySelector("h2");
      const a = row.querySelector("a");
      if (!h || !a || !/see all/.test(a.textContent ?? "")) return [];
      const r = document.createRange();
      r.selectNodeContents(h);
      const textRight = Math.max(...Array.from(r.getClientRects()).map((x) => x.right));
      const link = a.getBoundingClientRect();
      return [{ h: h.textContent, gap: Math.round(link.left - textRight), lines: Math.round(link.height / 44) }];
    }),
  );
  expect(gaps.length).toBeGreaterThan(0);
  for (const g of gaps) {
    expect(g.gap, g.h ?? "").toBeGreaterThanOrEqual(12);
    expect(g.lines, g.h ?? "").toBe(1);
  }
});
