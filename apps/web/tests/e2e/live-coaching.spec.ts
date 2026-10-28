// M2 exit (blueprint §11): "a member can perform a supported squat while the application tracks
// and counts repetitions, with explicit handling of unreliable tracking." The real pose model runs
// in the real worker on Chrome's fake camera, which plays the generated mannequin squatting
// (fake-camera.setup.ts; ADR-0010 §8): no real person, known ground truth.
import { expect, test, type Page } from "@playwright/test";
import { FEED_REPS } from "./fake-camera";
import { signUp } from "./helpers";

const coach = (page: Page) => page.getByTestId("live-coach").filter({ visible: true });
const status = (page: Page) => page.getByTestId("tracking-status").filter({ visible: true });
const reps = (page: Page) => page.getByTestId("rep-count").filter({ visible: true });

test("EXIT: the mannequin's squats are counted, and the count pauses while nobody is visible", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signUp(page);
  await page.goto("/app/exercises/bodyweight_squat");
  await page.getByRole("link", { name: "Track your reps with the camera" }).click();
  await expect(page).toHaveURL(/\/app\/exercises\/bodyweight_squat\/live$/);

  // Nothing leaves the device: record every non-GET request from here on.
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });

  await expect(page.getByText(/processed on this device only/)).toBeVisible();
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(coach(page)).toHaveAttribute("data-session", "running", { timeout: 60_000 });

  // Sample what the member sees until the feed's reps are done.
  const samples: { status: string; issue: string; reps: number }[] = [];
  const latency: number[] = [];
  const fps: number[] = [];
  await expect
    .poll(
      async () => {
        const s = {
          status: (await status(page).getAttribute("data-status")) ?? "",
          issue: (await status(page).getAttribute("data-issue")) ?? "",
          reps: Number(await reps(page).textContent()),
        };
        samples.push(s);
        const [l, f] = await coach(page).evaluate((el) => [el.dataset.latencyMs, el.dataset.fps]);
        if (l) latency.push(Number(l));
        if (f) fps.push(Number(f));
        return s.reps;
      },
      { timeout: 90_000, intervals: [250] },
    )
    .toBe(FEED_REPS);

  // The hidden loop was reported as "nobody in view", with the count explicitly paused…
  const hidden = samples.filter((s) => s.issue === "no_person" && s.reps > 0);
  expect(hidden.length, JSON.stringify(samples)).toBeGreaterThan(5);
  expect(new Set(hidden.map((s) => s.reps)).size).toBe(1);
  // …and reps only ever went up while tracking was reliable on one side of the change.
  for (let i = 1; i < samples.length; i++) {
    const [a, b] = [samples[i - 1]!, samples[i]!];
    expect(b.reps).toBeGreaterThanOrEqual(a.reps);
    if (b.reps > a.reps) expect([a.status, b.status]).toContain("tracking");
  }

  // NFR feedback latency: camera frame → analysed result on screen, median ≤ 250 ms.
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  console.log(
    `live pipeline: latency median ${median(latency)} ms (n=${latency.length}), fps median ${median(fps)}`,
  );
  expect(median(latency)).toBeLessThanOrEqual(250);

  await page.getByRole("button", { name: "Stop camera" }).click();
  await expect(page.getByTestId("final-reps")).toHaveText(`${FEED_REPS} reps counted.`);
  expect(await page.locator("video").evaluate((v: HTMLVideoElement) => v.srcObject)).toBeNull();
  expect(sent).toEqual([]);
});
