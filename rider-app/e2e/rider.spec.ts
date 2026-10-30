import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { mockApi, signIn, type Mock } from "./mock-api";

const fixture = (name: string) => path.join(__dirname, "fixtures", name);
const SEALED = fixture("sealed-box.jpg");
const OPEN = fixture("open-box.jpg");

async function pickUp(page: Page, m: Mock, number = "ORD-1093") {
  const card = page.getByTestId("current-stop");
  await expect(card).toContainText(number);
  await card.getByRole("link", { name: "Pick up at warehouse" }).click();
  await page.getByTestId("pickup-photo").setInputFiles(SEALED);
  await expect(page.getByRole("img", { name: /sealed box/ })).toBeVisible();
  await page.getByRole("button", { name: "Mark picked up" }).click();
  await expect(page.getByText("WhatsApp sent")).toBeVisible();
  expect(m.pickups).toBeGreaterThan(0);
}

async function toDoor(page: Page) {
  await page.getByRole("link", { name: "Back to the run" }).click();
  await page.getByTestId("current-stop").getByRole("link", { name: "At the door" }).click();
  await expect(page.getByTestId("step-1")).toHaveAttribute("data-state", "active");
}

test("login: phone, code and PIN, then today's run; a cold start asks only for the PIN", async ({ page }) => {
  await mockApi(page);
  await signIn(page);
  await expect(page.getByRole("heading", { name: /Morning/ })).toBeVisible();
  await expect(page.getByLabel("0 of 2 stops done")).toBeVisible();
  const card = page.getByTestId("current-stop");
  await expect(card).toContainText("Asha");
  await expect(card.getByRole("link", { name: "Navigate" })).toHaveAttribute(
    "href",
    "https://www.google.com/maps/dir/?api=1&destination=12%2C%204th%20Cross%2C%20Indiranagar%2C%20560038&travelmode=driving",
  );
  await expect(card.getByRole("link", { name: "Call" })).toHaveAttribute("href", "tel:+919812345678");

  // A new page load: the phone is bound, so the PIN is enough.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hi Suresh" })).toBeVisible();
  await page.getByTestId("pin").fill("1234");
  await page.waitForURL("**/today");
});

test("pickup with a photo marks the order out for delivery and shows the WhatsApp messages", async ({ page }) => {
  const m = await mockApi(page);
  await signIn(page);
  await pickUp(page, m);
  const photo = m.photos.find((p) => p.step === "pickup")!;
  expect(photo.lat).toBe("12.9716");
  expect(Number.isNaN(Date.parse(photo.takenAt!))).toBe(false);
  await expect(page.getByTestId("whatsapp-messages")).toContainText("Delivery code");
  await expect(page.getByTestId("whatsapp-messages")).toContainText("sent");
  expect(m.orders[0].status).toBe("OUT_FOR_DELIVERY");
});

test("door flow: a passing mango check unlocks the code; a wrong code twice, then the right one", async ({ page }) => {
  const m = await mockApi(page, { verdicts: ["pass"] });
  await signIn(page);
  await pickUp(page, m);
  await toDoor(page);

  // The code is locked until both photos and the check are done.
  await expect(page.getByTestId("step-4")).toHaveAttribute("data-state", "locked");
  await page.getByTestId("door-photo").setInputFiles(SEALED);
  await expect(page.getByTestId("step-1")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("step-4")).toHaveAttribute("data-state", "locked");
  await page.getByTestId("open-photo").setInputFiles(OPEN);
  await expect(page.getByTestId("step-3")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("step-4")).toHaveAttribute("data-state", "active");

  await page.getByTestId("delivery-code").fill("1111");
  await expect(page.getByText("That code is not right. 2 tries left.")).toBeVisible();
  await expect(page.getByTestId("tries-left")).toHaveText("2 of 3 tries left");
  await page.getByTestId("delivery-code").fill("2222");
  await expect(page.getByTestId("tries-left")).toHaveText("1 of 3 tries left");
  await page.getByTestId("delivery-code").fill("4821");
  await expect(page.getByRole("heading", { name: "Delivered" })).toBeVisible();
  await expect(page.getByTestId("delivered-tick")).toBeVisible();
  expect(m.photos.map((p) => p.step)).toEqual(["pickup", "door", "open_box"]);
});

