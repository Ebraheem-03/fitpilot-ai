// M3 S8 — FR-07 / FR-02 / FR-03: start a workout from the plan, log sets by hand, skip an
// exercise, rate, complete, reload, and find the saved summary and history. The tracked squat set
// on the mannequin camera belongs to the S9 EXIT journey (workout-journey.spec.ts); here a
// camera-tracked exercise is logged by hand, which is a supported path in its own right.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signUp, startWorkout } from "./helpers";

const runner = (page: Page) => page.getByTestId("workout-runner").filter({ visible: true });

async function planAndStart(page: Page) {
  await signUp(page);
  const id = await startWorkout(page);
  await expect(runner(page)).toBeVisible();
  return id;
}

/** Log one set by hand with the form's defaults (the plan's target), optionally rated. */
async function logSet(page: Page, opts: { difficulty?: string; note?: string } = {}) {
  const r = runner(page);
  const byCamera = r.getByRole("button", { name: "Log this set by hand instead" });
  if (await byCamera.isVisible()) await byCamera.click();
  if (opts.difficulty) {
    await r.getByLabel("How hard was it? (optional)").selectOption(opts.difficulty);
  }
  if (opts.note) await r.getByLabel("Note (optional)").fill(opts.note);
  await r.getByRole("button", { name: "Save set", exact: true }).click();
}

/** Walk the workout: skip the first exercise, log every set of the others. Returns what it did. */
async function walk(page: Page) {
  const r = runner(page);
  const skipped: string[] = [];
  const logged: Record<string, number> = {};
  for (let guard = 0; guard < 60; guard++) {
    const phase = await r.getAttribute("data-phase");
    if (phase === "finish") break;
    if (phase === "rest") {
      await r.getByRole("button", { name: "Skip rest" }).click();
      continue;
    }
    const id = (await r.getAttribute("data-current-exercise"))!;
    const setNumber = await r.getAttribute("data-set-number");
    if (skipped.length === 0) {
      await r.getByLabel("Why skip it? (optional)").selectOption("no_time");
      await r.getByRole("button", { name: "Skip exercise" }).click();
      skipped.push(id);
    } else {
      await logSet(page, setNumber === "1" ? { difficulty: "6", note: "felt fine" } : {});
      logged[id] = (logged[id] ?? 0) + 1;
    }
    // wait for the screen to move on before reading it again
    await page.waitForFunction(
      ([prev, n]) => {
        const el = document.querySelector('[data-testid="workout-runner"]:not([hidden])');
        return (
          el?.getAttribute("data-phase") !== "set" ||
          el.getAttribute("data-current-exercise") !== prev ||
          el.getAttribute("data-set-number") !== n
        );
      },
      [id, setNumber],
    );
  }
  return { skipped, logged };
}

test("EXIT-S8: start, log sets, skip, complete, reload: the saved summary persists", async ({
  page,
}) => {
  await planAndStart(page);
  const r = runner(page);
  await expect(r.getByTestId("current-step")).toBeVisible();
  await expect(r.getByTestId("runner-set-progress")).toContainText(/^Set 1 of \d+ · \d+ (reps|s)$/);
  await expect(r.getByRole("heading", { name: "How to do it" })).toBeVisible();

  const { skipped, logged } = await walk(page);
  expect(skipped).toHaveLength(1);
  expect(Object.keys(logged).length).toBeGreaterThan(0);
  await expect(r.getByTestId("finish-panel")).toBeVisible();
  await expect(
    r.locator(`[data-testid="runner-exercise"][data-exercise-id="${skipped[0]}"]`),
  ).toHaveAttribute("data-state", "skipped");
  await expect(r.getByTestId("workout-progress")).toContainText("1 skipped");

  await r.getByLabel("How hard was the whole workout? (optional)").selectOption("7");
  await r.getByLabel("Note (optional)").fill("good session");
  await r.getByRole("button", { name: "Complete workout" }).click();

  await expect(page).toHaveURL(/\/app\/workouts\/[0-9a-f-]{36}\/summary$/);
  const summaryUrl = page.url();
  const summary = page.getByTestId("session-summary");
  await expect(summary).toBeVisible();

  const check = async () => {
    await expect(page.getByTestId("summary-difficulty")).toHaveText("7 out of 10");
    await expect(page.getByTestId("summary-note")).toHaveText("good session");
    const skippedSection = page.locator(
      `[data-testid="summary-exercise"][data-exercise-id="${skipped[0]}"]`,
    );
    await expect(skippedSection).toHaveAttribute("data-status", "skipped");
    await expect(skippedSection).toContainText("short on time");
    for (const [id, n] of Object.entries(logged)) {
      const section = page.locator(`[data-testid="summary-exercise"][data-exercise-id="${id}"]`);
      await expect(section).toHaveAttribute("data-status", "completed");
      await expect(section.getByTestId("summary-set")).toHaveCount(n);
      await expect(section.getByTestId("summary-set").first()).toHaveAttribute(
        "data-source",
        "manual",
      );
      await expect(section.getByTestId("summary-set").first()).toContainText("felt 6 out of 10");
      await expect(section.getByTestId("summary-tracked")).toHaveText(
        /Camera-tracked|Logged by hand/,
      );
    }
  };
  await check();

  // Reload: the saved session is still there.
  await page.reload();
  await expect(summary).toBeVisible();
  await check();

  // The workout page of a finished session leads to its summary.
  await page.goto(summaryUrl.replace("/summary", ""));
  await expect(page).toHaveURL(/\/summary$/);
});

