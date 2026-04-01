import { getDb } from "../connection";
import type { AdminAccount } from "../types";

/**
 * Create a new admin account.
 */
export function createAdmin(username: string, passwordHash: string): void {
  const db = getDb();
  db.prepare("INSERT INTO admin_accounts (username, password_hash) VALUES (?, ?)").run(
    username,
    passwordHash,
  );
}

/**
 * Get an admin account by username.
 * Returns null if not found.
 */
export function getAdminByUsername(username: string): AdminAccount | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id, username, password_hash, created_at, updated_at FROM admin_accounts WHERE username = ?",
    )
    .get(username) as AdminAccount | null;

  return row ?? null;
}

/**
 * Check whether any admin account exists.
 */
export function adminExists(): boolean {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as count FROM admin_accounts").get() as { count: number };
  return row.count > 0;
}
