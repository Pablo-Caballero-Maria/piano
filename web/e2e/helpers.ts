/** Steps the end-to-end tests share: a phone (browser context) per person, signing up. */
import { expect, type Browser, type Page } from "@playwright/test";

let counter = 0;
/** A username nobody has used on this (fresh) board. */
export const uniqueName = (base: string) => `${base}${Date.now() % 100000}${counter++}`;

/** A new browser context ("phone") with an account of that role, in the class. */
export async function signUp(browser: Browser, base: string, role: "teacher" | "student"): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  const name = uniqueName(base);
  await page.getByRole("button", { name: "Log in" }).click();
  const dialog = page.getByRole("dialog", { name: "Your account" });
  await dialog.getByRole("button", { name: "Create account" }).click();
  await dialog.getByRole("button", { name: role === "teacher" ? "I'm a teacher" : "I'm a student" }).click();
  await dialog.getByLabel("Username").fill(name);
  await dialog.getByLabel("Password").fill("secret123");
  await dialog.locator('button[type="submit"]').click();
  await expect(page.getByRole("button", { name })).toBeVisible();
  await expect(page.locator("header .status")).toContainText("In class");
  return page;
}

export const username = async (page: Page) =>
  (await page.locator("header button[title^='Account']").innerText()).trim();

/** The class panel. */
export async function openClass(page: Page) {
  await page.getByRole("button", { name: "Class" }).click();
  return page.getByRole("dialog", { name: "Class" });
}
