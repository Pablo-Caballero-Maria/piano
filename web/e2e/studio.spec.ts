// The Studio: compose, save, open; and following the teacher's piano roll in a lesson.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openClass, signUp } from "./helpers";

/** Click the roll's grid `beats` beats from its left edge, on row `rows` from the top of the view. */
async function clickGrid(page: Page, beats: number) {
  const grid = page.locator(".roll .roll-grid");
  const box = (await grid.boundingBox())!;
  const ppb = Number(
    await page.locator(".roll").evaluate((el) => getComputedStyle(el).getPropertyValue("--ppb")),
  );
  const roll = (await page.locator(".roll").boundingBox())!;
  await page.mouse.click(box.x + beats * ppb + 5, roll.y + roll.height / 2);
}

test("compose a melody, save it, find it in my melodies, keep it after a reload", async ({ browser }) => {
  const page = await signUp(browser, "ana", "student");
  await page.getByRole("tab", { name: "Studio" }).click();
  await expect(page).toHaveURL(/#studio$/);
  await page.getByRole("button", { name: "New" }).click();
  await clickGrid(page, 0.1);
  await clickGrid(page, 1.1);
  await expect(page.locator(".roll .note")).toHaveCount(2);
  await expect(page.locator(".save-state")).toHaveText("● Unsaved");

  await page.getByLabel("Melody name").fill("Mi canción");
  await page.getByRole("button", { name: /Save/ }).click();
  await expect(page.getByText('Saved "Mi canción"')).toBeVisible();
  await expect(page.locator(".save-state")).toHaveText("✓ Saved");

  await page.getByRole("button", { name: /My melodies/ }).click();
  const list = page.getByRole("dialog", { name: "Melodies" });
  await expect(list.getByText("Mi canción")).toBeVisible();
  await expect(list.getByText(/2 notes/)).toBeVisible();
  await list.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Undo" }).click(); // the second note
  await expect(page.locator(".roll .note")).toHaveCount(1);
  await page.reload();
  await expect(page).toHaveURL(/#studio$/);
  await expect(page.locator(".roll .note")).toHaveCount(1); // the draft survived the reload
  await expect(page.getByLabel("Melody name")).toHaveValue("Mi canción");
});

test("a studio lesson: the student follows the teacher's roll, read-only, then gets their own back", async ({
  browser,
}) => {
  const teacher = await signUp(browser, "profe", "teacher");
  const student = await signUp(browser, "ana", "student");
  await student.getByRole("tab", { name: "Studio" }).click();
  await clickGrid(student, 0.1); // the student's own melody: one note
  await student.getByRole("tab", { name: "Piano" }).click();

  await teacher.getByRole("tab", { name: "Studio" }).click();
  await teacher.getByRole("button", { name: "New" }).click();
  for (const beat of [0.1, 1.1, 2.1]) await clickGrid(teacher, beat);
  const panel = await openClass(teacher);
  await panel.getByRole("button", { name: "Start the lesson" }).click();
  await panel.getByRole("button", { name: "Close" }).click();

  // The student is taken to the studio, showing the teacher's three notes
  await expect(student).toHaveURL(/#studio$/);
  await expect(student.locator(".followbar")).toContainText("piano roll (read-only)");
  await expect(student.locator(".roll .note")).toHaveCount(3);
  await expect(student.getByRole("button", { name: /Save/ })).toBeDisabled();

  await teacher.getByRole("button", { name: "Play" }).click();
  await expect(student.getByRole("button", { name: "Stop" })).toBeVisible(); // playing in step
  await clickGrid(teacher, 3.1); // an edit reaches the student too
  await expect(student.locator(".roll .note")).toHaveCount(4);

  await student.getByRole("button", { name: "Back to my melody" }).click();
  await expect(student.locator(".followbar")).toBeHidden();
  await expect(student.locator(".roll .note")).toHaveCount(1);
});
