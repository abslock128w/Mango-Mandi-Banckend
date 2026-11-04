// Captures README screenshots from a running production server (npm run start).
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const address = { id: "a1", label: "Home", line1: "Bandra West", pincode: "400050", city: "Mumbai", lat: 19.0596, lng: 72.8295 };
const line = { skuId: "alphonso-ripe-5", productId: "alphonso", qty: 2, name: "Alphonso", image: "/images/mangoes/m00.jpg", ripeness: "ripe", size: 5, price: 1399, mrp: 1749 };

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
async function shot(name, url, { width, height, mobile, cart, after } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(({ address, cart, line }) => {
    localStorage.setItem("mk-location", JSON.stringify({ state: { address, saved: [address] }, version: 1 }));
    if (cart) localStorage.setItem("mk-cart", JSON.stringify({ state: { lines: [line], tip: 0, slotId: null }, version: 1 }));
  }, { address, cart, line });
  const page = await ctx.newPage();
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  if (after) await after(page);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `docs/screenshots/${name}.png` });
  await ctx.close();
}
const phone = { width: 360, height: 780, mobile: true };
const laptop = { width: 1280, height: 800 };
await shot("home-phone", "/", phone);
await shot("home-laptop", "/", laptop);
await shot("listing-phone", "/c/ripe", phone);
await shot("listing-laptop", "/c/all", laptop);
await shot("product-sheet-phone", "/?product=alphonso&src=tile", phone);
await shot("product-laptop", "/p/alphonso", laptop);
await shot("cart-phone", "/", { ...phone, cart: true, after: (p) => p.getByTestId("cart-bar").click() });
await shot("cart-laptop", "/", { ...laptop, cart: true, after: (p) => p.getByRole("button", { name: /Cart, 2 items/ }).click() });
await shot("search-phone", "/search?q=pickle", phone);
await browser.close();
