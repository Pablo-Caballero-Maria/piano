// The classroom's copy of the website: built by the teacher's PC, so no Vercel telemetry.
import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("in the classroom the page only talks to the teacher's PC", async ({ browser, baseURL }) => {
  const teacher = await signUp(browser, "privacy", "teacher");
  const elsewhere: string[] = [];
  teacher.on("request", (request) => {
    const url = request.url();
    if (url.includes("/_vercel/") || (!url.startsWith(baseURL!) && /^https?:/.test(url))) elsewhere.push(url);
  });
  await teacher.reload();
  await teacher.getByRole("tab", { name: "Studio" }).click();
  await teacher.waitForLoadState("networkidle");
  // Vercel Web Analytics and Speed Insights are only in the build Vercel makes.
  expect(elsewhere).toEqual([]);
  await expect(teacher.locator('script[src*="/_vercel/"]')).toHaveCount(0);
});
