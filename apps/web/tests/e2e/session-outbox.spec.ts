// FR-07 / ADR-0011: session events wait in an on-device outbox and reach the API exactly once,
// whatever the network does. Everything here goes through the real UI: a plan, a started workout,
// the workout runner and the live page. The camera-while-recording rules are also covered in
// live-coaching.spec.ts.
import { expect, test, type Page, type Request } from "@playwright/test";
import { signUp, startWorkout } from "./helpers";

const runner = (page: Page) => page.getByTestId("workout-runner").filter({ visible: true });
const pending = (page: Page) => page.getByTestId("save-status").filter({ visible: true });

// Server actions are POSTs to the page URL; event uploads are the ones carrying idempotency keys.
const isEventUpload = (r: Request) =>
  r.method() === "POST" && !!r.postData()?.includes("idempotency_key");

/**
 * Event uploads the server answered with 200. Counted by response, not `requestfinished`: Next
 * aborts the action fetch after reading the reply, so Playwright reports it as failed.
 */
function trackUploads(page: Page): string[] {
  const answered: string[] = [];
  page.on("response", (res) => {
    if (res.status() === 200 && isEventUpload(res.request())) answered.push(res.url());
  });
  return answered;
}

/** The first exercise of Monday is the squat: log its first set by hand, with the plan's target. */
async function logFirstSetByHand(page: Page): Promise<string> {
  const r = runner(page);
  await r.getByRole("button", { name: "Log this set by hand instead" }).click();
  const reps = await r.getByLabel("Reps completed").inputValue();
  await r.getByRole("button", { name: "Save set", exact: true }).click();
  return reps;
}

test("a set finished with no network is sent once after the page is reloaded and the network is back", async ({
  page,
}) => {
  test.setTimeout(90_000); // plan generation + onboarding come first, and CI is slow
  await signUp(page);
  await startWorkout(page);
  const finished = trackUploads(page);

  // The network drops: event uploads fail at the transport, like a dead connection.
  await page.route("**/*", (route) =>
    isEventUpload(route.request()) ? route.abort("internetdisconnected") : route.continue(),
  );
  const reps = await logFirstSetByHand(page);
  await expect(pending(page)).toHaveAttribute("data-pending", "1", { timeout: 10_000 });
  expect(finished).toEqual([]);

  // Back online, then the member reloads: the app load flushes what the last visit left behind.
  await page.unroute("**/*");
  await page.reload();
  await expect.poll(() => finished.length).toBe(1);
  await expect(pending(page)).toHaveAttribute("data-pending", "0");

  await runner(page).getByRole("button", { name: "Finish workout" }).click();
  await runner(page).getByRole("button", { name: "Complete workout" }).click();
  await expect(page).toHaveURL(/\/summary$/);
  const squat = page.locator(
    '[data-testid="summary-exercise"][data-exercise-id="bodyweight_squat"]',
  );
  await expect(squat.getByTestId("summary-set")).toHaveCount(1);
  await expect(squat.getByTestId("summary-set")).toContainText(`${reps} reps`);
  expect(finished).toHaveLength(1); // stored once, not re-sent by the retry timer or the reload
});

const outboxDatabases = (page: Page) =>
  page.evaluate(async () =>
    (await indexedDB.databases())
      .map((d) => d.name ?? "")
      .filter((n) => n.startsWith("fitpilot-outbox-")),
  );

test("signing out with an unsent set asks; discarding leaves no workout data on the device", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signUp(page);
  await startWorkout(page);

  await page.route("**/*", (route) =>
    isEventUpload(route.request()) ? route.abort("internetdisconnected") : route.continue(),
  );
  await logFirstSetByHand(page);
  await expect(pending(page)).toHaveAttribute("data-pending", "1", { timeout: 10_000 });
  expect(await outboxDatabases(page)).toHaveLength(1);

  await page.getByRole("button", { name: "Sign out" }).click();
  const choice = page.getByRole("alertdialog");
  await expect(choice).toContainText("1 workout item hasn't been sent yet");
  await choice.getByRole("button", { name: "Discard" }).click();

  await expect(page).toHaveURL(/\/sign-in$/);
  expect(await outboxDatabases(page)).toEqual([]);
});

