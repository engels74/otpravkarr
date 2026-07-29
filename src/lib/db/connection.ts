import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "$env/dynamic/private";
import { runMigrations } from "./migrate";

const DEFAULT_DATABASE_PATH = "./data/otpravkarr.sqlite";

let instance: Database | null = null;

/**
 * Get the singleton Database instance.
 * Creates and configures it on first access.
 */
export function getDb(): Database {
  if (instance) return instance;

  const configuredPath = env.DATABASE_PATH?.trim();
  const dbPath = configuredPath || DEFAULT_DATABASE_PATH;
  if (configuredPath && process.env.NODE_ENV === "production" && !existsSync(dbPath)) {
    throw new Error(
      `Configured DATABASE_PATH does not exist; refusing to create a replacement database at ${dbPath}`,
    );
  }
  instance = createDatabase(dbPath);
  return instance;
}

/**
 * Create a new Database with WAL mode and foreign keys enabled.
 * Exported for testing (pass ":memory:" for in-memory databases).
 */
export function createDatabase(path: string): Database {
  ensureParentDir(path);
  const db = new Database(path);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  return db;
}

/**
 * Ensure the parent directory of a file-backed SQLite database exists. Without
 * this, a fresh deploy with the default `./data/otpravkarr.sqlite` path (and no
 * `data/` dir) makes `new Database(path)` throw "unable to open database file",
 * 500ing every request. In-memory databases have no parent dir to create.
 */
function ensureParentDir(path: string): void {
  // Skip in-memory / anonymous databases (":memory:", "", "file::memory:...").
  if (path === "" || path === ":memory:" || path.startsWith("file::memory:")) return;
  const dir = dirname(path);
  if (dir && dir !== ".") {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Initialize the database: run all pending migrations.
 * Called from hooks.server.ts on server startup.
 */
export async function initializeDatabase(): Promise<void> {
  const db = getDb();
  await runMigrations(db);
}

/**
 * Shorthand accessor — returns the singleton Database.
 * Lazily initializes via getDb() on first property access.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop, _receiver) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    if (typeof value === "function") {
      return value.bind(real);
    }
    return value;
  },
});

/**
 * Reset the singleton — for testing only.
 */
export function _resetForTesting(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
