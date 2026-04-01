import { getDb } from "../connection";
import type { Session } from "../types";

/**
 * Create a new session.
 * Generates a UUID session ID, computes expiry from TTL, inserts the row.
 * Returns the session ID.
 */
export function createSession(userRef: string, type: "admin" | "user", ttlSeconds: number): string {
  const db = getDb();
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");

  db.prepare(
    "INSERT INTO sessions (id, user_ref, session_type, expires_at) VALUES (?, ?, ?, ?)",
  ).run(id, userRef, type, expiresAt);

  return id;
}

/**
 * Get a session by ID.
 * Returns null if not found or if expired.
 */
export function getSession(id: string): Session | null {
  const db = getDb();
  const row = db
    .prepare("SELECT id, user_ref, session_type, expires_at, created_at FROM sessions WHERE id = ?")
    .get(id) as Session | null;

  if (!row) return null;

  if (new Date(`${row.expires_at.replace(" ", "T")}Z`) < new Date()) {
    return null;
  }

  return row;
}

/**
 * Delete a session by ID.
 */
export function deleteSession(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

/**
 * Delete all expired sessions.
 * Returns the number of sessions deleted.
 */
export function deleteExpiredSessions(): number {
  const db = getDb();
  const result = db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  return result.changes;
}
