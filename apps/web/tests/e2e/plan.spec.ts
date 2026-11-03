// M3 S8 — FR-02 (view): generate a plan with the rule-based fake planner (LLM_PROVIDER=fake in
// scripts/e2e.sh; CI never calls a live model), view it, regenerate, browse versions.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { onboard, signUp } from "./helpers";

const generate = (page: Page) =>
  page.getByRole("button", { name: /Generate my plan|Regenerate plan/ }).filter({ visible: true });
const planView = (page: Page) => page.getByTestId("plan-view").filter({ visible: true });

async function openPlan(page: Page) {
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Plan" })
    .click();
  await expect(page).toHaveURL(/\/app\/plan$/);
}

test("generate a plan, view the week, regenerate, and open the earlier version", async ({
  page,
}) => {
  await signUp(page);
  await onboard(page);
  await openPlan(page);

  await expect(page.getByTestId("no-plan")).toBeVisible();
  await generate(page).click();

  await expect(planView(page)).toBeVisible();
  await expect(page.getByTestId("plan-version-label")).toHaveText("· version 1");
  // profile asked for 3 days a week
  await expect(planView(page).locator("[data-day-index]")).toHaveCount(3);
  const exercises = planView(page).getByTestId("plan-exercise");
  expect(await exercises.count()).toBeGreaterThan(0);
  // every exercise says how it is prescribed, rest and how it is tracked
  await expect(planView(page).getByTestId("plan-prescription").first()).toHaveText(
    /^\d+ × \d+( reps| s)$/,
  );
  await expect(planView(page).getByTestId("plan-tracking").first()).toHaveText(
    /Camera-tracked|Logged by hand/,
  );
  await expect(
    planView(page)
      .getByText(/Rest \d+ s between sets/)
      .first(),
  ).toBeVisible();
  await expect(
    planView(page)
      .getByText(/^Progression:/)
      .first(),
  ).toBeVisible();

  // regenerate → version 2 becomes current, version 1 is kept as history
  await generate(page).click();
  await expect(page.getByTestId("generate-done")).toContainText("version 2");
  await expect(page.getByTestId("plan-version-label")).toHaveText("· version 2");
  const versions = page.getByTestId("plan-version");
  await expect(versions).toHaveCount(2);
  await expect(versions.nth(0)).toHaveAttribute("data-plan-status", "active");
  await expect(versions.nth(1)).toHaveAttribute("data-plan-status", "superseded");

  await versions.nth(1).getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: "Plan version 1" })).toBeVisible();
  await expect(page.getByTestId("plan-status")).toContainText("Earlier version");
  await expect(planView(page)).toBeVisible();
  await page.getByRole("link", { name: "Go to your current plan" }).click();
  await expect(page).toHaveURL(/\/app\/plan$/);
});

test("a plan survives a reload and links exercises to their library page", async ({ page }) => {
  await signUp(page);
  await onboard(page);
  await page.goto("/app/plan");
  await generate(page).click();
  await expect(planView(page)).toBeVisible();
  await page.reload();
  await expect(planView(page)).toBeVisible();
  const demo = planView(page)
    .getByRole("link", { name: /3D demo|How to do it/ })
    .first();
  const href = await demo.getAttribute("href");
  expect(href).toMatch(/^\/app\/exercises\/[a-z0-9_]+$/);
  await demo.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
});

test("without a profile the coach asks for one instead of making a plan", async ({ page }) => {
  await signUp(page);
  await page.goto("/app/plan");
  await generate(page).click();
  await expect(page.getByTestId("generate-error-profile_required")).toBeVisible();
  await expect(page.getByRole("link", { name: "Set up your profile" })).toHaveAttribute(
    "href",
    "/app/onboarding",
  );
  await expect(planView(page)).toHaveCount(0);
});

test("another member cannot open my plan version", async ({ browser }) => {
  const a = await browser.newPage();
  await signUp(a);
  await onboard(a);
  await a.goto("/app/plan");
  await generate(a).click();
  await expect(a.getByTestId("plan-view").filter({ visible: true })).toBeVisible();
  await a.getByTestId("plan-version").first().getByRole("link").click();
  await expect(a).toHaveURL(/\/app\/plan\/[0-9a-f-]{36}$/);
  const url = a.url();

  const b = await browser.newPage();
  await signUp(b);
  await b.goto(url);
  await expect(b.getByText("This page could not be found.")).toBeVisible();
  await expect(b.getByTestId("plan-view")).toHaveCount(0);
});

test("plan page is keyboard operable, has no serious a11y issues and fits a phone", async ({
  page,
}) => {
  await signUp(page);
  await onboard(page);
  await page.goto("/app/plan");

  // Keyboard: focus the button and press Enter.
  const button = generate(page);
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(planView(page)).toBeVisible();

  const { violations } = await new AxeBuilder({ page }).include("body").analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => v.id).join(", ")).toEqual([]);

  await page.setViewportSize({ width: 375, height: 740 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
  await expect(generate(page)).toBeVisible();
});