test("going offline mid-workout, then reconnecting, saves the set once; completing waits for it", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000); // plan generation + onboarding come first, and CI is slow
  await signUp(page);
  await startWorkout(page);
  const finished = trackUploads(page);

  // Go offline only once the runner has hydrated: the page loads its script lazily in dev, and a
  // page cut off mid-load never becomes interactive (that is a different failure than the one tested).
  await expect(runner(page).getByTestId("camera-set")).toBeVisible();
  await context.setOffline(true);
  const reps = await logFirstSetByHand(page);
  await expect(pending(page)).toHaveAttribute("data-pending", "1", { timeout: 10_000 });
  expect(finished).toEqual([]);

  // Completing now would drop the unsent set (events after completion are refused): it waits.
  await runner(page).getByRole("button", { name: "Finish workout" }).click();
  await runner(page).getByRole("button", { name: "Complete workout" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "haven't been sent yet" })).toBeVisible();
  await expect(page).not.toHaveURL(/\/summary$/);

  await context.setOffline(false); // the browser's `online` event triggers the flush
  await expect.poll(() => finished.length, { timeout: 15_000 }).toBe(1);
  await expect(pending(page)).toHaveAttribute("data-pending", "0");
  await runner(page).getByRole("button", { name: "Complete workout" }).click();
  await expect(page).toHaveURL(/\/summary$/);
  const squat = page.locator(
    '[data-testid="summary-exercise"][data-exercise-id="bodyweight_squat"]',
  );
  await expect(squat.getByTestId("summary-set")).toContainText(`${reps} reps`);
  expect(finished).toHaveLength(1);
});

test("consent: asked once before the first saved set, shown on the profile, and withdrawable", async ({
  page,
}) => {
  await signUp(page);
  const id = await startWorkout(page);
  await page.goto("/app/profile");
  await expect(page.getByTestId("tracking-consent-setting")).toContainText("Off.");

  await page.goto(`/app/exercises/bodyweight_squat/live?session=${id}`);
  const step = page.getByTestId("tracking-consent");
  await expect(step).toContainText(
    "We'll save your rep counts, rep timing, tracking quality and the measurements behind each cue to your account — never video or body points.",
  );
  await expect(page.getByRole("button", { name: "Start camera" })).toBeDisabled();
  await page.getByRole("button", { name: "Save my tracking data" }).click();
  await expect(step).toBeHidden();
  await expect(page.getByRole("button", { name: "Start camera" })).toBeEnabled();

  // Already on record: a reload doesn't ask again.
  await page.reload();
  await expect(page.getByRole("button", { name: "Start camera" })).toBeEnabled();
  await expect(page.getByTestId("tracking-consent")).toHaveCount(0);

  await page.goto("/app/profile");
  const setting = page.getByTestId("tracking-consent-setting");
  await expect(setting).toContainText("On.");
  await setting.getByRole("button", { name: "Withdraw" }).click();
  await expect(setting).toContainText("Off.");
  await expect(setting.getByRole("button", { name: "Withdraw" })).toHaveCount(0);
});

