import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export type Credentials = { email: string; password: string };

export function newCredentials(): Credentials {
  return {
    email: `e2e-${randomBytes(6).toString("hex")}@example.com`,
    password: randomBytes(12).toString("base64url"),
  };
}

// Next 16 keeps previously visited routes mounted but hidden (<Activity>), so scope to visible.
export const field = (page: Page, label: string) =>
  page.getByLabel(label).filter({ visible: true });

export async function fillAuthForm(page: Page, { email, password }: Credentials) {
  await field(page, "Email").fill(email);
  await field(page, "Password").fill(password);
}

export async function signUp(page: Page, creds = newCredentials()): Promise<Credentials> {
  await page.goto("/sign-up");
  await fillAuthForm(page, creds);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/);
  return creds;
}

export async function completeOnboarding(page: Page) {
  await page.getByRole("link", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/app\/onboarding$/);
  await field(page, "Main goal").selectOption("strength");
  await page.getByRole("radio", { name: "Intermediate" }).check();
  await field(page, "Days per week").fill("3");
  await field(page, "Minutes per session").fill("45");
  await page.getByRole("checkbox", { name: "Dumbbells" }).check();
  await page.getByRole("checkbox", { name: "Bench" }).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page).toHaveURL(/\/app\/profile$/);
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
}

/** Fill in the onboarding form with a profile the fake planner can build a plan for. */
export async function onboard(page: Page, opts: { days?: string; minutes?: string } = {}) {
  await page.goto("/app/onboarding");
  await field(page, "Main goal").selectOption("strength");
  await page.getByRole("radio", { name: "Intermediate" }).check();
  await field(page, "Days per week").fill(opts.days ?? "3");
  await field(page, "Minutes per session").fill(opts.minutes ?? "45");
  await page.getByRole("checkbox", { name: "Dumbbells" }).check();
  await page.getByRole("checkbox", { name: "Bench" }).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page).toHaveURL(/\/app\/profile$/);
}

/**
 * Through the real UI: onboard, generate a plan (fake planner), start Monday's workout. Returns
 * the session id. Monday is used because it is deterministic whatever day the test runs on.
 */
export async function startWorkout(page: Page): Promise<string> {
  await onboard(page);
  await page.goto("/app/plan");
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await expect(page.getByTestId("plan-version-label")).toHaveText("· version 1");
  await page.getByRole("button", { name: "Start Monday's workout", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/workouts\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}
