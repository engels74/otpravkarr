import { expect, test } from "@playwright/test";

/**
 * Regression coverage for P01-ISSUE-001.
 *
 * The dogfood pass reported that the Step 2 ("Create Account") submit button
 * did not respond to CDP-synthesized clicks. Structural code review of
 * src/routes/setup/+page.svelte:506,606 confirms the form is wired exactly
 * the same way as the working /login submit, so the issue is most likely a
 * CDP/agent-browser tooling artifact rather than a real product bug.
 *
 * This spec exercises the Step 2 button in a real browser to catch any future
 * regression in the submit path.
 *
 * Requires the E2E webServer to be started with E2E_SEED_SETUP_PRE_ADMIN=1
 * (the default seed marks setup complete and is incompatible with this flow).
 */

const SETUP_CLAIM_PROOF = process.env.E2E_SETUP_CLAIM_PROOF ?? "e2e-fresh-setup-proof";
const isPreAdminMode = process.env.E2E_SEED_SETUP_PRE_ADMIN === "1";

test.describe("Setup wizard (fresh state)", () => {
  test.skip(
    !isPreAdminMode,
    "Requires E2E_SEED_SETUP_PRE_ADMIN=1 to seed the DB without an admin account.",
  );

  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      {
        name: "otpravkarr_setup_claim",
        value: SETUP_CLAIM_PROOF,
        domain: "localhost",
        path: "/setup",
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
  });

  test("Step 2 Create Account button submits the form", async ({ page }) => {
    await page.goto("/setup");

    await expect(page.getByText("Create admin account", { exact: true })).toBeVisible();

    await page.getByLabel(/^Username$/).fill("dogfood-admin");
    await page.getByLabel(/^Password$/).fill("DogfoodTestPass2026XYZ");
    await page.getByLabel(/Confirm password/).fill("DogfoodTestPass2026XYZ");

    await page.getByRole("button", { name: /Create Account/ }).click();

    await expect(page.getByText("Connect your Plex server", { exact: true })).toBeVisible({
      timeout: 5_000,
    });
  });
});
