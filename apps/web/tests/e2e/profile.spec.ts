// S7 (#13) — M0 exit condition: "a signed-in member can access their own profile" (FR-01).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { field, fillAuthForm, signOut, signUp } from "./helpers";

async function completeOnboarding(page: Page) {
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

async function expectSavedProfile(page: Page) {
  const profile = page.getByTestId("profile");
  await expect(profile).toContainText("Get stronger");
  await expect(profile).toContainText("Intermediate");
  await expect(profile).toContainText("Dumbbells, Bench");
  await expect(profile).toContainText("45");
}

test("EXIT: sign up → onboard → sign out → sign in → own profile is there", async ({ page }) => {
  const creds = await signUp(page);
  await completeOnboarding(page);
  await expectSavedProfile(page);

  await signOut(page);
  await page.goto("/app/profile");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Fprofile$/);
  await fillAuthForm(page, creds);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/app\/profile$/);
  await expectSavedProfile(page);
});

test("a different member does not see the first member's profile", async ({ browser }) => {
  const a = await browser.newPage();
  await signUp(a);
  await completeOnboarding(a);

  const b = await browser.newPage();
  await signUp(b);
  await b.goto("/app/profile");
  await expect(b).toHaveURL(/\/app\/onboarding$/); // B has no profile; A's is never shown
  await expect(b.getByText("Get stronger")).toHaveCount(0);
});

test("member nav shows member links only; staff pages are not found", async ({ page }) => {
  await signUp(page);
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link")).toHaveText(["Home", "Exercises", "Profile"]);
  // Role check streams inside <Suspense>, so the HTTP status is already 200 by then; assert
  // the rendered not-found state instead. Real access control lives in the API.
  await page.goto("/app/trainer");
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "My members" })).toHaveCount(0);
});

test("skip link moves keyboard focus to the main content", async ({ page }) => {
  await signUp(page);
  await page.goto("/app"); // fresh document load: the skip link is the first Tab stop
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#content")).toBeFocused();
});

test("app pages have no serious accessibility violations", async ({ page }) => {
  await signUp(page);
  for (const path of ["/app", "/app/onboarding"]) {
    await page.goto(path);
    await expect(page.locator("main#content h1")).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).include("body").analyze();
    const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, `${path}: ${serious.map((v) => v.id).join(", ")}`).toEqual([]);
  }
});
