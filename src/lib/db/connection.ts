import { Database } from "bun:sqlite";
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

  const dbPath = env.DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH;
  instance = createDatabase(dbPath);
  return instance;
}

/**
 * Create a new Database with WAL mode and foreign keys enabled.
 * Exported for testing (pass ":memory:" for in-memory databases).
 */
export function createDatabase(path: string): Database {
  const db = new Database(path);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  return db;
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
  get(_target, prop, receiver) {
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
