import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockApi, signIn, type Mock } from "./mock-api";

// The structure of each of the five screens (the VMR Mangoes rework), an axe scan of each, and a
// screenshot of each at 390 × 844 in test-results/shots/ (gitignored) for a reviewer to look at.
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SEALED = path.join(__dirname, "fixtures", "sealed-box.jpg");
const OPEN = path.join(__dirname, "fixtures", "open-box.jpg");
const SHOTS = path.join(__dirname, "..", "test-results", "shots");

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

/** No WCAG 2.1 A/AA violations on what is on screen now, then a full-page screenshot. */
async function check(page: Page, name: string) {
  await page.waitForTimeout(600);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${name} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  fs.mkdirSync(SHOTS, { recursive: true });
  // From the top, so the sticky header sits where a rider sees it.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

async function pickUp(page: Page, m: Mock) {
  await page.getByTestId("current-stop").getByRole("link", { name: "Pick up at warehouse" }).click();
  await page.getByTestId("pickup-photo").setInputFiles(SEALED);
  await page.getByRole("button", { name: "Mark picked up" }).click();
  await expect(page.getByText("WhatsApp sent")).toBeVisible();
  expect(m.pickups).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Back to the run" }).click();
}

test("sign in: a big number field, the demo code shown on screen, and a PIN pad with large keys", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  const phone = page.getByLabel("Mobile number");
  expect((await phone.boundingBox())!.height).toBeGreaterThanOrEqual(64);
  await check(page, "01-sign-in");
  await phone.fill("9812300001");
  await page.getByRole("button", { name: "Send code" }).click();

  // The API returned the code (demo, nothing sent): the screen says so and shows it.
  await expect(page.getByTestId("demo-code")).toContainText("Demo mode");
  await expect(page.getByTestId("demo-code")).toContainText("123456");
  await check(page, "02-sign-in-code");
  await page.getByTestId("otp").fill("123456");

  // The PIN, typed on the on-screen pad: ten digit keys of at least 48 px and a delete key.
  const pad = page.getByRole("group", { name: "PIN keypad" });
  await expect(pad).toBeVisible();
  for (const d of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
    const box = (await pad.getByRole("button", { name: d, exact: true }).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    expect(box.width).toBeGreaterThanOrEqual(48);
  }
  await check(page, "03-set-pin");
  await pad.getByRole("button", { name: "1", exact: true }).click();
  await pad.getByRole("button", { name: "9", exact: true }).click();
  await pad.getByRole("button", { name: "Delete last digit" }).click();
  await pad.getByRole("button", { name: "2", exact: true }).click();
  await expect(page.getByTestId("pin")).toHaveValue("12");
  await pad.getByRole("button", { name: "3", exact: true }).click();
  await pad.getByRole("button", { name: "4", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Enter it again" })).toBeVisible();
  for (const d of ["1", "2", "3", "4"]) await page.getByRole("group", { name: "PIN keypad" }).getByRole("button", { name: d, exact: true }).click();
  await page.waitForURL("**/today");

  // A cold start on the bound phone: the PIN screen, with the same pad.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hi Suresh" })).toBeVisible();
  await expect(page.getByRole("group", { name: "PIN keypad" })).toBeVisible();
  await check(page, "04-unlock");
});

test("today: the date and slot, the progress, the current stop as a hero, the other stops, and the pickup entry", async ({ page }) => {
  const m = await mockApi(page);
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Morning" })).toBeVisible();
  await expect(page.getByText(/^Today · /)).toBeVisible();
  await expect(page.getByTestId("run-progress")).toHaveText("0 of 2 stops done");
  await expect(page.getByRole("progressbar", { name: "0 of 2 stops done" })).toHaveAttribute("aria-valuenow", "0");

  const hero = page.getByTestId("current-stop");
  await expect(hero.getByRole("heading", { name: "Asha" })).toBeVisible();
  await expect(hero).toContainText("Stop 1 of 2 · ORD-1093");
  await expect(hero).toContainText("1 box");
  await expect(hero.getByRole("link", { name: "To warehouse" })).toBeVisible();
  await expect(hero.getByRole("link", { name: "Call" })).toBeVisible();
  for (const name of ["To warehouse", "Call", "Pick up at warehouse"]) expect((await hero.getByRole("link", { name }).boundingBox())!.height).toBeGreaterThanOrEqual(48);

  // The other stops, in order, with chips and formatted order numbers (S743406081 is read S-743 406 081).
  const others = page.getByTestId("other-stops");
  await expect(others.getByTestId("stop-row")).toHaveCount(1);
  await expect(others).toContainText("Ravi");
  await expect(others).toContainText("S-743 406 081");
  await expect(others).not.toContainText("S743406081");
  await expect(others.getByTestId("stop-chip")).toHaveText("To pick up");
  // Before any pickup the current stop is the way in: no separate pickup entry.
  await expect(page.getByTestId("pickup-entry")).toHaveCount(0);
  await check(page, "05-today");

  await pickUp(page, m);
  await expect(page.getByTestId("run-progress")).toHaveText("0 of 2 stops done");
  await expect(hero.getByTestId("stop-chip")).toHaveText("On the way");
  await expect(hero.getByRole("link", { name: "Navigate" })).toBeVisible();
  await expect(hero.getByRole("link", { name: "At the door" })).toBeVisible();
  // Ravi's boxes still wait at the warehouse: the pickup entry names it and leads to his pickup.
  const entry = page.getByTestId("pickup-entry");
  await expect(entry.getByRole("heading", { name: "Electronic City hub" })).toBeVisible();
  await expect(entry).toContainText("2 boxes for 1 stop");
  await expect(entry.getByRole("link", { name: "Pick up next" })).toHaveAttribute("href", "/pickup?id=ord_b2");
  await check(page, "06-today-out");
});

test("pickup: framing, retake, a big Mark picked up, and the two WhatsApp messages as a list", async ({ page }) => {
  await mockApi(page);
  await signIn(page);
  // Ravi's order: the order number reads formatted in the header.
  await page.getByTestId("other-stops").getByRole("button", { name: /Ravi/ }).click();
  await page.getByTestId("other-stops").getByRole("link", { name: "Pick up" }).click();
  await expect(page.getByTestId("back-bar")).toContainText("Pickup · S-743 406 081");
  await expect(page.getByTestId("pickup-warehouse-card")).toContainText("Electronic City hub");
  const mark = page.getByRole("button", { name: "Mark picked up" });
  await expect(mark).toBeDisabled();
  await check(page, "07-pickup");

  await page.getByTestId("pickup-photo").setInputFiles(SEALED);
  await expect(page.getByRole("img", { name: /2 sealed boxes/ })).toBeVisible();
  await expect(page.getByText("Retake")).toBeVisible();
  await expect(mark).toBeEnabled();
  expect((await mark.boundingBox())!.height).toBeGreaterThanOrEqual(64);
  await check(page, "08-pickup-photo");
  await mark.click();
  await expect(page.getByText("WhatsApp sent")).toBeVisible();
  const messages = page.getByTestId("whatsapp-messages").getByRole("listitem");
  await expect(messages).toHaveCount(2);
  await expect(messages.nth(0)).toContainText("Out for delivery");
  await expect(messages.nth(1)).toContainText("Delivery code");
  await check(page, "09-picked-up");
});

test("stop: a vertical stepper that unlocks in order, four big code boxes, and the secondary actions at the bottom", async ({ page }) => {
  const m = await mockApi(page);
  await signIn(page);
  await pickUp(page, m);
  await page.getByTestId("current-stop").getByRole("link", { name: "At the door" }).click();
  await expect(page.getByTestId("back-bar")).toContainText("ORD-1093 · step 1 of 5");

  const step = (n: number) => page.getByTestId(`step-${n}`);
  await expect(step(1)).toHaveAttribute("data-state", "active");
  await expect(step(1)).toHaveAttribute("aria-current", "step");
  await expect(step(1)).toContainText("Now");
  for (const n of [2, 3, 4, 5]) {
    await expect(step(n)).toHaveAttribute("data-state", "locked");
    await expect(step(n)).toContainText("Locked");
    await expect(step(n)).not.toHaveAttribute("aria-current", "step");
  }
  await expect(step(2)).toContainText("Opens after the door photo.");
  await expect(step(2).getByTestId("open-photo")).toHaveCount(0);
  const actions = page.getByRole("region", { name: "Other actions" });
  await expect(actions.getByRole("button", { name: "Customer not home" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Reschedule" })).toBeVisible();
  await expect(actions.getByRole("link", { name: "Call ops" })).toBeVisible();
  await check(page, "10-stop-start");

  await page.getByTestId("door-photo").setInputFiles(SEALED);
  await expect(step(1)).toHaveAttribute("data-state", "done");
  await expect(step(1)).toContainText("Done");
  await expect(step(2)).toHaveAttribute("data-state", "active");
  await expect(step(3)).toHaveAttribute("data-state", "locked");
  await expect(page.getByTestId("back-bar")).toContainText("step 2 of 5");

  await page.getByTestId("open-photo").setInputFiles(OPEN);
  await expect(step(3)).toHaveAttribute("data-state", "done");
  await expect(step(3)).toContainText("The mangoes look good.");
  await expect(step(4)).toHaveAttribute("data-state", "active");
  await expect(step(5)).toHaveAttribute("data-state", "locked");
  // Four big boxes for the code, and a mango-yellow Confirm.
  const boxes = step(4).locator('[aria-hidden="true"] > span');
  await expect(boxes).toHaveCount(4);
  expect((await boxes.first().boundingBox())!.height).toBeGreaterThanOrEqual(72);
  await expect(step(4).getByRole("button", { name: "Confirm code" })).toBeDisabled();
  await check(page, "11-stop-code");

  await page.getByTestId("delivery-code").fill("4821");
  await expect(page.getByRole("heading", { name: "Delivered" })).toBeVisible();
  await expect(page.getByText("ORD-1093 is with Asha")).toBeVisible();
  await check(page, "12-delivered");
});

test("run complete: delivered, missed, the time from the first pickup and the sign-off", async ({ page }) => {
  const m = await mockApi(page);
  await signIn(page);
  // Asha: picked up and delivered.
  await pickUp(page, m);
  await page.getByTestId("current-stop").getByRole("link", { name: "At the door" }).click();
  await page.getByTestId("door-photo").setInputFiles(SEALED);
  await page.getByTestId("open-photo").setInputFiles(OPEN);
  await page.getByTestId("delivery-code").fill("4821");
  await page.getByRole("link", { name: "Next stop: Ravi" }).click();
  // Ravi: picked up, then not at home.
  await page.getByTestId("pickup-photo").setInputFiles(SEALED);
  await page.getByRole("button", { name: "Mark picked up" }).click();
  await expect(page.getByText("WhatsApp sent")).toBeVisible();
  await page.getByRole("link", { name: "Back to the run" }).click();
  await page.getByTestId("current-stop").getByRole("link", { name: "At the door" }).click();
  await page.getByRole("button", { name: "Customer not home" }).click();
  await page.getByRole("dialog").getByText("Customer not home").click();
  await page.getByRole("button", { name: "Report missed delivery" }).click();
  await page.waitForURL("**/today");
  await expect(page.getByTestId("run-progress")).toHaveText("2 of 2 stops done");
  await page.getByRole("link", { name: "Run complete: see the summary" }).click();

  await expect(page.getByRole("heading", { name: "All stops done" })).toBeVisible();
  await expect(page.getByTestId("done-delivered")).toHaveText("1");
  await expect(page.getByTestId("done-missed")).toHaveText("1");
  await expect(page.getByTestId("done-time")).toHaveText(/\d+ min/);
  const signOff = page.getByTestId("sign-off");
  await expect(signOff.getByRole("heading", { name: "Done for today" })).toBeVisible();
  await expect(signOff).toContainText("Take the 2 boxes you could not deliver back to the warehouse");
  await expect(page.locator("body")).not.toContainText("!");
  await check(page, "13-run-complete");
});
