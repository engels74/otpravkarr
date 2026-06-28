import { db } from "../connection";
import type { UserMapping } from "../types";

// Prepared statements — lazily initialized on first use
let stmtByPlexId: ReturnType<typeof db.prepare> | null = null;
let stmtByDispatcharrId: ReturnType<typeof db.prepare> | null = null;
let stmtAllByDispatcharrId: ReturnType<typeof db.prepare> | null = null;
let stmtAllActive: ReturnType<typeof db.prepare> | null = null;
let stmtAllInactive: ReturnType<typeof db.prepare> | null = null;
let stmtAll: ReturnType<typeof db.prepare> | null = null;
let stmtInsert: ReturnType<typeof db.prepare> | null = null;
let stmtMarkInactive: ReturnType<typeof db.prepare> | null = null;
let stmtLastAccessed: ReturnType<typeof db.prepare> | null = null;
let stmtLastSynced: ReturnType<typeof db.prepare> | null = null;
let stmtPlexIdentity: ReturnType<typeof db.prepare> | null = null;
let stmtGetById: ReturnType<typeof db.prepare> | null = null;
let stmtDeleteById: ReturnType<typeof db.prepare> | null = null;

function byPlexIdStmt() {
  stmtByPlexId ??= db.prepare("SELECT * FROM user_mappings WHERE plex_account_id = ?");
  return stmtByPlexId;
}

function byDispatcharrIdStmt() {
  stmtByDispatcharrId ??= db.prepare("SELECT * FROM user_mappings WHERE dispatcharr_user_id = ?");
  return stmtByDispatcharrId;
}

function allByDispatcharrIdStmt() {
  stmtAllByDispatcharrId ??= db.prepare(
    "SELECT * FROM user_mappings WHERE dispatcharr_user_id = ?",
  );
  return stmtAllByDispatcharrId;
}

function allActiveStmt() {
  stmtAllActive ??= db.prepare("SELECT * FROM user_mappings WHERE is_active = 1");
  return stmtAllActive;
}

function allInactiveStmt() {
  stmtAllInactive ??= db.prepare("SELECT * FROM user_mappings WHERE is_active = 0");
  return stmtAllInactive;
}

function allStmt() {
  stmtAll ??= db.prepare("SELECT * FROM user_mappings");
  return stmtAll;
}

