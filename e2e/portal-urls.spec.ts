import { expect, test } from "@playwright/test";

/**
 * Portal streaming URLs E2E tests.
 *
 * The portal streaming URLs page requires an authenticated portal user
 * session (created via Plex OAuth → user provisioning). Since E2E tests
 * can't perform real Plex OAuth, we test that:
 *
 * 1. Unauthenticated access shows the sign-in page (not streaming URLs)
 * 2. The route exists and responds correctly
 * 3. The sign-in UI is present for unauthenticated users
 *
 * Full streaming URL tests would require either:
 * - A mock Plex OAuth server
 * - Pre-seeding a user session in the database
 * These are documented as a future enhancement.
 */

test.describe("Portal streaming URLs", () => {
  test("unauthenticated portal user sees sign-in page, not streaming URLs", async ({ page }) => {
    await page.goto("/");

    // Should show the sign-in UI, not the streaming credentials
    await expect(page.getByRole("button", { name: "Sign in with Plex" })).toBeVisible();
    await expect(page.getByText("Streaming URLs")).not.toBeVisible();
    await expect(page.getByText("Quick Setup")).not.toBeVisible();
  });

  test("portal route responds with 200", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
  });

  test("portal sign-in page has proper structure", async ({ page }) => {
    await page.goto("/");

    // Card with welcome message
    await expect(page.getByText("Welcome")).toBeVisible();
    await expect(
      page.getByText("Sign in with your Plex account to access your streaming credentials"),
    ).toBeVisible();

    // Submit button
    const button = page.getByRole("button", { name: "Sign in with Plex" });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("type", "submit");
  });

  test("Plex auth callback route exists", async ({ page }) => {
    // The /auth/plex route handles the OAuth callback.
    // Without proper OAuth state, it should error gracefully.
    const response = await page.goto("/auth/plex");
    // Should return an error status (400 or 500) since no OAuth state is present
    expect(response?.status()).toBeGreaterThanOrEqual(400);
  });
});
