import { expect, test } from "@playwright/test";

/**
 * ISSUE-003 (HIGH): the mobile admin sidebar drawer could not be dismissed by
 * touch after navigating from within it — the Sheet's close (X) was hidden and
 * nothing auto-closed on navigation, leaving users stranded behind an open
 * drawer that covered the header trigger.
 *
 * These tests use the pre-authenticated admin storage state (auth.setup.ts) and
 * a phone-sized viewport so the sidebar renders as a mobile Sheet.
 */

test.use({ viewport: { width: 390, height: 844 } });

const mobileSheet = '[data-slot="sidebar"][data-mobile="true"]';

test.describe("Mobile admin sidebar dismissal (ISSUE-003)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("auto-closes the drawer after in-drawer navigation", async ({ page }) => {
    // Open the drawer via the header trigger.
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await expect(page.locator(mobileSheet)).toBeVisible();

    // Navigate from inside the drawer.
    await page.getByRole("link", { name: "Users" }).click();

    // URL changed AND the drawer dismissed itself.
    await expect(page).toHaveURL(/\/users$/);
    await expect(page.locator(mobileSheet)).toBeHidden();
  });

  test("can be dismissed with the visible Close (X) button", async ({ page }) => {
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await expect(page.locator(mobileSheet)).toBeVisible();

    // The Sheet close (X) is no longer hidden — clicking it closes the drawer.
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(mobileSheet)).toBeHidden();
  });
});
