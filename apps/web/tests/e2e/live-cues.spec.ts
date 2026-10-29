// FR-06 (M3 S3): live cues + post-set summary with the real pose model in the real worker. Chrome's
// fake camera plays the generated mannequin doing shallow squats (fake-camera.ts:
// SHALLOW_FEED_PLAN), so `squat.depth.shallow` fires from real measurements; no real person.
import { SessionEvent } from "@fitpilot/exercise-contracts";
import { expect, type Page, test } from "@playwright/test";
import { SHALLOW_FEED_REPS } from "./fake-camera";
import { signUp } from "./helpers";

const coach = (page: Page) => page.getByTestId("live-coach").filter({ visible: true });
const reps = (page: Page) => page.getByTestId("rep-count").filter({ visible: true });
const cueCard = (page: Page) => page.getByTestId("active-cue").filter({ visible: true });

interface LogEntry {
  t: number;
  cue: string | null;
  shownAt: string | null;
  status: string | null;
  repState: string;
  latency: string | null;
  frameLatency: string | null;
}

declare global {
  interface Window {
    __cueLog?: LogEntry[];
  }
}

/** Logs every DOM change of the live panel: what cue (if any) was on screen, next to the status. */
async function watchCues(page: Page) {
  await page.evaluate(() => {
    const log: LogEntry[] = [];
    window.__cueLog = log;
    const root = [...document.querySelectorAll<HTMLElement>("[data-testid=live-coach]")].find(
      (el) => el.offsetParent !== null,
    )!;
    const sample = () => {
      const card = root.querySelector<HTMLElement>("[data-testid=active-cue]");
      log.push({
        t: performance.now(),
        cue: card?.dataset.ruleId ?? null,
        shownAt: card?.dataset.shownAtMs ?? null,
        status:
          root.querySelector<HTMLElement>("[data-testid=tracking-status]")?.dataset.status ?? null,
        repState: root.querySelector("[data-testid=rep-state]")?.textContent ?? "",
        latency: card?.dataset.cueLatencyMs ?? null,
        frameLatency: card?.dataset.cueFrameLatencyMs ?? null,
      });
    };
    new MutationObserver(sample).observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "data-status",
        "data-rule-id",
        "data-cue-latency-ms",
        "data-cue-frame-latency-ms",
      ],
    });
  });
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

