/**
 * Database seeder for E2E tests.
 *
 * Opens the SQLite database and inserts an admin account + marks setup as
 * complete. If the tables don't exist yet, runs the initial migration SQL.
 *
 * Run via: bun e2e/seed-db.ts <database-path>
 */

import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun e2e/seed-db.ts <database-path>");
  process.exit(1);
}

const ADMIN_USERNAME = "e2e-admin";
const ADMIN_PASSWORD = "TestPassword123!@#";

async function seed() {
  const hash = await Bun.password.hash(ADMIN_PASSWORD, { algorithm: "argon2id" });

  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");

  // Ensure tables exist — run migration if needed
  const tableCheck = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='admin_accounts'")
    .get();

  if (!tableCheck) {
    // Tables not yet created — run the initial migration
    const migrationPath = resolve(
      __dirname,
      "..",
      "src",
      "lib",
      "db",
      "migrations",
      "001_initial.sql",
    );
    const sql = readFileSync(migrationPath, "utf-8");
    db.exec(sql);

    // Also create the migrations tracking table
    db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.run("INSERT OR IGNORE INTO _migrations (version, name) VALUES (1, '001_initial.sql')");
    console.log("  Applied initial migration");
  }

  // Insert admin account
  db.run(`INSERT OR IGNORE INTO admin_accounts (username, password_hash) VALUES (?, ?)`, [
    ADMIN_USERNAME,
    hash,
  ]);

  // Mark setup as complete with required config values
  const configs: [string, string][] = [
    ["setup_completed", "true"],
    ["setup_claimed", "true"],
    ["admin_username", ADMIN_USERNAME],
    ["plex_server_url", "http://localhost:32400"],
    ["plex_admin_token", "fake-plex-token-for-e2e"],
    ["plex_machine_id", "e2e-machine-id"],
    ["dispatcharr_url", "http://localhost:5001"],
    ["dispatcharr_api_key", "fake-dispatcharr-key-for-e2e"],
    ["allowed_origins", JSON.stringify(["http://localhost:4173"])],
    ["default_group_id", "1"],
    ["default_profile_id", ""],
    ["sync_interval_minutes", "15"],
    ["default_provisioning_mode", "automatic"],
  ];

  const stmt = db.prepare(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
  );

  for (const [key, value] of configs) {
    stmt.run(key, value);
  }

  db.close();
  console.log(`Seeded database at ${dbPath} with admin "${ADMIN_USERNAME}"`);
}

await seed();
