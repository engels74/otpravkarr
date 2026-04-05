import { expect, test } from "@playwright/test";

/**
 * Portal OAuth E2E tests.
 *
 * The portal (/) shows a "Sign in with Plex" button for unauthenticated
 * users. Since Plex OAuth requires a real Plex account and network access,
 * we test the UI elements and form action rather than the full OAuth flow.
 */

test.describe("Portal OAuth", () => {
  test("portal root shows sign-in view when not authenticated", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "otpravkarr" })).toBeVisible();
    await expect(page.getByText("Stream access portal")).toBeVisible();
    await expect(page.getByText("Welcome")).toBeVisible();
    await expect(page.getByText("Sign in with your Plex account")).toBeVisible();
  });

  test("shows 'Sign in with Plex' button", async ({ page }) => {
    await page.goto("/");

    const signInButton = page.getByRole("button", { name: "Sign in with Plex" });
    await expect(signInButton).toBeVisible();
    await expect(signInButton).toBeEnabled();
  });

  test("sign-in form submits to correct action", async ({ page }) => {
    await page.goto("/");

    const form = page.locator('form[action="?/signInWithPlex"]');
    await expect(form).toBeVisible();
  });

  test("portal page has correct title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("otpravkarr");
  });

  test("unauthenticated portal does not show streaming credentials", async ({ page }) => {
    await page.goto("/");

    // These elements only appear for authenticated users
    await expect(page.getByText("Streaming URLs")).not.toBeVisible();
    await expect(page.getByText("M3U Playlist URL")).not.toBeVisible();
    await expect(page.getByText("Player API URL")).not.toBeVisible();
  });
});
