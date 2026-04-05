import { expect, test } from "@playwright/test";

/**
 * Setup wizard E2E tests.
 *
 * The database is pre-seeded before the server starts (via the
 * Playwright webServer command chain). This means setup is already
 * complete and the setup gate is inactive.
 *
 * These tests verify:
 * 1. The setup page returns 404 after setup is complete
 * 2. The health API is accessible
 * 3. The setup gate properly allows access to other pages once setup is done
 *
 * Note: Testing the full fresh-state setup wizard flow (claim, admin creation,
 * Plex/Dispatcharr connection steps) is impractical in E2E because:
 * - The bootstrap token is generated in-memory on server startup (not settable)
 * - Plex and Dispatcharr require real external services
 * The setup wizard UI structure is validated in component tests (Phase 18.2).
 */

test.describe("Setup gate behavior (post-setup)", () => {
  test("/setup returns 404 after setup is complete", async ({ page }) => {
    const response = await page.goto("/setup");
    expect(response?.status()).toBe(404);
  });

  test("root URL loads the portal (not redirect to /setup)", async ({ page }) => {
    const response = await page.goto("/");
    // Portal page loads (200), not a setup redirect (303)
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/$/);
  });

  test("/login is accessible after setup is complete", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/login/);
  });

  test("/dashboard redirects to /login (not /setup) when unauthenticated", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("health API is accessible", async ({ page }) => {
    const response = await page.request.get("/api/health");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("status");
  });
});
