// A class in the classroom: the teacher's PC app with a simulated board (fog demo).
import { expect, test } from "./fixtures";
import { openClass, signUp, username } from "./helpers";

test("a piano lesson: the student sees the teacher's notes; the teacher sees the student", async ({
  browser,
}) => {
  const teacher = await signUp(browser, "profe", "teacher");
  const student = await signUp(browser, "ana", "student");
  const teacherName = await username(teacher);
  const studentName = await username(student);
  await expect(teacher.getByText("board online")).toBeVisible();

  const panel = await openClass(teacher);
  await expect(panel.getByText(studentName)).toBeVisible();
  await panel.getByRole("button", { name: "Start the lesson" }).click();
  await expect(panel.getByRole("button", { name: "End the lesson" })).toBeVisible();
  await panel.getByRole("button", { name: "Close" }).click();

  await expect(student.getByText(`${teacherName} is giving a piano lesson`)).toBeVisible();
  // The teacher holds A (C4) on the computer keyboard
  await teacher.keyboard.down("a");
  await expect(teacher.locator(".piano-view .now")).toContainText("C4");
  await expect(student.locator('.piano-view .key[data-midi="60"]')).toHaveClass(/teacher/);
  await expect(student.locator(".classbar .teacher-notes")).toHaveText("C4");
  await teacher.keyboard.up("a");
  await expect(student.locator(".classbar .teacher-notes")).toHaveText("");

  // The student plays: the teacher's panel says what they're playing
  await student.keyboard.down("d"); // E4
  const again = await openClass(teacher);
  await expect(again.getByText(/playing E4/)).toBeVisible();
  await student.keyboard.up("d");
  await again.getByRole("button", { name: "End the lesson" }).click();
  await expect(student.getByText(`${teacherName} is giving a piano lesson`)).toBeHidden();
});

test("the buzzer queue: first come, first served; the teacher moves it on", async ({ browser }) => {
  const teacher = await signUp(browser, "profe", "teacher");
  const ana = await signUp(browser, "ana", "student");
  const bo = await signUp(browser, "bo", "student");
  const boName = await username(bo);

  for (const page of [ana, bo]) {
    const panel = await openClass(page);
    await panel.getByRole("button", { name: "Ask for the buzzer" }).click();
    await panel.getByRole("button", { name: "Close" }).click();
  }
  await expect(ana.locator(".classbar")).toContainText("you're playing on the buzzer");
  await expect(ana.getByText("Your turn: you're playing on the buzzer")).toBeVisible(); // a toast
  await expect(bo.locator(".classbar")).toContainText("you're #2 for the buzzer");

  const panel = await openClass(teacher);
  await panel.getByRole("button", { name: "Next" }).click();
  await expect(bo.locator(".classbar")).toContainText("you're playing on the buzzer");
  await expect(panel.getByText(`Playing on the buzzer: ${boName}`)).toBeVisible();
});
