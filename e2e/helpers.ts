import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

/**
 * Shared E2E test constants and helpers.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

export const TEST_ADMIN_USERNAME = "e2e-admin";
export const TEST_ADMIN_PASSWORD = "TestPassword123!@#";

/** Path to the saved admin storage state (cookies/localStorage). */
export const ADMIN_STORAGE_STATE = resolve(__dirname, ".auth", "admin.json");

/**
 * Log in as admin via the login page form.
 * Prefer using the `storageState` from auth.setup.ts instead of calling
 * this in every test — avoids rate limiting.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username").fill(TEST_ADMIN_USERNAME);
  await page.getByLabel("Password").fill(TEST_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/dashboard");
}

/**
 * Log out the current admin session via the sidebar sign-out button.
 */
export async function logoutAdmin(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/login");
}
