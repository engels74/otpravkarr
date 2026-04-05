import { expect, test } from "@playwright/test";

/**
 * Admin users management E2E tests.
 *
 * These tests use the pre-authenticated storage state from auth.setup.ts.
 * Since the test database has no user mappings, we verify the empty
 * state and filter controls.
 */

test.describe("Admin users page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/users");
  });

  test("users page loads with heading", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  });

  test("shows user count", async ({ page }) => {
    await expect(page.getByText(/\d+ users/)).toBeVisible();
  });

  test("filter controls are present", async ({ page }) => {
    await expect(page.getByText("All statuses")).toBeVisible();
    await expect(page.getByText("All modes")).toBeVisible();
    await expect(page.getByPlaceholder("Search username...")).toBeVisible();
  });

  test("users table has correct column headers", async ({ page }) => {
    await expect(page.getByRole("columnheader", { name: "User" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Dispatcharr" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Mode" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Last Accessed" })).toBeVisible();
  });

  test("shows empty state when no users exist", async ({ page }) => {
    await expect(page.getByText("No users found")).toBeVisible();
  });

  test("search input accepts text", async ({ page }) => {
    const searchInput = page.getByPlaceholder("Search username...");
    await searchInput.fill("testuser");
    await expect(searchInput).toHaveValue("testuser");
  });
});
