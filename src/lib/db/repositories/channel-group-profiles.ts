import { db } from "../connection";
import type { ChannelGroupProfile } from "../types";

/**
 * Repository for the global mapping between a Dispatcharr channel group and the
 * otpravkarr-owned Channel Profile that scopes it (Model A). The sentinel
 * group_id `EMPTY_PROFILE_GROUP_ID` stores the shared "empty" profile used for
 * zero-group subscriptions (see migration 002 and bridge/subscriptions.ts).
 */

/** Sentinel group_id for the shared empty profile (zero enabled channels). */
export const EMPTY_PROFILE_GROUP_ID = -1;

// Prepared statements — lazily initialized on first use.
let stmtGet: ReturnType<typeof db.prepare> | null = null;
let stmtAll: ReturnType<typeof db.prepare> | null = null;
let stmtUpsert: ReturnType<typeof db.prepare> | null = null;
let stmtDelete: ReturnType<typeof db.prepare> | null = null;

function getStmt() {
  stmtGet ??= db.prepare("SELECT * FROM channel_group_profiles WHERE group_id = ?");
  return stmtGet;
}

function allStmt() {
  stmtAll ??= db.prepare("SELECT * FROM channel_group_profiles ORDER BY group_id");
  return stmtAll;
}

function upsertStmt() {
  stmtUpsert ??= db.prepare(
    `INSERT INTO channel_group_profiles (group_id, profile_id, profile_name)
     VALUES (?, ?, ?)
     ON CONFLICT(group_id) DO UPDATE SET
       profile_id = excluded.profile_id,
       profile_name = excluded.profile_name,
       updated_at = datetime('now')`,
  );
  return stmtUpsert;
}

function deleteStmt() {
  stmtDelete ??= db.prepare("DELETE FROM channel_group_profiles WHERE group_id = ?");
  return stmtDelete;
}

/** Look up the otpravkarr-owned profile mapping for a single channel group. */
export function getGroupProfile(groupId: number): ChannelGroupProfile | null {
  return (getStmt().get(groupId) as ChannelGroupProfile | null) ?? null;
}

/** All known group→profile mappings (including the empty-profile sentinel). */
export function getAllGroupProfiles(): ChannelGroupProfile[] {
  return allStmt().all() as ChannelGroupProfile[];
}

/**
 * Resolve mappings for a set of group ids, returning a Map keyed by group_id.
 * Missing groups are simply absent from the map (caller creates them).
 */
export function getGroupProfilesByGroupIds(groupIds: number[]): Map<number, ChannelGroupProfile> {
  const result = new Map<number, ChannelGroupProfile>();
  for (const id of groupIds) {
    const row = getGroupProfile(id);
    if (row) result.set(id, row);
  }
  return result;
}

/** Insert or update the profile mapping for a channel group. */
export function upsertGroupProfile(groupId: number, profileId: number, profileName: string): void {
  upsertStmt().run(groupId, profileId, profileName);
}

/** Remove the mapping for a channel group (e.g. when the group disappears). */
export function deleteGroupProfile(groupId: number): boolean {
  return deleteStmt().run(groupId).changes > 0;
}

/**
 * Reset prepared statements — for testing only.
 */
export function _resetStatementsForTesting(): void {
  stmtGet = null;
  stmtAll = null;
  stmtUpsert = null;
  stmtDelete = null;
}