test("a failing mango check shows the reason and a retake passes", async ({ page }) => {
  const m = await mockApi(page, { verdicts: ["fail", "pass"] });
  await signIn(page);
  await pickUp(page, m);
  await toDoor(page);
  await page.getByTestId("door-photo").setInputFiles(SEALED);
  await page.getByTestId("open-photo").setInputFiles(SEALED);
  await expect(page.getByTestId("verdict-fail")).toContainText("The box is closed: no mangoes are visible.");
  await expect(page.getByTestId("step-4")).toHaveAttribute("data-state", "locked");
  await expect(page.getByRole("button", { name: "Continue for review" })).toHaveCount(0);

  // Retake: the open-box camera is still there with the failed photo.
  await page.getByTestId("open-photo").setInputFiles(OPEN);
  await expect(page.getByTestId("step-3")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("step-4")).toHaveAttribute("data-state", "active");
});

test("two failed checks: continue for review unlocks the code", async ({ page }) => {
  const m = await mockApi(page, { verdicts: ["fail", "fail"] });
  await signIn(page);
  await pickUp(page, m);
  await toDoor(page);
  await page.getByTestId("door-photo").setInputFiles(SEALED);
  await page.getByTestId("open-photo").setInputFiles(SEALED);
  await expect(page.getByTestId("verdict-fail")).toBeVisible();
  await page.getByTestId("open-photo").setInputFiles(SEALED);
  await page.getByRole("button", { name: "Continue for review" }).click();
  await expect(page.getByTestId("step-4")).toHaveAttribute("data-state", "active");
});

test("three wrong codes lock the stop with Call ops", async ({ page }) => {
  const m = await mockApi(page);
  await signIn(page);
  await pickUp(page, m);
  await toDoor(page);
  await page.getByTestId("door-photo").setInputFiles(SEALED);
  await page.getByTestId("open-photo").setInputFiles(OPEN);
  for (const c of ["1111", "2222", "3333"]) {
    await expect(page.getByTestId("step-4")).toHaveAttribute("data-state", "active");
    await page.getByTestId("delivery-code").fill(c);
    await expect(page.getByTestId("delivery-code").or(page.getByTestId("code-locked"))).toBeVisible();
    await page.waitForTimeout(300);
  }
  await expect(page.getByTestId("code-locked")).toBeVisible();
  await expect(page.getByTestId("code-locked").getByRole("link", { name: "Call ops" })).toHaveAttribute("href", "tel:+919800000001");
});

test("offline between steps: photos queue with a pending badge and upload after reconnecting", async ({ page, context }) => {
  const m = await mockApi(page);
  await signIn(page);
  await pickUp(page, m);
  await toDoor(page);

  m.down = true;
  await context.setOffline(true);
  await page.getByTestId("door-photo").setInputFiles(SEALED);
  await expect(page.getByTestId("step-1")).toHaveAttribute("data-state", "done");
  await page.getByTestId("open-photo").setInputFiles(OPEN);
  await expect(page.getByTestId("pending-badge").first()).toContainText("pending upload");
  expect(m.photos.filter((p) => p.step !== "pickup")).toHaveLength(0);
  await expect(page.getByTestId("step-4")).toHaveAttribute("data-state", "locked");

  m.down = false;
  await context.setOffline(false);
  await expect(page.getByTestId("pending-badge")).toHaveCount(0, { timeout: 20_000 });
  expect(m.photos.map((p) => p.step)).toEqual(["pickup", "door", "open_box"]);
  await expect(page.getByTestId("step-4")).toHaveAttribute("data-state", "active");
});

test("customer not home: a reason, and the stop shows as missed", async ({ page }) => {
  const m = await mockApi(page);
  await signIn(page);
  await pickUp(page, m);
  await toDoor(page);
  await page.getByRole("button", { name: "Customer not home" }).click();
  await page.getByRole("dialog").getByText("Customer not home").click();
  await page.getByRole("button", { name: "Report missed delivery" }).click();
  await page.waitForURL("**/today");
  await expect(page.getByText("Missed")).toBeVisible();
  expect(m.orders[0].status).toBe("DELIVERY_FAILED");
});