test("a tracked set with a session sends nothing while the camera runs, then saves once on stop", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signUp(page);
  const id = await startWorkout(page);
  await page.goto(`/app/exercises/bodyweight_squat/live?session=${id}`);
  await page.getByRole("button", { name: "Save my tracking data" }).click();
  await expect(page.getByTestId("tracking-consent")).toBeHidden();

  // Every non-GET request (any type, any origin) with the time it started. The camera window is
  // judged by the page's own state, not by when this test got round to flipping a flag: the
  // upload goes out the moment the camera stops, before a Playwright click has even returned.
  const origin = new URL(page.url()).origin;
  const nonGet: { at: number; what: string; body: string; offOrigin: boolean }[] = [];
  page.on("request", (r) => {
    if (r.method() === "GET") return;
    nonGet.push({
      at: Date.now(),
      what: `${r.method()} ${r.url()}`,
      body: r.postData() ?? "",
      offOrigin: new URL(r.url()).origin !== origin,
    });
  });
  const saved = trackUploads(page);
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-testid=live-coach]")!;
    new MutationObserver(() => {
      const w = window as { __stoppedAt?: number };
      if (el.dataset.session === "stopped") w.__stoppedAt ??= Date.now();
    }).observe(el, { attributes: true, attributeFilter: ["data-session"] });
  });

  await page.getByRole("button", { name: "Start camera" }).click();
  const coach = page.getByTestId("live-coach").filter({ visible: true });
  await expect(coach).toHaveAttribute("data-session", "running", { timeout: 60_000 });
  await expect(page.getByTestId("tracking-status").filter({ visible: true })).toHaveAttribute(
    "data-issue",
    "no_person",
  );
  expect(nonGet.map((r) => r.what)).toEqual([]);
  expect(saved).toEqual([]);

  await page.getByRole("button", { name: "Stop camera" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as { __stoppedAt?: number }).__stoppedAt ?? 0))
    .toBeGreaterThan(0);
  const stoppedAt = await page.evaluate(() => (window as { __stoppedAt?: number }).__stoppedAt!);

  // The set reaches the server after the camera stopped. It can go in more than one batch (the
  // outbox flushes when the camera is released and again when the set closes), so look at all
  // event uploads together.
  const uploads = () => nonGet.filter((r) => r.body.includes("idempotency_key"));
  await expect
    .poll(() =>
      uploads()
        .map((u) => u.body)
        .join("\n"),
    )
    .toContain("set_completed");
  await expect.poll(() => saved.length).toBeGreaterThanOrEqual(1);

  expect(nonGet.filter((r) => r.at < stoppedAt).map((r) => r.what)).toEqual([]); // silent while on
  expect(nonGet.filter((r) => r.offOrigin).map((r) => r.what)).toEqual([]);
  for (const u of uploads()) expect(u.body).not.toMatch(/landmarks|"visibility"|data:image/);
  // Each event was sent once.
  const keys = uploads().flatMap((u) =>
    [...u.body.matchAll(/idempotency_key\\?"\s*:\s*\\?"([^"\\]+)/g)].map((m) => m[1]!),
  );
  expect(keys.length).toBeGreaterThan(0);
  expect(new Set(keys).size).toBe(keys.length);
});

test("stop then Start again at once: the camera waits for the slow upload, so nothing is on the wire while it runs", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signUp(page);
  const id = await startWorkout(page);
  await page.goto(`/app/exercises/bodyweight_squat/live?session=${id}`);
  await page.getByRole("button", { name: "Save my tracking data" }).click();
  await expect(page.getByTestId("tracking-consent")).toBeHidden();

  // A slow API: every event upload takes 2 s to be answered.
  await page.route("**/*", async (route) => {
    if (!isEventUpload(route.request())) return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  // M2-EXIT style: ANY non-GET request (any type, any origin) is recorded with its time, so the
  // second camera window can be checked for silence, not just event uploads.
  const nonGet: { at: number; what: string }[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") nonGet.push({ at: Date.now(), what: `${r.method()} ${r.url()}` });
  });
  const uploads: { startedAt: number; answeredAt: number | null }[] = [];
  page.on("request", (r) => {
    if (isEventUpload(r)) uploads.push({ startedAt: Date.now(), answeredAt: null });
  });
  page.on("response", (res) => {
    if (isEventUpload(res.request())) uploads.at(-1)!.answeredAt = Date.now();
  });
  // The page records when the camera session leaves "stopped" the second time.
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-testid=live-coach]")!;
    let stopped = false;
    new MutationObserver(() => {
      const s = el.dataset.session;
      if (s === "stopped") stopped = true;
      else if (stopped && !(window as { __restartAt?: number }).__restartAt) {
        (window as { __restartAt?: number }).__restartAt = Date.now();
      }
    }).observe(el, { attributes: true, attributeFilter: ["data-session"] });
  });

  const coach = page.getByTestId("live-coach").filter({ visible: true });
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(coach).toHaveAttribute("data-session", "running", { timeout: 60_000 });
  await page.getByRole("button", { name: "Stop camera" }).click();
  await page.getByRole("button", { name: "Start again" }).click(); // straight away
  await expect(coach).toHaveAttribute("data-session", "running", { timeout: 60_000 });

  const restartAt = await page.evaluate(() => (window as { __restartAt?: number }).__restartAt!);
  expect(uploads).toHaveLength(1); // the first set's upload, started when the camera stopped
  expect(uploads[0]!.startedAt).toBeLessThan(restartAt);
  expect(uploads[0]!.answeredAt).not.toBeNull();
  expect(uploads[0]!.answeredAt!).toBeLessThanOrEqual(restartAt); // answered before the camera came back
  const secondWindowEnd = Date.now();
  await page.getByRole("button", { name: "Stop camera" }).click();
  // The second camera window ran from the restart to this stop: nothing but GETs in it.
  const during = nonGet.filter((r) => r.at >= restartAt && r.at <= secondWindowEnd);
  expect(during, JSON.stringify(during)).toEqual([]);
  await expect.poll(() => uploads.length).toBe(2);
});

test("declining keeps tracking available without saving, and practice mode never asks", async ({
  page,
}) => {
  await signUp(page);
  const id = await startWorkout(page);

  await page.goto("/app/exercises/bodyweight_squat/live");
  await expect(page.getByTestId("tracking-consent")).toHaveCount(0); // practice mode

  await page.goto(`/app/exercises/bodyweight_squat/live?session=${id}`);
  await page.getByRole("button", { name: /Don't save/ }).click();
  await expect(page.getByRole("button", { name: "Start camera" })).toBeEnabled();
  await page.goto("/app/profile");
  await expect(page.getByTestId("tracking-consent-setting")).toContainText("Off.");
});

test("someone else's session id is a 404 on the live page, not practice mode", async ({
  page,
  browser,
}) => {
  await signUp(page);
  const id = await startWorkout(page);

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signUp(otherPage);
  const res = await otherPage.goto(`/app/exercises/bodyweight_squat/live?session=${id}`);
  await expect(otherPage.getByRole("button", { name: "Start camera" })).toHaveCount(0);
  expect(res?.status()).toBeLessThan(500);
  await expect(otherPage.getByText(/could not be found|404/i).first()).toBeVisible();
  await other.close();
});
