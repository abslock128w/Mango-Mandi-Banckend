import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockApi, signIn } from "./mock-api";

// axe, WCAG 2.1 A and AA, on every rider screen and state.
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SEALED = path.join(__dirname, "fixtures", "sealed-box.jpg");
const OPEN = path.join(__dirname, "fixtures", "open-box.jpg");

test("every rider screen has no WCAG 2.1 A/AA violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const found: string[] = [];
  const scan = async (where: string, p: Page = page) => {
    await p.waitForTimeout(300);
    for (const v of (await new AxeBuilder({ page: p }).withTags(WCAG).analyze()).violations) found.push(`${where} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
  };
  await mockApi(page);
  await page.goto("/");
  await scan("sign in: phone");
  await page.getByLabel("Mobile number").fill("9812300001");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("otp")).toBeVisible();
  await scan("sign in: code");
  await page.getByTestId("otp").fill("123456");
  await expect(page.getByTestId("pin")).toBeVisible();
  await scan("sign in: new PIN");
  await page.getByTestId("pin").fill("1234");
  await page.getByRole("heading", { name: "Enter it again" }).waitFor();
  await page.getByTestId("pin").fill("1234");
  await page.waitForURL("**/today");
  await expect(page.getByTestId("current-stop")).toBeVisible();
  await scan("today");
  await page.getByTestId("current-stop").getByRole("link", { name: "Pick up at warehouse" }).click();
  await scan("pickup");
  await page.getByTestId("pickup-photo").setInputFiles(SEALED);
  await page.getByRole("button", { name: "Mark picked up" }).click();
  await expect(page.getByText("WhatsApp sent")).toBeVisible();
  await scan("picked up");
  await page.getByRole("link", { name: "Back to the run" }).click();
  await page.getByTestId("current-stop").getByRole("link", { name: "At the door" }).click();
  await scan("stop");
  await page.getByTestId("door-photo").setInputFiles(SEALED);
  await page.getByTestId("open-photo").setInputFiles(OPEN);
  await expect(page.getByTestId("step-4")).toHaveAttribute("data-state", "active");
  await scan("stop: code");
  await page.getByTestId("delivery-code").fill("1111");
  await expect(page.getByText("That code is not right. 2 tries left.")).toBeVisible();
  await scan("stop: wrong code");
  await page.getByRole("button", { name: "Customer not home" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await scan("not home");
  await page.keyboard.press("Escape");
  await page.goto("/");
  await expect(page.getByTestId("pin")).toBeVisible();
  await scan("unlock");
  expect(found).toEqual([]);
});
