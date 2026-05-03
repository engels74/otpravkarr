import { expect, test } from "@playwright/test";

/**
 * Regression coverage for the audit pagination Next/Previous buttons.
 *
 * The dogfood pass (P06-ISSUE-001) reported that clicking "Next" on
 * /audit did not advance the page. The source code (admin/audit/+page.svelte
 * `updateFilter` → `goto(...)`) is correct, so we keep this spec to catch any
 * future regression in the real-browser navigation path.
 *
 * Requires the seeder to have populated >10 audit rows
 * (E2E_SEED_AUDIT=1, see playwright.config.ts).
 */

test.describe("Admin audit pagination", () => {
  test("Next/Previous buttons navigate between pages", async ({ page }) => {
    await page.goto("/audit?limit=10");

    await expect(page.getByText(/Page 1 of/)).toBeVisible();

    await page.getByRole("button", { name: /Next/ }).click();

    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText(/Page 2 of/)).toBeVisible();

    await page.getByRole("button", { name: /Previous/ }).click();

    await expect(page).toHaveURL(/page=1/);
    await expect(page.getByText(/Page 1 of/)).toBeVisible();
  });
});
