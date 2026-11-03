// M3 S8 integration check for the camera path inside the workout runner: the real pose model on
// the mannequin fake camera counts a squat set; the runner saves and rates it; the completed
// summary shows the same reps as camera-counted. The full EXIT journey (known rep count, cues,
// tracking-degraded spans, second member denied) is S9's workout-journey.spec.ts.
import { expect, test, type Page } from "@playwright/test";
import { onboard, signUp } from "./helpers";

const runner = (page: Page) => page.getByTestId("workout-runner").filter({ visible: true });
const coach = (page: Page) => page.getByTestId("live-coach").filter({ visible: true });

test("a camera-tracked squat set is counted, rated, and appears as tracked in the summary", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signUp(page);
  await onboard(page);
  await page.goto("/app/plan");
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await expect(page.getByTestId("plan-version-label")).toHaveText("· version 1");
  await page.getByRole("button", { name: "Start Monday's workout", exact: true }).click();
  await expect(runner(page)).toBeVisible();
  await expect(runner(page)).toHaveAttribute("data-current-exercise", "bodyweight_squat");
  await expect(runner(page).getByTestId("camera-set")).toBeVisible();

  // First tracked set: the member is asked once whether tracking data may be saved.
  await expect(page.getByTestId("tracking-consent")).toBeVisible();
  await page.getByRole("button", { name: "Save my tracking data" }).click();
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(coach(page)).toHaveAttribute("data-session", "running", { timeout: 60_000 });
  await expect
    .poll(
      async () =>
        Number(await page.getByTestId("rep-count").filter({ visible: true }).textContent()),
      {
        timeout: 90_000,
        intervals: [250],
      },
    )
    .toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Stop camera" }).click();

  const final = await page.getByTestId("final-reps").textContent();
  const counted = Number(/^(\d+) rep/.exec(final ?? "")?.[1]);
  expect(counted).toBeGreaterThanOrEqual(2);

  const save = runner(page).getByTestId("save-tracked-set");
  await expect(save).toBeVisible();
  await expect(save.getByRole("heading")).toContainText(`${counted} reps counted`);
  await save.getByLabel("How hard was it? (optional)").selectOption("5");
  await save.getByRole("button", { name: "Save set" }).click();
  await expect(
    runner(page).locator('[data-testid="runner-exercise"][data-exercise-id="bodyweight_squat"]'),
  ).not.toHaveAttribute("data-state", "todo");

  await runner(page).getByRole("button", { name: "Finish workout" }).click();
  await runner(page).getByRole("button", { name: "Complete workout" }).click();
  await expect(page).toHaveURL(/\/summary$/);

  const squat = page.locator(
    '[data-testid="summary-exercise"][data-exercise-id="bodyweight_squat"]',
  );
  await expect(squat).toHaveAttribute("data-tracked", "true");
  await expect(squat.getByTestId("summary-set")).toHaveCount(1);
  await expect(squat.getByTestId("summary-set")).toHaveAttribute("data-source", "tracked");
  await expect(squat.getByTestId("summary-set")).toContainText(`${counted} reps`);
  await expect(squat.getByTestId("summary-set")).toContainText("felt 5 out of 10");
  await expect(squat.getByText("Coaching cues")).toBeVisible();
});
