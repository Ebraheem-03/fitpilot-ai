// M3 EXIT (blueprint §11): "the member can receive a plan, follow a demonstration, complete a
// tracked workout, and see a saved session summary." One journey through the real UI: the fake
// LLM provider writes the plan, the real pose model in the real worker counts a squat set on
// Chrome's fake camera (the generated mannequin, no real person: fake-camera.ts SHALLOW feed with
// known reps, one empty-room loop and a cue-triggering depth), the remaining exercises are logged
// by hand or skipped, and the saved summary survives a reload. A second member is denied.
import { expect, test, type Page } from "@playwright/test";
import { SHALLOW_FEED_REPS } from "./fake-camera";
import { onboard, signUp } from "./helpers";

const runner = (page: Page) => page.getByTestId("workout-runner").filter({ visible: true });
const coach = (page: Page) => page.getByTestId("live-coach").filter({ visible: true });
const status = (page: Page) => page.getByTestId("tracking-status").filter({ visible: true });
const reps = (page: Page) => page.getByTestId("rep-count").filter({ visible: true });
const viewer = (page: Page) => page.getByTestId("exercise-viewer").filter({ visible: true });
const phaseLabel = (page: Page) => page.getByTestId("viewer-phase").filter({ visible: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true }).filter({ visible: true });

const NOT_FOUND = "This page could not be found.";

