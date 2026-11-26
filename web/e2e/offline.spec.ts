// The service worker (src/sw/worker.ts): the page opens without a connection — a phone that has lost
// the classroom's WiFi — and plays on the phone's own sound. And the light/dark theme.
import { expect, test } from "./fixtures";

test("the page opens offline once it has been visited", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve));
  });
  await expect
    .poll(() => page.evaluate(async () => (await (await caches.open("pages")).keys()).length))
    .toBe(1);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Piano" })).toBeVisible();
  await expect(page.locator(".key.white").first()).toBeVisible();
  await page.getByRole("tab", { name: "Studio" }).click();
  await expect(page.locator(".roll")).toBeVisible();
  await context.setOffline(false);
});

test("the theme is light by default; the dark one is remembered", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" }); // the system's preference doesn't matter
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(244, 245, 247)");
  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(20, 22, 26)");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#14161a");
});
