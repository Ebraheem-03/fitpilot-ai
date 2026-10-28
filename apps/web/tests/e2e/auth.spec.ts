// S6 (#12): sign-up / sign-in / sign-out against a local Supabase stack (FR-01).
import { expect, test } from "@playwright/test";
import { field, fillAuthForm, newCredentials, signOut, signUp } from "./helpers";

test("anonymous visit to /app redirects to sign-in with a return path", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("sign up lands in the app; sign out locks it again", async ({ page }) => {
  await signUp(page);
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();

  await signOut(page);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("returning user signs in and is sent to the requested page", async ({ page }) => {
  const creds = await signUp(page);
  await signOut(page);

  await page.goto("/app");
  await fillAuthForm(page, creds);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});

test("wrong password shows an accessible error and stays on sign-in", async ({ page }) => {
  const creds = await signUp(page);
  await signOut(page);

  await fillAuthForm(page, { ...creds, password: "definitely-wrong-password" });
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("auth-error")).toBeVisible();
  await expect(page.getByTestId("auth-error")).toHaveAttribute("role", "alert");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("open-redirect attempts in ?next= are ignored", async ({ page }) => {
  const creds = await signUp(page);
  await signOut(page);

  await page.goto("/sign-in?next=//evil.example/app");
  await fillAuthForm(page, creds);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/localhost:3100\/app$/);
});

test("signed-in users are bounced from auth pages to the app", async ({ page }) => {
  await signUp(page);
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/app$/);
});

test("sign-up form is keyboard operable", async ({ page }) => {
  const creds = newCredentials();
  await page.goto("/sign-up");
  await field(page, "Email").focus();
  await page.keyboard.type(creds.email);
  await page.keyboard.press("Tab");
  await page.keyboard.type(creds.password);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app$/);
});

test("static-looking paths under /app still go through the auth proxy", async ({ page }) => {
  for (const path of ["/app/exercises/x.glb", "/app/x.png"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/sign-in\?next=/);
  }
});

test("exercise models are public static assets, served without a session", async ({ request }) => {
  const res = await request.get("/exercises/bodyweight_squat/squat.glb", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
});