test("cues: each one shown is recorded with its rule, none while unreliable, ≤ 250 ms, summary after stop", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signUp(page);
  await page.goto("/app/exercises/bodyweight_squat/live");

  // ADR-0011: nothing is sent while the camera runs (practice mode sends nothing at all).
  const origin = new URL(page.url()).origin;
  const sent: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== origin || r.method() !== "GET") {
      sent.push(`${r.method()} ${r.url()}`);
    }
  });

  await expect(page.getByRole("note").filter({ visible: true })).toContainText(
    "not medical advice",
  );
  await watchCues(page);
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(coach(page)).toHaveAttribute("data-session", "running", { timeout: 60_000 });

  // Leave the first cue alone (nobody is in view a second later: it must be withdrawn), answer
  // a later one with "Got it".
  const seen = new Set<string>();
  let acknowledged: string | null = null;
  await expect
    .poll(
      async () => {
        const shownAt = await cueCard(page)
          .getAttribute("data-shown-at-ms", { timeout: 50 })
          .catch(() => null);
        if (shownAt) seen.add(shownAt);
        if (shownAt && seen.size >= 2 && !acknowledged) {
          await cueCard(page)
            .getByRole("button", { name: "Got it" })
            .click({ timeout: 1000 })
            .then(() => (acknowledged = shownAt))
            .catch(() => {}); // it went before the click landed: try the next one
        }
        // the last cue arrives with the last rep: wait for the answer too
        return `${await reps(page).textContent()} reps, ${acknowledged ? "acknowledged" : "not yet"}`;
      },
      { timeout: 120_000, intervals: [100] },
    )
    .toBe(`${SHALLOW_FEED_REPS} reps, acknowledged`);
  const recordedLive = await page.evaluate(() => window.__fitpilotLiveEvents ?? []);
  expect(sent, "no request while the camera runs").toEqual([]);

  await page.getByRole("button", { name: "Stop camera" }).click();
  await expect(page.getByTestId("final-reps")).toHaveText(`${SHALLOW_FEED_REPS} reps counted.`);
  expect(await page.locator("video").evaluate((v: HTMLVideoElement) => v.srcObject)).toBeNull();

  const log = await page.evaluate(() => window.__cueLog ?? []);
  const events = (await page.evaluate(() => window.__fitpilotLiveEvents ?? [])) as SessionEvent[];
  for (const e of events) expect(SessionEvent.safeParse(e).success, JSON.stringify(e)).toBe(true);
  expect(events.slice(0, recordedLive.length)).toEqual(recordedLive);

  // Every cue on screen is a recorded feedback_shown with the same rule, in the same order.
  const displayed = [...new Map(log.filter((l) => l.shownAt).map((l) => [l.shownAt, l])).values()];
  const shown = events.filter((e) => e.type === "feedback_shown");
  expect(displayed.length, JSON.stringify(log.slice(-20))).toBeGreaterThanOrEqual(2);
  expect(displayed.map((d) => d.cue)).toEqual(shown.map((e) => e.rule_id));
  for (const e of shown) {
    expect(e).toMatchObject({ rule_id: "squat.depth.shallow", ruleset_version: 4 });
    expect(e.measurements.min_knee_angle_deg).toBeGreaterThan(120);
    expect(e.measurements.min_knee_angle_deg).toBeLessThanOrEqual(140);
  }

  // Never a cue while the member is told tracking isn't reliable.
  for (const l of log.filter((l) => l.cue)) {
    expect(l.status, JSON.stringify(l)).toBe("tracking");
    expect(l.repState).not.toMatch(/not reliable/);
  }
  // The first cue was withdrawn when the room emptied, well before its 4 s display time.
  const first = displayed[0]!;
  const firstEntries = log.filter((l) => l.shownAt === first.shownAt);
  const gone = log.find((l) => l.t > firstEntries.at(-1)!.t && l.shownAt !== first.shownAt)!;
  expect(gone.t - firstEntries[0]!.t).toBeLessThan(3500);
  expect(log.some((l) => l.t > gone.t && l.status === "searching")).toBe(true);

  // NFR feedback latency: analysis result → cue committed to the DOM, and → the next frame.
  const latency = displayed.map((d) =>
    Number(log.find((l) => l.shownAt === d.shownAt && l.latency)?.latency),
  );
  const frameLatency = displayed
    .map((d) => log.find((l) => l.shownAt === d.shownAt && l.frameLatency)?.frameLatency)
    .filter((x): x is string => x != null)
    .map(Number);
  console.log(
    `live cues: ${displayed.length} shown; analysis→DOM latency median ${median(latency)} ms ${JSON.stringify(latency)}, →next frame median ${median(frameLatency)} ms ${JSON.stringify(frameLatency)}`,
  );
  expect(median(latency)).toBeLessThanOrEqual(250);
  expect(median(frameLatency)).toBeLessThanOrEqual(250);

  // Answers and the set are recorded.
  expect(acknowledged).not.toBeNull();
  expect(events.filter((e) => e.type === "feedback_acknowledged")).toHaveLength(1);
  expect(events.filter((e) => e.type === "rep_completed")).toHaveLength(SHALLOW_FEED_REPS);
  expect(events.at(-1)).toMatchObject({ type: "set_completed", reps: SHALLOW_FEED_REPS });
  expect(events).toContainEqual(
    expect.objectContaining({ type: "tracking_degraded", reason: "no_person" }),
  );
  // Only derived fields: nothing frame- or landmark-shaped (ADR-0011 §1).
  expect(JSON.stringify(events)).not.toMatch(/landmark|"x"|"y"|image|frame/);

  // The post-set summary, from those events.
  const summary = page.getByTestId("set-summary");
  await expect(summary.getByTestId("summary-reps")).toContainText(`${SHALLOW_FEED_REPS} reps`);
  const items = summary.getByTestId("summary-cues").locator(":scope > li");
  await expect(items).toHaveCount(shown.length);
  expect(
    await items.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.ruleId)),
  ).toEqual(shown.map((e) => e.rule_id));
  await expect(summary.locator("li[data-response=acknowledged]")).toHaveCount(1);
  await expect(items.first()).toContainText("Smallest knee angle in the rep");
  await expect(summary.getByTestId("summary-tracking")).toContainText("Nobody in view");

  expect(sent).toEqual([]);
});
