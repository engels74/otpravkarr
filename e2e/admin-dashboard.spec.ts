import { expect, test } from "@playwright/test";

/**
 * Admin dashboard E2E tests.
 *
 * These tests use the pre-authenticated storage state from auth.setup.ts
 * so they do not need to log in — the session cookie is already present.
 */

test.describe("Admin dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("dashboard page loads with correct title", async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page).toHaveTitle(/Dashboard/);
  });

  test("shows health status cards for Plex, Dispatcharr, and SQLite", async ({ page }) => {
    await expect(page.getByText("Plex").first()).toBeVisible();
    await expect(page.getByText("Dispatcharr").first()).toBeVisible();
    await expect(page.getByText("SQLite").first()).toBeVisible();
  });

  test("shows user statistics section", async ({ page }) => {
    await expect(page.getByText("Users").first()).toBeVisible();
    await expect(page.getByText("Total")).toBeVisible();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByText("Inactive")).toBeVisible();
    await expect(page.getByText("Orphaned")).toBeVisible();

    await expect(page.getByText("Automatic")).toBeVisible();
    await expect(page.getByText("Self-managed")).toBeVisible();
    await expect(page.getByText("Staff")).toBeVisible();
  });

  test("shows sync status section", async ({ page }) => {
    await expect(page.getByText("Sync Status")).toBeVisible();
  });

  test("shows recent activity section", async ({ page }) => {
    await expect(page.getByText("Recent Activity")).toBeVisible();
  });

  test("shows available Plex friends section", async ({ page }) => {
    await expect(page.getByText("Available Plex Friends")).toBeVisible();
  });

  test("sidebar navigation links are present", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Users" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Audit Log" })).toBeVisible();
  });

  test("sidebar shows admin username", async ({ page }) => {
    await expect(page.getByText("e2e-admin").first()).toBeVisible();
  });

  test("sidebar has sign-out button", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("navigation to /users works", async ({ page }) => {
    await page.getByRole("link", { name: "Users" }).click();
    await expect(page).toHaveURL(/\/users/);
    await expect(page.getByText("Users").first()).toBeVisible();
  });

  test("navigation to /settings works", async ({ page }) => {
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings/);
  });

  test("navigation to /audit works", async ({ page }) => {
    await page.getByRole("link", { name: "Audit Log" }).click();
    await expect(page).toHaveURL(/\/audit/);
  });
});
