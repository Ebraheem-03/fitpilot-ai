// FR-07 / ADR-0011: session events wait in an on-device outbox and reach the API exactly once,
// whatever the network does. The dev harness (/dev/outbox) drives the real outbox and server
// actions without a camera; the camera-while-recording rules are covered in live-coaching.spec.ts.
import { expect, test, type Page, type Request } from "@playwright/test";
import { completeOnboarding, signUp } from "./helpers";

const HARNESS = "/dev/outbox";
const pending = (page: Page) => page.getByTestId("harness-pending");

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

async function startHarnessSession(page: Page): Promise<string> {
  await page.goto(HARNESS);
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/dev\/outbox\?session=[0-9a-f-]{36}$/);
  return new URL(page.url()).searchParams.get("session")!;
}

test("a set finished with no network is sent once after the page is reloaded and the network is back", async ({
  page,
}) => {
  await signUp(page);
  await startHarnessSession(page);

  const finished = trackUploads(page);

  // The network drops: event uploads fail at the transport, like a dead connection.
  await page.route("**/*", (route) =>
    isEventUpload(route.request()) ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.getByRole("button", { name: "Log a 10-rep set by hand" }).click();
  await expect(pending(page)).toHaveText("1 queued");
  await page.getByRole("button", { name: "Send now" }).click();
  await expect(page.getByTestId("harness-message")).toHaveText("retry_scheduled");
  await expect(pending(page)).toHaveText("1 queued");
  expect(finished).toEqual([]);

  // Back online, then the member reloads: the app load flushes what the last visit left behind.
  await page.unroute("**/*");
  await page.reload();
  await expect.poll(() => finished.length).toBe(1);

  await page.getByRole("button", { name: "Complete workout" }).click();
  await expect(page.getByTestId("harness-summary")).toHaveText("1 sets, 10 reps");
  expect(finished).toHaveLength(1); // stored once, not re-sent by the retry timer or reload
  await expect(pending(page)).toHaveText("0 queued");
});

test("going offline mid-workout, then reconnecting, saves the set once", async ({
  page,
  context,
}) => {
  await signUp(page);
  await startHarnessSession(page);
  const finished = trackUploads(page);

  await context.setOffline(true);
  await page.getByRole("button", { name: "Log a 10-rep set by hand" }).click();
  await page.getByRole("button", { name: "Send now" }).click();
  await expect(page.getByTestId("harness-message")).toHaveText("retry_scheduled");
  await expect(pending(page)).toHaveText("1 queued");
  expect(finished).toEqual([]);

  await context.setOffline(false); // the browser's `online` event triggers the flush
  await expect.poll(() => finished.length, { timeout: 15_000 }).toBe(1);
  await page.getByRole("button", { name: "Complete workout" }).click();
  await expect(page.getByTestId("harness-summary")).toHaveText("1 sets, 10 reps");
  expect(finished).toHaveLength(1);
});

test("consent: asked once before the first saved set, shown on the profile, and withdrawable", async ({
  page,
}) => {
  await signUp(page);
  await completeOnboarding(page);
  await expect(page.getByTestId("tracking-consent-setting")).toContainText("Off.");

  const id = await startHarnessSession(page);
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
  await completeOnboarding(page);
  const id = await startHarnessSession(page);
  await page.goto(`/app/exercises/bodyweight_squat/live?session=${id}`);
  await page.getByRole("button", { name: "Save my tracking data" }).click();
  await expect(page.getByTestId("tracking-consent")).toBeHidden();

  const origin = new URL(page.url()).origin;
  let cameraRunning = false;
  const during: string[] = [];
  const bodies: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "GET") return;
    if (cameraRunning || new URL(r.url()).origin !== origin)
      during.push(`${r.method()} ${r.url()}`);
    else bodies.push(r.postData() ?? "");
  });
  const saved = trackUploads(page);

  cameraRunning = true;
  await page.getByRole("button", { name: "Start camera" }).click();
  const coach = page.getByTestId("live-coach").filter({ visible: true });
  await expect(coach).toHaveAttribute("data-session", "running", { timeout: 60_000 });
  await expect(page.getByTestId("tracking-status").filter({ visible: true })).toHaveAttribute(
    "data-issue",
    "no_person",
  );
  expect(during).toEqual([]);
  expect(saved).toEqual([]);

  await page.getByRole("button", { name: "Stop camera" }).click();
  cameraRunning = false;
  await expect.poll(() => saved.length).toBe(1);
  const upload = bodies.find((b) => b.includes("idempotency_key"))!;
  expect(upload).toContain("set_completed");
  expect(upload).not.toMatch(/landmarks|"visibility"|data:image/);
  expect(during).toEqual([]);
});

test("declining keeps tracking available without saving, and practice mode never asks", async ({
  page,
}) => {
  await signUp(page);
  await completeOnboarding(page);
  const id = await startHarnessSession(page);

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
  const id = await startHarnessSession(page);

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signUp(otherPage);
  const res = await otherPage.goto(`/app/exercises/bodyweight_squat/live?session=${id}`);
  await expect(otherPage.getByRole("button", { name: "Start camera" })).toHaveCount(0);
  expect(res?.status()).toBeLessThan(500);
  await expect(otherPage.getByText(/could not be found|404/i).first()).toBeVisible();
  await other.close();
});
