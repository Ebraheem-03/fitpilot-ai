// M1 S7 — exit condition: "the user can open, play, pause, replay, and understand the squat
// demonstration" (FR-03). Runs against real WebGL (headless Chromium / SwiftShader).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

const SQUAT = "/app/exercises/bodyweight_squat";
const GLB = "**/exercises/bodyweight_squat/squat.glb";

// Next 16 keeps previously visited routes mounted but hidden, so scope everything to visible.
const viewer = (page: Page) => page.getByTestId("exercise-viewer").filter({ visible: true });
const phaseLabel = (page: Page) => page.getByTestId("viewer-phase").filter({ visible: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true }).filter({ visible: true });
const fallback = (page: Page) => page.getByTestId("viewer-fallback").filter({ visible: true });
const shownTime = async (page: Page) =>
  Number(/· ([\d.]+) \//.exec((await phaseLabel(page).textContent()) ?? "")?.[1]);

test.beforeEach(async ({ page }) => {
  // Deterministic start: no autoplay (the viewer honours reduced motion).
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("EXIT: open the squat, play, pause, replay, reset and follow the steps", async ({ page }) => {
  await signUp(page);
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Exercises" })
    .click();
  await expect(page).toHaveURL(/\/app\/exercises$/);
  await page.getByRole("link", { name: /Bodyweight Squat/ }).click();
  await expect(page).toHaveURL(new RegExp(`${SQUAT}$`));

  await expect(page.getByRole("heading", { level: 1, name: "Bodyweight Squat" })).toBeVisible();
  await expect(viewer(page)).toHaveAttribute("data-status", "ready");
  await expect(viewer(page).locator("canvas")).toBeVisible();
  await expect(page.getByText("Push through your whole foot to stand back up.")).toBeVisible();

  // The avatar really moves: the frame at the bottom differs from the standing frame.
  const slider = page.getByRole("slider", { name: "Position in demonstration" });
  const standing = await viewer(page).screenshot();
  await slider.fill("2.2");
  await expect(phaseLabel(page)).toHaveText("Bottom · 2.2 / 4.0 s");
  await expect(page.locator('li[aria-current="step"]', { hasText: "Bottom" })).toBeVisible();
  await expect
    .poll(async () => (await viewer(page).screenshot()).equals(standing), { timeout: 5000 })
    .toBe(false);

  // Reset → paused at the start.
  await button(page, "Reset").click();
  await expect(viewer(page)).toHaveAttribute("data-status", "paused");
  await expect(phaseLabel(page)).toHaveText("Standing · 0.0 / 4.0 s");

  // Play → the phase advances with clip time.
  await button(page, "Play").click();
  await expect(viewer(page)).toHaveAttribute("data-status", "playing");
  await expect(phaseLabel(page)).toContainText("Descending", { timeout: 5000 });

  // Pause → time holds.
  await button(page, "Pause").click();
  await expect(viewer(page)).toHaveAttribute("data-status", "paused");
  const pausedAt = await shownTime(page);
  await page.waitForTimeout(600);
  expect(await shownTime(page)).toBe(pausedAt);

  // Play to the end, then Replay → plays again from the start.
  await button(page, "Play").click();
  await expect(viewer(page)).toHaveAttribute("data-status", "ended", { timeout: 8000 });
  await expect(phaseLabel(page)).toHaveText("Standing · 4.0 / 4.0 s");
  await button(page, "Replay").click();
  await expect(viewer(page)).toHaveAttribute("data-status", "playing");
  expect(await shownTime(page)).toBeLessThan(3);
});

test("the page stays usable while the 3D model is still loading", async ({ page }) => {
  await signUp(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(GLB, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(SQUAT);
  await expect(viewer(page)).toHaveAttribute("data-status", "loading");
  await expect(page.getByText("Loading 3D demonstration…")).toBeVisible();
  await expect(
    page.getByText("Sit the hips back and down while keeping your chest up."),
  ).toBeVisible();
  await page.getByRole("link", { name: "← Exercise library" }).click();
  await expect(page).toHaveURL(/\/app\/exercises$/);
  release();
});

test("a missing model shows a fallback with the steps, and retry recovers", async ({ page }) => {
  await signUp(page);
  await page.route(GLB, (route) => route.fulfill({ status: 404 }));
  await page.goto(SQUAT);
  await expect(viewer(page)).toHaveAttribute("data-status", "error");
  await expect(fallback(page)).toContainText("The 3D demonstration couldn't be loaded.");
  await expect(page.getByText("Lower until your thighs are about parallel")).toBeVisible();
  await expect(button(page, "Play")).toBeDisabled();

  await page.unroute(GLB);
  await button(page, "Try again").click();
  await expect(viewer(page)).toHaveAttribute("data-status", "ready");
});

test("a damaged model is reported without crashing the page", async ({ page }) => {
  await signUp(page);
  await page.route(GLB, (route) =>
    route.fulfill({ status: 200, contentType: "model/gltf-binary", body: "not a glb" }),
  );
  await page.goto(SQUAT);
  await expect(fallback(page)).toContainText("The 3D demonstration file is damaged.");
  await expect(page.getByRole("heading", { level: 1, name: "Bodyweight Squat" })).toBeVisible();
});

test("the demonstration can be driven from the keyboard alone", async ({ page }) => {
  await signUp(page);
  await page.goto(SQUAT);
  await expect(viewer(page)).toHaveAttribute("data-status", "ready");
  await viewer(page).focus();
  await page.keyboard.press("Space");
  await expect(viewer(page)).toHaveAttribute("data-status", "playing");
  await page.keyboard.press("Home");
  await expect(viewer(page)).toHaveAttribute("data-status", "paused");
  await page.keyboard.press("ArrowRight");
  await expect(phaseLabel(page)).toHaveText("Descending · 0.5 / 4.0 s");
  // Tab reaches the controls in order.
  await page.keyboard.press("Tab");
  await expect(button(page, "Play")).toBeFocused();
});

// notFound() runs inside <Suspense> after streaming starts, so the HTTP status is already 200;
// assert the rendered not-found state (same as the M0 staff-page test). The API returns 404.
test("an exercise outside the catalogue is not found", async ({ page }) => {
  await signUp(page);
  await page.goto("/app/exercises/made_up_move");
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});

test("exercise pages have no serious accessibility violations", async ({ page }) => {
  await signUp(page);
  for (const path of ["/app/exercises", SQUAT]) {
    await page.goto(path);
    await expect(page.locator("main#content h1")).toBeVisible();
    if (path === SQUAT) await expect(viewer(page)).toHaveAttribute("data-status", "ready");
    const { violations } = await new AxeBuilder({ page }).include("body").analyze();
    const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, `${path}: ${serious.map((v) => v.id).join(", ")}`).toEqual([]);
  }
});

test("on a phone-sized screen the viewer fits without horizontal scrolling", async ({ page }) => {
  await signUp(page);
  await page.goto(SQUAT);
  await expect(viewer(page)).toHaveAttribute("data-status", "ready");
  // Start wide, then shrink: the canvas must not hold the layout at its old width.
  await page.setViewportSize({ width: 375, height: 740 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
  await expect(button(page, "Play")).toBeInViewport({ ratio: 0 });
});
