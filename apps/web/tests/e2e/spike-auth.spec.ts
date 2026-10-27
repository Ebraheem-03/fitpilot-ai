// SPIKE (S0, #6): web → Supabase → FastAPI token handoff against the real project. Not for merge.
import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

test("unauthenticated /spike/me redirects to /spike", async ({ page }) => {
  await page.goto("/spike/me");
  await expect(page).toHaveURL(/\/spike$/);
});

test("sign up → server component calls API with bearer → API verifies", async ({ page }) => {
  const email = `fitpilot-spike-${randomBytes(4).toString("hex")}@example.com`;
  await page.goto("/spike");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(randomBytes(12).toString("base64url"));
  await page.getByRole("button", { name: "Sign up" }).click();

  const alert = page.getByTestId("auth-error");
  const whoami = page.getByTestId("whoami");
  await expect(alert.or(whoami)).toBeVisible({ timeout: 20_000 });
  if (await alert.isVisible()) throw new Error(`sign-up failed: ${await alert.textContent()}`);

  const out = JSON.parse((await whoami.textContent()) ?? "{}");
  console.log(`SPIKE RESULT status=${out.status} alg=${out.body?.alg} email=${email}`);
  expect(out.status).toBe(200);
  expect(out.body.sub).toBe(out.sub_matches);
});
