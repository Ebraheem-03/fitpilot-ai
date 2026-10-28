// FR-04 failure and edge states with the real model in the worker. Chrome's default fake camera
// shows a test pattern, not a person: the app must say so and count nothing (principle 3).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

const LIVE = "/app/exercises/bodyweight_squat/live";
const coach = (page: Page) => page.getByTestId("live-coach").filter({ visible: true });
const status = (page: Page) => page.getByTestId("tracking-status").filter({ visible: true });

test("no person in view: says so, counts nothing, and stop turns the camera off", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signUp(page);
  await page.goto(LIVE);
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(coach(page)).toHaveAttribute("data-session", "running", { timeout: 60_000 });
  await expect(status(page)).toHaveAttribute("data-issue", "no_person");
  await expect(page.getByText("Step into view")).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(page.getByTestId("rep-count").filter({ visible: true })).toHaveText("0");
  await expect(page.getByTestId("rep-state").filter({ visible: true })).toHaveText(
    "Reps paused — tracking not reliable",
  );

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(coach(page)).toHaveAttribute("data-session", "paused");
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(coach(page)).toHaveAttribute("data-session", "running");
  await page.getByRole("button", { name: "Stop camera" }).click();
  await expect(page.getByText("Camera off.", { exact: true })).toBeVisible();
});

test("blocked camera: explains how to allow it and offers retry and a non-camera path", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  await signUp(page);
  await page.goto(LIVE);
  await page.getByRole("button", { name: "Start camera" }).click();
  // (Next's route announcer is also role=alert)
  const alert = page.getByRole("alert").filter({ hasText: "Camera access was blocked." });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(alert.getByRole("link", { name: /3D demonstration/ })).toBeVisible();
});

test("is accessible and fits a phone, before and during a session", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 800 });
  await signUp(page);
  await page.goto(LIVE);
  await expect(page.getByRole("button", { name: "Start camera" })).toBeVisible();
  const idle = await new AxeBuilder({ page }).include("main").analyze();
  expect(idle.violations).toEqual([]);

  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(coach(page)).toHaveAttribute("data-session", "running", { timeout: 60_000 });
  const running = await new AxeBuilder({ page }).include("main").analyze();
  expect(running.violations).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // keyboard: the session controls are reachable and operable
  await page.getByRole("button", { name: "Pause" }).focus();
  await page.keyboard.press("Enter");
  await expect(coach(page)).toHaveAttribute("data-session", "paused");
});
