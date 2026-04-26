import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE, loginAsAdmin, logoutAdmin } from "./helpers";

/**
 * Admin authentication E2E tests.
 *
 * Login tests intentionally do NOT use storage state — they test the
 * actual login flow. To stay within the rate limit (10 attempts / 15 min)
 * we minimise the number of tests that submit credentials.
 */

test.describe("Admin login", () => {
  test("login page renders with username and password fields", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
    await expect(page.getByText("Sign in to the admin console.")).toBeVisible();
    await expect(page.getByText("Sign in", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  });

  test("login form posts credentials", async ({ page }) => {
    await page.goto("/login");

    const form = page.locator('form[method="POST"]');
    await expect(form).toBeVisible();
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test("invalid credentials show error message", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Username").fill("wrong-user");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign In" }).click();

    await expect(page.getByText("Authentication failed")).toBeVisible();
    await expect(page.getByText("Invalid username or password")).toBeVisible();
  });

  test("empty credentials show missing credentials error message", async ({ page }) => {
    await page.goto("/login");

    await page.getByRole("button", { name: "Sign In" }).click();

    await expect(page.getByText("Authentication failed")).toBeVisible();
    await expect(page.getByText("Username and password are required.")).toBeVisible();
  });

  test("valid credentials redirect to /dashboard", async ({ page }) => {
    await loginAsAdmin(page);

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  });

  test("logout clears session and redirects to /login", async ({ page }) => {
    await loginAsAdmin(page);
    await logoutAdmin(page);

    await expect(page).toHaveURL(/\/login/);
  });

  test("accessing /dashboard without auth redirects to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("accessing /users without auth redirects to /login", async ({ page }) => {
    await page.goto("/users");
    await expect(page).toHaveURL(/\/login/);
  });

  test("accessing /settings without auth redirects to /login", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login/);
  });

  test("accessing /audit without auth redirects to /login", async ({ page }) => {
    await page.goto("/audit");
    await expect(page).toHaveURL(/\/login/);
  });

  test.describe("authenticated admin", () => {
    test.use({ storageState: ADMIN_STORAGE_STATE });

    test("visiting /login redirects to /dashboard", async ({ page }) => {
      await page.goto("/login");
      await expect(page).toHaveURL(/\/dashboard/);
    });
  });
});
