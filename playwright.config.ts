import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));

const testDbDir = mkdtempSync(resolve(tmpdir(), "otpravkarr-e2e-"));
const testDbPath = resolve(testDbDir, "test.sqlite");
const E2E_PORT = 4173;

const ADMIN_STORAGE_STATE = resolve(__dirname, "e2e", ".auth", "admin.json");

// Make the DB path available to test files
process.env.E2E_DATABASE_PATH = testDbPath;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
  },
  projects: [
    {
      name: "setup",
      testMatch: "setup.spec.ts",
    },
    {
      name: "auth",
      testMatch: "auth.setup.ts",
      dependencies: ["setup"],
    },
    {
      name: "login",
      testMatch: "admin-login.spec.ts",
      dependencies: ["auth"],
    },
    {
      name: "app",
      testMatch: [
        "admin-dashboard.spec.ts",
        "admin-users.spec.ts",
        "admin-audit-pagination.spec.ts",
        "mobile-sidebar.spec.ts",
      ],
      dependencies: ["auth"],
      use: { storageState: ADMIN_STORAGE_STATE },
    },
    {
      name: "portal",
      testMatch: "portal-*.spec.ts",
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // Seed DB before server starts so the server's DB connection
    // sees the seeded data from the very first read.
    command: [
      "bun --bun run build",
      `bun e2e/seed-db.ts "${testDbPath}"`,
      "bun ./build/index.js",
    ].join(" && "),
    port: E2E_PORT,
    // Always launch a fresh E2E server so each run uses its seeded temp DB
    // and never attaches to an arbitrary pre-existing process on 4173.
    reuseExistingServer: false,
    env: {
      OTPRAVKARR_SECRET: "e2e-test-secret-that-is-at-least-32-characters-long",
      DATABASE_PATH: testDbPath,
      ORIGIN: `http://localhost:${E2E_PORT}`,
      PORT: String(E2E_PORT),
      HOST: "localhost",
      E2E_SEED_AUDIT: "1",
    },
    stdout: "pipe",
  },
});
