import { test as setup } from "@playwright/test";
import { ADMIN_STORAGE_STATE, TEST_ADMIN_PASSWORD, TEST_ADMIN_USERNAME } from "./helpers";

/**
 * Playwright auth setup — logs in as admin once and saves the session
 * storage state so all subsequent "app" project tests reuse it without
 * hitting the login endpoint repeatedly (avoids rate limiting).
 */
setup("authenticate as admin", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill(TEST_ADMIN_USERNAME);
  await page.getByLabel("Password").fill(TEST_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/dashboard");

  // Save the authenticated session state
  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
