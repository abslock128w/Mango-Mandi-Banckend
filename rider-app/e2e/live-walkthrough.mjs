// Walks one real order end to end against a running mango-api (no mocks), at 390 px,
// and saves a screenshot per step into docs/rider-app/. For the docs, not CI:
//   RIDER_URL=http://localhost:5175 API_URL=http://localhost:3200 ORDER_ID=ord_… CUST_PHONE=9876543210 node e2e/live-walkthrough.mjs
// The customer's code is read the way the shop reads it: the customer signs in (CUST_PHONE, a
// development API returns the login code) and opens the order (ORDER_ID).
import { chromium, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "..", "docs", "rider-app");
const RIDER = process.env.RIDER_URL ?? "http://localhost:5175";
const PHONE = process.env.RIDER_PHONE ?? "9000000001";
const step = process.argv[2] ?? "all";
const API = process.env.API_URL ?? "http://localhost:3000";
async function customerCode() {
  const post = (p, b) => fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
  const otp = await post("/v1/auth/otp/request", { phone: process.env.CUST_PHONE });
  const s = await post("/v1/auth/otp/verify", { phone: process.env.CUST_PHONE, code: otp.devCode });
  const o = await fetch(`${API}/v1/orders/${process.env.ORDER_ID}`, { headers: { Authorization: `Bearer ${s.accessToken}` } }).then((r) => r.json());
  console.log("shop shows", o.status, o.rider);
  return o.deliveryCode;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  geolocation: { latitude: 12.9352, longitude: 77.6245, accuracy: 9 }, permissions: ["geolocation"], serviceWorkers: "block",
  storageState: step === "door" ? path.join(here, "..", ".walkthrough-state.json") : undefined,
});
const page = await context.newPage();
const shot = async (name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `rider-${name}.png`) });
  console.log("shot", name);
};

if (step !== "door") {
  await page.goto(RIDER);
  await page.getByLabel("Mobile number").fill(PHONE);
  await shot("01-sign-in");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByTestId("otp").waitFor();
  const text = await page.locator("body").innerText();
  const code = /(\d{6})/.exec(text.slice(text.indexOf("Test code")))?.[1];
  if (!code) throw new Error("no test code on screen");
  await shot("02-code");
  await page.getByTestId("otp").fill(code);
  await page.getByTestId("pin").waitFor();
  await shot("03-set-pin");
  await page.getByTestId("pin").fill("4071");
  await page.getByRole("heading", { name: "Enter it again" }).waitFor();
  await page.getByTestId("pin").fill("4071");
  await page.waitForURL("**/today");
  await page.getByTestId("current-stop").waitFor();
  await shot("04-today");

  const card = page.getByTestId("current-stop");
  await card.getByRole("link", { name: "Pick up at warehouse" }).click();
  await page.getByTestId("pickup-photo").setInputFiles(path.join(here, "fixtures", "sealed-box.jpg"));
  await page.getByRole("img", { name: /sealed box/ }).waitFor();
  await shot("05-pickup-photo");
  await page.getByRole("button", { name: "Mark picked up" }).click();
  await page.getByText("WhatsApp sent").waitFor({ timeout: 30_000 });
  await shot("06-picked-up-whatsapp");
  await context.storageState({ path: path.join(here, "..", ".walkthrough-state.json") });
}

if (step === "pickup") {
  await browser.close();
  process.exit(0);
}

// At the door.
if (step === "door") {
  await page.goto(`${RIDER}/today`);
  const pin = page.getByTestId("pin");
  if (await pin.isVisible({ timeout: 5000 }).catch(() => false)) await pin.fill("4071");
  await page.waitForURL("**/today");
} else {
  await page.getByRole("link", { name: "Back to the run" }).click();
}
await page.getByTestId("current-stop").getByRole("link", { name: "At the door" }).click();
await page.getByTestId("step-1").waitFor();
await shot("07-stop-checklist");
await page.getByTestId("door-photo").setInputFiles(path.join(here, "fixtures", "sealed-box.jpg"));
await page.locator('[data-testid="step-1"][data-state="done"]').waitFor({ timeout: 30_000 });
await shot("08-door-photo");
await page.getByTestId("open-photo").setInputFiles(path.join(here, "fixtures", "open-box.jpg"));
await page.locator('[data-testid="step-3"][data-state="done"], [data-testid="step-3"][data-state="failed"]').first().waitFor({ timeout: 45_000 });
await shot("09-mango-check");
await page.locator('[data-testid="step-4"][data-state="active"]').waitFor({ timeout: 30_000 });
const right = await customerCode();
await page.getByTestId("delivery-code").fill(right === "0000" ? "1111" : "0000");
await page.getByTestId("tries-left").waitFor();
await shot("10-wrong-code");
const code = await customerCode();
await page.getByTestId("delivery-code").fill(code);
await page.getByRole("heading", { name: "Delivered" }).waitFor({ timeout: 30_000 });
await page.waitForTimeout(1200);
await shot("11-delivered");
const done = page.getByRole("link", { name: /Next stop|Back to the run|Run complete|Done/ }).first();
if (await done.isVisible().catch(() => false)) {
  await done.click();
  await page.waitForTimeout(1500);
  await shot("12-after-delivery");
}
await browser.close();