test("reloading in the middle of a workout resumes where the member was", async ({ page }) => {
  const id = await planAndStart(page);
  const r = runner(page);
  const first = (await r.getAttribute("data-current-exercise"))!;
  await logSet(page);
  // either the rest timer (more sets) or the next exercise
  await expect(r.getByTestId("runner-exercise").first()).not.toHaveAttribute("data-state", "todo");
  const before = await r.getAttribute("data-phase");

  await page.reload();
  await expect(runner(page)).toBeVisible();
  // the first exercise has progress, not "Set 1" again
  await expect(
    runner(page).locator(`[data-testid="runner-exercise"][data-exercise-id="${first}"]`),
  ).not.toHaveAttribute("data-state", "todo");
  const phase = await runner(page).getAttribute("data-phase");
  if (before === "rest") {
    expect(await runner(page).getAttribute("data-set-number")).toBe("2");
    expect(phase).toBe("set"); // the rest timer is not resumed
  }

  // From the plan page the unfinished workout is offered for resuming, not started again.
  await page.goto("/app/plan");
  await expect(page.getByTestId("resume-workout").first()).toHaveAttribute(
    "href",
    `/app/workouts/${id}`,
  );
  await page.getByTestId("resume-workout").first().click();
  await expect(page).toHaveURL(new RegExp(`/app/workouts/${id}$`));
  await expect(runner(page)).toBeVisible();
});

test("history lists workouts; deleting asks first and removes the summary", async ({ page }) => {
  const id = await planAndStart(page);
  await page.goto("/app/workouts");
  const item = page.getByTestId("workout-item").filter({ visible: true });
  await expect(item).toHaveCount(1);
  await expect(item).toHaveAttribute("data-status", "started");

  // finish it quickly: skip everything
  await item.getByRole("link").click();
  for (let guard = 0; guard < 20; guard++) {
    if ((await runner(page).getAttribute("data-phase")) === "finish") break;
    await runner(page).getByRole("button", { name: "Skip exercise" }).click();
    await page.waitForTimeout(100);
  }
  await runner(page).getByRole("button", { name: "Complete workout" }).click();
  await expect(page).toHaveURL(/\/summary$/);
  await expect(page.getByTestId("summary-counts")).toContainText("0 done");

  await page.goto("/app/workouts");
  await expect(item).toHaveAttribute("data-status", "completed");

  // Delete needs a confirmation; "Keep it" cancels.
  await item.getByRole("button", { name: /^Delete/ }).click();
  await expect(item.getByTestId("delete-confirm")).toBeVisible();
  await item.getByRole("button", { name: "Keep it" }).click();
  await expect(item.getByTestId("delete-confirm")).toHaveCount(0);
  await expect(item).toHaveCount(1);

  await item.getByRole("button", { name: /^Delete/ }).click();
  await item.getByRole("button", { name: "Delete workout" }).click();
  await expect(page.getByTestId("history-message")).toHaveText("Workout deleted.");
  await expect(page.getByTestId("no-workouts")).toBeVisible();

  await page.goto(`/app/workouts/${id}/summary`);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});

test("another member cannot open my workout or its summary", async ({ browser }) => {
  const a = await browser.newPage();
  const id = await planAndStart(a);
  const b = await browser.newPage();
  await signUp(b);
  for (const path of [`/app/workouts/${id}`, `/app/workouts/${id}/summary`]) {
    await b.goto(path);
    await expect(b.getByText("This page could not be found.")).toBeVisible();
    await expect(b.getByTestId("workout-runner")).toHaveCount(0);
  }
});

test("the workout runner is keyboard operable, accessible and fits a phone", async ({ page }) => {
  await planAndStart(page);
  const r = runner(page);

  // Keyboard: reach the form by tabbing and save with Enter.
  const byCamera = r.getByRole("button", { name: "Log this set by hand instead" });
  if (await byCamera.isVisible()) {
    await byCamera.focus();
    await page.keyboard.press("Enter");
  }
  const amount = r.getByLabel(/Reps completed|Seconds held/);
  await amount.focus();
  await expect(amount).toBeFocused();
  await page.keyboard.press("Enter"); // submits the form
  // Enter in the field saved the set: the screen moved on (rest, or the next set/exercise).
  await expect(r.getByTestId("runner-exercise").first()).not.toHaveAttribute("data-state", "todo");
  await expect(r.getByTestId("workout-progress")).toBeVisible();

  const { violations } = await new AxeBuilder({ page }).include("body").analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes[0]?.html}`).join("\n")).toEqual([]);

  await page.setViewportSize({ width: 375, height: 740 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
  await expect(r.getByRole("button", { name: "Finish workout" })).toBeVisible();
});
