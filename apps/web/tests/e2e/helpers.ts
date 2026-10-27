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

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
}
