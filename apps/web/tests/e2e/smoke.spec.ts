import { expect, test } from "@playwright/test";

test("home renders the squat from the catalogue", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Bodyweight Squat/ })).toBeVisible();
});