function insertStmt() {
  stmtInsert ??= db.prepare(
    `INSERT INTO user_mappings (
      plex_account_id, plex_uuid, plex_username, plex_email, plex_thumb,
      dispatcharr_user_id, dispatcharr_username, dispatcharr_xc_password_enc,
      dispatcharr_group_ids, dispatcharr_profile_id, provisioning_mode, is_active,
      group_selection_locked, is_owner,
      last_synced_at, last_accessed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  return stmtInsert;
}

function markInactiveStmt() {
  stmtMarkInactive ??= db.prepare(
    "UPDATE user_mappings SET is_active = 0, updated_at = datetime('now') WHERE id = ?",
  );
  return stmtMarkInactive;
}

function lastAccessedStmt() {
  stmtLastAccessed ??= db.prepare(
    "UPDATE user_mappings SET last_accessed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
  );
  return stmtLastAccessed;
}

function lastSyncedStmt() {
  stmtLastSynced ??= db.prepare(
    "UPDATE user_mappings SET last_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
  );
  return stmtLastSynced;
}

function plexIdentityStmt() {
  stmtPlexIdentity ??= db.prepare(
    "UPDATE user_mappings SET plex_username = ?, plex_email = ?, plex_thumb = ?, updated_at = datetime('now') WHERE id = ?",
  );
  return stmtPlexIdentity;
}

function getByIdStmt() {
  stmtGetById ??= db.prepare("SELECT * FROM user_mappings WHERE id = ?");
  return stmtGetById;
}

function deleteByIdStmt() {
  stmtDeleteById ??= db.prepare("DELETE FROM user_mappings WHERE id = ?");
  return stmtDeleteById;
}

/**
 * Find a user mapping by Plex account ID.
 */
export function getUserMappingByPlexId(plexAccountId: number): UserMapping | null {
  return (byPlexIdStmt().get(plexAccountId) as UserMapping | null) ?? null;
}

/**
 * Find a user mapping by Dispatcharr user ID.
 */
export function getUserMappingByDispatcharrId(dispatcharrUserId: number): UserMapping | null {
  return (byDispatcharrIdStmt().get(dispatcharrUserId) as UserMapping | null) ?? null;
}

/**
 * Find all user mappings that reference the same Dispatcharr user ID.
 */
export function getUserMappingsByDispatcharrId(dispatcharrUserId: number): UserMapping[] {
  return allByDispatcharrIdStmt().all(dispatcharrUserId) as UserMapping[];
}

/**
 * Find a user mapping by its primary key ID.
 */
export function getUserMappingById(id: number): UserMapping | null {
  return (getByIdStmt().get(id) as UserMapping | null) ?? null;
}

/**
 * Get all user mappings, optionally filtered by active status.
 */
export function getAllUserMappings(filters?: { isActive?: boolean }): UserMapping[] {
  if (filters?.isActive === true) {
    return allActiveStmt().all() as UserMapping[];
  }
  if (filters?.isActive === false) {
    return allInactiveStmt().all() as UserMapping[];
  }
  return allStmt().all() as UserMapping[];
}

/**
 * Create a new user mapping.
 * The `dispatcharr_xc_password_enc` field should already be encrypted by the caller.
 * Returns the created row.
 */
export function createUserMapping(
  mapping: Omit<
    UserMapping,
    "id" | "created_at" | "updated_at" | "group_selection_locked" | "is_owner"
  > &
    Partial<Pick<UserMapping, "group_selection_locked" | "is_owner">>,
): UserMapping {
  const result = insertStmt().run(
    mapping.plex_account_id,
    mapping.plex_uuid,
    mapping.plex_username,
    mapping.plex_email,
    mapping.plex_thumb,
    mapping.dispatcharr_user_id,
    mapping.dispatcharr_username,
    mapping.dispatcharr_xc_password_enc,
    mapping.dispatcharr_group_ids,
    mapping.dispatcharr_profile_id,
    mapping.provisioning_mode,
    mapping.is_active,
    mapping.group_selection_locked ?? 0,
    mapping.is_owner ?? 0,
    mapping.last_synced_at,
    mapping.last_accessed_at,
  );

  return getByIdStmt().get(result.lastInsertRowid) as UserMapping;
}

/**
 * Update a user mapping with partial fields. Automatically sets `updated_at`.
 * If updating `dispatcharr_xc_password_enc`, the caller must pre-encrypt the value.
 */
export function updateUserMapping(
  id: number,
  updates: Partial<Omit<UserMapping, "id" | "created_at">>,
): void {
  const allowed = [
    "plex_account_id",
    "plex_uuid",
    "plex_username",
    "plex_email",
    "plex_thumb",
    "dispatcharr_user_id",
    "dispatcharr_username",
    "dispatcharr_xc_password_enc",
    "dispatcharr_group_ids",
    "dispatcharr_profile_id",
    "provisioning_mode",
    "is_active",
    "group_selection_locked",
    "is_owner",
    "last_synced_at",
    "last_accessed_at",
  ] as const;

  const entries = Object.entries(updates).filter(
    ([key, value]) => (allowed as readonly string[]).includes(key) && value !== undefined,
  );

  if (entries.length === 0) return;

  const setClauses = entries.map(([key]) => `${key} = ?`);
  setClauses.push("updated_at = datetime('now')");

  const sql = `UPDATE user_mappings SET ${setClauses.join(", ")} WHERE id = ?`;
  const values = [...entries.map(([, v]) => v), id];

  db.prepare(sql).run(...values);
}

/**
 * Update only the encrypted XC password for the expected automatic mapping.
 * Returns true when exactly one row was updated.
 */
export function updateXcPasswordForMapping(
  id: number,
  dispatcharrUserId: number,
  encryptedPassword: string,
): boolean {
  const result = db
    .prepare(
      `UPDATE user_mappings
       SET dispatcharr_xc_password_enc = ?, updated_at = datetime('now')
       WHERE id = ?
         AND dispatcharr_user_id = ?
         AND provisioning_mode = 'automatic'`,
    )
    .run(encryptedPassword, id, dispatcharrUserId);
  return result.changes === 1;
}

/**
 * Mark a user mapping as inactive, updating `updated_at`.
 */
export function markMappingInactive(id: number): void {
  markInactiveStmt().run(id);
}

/**
 * Update the `last_accessed_at` timestamp to now.
 */
export function updateLastAccessed(id: number): void {
  lastAccessedStmt().run(id);
}

/**
 * Update the `last_synced_at` timestamp to now.
 */
export function updateLastSynced(id: number): void {
  lastSyncedStmt().run(id);
}

/**
 * Update Plex identity fields (username, email, thumb), setting `updated_at`.
 */
export function updatePlexIdentity(
  id: number,
  username: string,
  email: string | null,
  thumb: string | null,
): void {
  plexIdentityStmt().run(username, email, thumb, id);
}

/**
 * Delete a user mapping by primary key.
 * Returns true when exactly one row was deleted.
 */
export function deleteUserMapping(id: number): boolean {
  const result = deleteByIdStmt().run(id);
  return result.changes === 1;
}

/**
 * Reset prepared statements — for testing only.
 */
export function _resetStatementsForTesting(): void {
  stmtByPlexId = null;
  stmtByDispatcharrId = null;
  stmtAllByDispatcharrId = null;
  stmtAllActive = null;
  stmtAllInactive = null;
  stmtAll = null;
  stmtInsert = null;
  stmtMarkInactive = null;
  stmtLastAccessed = null;
  stmtLastSynced = null;
  stmtPlexIdentity = null;
  stmtGetById = null;
  stmtDeleteById = null;
}
