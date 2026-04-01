import { decrypt, encrypt } from "../../crypto/encryption";
import { db } from "../connection";
import type { ConfigEntry } from "../types";

const CONFIG_PURPOSE = "config-encryption";

// Prepared statements — lazily initialized on first use
let stmtGet: ReturnType<typeof db.prepare> | null = null;
let stmtAll: ReturnType<typeof db.prepare> | null = null;
let stmtUpsert: ReturnType<typeof db.prepare> | null = null;

function getStmt() {
  stmtGet ??= db.prepare("SELECT key, value, encrypted, updated_at FROM config WHERE key = ?");
  return stmtGet;
}

function allStmt() {
  stmtAll ??= db.prepare("SELECT key, value, encrypted, updated_at FROM config");
  return stmtAll;
}

function upsertStmt() {
  stmtUpsert ??= db.prepare(
    `INSERT INTO config (key, value, encrypted, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, encrypted = excluded.encrypted, updated_at = datetime('now')`,
  );
  return stmtUpsert;
}

// In-memory config cache
let configCache: Record<string, string> | null = null;

/**
 * Get a single config value by key, decrypting if necessary.
 * Uses the in-memory cache if populated.
 */
export async function getConfig(key: string): Promise<string | null> {
  if (configCache !== null) {
    return configCache[key] ?? null;
  }

  const row = getStmt().get(key) as ConfigEntry | null;
  if (!row) return null;

  if (row.encrypted === 1) {
    return decrypt(row.value, CONFIG_PURPOSE);
  }
  return row.value;
}

/**
 * Set a config value, encrypting if requested. Upserts (insert or update).
 * Invalidates the in-memory cache.
 */
export async function setConfig(key: string, value: string, encrypted?: boolean): Promise<void> {
  const storedValue = encrypted ? await encrypt(value, CONFIG_PURPOSE) : value;
  upsertStmt().run(key, storedValue, encrypted ? 1 : 0);
  invalidateConfigCache();
}

/**
 * Read all config entries, decrypting encrypted fields.
 * Returns a plain key→value record.
 */
export async function getAllConfig(): Promise<Record<string, string>> {
  const rows = allStmt().all() as ConfigEntry[];
  const result: Record<string, string> = {};

  for (const row of rows) {
    if (row.encrypted === 1) {
      result[row.key] = await decrypt(row.value, CONFIG_PURPOSE);
    } else {
      result[row.key] = row.value;
    }
  }

  return result;
}

/**
 * Populate the in-memory config cache from the database.
 * Call on startup after migrations.
 */
export async function loadConfigCache(): Promise<void> {
  configCache = await getAllConfig();
}

/**
 * Invalidate the in-memory config cache.
 * Called after any write operation.
 */
export function invalidateConfigCache(): void {
  configCache = null;
}

/**
 * Reset prepared statements — for testing only.
 */
export function _resetStatementsForTesting(): void {
  stmtGet = null;
  stmtAll = null;
  stmtUpsert = null;
  configCache = null;
}