test("EXIT: plan -> demo -> tracked workout -> saved summary; another member is denied", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  // CI and `make e2e` never reach a live model: the API runs with the fake provider (scripts/e2e.sh).
  expect(process.env.LLM_PROVIDER, "e2e must run the fake LLM provider").toBe("fake");

  // 1. Sign up and onboard.
  await signUp(page);
  await onboard(page);

  // 2. Generate a plan.
  await page.goto("/app/plan");
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await expect(page.getByTestId("plan-version-label")).toHaveText("· version 1");
  const planHref = await page
    .getByTestId("plan-version")
    .first()
    .getByRole("link")
    .getAttribute("href");
  expect(planHref).toMatch(/^\/app\/plan\/[0-9a-f-]{36}$/);

  // 3. Open today's workout (Monday: deterministic whatever day this runs) and its squat demo.
  await page.getByRole("button", { name: "Start Monday's workout", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/workouts\/[0-9a-f-]{36}$/);
  const workoutUrl = page.url();
  await expect(runner(page)).toBeVisible();
  await expect(runner(page)).toHaveAttribute("data-current-exercise", "bodyweight_squat");
  await page.emulateMedia({ reducedMotion: "reduce" }); // no autoplay: start from Standing
  await runner(page).getByRole("link", { name: "Watch the 3D demo" }).click();
  await expect(page).toHaveURL(/\/app\/exercises\/bodyweight_squat$/);
  await expect(viewer(page)).toHaveAttribute("data-status", /ready|paused|playing/);
  await expect(viewer(page).locator("canvas")).toBeVisible(); // real WebGL
  await button(page, "Reset").click();
  await expect(phaseLabel(page)).toHaveText("Standing · 0.0 / 4.0 s");
  await button(page, "Play").click();
  await expect(viewer(page)).toHaveAttribute("data-status", "playing");
  await expect(phaseLabel(page)).toContainText("Descending", { timeout: 8000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // Back to the runner, where the member left off.
  await page.goBack();
  await expect(page).toHaveURL(workoutUrl);
  await expect(runner(page)).toHaveAttribute("data-current-exercise", "bodyweight_squat");

  // 4. A camera-tracked squat set, with consent. Watch every request the page makes.
  const origin = new URL(page.url()).origin;
  let cameraRunning = false;
  const duringCamera: string[] = [];
  const offOrigin: string[] = [];
  const bodies: { type: string; body: string }[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== origin) offOrigin.push(`${r.method()} ${r.url()}`);
    if (r.method() !== "GET") {
      if (cameraRunning) duringCamera.push(`${r.method()} ${r.url()}`);
      bodies.push({ type: r.headers()["content-type"] ?? "", body: r.postData() ?? "" });
    }
  });

  await expect(page.getByTestId("tracking-consent")).toBeVisible();
  await page.getByRole("button", { name: "Save my tracking data" }).click();
  cameraRunning = true;
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(coach(page)).toHaveAttribute("data-session", "running", { timeout: 60_000 });

  const samples: { status: string; issue: string; reps: number }[] = [];
  const latency: number[] = [];
  await expect
    .poll(
      async () => {
        const s = {
          status: (await status(page).getAttribute("data-status")) ?? "",
          issue: (await status(page).getAttribute("data-issue")) ?? "",
          reps: Number(await reps(page).textContent()),
        };
        samples.push(s);
        const l = await coach(page).evaluate((el) => el.dataset.latencyMs);
        if (l) latency.push(Number(l));
        return s.reps;
      },
      { timeout: 120_000, intervals: [250] },
    )
    .toBe(SHALLOW_FEED_REPS);

  // The empty-room loop: tracking reported unreliable and the count held still.
  const hidden = samples.filter((s) => s.issue === "no_person" && s.reps > 0);
  expect(hidden.length, JSON.stringify(samples)).toBeGreaterThan(5);
  expect(new Set(hidden.map((s) => s.reps)).size).toBe(1);

  await page.getByRole("button", { name: "Stop camera" }).click();
  cameraRunning = false;
  await expect(page.getByTestId("final-reps")).toHaveText(`${SHALLOW_FEED_REPS} reps counted.`);
  expect(await page.locator("video").evaluate((v: HTMLVideoElement) => v.srcObject)).toBeNull();
  expect(duringCamera, "no non-GET request while the camera ran").toEqual([]);
  expect(offOrigin, "nothing to another origin").toEqual([]);
  const sorted = [...latency].sort((a, b) => a - b);
  console.log(
    `journey: ${SHALLOW_FEED_REPS} reps counted; pipeline latency median ${sorted[Math.floor(sorted.length / 2)]} ms (n=${latency.length})`,
  );

  const save = runner(page).getByTestId("save-tracked-set");
  await expect(save.getByRole("heading")).toContainText(`${SHALLOW_FEED_REPS} reps counted`);
  await save.getByLabel("How hard was it? (optional)").selectOption("5");
  await save.getByRole("button", { name: "Save set", exact: true }).click();
  await expect(
    runner(page).locator('[data-testid="runner-exercise"][data-exercise-id="bodyweight_squat"]'),
  ).not.toHaveAttribute("data-state", "todo");

  // 5. The rest of the workout: skip the next exercise with a reason, log every set of the others.
  const r = runner(page);
  let skipped: string | null = null;
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
    const byCamera = r.getByRole("button", { name: "Log this set by hand instead" });
    if (id === "bodyweight_squat") {
      // further squat sets (if the plan has them) are logged by hand
      if (await byCamera.isVisible()) await byCamera.click();
      await r.getByRole("button", { name: "Save set", exact: true }).click();
    } else if (skipped === null) {
      await r.getByLabel("Why skip it? (optional)").selectOption("no_time");
      await r.getByRole("button", { name: "Skip exercise" }).click();
      skipped = id;
    } else {
      if (await byCamera.isVisible()) await byCamera.click();
      await r.getByRole("button", { name: "Save set", exact: true }).click();
      logged[id] = (logged[id] ?? 0) + 1;
    }
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
  expect(skipped).not.toBeNull();
  expect(Object.keys(logged).length).toBeGreaterThan(0);

  // 6. Complete, reload, and read the saved summary.
  await expect(r.getByTestId("finish-panel")).toBeVisible();
  await r.getByRole("button", { name: "Complete workout" }).click();
  await expect(page).toHaveURL(/\/app\/workouts\/[0-9a-f-]{36}\/summary$/);
  const summaryUrl = page.url();
  await page.reload();
  await expect(page.getByTestId("session-summary")).toBeVisible();

  const squat = page.locator(
    '[data-testid="summary-exercise"][data-exercise-id="bodyweight_squat"]',
  );
  await expect(squat).toHaveAttribute("data-tracked", "true");
  const trackedSet = squat.locator('[data-testid="summary-set"][data-source="tracked"]');
  await expect(trackedSet).toHaveCount(1);
  await expect(trackedSet).toContainText(`${SHALLOW_FEED_REPS} reps`);
  await expect(trackedSet).toContainText("felt 5 out of 10");
  const cues = squat.getByTestId("summary-cue");
  expect(await cues.count()).toBeGreaterThan(0);
  for (const cue of await cues.all()) {
    await expect(cue).toHaveAttribute("data-rule-id", "squat.depth.shallow");
    await expect(cue).toContainText("Smallest knee angle in the rep");
    await expect(cue).toContainText("Rule squat.depth.shallow, version");
  }
  const spans = squat.getByTestId("summary-tracking").locator("li");
  expect(await spans.count()).toBeGreaterThan(0);
  await expect(spans.first()).toHaveAttribute("data-reason", "no_person");

  const skippedSection = page.locator(
    `[data-testid="summary-exercise"][data-exercise-id="${skipped}"]`,
  );
  await expect(skippedSection).toHaveAttribute("data-status", "skipped");
  await expect(skippedSection).toContainText("short on time");
  for (const [id, n] of Object.entries(logged)) {
    const section = page.locator(`[data-testid="summary-exercise"][data-exercise-id="${id}"]`);
    await expect(section).toHaveAttribute("data-tracked", "false");
    await expect(section.getByTestId("summary-set")).toHaveCount(n);
    await expect(section.getByTestId("summary-set").first()).toHaveAttribute(
      "data-source",
      "manual",
    );
  }

  // Everything uploaded was derived data: no frames, no landmarks.
  expect(bodies.length).toBeGreaterThan(0);
  for (const req of bodies) {
    expect(req.type).not.toMatch(/^(image|video)\//);
    expect(req.body).not.toMatch(/data:image|landmarks|"visibility"|"x"\s*:|"y"\s*:|"z"\s*:/);
  }

  // 7. A second member, in a separate browser context, finds neither the session nor the plan.
  const other = await browser.newContext();
  try {
    const b = await other.newPage();
    await signUp(b);
    for (const url of [summaryUrl, workoutUrl, planHref!]) {
      // The API answers 404; the page renders Next's not-found view (streamed, so the HTTP
      // status of the document itself is already 200 by then).
      await b.goto(url);
      await expect(b.getByText(NOT_FOUND)).toBeVisible();
    }
    await expect(b.getByTestId("session-summary")).toHaveCount(0);
    await expect(b.getByTestId("plan-view")).toHaveCount(0);
  } finally {
    await other.close();
  }

  // The owner still sees it.
  await page.goto(summaryUrl);
  await expect(page.getByTestId("session-summary")).toBeVisible();
});
